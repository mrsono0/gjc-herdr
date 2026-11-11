import { randomUUID } from "node:crypto";
import {
	constants as fsConstants,
	lstat as nodeLstat,
	open as nodeOpen,
} from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ExtensionAPI, ExecResult } from "@gajae-code/coding-agent";
import { classifyInput, inputWaitMs, waitForEmptyInput } from "./input.ts";
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

type Exec = ExtensionAPI["exec"];
type Json = Record<string, unknown>;

const PANE_ID = /^w[^:\s]+:p[^:\s]+$/;
const LOOKUP_TIMEOUT_MS = 3_000;
const READ_TIMEOUT_MS = 3_000;
/** Total monotonic budget for one call, submission time included. */
const CALL_BUDGET_MS = 60_000;
/** Budget reserved for the final read when computing the prompt timeout. */
const READ_RESERVE_MS = 3_000;
const READ_LINES = "200";
const POLL_INTERVAL_MS = 2_000;
const MIN_RECHECK_MS = 1_000;
const MAX_RESULT_FILE_BYTES = 1_024 * 1_024;
const RESULT_FILE_OPEN_FLAGS =
	fsConstants.O_RDONLY |
	(fsConstants.O_NOFOLLOW ?? 0) |
	(fsConstants.O_NONBLOCK ?? 0);

export const USAGE =
	"Usage: /herdr-call [--result-file <abs-path>] <pane-id-or-unique-agent-name> <text>";

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
	herdrBin: string;
	/** Canonical pane IDs with an in-flight call in this plugin instance. */
	inFlight: Set<string>;
	/** Active backend (`"herdr"` by default). */
	backend?: "herdr" | "hc";
	/** `hc` executable path or binary name (`"hc"` by default). */
	hcBin?: string;
	/** Caller terminal address (`HC_TERMINAL_ID`) when running on the `hc` backend. */
	hcCallerId?: string;
	/** Test seam for the input-box wait; defaults to a real timer. */
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	/** Max wait for a typed-in input box; defaults to GJC_HERDR_INPUT_WAIT_SEC (60 s). */
	inputWaitMs?: number;
	/** Test seam for `--result-file` / `result_file` inspection and recovery; defaults to `node:fs/promises`. */
	fs?: ResultFileFs;
}

export interface PreflightAgent {
	paneId: string;
	terminalId: string;
	state: "idle" | "working" | "blocked" | "done" | "unknown";
	launchPending: boolean;
	/** A human has this pane focused; typing into it could interleave with their input. */
	focused: boolean;
	/** Diagnostic only; the registered/detected verdict stays with Herdr's gate. */
	agentLabel?: string;
}

export type AgentCallStatus =
	| "not_sent"
	| "blocked"
	| "stalled"
	| "uncertain"
	| "answer_pending"
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
	capture?: string;
	resultFile?: string;
	markerVerified?: boolean;
	error?: {
		code: string;
		message: string;
		herdrCode?: string;
		exitCode?: number;
	};
	elapsedMs: number;
	/** Time spent waiting for the target's input box to empty; omitted when it did not wait. */
	waitedMs?: number;
}

const defaultFs: ResultFileFs = {
	lstat: (path) => nodeLstat(path),
	open: (path, flags) => nodeOpen(path, flags),
};

class CallFailure extends Error {
	constructor(
		readonly partial: {
			status: AgentCallStatus;
			delivery: DeliveryCertainty;
			pane?: string;
			state?: string;
			capture?: string;
			error: NonNullable<AgentCallResult["error"]>;
		},
	) {
		super(partial.error.message);
	}
}

function record(value: unknown): Json | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Json)
		: undefined;
}

function parseJson(text: string): Json | undefined {
	try {
		return record(JSON.parse(text));
	} catch {
		return undefined;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isMissingExecutable(error: unknown): boolean {
	return (error as { code?: unknown } | undefined)?.code === "ENOENT";
}

function stderrEnvelope(result: ExecResult): Json | undefined {
	return record(parseJson(result.stderr)?.error);
}

type Phase = "lookup" | "prompt" | "read";

/**
 * Runs one herdr CLI invocation and maps transport-level failures to call
 * results. Server rejections (exit 1 with a JSON envelope) are returned as-is
 * so the caller can map the upstream code by phase.
 */
async function runHerdr(
	deps: AgentCallDeps,
	args: string[],
	timeoutMs: number,
	signal: AbortSignal | undefined,
	phase: Phase,
): Promise<ExecResult> {
	if (timeoutMs <= 0 || Math.floor(timeoutMs) < 1) {
		throw new CallFailure({
			status: phase === "read" ? "read_failed" : "not_sent",
			delivery: phase === "read" ? "submitted" : "not_sent",
			...(phase === "read" ? { pane: args[2] } : {}),
			error: { code: "timeout", message: "Call budget exhausted." },
		});
	}
	let result: ExecResult;
	try {
		result = await deps.exec(deps.herdrBin, args, {
			timeout: Math.floor(timeoutMs),
			signal,
		});
	} catch (error) {
		if (phase === "read") {
			throw new CallFailure({
				status: "read_failed",
				delivery: "submitted",
				pane: args[2],
				error: {
					code: signal?.aborted ? "aborted" : "read_failed",
					message: signal?.aborted
						? "Answer read aborted; the prompt was already delivered."
						: `Prompt was delivered but the answer read failed: ${errorMessage(error)}`,
				},
			});
		}
		if (signal?.aborted) {
			throw new CallFailure({
				status: phase === "prompt" ? "uncertain" : "not_sent",
				delivery: phase === "prompt" ? "unknown" : "not_sent",
				error: { code: "aborted", message: "Call aborted." },
			});
		}
		throw new CallFailure({
			status: "not_sent",
			delivery: "not_sent",
			error: {
			code: "herdr_unavailable",
			message: isMissingExecutable(error)
				? `Herdr CLI is not available at ${deps.herdrBin}: ${errorMessage(error)}`
				: `Herdr CLI is unavailable: ${errorMessage(error)}`,
			},
		});
	}
	if (result.killed) {
		if (phase === "prompt") {
			throw new CallFailure({
				status: "uncertain",
				delivery: "unknown",
				error: {
					code: signal?.aborted ? "aborted" : "timeout",
					message: signal?.aborted
						? "Local wait aborted; the remote agent may still be running."
						: "Prompt wait timed out; submission state is unknown and the remote agent may still be running.",
				},
			});
		}
		throw new CallFailure({
			status: phase === "read" ? "read_failed" : "not_sent",
			delivery: phase === "read" ? "submitted" : "not_sent",
			...(phase === "read" ? { pane: args[2] } : {}),
			error: { code: "timeout", message: `Herdr ${args[1]} timed out.` },
		});
	}
	return result;
}

/** Maps an exit-1 stderr envelope for phases whose failures are always not_sent. */
function notSentEnvelope(result: ExecResult): CallFailure {
	const error = stderrEnvelope(result);
	const herdrCode = typeof error?.code === "string" ? error.code : undefined;
	const message =
		typeof error?.message === "string"
			? error.message
			: result.stderr.trim() || `exit ${result.code}`;
	if (herdrCode === "agent_not_found" || herdrCode === "pane_not_found") {
		return new CallFailure({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "target_not_found",
				message: `Herdr target not found: ${message}`,
				herdrCode,
				exitCode: result.code,
			},
		});
	}
	return new CallFailure({
		status: "not_sent",
		delivery: "not_sent",
		error: {
			code: "herdr_unavailable",
			message: `Herdr is unavailable: ${message}`,
			herdrCode,
			exitCode: result.code,
		},
	});
}

function usageFailure(result: ExecResult, phase: string): CallFailure {
	return new CallFailure({
		status: "not_sent",
		delivery: "not_sent",
		error: {
			code: "cli_usage",
			message: `Herdr ${phase} rejected the invocation (usage error); check the herdr version.`,
			exitCode: result.code,
		},
	});
}

/** Resolves an explicit pane ID directly, or a unique agent name via one `agent list`. */
async function resolveTargetPaneId(
	deps: AgentCallDeps,
	target: string,
	deadline: number,
	signal?: AbortSignal,
): Promise<{ paneId: string; agentKind?: string }> {
	if (PANE_ID.test(target)) return { paneId: target };
	const result = await runHerdr(
		deps,
		["agent", "list"],
		Math.min(LOOKUP_TIMEOUT_MS, deadline - (deps.now?.() ?? performance.now())),
		signal,
		"lookup",
	);
	if (result.code === 2) throw usageFailure(result, "agent list");
	if (result.code !== 0) throw notSentEnvelope(result);
	const agents = record(record(parseJson(result.stdout))?.result)?.agents;
	if (!Array.isArray(agents)) {
		throw new CallFailure({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "protocol_error",
				message: "Herdr agent list returned an invalid response.",
				exitCode: result.code,
			},
		});
	}
	const matches = agents
		.map(record)
		.filter((row) => row?.name === target);
	if (matches.length === 0) {
		throw new CallFailure({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "target_not_found",
				message: `No Herdr agent is named ${target}; pass an explicit pane ID.`,
			},
		});
	}
	if (matches.length > 1) {
		throw new CallFailure({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "target_ambiguous",
				message: `Herdr agent name ${target} matches ${matches.length} panes; pass an explicit pane ID.`,
			},
		});
	}
	const paneId = matches[0]?.pane_id;
	if (typeof paneId !== "string" || !paneId) {
		throw new CallFailure({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "protocol_error",
				message: "Herdr agent list entry has no pane ID.",
			},
		});
	}
	const agentKind = typeof matches[0]?.agent === "string" ? matches[0].agent : undefined;
	return { paneId, agentKind };
}

/** Lazy read-only `agent get` used only when the input box is an empty agy candidate and kind is not yet known. */
async function readAgentKind(
	deps: AgentCallDeps,
	paneId: string,
	budgetMs: number,
	deadline: number,
	signal?: AbortSignal,
): Promise<string | undefined> {
	const remaining = Math.min(
		LOOKUP_TIMEOUT_MS,
		budgetMs,
		deadline - (deps.now?.() ?? performance.now()),
	);
	if (Math.floor(remaining) < 1) return undefined;
	const result = await runHerdr(deps, ["agent", "get", paneId], remaining, signal, "lookup");
	if (result.code !== 0) return undefined;
	const response = record(record(parseJson(result.stdout))?.result);
	const agent = record(response?.agent);
	if (response?.type !== "agent_info" || agent?.pane_id !== paneId) return undefined;
	return typeof agent.agent === "string" ? agent.agent : undefined;
}

const AGENT_STATES = new Set([
	"idle",
	"working",
	"blocked",
	"done",
	"unknown",
]);

/** One pre-send `agent get`; validates the public envelope fields this call relies on. */
async function getPreflightAgent(
	deps: AgentCallDeps,
	paneId: string,
	deadline: number,
	signal?: AbortSignal,
	budgetMs = LOOKUP_TIMEOUT_MS,
): Promise<PreflightAgent> {
	const result = await runHerdr(
		deps,
		["agent", "get", paneId],
		Math.min(LOOKUP_TIMEOUT_MS, budgetMs, deadline - (deps.now?.() ?? performance.now())),
		signal,
		"lookup",
	);
	if (result.code === 2) throw usageFailure(result, "agent get");
	if (result.code !== 0) throw notSentEnvelope(result);
	const response = record(record(parseJson(result.stdout))?.result);
	const agent = record(response?.agent);
	if (
		response?.type !== "agent_info" ||
		typeof agent?.pane_id !== "string" ||
		!agent.pane_id ||
		typeof agent.terminal_id !== "string" ||
		!agent.terminal_id ||
		typeof agent.agent_status !== "string" ||
		!AGENT_STATES.has(agent.agent_status)
	) {
		throw new CallFailure({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "protocol_error",
				message: "Herdr agent get returned an invalid response.",
				exitCode: result.code,
			},
		});
	}
	const launchPending = agent.launch_pending;
	if (launchPending !== undefined && typeof launchPending !== "boolean") {
		throw new CallFailure({
			status: "not_sent",
			delivery: "not_sent",
			error: {
				code: "protocol_error",
				message: "Herdr agent get returned an invalid launch_pending value.",
				exitCode: result.code,
			},
		});
	}
	return {
		paneId: agent.pane_id,
		terminalId: agent.terminal_id,
		state: agent.agent_status as PreflightAgent["state"],
		launchPending: launchPending === true,
		focused: agent.focused === true,
		agentLabel: typeof agent.agent === "string" ? agent.agent : undefined,
	};
}

function markerInstruction(requestId: string): string {
	return (
		`\n\nAnswer with the exact token GJC_HERDR_BEGIN_${requestId} on the first line ` +
		`of your final answer and GJC_HERDR_END_${requestId} on the last line.`
	);
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

function isResultFileBudgetExpired(context?: ResultFileBudgetContext): boolean {
	if (context?.deadline === undefined) return false;
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
	context?: ResultFileBudgetContext,
): Promise<string | undefined> {
	if (!context) {
		try {
			await fsOps.lstat(resultFile);
			return `result_file already exists at ${resultFile}; use a new path for each call.`;
		} catch (error) {
			if (isMissingPath(error)) return undefined;
			return `Cannot inspect result_file ${resultFile}: ${errorMessage(error)}`;
		}
	}
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
	signal?: AbortSignal,
	context?: ResultFileBudgetContext,
): Promise<RecoveredResultFile> {
	if (!context) {
		if (signal?.aborted) return abortedResultFile();
		let handle: ResultFileHandle;
		try {
			handle = await fsOps.open(resultFile, RESULT_FILE_OPEN_FLAGS);
		} catch (error) {
			if (signal?.aborted) return abortedResultFile();
			if (isMissingPath(error)) {
				return {
					ok: false,
					code: "result_file_missing",
					message: `Result file was not created at ${resultFile}.`,
				};
			}
			return {
				ok: false,
				code: "result_file_invalid",
				message: `Result file at ${resultFile} could not be opened: ${errorMessage(error)}`,
			};
		}
		try {
			if (signal?.aborted) return abortedResultFile();
			let stat: ResultFileStat;
			try {
				stat = await handle.stat();
			} catch (error) {
				if (signal?.aborted) return abortedResultFile();
				return {
					ok: false,
					code: "result_file_invalid",
					message: `Result file at ${resultFile} could not be inspected: ${errorMessage(error)}`,
				};
			}
			if (signal?.aborted) return abortedResultFile();
			if (!stat.isFile()) {
				return {
					ok: false,
					code: "result_file_invalid",
					message: `Result file at ${resultFile} is not a regular file.`,
				};
			}
			if (stat.nlink !== 1) {
				return {
					ok: false,
					code: "result_file_invalid",
					message: `Result file at ${resultFile} must have link count 1 (got ${stat.nlink}).`,
				};
			}
			if (stat.size <= 0 || stat.size > MAX_RESULT_FILE_BYTES) {
				return {
					ok: false,
					code: "result_file_invalid",
					message:
						stat.size <= 0
							? `Result file at ${resultFile} is empty.`
							: `Result file at ${resultFile} exceeds the 1 MiB limit (${stat.size} bytes).`,
				};
			}
			const maxReadBytes = MAX_RESULT_FILE_BYTES + 1;
			const buffer = new Uint8Array(maxReadBytes);
			let totalBytes = 0;
			try {
				while (totalBytes < maxReadBytes) {
					if (signal?.aborted) return abortedResultFile();
					const { bytesRead, buffer: chunkBuffer } = await handle.read(
						buffer,
						totalBytes,
						maxReadBytes - totalBytes,
						totalBytes,
					);
					if (signal?.aborted) return abortedResultFile();
					if (bytesRead <= 0) break;
					if (chunkBuffer && chunkBuffer !== buffer) {
						const copyLen = Math.min(bytesRead, maxReadBytes - totalBytes);
						buffer.set(chunkBuffer.subarray(0, copyLen), totalBytes);
					}
					totalBytes += bytesRead;
				}
			} catch (error) {
				if (signal?.aborted) return abortedResultFile();
				return {
					ok: false,
					code: "result_file_invalid",
					message: `Result file at ${resultFile} could not be read: ${errorMessage(error)}`,
				};
			}
			if (signal?.aborted) return abortedResultFile();
			if (totalBytes <= 0 || totalBytes > MAX_RESULT_FILE_BYTES) {
				return {
					ok: false,
					code: "result_file_invalid",
					message:
						totalBytes <= 0
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
				if (signal?.aborted) return abortedResultFile();
				return {
					ok: false,
					code: "result_file_invalid",
					message: `Result file at ${resultFile} is not valid UTF-8: ${errorMessage(error)}`,
				};
			}
			if (signal?.aborted) return abortedResultFile();
			return { ok: true, answer };
		} finally {
			try {
				await handle.close();
			} catch {
				// Ignore close errors so the primary recovery verdict is preserved.
			}
		}
	}

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

function hasEndWithoutBegin(capture: string, requestId: string): boolean {
	const id = requestId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const prefix = "[\\s>⏺●•\\-*]*";
	const begin = new RegExp(`^${prefix}GJC_HERDR_BEGIN_${id}\\s*$`);
	const end = new RegExp(`^${prefix}GJC_HERDR_END_${id}\\s*$`);
	let hasEnd = false;
	for (const line of capture.split(/\r?\n/)) {
		if (begin.test(line)) return false;
		if (end.test(line)) hasEnd = true;
	}
	return hasEnd;
}

function stripDecorations(line: string): string {
	return line.replace(/^[\s>⏺●•\-*]+/, "").trim();
}

function isWrappedEchoBegin(lines: string[], index: number): boolean {
	const prev = lines
		.slice(Math.max(0, index - 2), index)
		.map(stripDecorations)
		.join(" ");
	const next = lines
		.slice(index + 1, index + 3)
		.map(stripDecorations)
		.join(" ");
	if (/\b(?:the\s+exact\s+|exact\s+)?token$/i.test(prev)) return true;
	if (/^(?:on\s+the\s+first\b|of\s+your\s+final\s+answer\b)/i.test(next)) return true;
	return false;
}

function isWrappedEchoEnd(lines: string[], index: number): boolean {
	const prev = lines
		.slice(Math.max(0, index - 2), index)
		.map(stripDecorations)
		.join(" ");
	const next = lines
		.slice(index + 1, index + 3)
		.map(stripDecorations)
		.join(" ");
	if (/\b(?:final\s+)?answer\s+and$/i.test(prev)) return true;
	if (/^on\s+the\s+last\b/i.test(next)) return true;
	return false;
}

/**
 * Extracts the answer between the anchored marker lines for this request.
 * Exactly one ordered pair with non-empty body qualifies; anything else is
 * undefined so the caller reports an unverified capture instead of guessing.
 */
export function extractMarkedAnswer(
	capture: string,
	requestId: string,
	options?: { rejectWrappedEcho?: boolean },
): string | undefined {
	const id = requestId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	// Terminal UIs decorate agent output lines (Claude Code prefixes "⏺ ",
	// quotes render "> "); whitespace and those glyphs are allowed before the
	// token. Word characters stay excluded so the echoed marker instruction
	// ("... token GJC_HERDR_BEGIN_x ...") can never satisfy the anchor.
	const prefix = "[\\s>⏺●•\\-*]*";
	const begin = new RegExp(`^${prefix}GJC_HERDR_BEGIN_${id}\\s*$`);
	const end = new RegExp(`^${prefix}GJC_HERDR_END_${id}\\s*$`);
	const lines = capture.split(/\r?\n/);
	const rejectEcho = options?.rejectWrappedEcho === true;
	let beginIndex = -1;
	let endIndex = -1;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (begin.test(line)) {
			if (rejectEcho && isWrappedEchoBegin(lines, index)) continue;
			if (beginIndex !== -1) return undefined;
			beginIndex = index;
		} else if (end.test(line)) {
			if (rejectEcho && isWrappedEchoEnd(lines, index)) continue;
			if (beginIndex === -1 || endIndex !== -1) return undefined;
			endIndex = index;
		}
	}
	if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
		return undefined;
	}
	const body = lines.slice(beginIndex + 1, endIndex);
	if (!body.some((line) => line.trim())) return undefined;
	if (rejectEcho) {
		const strippedLines = body.map(stripDecorations);
		const joinedBody = strippedLines.join(" ");
		const compactBody = strippedLines.join("");
		if (
			/Answer\s+with\s+the\s+exact\s+token/i.test(joinedBody) ||
			/on\s+the\s+first\s+line\s+of\s+your\s+final\s+answer/i.test(joinedBody) ||
			compactBody.includes(`GJC_HERDR_BEGIN_${requestId}`) ||
			compactBody.includes(`GJC_HERDR_END_${requestId}`)
		) {
			return undefined;
		}
	}
	// Strip the UI's uniform body indentation (Claude Code indents answer
	// lines under the bullet) while preserving relative formatting.
	const indents = body
		.filter((line) => line.trim())
		.map((line) => /^[ \t]*/.exec(line)![0]!);
	const common = indents.reduce((a, b) => (b.length < a.length ? b : a));
	return body.map((line) => line.slice(common.length)).join("\n");
}

function hasRequestEcho(
	capture: string,
	requestId: string,
	hasResultFile: boolean,
): boolean {
	const compact = capture
		.split(/\r?\n/)
		.map((line) => line.replace(/^[\s>❯⏺●•*]+/, "").trimEnd())
		.join("");
	if (compact.includes(`GJC_HERDR_BEGIN_${requestId}`)) return true;
	if (hasResultFile && compact.includes(requestId)) return true;
	return false;
}

/**
 * After a Herdr `timeout` envelope on `agent prompt --wait`, performs one bounded
 * `agent read --source recent` to check whether this request's marker instruction
 * was echoed on the target screen.
 */
async function confirmDeliveryAfterTimeout(
	deps: AgentCallDeps,
	paneId: string,
	requestId: string,
	hasResultFile: boolean,
	deadline: number,
	signal?: AbortSignal,
): Promise<boolean> {
	const remaining = Math.min(
		READ_TIMEOUT_MS,
		deadline - (deps.now?.() ?? performance.now()),
	);
	if (Math.floor(remaining) < 1 || signal?.aborted) return false;
	try {
		const read = await runHerdr(
			deps,
			["agent", "read", paneId, "--source", "recent", "--lines", READ_LINES],
			remaining,
			signal,
			"read",
		);
		if (signal?.aborted || read.code !== 0 || !read.stdout.trim()) return false;
		return hasRequestEcho(read.stdout, requestId, hasResultFile);
	} catch {
		return false;
	}
}

/** Maps the prompt exit-1 envelope; only codes verified in Herdr 0.9.3 sources get special handling. */
function promptFailure(
	result: ExecResult,
	agentLabel: string | undefined,
): CallFailure {
	const error = stderrEnvelope(result);
	const herdrCode = typeof error?.code === "string" ? error.code : undefined;
	const message =
		typeof error?.message === "string"
			? error.message
			: result.stderr.trim() || `exit ${result.code}`;
	const exitCode = result.code;
	switch (herdrCode) {
		case "agent_not_ready":
			return new CallFailure({
				status: "not_sent",
				delivery: "not_sent",
				error: {
					code: "target_not_ready",
					message:
						`Herdr rejected the prompt before any input: ${message}` +
						(agentLabel === "gjc"
							? " (Target looks like a GJC session; use herdr_send for those.)"
							: ""),
					herdrCode,
					exitCode,
				},
			});
		case "agent_blocked":
			return new CallFailure({
				status: "blocked",
				delivery: "not_sent",
				error: {
					code: "agent_blocked",
					message: `Target is blocked waiting for a user decision; no input was sent: ${message}`,
					herdrCode,
					exitCode,
				},
			});
		case "agent_not_found":
		case "pane_not_found":
			return new CallFailure({
				status: "not_sent",
				delivery: "not_sent",
				error: {
					code: "target_not_found",
					message: `Herdr target not found at prompt time: ${message}`,
					herdrCode,
					exitCode,
				},
			});
		case "agent_prompt_stalled":
			return new CallFailure({
				status: "stalled",
				delivery: "submitted",
				error: {
					code: "agent_prompt_stalled",
					message:
						`Prompt was submitted but no agent activity was observed: ${message}`,
					herdrCode,
					exitCode,
				},
			});
		case "timeout":
			return new CallFailure({
				status: "uncertain",
				delivery: "unknown",
				error: {
					code: "timeout",
					message:
						`Prompt wait timed out; submission state is unknown and the remote agent may still be running: ${message}`,
					herdrCode,
					exitCode,
				},
			});
		default:
			return new CallFailure({
				status: "uncertain",
				delivery: "unknown",
				error: {
					code: "prompt_failed",
					message: `Prompt failed after possible submission: ${message}`,
					herdrCode,
					exitCode,
				},
			});
	}
}

/**
 * Calls a Herdr-registered agent in another pane and recovers its answer:
 * resolve target -> preflight state gate -> one `agent prompt --wait` ->
 * one plain-stdout `agent read` -> anchored marker extraction.
 */
export async function callRegisteredAgent(
	deps: AgentCallDeps,
	request: AgentCallRequest,
	senderPane: string | undefined,
	signal?: AbortSignal,
): Promise<AgentCallResult> {
	if (deps.backend === "hc") {
		return callViaHc(deps, request, signal);
	}
	const now = deps.now ?? (() => performance.now());
	const startedAt = now();
	let deadline = startedAt + CALL_BUDGET_MS;
	let waitedMs = 0;
	const requestId = randomUUID();
	const rawResultFile = request.resultFile ?? request.result_file;
	const finish = (
		partial: Partial<AgentCallResult> & { status: AgentCallStatus; delivery: DeliveryCertainty },
	): AgentCallResult => ({
		ok: false,
		requestId,
		elapsedMs: now() - startedAt,
		...(waitedMs > 0 ? { waitedMs } : {}),
		...(rawResultFile !== undefined ? { resultFile: rawResultFile } : {}),
		...partial,
	});

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
				message: "Target must be a pane ID or agent name, not an option.",
			},
		});
	}
	if (!request.text.trim()) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: { code: "invalid_request", message: "Prompt text must not be empty." },
		});
	}
	if (
		rawResultFile !== undefined &&
		(!rawResultFile ||
			!rawResultFile.trim() ||
			rawResultFile !== rawResultFile.trim() ||
			/[\0\r\n]/.test(rawResultFile) ||
			!isAbsolute(rawResultFile))
	) {
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
	if (signal?.aborted) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: { code: "aborted", message: "Call aborted before delivery." },
		});
	}

	const fsOps = deps.fs ?? defaultFs;
	if (rawResultFile !== undefined) {
		const fileConflict = await checkResultFileAbsent(fsOps, rawResultFile);
		if (signal?.aborted) {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				error: { code: "aborted", message: "Call aborted before delivery." },
			});
		}
		if (fileConflict !== undefined) {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				error: {
					code: "invalid_request",
					message: fileConflict,
				},
			});
		}
	}

	try {
		const { paneId, agentKind } = await resolveTargetPaneId(deps, target, deadline, signal);
		if (paneId === senderPane) {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				pane: paneId,
				error: {
					code: "self_target",
					message: "Cannot call the current Herdr pane.",
				},
			});
		}
		if (deps.inFlight.has(paneId)) {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				pane: paneId,
				error: {
					code: "target_busy",
					message: "Another call to this pane is already in flight here.",
				},
			});
		}
		deps.inFlight.add(paneId);
		try {
			// Waiting for a temporarily unready target (typing, focused unknown input box, or working)
			// does not eat the 60 s call budget. All waits share one maxWaitMs cap.
			const maxWaitMs = deps.inputWaitMs ?? inputWaitMs();
			const sleep =
				deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
			const baseDeadline = deadline;
			let initialGuardWaitedMs = 0;
			let firstSleepStart: number | undefined;
			let waitDeadline = 0;
			let knownKind = agentKind;
			let lastUnready:
				| { state: PreflightAgent["state"]; focusedUnknown: boolean }
				| undefined;
			const syncWait = () => {
				waitedMs =
					initialGuardWaitedMs +
					(firstSleepStart !== undefined ? Math.max(0, now() - firstSleepStart) : 0);
				deadline = baseDeadline + waitedMs;
			};
			const finishUnready = (
				state: PreflightAgent["state"],
				focusedUnknown: boolean,
			): AgentCallResult => {
				syncWait();
				if (focusedUnknown) {
					return finish({
						status: "not_sent",
						delivery: "not_sent",
						pane: paneId,
						state,
						error: {
							code: "target_focused",
							message: `Target input box could not be read and the pane is focused by a person who may be typing after ${Math.round(waitedMs / 1000)}s; not sent. Retry later.`,
						},
					});
				}
				return finish({
					status: "not_sent",
					delivery: "not_sent",
					pane: paneId,
					state,
					error: {
						code: "target_busy",
						message: `Target agent is still working after ${Math.round(waitedMs / 1000)}s; not sent. Retry later.`,
					},
				});
			};
			let preflight: PreflightAgent;
			for (;;) {
				const retrying = firstSleepStart !== undefined;
				let paneReads = 0;
				let lastPaneScreen: string | undefined;
				let kindLookupFailed = false;
				const guard = await waitForEmptyInput(
					{
						exec: async (command, args, options) => {
							if (args[0] === "pane" && args[1] === "read") paneReads++;
							const res = await deps.exec(command, args, options);
							if (
								args[0] === "pane" &&
								args[1] === "read" &&
								!res.killed &&
								res.code === 0
							) {
								lastPaneScreen = res.stdout;
							}
							return res;
						},
						herdrBin: deps.herdrBin,
						sleep: deps.sleep,
						now,
						agentKind: async (budgetMs, s, waited = 0) => {
							if (knownKind !== undefined) return knownKind;
							const kindBudget = retrying
								? Math.min(budgetMs, waitDeadline - now())
								: budgetMs;
							const resolved = await readAgentKind(
								deps,
								paneId,
								kindBudget,
								deadline + (retrying ? 0 : waited),
								s,
							);
							if (resolved !== undefined) knownKind = resolved;
							else kindLookupFailed = true;
							return resolved;
						},
					},
					paneId,
					retrying ? waitDeadline - now() : maxWaitMs,
					signal,
					knownKind,
				);
				if (!retrying) initialGuardWaitedMs = guard.waitedMs;
				syncWait();
				if (signal?.aborted) {
					return finish({
						status: "not_sent",
						delivery: "not_sent",
						pane: paneId,
						error: { code: "aborted", message: "Call aborted before delivery." },
					});
				}
				if (guard.state === "typing") {
					const agyKindExhausted =
						retrying &&
						knownKind === undefined &&
						lastPaneScreen !== undefined &&
						classifyInput(lastPaneScreen, "agy") === "empty" &&
						(kindLookupFailed || waitDeadline - now() < 1);
					if (retrying && lastUnready && (paneReads === 0 || agyKindExhausted)) {
						return finishUnready(lastUnready.state, lastUnready.focusedUnknown);
					}
					return finish({
						status: "not_sent",
						delivery: "not_sent",
						pane: paneId,
						error: {
							code: "target_typing",
							message: `Target input box still has text after ${Math.round(waitedMs / 1000)}s; not sent. Retry later.`,
						},
					});
				}
				if (retrying && Math.floor(waitDeadline - now()) < 1 && lastUnready) {
					return finishUnready(lastUnready.state, lastUnready.focusedUnknown);
				}
				try {
					preflight = await getPreflightAgent(
						deps,
						paneId,
						deadline,
						signal,
						retrying ? waitDeadline - now() : LOOKUP_TIMEOUT_MS,
					);
				} catch (error) {
					syncWait();
					if (
						retrying &&
						lastUnready &&
						error instanceof CallFailure &&
						error.partial.error?.code === "timeout" &&
						now() >= waitDeadline
					) {
						return finishUnready(lastUnready.state, lastUnready.focusedUnknown);
					}
					throw error;
				}
				syncWait();
				knownKind ??= preflight.agentLabel;
				if (preflight.paneId !== paneId) {
					return finish({
						status: "not_sent",
						delivery: "not_sent",
						pane: paneId,
						error: {
							code: "protocol_error",
							message: "Herdr agent get returned a different pane than requested.",
						},
					});
				}
				if (preflight.launchPending) {
					return finish({
						status: "not_sent",
						delivery: "not_sent",
						pane: paneId,
						state: preflight.state,
						error: {
							code: "target_not_ready",
							message: "Target agent launch is still pending.",
						},
					});
				}
				if (preflight.state === "blocked") {
					return finish({
						status: "blocked",
						delivery: "not_sent",
						pane: paneId,
						state: preflight.state,
						error: {
							code: "agent_blocked",
							message:
								"Target is blocked waiting for a user decision; no input was sent.",
						},
					});
				}
				if (preflight.state === "unknown") {
					return finish({
						status: "not_sent",
						delivery: "not_sent",
						pane: paneId,
						state: preflight.state,
						error: {
							code: "target_state_unknown",
							message: "Target agent state is unknown; not prompted.",
						},
					});
				}
				const focusedUnknown = guard.state === "unknown" && preflight.focused;
				const busy = preflight.state === "working";
				if (!focusedUnknown && !busy) {
					if (retrying && now() > waitDeadline && lastUnready) {
						return finishUnready(lastUnready.state, lastUnready.focusedUnknown);
					}
					break;
				}

				lastUnready = { state: preflight.state, focusedUnknown };
				if (firstSleepStart === undefined) {
					if (maxWaitMs - initialGuardWaitedMs < 1) {
						return finishUnready(preflight.state, focusedUnknown);
					}
					firstSleepStart = now();
					waitDeadline = firstSleepStart + (maxWaitMs - initialGuardWaitedMs);
				}
				const remainingBeforeSleep = waitDeadline - now();
				if (remainingBeforeSleep >= 1) {
					await sleep(Math.min(POLL_INTERVAL_MS, remainingBeforeSleep));
					syncWait();
					if (signal?.aborted) {
						return finish({
							status: "not_sent",
							delivery: "not_sent",
							pane: paneId,
							error: { code: "aborted", message: "Call aborted before delivery." },
						});
					}
					if (waitDeadline - now() >= MIN_RECHECK_MS) continue;
				}
				return finishUnready(preflight.state, focusedUnknown);
			}

			if (rawResultFile !== undefined) {
				const fileConflict = await checkResultFileAbsent(fsOps, rawResultFile);
				if (signal?.aborted) {
					return finish({
						status: "not_sent",
						delivery: "not_sent",
						pane: paneId,
						state: preflight.state,
						error: { code: "aborted", message: "Call aborted before delivery." },
					});
				}
				if (fileConflict !== undefined) {
					return finish({
						status: "not_sent",
						delivery: "not_sent",
						pane: paneId,
						state: preflight.state,
						error: {
							code: "invalid_request",
							message: fileConflict,
						},
					});
				}
			}

			const promptBudget = Math.floor(deadline - now() - READ_RESERVE_MS);
			if (promptBudget <= 0) {
				return finish({
					status: "not_sent",
					delivery: "not_sent",
					pane: paneId,
					state: preflight.state,
					error: {
						code: "timeout",
						message: "Call budget exhausted before the prompt.",
					},
				});
			}
			const patchedText =
				request.text +
				(rawResultFile !== undefined
					? resultFileInstruction(requestId, rawResultFile)
					: markerInstruction(requestId));
			const promptArgs = [
				"agent",
				"prompt",
				paneId,
				patchedText,
				"--wait",
				"--timeout",
				String(promptBudget),
			] as const;
			const prompt = await runHerdr(
				deps,
				[...promptArgs],
				deadline - now(),
				signal,
				"prompt",
			);
			if (prompt.code === 2) throw usageFailure(prompt, "agent prompt");
			if (prompt.code !== 0) {
				if (prompt.code === 1 && stderrEnvelope(prompt)?.code === "timeout") {
					const delivered = await confirmDeliveryAfterTimeout(
						deps,
						paneId,
						requestId,
						rawResultFile !== undefined,
						deadline,
						signal,
					);
					if (delivered) {
						return finish({
							status: "answer_pending",
							delivery: "submitted",
							pane: paneId,
							error: {
								code: "answer_timeout",
								message:
									"Prompt was delivered (this request's marker instruction is on the target screen) but no answer arrived within the call budget; the target may still be answering. Do not resend; check the target or ask it to reply again later.",
								herdrCode: "timeout",
								exitCode: prompt.code,
							},
						});
					}
				}
				throw promptFailure(prompt, preflight.agentLabel);
			}
			const response = record(record(parseJson(prompt.stdout))?.result);
			const agent = record(response?.agent);
			if (
				response?.type !== "agent_prompted" ||
				typeof agent?.agent_status !== "string" ||
				!AGENT_STATES.has(agent.agent_status) ||
				agent.pane_id !== paneId ||
				agent.terminal_id !== preflight.terminalId
			) {
				return finish({
					status: "uncertain",
					delivery: "unknown",
					pane: paneId,
					error: {
						code: "protocol_error",
						message:
							"Prompt response did not confirm the expected pane; answer recovery skipped.",
						exitCode: prompt.code,
					},
				});
			}
			const settled = agent.agent_status as PreflightAgent["state"];
			if (settled === "blocked") {
				return finish({
					status: "blocked",
					delivery: "submitted",
					pane: paneId,
					state: settled,
					error: {
						code: "agent_blocked",
						message:
							"Target is now blocked waiting for a user decision; answer recovery skipped.",
					},
				});
			}
			if (settled !== "idle" && settled !== "done") {
				return finish({
					status: "uncertain",
					delivery: "unknown",
					pane: paneId,
					state: settled,
					error: {
						code: "protocol_error",
						message: `Prompt settled in unexpected state ${settled}.`,
					},
				});
			}

			const readRemaining = deadline - now();
			if (readRemaining <= 0) {
				return finish({
					status: "uncertain",
					delivery: "submitted",
					pane: paneId,
					state: settled,
					error: {
						code: "timeout",
						message: "Prompt settled but no read budget remained.",
					},
				});
			}
			if (rawResultFile !== undefined) {
				let capture: string | undefined;
				let screenError: string | undefined;
				let screenErrorMeta: { herdrCode?: string; exitCode?: number } | undefined;
				try {
					const read = await runHerdr(
						deps,
						["agent", "read", paneId, "--source", "recent-unwrapped", "--lines", READ_LINES],
						Math.min(READ_TIMEOUT_MS, readRemaining),
						signal,
						"read",
					);
					if (read.code === 0) {
						capture = read.stdout;
					} else {
						const error = stderrEnvelope(read);
						const detail =
							typeof error?.message === "string"
								? error.message
								: read.stderr.trim() || `exit ${read.code}`;
						screenError = `screen read failed: ${detail}`;
						screenErrorMeta = {
							herdrCode: typeof error?.code === "string" ? error.code : undefined,
							exitCode: read.code,
						};
					}
				} catch (error) {
					if (
						signal?.aborted ||
						(error instanceof CallFailure && error.partial.error.code === "aborted")
					) {
						throw error;
					}
					const detail =
						error instanceof CallFailure
							? error.partial.error.message
							: errorMessage(error);
					screenError = `screen read failed: ${detail}`;
				}
				const marked =
					capture !== undefined ? extractMarkedAnswer(capture, requestId) : undefined;
				const markerVerified =
					marked !== undefined && marked.trim() === rawResultFile;
				const recovered = await recoverResultFile(fsOps, rawResultFile, signal);
				if (signal?.aborted || (!recovered.ok && recovered.code === "aborted")) {
					return finish({
						status: "read_failed",
						delivery: "submitted",
						pane: paneId,
						state: settled,
						error: {
							code: "aborted",
							message: "Answer read aborted; the prompt was already delivered.",
						},
					});
				}
				if (!recovered.ok) {
					return finish({
						status: "response_unverified",
						delivery: "submitted",
						pane: paneId,
						state: settled,
						...(capture !== undefined ? { capture } : {}),
						error: {
							code: recovered.code,
							message: screenError
								? `${recovered.message} (${screenError})`
								: recovered.message,
							...screenErrorMeta,
						},
					});
				}
				return {
					ok: true,
					status: "answered",
					delivery: "submitted",
					requestId,
					pane: paneId,
					state: settled,
					answer: recovered.answer,
					resultFile: rawResultFile,
					markerVerified,
					elapsedMs: now() - startedAt,
					...(waitedMs > 0 ? { waitedMs } : {}),
				};
			}
			const read = await runHerdr(
				deps,
				["agent", "read", paneId, "--source", "recent-unwrapped", "--lines", READ_LINES],
				Math.min(READ_TIMEOUT_MS, readRemaining),
				signal,
				"read",
			);
			if (read.code !== 0) {
				const error = stderrEnvelope(read);
				return finish({
					status: "read_failed",
					delivery: "submitted",
					pane: paneId,
					state: settled,
					error: {
						code: "read_failed",
						message: `Prompt was delivered but the answer read failed: ${
							typeof error?.message === "string"
								? error.message
								: read.stderr.trim() || `exit ${read.code}`
						}`,
						herdrCode: typeof error?.code === "string" ? error.code : undefined,
						exitCode: read.code,
					},
				});
			}
			const capture = read.stdout;
			if (!capture.trim()) {
				return finish({
					status: "response_unverified",
					delivery: "submitted",
					pane: paneId,
					state: settled,
					error: {
						code: "empty_response",
						message: "Target read returned empty output.",
					},
				});
			}
			let answer = extractMarkedAnswer(capture, requestId);
			if (answer === undefined && hasEndWithoutBegin(capture, requestId)) {
				const retryRemaining = deadline - now();
				const retryBudget = Math.min(READ_TIMEOUT_MS, retryRemaining);
				if (Math.floor(retryBudget) >= 1 && !signal?.aborted) {
					try {
						const retryRead = await runHerdr(
							deps,
							["agent", "read", paneId, "--source", "recent", "--lines", READ_LINES],
							retryBudget,
							signal,
							"read",
						);
						if (retryRead.code === 0 && retryRead.stdout.trim()) {
							answer = extractMarkedAnswer(retryRead.stdout, requestId, {
								rejectWrappedEcho: true,
							});
						}
					} catch (error) {
						if (
							signal?.aborted ||
							(error instanceof CallFailure && error.partial.error.code === "aborted")
						) {
							throw error;
						}
					}
				}
			}
			if (answer === undefined) {
				return finish({
					status: "response_unverified",
					delivery: "submitted",
					pane: paneId,
					state: settled,
					capture,
					error: {
						code: "response_unverified",
						message:
							"Answer markers for this request were not found in the captured screen; the capture below is unverified target output.",
					},
				});
			}
			return {
				ok: true,
				status: "answered",
				delivery: "submitted",
				requestId,
				pane: paneId,
				state: settled,
				answer,
				elapsedMs: now() - startedAt,
				...(waitedMs > 0 ? { waitedMs } : {}),
			};
		} finally {
			deps.inFlight.delete(paneId);
		}
	} catch (error) {
		if (error instanceof CallFailure) {
			return finish(error.partial);
		}
		return finish({
			status: "uncertain",
			delivery: "unknown",
			error: {
				code: "prompt_failed",
				message: errorMessage(error),
			},
		});
	}
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
	if (result.ok && result.status === "answered") {
		return `${header}\n\n${result.answer}`;
	}
	const parts = [header];
	if (result.error) {
		parts.push(
			`${result.error.message}${result.error.herdrCode ? ` (herdr ${result.error.herdrCode})` : ""}`,
		);
	}
	if (result.capture !== undefined) {
		parts.push(`Unverified capture (partial target screen, not a confirmed answer):\n${result.capture}`);
	}
	return parts.join("\n");
}

export interface RegisterCallOptions {
	backend?: "herdr" | "hc";
	hcBin?: string;
	hcCallerId?: string;
}

export const HC_CALL_BACKEND_NOTE =
	"hc: unattended target assumed (not verified by the plugin); a target left in done cannot take a follow-up automatically; text delivery only, no GJC session token";

export function registerCallFeatures(
	api: ExtensionAPI,
	herdrBin: string,
	senderPane: string | undefined,
	options?: RegisterCallOptions,
): void {
	const resolvedOptions: RegisterCallOptions = options ?? {};
	const isHc = resolvedOptions.backend === "hc";
	const deps: AgentCallDeps = {
		exec: api.exec.bind(api),
		herdrBin,
		inFlight: new Set<string>(),
		...(resolvedOptions.backend !== undefined
			? { backend: resolvedOptions.backend }
			: {}),
		...(resolvedOptions.hcBin !== undefined
			? { hcBin: resolvedOptions.hcBin }
			: {}),
		...(resolvedOptions.hcCallerId !== undefined
			? { hcCallerId: resolvedOptions.hcCallerId }
			: {}),
	};

	function summarize(result: AgentCallResult): void {
		if (deps.backend === "hc") {
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
			return;
		}
		api.logger.info("herdr-call finished", {
			requestId: result.requestId,
			pane: result.pane,
			status: result.status,
			delivery: result.delivery,
			elapsedMs: result.elapsedMs,
			code: result.error?.code,
			resultFile: result.resultFile,
			markerVerified: result.markerVerified,
		});
	}

	const commandDescription = isHc
		? "Call an hc terminal agent in another local terminal and recover its answer from --result-file: --result-file <abs-path> <terminal-id-or-unique-name> <text> " +
			`(--result-file required, idle targets only, local address only, no screen read; ${HC_CALL_BACKEND_NOTE})`
		: "Call a Herdr-registered agent in another pane and get its answer back: [--result-file <abs-path>] <pane-id-or-unique-agent-name> <text> " +
			`(Herdr backend uses screen markers or optional --result-file; when running on hc: --result-file required, idle targets only, local address only, no screen read; ${HC_CALL_BACKEND_NOTE})`;

	const toolDescription = isHc
		? "Call an hc terminal agent in another local terminal and recover its answer text from `result_file` (60s total budget, 5s reserved for file recovery). " +
			"`target` must be an explicit local hc terminal ID (e.g. t2) or a name that resolves to exactly one terminal, and `result_file` is required (--result-file required, idle targets only, local address only, no screen read). " +
			`${HC_CALL_BACKEND_NOTE}. ` +
			"No remote approvals, key presses, or retries are ever sent."
		: "Call a Herdr-registered agent (Claude Code, Codex, Copilot, Gemini, ...) in another Herdr pane and get its answer text back. " +
			"`target` must be an explicit Herdr pane ID or a name that resolves to exactly one agent; the target must be observed idle/done, " +
			"and Herdr's own known-agent/foreground gate decides finally whether the prompt is sent (zero input on rejection). " +
			"One prompt with a bounded wait (60s total budget) and bounded 200-line screen reads (initial unwrapped read, at most one --source recent retry if only the end marker is visible, or one confirmation read after a prompt timeout); the answer is recovered from " +
			"per-request marker lines, or from `result_file` when a new absolute file path is provided (must not already exist before sending; resilient to long answers and folded/truncated terminal output; the target agent must be able to write to that path, e.g. inside the repository for sandboxed agy). " +
			"Anything less is returned as an unverified capture instead of a success. " +
			"No remote approvals, key presses, or retries are ever sent. For GJC targets use the existing herdr_send tool instead. " +
			`(When running on hc instead of Herdr: --result-file required, idle targets only, local address only, no screen read; ${HC_CALL_BACKEND_NOTE})`;

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
					: await callRegisteredAgent(deps, request, senderPane);
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
				.describe(
					isHc
						? "Target local hc terminal ID (e.g. t2) or unique terminal name"
						: "Target Herdr pane ID (e.g. wC:p2) or unique agent name",
				),
			text: z
				.string()
				.describe(
					isHc
						? "Prompt text to deliver verbatim (must not start with '-')"
						: "Prompt text to deliver verbatim",
				),
			result_file: z
				.string()
				.optional()
				.describe(
					isHc
						? "Required on hc: new local absolute path (must not exist before sending) where the target agent writes its full answer"
						: "Optional new absolute path (must not exist before sending) where the target agent writes its full answer (resilient to long output or screen folding; target agent must have write access, e.g. inside the workspace for sandboxed agy)",
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
				senderPane,
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
 * inFlight -> preflight `hc get` (live, reported===true, status.state==="idle") ->
 * pre-send result-file re-check -> `hc send --json --if idle --wait --timeout` ->
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
		if (facts.statusState === "done") {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				pane: addr,
				state: "done",
				error: {
					code: "agent_done",
					message: "target finished its last turn; a new turn needs idle",
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
		if (facts.statusState !== "idle") {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				pane: addr,
				...(facts.statusState ? { state: facts.statusState } : {}),
				error: {
					code: "agent_state_unknown",
					message: "Target agent state is not idle; no input was sent.",
				},
			});
		}

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
				state: "idle",
				error: { code: "aborted", message: "Call aborted before delivery." },
			});
		}
		if (preSendConflict === "timeout") {
			return finish({
				status: "not_sent",
				delivery: "not_sent",
				pane: addr,
				state: "idle",
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
				state: "idle",
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
				state: "idle",
				error: {
					code: "timeout",
					message: "Call budget exhausted before hc send.",
				},
			});
		}
		const sendTimeoutSec = Math.max(1, Math.ceil(sendRemMs / 1000));
		const sent = await hcSend(
			hcDeps,
			addr,
			patchedText,
			{ wait: true, timeoutSec: sendTimeoutSec },
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
			elapsedMs: now() - startedAt,
		};
	} finally {
		deps.inFlight.delete(addr);
	}
}
