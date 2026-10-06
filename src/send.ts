import type {
	ExtensionAPI,
	ExtensionContext,
	ExecResult,
} from "@gajae-code/coding-agent";
import { SESSION_ID_KEY } from "./metadata.ts";

type Exec = ExtensionAPI["exec"];
type Json = Record<string, unknown>;

const HERDR_TIMEOUT_MS = 3_000;
const LIST_TIMEOUT_MS = 15_000;
const SEND_TIMEOUT_MS = 30_000;
const WAIT_CLI_TIMEOUT_MS = 30_000;
const WAIT_TIMEOUT_MS = 60_000;
const PANE_ID = /^w[^:\s]+:p[^:\s]+$/;

export const USAGE = "Usage: /herdr-send [--wait|--raw] <pane> <text>";
export const GJC_NOT_FOUND = "gjc CLI not found on PATH";

export interface SendRequest {
	pane: string;
	text: string;
	wait?: boolean;
	raw?: boolean;
}

export interface SendResult {
	ok: boolean;
	mode: "sdk" | "raw";
	/**
	 * not_sent: nothing was delivered. uncertain: the prompt may have been accepted.
	 * accepted/terminal_ok/failed: GJC SDK outcome. raw_written/raw_partial: pane input outcome.
	 */
	status:
		| "not_sent"
		| "uncertain"
		| "accepted"
		| "terminal_ok"
		| "failed"
		| "raw_written"
		| "raw_partial";
	pane?: string;
	sessionId?: string;
	operationRef?: string;
	error?: string;
}

export interface SendDeps {
	exec: Exec;
	herdrBin: string;
}

export interface Sender {
	sessionId: string;
	pane?: string;
}

export interface TargetPane {
	paneId: string;
	tokens: Json;
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
): Promise<Json> {
	const operation = `${args[0]} ${args[1]}`;
	let result: ExecResult;
	try {
		result = await deps.exec(deps.herdrBin, args, {
			timeout: HERDR_TIMEOUT_MS,
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
): Promise<TargetPane> {
	let paneId = target;
	if (!PANE_ID.test(target)) {
		const agent = record(
			record((await herdrJson(deps, ["agent", "get", target], target)).result)
				?.agent,
		);
		if (typeof agent?.pane_id !== "string" || !agent.pane_id) {
			throw new Error("Herdr agent get returned an invalid response.");
		}
		paneId = agent.pane_id;
	}
	const pane = record(
		record((await herdrJson(deps, ["pane", "get", paneId], target)).result)
			?.pane,
	);
	if (typeof pane?.pane_id !== "string" || !pane.pane_id) {
		throw new Error("Herdr pane get returned an invalid response.");
	}
	return { paneId: pane.pane_id, tokens: record(pane.tokens) ?? {} };
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
): Promise<SendResult> {
	const base = { mode: "raw" as const, pane };
	const run = async (args: string[]): Promise<string | undefined> => {
		try {
			const result = await deps.exec(deps.herdrBin, args, {
				timeout: HERDR_TIMEOUT_MS,
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

	let pane: TargetPane;
	try {
		pane = await resolveTargetPane(deps, target);
	} catch (error) {
		return fail(errorMessage(error));
	}
	if (request.raw) {
		if (pane.paneId === sender.pane) {
			return fail("Cannot send raw input to the current Herdr pane.", pane.paneId);
		}
		return sendRawPrompt(deps, pane.paneId, request.text);
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

export function describeResult(result: SendResult): string {
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

export function registerSendFeatures(
	api: ExtensionAPI,
	herdrBin: string,
	senderPane: string | undefined,
): void {
	const deps: SendDeps = { exec: api.exec.bind(api), herdrBin };
	const sender = (ctx: ExtensionContext): Sender => ({
		sessionId: ctx.sessionManager.getSessionId(),
		pane: senderPane,
	});

	api.registerCommand("herdr-send", {
		description:
			"Send a prompt to the GJC session in another Herdr pane: [--wait|--raw] <pane-or-agent-name> <text>",
		handler: async (args, ctx) => {
			const request = parseCommandArgs(args);
			const result: SendResult =
				typeof request === "string"
					? { ok: false, mode: "sdk", status: "not_sent", error: request }
					: await deliverPrompt(deps, request, sender(ctx));
			const message = describeResult(result);
			if (ctx.hasUI) ctx.ui.notify(message, result.ok ? "info" : "error");
			else if (result.ok) api.logger.info(message);
			else api.logger.warn(message);
		},
	});

	const { z } = api.zod;
	api.registerTool({
		name: "herdr_send",
		label: "Herdr Send",
		description:
			"Send a prompt to the GJC session running in another Herdr pane via the official `gjc sdk session send`. " +
			"`pane` is a Herdr pane ID (e.g. wC:p2) or Herdr agent name. Sending to the current session is refused. " +
			"`wait` waits for the target turn to finish. `raw` instead types the text into the pane and presses Enter; " +
			"it works on any pane (including shells), gives no completion signal and cannot be combined with `wait`.",
		parameters: z.object({
			pane: z.string().describe("Target Herdr pane ID or agent name"),
			text: z.string().describe("Prompt text to deliver"),
			wait: z
				.boolean()
				.optional()
				.describe("Wait for the target turn to finish (SDK mode only)"),
			raw: z
				.boolean()
				.optional()
				.describe("Low-level pane input instead of the GJC SDK"),
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
