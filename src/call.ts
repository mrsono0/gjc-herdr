import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExecResult } from "@gajae-code/coding-agent";

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

export const USAGE = "Usage: /herdr-call <pane-id-or-unique-agent-name> <text>";

export interface AgentCallRequest {
	target: string;
	text: string;
}

export interface AgentCallDeps {
	exec: Exec;
	herdrBin: string;
	/** Canonical pane IDs with an in-flight call in this plugin instance. */
	inFlight: Set<string>;
}

export interface PreflightAgent {
	paneId: string;
	terminalId: string;
	state: "idle" | "working" | "blocked" | "done" | "unknown";
	launchPending: boolean;
	/** Diagnostic only; the registered/detected verdict stays with Herdr's gate. */
	agentLabel?: string;
}

export type AgentCallStatus =
	| "not_sent"
	| "blocked"
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
	capture?: string;
	error?: {
		code: string;
		message: string;
		herdrCode?: string;
		exitCode?: number;
	};
	elapsedMs: number;
}

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
	if (timeoutMs <= 0) {
		throw new CallFailure({
			status: "not_sent",
			delivery: "not_sent",
			error: { code: "timeout", message: "Call budget exhausted." },
		});
	}
	let result: ExecResult;
	try {
		result = await deps.exec(deps.herdrBin, args, {
			timeout: timeoutMs,
			signal,
		});
	} catch (error) {
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
): Promise<string> {
	if (PANE_ID.test(target)) return target;
	const result = await runHerdr(
		deps,
		["agent", "list"],
		Math.min(LOOKUP_TIMEOUT_MS, deadline - Date.now()),
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
	return paneId;
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
): Promise<PreflightAgent> {
	const result = await runHerdr(
		deps,
		["agent", "get", paneId],
		Math.min(LOOKUP_TIMEOUT_MS, deadline - Date.now()),
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
		agentLabel: typeof agent.agent === "string" ? agent.agent : undefined,
	};
}

function markerInstruction(requestId: string): string {
	return (
		`\n\nAnswer with the exact token GJC_HERDR_BEGIN_${requestId} on the first line ` +
		`of your final answer and GJC_HERDR_END_${requestId} on the last line.`
	);
}

/**
 * Extracts the answer between the anchored marker lines for this request.
 * Exactly one ordered pair with non-empty body qualifies; anything else is
 * undefined so the caller reports an unverified capture instead of guessing.
 */
export function extractMarkedAnswer(
	capture: string,
	requestId: string,
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
	let beginIndex = -1;
	let endIndex = -1;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (begin.test(line)) {
			if (beginIndex !== -1) return undefined;
			beginIndex = index;
		} else if (end.test(line)) {
			if (beginIndex === -1 || endIndex !== -1) return undefined;
			endIndex = index;
		}
	}
	if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
		return undefined;
	}
	const body = lines.slice(beginIndex + 1, endIndex);
	if (!body.some((line) => line.trim())) return undefined;
	// Strip the UI's uniform body indentation (Claude Code indents answer
	// lines under the bullet) while preserving relative formatting.
	const indents = body
		.filter((line) => line.trim())
		.map((line) => /^[ \t]*/.exec(line)![0]!);
	const common = indents.reduce((a, b) => (b.length < a.length ? b : a));
	return body.map((line) => line.slice(common.length)).join("\n");
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
	const startedAt = Date.now();
	const deadline = startedAt + CALL_BUDGET_MS;
	const requestId = randomUUID();
	const finish = (
		partial: Partial<AgentCallResult> & { status: AgentCallStatus; delivery: DeliveryCertainty },
	): AgentCallResult => ({
		ok: false,
		requestId,
		elapsedMs: Date.now() - startedAt,
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
	if (signal?.aborted) {
		return finish({
			status: "not_sent",
			delivery: "not_sent",
			error: { code: "aborted", message: "Call aborted before delivery." },
		});
	}

	try {
		const paneId = await resolveTargetPaneId(deps, target, deadline, signal);
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
			const preflight = await getPreflightAgent(deps, paneId, deadline, signal);
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
			if (preflight.state === "working") {
				return finish({
					status: "not_sent",
					delivery: "not_sent",
					pane: paneId,
					state: preflight.state,
					error: {
						code: "target_busy",
						message: "Target agent is already working; not interrupted.",
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

			const promptBudget = deadline - Date.now() - READ_RESERVE_MS;
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
				request.text + markerInstruction(requestId);
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
				deadline - Date.now(),
				signal,
				"prompt",
			);
			if (prompt.code === 2) throw usageFailure(prompt, "agent prompt");
			if (prompt.code !== 0) {
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

			const readRemaining = deadline - Date.now();
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
			const answer = extractMarkedAnswer(capture, requestId);
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
				elapsedMs: Date.now() - startedAt,
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

/** Parses `<target> <text>`; everything after the target's single separator is kept verbatim. */
export function parseCallCommandArgs(args: string): AgentCallRequest | string {
	const rest = args.replace(/^\s+/, "");
	if (rest.startsWith("-")) return USAGE;
	const match = /^(\S+)(?:\s([\s\S]*))?$/.exec(rest);
	if (!match) return USAGE;
	return { target: match[1]!, text: match[2] ?? "" };
}

export function describeCallResult(result: AgentCallResult): string {
	const header = `herdr-call ${result.status} (delivery ${result.delivery}, request ${result.requestId}${result.pane ? `, pane ${result.pane}` : ""})`;
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
		});
	}

	api.registerCommand("herdr-call", {
		description:
			"Call a Herdr-registered agent in another pane and get its answer back: <pane-id-or-unique-agent-name> <text>",
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
			"One prompt with a bounded wait (60s total budget) and one bounded screen read (200 lines); the answer is recovered from " +
			"per-request marker lines, and anything less is returned as an unverified capture instead of a success. " +
			"No remote approvals, key presses, or retries are ever sent. For GJC targets use the existing herdr_send tool instead.",
		parameters: z.object({
			target: z
				.string()
				.describe("Target Herdr pane ID (e.g. wC:p2) or unique agent name"),
			text: z.string().describe("Prompt text to deliver verbatim"),
		}),
		async execute(_toolCallId: string, params, signal) {
			const result = await callRegisteredAgent(
				deps,
				{ target: params.target, text: params.text },
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
