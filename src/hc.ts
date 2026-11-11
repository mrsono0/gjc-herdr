import type { ExtensionAPI, ExecResult } from "@gajae-code/coding-agent";

type Exec = ExtensionAPI["exec"];
type Json = Record<string, unknown>;

export const HC_ADDRESS_RE = /^(?:[a-z0-9_.-]+\/)?t[a-z0-9]+$/;
export const HC_NAME_RE = /^[a-z0-9_.-]{1,32}$/;

export type HcPhase = "lookup" | "get" | "send" | "wait";
export type HcCertainty = "not_sent" | "submitted" | "unknown";

export type HcSendNotSentKind =
	| "status_mismatch"
	| "blocked"
	| "finished"
	| "not_found"
	| "machine_unknown"
	| "invalid_params"
	| "config";

export type HcSendUnknownKind = "unavailable" | "cancelled";

export type HcSendErrorKind = HcSendNotSentKind | HcSendUnknownKind;

export type HcErrorKind = HcSendErrorKind | "needs_target";

export const HC_SEND_NOT_SENT_KINDS: ReadonlySet<HcSendNotSentKind> = new Set([
	"status_mismatch",
	"blocked",
	"finished",
	"not_found",
	"machine_unknown",
	"invalid_params",
	"config",
]);

export const HC_SEND_ERROR_KINDS: ReadonlySet<HcSendErrorKind> = new Set([
	...HC_SEND_NOT_SENT_KINDS,
	"unavailable",
	"cancelled",
]);

export const HC_PRE_SEND_ERROR_KINDS: ReadonlySet<HcSendErrorKind> =
	HC_SEND_ERROR_KINDS;

export const HC_WAIT_ERROR_KINDS: ReadonlySet<HcErrorKind> = new Set([
	...HC_SEND_ERROR_KINDS,
	"needs_target",
]);

export interface HcErrorSpec {
	kind: HcErrorKind;
	/** Delivery certainty when returned by `hc send` (rc !== 0). `needs_target` is not valid for send and maps to `unknown`. */
	sendCertainty: "not_sent" | "unknown";
	/** Error code for structured call results. */
	callCode: string;
	/** Fixed safe message for `send` phase (never includes raw stdout/stderr, msg, session, or socket). */
	message: string;
	/** Fixed safe message for pre-send (`lookup`/`get`) phase (`no input was sent`). */
	preSendMessage: string;
}

/**
 * Schema 0.1.20 `terminal.send` error kinds (9) plus `terminal.wait` `needs_target`.
 * Only the 7 explicit pre-input rejections on `hc send` map to `not_sent`;
 * `unavailable`, `cancelled`, `needs_target`, and any unrecognized kind on `hc send` map to `unknown`.
 */
export const HC_ERROR_SPECS: Readonly<Record<HcErrorKind, HcErrorSpec>> = {
	status_mismatch: {
		kind: "status_mismatch",
		sendCertainty: "not_sent",
		callCode: "status_mismatch",
		message:
			"hc rejected the prompt before input (kind: status_mismatch): target status did not match --if idle.",
		preSendMessage:
			"hc rejected the request before delivery (kind: status_mismatch); no input was sent.",
	},
	blocked: {
		kind: "blocked",
		sendCertainty: "not_sent",
		callCode: "agent_blocked",
		message:
			"Target is blocked waiting for a user decision (kind: blocked); no input was sent.",
		preSendMessage:
			"Target is blocked waiting for a user decision (kind: blocked); no input was sent.",
	},
	finished: {
		kind: "finished",
		sendCertainty: "not_sent",
		callCode: "terminal_finished",
		message:
			"Target terminal has already finished (kind: finished); no input was sent.",
		preSendMessage:
			"Target terminal has already finished (kind: finished); no input was sent.",
	},
	not_found: {
		kind: "not_found",
		sendCertainty: "not_sent",
		callCode: "target_not_found",
		message:
			"hc target terminal was not found (kind: not_found); no input was sent.",
		preSendMessage:
			"hc target terminal was not found (kind: not_found); no input was sent.",
	},
	machine_unknown: {
		kind: "machine_unknown",
		sendCertainty: "not_sent",
		callCode: "machine_unknown",
		message:
			"hc target machine is unknown (kind: machine_unknown); no input was sent.",
		preSendMessage:
			"hc target machine is unknown (kind: machine_unknown); no input was sent.",
	},
	invalid_params: {
		kind: "invalid_params",
		sendCertainty: "not_sent",
		callCode: "invalid_params",
		message:
			"hc rejected the request parameters (kind: invalid_params); no input was sent.",
		preSendMessage:
			"hc rejected the request parameters (kind: invalid_params); no input was sent.",
	},
	config: {
		kind: "config",
		sendCertainty: "not_sent",
		callCode: "hc_config",
		message:
			"hc configuration error prevented the operation (kind: config); no input was sent.",
		preSendMessage:
			"hc configuration error prevented the operation (kind: config); no input was sent.",
	},
	unavailable: {
		kind: "unavailable",
		sendCertainty: "unknown",
		callCode: "hc_unavailable",
		message:
			"hc core or target was unavailable during send (kind: unavailable); delivery state is unknown. Do not resend.",
		preSendMessage:
			"hc core or target was unavailable before delivery (kind: unavailable); no input was sent.",
	},
	cancelled: {
		kind: "cancelled",
		sendCertainty: "unknown",
		callCode: "hc_cancelled",
		message:
			"hc send was cancelled (kind: cancelled); delivery state is unknown. Do not resend.",
		preSendMessage:
			"hc request was cancelled before delivery (kind: cancelled); no input was sent.",
	},
	needs_target: {
		kind: "needs_target",
		sendCertainty: "unknown",
		callCode: "invalid_params",
		message:
			"hc send failed with an unexpected error kind (needs_target); delivery state is unknown. Do not resend.",
		preSendMessage:
			"hc rejected the request parameters before delivery (kind: needs_target); no input was sent.",
	},
};

export interface HcExecDeps {
	exec: Exec;
	hcBin?: string;
}

export type HcFailureReason =
	| "budget_exhausted"
	| "aborted"
	| "hc_missing"
	| "exec_error"
	| "timeout"
	| "nonzero_exit"
	| "invalid_json";

export interface HcRunOutcome {
	ok: boolean;
	phase: HcPhase;
	code: number | null;
	json?: Json;
	errorKind?: HcErrorKind;
	errorCode?: string;
	message?: string;
	certainty: HcCertainty;
	failureReason?: HcFailureReason;
}

export interface HcTerminalFacts {
	address: string;
	state: "live" | "finished";
	reported: boolean;
	statusState: string | null;
	turn: number;
}

export interface HcWaitFacts {
	terminal: string;
	ended: boolean;
	reason: string;
	status: string | null;
	turn: number;
	exitCode: number | null;
	signal: number | null;
}

export type HcResolveOutcome =
	| {
			ok: true;
			address: string;
			remote: boolean;
	  }
	| {
			ok: false;
			certainty: "not_sent";
			code: string;
			errorKind?: HcErrorKind;
			exitCode?: number;
			message: string;
	  };

export type HcGetOutcome =
	| {
			ok: true;
			facts: HcTerminalFacts;
	  }
	| {
			ok: false;
			certainty: "not_sent";
			code: string;
			errorKind?: HcErrorKind;
			exitCode?: number;
			message: string;
	  };

export type HcSendOutcome =
	| {
			ok: true;
			certainty: "submitted";
			turn: number;
			started: boolean | null;
			status: string | null;
			wait: HcWaitFacts | null | undefined;
			waitValid: boolean;
	  }
	| {
			ok: false;
			certainty: "not_sent" | "unknown";
			code: string;
			errorKind?: HcErrorKind;
			exitCode?: number;
			message: string;
	  };

export type HcWaitOutcome =
	| {
			ok: true;
			certainty: "submitted";
			wait: HcWaitFacts;
	  }
	| {
			ok: false;
			certainty: "submitted";
			code: string;
			errorKind?: HcErrorKind;
			exitCode?: number;
			message: string;
	  };

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

function isMissingExecutable(error: unknown): boolean {
	return (error as { code?: unknown } | undefined)?.code === "ENOENT";
}

export function isValidHcAddress(value: string): boolean {
	return HC_ADDRESS_RE.test(value);
}

export function isRemoteHcAddress(address: string): boolean {
	return address.includes("/");
}

/**
 * Compares canonical terminal addresses. Remote `m/t7` and local `t7` are distinct.
 */
export function isSelf(
	address: string,
	callerId: string | undefined,
): boolean {
	if (!callerId) return false;
	const normAddr = address.trim();
	const normCaller = callerId.trim();
	if (!isValidHcAddress(normAddr) || !isValidHcAddress(normCaller)) {
		return false;
	}
	return normAddr === normCaller;
}

function isAllowedKindForPhase(
	value: string | undefined,
	phase: HcPhase,
): value is HcErrorKind {
	if (!value) return false;
	if (phase === "wait") {
		return HC_WAIT_ERROR_KINDS.has(value as HcErrorKind);
	}
	if (phase === "send") {
		return HC_SEND_ERROR_KINDS.has(value as HcSendErrorKind);
	}
	return HC_PRE_SEND_ERROR_KINDS.has(value as HcSendErrorKind);
}

/**
 * Extracts a phase-recognized `HcErrorKind` from a JSON stderr envelope.
 * Requires `error` to be a non-null plain object and reads `error.kind` -> `error.data.kind`.
 * Bare top-level `kind` or `data.kind` without an `error` object is rejected.
 * Never matches raw message substrings.
 */
export function extractHcErrorKind(
	stderr: string,
	phase: HcPhase = "send",
): HcErrorKind | undefined {
	const parsed = parseJson(stderr);
	if (!parsed) return undefined;
	const errObj = record(parsed.error);
	if (!errObj) return undefined;
	const directKind =
		typeof errObj.kind === "string" ? errObj.kind : undefined;
	if (isAllowedKindForPhase(directKind, phase)) {
		return directKind;
	}
	const dataObj = record(errObj.data);
	const nestedKind =
		typeof dataObj?.kind === "string" ? dataObj.kind : undefined;
	if (isAllowedKindForPhase(nestedKind, phase)) {
		return nestedKind;
	}
	return undefined;
}

function inferPhase(args: string[]): HcPhase {
	const sub = args[0];
	if (sub === "get") return "get";
	if (sub === "send") return "send";
	if (sub === "wait") return "wait";
	return "lookup";
}

function classifyHcFailure(
	phase: HcPhase,
	failureReason: HcFailureReason,
	code: number | null,
	errorKind?: HcErrorKind,
	spawned = true,
): HcRunOutcome {
	if (phase === "wait") {
		let errorCode = "hc_unavailable";
		let message =
			"hc wait is unavailable after prompt submission; the prompt was already submitted. Do not resend.";
		switch (failureReason) {
			case "aborted":
				errorCode = "aborted";
				message =
					"Local wait aborted after prompt submission; the target may still be running. Do not resend.";
				break;
			case "budget_exhausted":
			case "timeout":
				errorCode = "timeout";
				message =
					"Call wait budget exhausted after prompt submission; the target may still be running. Do not resend.";
				break;
			case "invalid_json":
				errorCode = "protocol";
				message =
					"hc wait returned a malformed response after prompt submission; answer recovery skipped.";
				break;
			case "nonzero_exit":
				if (errorKind) {
					errorCode = HC_ERROR_SPECS[errorKind].callCode;
					message = `hc wait failed after prompt submission (kind: ${errorKind}); the prompt was already submitted. Do not resend.`;
				} else {
					errorCode = "hc_unavailable";
					message =
						"hc wait failed after prompt submission; the prompt was already submitted. Do not resend.";
				}
				break;
		}
		return {
			ok: false,
			phase,
			code,
			...(errorKind ? { errorKind } : {}),
			errorCode,
			message,
			certainty: "submitted",
			failureReason,
		};
	}

	if (phase === "send") {
		if (!spawned && failureReason === "aborted") {
			return {
				ok: false,
				phase,
				code,
				errorCode: "aborted",
				message: "Call aborted before delivery.",
				certainty: "not_sent",
				failureReason,
			};
		}
		if (failureReason === "budget_exhausted") {
			return {
				ok: false,
				phase,
				code,
				errorCode: "timeout",
				message: "Call budget exhausted before hc send.",
				certainty: "not_sent",
				failureReason,
			};
		}
		if (failureReason === "hc_missing") {
			return {
				ok: false,
				phase,
				code,
				errorCode: "hc_unavailable",
				message: "hc CLI executable is not available; no input was sent.",
				certainty: "not_sent",
				failureReason,
			};
		}
		if (failureReason === "aborted") {
			return {
				ok: false,
				phase,
				code,
				errorCode: "aborted",
				message:
					"Local wait aborted during hc send; delivery state is unknown and the target may still be running. Do not resend.",
				certainty: "unknown",
				failureReason,
			};
		}
		if (failureReason === "timeout") {
			return {
				ok: false,
				phase,
				code,
				errorCode: "timeout",
				message:
					"hc send timed out; delivery state is unknown and the target may still be running. Do not resend.",
				certainty: "unknown",
				failureReason,
			};
		}
		if (failureReason === "invalid_json") {
			return {
				ok: false,
				phase,
				code,
				errorCode: "protocol_error",
				message:
					"hc send returned a malformed response; delivery state is unknown. Do not resend.",
				certainty: "unknown",
				failureReason,
			};
		}
		if (failureReason === "nonzero_exit") {
			if (errorKind && HC_SEND_ERROR_KINDS.has(errorKind as HcSendErrorKind)) {
				const spec = HC_ERROR_SPECS[errorKind];
				const certainty: "not_sent" | "unknown" = HC_SEND_NOT_SENT_KINDS.has(
					errorKind as HcSendNotSentKind,
				)
					? "not_sent"
					: "unknown";
				return {
					ok: false,
					phase,
					code,
					errorKind,
					errorCode: spec.callCode,
					message: spec.message,
					certainty,
					failureReason,
				};
			}
			return {
				ok: false,
				phase,
				code,
				errorCode: "prompt_failed",
				message:
					"hc send failed with an unrecognized error; delivery state is unknown. Do not resend.",
				certainty: "unknown",
				failureReason,
			};
		}
		return {
			ok: false,
			phase,
			code,
			errorCode: "hc_unavailable",
			message:
				"hc send failed during execution; delivery state is unknown. Do not resend.",
			certainty: "unknown",
			failureReason,
		};
	}

	// Pre-send phases (`lookup` / `get`): certainty is always `not_sent` and messages never claim unknown delivery.
	const op = phase === "lookup" ? "ls" : "get";
	let errorCode = "hc_unavailable";
	let message = `hc ${op} is unavailable; no input was sent.`;
	switch (failureReason) {
		case "aborted":
			errorCode = "aborted";
			message = "Call aborted before delivery.";
			break;
		case "budget_exhausted":
		case "timeout":
			errorCode = "timeout";
			message = `hc ${op} timed out before delivery; no input was sent.`;
			break;
		case "hc_missing":
			errorCode = "hc_unavailable";
			message = "hc CLI executable is not available; no input was sent.";
			break;
		case "invalid_json":
			errorCode = "protocol_error";
			message = `hc ${op} returned an invalid JSON response; no input was sent.`;
			break;
		case "nonzero_exit":
			if (errorKind) {
				const spec = HC_ERROR_SPECS[errorKind];
				errorCode = spec.callCode;
				message = spec.preSendMessage;
			} else {
				errorCode = "hc_unavailable";
				message = `hc ${op} failed before delivery; no input was sent.`;
			}
			break;
	}
	return {
		ok: false,
		phase,
		code,
		...(errorKind ? { errorKind } : {}),
		errorCode,
		message,
		certainty: "not_sent",
		failureReason,
	};
}

/**
 * Runs one `hc` CLI command with a positive integer ms timeout and classifies
 * delivery certainty, errorCode, and safe message in one place by `phase`.
 */
export async function runHc(
	deps: HcExecDeps,
	args: string[],
	timeoutMs: number,
	signal?: AbortSignal,
	phase: HcPhase = inferPhase(args),
): Promise<HcRunOutcome> {
	if (signal?.aborted) {
		return classifyHcFailure(phase, "aborted", null, undefined, false);
	}
	const timeout = Math.floor(timeoutMs);
	if (!Number.isFinite(timeoutMs) || timeout < 1) {
		return classifyHcFailure(phase, "budget_exhausted", null, undefined, false);
	}

	const hcBin = deps.hcBin?.trim() || "hc";
	let result: ExecResult;
	try {
		result = await deps.exec(hcBin, args, {
			timeout,
			signal,
		});
	} catch (error) {
		const missing = isMissingExecutable(error);
		const reason: HcFailureReason = signal?.aborted
			? "aborted"
			: missing
				? "hc_missing"
				: "exec_error";
		return classifyHcFailure(phase, reason, null, undefined, true);
	}

	if (result.killed) {
		const reason: HcFailureReason = signal?.aborted ? "aborted" : "timeout";
		return classifyHcFailure(phase, reason, result.code, undefined, true);
	}

	if (result.code !== 0) {
		if (signal?.aborted) {
			return classifyHcFailure(phase, "aborted", result.code, undefined, true);
		}
		const errorKind = extractHcErrorKind(result.stderr, phase);
		return classifyHcFailure(
			phase,
			"nonzero_exit",
			result.code,
			errorKind,
			true,
		);
	}

	const json = parseJson(result.stdout);
	if (!json) {
		return classifyHcFailure(
			phase,
			"invalid_json",
			result.code,
			undefined,
			true,
		);
	}

	if (phase === "send") {
		if (
			typeof json.turn !== "number" ||
			!Number.isSafeInteger(json.turn) ||
			json.turn < 0
		) {
			return {
				...classifyHcFailure(
					phase,
					"invalid_json",
					result.code,
					undefined,
					true,
				),
				json,
			};
		}
		return {
			ok: true,
			phase,
			code: result.code,
			json,
			certainty: "submitted",
		};
	}

	return {
		ok: true,
		phase,
		code: result.code,
		json,
		certainty: phase === "wait" ? "submitted" : "not_sent",
	};
}

/**
 * Resolves an explicit `hc` terminal address (`t7` or `machine/t7`) directly,
 * or resolves a terminal name via `hc ls --json` when it matches exactly one entry.
 */
export async function hcResolveTarget(
	deps: HcExecDeps,
	target: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<HcResolveOutcome> {
	const normalized = target.trim();
	if (!normalized) {
		return {
			ok: false,
			certainty: "not_sent",
			code: "invalid_request",
			message: "Target is required.",
		};
	}
	if (normalized.startsWith("-")) {
		return {
			ok: false,
			certainty: "not_sent",
			code: "invalid_request",
			message: "Target must be an hc terminal address or name, not an option.",
		};
	}
	if (isValidHcAddress(normalized)) {
		return {
			ok: true,
			address: normalized,
			remote: isRemoteHcAddress(normalized),
		};
	}
	if (normalized.includes("/") || !HC_NAME_RE.test(normalized)) {
		return {
			ok: false,
			certainty: "not_sent",
			code: "invalid_request",
			message:
				"Target is neither a valid hc terminal address nor a valid terminal name.",
		};
	}

	const outcome = await runHc(
		deps,
		["ls", "--json"],
		timeoutMs,
		signal,
		"lookup",
	);
	if (!outcome.ok) {
		return {
			ok: false,
			certainty: "not_sent",
			code: outcome.errorCode ?? "hc_unavailable",
			...(outcome.errorKind ? { errorKind: outcome.errorKind } : {}),
			...(typeof outcome.code === "number" ? { exitCode: outcome.code } : {}),
			message: outcome.message ?? "hc ls failed before delivery; no input was sent.",
		};
	}

	const terminals = outcome.json?.terminals;
	if (!Array.isArray(terminals)) {
		return {
			ok: false,
			certainty: "not_sent",
			code: "protocol_error",
			exitCode: outcome.code ?? undefined,
			message: "hc ls returned an invalid response.",
		};
	}

	const matches: string[] = [];
	for (const item of terminals) {
		const row = record(item);
		if (
			!row ||
			typeof row.address !== "string" ||
			!isValidHcAddress(row.address) ||
			(row.name !== undefined &&
				row.name !== null &&
				typeof row.name !== "string")
		) {
			return {
				ok: false,
				certainty: "not_sent",
				code: "protocol_error",
				exitCode: outcome.code ?? undefined,
				message: "hc ls returned a malformed terminal entry.",
			};
		}
		if (row.name === normalized) {
			matches.push(row.address);
		}
	}

	if (matches.length === 0) {
		return {
			ok: false,
			certainty: "not_sent",
			code: "target_not_found",
			message:
				"No live hc terminal matched the requested name in the current list (disconnected machines are not searched); pass an explicit terminal address.",
		};
	}
	if (matches.length > 1) {
		return {
			ok: false,
			certainty: "not_sent",
			code: "target_ambiguous",
			message:
				"Multiple hc terminals matched the requested name; pass an explicit terminal address.",
		};
	}

	const address = matches[0]!;
	return {
		ok: true,
		address,
		remote: isRemoteHcAddress(address),
	};
}

/**
 * Fetches one terminal's facts via `hc get --json <addr>` and validates schema fields.
 */
export async function hcGet(
	deps: HcExecDeps,
	address: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<HcGetOutcome> {
	const outcome = await runHc(
		deps,
		["get", "--json", address],
		timeoutMs,
		signal,
		"get",
	);
	if (!outcome.ok) {
		return {
			ok: false,
			certainty: "not_sent",
			code: outcome.errorCode ?? "hc_unavailable",
			...(outcome.errorKind ? { errorKind: outcome.errorKind } : {}),
			...(typeof outcome.code === "number" ? { exitCode: outcome.code } : {}),
			message: outcome.message ?? "hc get failed before delivery; no input was sent.",
		};
	}

	const d = outcome.json;
	if (
		!d ||
		typeof d.address !== "string" ||
		!isValidHcAddress(d.address) ||
		d.address !== address
	) {
		return {
			ok: false,
			certainty: "not_sent",
			code: "protocol_error",
			exitCode: outcome.code ?? undefined,
			message: "hc get returned an invalid or mismatched terminal address.",
		};
	}
	if (d.state !== "live" && d.state !== "finished") {
		return {
			ok: false,
			certainty: "not_sent",
			code: "protocol_error",
			exitCode: outcome.code ?? undefined,
			message: "hc get returned an invalid terminal state.",
		};
	}
	if (d.reported !== undefined && typeof d.reported !== "boolean") {
		return {
			ok: false,
			certainty: "not_sent",
			code: "protocol_error",
			exitCode: outcome.code ?? undefined,
			message: "hc get returned an invalid reported field.",
		};
	}
	if (
		d.turn !== undefined &&
		(typeof d.turn !== "number" ||
			!Number.isSafeInteger(d.turn) ||
			d.turn < 0)
	) {
		return {
			ok: false,
			certainty: "not_sent",
			code: "protocol_error",
			exitCode: outcome.code ?? undefined,
			message: "hc get returned an invalid turn value.",
		};
	}

	let statusState: string | null = null;
	if (d.status !== undefined && d.status !== null) {
		const st = record(d.status);
		if (!st || typeof st.state !== "string" || !st.state) {
			return {
				ok: false,
				certainty: "not_sent",
				code: "protocol_error",
				exitCode: outcome.code ?? undefined,
				message: "hc get returned a malformed status record.",
			};
		}
		if (
			st.kind !== undefined &&
			st.kind !== null &&
			typeof st.kind !== "string"
		) {
			return {
				ok: false,
				certainty: "not_sent",
				code: "protocol_error",
				exitCode: outcome.code ?? undefined,
				message: "hc get returned a malformed status kind.",
			};
		}
		statusState = st.state;
	}

	return {
		ok: true,
		facts: {
			address: d.address,
			state: d.state,
			reported: d.reported === true,
			statusState,
			turn: typeof d.turn === "number" ? d.turn : 0,
		},
	};
}

export function parseWaitFacts(raw: unknown): {
	wait: HcWaitFacts | null | undefined;
	valid: boolean;
} {
	if (raw === undefined) return { wait: undefined, valid: true };
	if (raw === null) return { wait: null, valid: true };
	const w = record(raw);
	if (!w) return { wait: undefined, valid: false };
	if (
		typeof w.terminal !== "string" ||
		!w.terminal ||
		typeof w.ended !== "boolean" ||
		typeof w.reason !== "string" ||
		!w.reason ||
		typeof w.turn !== "number" ||
		!Number.isSafeInteger(w.turn) ||
		w.turn < 0 ||
		!Array.isArray(w.children)
	) {
		return { wait: undefined, valid: false };
	}
	if (
		w.status !== undefined &&
		w.status !== null &&
		typeof w.status !== "string"
	) {
		return { wait: undefined, valid: false };
	}
	if (
		w.exit_code !== undefined &&
		w.exit_code !== null &&
		(typeof w.exit_code !== "number" || !Number.isInteger(w.exit_code))
	) {
		return { wait: undefined, valid: false };
	}
	if (
		w.signal !== undefined &&
		w.signal !== null &&
		(typeof w.signal !== "number" || !Number.isInteger(w.signal))
	) {
		return { wait: undefined, valid: false };
	}
	if (w.from !== undefined && w.from !== null && typeof w.from !== "string") {
		return { wait: undefined, valid: false };
	}
	return {
		valid: true,
		wait: {
			terminal: w.terminal,
			ended: w.ended,
			reason: w.reason,
			status: typeof w.status === "string" ? w.status : null,
			turn: w.turn,
			exitCode: typeof w.exit_code === "number" ? w.exit_code : null,
			signal: typeof w.signal === "number" ? w.signal : null,
		},
	};
}

/**
 * Executes `hc send --json --if idle [--wait --timeout <sec>] <addr> <text>`.
 * Rejects text starting with `-` before spawning (no `--` insertion).
 * Never uses `--force` and never sends extra keys.
 */
export async function hcSend(
	deps: HcExecDeps,
	address: string,
	text: string,
	options: { wait?: boolean; timeoutSec?: number },
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<HcSendOutcome> {
	if (text.startsWith("-")) {
		return {
			ok: false,
			certainty: "not_sent",
			code: "invalid_request",
			message: "text starting with '-' unsupported on hc",
		};
	}

	const args = ["send", "--json", "--if", "idle"];
	if (options.wait) {
		const sec = Math.max(1, Math.ceil(options.timeoutSec ?? 1));
		args.push("--wait", "--timeout", String(sec));
	}
	args.push(address, text);

	const outcome = await runHc(deps, args, timeoutMs, signal, "send");
	if (!outcome.ok) {
		return {
			ok: false,
			certainty: outcome.certainty === "not_sent" ? "not_sent" : "unknown",
			code: outcome.errorCode ?? "hc_unavailable",
			...(outcome.errorKind ? { errorKind: outcome.errorKind } : {}),
			...(typeof outcome.code === "number" ? { exitCode: outcome.code } : {}),
			message:
				outcome.message ??
				"hc send failed during execution; delivery state is unknown. Do not resend.",
		};
	}

	const d = outcome.json!;
	if (
		d.started !== undefined &&
		d.started !== null &&
		typeof d.started !== "boolean"
	) {
		return {
			ok: false,
			certainty: "unknown",
			code: "protocol_error",
			exitCode: outcome.code ?? undefined,
			message:
				"hc send returned an invalid started field; delivery state is unknown. Do not resend.",
		};
	}
	if (
		d.status !== undefined &&
		d.status !== null &&
		typeof d.status !== "string"
	) {
		return {
			ok: false,
			certainty: "unknown",
			code: "protocol_error",
			exitCode: outcome.code ?? undefined,
			message:
				"hc send returned an invalid status field; delivery state is unknown. Do not resend.",
		};
	}

	const parsedWait = parseWaitFacts(d.wait);
	return {
		ok: true,
		certainty: "submitted",
		turn: d.turn as number,
		started: typeof d.started === "boolean" ? d.started : null,
		status: typeof d.status === "string" ? d.status : null,
		wait: parsedWait.wait,
		waitValid: parsedWait.valid,
	};
}

/**
 * Executes `hc wait --json <addr> --timeout <sec>` after a confirmed `hc send`
 * submission (`certainty` is always `submitted`).
 */
export async function hcWait(
	deps: HcExecDeps,
	address: string,
	timeoutSec: number,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<HcWaitOutcome> {
	const sec = Math.max(1, Math.ceil(timeoutSec));
	const outcome = await runHc(
		deps,
		["wait", "--json", address, "--timeout", String(sec)],
		timeoutMs,
		signal,
		"wait",
	);
	if (!outcome.ok) {
		return {
			ok: false,
			certainty: "submitted",
			code: outcome.errorCode ?? "hc_unavailable",
			...(outcome.errorKind ? { errorKind: outcome.errorKind } : {}),
			...(typeof outcome.code === "number" ? { exitCode: outcome.code } : {}),
			message:
				outcome.message ??
				"hc wait is unavailable after prompt submission; the prompt was already submitted. Do not resend.",
		};
	}

	const parsedWait = parseWaitFacts(outcome.json);
	if (!parsedWait.valid || !parsedWait.wait) {
		return {
			ok: false,
			certainty: "submitted",
			code: "protocol",
			exitCode: outcome.code ?? undefined,
			message:
				"hc wait returned an invalid WaitResult after prompt submission; answer recovery skipped.",
		};
	}

	return {
		ok: true,
		certainty: "submitted",
		wait: parsedWait.wait,
	};
}
