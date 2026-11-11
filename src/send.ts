import type {
	ExtensionAPI,
	ExtensionContext,
	ExecResult,
} from "@gajae-code/coding-agent";
import {
	HC_ERROR_SPECS,
	HC_NAME_RE,
	hcResolveTarget,
	hcSend,
	isSelf,
	isValidHcAddress,
	type HcExecDeps,
} from "./hc.ts";
import { inputWaitMs, waitForEmptyInput } from "./input.ts";
import { SESSION_ID_KEY } from "./metadata.ts";

type Exec = ExtensionAPI["exec"];
type Json = Record<string, unknown>;

const HERDR_TIMEOUT_MS = 3_000;
const LIST_TIMEOUT_MS = 15_000;
const SEND_TIMEOUT_MS = 30_000;
const WAIT_CLI_TIMEOUT_MS = 30_000;
const WAIT_TIMEOUT_MS = 60_000;
const PANE_ID = /^w[^:\s]+:p[^:\s]+$/;
const POLL_INTERVAL_MS = 2_000;
const MIN_RECHECK_MS = 1_000;

export const USAGE = "Usage: /herdr-send [--wait|--raw] <pane> <text>";
export const GJC_NOT_FOUND = "gjc CLI not found on PATH";
export const HC_SEND_NOTE =
	"hc: text delivery only; no GJC session token; idle targets only";

export interface SendRequest {
	pane: string;
	text: string;
	wait?: boolean;
	raw?: boolean;
}

export interface HcSendWaited {
	reason: string;
	status: string | null;
	ended: boolean;
	turn: number;
	exitCode?: number | null;
	signal?: number | null;
}

export interface SendResult {
	ok: boolean;
	mode: "sdk" | "raw" | "hc";
	/**
	 * not_sent: nothing was delivered. uncertain: the prompt may have been accepted.
	 * accepted/terminal_ok/failed: GJC SDK outcome. raw_written/raw_partial: pane input outcome.
	 * sent: hc text delivery confirmed (turn returned).
	 */
	status:
		| "not_sent"
		| "uncertain"
		| "accepted"
		| "terminal_ok"
		| "failed"
		| "raw_written"
		| "raw_partial"
		| "sent";
	pane?: string;
	sessionId?: string;
	operationRef?: string;
	error?: string;
	/** Time spent waiting for the target's input box to empty; omitted when it did not wait. */
	waitedMs?: number;
	/** Wait outcome on hc when `--wait` was requested; separated from delivery (`status: "sent"`). */
	waited?: HcSendWaited;
}

export interface SendDeps {
	exec: Exec;
	herdrBin: string;
	backend?: "herdr" | "hc";
	hcBin?: string;
	hcCallerId?: string;
	/** Test seam for the input-box wait; defaults to a real timer. */
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	/** Max wait for a typed-in input box; defaults to GJC_HERDR_INPUT_WAIT_SEC (60 s). */
	inputWaitMs?: number;
}

export interface Sender {
	sessionId: string;
	pane?: string;
}

export interface TargetPane {
	paneId: string;
	tokens: Json;
	agent?: string;
	agentStatus?: string;
	focused?: boolean;
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

async function herdrJson(
	deps: SendDeps,
	args: string[],
	target: string,
	timeoutMs = HERDR_TIMEOUT_MS,
): Promise<Json> {
	const operation = `${args[0]} ${args[1]}`;
	const timeout = Math.floor(timeoutMs);
	if (timeout < 1) {
		throw new Error(`Herdr is unavailable: ${operation} timed out`);
	}
	let result: ExecResult;
	try {
		result = await deps.exec(deps.herdrBin, args, {
			timeout,
		});
	} catch (error) {
		throw new Error(`Herdr is unavailable: ${errorMessage(error)}`);
	}
	if (result.killed) {
		throw new Error(`Herdr is unavailable: ${operation} timed out`);
	}
	if (result.code !== 0) {
		const error = record(parseJson(result.stderr)?.error);
		const reason =
			typeof error?.message === "string"
				? error.message
				: result.stderr.trim() || `exit ${result.code}`;
		if (error?.code === "pane_not_found" || error?.code === "agent_not_found") {
			throw new Error(`Herdr target not found: ${target}.`);
		}
		if (args[1] === "process-info") {
			throw new Error(
				`Herdr process-info failed for pane ${target}: ${reason}`,
			);
		}
		throw new Error(`Herdr is unavailable: ${reason}`);
	}
	const data = parseJson(result.stdout);
	if (!data) throw new Error(`Herdr ${operation} returned an invalid response.`);
	return data;
}

/** Resolves a canonical pane ID or a Herdr agent name to the pane Herdr reports. */
export async function resolveTargetPane(
	deps: SendDeps,
	target: string,
	timeoutMs?: number,
): Promise<TargetPane> {
	const now = deps.now ?? (() => performance.now());
	const deadline = timeoutMs !== undefined ? now() + timeoutMs : undefined;
	const stepTimeout = () =>
		deadline !== undefined
			? Math.min(HERDR_TIMEOUT_MS, deadline - now())
			: HERDR_TIMEOUT_MS;
	let paneId = target;
	if (!PANE_ID.test(target)) {
		const agent = record(
			record(
				(await herdrJson(deps, ["agent", "get", target], target, stepTimeout()))
					.result,
			)?.agent,
		);
		if (typeof agent?.pane_id !== "string" || !agent.pane_id) {
			throw new Error("Herdr agent get returned an invalid response.");
		}
		paneId = agent.pane_id;
	}
	const pane = record(
		record(
			(await herdrJson(deps, ["pane", "get", paneId], target, stepTimeout()))
				.result,
		)?.pane,
	);
	if (typeof pane?.pane_id !== "string" || !pane.pane_id) {
		throw new Error("Herdr pane get returned an invalid response.");
	}
	return {
		paneId: pane.pane_id,
		tokens: record(pane.tokens) ?? {},
		agent: typeof pane.agent === "string" ? pane.agent : undefined,
		agentStatus:
			typeof pane.agent_status === "string" ? pane.agent_status : undefined,
		focused: pane.focused === true,
	};
}

/**
 * Uses the receiver's published session ID token. Without it, matches the pane's
 * foreground PIDs against live sessions in the default (sender repo) list scope.
 */
export async function resolveTargetSession(
	deps: SendDeps,
	pane: TargetPane,
): Promise<string> {
	const token = pane.tokens[SESSION_ID_KEY];
	if (typeof token === "string" && token) return token;

	const info = record(
		record(
			(
				await herdrJson(
					deps,
					["pane", "process-info", "--pane", pane.paneId],
					pane.paneId,
				)
			).result,
		)?.process_info,
	);
	const processes = info?.foreground_processes;
	if (!Array.isArray(processes)) {
		throw new Error("Herdr pane process-info returned an invalid response.");
	}
	const pids = new Set(
		processes
			.map((entry) => record(entry)?.pid)
			.filter(
				(pid): pid is number => Number.isSafeInteger(pid) && Number(pid) > 0,
			),
	);

	let result: ExecResult;
	try {
		result = await deps.exec("gjc", ["sdk", "session", "list", "--json"], {
			timeout: LIST_TIMEOUT_MS,
		});
	} catch (error) {
		throw new Error(
			isMissingExecutable(error)
				? GJC_NOT_FOUND
				: `GJC session list failed: ${errorMessage(error)}`,
		);
	}
	if (result.killed) throw new Error("GJC session list failed: timed out");
	const body = parseJson(result.stdout);
	if (result.code !== 0 || body?.ok === false) {
		const error = record(body?.error);
		if (!error) {
			if (result.code !== 0) throw new Error(GJC_NOT_FOUND);
			throw new Error("GJC session list returned an invalid response.");
		}
		throw new Error(`GJC session list failed: ${String(error.message)}`);
	}
	const sessions = record(body?.result)?.sessions;
	if (!Array.isArray(sessions)) {
		throw new Error("GJC session list returned an invalid response.");
	}
	const matches = sessions
		.map(record)
		.filter(
			(row): row is Json =>
				row?.live === true &&
				typeof row.sessionId === "string" &&
				pids.has(row.pid as number),
		);
	if (matches.length === 0) {
		throw new Error(`No live GJC session found for pane ${pane.paneId}.`);
	}
	if (matches.length > 1) {
		throw new Error(`Multiple live GJC sessions found for pane ${pane.paneId}.`);
	}
	return matches[0].sessionId as string;
}

/** One official `gjc sdk session send`; never retried or replayed. */
export async function sendSessionPrompt(
	exec: Exec,
	sessionId: string,
	text: string,
	wait: boolean,
	signal?: AbortSignal,
): Promise<SendResult> {
	const base = { mode: "sdk" as const, sessionId };
	const args = ["sdk", "session", "send", sessionId, "--text", text, "--json"];
	if (wait) args.push("--wait", "--timeout-ms", String(WAIT_CLI_TIMEOUT_MS));
	let result: ExecResult;
	try {
		result = await exec("gjc", args, {
			timeout: wait ? WAIT_TIMEOUT_MS : SEND_TIMEOUT_MS,
			signal,
		});
	} catch (error) {
		return isMissingExecutable(error)
			? { ...base, ok: false, status: "not_sent", error: GJC_NOT_FOUND }
			: {
					...base,
					ok: false,
					status: "uncertain",
					error: `GJC session send failed: ${errorMessage(error)}`,
				};
	}
	if (result.killed) {
		return {
			...base,
			ok: false,
			status: "uncertain",
			error:
				"GJC session send timed out; delivery may already have been accepted.",
		};
	}
	const body = parseJson(result.stdout);
	if (!body) {
		return result.code !== 0
			? { ...base, ok: false, status: "not_sent", error: GJC_NOT_FOUND }
			: {
					...base,
					ok: false,
					status: "uncertain",
					error: "GJC session send returned an invalid response.",
				};
	}
	if (body.ok === false) {
		const error = record(body.error);
		const references = Array.isArray(error?.references) ? error.references : [];
		const ref = references
			.map(record)
			.find((item) => item?.kind === "operationRef")?.value;
		const operationRef = typeof ref === "string" ? ref : undefined;
		if (error?.code === "wait_timeout") {
			return {
				...base,
				ok: false,
				status: "uncertain",
				operationRef,
				error: "GJC session wait timed out; the prompt may already be accepted.",
			};
		}
		return {
			...base,
			ok: false,
			status: error?.outcomeCertainty === "not-applied" ? "not_sent" : "uncertain",
			operationRef,
			error: `GJC session send failed: ${String(error?.message ?? `exit ${result.code}`)}`,
		};
	}
	const payload = record(body.result);
	const ref = payload?.operationRef;
	const operationRef = typeof ref === "string" && ref ? ref : undefined;
	const status = payload?.status;
	if (
		result.code !== 0 ||
		body.ok !== true ||
		!operationRef ||
		(status !== "accepted" && status !== "terminal_ok" && status !== "failed")
	) {
		return {
			...base,
			ok: false,
			status: "uncertain",
			operationRef,
			error: "GJC session send returned an invalid response.",
		};
	}
	if (status === "failed") {
		return {
			...base,
			ok: false,
			status,
			operationRef,
			error: `GJC target turn failed (operationRef ${operationRef}).`,
		};
	}
	return { ...base, ok: true, status, operationRef };
}

/** Explicit low-level input: types the text into the pane, then presses Enter once. */
export async function sendRawPrompt(
	deps: SendDeps,
	pane: string,
	text: string,
	signal?: AbortSignal,
): Promise<SendResult> {
	const base = { mode: "raw" as const, pane };
	const run = async (args: string[]): Promise<string | undefined> => {
		if (signal?.aborted) return "Raw delivery aborted.";
		try {
			const result = await deps.exec(deps.herdrBin, args, {
				timeout: HERDR_TIMEOUT_MS,
				signal,
			});
			if (result.killed) return "timed out";
			if (result.code !== 0) {
				const error = record(parseJson(result.stderr)?.error);
				return typeof error?.message === "string"
					? error.message
					: result.stderr.trim() || `exit ${result.code}`;
			}
			return undefined;
		} catch (error) {
			return errorMessage(error);
		}
	};
	const textFailure = await run(["pane", "send-text", pane, text]);
	if (textFailure !== undefined) {
		return {
			...base,
			ok: false,
			status: "not_sent",
			error: `Herdr raw text delivery failed: ${textFailure}`,
		};
	}
	const submitFailure = await run(["pane", "send-keys", pane, "enter"]);
	if (submitFailure !== undefined) {
		return {
			...base,
			ok: false,
			status: "raw_partial",
			error: `Herdr raw submit failed; text may already be present: ${submitFailure}`,
		};
	}
	return { ...base, ok: true, status: "raw_written" };
}

/** Resolves the target, refuses self-delivery, then performs exactly one transport. */
export async function deliverPrompt(
	deps: SendDeps,
	request: SendRequest,
	sender: Sender,
	signal?: AbortSignal,
): Promise<SendResult> {
	if (deps.backend === "hc") {
		return deliverViaHc(deps, request, signal);
	}
	const mode = request.raw ? "raw" : "sdk";
	const fail = (error: string, pane?: string): SendResult => ({
		ok: false,
		mode,
		status: "not_sent",
		pane,
		error,
	});
	const target = request.pane.trim();
	if (!target) return fail("Pane is required.");
	if (!request.text.trim()) return fail("Prompt text must not be empty.");
	if (request.raw && request.wait) {
		return fail("Raw delivery does not support wait.");
	}
	if (signal?.aborted) return fail("Prompt delivery aborted before sending.");

	let pane: TargetPane;
	try {
		pane = await resolveTargetPane(deps, target);
	} catch (error) {
		return fail(errorMessage(error));
	}
	if (pane.agentStatus === "blocked") {
		return fail(
			"Target is blocked on an approval or question; answer it first, then retry.",
			pane.paneId,
		);
	}
	if (request.raw) {
		if (pane.paneId === sender.pane) {
			return fail("Cannot send raw input to the current Herdr pane.", pane.paneId);
		}
		const maxWaitMs = deps.inputWaitMs ?? inputWaitMs();
		const now = deps.now ?? (() => performance.now());
		const sleep =
			deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
		const waitStart = now();
		const waitDeadline = waitStart + maxWaitMs;
		let waitActive = false;
		let retrying = false;
		let totalWaitedMs = 0;
		let lastUnready: "typing" | "focused" = "typing";
		const syncWait = () => {
			if (waitActive) totalWaitedMs = Math.max(0, now() - waitStart);
		};
		const waited = () => (totalWaitedMs > 0 ? { waitedMs: totalWaitedMs } : {});
		const failTyping = () => {
			syncWait();
			return {
				...fail(
					`Target input box still has text after ${Math.round(totalWaitedMs / 1000)}s; raw input not sent. Retry later.`,
					pane.paneId,
				),
				...waited(),
			};
		};
		const failFocused = () => {
			syncWait();
			return {
				...fail(
					`Target input box could not be read and the pane is focused by a person who may be typing after ${Math.round(totalWaitedMs / 1000)}s; raw input not sent. Retry later.`,
					pane.paneId,
				),
				...waited(),
			};
		};
		const failLastUnready = () =>
			lastUnready === "focused" ? failFocused() : failTyping();
		for (;;) {
			const guardedPaneId = pane.paneId;
			let paneReads = 0;
			const guard = await waitForEmptyInput(
				{
					...deps,
					exec: async (command, args, options) => {
						if (args[0] === "pane" && args[1] === "read") paneReads++;
						return deps.exec(command, args, options);
					},
				},
				guardedPaneId,
				retrying ? waitDeadline - now() : maxWaitMs,
				signal,
				pane.agent,
			);
			if (guard.waitedMs > 0) waitActive = true;
			if (paneReads > 1 || (guard.state === "typing" && paneReads > 0)) {
				lastUnready = "typing";
			}
			syncWait();
			if (signal?.aborted) {
				return { ...fail("Raw delivery aborted before sending.", pane.paneId), ...waited() };
			}
			if (guard.state === "typing") {
				if (retrying && paneReads === 0) return failLastUnready();
				return failTyping();
			}
			if (waitActive) {
				const remainingForResolve = waitDeadline - now();
				if (Math.floor(remainingForResolve) < 1) {
					return failLastUnready();
				}
				try {
					pane = await resolveTargetPane(deps, target, remainingForResolve);
				} catch (error) {
					syncWait();
					if (now() >= waitDeadline && /timed out/.test(errorMessage(error))) {
						return failLastUnready();
					}
					return { ...fail(errorMessage(error), pane.paneId), ...waited() };
				}
				syncWait();
				if (signal?.aborted) {
					return { ...fail("Raw delivery aborted before sending.", pane.paneId), ...waited() };
				}
				if (pane.agentStatus === "blocked") {
					return {
						...fail("Target is blocked on an approval or question; answer it first, then retry.", pane.paneId),
						...waited(),
					};
				}
				if (pane.paneId === sender.pane) {
					return { ...fail("Cannot send raw input to the current Herdr pane.", pane.paneId), ...waited() };
				}
				if (pane.paneId !== guardedPaneId) {
					return {
						...fail(
							`Target ${target} moved from pane ${guardedPaneId} to ${pane.paneId} while waiting; raw input not sent. Retry later.`,
							pane.paneId,
						),
						...waited(),
					};
				}
				if (now() > waitDeadline) {
					return failLastUnready();
				}
			}
			// Input box unreadable: fall back to the focus rule (a focused pane may have a person typing).
			if (guard.state === "unknown" && pane.focused) {
				lastUnready = "focused";
				const remainingBeforeSleep = waitDeadline - now();
				if (remainingBeforeSleep >= 1) {
					waitActive = true;
					retrying = true;
					await sleep(Math.min(POLL_INTERVAL_MS, remainingBeforeSleep));
					syncWait();
					if (signal?.aborted) {
						return { ...fail("Raw delivery aborted before sending.", pane.paneId), ...waited() };
					}
					if (waitDeadline - now() >= MIN_RECHECK_MS) continue;
				}
				return failFocused();
			}
			syncWait();
			return { ...(await sendRawPrompt(deps, pane.paneId, request.text, signal)), ...waited() };
		}
	}

	let sessionId: string;
	try {
		sessionId = await resolveTargetSession(deps, pane);
	} catch (error) {
		return fail(errorMessage(error), pane.paneId);
	}
	if (sessionId === sender.sessionId) {
		return fail("Cannot send a prompt to the current GJC session.", pane.paneId);
	}
	const result = await sendSessionPrompt(
		deps.exec,
		sessionId,
		request.text,
		request.wait === true,
		signal,
	);
	return { ...result, pane: pane.paneId };
}

/** Parses `[--wait|--raw] <pane> <text>`; everything after the target's single separator is kept verbatim. */
export function parseCommandArgs(args: string): SendRequest | string {
	const request: SendRequest = { pane: "", text: "" };
	let rest = args.replace(/^\s+/, "");
	while (rest.startsWith("--")) {
		const [flag] = rest.split(/\s/, 1);
		if (flag === "--wait") request.wait = true;
		else if (flag === "--raw") request.raw = true;
		else return USAGE;
		rest = rest.slice(flag.length).replace(/^\s+/, "");
	}
	const match = /^(\S+)(?:\s([\s\S]*))?$/.exec(rest);
	if (match) {
		request.pane = match[1];
		request.text = match[2] ?? "";
	}
	return request;
}

const HC_WAIT_REASONS: ReadonlySet<string> = new Set([
	"status",
	"exit",
	"timeout",
	"message",
	"not_started",
	"children",
	"output",
]);

const HC_WAIT_STATUSES: ReadonlySet<string> = new Set([
	"idle",
	"working",
	"done",
	"blocked",
	"error",
]);

const SAFE_HC_SEND_ERRORS: ReadonlySet<string> = new Set([
	USAGE,
	"Pane is required.",
	"Target is required.",
	"Prompt text must not be empty.",
	"Prompt delivery aborted before sending.",
	"Call aborted before delivery.",
	"Target must be an hc terminal address or name, not an option.",
	"Target is neither a valid hc terminal address nor a valid terminal name.",
	"text starting with '-' unsupported on hc",
	"hc caller unknown",
	"Cannot send a prompt to the current hc terminal.",
	"Send budget exhausted before hc send.",
	"Call budget exhausted before hc send.",
	"hc CLI executable is not available; no input was sent.",
	"hc ls is unavailable; no input was sent.",
	"hc ls timed out before delivery; no input was sent.",
	"hc ls returned an invalid JSON response; no input was sent.",
	"hc ls failed before delivery; no input was sent.",
	"hc ls returned an invalid response.",
	"hc ls returned a malformed terminal entry.",
	"No live hc terminal matched the requested name in the current list (disconnected machines are not searched); pass an explicit terminal address.",
	"Multiple hc terminals matched the requested name; pass an explicit terminal address.",
	"Local wait aborted during hc send; delivery state is unknown and the target may still be running. Do not resend.",
	"hc send timed out; delivery state is unknown and the target may still be running. Do not resend.",
	"hc send returned a malformed response; delivery state is unknown. Do not resend.",
	"hc send failed with an unrecognized error; delivery state is unknown. Do not resend.",
	"hc send failed during execution; delivery state is unknown. Do not resend.",
	"hc send returned an invalid started field; delivery state is unknown. Do not resend.",
	"hc send returned an invalid status field; delivery state is unknown. Do not resend.",
	"text delivered; wait result invalid; completion unconfirmed; do not resend",
	"start was not observed; no wait result; completion unconfirmed",
	"hc send --wait returned no wait result after text delivery; turn completion is not confirmed. Do not resend.",
	"hc send --wait returned a mismatched terminal in wait result; turn completion is not confirmed. Do not resend.",
	"hc text delivered, but the target turn did not start (reason=not_started). Turn is not completed; do not resend.",
	"hc text delivered, but wait returned before turn completion (reason=timeout). Turn is not completed; do not resend.",
	"hc text delivered, but wait returned before turn completion (reason=message). Turn is not completed; do not resend.",
	"hc text delivered, but the target terminal exited before turn completion (reason=exit). Do not resend.",
	"hc text delivered, but the target is blocked waiting for a user decision (status=blocked). Do not resend.",
	"hc text delivered, but the target reported error status (status=error). Do not resend.",
	"hc text delivered, but wait did not advance turn past send; turn completion is not confirmed. Do not resend.",
	"hc text delivered, but wait returned an unexpected state; turn completion is not confirmed. Do not resend.",
	...Object.values(HC_ERROR_SPECS).flatMap((spec) => [
		spec.message,
		spec.preSendMessage,
	]),
]);

function describeHcSendResult(result: SendResult): string {
	const w = result.waited;
	if (result.ok && result.status === "sent") {
		if (w) {
			const safeStatus =
				w.status === "idle" || w.status === "done" ? w.status : "done";
			const safeTurn =
				typeof w.turn === "number" && Number.isSafeInteger(w.turn) ? w.turn : 0;
			return `hc text delivered (status: sent) and turn completed (reason=status, status=${safeStatus}, ended=true, turn=${safeTurn}). (${HC_SEND_NOTE})`;
		}
		return `hc text delivered (status: sent); completion is not awaited. (${HC_SEND_NOTE})`;
	}

	if (result.status === "sent") {
		if (w) {
			const reason = HC_WAIT_REASONS.has(w.reason) ? w.reason : "unexpected";
			const statusLabel =
				w.status === null
					? "none"
					: typeof w.status === "string" && HC_WAIT_STATUSES.has(w.status)
						? w.status
						: "unknown";
			const ended = Boolean(w.ended);
			const turn =
				typeof w.turn === "number" && Number.isSafeInteger(w.turn) ? w.turn : 0;
			if (reason === "timeout" || reason === "message") {
				return `hc text delivered (status: sent), but wait checked in before turn completion (reason=${reason}, status=${statusLabel}, ended=${ended}, turn=${turn}); turn is not completed. Do not resend. (${HC_SEND_NOTE})`;
			}
			if (reason === "not_started") {
				return `hc text delivered (status: sent), but target turn did not start (reason=not_started, status=${statusLabel}, ended=${ended}, turn=${turn}); turn is not completed. Do not resend. (${HC_SEND_NOTE})`;
			}
			if (reason === "exit") {
				const exitParts: string[] = [];
				if (typeof w.exitCode === "number" && Number.isInteger(w.exitCode)) {
					exitParts.push(`exit_code=${w.exitCode}`);
				}
				if (typeof w.signal === "number" && Number.isInteger(w.signal)) {
					exitParts.push(`signal=${w.signal}`);
				}
				const exitExtra =
					exitParts.length > 0 ? `, ${exitParts.join(", ")}` : "";
				return `hc text delivered (status: sent), but target terminal exited before turn completion (reason=exit, status=${statusLabel}, ended=${ended}, turn=${turn}${exitExtra}). Do not resend. (${HC_SEND_NOTE})`;
			}
			if (statusLabel === "blocked") {
				return `hc text delivered (status: sent), but target is blocked waiting for a user decision (reason=${reason}, status=blocked, ended=${ended}, turn=${turn}). Do not resend. (${HC_SEND_NOTE})`;
			}
			if (statusLabel === "error") {
				return `hc text delivered (status: sent), but target reported error status (reason=${reason}, status=error, ended=${ended}, turn=${turn}). Do not resend. (${HC_SEND_NOTE})`;
			}
			return `hc text delivered (status: sent), but wait did not confirm turn completion (reason=${reason}, status=${statusLabel}, ended=${ended}, turn=${turn}). Do not resend. (${HC_SEND_NOTE})`;
		}
		const safeErr =
			result.error && SAFE_HC_SEND_ERRORS.has(result.error)
				? result.error
				: "hc text delivered, but turn completion was not confirmed. Do not resend.";
		return `${safeErr} (status: sent) (${HC_SEND_NOTE})`;
	}

	if (result.error === USAGE) {
		return USAGE;
	}
	const fallback =
		result.status === "not_sent"
			? "hc delivery refused before input; no input was sent."
			: "hc delivery state is uncertain. Do not resend.";
	const safeErr =
		result.error && SAFE_HC_SEND_ERRORS.has(result.error)
			? result.error
			: fallback;
	return `${safeErr} (${HC_SEND_NOTE})`;
}

export function describeResult(result: SendResult): string {
	if (result.mode === "hc") {
		return describeHcSendResult(result);
	}
	const ref = result.operationRef ? ` (operationRef ${result.operationRef})` : "";
	if (!result.ok) {
		const error = result.error ?? "Prompt delivery failed.";
		return result.operationRef && !error.includes(result.operationRef)
			? `${error}${ref}`
			: error;
	}
	if (result.status === "raw_written") {
		return `Raw input written to pane ${result.pane} and Enter pressed.`;
	}
	if (result.status === "terminal_ok") {
		return `GJC session ${result.sessionId} on pane ${result.pane} completed the prompt${ref}.`;
	}
	return `Prompt accepted by GJC session ${result.sessionId} on pane ${result.pane}${ref}; completion is not awaited.`;
}

/**
 * Delivers a prompt to an `hc` terminal via `hc send --json --if idle [--wait --timeout <sec>]`:
 * target resolution (remote addresses allowed) -> caller/self check ->
 * single `hc send` (`--raw` and `--raw --wait` use the same `hc send` transport, no separate Enter) ->
 * separates delivery (`status: "sent"`) from `waited` outcome.
 */
export async function deliverViaHc(
	deps: SendDeps,
	request: SendRequest,
	signal?: AbortSignal,
): Promise<SendResult> {
	const now = deps.now ?? (() => performance.now());
	const startedAt = now();
	const deadline = startedAt + WAIT_TIMEOUT_MS;
	const failNotSent = (error: string, pane?: string): SendResult => ({
		ok: false,
		mode: "hc",
		status: "not_sent",
		...(pane ? { pane } : {}),
		error,
	});

	const target = request.pane.trim();
	if (!target) return failNotSent("Pane is required.");
	if (target.startsWith("-")) {
		return failNotSent(
			"Target must be an hc terminal address or name, not an option.",
		);
	}
	if (!request.text.trim()) {
		return failNotSent("Prompt text must not be empty.");
	}
	if (request.text.startsWith("-")) {
		return failNotSent("text starting with '-' unsupported on hc");
	}
	if (signal?.aborted) {
		return failNotSent("Prompt delivery aborted before sending.");
	}
	if (
		!isValidHcAddress(target) &&
		(target.includes("/") || !HC_NAME_RE.test(target))
	) {
		return failNotSent(
			"Target is neither a valid hc terminal address nor a valid terminal name.",
		);
	}

	const callerId = deps.hcCallerId?.trim();
	if (!callerId || !isValidHcAddress(callerId)) {
		return failNotSent("hc caller unknown");
	}

	const hcDeps: HcExecDeps = {
		exec: deps.exec,
		hcBin: deps.hcBin ?? "hc",
	};

	const resolved = await hcResolveTarget(
		hcDeps,
		target,
		Math.min(HERDR_TIMEOUT_MS, deadline - now()),
		signal,
	);
	if (!resolved.ok) {
		return failNotSent(resolved.message);
	}
	const addr = resolved.address;
	if (isSelf(addr, callerId)) {
		return failNotSent("Cannot send a prompt to the current hc terminal.", addr);
	}

	const sendRemMs = deadline - now();
	if (Math.floor(sendRemMs) < 1) {
		return failNotSent("Send budget exhausted before hc send.", addr);
	}

	const wantWait = request.wait === true;
	const timeoutSec = wantWait
		? Math.max(1, Math.ceil(sendRemMs / 1000))
		: undefined;
	const sent = await hcSend(
		hcDeps,
		addr,
		request.text,
		wantWait ? { wait: true, timeoutSec } : {},
		Math.floor(sendRemMs),
		signal,
	);
	if (!sent.ok) {
		return {
			ok: false,
			mode: "hc",
			status: sent.certainty === "not_sent" ? "not_sent" : "uncertain",
			pane: addr,
			error: sent.message,
		};
	}

	if (!sent.waitValid) {
		return {
			ok: false,
			mode: "hc",
			status: "sent",
			pane: addr,
			error:
				"text delivered; wait result invalid; completion unconfirmed; do not resend",
		};
	}

	if (!wantWait) {
		return {
			ok: true,
			mode: "hc",
			status: "sent",
			pane: addr,
		};
	}

	if (sent.wait === null || sent.wait === undefined) {
		if (sent.started === false) {
			return {
				ok: false,
				mode: "hc",
				status: "sent",
				pane: addr,
				error: "start was not observed; no wait result; completion unconfirmed",
			};
		}
		return {
			ok: false,
			mode: "hc",
			status: "sent",
			pane: addr,
			error:
				"hc send --wait returned no wait result after text delivery; turn completion is not confirmed. Do not resend.",
		};
	}

	const w = sent.wait;
	const waited: HcSendWaited = {
		reason: w.reason,
		status: w.status,
		ended: w.ended,
		turn: w.turn,
		...(w.exitCode !== null ? { exitCode: w.exitCode } : {}),
		...(w.signal !== null ? { signal: w.signal } : {}),
	};

	if (w.terminal !== addr) {
		return {
			ok: false,
			mode: "hc",
			status: "sent",
			pane: addr,
			waited,
			error:
				"hc send --wait returned a mismatched terminal in wait result; turn completion is not confirmed. Do not resend.",
		};
	}
	if (w.reason === "not_started") {
		return {
			ok: false,
			mode: "hc",
			status: "sent",
			pane: addr,
			waited,
			error:
				"hc text delivered, but the target turn did not start (reason=not_started). Turn is not completed; do not resend.",
		};
	}
	if (w.reason === "timeout") {
		return {
			ok: false,
			mode: "hc",
			status: "sent",
			pane: addr,
			waited,
			error:
				"hc text delivered, but wait returned before turn completion (reason=timeout). Turn is not completed; do not resend.",
		};
	}
	if (w.reason === "message") {
		return {
			ok: false,
			mode: "hc",
			status: "sent",
			pane: addr,
			waited,
			error:
				"hc text delivered, but wait returned before turn completion (reason=message). Turn is not completed; do not resend.",
		};
	}
	if (w.reason === "exit") {
		return {
			ok: false,
			mode: "hc",
			status: "sent",
			pane: addr,
			waited,
			error:
				"hc text delivered, but the target terminal exited before turn completion (reason=exit). Do not resend.",
		};
	}
	if (w.status === "blocked") {
		return {
			ok: false,
			mode: "hc",
			status: "sent",
			pane: addr,
			waited,
			error:
				"hc text delivered, but the target is blocked waiting for a user decision (status=blocked). Do not resend.",
		};
	}
	if (w.status === "error") {
		return {
			ok: false,
			mode: "hc",
			status: "sent",
			pane: addr,
			waited,
			error:
				"hc text delivered, but the target reported error status (status=error). Do not resend.",
		};
	}

	if (
		w.ended === true &&
		w.reason === "status" &&
		(w.status === "idle" || w.status === "done") &&
		w.turn >= sent.turn + 1
	) {
		return {
			ok: true,
			mode: "hc",
			status: "sent",
			pane: addr,
			waited,
		};
	}

	if (w.ended === true && w.turn < sent.turn + 1) {
		return {
			ok: false,
			mode: "hc",
			status: "sent",
			pane: addr,
			waited,
			error:
				"hc text delivered, but wait did not advance turn past send; turn completion is not confirmed. Do not resend.",
		};
	}

	return {
		ok: false,
		mode: "hc",
		status: "sent",
		pane: addr,
		waited,
		error:
			"hc text delivered, but wait returned an unexpected state; turn completion is not confirmed. Do not resend.",
	};
}

export interface RegisterSendOptions {
	backend?: "herdr" | "hc";
	hcBin?: string;
	hcCallerId?: string;
}

export function registerSendFeatures(
	api: ExtensionAPI,
	herdrBin: string,
	senderPane: string | undefined,
	options?: RegisterSendOptions,
): void {
	const backend = options?.backend ?? "herdr";
	const isHc = backend === "hc";
	const deps: SendDeps = {
		exec: api.exec.bind(api),
		herdrBin,
		backend,
		hcBin: options?.hcBin ?? "hc",
		hcCallerId: options?.hcCallerId,
	};
	const sender = (ctx: ExtensionContext): Sender => ({
		sessionId: ctx.sessionManager.getSessionId(),
		pane: senderPane,
	});

	const commandDescription = isHc
		? "Send a prompt to another hc terminal via hc send: [--wait|--raw] <terminal-id-or-unique-name> <text> " +
			`(--raw and --raw --wait use the same hc send --if idle path; ${HC_SEND_NOTE}; hc: text delivery only, no GJC session token, no screen read; result file required for /herdr-call; unattended target assumed, not verified by the plugin; a target left in done cannot take a follow-up automatically)`
		: "Send a prompt to the GJC session in another Herdr pane: [--wait|--raw] <pane-or-agent-name> <text> " +
			`(when running on hc: ${HC_SEND_NOTE})`;

	const toolDescription = isHc
		? "Send a prompt to another hc terminal via `hc send --json --if idle`. " +
			"`pane` is an hc terminal address (`t2` or `machine/t2`) or a unique terminal name. Sending to the current hc terminal is refused. " +
			"`wait` (and `raw` with `wait`) waits in a single `hc send --wait` call and reports `waited` separately from delivery (`status: sent`). " +
			"`raw` uses the same `hc send --if idle` transport without separate Enter key presses. " +
			`(${HC_SEND_NOTE}; hc: text delivery only, no GJC session token, no screen read; result file required for /herdr-call; unattended target assumed, not verified by the plugin; a target left in done cannot take a follow-up automatically)`
		: "Send a prompt to the GJC session running in another Herdr pane via the official `gjc sdk session send`. " +
			"`pane` is a Herdr pane ID (e.g. wC:p2) or Herdr agent name. Sending to the current session is refused. " +
			"`wait` waits for the target turn to finish. `raw` instead types the text into the pane and presses Enter; " +
			"it works on any pane (including shells), gives no completion signal and cannot be combined with `wait`. " +
			`(When running on hc: ${HC_SEND_NOTE})`;

	api.registerCommand("herdr-send", {
		description: commandDescription,
		handler: async (args, ctx) => {
			const request = parseCommandArgs(args);
			const result: SendResult =
				typeof request === "string"
					? {
							ok: false,
							mode: isHc ? "hc" : "sdk",
							status: "not_sent",
							error: request,
						}
					: await deliverPrompt(deps, request, sender(ctx));
			const message = describeResult(result);
			if (ctx.hasUI) {
				ctx.ui.notify(message, result.ok ? "info" : "error");
			} else if (isHc) {
				const phase =
					result.status === "not_sent"
						? "pre_send"
						: result.status === "uncertain"
							? "send"
							: "post_send";
				const textLength = typeof request === "string" ? 0 : request.text.length;
				const logMessage = `${message} [backend=hc, phase=${phase}, status=${result.status}, textLength=${textLength}]`;
				if (result.ok) api.logger.info(logMessage);
				else api.logger.warn(logMessage);
			} else if (result.ok) {
				api.logger.info(message);
			} else {
				api.logger.warn(message);
			}
		},
	});

	const { z } = api.zod;
	api.registerTool({
		name: "herdr_send",
		label: "Herdr Send",
		description: toolDescription,
		parameters: z.object({
			pane: z
				.string()
				.describe(
					isHc
						? "Target hc terminal address (e.g. t2 or machine/t2) or unique terminal name"
						: "Target Herdr pane ID or agent name",
				),
			text: z
				.string()
				.describe(
					isHc
						? "Prompt text to deliver (must not start with '-')"
						: "Prompt text to deliver",
				),
			wait: z
				.boolean()
				.optional()
				.describe(
					isHc
						? "Wait for the target turn in the same hc send call (allowed with raw on hc)"
						: "Wait for the target turn to finish (SDK mode only)",
				),
			raw: z
				.boolean()
				.optional()
				.describe(
					isHc
						? "Uses the same hc send --if idle transport on hc (allowed with wait)"
						: "Low-level pane input instead of the GJC SDK",
				),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const result = await deliverPrompt(deps, params, sender(ctx), signal);
			return {
				content: [{ type: "text", text: describeResult(result) }],
				details: result,
				isError: !result.ok,
			};
		},
	});
}
