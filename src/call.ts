import { randomUUID } from "node:crypto";
import {
	constants as fsConstants,
	lstat as nodeLstat,
	open as nodeOpen,
} from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ExtensionAPI } from "@gajae-code/coding-agent";
import {
	HC_NAME_RE,
	hcGet,
	hcResolveTarget,
	hcSend,
	hcWait,
	isRemoteHcAddress,
	isSelf,
	isValidHcAddress,
	type HcExecDeps,
} from "./hc.ts";
import { HC_DONE_NON_ATOMIC_NOTE } from "./send.ts";

type Exec = ExtensionAPI["exec"];

const LOOKUP_TIMEOUT_MS = 3_000;
/** Total monotonic budget for one call, submission time included. */
const CALL_BUDGET_MS = 60_000;
const MAX_RESULT_FILE_BYTES = 1_024 * 1_024;
const RESULT_FILE_OPEN_FLAGS =
	fsConstants.O_RDONLY |
	(fsConstants.O_NOFOLLOW ?? 0) |
	(fsConstants.O_NONBLOCK ?? 0);

export const USAGE =
	"Usage: /herdr-call --result-file <abs-path> <terminal> <text>";

export interface AgentCallRequest {
	target: string;
	text: string;
	resultFile?: string;
	result_file?: string;
}

export interface ResultFileStat {
	isFile(): boolean;
	nlink: number;
	size: number;
}

export interface ResultFileReadResult {
	bytesRead: number;
	buffer: Uint8Array;
}

export interface ResultFileHandle {
	stat(): Promise<ResultFileStat>;
	read(
		buffer: Uint8Array,
		offset: number,
		length: number,
		position: number | null,
	): Promise<ResultFileReadResult>;
	close(): Promise<void>;
}

export interface ResultFileFs {
	lstat(path: string): Promise<unknown>;
	open(path: string, flags: number): Promise<ResultFileHandle>;
}

export interface AgentCallDeps {
	exec: Exec;
	/** Canonical terminal addresses with an in-flight call in this plugin instance. */
	inFlight: Set<string>;
	/** `hc` executable path or binary name (`"hc"` by default). */
	hcBin?: string;
	/** Caller terminal address (`HC_TERMINAL_ID`). */
	hcCallerId?: string;
	now?: () => number;
	/** Test seam for `--result-file` / `result_file` inspection and recovery; defaults to `node:fs/promises`. */
	fs?: ResultFileFs;
}

export type AgentCallStatus =
	| "not_sent"
	| "stalled"
	| "uncertain"
	| "answered"
	| "response_unverified"
	| "read_failed";

export type DeliveryCertainty = "not_sent" | "submitted" | "unknown";

export interface AgentCallResult {
	ok: boolean;
	status: AgentCallStatus;
	delivery: DeliveryCertainty;
	requestId: string;
	pane?: string;
	state?: string;
	answer?: string;
	resultFile?: string;
	markerVerified?: boolean;
	/** True when `hc send` ran without `--if` for a preflight `done` target (non-atomic). */
	nonAtomicDone?: boolean;
	error?: {
		code: string;
		message: string;
		exitCode?: number;
	};
	elapsedMs: number;
}

const defaultFs: ResultFileFs = {
	lstat: (path) => nodeLstat(path),
	open: (path, flags) => nodeOpen(path, flags),
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isMissingExecutable(error: unknown): boolean {
	return (error as { code?: unknown } | undefined)?.code === "ENOENT";
}

function resultFileInstruction(requestId: string, resultFile: string): string {
	return (
		`\n\nWrite your complete final answer as a new file at ${resultFile}, ` +
		`and reply on screen with only three lines: the exact token GJC_HERDR_BEGIN_${requestId} ` +
		`on the first line, ${resultFile} on the second line, and GJC_HERDR_END_${requestId} on the last line.`
	);
}

function isMissingPath(error: unknown): boolean {
	if (isMissingExecutable(error)) return true;
	return error instanceof Error && /\bENOENT\b/.test(error.message);
}

interface ResultFileBudgetContext {
	deadline?: number;
	signal?: AbortSignal;
	now?: () => number;
	fixedMessages?: boolean;
}

function isResultFileBudgetExpired(context: ResultFileBudgetContext): boolean {
	if (context.deadline === undefined) return false;
	const now = context.now ?? (() => performance.now());
	return context.deadline - now() < 1;
}

type RacedFileOp<T> =
	| { status: "ok"; value: T }
	| { status: "error"; error: unknown }
	| { status: "aborted" }
	| { status: "timeout" };

async function raceResultFileOp<T>(
	startOp: () => Promise<T>,
	context: ResultFileBudgetContext,
	onLateSuccess?: (value: T) => void,
): Promise<RacedFileOp<T>> {
	const signal = context.signal;
	if (signal?.aborted) return { status: "aborted" };
	if (isResultFileBudgetExpired(context)) return { status: "timeout" };

	const now = context.now ?? (() => performance.now());
	const remMs =
		context.deadline !== undefined ? context.deadline - now() : undefined;
	if (remMs !== undefined && remMs < 1) {
		return { status: "timeout" };
	}

	let settled = false;
	let opPromise: Promise<T>;
	try {
		opPromise = startOp();
	} catch (error) {
		if (signal?.aborted) return { status: "aborted" };
		if (isResultFileBudgetExpired(context)) return { status: "timeout" };
		return { status: "error", error };
	}

	const wrappedOp: Promise<RacedFileOp<T>> = opPromise.then(
		(value): RacedFileOp<T> => {
			if (settled) {
				if (onLateSuccess) {
					try {
						onLateSuccess(value);
					} catch {
						// Ignore cleanup errors on late I/O completion.
					}
				}
				return { status: "ok", value };
			}
			settled = true;
			return { status: "ok", value };
		},
		(error: unknown): RacedFileOp<T> => {
			settled = true;
			return { status: "error", error };
		},
	);

	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;

	const guardPromise = new Promise<RacedFileOp<T>>((resolve) => {
		if (signal) {
			if (signal.aborted) {
				settled = true;
				resolve({ status: "aborted" });
				return;
			}
			onAbort = () => {
				if (!settled) {
					settled = true;
					resolve({ status: "aborted" });
				}
			};
			signal.addEventListener("abort", onAbort, { once: true });
		}
		if (remMs !== undefined) {
			const delayMs = Math.max(1, Math.ceil(remMs));
			timer = setTimeout(() => {
				if (!settled) {
					settled = true;
					resolve({ status: "timeout" });
				}
			}, delayMs);
			timer.unref?.();
		}
	});

	try {
		const outcome = await Promise.race([wrappedOp, guardPromise]);
		if (outcome.status === "ok" || outcome.status === "error") {
			if (signal?.aborted) {
				if (outcome.status === "ok" && onLateSuccess) {
					try {
						onLateSuccess(outcome.value);
					} catch {
						// Ignore cleanup errors.
					}
				}
				return { status: "aborted" };
			}
			if (isResultFileBudgetExpired(context)) {
				if (outcome.status === "ok" && onLateSuccess) {
					try {
						onLateSuccess(outcome.value);
					} catch {
						// Ignore cleanup errors.
					}
				}
				return { status: "timeout" };
			}
		}
		return outcome;
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		if (signal && onAbort) signal.removeEventListener("abort", onAbort);
	}
}

async function checkResultFileAbsent(
	fsOps: ResultFileFs,
	resultFile: string,
	context: ResultFileBudgetContext,
): Promise<string | undefined> {
	const raced = await raceResultFileOp(
		() => fsOps.lstat(resultFile),
		context,
	);
	if (raced.status === "aborted") return "aborted";
	if (raced.status === "timeout") return "timeout";
	if (raced.status === "ok") {
		if (context.fixedMessages) {
			return "result file check failed: already exists";
		}
		return `result_file already exists at ${resultFile}; use a new path for each call.`;
	}
	if (isMissingPath(raced.error)) return undefined;
	if (context.fixedMessages) {
		return "result file check failed: lstat_failed";
	}
	return `Cannot inspect result_file ${resultFile}: ${errorMessage(raced.error)}`;
}

type RecoveredResultFile =
	| { ok: true; answer: string }
	| {
			ok: false;
			code:
				| "aborted"
				| "timeout"
				| "result_file_missing"
				| "result_file_invalid";
			message: string;
	  };

function abortedResultFile(): RecoveredResultFile {
	return {
		ok: false,
		code: "aborted",
		message: "Answer read aborted; the prompt was already delivered.",
	};
}

function timeoutResultFile(): RecoveredResultFile {
	return {
		ok: false,
		code: "timeout",
		message:
			"Result file recovery exceeded the call budget after prompt submission.",
	};
}

async function recoverResultFile(
	fsOps: ResultFileFs,
	resultFile: string,
	signal: AbortSignal | undefined,
	context: ResultFileBudgetContext,
): Promise<RecoveredResultFile> {
	const effSignal = context.signal ?? signal;
	const effContext: ResultFileBudgetContext = {
		...context,
		signal: effSignal,
	};
	const fixed = effContext.fixedMessages === true;
	const opened = await raceResultFileOp(
		() => fsOps.open(resultFile, RESULT_FILE_OPEN_FLAGS),
		effContext,
		(lateHandle) => {
			try {
				void lateHandle.close().catch(() => {});
			} catch {
				// Ignore close errors on late open.
			}
		},
	);
	if (opened.status === "aborted") return abortedResultFile();
	if (opened.status === "timeout") return timeoutResultFile();
	if (opened.status === "error") {
		if (isMissingPath(opened.error)) {
			return {
				ok: false,
				code: "result_file_missing",
				message: fixed
					? "result file check failed: result_file_missing"
					: `Result file was not created at ${resultFile}.`,
			};
		}
		return {
			ok: false,
			code: "result_file_invalid",
			message: fixed
				? "result file check failed: result_file_invalid"
				: `Result file at ${resultFile} could not be opened: ${errorMessage(opened.error)}`,
		};
	}
	const handle = opened.value;
	let opInFlight = false;
	let lastOpPromise: Promise<unknown> | undefined;
	const trackOp = <T>(p: Promise<T>): Promise<T> => {
		opInFlight = true;
		const tracked = p.then(
			(v) => {
				opInFlight = false;
				return v;
			},
			(e) => {
				opInFlight = false;
				throw e;
			},
		);
		lastOpPromise = tracked.catch(() => {});
		return tracked;
	};
	try {
		const statted = await raceResultFileOp(
			() => trackOp(handle.stat()),
			effContext,
		);
		if (statted.status === "aborted") return abortedResultFile();
		if (statted.status === "timeout") return timeoutResultFile();
		if (statted.status === "error") {
			return {
				ok: false,
				code: "result_file_invalid",
				message: fixed
					? "result file check failed: result_file_invalid"
					: `Result file at ${resultFile} could not be inspected: ${errorMessage(statted.error)}`,
			};
		}
		const stat = statted.value;
		if (!stat.isFile()) {
			return {
				ok: false,
				code: "result_file_invalid",
				message: fixed
					? "result file check failed: result_file_invalid"
					: `Result file at ${resultFile} is not a regular file.`,
			};
		}
		if (stat.nlink !== 1) {
			return {
				ok: false,
				code: "result_file_invalid",
				message: fixed
					? "result file check failed: result_file_invalid"
					: `Result file at ${resultFile} must have link count 1 (got ${stat.nlink}).`,
			};
		}
		if (stat.size <= 0 || stat.size > MAX_RESULT_FILE_BYTES) {
			return {
				ok: false,
				code: "result_file_invalid",
				message: fixed
					? "result file check failed: result_file_invalid"
					: stat.size <= 0
						? `Result file at ${resultFile} is empty.`
						: `Result file at ${resultFile} exceeds the 1 MiB limit (${stat.size} bytes).`,
			};
		}
		const maxReadBytes = MAX_RESULT_FILE_BYTES + 1;
		const buffer = new Uint8Array(maxReadBytes);
		let totalBytes = 0;
		while (totalBytes < maxReadBytes) {
			const readStep = await raceResultFileOp(
				() =>
					trackOp(
						handle.read(
							buffer,
							totalBytes,
							maxReadBytes - totalBytes,
							totalBytes,
						),
					),
				effContext,
			);
			if (readStep.status === "aborted") return abortedResultFile();
			if (readStep.status === "timeout") return timeoutResultFile();
			if (readStep.status === "error") {
				return {
					ok: false,
					code: "result_file_invalid",
					message: fixed
						? "result file check failed: result_file_invalid"
						: `Result file at ${resultFile} could not be read: ${errorMessage(readStep.error)}`,
				};
			}
			const { bytesRead, buffer: chunkBuffer } = readStep.value;
			if (bytesRead <= 0) break;
			if (chunkBuffer && chunkBuffer !== buffer) {
				const copyLen = Math.min(bytesRead, maxReadBytes - totalBytes);
				buffer.set(chunkBuffer.subarray(0, copyLen), totalBytes);
			}
			totalBytes += bytesRead;
		}
		if (effSignal?.aborted) return abortedResultFile();
		if (isResultFileBudgetExpired(effContext)) return timeoutResultFile();
		if (totalBytes <= 0 || totalBytes > MAX_RESULT_FILE_BYTES) {
			return {
				ok: false,
				code: "result_file_invalid",
				message: fixed
					? "result file check failed: result_file_invalid"
					: totalBytes <= 0
						? `Result file at ${resultFile} is empty.`
						: `Result file at ${resultFile} exceeds the 1 MiB limit (${totalBytes} bytes).`,
			};
		}
		let answer: string;
		try {
			answer = new TextDecoder("utf-8", { fatal: true }).decode(
				buffer.subarray(0, totalBytes),
			);
		} catch (error) {
			if (effSignal?.aborted) return abortedResultFile();
			if (isResultFileBudgetExpired(effContext)) return timeoutResultFile();
			return {
				ok: false,
				code: "result_file_invalid",
				message: fixed
					? "result file check failed: result_file_invalid"
					: `Result file at ${resultFile} is not valid UTF-8: ${errorMessage(error)}`,
			};
		}
		if (effSignal?.aborted) return abortedResultFile();
		if (isResultFileBudgetExpired(effContext)) return timeoutResultFile();
		return { ok: true, answer };
	} finally {
		if (opInFlight && lastOpPromise) {
			void lastOpPromise.then(() => {
				try {
					void handle.close().catch(() => {});
				} catch {
					// Ignore close errors.
				}
			});
		} else if (effSignal?.aborted || isResultFileBudgetExpired(effContext)) {
			try {
				const closePromise = handle.close();
				closePromise.catch(() => {});
				await Promise.race([closePromise, Promise.resolve()]);
			} catch {
				// Ignore close errors.
			}
		} else {
			await raceResultFileOp(() => handle.close(), effContext);
		}
	}
}

/**
 * Calls an `hc` terminal agent in another local terminal and recovers its answer
 * from `--result-file`.
 */
export async function callRegisteredAgent(
	deps: AgentCallDeps,
	request: AgentCallRequest,
	signal?: AbortSignal,
): Promise<AgentCallResult> {
	return callViaHc(deps, request, signal);
}

/** Parses `[--result-file <abs-path>] <target> <text>`; everything after the target's single separator is kept verbatim. */
export function parseCallCommandArgs(args: string): AgentCallRequest | string {
	let rest = args.replace(/^\s+/, "");
	let resultFile: string | undefined;
	while (rest.startsWith("-")) {
		const [flag] = rest.split(/\s/, 1);
		if (flag !== "--result-file" || resultFile !== undefined) return USAGE;
		rest = rest.slice(flag.length).replace(/^\s+/, "");
		if (!rest) return USAGE;
		const [fileToken] = rest.split(/\s/, 1);
		if (!fileToken) return USAGE;
		resultFile = fileToken;
		rest = rest.slice(fileToken.length).replace(/^\s+/, "");
	}
	const match = /^(\S+)(?:\s([\s\S]*))?$/.exec(rest);
	if (!match) return USAGE;
	return {
		target: match[1]!,
		text: match[2] ?? "",
		...(resultFile !== undefined ? { resultFile } : {}),
	};
}

export function describeCallResult(result: AgentCallResult): string {
	const header = `herdr-call ${result.status} (delivery ${result.delivery}, request ${result.requestId}${result.pane ? `, pane ${result.pane}` : ""}${result.resultFile ? `, resultFile ${result.resultFile}` : ""})`;
	const includeDoneNote =
		result.nonAtomicDone === true && result.delivery !== "not_sent";
	if (result.ok && result.status === "answered") {
		return includeDoneNote
			? `${header}\n${HC_DONE_NON_ATOMIC_NOTE}\n\n${result.answer}`
			: `${header}\n\n${result.answer}`;
	}
	const parts = [header];
	if (result.error) {
		parts.push(result.error.message);
	}
	if (includeDoneNote) {
		parts.push(HC_DONE_NON_ATOMIC_NOTE);
	}
	return parts.join("\n");
}

export interface RegisterCallOptions {
	hcBin?: string;
	hcCallerId?: string;
}

export const HC_CALL_BACKEND_NOTE =
	"hc: unattended target assumed (not verified by the plugin); idle or done targets only (done omits --if and is not atomic); text delivery only, no GJC session token";

export function registerCallFeatures(
	api: ExtensionAPI,
	options?: RegisterCallOptions,
): void {
	const resolvedOptions: RegisterCallOptions = options ?? {};
	const deps: AgentCallDeps = {
		exec: api.exec.bind(api),
		inFlight: new Set<string>(),
		...(resolvedOptions.hcBin !== undefined
			? { hcBin: resolvedOptions.hcBin }
			: {}),
		...(resolvedOptions.hcCallerId !== undefined
			? { hcCallerId: resolvedOptions.hcCallerId }
			: {}),
	};

	function summarize(result: AgentCallResult): void {
		const phase = result.ok
			? "completed"
			: result.delivery === "not_sent"
				? "pre_send"
				: result.delivery === "unknown"
					? "send"
					: "post_send";
		api.logger.info("herdr-call finished", {
			backend: "hc",
			phase,
			code: result.error?.code,
			status: result.status,
			delivery: result.delivery,
			elapsedMs: result.elapsedMs,
			hasResultFile: Boolean(result.resultFile),
			resultFileLength: result.resultFile?.length ?? 0,
		});
	}

	const commandDescription =
		"Call an hc terminal agent in another local terminal and recover its answer from --result-file: --result-file <abs-path> <terminal> <text> " +
		`(--result-file required, idle or done targets only, done is not atomic, local address only, no screen read; ${HC_CALL_BACKEND_NOTE})`;

	const toolDescription =
		"Call an hc terminal agent in another local terminal and recover its answer text from `result_file` (60s total budget, 5s reserved for file recovery). " +
		"`target` must be an explicit local hc terminal ID (e.g. t2) or a name that resolves to exactly one terminal, and `result_file` is required (--result-file required, idle or done targets only, done omits `--if` and is not atomic, local address only, no screen read). " +
		`${HC_CALL_BACKEND_NOTE}. ` +
		"No remote approvals, key presses, or retries are ever sent.";

	api.registerCommand("herdr-call", {
		description: commandDescription,
		handler: async (args: string) => {
			const request = parseCallCommandArgs(args);
			const result: AgentCallResult =
				typeof request === "string"
					? {
							ok: false,
							status: "not_sent",
							delivery: "not_sent",
							requestId: "",
							elapsedMs: 0,
							error: { code: "invalid_request", message: request },
						}
					: await callRegisteredAgent(deps, request);
			summarize(result);
			const message = describeCallResult(result);
			await api.sendMessage(
				{
					customType: "herdr-call",
					content: message,
					display: true,
					details: result,
				},
				{ triggerTurn: false },
			);
		},
	});

	const { z } = api.zod;
	api.registerTool({
		name: "herdr_agent_call",
		label: "Herdr Agent Call",
		description: toolDescription,
		parameters: z.object({
			target: z
				.string()
				.describe("Target local hc terminal ID (e.g. t2) or unique terminal name"),
			text: z
				.string()
				.describe("Prompt text to deliver verbatim (must not start with '-')"),
			result_file: z
				.string()
				.optional()
				.describe(
					"Required on hc: new local absolute path (must not exist before sending) where the target agent writes its full answer",
				),
		}),
		async execute(_toolCallId: string, params, signal) {
			const result = await callRegisteredAgent(
				deps,
				{
					target: params.target,
					text: params.text,
					...(params.result_file !== undefined
						? { resultFile: params.result_file }
						: {}),
				},
				signal,
			);
			summarize(result);
			return {
				content: [{ type: "text", text: describeCallResult(result) }],
				details: result,
				isError: !result.ok,
			};
		},
	});
}

const HC_FILE_RESERVE_MS = 5_000;

function isValidResultFilePath(rawResultFile: string): boolean {
	return Boolean(
		rawResultFile &&
			rawResultFile.trim() &&
			rawResultFile === rawResultFile.trim() &&
			!/[\0\r\n]/.test(rawResultFile) &&
			isAbsolute(rawResultFile),
	);
}

/**
 * Calls an `hc` terminal agent and recovers its answer from `--result-file`:
 * result-file required & pre-check -> resolve target (local only) -> caller/self check ->
 * inFlight -> preflight `hc get` (live, reported===true, status.state==="idle"|"done") ->
 * pre-send result-file re-check -> `hc send --json [--if idle] --wait --timeout`
 * (`--if idle` for idle, no `--if` for done) ->
 * turn/wait correlation (with follow-up `hc wait` on ended=false timeout/message) ->
 * `recoverResultFile` (`markerVerified: false`, no screen read).
 */
export async function callViaHc(
	deps: AgentCallDeps,
	request: AgentCallRequest,
	signal?: AbortSignal,
): Promise<AgentCallResult> {
	const now = deps.now ?? (() => performance.now());
	const startedAt = now();
	const deadline = startedAt + CALL_BUDGET_MS;
	const waitDeadline = deadline - HC_FILE_RESERVE_MS;
	const requestId = randomUUID();
	const rawResultFile = request.resultFile ?? request.result_file;
	let sentAsNonAtomicDone = false;
	const finish = (
		partial: Partial<AgentCallResult> & {
			status: AgentCallStatus;
			delivery: DeliveryCertainty;
		},
	): AgentCallResult => ({
		ok: false,
		requestId,
		elapsedMs: now() - startedAt,
		...(rawResultFile !== undefined ? { resultFile: rawResultFile } : {}),
		...(sentAsNonAtomicDone && partial.delivery !== "not_sent"
			? { nonAtomicDone: true }
			: {}),
		...partial,
	});

	if (rawResultFile === undefined) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "invalid_request",
				message: "hc backend requires --result-file",
			},
		});
	}
	if (!isValidResultFilePath(rawResultFile)) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "invalid_request",
				message:
					"result_file must be a non-empty absolute path without NUL or newline characters.",
			},
		});
	}

	const target = request.target.trim();
	if (!target) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: { code: "invalid_request", message: "Target is required." },
		});
	}
	if (target.startsWith("-")) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "invalid_request",
				message: "Target must be an hc terminal address or name, not an option.",
			},
		});
	}
	if (!request.text.trim()) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "invalid_request",
				message: "Prompt text must not be empty.",
			},
		});
	}
	if (request.text.startsWith("-")) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "invalid_request",
				message: "text starting with '-' unsupported on hc",
			},
		});
	}
	if (signal?.aborted) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: { code: "aborted", message: "Call aborted before delivery." },
		});
	}

	const fsOps = deps.fs ?? defaultFs;
	const preSendFileBudget: ResultFileBudgetContext = {
		deadline: waitDeadline,
		signal,
		now,
		fixedMessages: true,
	};
	const initialConflict = await checkResultFileAbsent(
		fsOps,
		rawResultFile,
		preSendFileBudget,
	);
	if (signal?.aborted || initialConflict === "aborted") {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: { code: "aborted", message: "Call aborted before delivery." },
		});
	}
	if (initialConflict === "timeout") {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "timeout",
				message: "result file check timed out",
			},
		});
	}
	if (initialConflict !== undefined) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "invalid_request",
				message: initialConflict,
			},
		});
	}

	if (isValidHcAddress(target) && isRemoteHcAddress(target)) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			pane: target,
			error: {
				code: "invalid_request",
				message: "remote result file recovery unsupported",
			},
		});
	}
	if (
		!isValidHcAddress(target) &&
		(target.includes("/") || !HC_NAME_RE.test(target))
	) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "invalid_request",
				message:
					"Target is neither a valid hc terminal address nor a valid terminal name.",
			},
		});
	}

	const callerId = deps.hcCallerId?.trim();
	if (!callerId || !isValidHcAddress(callerId)) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "invalid_request",
				message: "hc caller unknown",
			},
		});
	}

	const hcDeps: HcExecDeps = {
		exec: deps.exec,
		hcBin: deps.hcBin ?? "hc",
	};

	const resolved = await hcResolveTarget(
		hcDeps,
		target,
		Math.min(LOOKUP_TIMEOUT_MS, waitDeadline - now()),
		signal,
	);
	if (!resolved.ok) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: resolved.code,
				message: resolved.message,
				...(resolved.exitCode !== undefined
					? { exitCode: resolved.exitCode }
					: {}),
			},
		});
	}
	const addr = resolved.address;
	if (resolved.remote) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			pane: addr,
			error: {
				code: "invalid_request",
				message: "remote result file recovery unsupported",
			},
		});
	}
	if (isSelf(addr, callerId)) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			pane: addr,
			error: {
				code: "self_target",
				message: "Cannot call the current hc terminal.",
			},
		});
	}

	if (deps.inFlight.has(addr)) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			pane: addr,
			error: {
				code: "target_busy",
				message: "Another call to this terminal is already in flight here.",
			},
		});
	}

	deps.inFlight.add(addr);
	try {
		const preflight = await hcGet(
			hcDeps,
			addr,
			Math.min(LOOKUP_TIMEOUT_MS, waitDeadline - now()),
			signal,
		);
		if (!preflight.ok) {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				pane: addr,
				error: {
					code: preflight.code,
					message: preflight.message,
					...(preflight.exitCode !== undefined
						? { exitCode: preflight.exitCode }
						: {}),
				},
			});
		}

		const facts = preflight.facts;
		if (facts.state === "finished") {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				pane: addr,
				state: "finished",
				error: {
					code: "terminal_finished",
					message: "Target terminal has finished; no input was sent.",
				},
			});
		}
		if (facts.reported !== true) {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				pane: addr,
				...(facts.statusState ? { state: facts.statusState } : {}),
				error: {
					code: "not_reported",
					message:
						"Target terminal has not reported status (OSC 7501); no input was sent.",
				},
			});
		}
		if (facts.statusState === "working") {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				pane: addr,
				state: "working",
				error: {
					code: "agent_busy",
					message: "Target agent is currently working; no input was sent.",
				},
			});
		}
		if (facts.statusState === "blocked") {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				pane: addr,
				state: "blocked",
				error: {
					code: "agent_blocked",
					message:
						"Target is blocked waiting for a user decision; no input was sent.",
				},
			});
		}
		if (facts.statusState !== "idle" && facts.statusState !== "done") {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				pane: addr,
				...(facts.statusState ? { state: facts.statusState } : {}),
				error: {
					code: "agent_state_unknown",
					message: "Target agent state is not idle or done; no input was sent.",
				},
			});
		}
		const preflightState: "idle" | "done" = facts.statusState;
		const isDoneTarget = preflightState === "done";

		const patchedText =
			request.text + resultFileInstruction(requestId, rawResultFile);
		const preSendConflict = await checkResultFileAbsent(
			fsOps,
			rawResultFile,
			preSendFileBudget,
		);
		if (signal?.aborted || preSendConflict === "aborted") {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				pane: addr,
				state: preflightState,
				error: { code: "aborted", message: "Call aborted before delivery." },
			});
		}
		if (preSendConflict === "timeout") {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				pane: addr,
				state: preflightState,
				error: {
					code: "timeout",
					message: "result file check timed out",
				},
			});
		}
		if (preSendConflict !== undefined) {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				pane: addr,
				state: preflightState,
				error: {
					code: "invalid_request",
					message: preSendConflict,
				},
			});
		}

		const sendRemMs = waitDeadline - now();
		if (Math.floor(sendRemMs) < 1) {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				pane: addr,
				state: preflightState,
				error: {
					code: "timeout",
					message: "Call budget exhausted before hc send.",
				},
			});
		}
		const sendTimeoutSec = Math.max(1, Math.ceil(sendRemMs / 1000));
		sentAsNonAtomicDone = isDoneTarget;
		const sent = await hcSend(
			hcDeps,
			addr,
			patchedText,
			{
				wait: true,
				timeoutSec: sendTimeoutSec,
				...(isDoneTarget ? { ifIdle: false } : {}),
			},
			Math.floor(sendRemMs),
			signal,
		);
		if (!sent.ok) {
			return finish({
				status: sent.certainty === "not_sent" ? "not_sent" : "uncertain",
				delivery: sent.certainty,
				pane: addr,
				error: {
					code: sent.code,
					message: sent.message,
					...(sent.exitCode !== undefined ? { exitCode: sent.exitCode } : {}),
				},
			});
		}

		if (sent.turn < facts.turn) {
			return finish({
				status: "uncertain",
				delivery: "submitted",
				pane: addr,
				error: {
					code: "protocol",
					message:
						"hc send reported a turn earlier than preflight get; answer recovery skipped.",
				},
			});
		}
		if (!sent.waitValid) {
			return finish({
				status: "uncertain",
				delivery: "submitted",
				pane: addr,
				error: {
					code: "protocol",
					message:
						"hc send returned a malformed wait object; answer recovery skipped.",
				},
			});
		}
		if (sent.wait === null || sent.wait === undefined) {
			if (sent.started === false) {
				return finish({
					status: "stalled",
					delivery: "submitted",
					pane: addr,
					error: {
						code: "stalled",
						message:
							"Prompt was submitted to hc, but the target did not start working.",
					},
				});
			}
			return finish({
				status: "uncertain",
				delivery: "submitted",
				pane: addr,
				error: {
					code: "protocol",
					message:
						"hc send --wait returned no wait result; answer recovery skipped.",
				},
			});
		}

		let currentWait = sent.wait;
		let lastTurn = sent.turn;
		let settled: "idle" | "done";

		for (;;) {
			if (currentWait.terminal !== addr) {
				return finish({
					status: "uncertain",
					delivery: "submitted",
					pane: addr,
					error: {
						code: "protocol",
						message:
							"hc wait response terminal did not match target address; answer recovery skipped.",
					},
				});
			}
			if (currentWait.turn < sent.turn || currentWait.turn < lastTurn) {
				return finish({
					status: "uncertain",
					delivery: "submitted",
					pane: addr,
					error: {
						code: "protocol",
						message:
							"hc wait reported a turn earlier than the send turn; answer recovery skipped.",
					},
				});
			}
			lastTurn = currentWait.turn;

			if (currentWait.reason === "not_started") {
				return finish({
					status: "stalled",
					delivery: "submitted",
					pane: addr,
					...(currentWait.status ? { state: currentWait.status } : {}),
					error: {
						code: "stalled",
						message:
							"Prompt was submitted to hc, but the target did not start working (not_started).",
					},
				});
			}
			if (currentWait.reason === "exit") {
				if (currentWait.ended !== true) {
					return finish({
						status: "uncertain",
						delivery: "submitted",
						pane: addr,
						error: {
							code: "protocol",
							message:
								"hc wait reported exit with ended=false; answer recovery skipped.",
						},
					});
				}
				const exitParts: string[] = [];
				if (currentWait.exitCode !== null) {
					exitParts.push(`exit_code=${currentWait.exitCode}`);
				}
				if (currentWait.signal !== null) {
					exitParts.push(`signal=${currentWait.signal}`);
				}
				const exitDetail =
					exitParts.length > 0 ? exitParts.join(", ") : "no exit code";
				return finish({
					status: "response_unverified",
					delivery: "submitted",
					pane: addr,
					state: "finished",
					error: {
						code: "terminal_finished",
						message: `Target terminal exited before completing the turn (${exitDetail}); answer recovery skipped.`,
						...(currentWait.exitCode !== null
							? { exitCode: currentWait.exitCode }
							: {}),
					},
				});
			}
			if (currentWait.status === "blocked") {
				return finish({
					status: "response_unverified",
					delivery: "submitted",
					pane: addr,
					state: "blocked",
					error: {
						code: "agent_blocked",
						message:
							"Target is blocked waiting for a user decision after prompt submission; answer recovery skipped.",
					},
				});
			}
			if (currentWait.status === "error") {
				return finish({
					status: "response_unverified",
					delivery: "submitted",
					pane: addr,
					state: "error",
					error: {
						code: "agent_error",
						message:
							"Target reported error status after prompt submission; answer recovery skipped.",
					},
				});
			}

			if (currentWait.ended === true) {
				if (currentWait.reason !== "status") {
					return finish({
						status: "uncertain",
						delivery: "submitted",
						pane: addr,
						...(currentWait.status ? { state: currentWait.status } : {}),
						error: {
							code: "protocol",
							message:
								"hc wait ended with an unexpected reason; answer recovery skipped.",
						},
					});
				}
				if (currentWait.status !== "idle" && currentWait.status !== "done") {
					return finish({
						status: "uncertain",
						delivery: "submitted",
						pane: addr,
						...(currentWait.status ? { state: currentWait.status } : {}),
						error: {
							code: "protocol",
							message:
								"hc wait ended with an unexpected status; answer recovery skipped.",
						},
					});
				}
				if (currentWait.turn < sent.turn + 1) {
					return finish({
						status: "uncertain",
						delivery: "submitted",
						pane: addr,
						state: currentWait.status,
						error: {
							code: "protocol",
							message:
								"Target reported completion without advancing turn past send; answer recovery skipped.",
						},
					});
				}
				settled = currentWait.status;
				break;
			}

			// ended === false: only valid check-in reasons (timeout or message) while working may re-wait.
			if (
				(currentWait.reason !== "timeout" &&
					currentWait.reason !== "message") ||
				(currentWait.status !== null && currentWait.status !== "working")
			) {
				return finish({
					status: "uncertain",
					delivery: "submitted",
					pane: addr,
					...(currentWait.status ? { state: currentWait.status } : {}),
					error: {
						code: "protocol",
						message:
							"hc wait returned ended=false with an unexpected reason or terminal status; answer recovery skipped.",
					},
				});
			}

			const waitRemMs = waitDeadline - now();
			if (Math.floor(waitRemMs) < 1) {
				return finish({
					status: "uncertain",
					delivery: "submitted",
					pane: addr,
					...(currentWait.status ? { state: currentWait.status } : {}),
					error: {
						code: "timeout",
						message:
							"Call wait budget exhausted after prompt submission; the target may still be running. Do not resend.",
					},
				});
			}
			const waitTimeoutSec = Math.max(1, Math.ceil(waitRemMs / 1000));
			const nextWait = await hcWait(
				hcDeps,
				addr,
				waitTimeoutSec,
				Math.floor(waitRemMs),
				signal,
			);
			if (!nextWait.ok) {
				return finish({
					status: "uncertain",
					delivery: "submitted",
					pane: addr,
					error: {
						code: nextWait.code,
						message: nextWait.message,
						...(nextWait.exitCode !== undefined
							? { exitCode: nextWait.exitCode }
							: {}),
					},
				});
			}
			currentWait = nextWait.wait;
		}

		if (deadline - now() < 1) {
			return finish({
				status: "uncertain",
				delivery: "submitted",
				pane: addr,
				state: settled,
				error: {
					code: "timeout",
					message:
						"Turn settled but no budget remained for result file recovery.",
				},
			});
		}

		const recovered = await recoverResultFile(fsOps, rawResultFile, signal, {
			deadline,
			signal,
			now,
			fixedMessages: true,
		});
		if (
			signal?.aborted ||
			(!recovered.ok && recovered.code === "aborted")
		) {
			return finish({
				status: "read_failed",
				delivery: "submitted",
				pane: addr,
				state: settled,
				error: {
					code: "aborted",
					message: "Answer read aborted; the prompt was already delivered.",
				},
			});
		}
		if ((!recovered.ok && recovered.code === "timeout") || deadline - now() < 1) {
			return finish({
				status: "uncertain",
				delivery: "submitted",
				pane: addr,
				state: settled,
				error: {
					code: "timeout",
					message:
						"Result file recovery exceeded the call budget after prompt submission.",
				},
			});
		}
		if (!recovered.ok) {
			const fixedCode =
				recovered.code === "result_file_missing"
					? "result_file_missing"
					: "result_file_invalid";
			return finish({
				status: "response_unverified",
				delivery: "submitted",
				pane: addr,
				state: settled,
				error: {
					code: fixedCode,
					message: `result file check failed: ${fixedCode}`,
				},
			});
		}

		return {
			ok: true,
			status: "answered",
			delivery: "submitted",
			requestId,
			pane: addr,
			state: settled,
			answer: recovered.answer,
			resultFile: rawResultFile,
			markerVerified: false,
			...(isDoneTarget ? { nonAtomicDone: true } : {}),
			elapsedMs: now() - startedAt,
		};
	} finally {
		deps.inFlight.delete(addr);
	}
}
