import { randomUUID } from "node:crypto";
import {
	constants as fsConstants,
	lstat as nodeLstat,
	open as nodeOpen,
} from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ExtensionAPI, ExecResult } from "@gajae-code/coding-agent";
import { classifyInput, inputWaitMs, waitForEmptyInput } from "./input.ts";

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

async function checkResultFileAbsent(
	fsOps: ResultFileFs,
	resultFile: string,
): Promise<string | undefined> {
	try {
		await fsOps.lstat(resultFile);
		return `result_file already exists at ${resultFile}; use a new path for each call.`;
	} catch (error) {
		if (isMissingPath(error)) return undefined;
		return `Cannot inspect result_file ${resultFile}: ${errorMessage(error)}`;
	}
}

type RecoveredResultFile =
	| { ok: true; answer: string }
	| {
			ok: false;
			code: "aborted" | "result_file_missing" | "result_file_invalid";
			message: string;
	  };

function abortedResultFile(): RecoveredResultFile {
	return {
		ok: false,
		code: "aborted",
		message: "Answer read aborted; the prompt was already delivered.",
	};
}

async function recoverResultFile(
	fsOps: ResultFileFs,
	resultFile: string,
	signal?: AbortSignal,
): Promise<RecoveredResultFile> {
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

export function registerCallFeatures(
	api: ExtensionAPI,
	herdrBin: string,
	senderPane: string | undefined,
): void {
	const deps: AgentCallDeps = {
		exec: api.exec.bind(api),
		herdrBin,
		inFlight: new Set<string>(),
	};

	function summarize(result: AgentCallResult): void {
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

	api.registerCommand("herdr-call", {
		description:
			"Call a Herdr-registered agent in another pane and get its answer back: [--result-file <abs-path>] <pane-id-or-unique-agent-name> <text>",
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
		description:
			"Call a Herdr-registered agent (Claude Code, Codex, Copilot, Gemini, ...) in another Herdr pane and get its answer text back. " +
			"`target` must be an explicit Herdr pane ID or a name that resolves to exactly one agent; the target must be observed idle/done, " +
			"and Herdr's own known-agent/foreground gate decides finally whether the prompt is sent (zero input on rejection). " +
			"One prompt with a bounded wait (60s total budget) and bounded 200-line screen reads (initial unwrapped read, at most one --source recent retry if only the end marker is visible, or one confirmation read after a prompt timeout); the answer is recovered from " +
			"per-request marker lines, or from `result_file` when a new absolute file path is provided (must not already exist before sending; resilient to long answers and folded/truncated terminal output; the target agent must be able to write to that path, e.g. inside the repository for sandboxed agy). " +
			"Anything less is returned as an unverified capture instead of a success. " +
			"No remote approvals, key presses, or retries are ever sent. For GJC targets use the existing herdr_send tool instead.",
		parameters: z.object({
			target: z
				.string()
				.describe("Target Herdr pane ID (e.g. wC:p2) or unique agent name"),
			text: z.string().describe("Prompt text to deliver verbatim"),
			result_file: z
				.string()
				.optional()
				.describe(
					"Optional new absolute path (must not exist before sending) where the target agent writes its full answer (resilient to long output or screen folding; target agent must have write access, e.g. inside the workspace for sandboxed agy)",
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
