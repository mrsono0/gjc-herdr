import type { ExtensionAPI } from "@gajae-code/coding-agent";
import {
	HC_ERROR_SPECS,
	HC_NAME_RE,
	hcGet,
	hcResolveTarget,
	hcSend,
	isSelf,
	isValidHcAddress,
	type HcExecDeps,
} from "./hc.ts";

type Exec = ExtensionAPI["exec"];

const HERDR_TIMEOUT_MS = 3_000;
const WAIT_TIMEOUT_MS = 60_000;

export const USAGE = "Usage: /herdr-send [--wait] <terminal> <text>";
export const HC_SEND_NOTE =
	"hc: text delivery only; no GJC session token; idle or done targets only";
export const HC_DONE_NON_ATOMIC_NOTE =
	"Note: sent to a done target without --if (non-atomic; if the target started working after preflight check, input may enter an in-progress turn).";

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
	mode: "hc";
	/**
	 * not_sent: nothing was delivered. uncertain: the prompt may have been accepted.
	 * sent: hc text delivery confirmed (turn returned).
	 */
	status: "not_sent" | "uncertain" | "sent";
	pane?: string;
	error?: string;
	/** Wait outcome on hc when `--wait` was requested; separated from delivery (`status: "sent"`). */
	waited?: HcSendWaited;
	/** True when `hc send` ran without `--if` for a preflight `done` target (non-atomic). */
	nonAtomicDone?: boolean;
}

export interface SendDeps {
	exec: Exec;
	hcBin?: string;
	hcCallerId?: string;
	now?: () => number;
}

/** Resolves the target, refuses self-delivery, preflights with `hc get`, then performs one `hc send` transport. */
export async function deliverPrompt(
	deps: SendDeps,
	request: SendRequest,
	signal?: AbortSignal,
): Promise<SendResult> {
	return deliverViaHc(deps, request, signal);
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
	"Send budget exhausted before hc get.",
	"Send budget exhausted before hc send.",
	"Call budget exhausted before hc send.",
	"hc CLI executable is not available; no input was sent.",
	"hc ls is unavailable; no input was sent.",
	"hc ls timed out before delivery; no input was sent.",
	"hc ls returned an invalid JSON response; no input was sent.",
	"hc ls failed before delivery; no input was sent.",
	"hc ls returned an invalid response.",
	"hc ls returned a malformed terminal entry.",
	"hc get is unavailable; no input was sent.",
	"hc get timed out before delivery; no input was sent.",
	"hc get returned an invalid JSON response; no input was sent.",
	"hc get failed before delivery; no input was sent.",
	"hc get returned an invalid or mismatched terminal address.",
	"hc get returned an invalid terminal state.",
	"hc get returned an invalid reported field.",
	"hc get returned an invalid turn value.",
	"hc get returned a malformed status record.",
	"hc get returned a malformed status kind.",
	"Target terminal has finished; no input was sent.",
	"Target terminal has not reported status (OSC 7501); no input was sent.",
	"Target agent is currently working; no input was sent.",
	"Target is blocked waiting for a user decision; no input was sent.",
	"Target agent reported error status; no input was sent.",
	"Target agent state is unknown (not idle or done); no input was sent.",
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

function describeHcSendBody(result: SendResult): string {
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

function describeHcSendResult(result: SendResult): string {
	const body = describeHcSendBody(result);
	if (result.nonAtomicDone === true && result.status !== "not_sent") {
		return `${body} ${HC_DONE_NON_ATOMIC_NOTE}`;
	}
	return body;
}

export function describeResult(result: SendResult): string {
	return describeHcSendResult(result);
}

/**
 * Delivers a prompt to an `hc` terminal after preflight `hc get` verification:
 * target resolution (remote addresses allowed) -> caller/self check ->
 * preflight `hc get` (live, reported===true, status.state==="idle"|"done") ->
 * single `hc send` (`--if idle` for idle, no `--if` for done; `--raw` and `--raw --wait`
 * use the same `hc send` transport, no separate Enter) ->
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

	const preflightRemMs = deadline - now();
	if (Math.floor(preflightRemMs) < 1) {
		return failNotSent("Send budget exhausted before hc get.", addr);
	}
	const preflight = await hcGet(
		hcDeps,
		addr,
		Math.min(HERDR_TIMEOUT_MS, preflightRemMs),
		signal,
	);
	if (!preflight.ok) {
		return failNotSent(preflight.message, addr);
	}

	const facts = preflight.facts;
	if (facts.state !== "live") {
		return failNotSent(
			"Target terminal has finished; no input was sent.",
			addr,
		);
	}
	if (facts.reported !== true) {
		return failNotSent(
			"Target terminal has not reported status (OSC 7501); no input was sent.",
			addr,
		);
	}
	if (facts.statusState === "working") {
		return failNotSent(
			"Target agent is currently working; no input was sent.",
			addr,
		);
	}
	if (facts.statusState === "blocked") {
		return failNotSent(
			"Target is blocked waiting for a user decision; no input was sent.",
			addr,
		);
	}
	if (facts.statusState === "error") {
		return failNotSent(
			"Target agent reported error status; no input was sent.",
			addr,
		);
	}
	if (facts.statusState !== "idle" && facts.statusState !== "done") {
		return failNotSent(
			"Target agent state is unknown (not idle or done); no input was sent.",
			addr,
		);
	}
	const isDoneTarget = facts.statusState === "done";

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
		{
			...(wantWait ? { wait: true, timeoutSec } : {}),
			...(isDoneTarget ? { ifIdle: false } : {}),
		},
		Math.floor(sendRemMs),
		signal,
	);
	const doneMeta = isDoneTarget ? { nonAtomicDone: true as const } : {};
	if (!sent.ok) {
		const status = sent.certainty === "not_sent" ? "not_sent" : "uncertain";
		return {
			ok: false,
			mode: "hc",
			status,
			pane: addr,
			...(status === "uncertain" ? doneMeta : {}),
			error: sent.message,
		};
	}

	if (!sent.waitValid) {
		return {
			ok: false,
			mode: "hc",
			status: "sent",
			pane: addr,
			...doneMeta,
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
			...doneMeta,
		};
	}

	if (sent.wait === null || sent.wait === undefined) {
		if (sent.started === false) {
			return {
				ok: false,
				mode: "hc",
				status: "sent",
				pane: addr,
				...doneMeta,
				error: "start was not observed; no wait result; completion unconfirmed",
			};
		}
		return {
			ok: false,
			mode: "hc",
			status: "sent",
			pane: addr,
			...doneMeta,
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
			...doneMeta,
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
			...doneMeta,
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
			...doneMeta,
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
			...doneMeta,
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
			...doneMeta,
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
			...doneMeta,
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
			...doneMeta,
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
			...doneMeta,
		};
	}

	if (w.ended === true && w.turn < sent.turn + 1) {
		return {
			ok: false,
			mode: "hc",
			status: "sent",
			pane: addr,
			waited,
			...doneMeta,
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
		...doneMeta,
		error:
			"hc text delivered, but wait returned an unexpected state; turn completion is not confirmed. Do not resend.",
	};
}

export interface RegisterSendOptions {
	hcBin?: string;
	hcCallerId?: string;
}

export function registerSendFeatures(
	api: ExtensionAPI,
	options?: RegisterSendOptions,
): void {
	const deps: SendDeps = {
		exec: api.exec.bind(api),
		hcBin: options?.hcBin ?? "hc",
		hcCallerId: options?.hcCallerId,
	};

	const commandDescription =
		"Send a prompt to another hc terminal via hc send: [--wait|--raw] <terminal-id-or-unique-name> <text> " +
		`(preflights with hc get; idle targets use --if idle, done targets omit --if and are not atomic; --raw and --raw --wait use the same hc send path; ${HC_SEND_NOTE}; no screen read; result file required for /herdr-call; unattended target assumed, not verified by the plugin)`;

	const toolDescription =
		"Send a prompt to another hc terminal via `hc send` after a preflight `hc get` check (idle or done targets only; idle uses `--if idle`, done omits `--if` and is not atomic). " +
		"`pane` is an hc terminal address (`t2` or `machine/t2`) or a unique terminal name. Sending to the current hc terminal is refused. " +
		"`wait` (and `raw` with `wait`) waits in a single `hc send --wait` call and reports `waited` separately from delivery (`status: sent`). " +
		"`raw` uses the same `hc send` transport without separate Enter key presses. " +
		`(${HC_SEND_NOTE}; no screen read; result file required for /herdr-call; unattended target assumed, not verified by the plugin)`;

	api.registerCommand("herdr-send", {
		description: commandDescription,
		handler: async (args, ctx) => {
			const request = parseCommandArgs(args);
			const result: SendResult =
				typeof request === "string"
					? {
							ok: false,
							mode: "hc",
							status: "not_sent",
							error: request,
						}
					: await deliverPrompt(deps, request);
			const message = describeResult(result);
			if (ctx.hasUI) {
				ctx.ui.notify(message, result.ok ? "info" : "error");
			} else {
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
					"Target hc terminal address (e.g. t2 or machine/t2) or unique terminal name",
				),
			text: z
				.string()
				.describe("Prompt text to deliver (must not start with '-')"),
			wait: z
				.boolean()
				.optional()
				.describe(
					"Wait for the target turn in the same hc send call (allowed with raw on hc)",
				),
			raw: z
				.boolean()
				.optional()
				.describe(
					"Uses the same hc send transport on hc (allowed with wait)",
				),
		}),
		async execute(_toolCallId, params, signal) {
			const result = await deliverPrompt(deps, params, signal);
			return {
				content: [{ type: "text", text: describeResult(result) }],
				details: result,
				isError: !result.ok,
			};
		},
	});
}
