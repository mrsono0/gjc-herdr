import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs/promises";
import test, { afterEach } from "node:test";
import type { ExecResult, ExtensionAPI } from "@gajae-code/coding-agent";
import {
	callRegisteredAgent,
	describeCallResult,
	extractMarkedAnswer,
	parseCallCommandArgs,
	registerCallFeatures,
	USAGE,
	type AgentCallDeps,
	type AgentCallResult,
	type ResultFileHandle,
	type ResultFileReadResult,
	type ResultFileStat,
} from "../src/call.ts";

const SENDER_PANE = "wE:p1";
const TARGET_PANE = "wE:p2";
const TERMINAL = "term_test01";
const RULE_LINE = "─".repeat(60);
const EMPTY_CLAUDE = `✻ Churned for 8s\n${RULE_LINE}\n❯\n${RULE_LINE}\n  -- INSERT -- ⏵⏵ auto mode on`;
const TYPING_CLAUDE = `${RULE_LINE}\n❯ 권고 내용으로 적\n${RULE_LINE}\n  -- INSERT --`;

type ExecOptions = Parameters<ExtensionAPI["exec"]>[2];
type Handler = (args: string[], options: ExecOptions) => Partial<ExecResult> | Error;
const timeoutViolations: string[] = [];

afterEach(() => {
	assert.deepEqual(timeoutViolations.splice(0), [], "Mock exec received an invalid timeout");
});

function assertExecTimeout(timeout: number | undefined): void {
	if (timeout === undefined) return;
	const valid = Number.isInteger(timeout) && timeout > 0;
	if (!valid) timeoutViolations.push(`timeout=${timeout}`);
	assert(valid, `exec timeout must be a positive integer: ${timeout}`);
}

function ok(body: unknown): Partial<ExecResult> {
	return { stdout: JSON.stringify(body) };
}

function herdrError(code: string, message: string): Partial<ExecResult> {
	return { code: 1, stderr: JSON.stringify({ error: { code, message } }) };
}

function agentGet(state: string, extra: Record<string, unknown> = {}) {
	return ok({
		result: {
			type: "agent_info",
			agent: {
				agent: "claude",
				agent_status: state,
				pane_id: TARGET_PANE,
				terminal_id: TERMINAL,
				...extra,
			},
		},
	});
}

function agentPrompted(state: string) {
	return ok({
		result: {
			type: "agent_prompted",
			agent: {
				agent: "claude",
				agent_status: state,
				pane_id: TARGET_PANE,
				terminal_id: TERMINAL,
			},
		},
	});
}

/** Routes `herdr <group> <verb>` calls; unrouted calls fail the test. */
function fakeExec(routes: Record<string, Handler>) {
	let clock = 0;
	const calls: { command: string; args: string[]; options: ExecOptions }[] = [];
	const handlers: Record<string, Handler> = { "herdr pane read": () => ({ stdout: EMPTY_CLAUDE }), ...routes };
	const exec: AgentCallDeps["exec"] = async (command, args, options) => {
		assertExecTimeout(options?.timeout);
		calls.push({ command, args, options });
		const key = `${command} ${args[0]} ${args[1]}`;
		const handler = handlers[key];
		assert(handler, `unexpected exec ${command} ${args.join(" ")}`);
		const result = handler(args, options);
		if (result instanceof Error) throw result;
		return { stdout: "", stderr: "", code: 0, killed: false, ...result };
	};
	const count = (key: string) =>
		calls.filter(({ command, args }) => `${command} ${args[0]} ${args[1]}` === key)
			.length;
	const advance = (ms: number) => { clock += ms; };
	const deps: AgentCallDeps = {
		exec, herdrBin: "herdr", inFlight: new Set(), now: () => clock,
		sleep: async (ms) => advance(ms),
	};
	return { deps, calls, count, advance };
}

function answerScreen(requestId: string, body: string): Partial<ExecResult> {
	return { stdout: `old text\n  GJC_HERDR_BEGIN_${requestId}x ignored\nGJC_HERDR_BEGIN_${requestId}\n${body}\nGJC_HERDR_END_${requestId}\n` };
}

test("command parsing keeps text verbatim and rejects option-like targets", () => {
	assert.deepEqual(parseCallCommandArgs("wE:p2 hello"), {
		target: "wE:p2",
		text: "hello",
	});
	assert.deepEqual(parseCallCommandArgs('  reviewer  say "hi" --raw\nline2'), {
		target: "reviewer",
		text: ' say "hi" --raw\nline2',
	});
	assert.equal(parseCallCommandArgs("--current wE:p2 x"), USAGE);
	assert.equal(parseCallCommandArgs("  "), USAGE);
});

test("invalid requests are rejected before any exec", async () => {
	for (const [request, code] of [
		[{ target: " ", text: "x" }, "invalid_request"],
		[{ target: "--current", text: "x" }, "invalid_request"],
		[{ target: TARGET_PANE, text: " \n" }, "invalid_request"],
	] as const) {
		const { deps, calls } = fakeExec({});
		const result = await callRegisteredAgent(deps, request, SENDER_PANE);
		assert.equal(result.status, "not_sent");
		assert.equal(result.error?.code, code);
		assert.equal(calls.length, 0);
	}
});

test("a pane-ID call prompts once, reads plain stdout, and returns the marked answer", async () => {
	let requestId = "";
	const { deps, calls, count } = fakeExec({
		"herdr agent get": () => agentGet("idle"),
		"herdr agent prompt": (args) => {
			requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3])![1]!;
			return agentPrompted("done");
		},
		"herdr agent read": (args) => {
			assert.deepEqual(args, [
				"agent",
				"read",
				TARGET_PANE,
				"--source",
				"recent-unwrapped",
				"--lines",
				"200",
			]);
			return answerScreen(requestId, "the actual answer\nsecond line");
		},
	});
	const text = '  line1\n"quoted" --wait  ';
	const result = await callRegisteredAgent(
		deps,
		{ target: TARGET_PANE, text },
		SENDER_PANE,
	);
	assert.equal(result.ok, true);
	assert.equal(result.status, "answered");
	assert.equal(result.delivery, "submitted");
	assert.equal(result.pane, TARGET_PANE);
	assert.equal(result.answer, "the actual answer\nsecond line");
	assert.equal(count("herdr agent get"), 1);
	assert.equal(count("herdr agent prompt"), 1);
	assert.equal(count("herdr agent read"), 1);
	// Prompt argv: target and patched text are the first two positionals; no "--" delimiter.
	const prompt = calls.find((call) => call.args[1] === "prompt")!;
	assert.equal(prompt.args[0], "agent");
	assert.equal(prompt.args[1], "prompt");
	assert.equal(prompt.args[2], TARGET_PANE);
	assert.ok(prompt.args[3]!.startsWith(text));
	assert.match(prompt.args[3]!, /GJC_HERDR_BEGIN_[0-9a-f-]{36}/);
	assert.equal(prompt.args[4], "--wait");
	assert.equal(prompt.args[5], "--timeout");
	assert.ok(Number(prompt.args[6]) > 0);
	assert.ok(!prompt.args.includes("--"));
});

test("self targets and in-flight panes are refused without any CLI call", async () => {
	const { deps, calls } = fakeExec({
		"herdr agent get": () => agentGet("idle"),
	});
	const self = await callRegisteredAgent(
		deps,
		{ target: SENDER_PANE, text: "x" },
		SENDER_PANE,
	);
	assert.equal(self.error?.code, "self_target");
	assert.equal(calls.length, 0);

	deps.inFlight.add(TARGET_PANE);
	const busy = await callRegisteredAgent(
		deps,
		{ target: TARGET_PANE, text: "x" },
		SENDER_PANE,
	);
	assert.equal(busy.error?.code, "target_busy");
	assert.equal(busy.delivery, "not_sent");
	assert.equal(calls.length, 0);
	deps.inFlight.delete(TARGET_PANE);
});

test("in-flight barrier serializes calls and releases on completion", async () => {
	const { deps } = fakeExec({
		"herdr agent get": () => agentGet("idle"),
		"herdr agent prompt": () => agentPrompted("idle"),
		"herdr agent read": () => ({ stdout: "no markers here" }),
	});
	let release: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const exec = deps.exec;
	deps.exec = async (command, args, options) => {
		if (args[1] === "get") await gate;
		return exec(command, args, options);
	};
	const first = callRegisteredAgent(deps, { target: TARGET_PANE, text: "x" }, SENDER_PANE);
	await new Promise((resolve) => setTimeout(resolve, 5));
	const second = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "y" }, SENDER_PANE);
	assert.equal(second.error?.code, "target_busy");
	release!();
	const firstResult = await first;
	assert.equal(firstResult.status, "response_unverified");
	const third = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "z" }, SENDER_PANE);
	assert.notEqual(third.error?.code, "target_busy");
});

test("preflight states gate the call before any prompt", async () => {
	for (const [state, extra, code] of [
		["blocked", {}, "agent_blocked"],
		["working", {}, "target_busy"],
		["unknown", {}, "target_state_unknown"],
		["idle", { launch_pending: true }, "target_not_ready"],
	] as const) {
		const { deps, calls, count } = fakeExec({
			"herdr agent get": () => agentGet(state, extra),
		});
		deps.inputWaitMs = 0;
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "x" },
			SENDER_PANE,
		);
		assert.equal(result.status, state === "blocked" ? "blocked" : "not_sent");
		assert.equal(result.delivery, "not_sent");
		assert.equal(result.error?.code, code);
		assert.equal(count("herdr agent get"), 1);
		assert.equal(count("herdr agent prompt"), 0);
		assert.equal(calls.length, 2); // pane read (input box) + agent get
	}
});

test("unique-name targets resolve through one agent list", async () => {
	const { deps, count } = fakeExec({
		"herdr agent list": () =>
			ok({
				result: {
					type: "agent_list",
					agents: [
						{ agent: "claude", agent_status: "idle", pane_id: "wE:p9" },
						{ name: "reviewer", agent: "codex", agent_status: "idle", pane_id: "wE:p3" },
					],
				},
			}),
		"herdr agent get": () =>
			ok({
				result: {
					type: "agent_info",
					agent: {
						agent: "codex",
						agent_status: "idle",
						pane_id: "wE:p3",
						terminal_id: "term_x",
					},
				},
			}),
		"herdr agent prompt": () =>
			ok({
				result: {
					type: "agent_prompted",
					agent: {
						agent: "codex",
						agent_status: "idle",
						pane_id: "wE:p3",
						terminal_id: "term_x",
					},
				},
			}),
		"herdr agent read": () => ({ stdout: "screen without markers" }),
	});
	const result = await callRegisteredAgent(
		deps,
		{ target: "reviewer", text: "x" },
		SENDER_PANE,
	);
	assert.equal(result.pane, "wE:p3");
	assert.equal(result.status, "response_unverified");
	assert.equal(count("herdr agent list"), 1);
});

test("ambiguous and unknown names never auto-select", async () => {
	for (const [agents, code] of [
		[[{ name: "reviewer", pane_id: "wE:p3" }, { name: "reviewer", pane_id: "wE:p4" }], "target_ambiguous"],
		[[{ name: "other", pane_id: "wE:p3" }], "target_not_found"],
	] as const) {
		const { deps, count } = fakeExec({
			"herdr agent list": () =>
				ok({ result: { type: "agent_list", agents } }),
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: "reviewer", text: "x" },
			SENDER_PANE,
		);
		assert.equal(result.error?.code, code);
		assert.equal(result.delivery, "not_sent");
		assert.equal(count("herdr agent get"), 0);
	}
});

test("reported-only rejection at prompt time maps to not_sent with zero reads", async () => {
	const { deps, count } = fakeExec({
		"herdr agent get": () =>
			agentGet("idle", { agent: "gjc" }),
		"herdr agent prompt": () =>
			herdrError("agent_not_ready", `agent ${TARGET_PANE} is not an active named agent`),
	});
	const result = await callRegisteredAgent(
		deps,
		{ target: TARGET_PANE, text: "x" },
		SENDER_PANE,
	);
	assert.equal(result.status, "not_sent");
	assert.equal(result.delivery, "not_sent");
	assert.equal(result.error?.code, "target_not_ready");
	assert.equal(result.error?.herdrCode, "agent_not_ready");
	assert.match(result.error!.message, /herdr_send/);
	assert.equal(count("herdr agent read"), 0);
});

test("known pre-send blocked and post-send states stay distinct", async () => {
	const pre = fakeExec({
		"herdr agent get": () => agentGet("idle"),
		"herdr agent prompt": () => herdrError("agent_blocked", "agent is blocked"),
	});
	const preResult = await callRegisteredAgent(
		pre.deps,
		{ target: TARGET_PANE, text: "x" },
		SENDER_PANE,
	);
	assert.equal(preResult.status, "blocked");
	assert.equal(preResult.delivery, "not_sent");

	const post = fakeExec({
		"herdr agent get": () => agentGet("idle"),
		"herdr agent prompt": () => agentPrompted("blocked"),
	});
	const postResult = await callRegisteredAgent(
		post.deps,
		{ target: TARGET_PANE, text: "x" },
		SENDER_PANE,
	);
	assert.equal(postResult.status, "blocked");
	assert.equal(postResult.delivery, "submitted");
});

test("stalled, timeout, and unknown prompt failures keep their certainty", async () => {
	for (const [envelope, status, delivery, code] of [
		["agent_prompt_stalled", "stalled", "submitted", "agent_prompt_stalled"],
		["timeout", "uncertain", "unknown", "timeout"],
		["agent_prompt_failed", "uncertain", "unknown", "prompt_failed"],
	] as const) {
		const { deps, count } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": () => herdrError(envelope, "boom"),
			"herdr agent read": () => ({ stdout: "" }),
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "x" },
			SENDER_PANE,
		);
		assert.equal(result.status, status);
		assert.equal(result.delivery, delivery);
		assert.equal(result.error?.code, code);
		assert.equal(result.error?.herdrCode, envelope);
		assert.equal(count("herdr agent read"), envelope === "timeout" ? 1 : 0);
	}
});

test("malformed or mismatched prompt success is never treated as an answer", async () => {
	const malformed = fakeExec({
		"herdr agent get": () => agentGet("idle"),
		"herdr agent prompt": () => ({ stdout: "not json" }),
	});
	const malformedResult = await callRegisteredAgent(
		malformed.deps,
		{ target: TARGET_PANE, text: "x" },
		SENDER_PANE,
	);
	assert.equal(malformedResult.status, "uncertain");
	assert.equal(malformedResult.delivery, "unknown");
	assert.equal(malformedResult.error?.code, "protocol_error");

	const mismatch = fakeExec({
		"herdr agent get": () => agentGet("idle"),
		"herdr agent prompt": () =>
			ok({
				result: {
					type: "agent_prompted",
					agent: {
						agent_status: "idle",
						pane_id: TARGET_PANE,
						terminal_id: "term_other",
					},
				},
			}),
	});
	const mismatchResult = await callRegisteredAgent(
		mismatch.deps,
		{ target: TARGET_PANE, text: "x" },
		SENDER_PANE,
	);
	assert.equal(mismatchResult.status, "uncertain");
	assert.equal(mismatchResult.error?.code, "protocol_error");
});

test("read failures and empty captures separate delivery from recovery", async () => {
	const failed = fakeExec({
		"herdr agent get": () => agentGet("idle"),
		"herdr agent prompt": () => agentPrompted("idle"),
		"herdr agent read": () => herdrError("agent_read_failed", "boom"),
	});
	const failedResult = await callRegisteredAgent(
		failed.deps,
		{ target: TARGET_PANE, text: "x" },
		SENDER_PANE,
	);
	assert.equal(failedResult.status, "read_failed");
	assert.equal(failedResult.delivery, "submitted");
	assert.equal(failedResult.error?.herdrCode, "agent_read_failed");

	const empty = fakeExec({
		"herdr agent get": () => agentGet("idle"),
		"herdr agent prompt": () => agentPrompted("idle"),
		"herdr agent read": () => ({ stdout: "" }),
	});
	const emptyResult = await callRegisteredAgent(
		empty.deps,
		{ target: TARGET_PANE, text: "x" },
		SENDER_PANE,
	);
	assert.equal(emptyResult.status, "response_unverified");
	assert.equal(emptyResult.error?.code, "empty_response");
});

test("marker extraction only accepts one anchored, ordered, non-empty pair", () => {
	const id = "req-1";
	const body = "line1\n  code `x`\nline3";
	assert.equal(
		extractMarkedAnswer(`noise\nGJC_HERDR_BEGIN_${id}\n${body}\nGJC_HERDR_END_${id}\ntail`, id),
		body,
	);
	assert.equal(extractMarkedAnswer(`  GJC_HERDR_BEGIN_${id}  \n${body}\nGJC_HERDR_END_${id}`, id), body);
	// Terminal UI decorations: Claude Code bullet + indented body dedents to the answer.
	assert.equal(
		extractMarkedAnswer(`⏺ GJC_HERDR_BEGIN_${id}\n  42\n  GJC_HERDR_END_${id}`, id),
		"42",
	);
	assert.equal(
		extractMarkedAnswer(`> GJC_HERDR_BEGIN_${id}\n- GJC_HERDR_END_${id}`, id),
		undefined,
	);
	for (const capture of [
		`GJC_HERDR_BEGIN_${id} inline\n${body}\nGJC_HERDR_END_${id}`,
		`prefix GJC_HERDR_BEGIN_${id}\n${body}\nGJC_HERDR_END_${id}`,
		`GJC_HERDR_BEGIN_${id}\n${body}`,
		`GJC_HERDR_END_${id}\n${body}\nGJC_HERDR_BEGIN_${id}`,
		`GJC_HERDR_BEGIN_${id}\n${body}\nGJC_HERDR_BEGIN_${id}\nmore\nGJC_HERDR_END_${id}`,
		`GJC_HERDR_BEGIN_${id}\n\n   \nGJC_HERDR_END_${id}`,
		`GJC_HERDR_BEGIN_other\n${body}\nGJC_HERDR_END_${id}`,
	]) {
		assert.equal(extractMarkedAnswer(capture, id), undefined, capture);
	}
});

test("aborts before delivery are not_sent", async () => {
	const { deps, calls } = fakeExec({
		"herdr agent get": () => agentGet("idle"),
	});
	const controller = new AbortController();
	controller.abort();
	const result = await callRegisteredAgent(
		deps,
		{ target: TARGET_PANE, text: "x" },
		SENDER_PANE,
		controller.signal,
	);
	assert.equal(result.status, "not_sent");
	assert.equal(result.error?.code, "aborted");
	assert.equal(calls.length, 0);
});

test("registration wires command, tool, sendMessage, and logger summary", async () => {
	const commands: string[] = [];
	const tools: string[] = [];
	const messages: unknown[] = [];
	const logs: unknown[] = [];
	let toolExecute: ((toolCallId: string, params: { target: string; text: string }, signal?: AbortSignal) => Promise<unknown>) | undefined;
	const api = {
		logger: { info(_m: string, data: unknown) { logs.push(data); }, warn() {} },
		exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
		registerCommand(name: string, def: { handler: (args: string) => Promise<void> }) {
			commands.push(name);
			void def.handler("wE:p2 hello");
		},
		registerTool(tool: { name: string; execute: (toolCallId: string, params: { target: string; text: string }, signal?: AbortSignal) => Promise<unknown> }) {
			tools.push(tool.name);
			toolExecute = tool.execute;
		},
		sendMessage: async (message: unknown, options: unknown) => {
			messages.push({ message, options });
		},
		zod: {
			z: {
				object: (shape: unknown) => shape,
				string: () => {
					const field = { optional: () => field, describe: () => field };
					return field;
				},
			},
		},
	} as unknown as ExtensionAPI;
	registerCallFeatures(api, "herdr", SENDER_PANE);
	assert.deepEqual(commands, ["herdr-call"]);
	assert.deepEqual(tools, ["herdr_agent_call"]);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(messages.length, 1);
	const sent = messages[0] as { message: { customType: string; content: string; display: boolean }; options: { triggerTurn: boolean } };
	assert.equal(sent.message.customType, "herdr-call");
	assert.equal(sent.message.display, true);
	assert.ok(sent.message.content.includes("not_sent"));
	assert.equal(sent.options.triggerTurn, false);
	assert.ok(toolExecute);
	toolExecute!("t1", { target: "wE:p2", text: "x" }).then(() => {
		assert.ok(logs.length >= 1);
	});
});

test("describeCallResult labels unverified captures explicitly", () => {
	const answered: AgentCallResult = {
		ok: true,
		status: "answered",
		delivery: "submitted",
		requestId: "r1",
		pane: TARGET_PANE,
		state: "done",
		answer: "42",
		elapsedMs: 5,
	};
	assert.match(describeCallResult(answered), /answered[\s\S]*42/);
	const unverified: AgentCallResult = {
		ok: false,
		status: "response_unverified",
		delivery: "submitted",
		requestId: "r2",
		capture: "partial screen",
		error: { code: "response_unverified", message: "markers missing" },
		elapsedMs: 5,
	};
	const text = describeCallResult(unverified);
	assert.match(text, /Unverified capture/);
	assert.match(text, /partial screen/);
});

test("a typed-in input box delays the prompt until it empties and extends the budget", async () => {
	const screens = [TYPING_CLAUDE, TYPING_CLAUDE, EMPTY_CLAUDE];
	let requestId = "";
	const sleeps: number[] = [];
	const { deps, count, advance } = fakeExec({
		"herdr pane read": () => ({ stdout: screens.shift() ?? EMPTY_CLAUDE }),
		"herdr agent get": () => agentGet("idle", { focused: true }),
		"herdr agent prompt": (args) => {
			requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3])![1]!;
			return agentPrompted("done");
		},
		"herdr agent read": () => answerScreen(requestId, "ok"),
	});
	deps.sleep = async (ms) => { sleeps.push(ms); advance(ms); };
	const result = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(result.ok, true);
	assert.equal(result.waitedMs, 4_000);
	assert.deepEqual(sleeps, [2_000, 2_000]);
	assert.equal(count("herdr pane read"), 3);
	assert.equal(count("herdr agent prompt"), 1);
});

test("an input box that stays typed-in ends as not_sent/target_typing with no prompt", async () => {
	const { deps, count } = fakeExec({
		"herdr pane read": () => ({ stdout: TYPING_CLAUDE }),
	});
	deps.inputWaitMs = 6_000;
	const result = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(result.ok, false);
	assert.equal(result.status, "not_sent");
	assert.equal(result.delivery, "not_sent");
	assert.equal(result.error?.code, "target_typing");
	assert.equal(result.waitedMs, 6_000);
	assert.equal(count("herdr agent get"), 0);
	assert.equal(count("herdr agent prompt"), 0);
	assert.equal(deps.inFlight.size, 0);
});

test("an unreadable input box falls back to the focus rule", async () => {
	const focused = fakeExec({
		"herdr pane read": () => ({ stdout: "$ plain shell\n" }),
		"herdr agent get": () => agentGet("idle", { focused: true }),
	});
	const refused = await callRegisteredAgent(focused.deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(refused.status, "not_sent");
	assert.equal(refused.error?.code, "target_focused");
	assert.equal(focused.count("herdr agent prompt"), 0);

	const failedRead = fakeExec({
		"herdr pane read": () => herdrError("io", "no pane"),
		"herdr agent get": () => agentGet("idle", { focused: true }),
	});
	const alsoRefused = await callRegisteredAgent(failedRead.deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(alsoRefused.error?.code, "target_focused");
});

test("a focused pane with an empty input box is prompted normally", async () => {
	let requestId = "";
	const { deps, count } = fakeExec({
		"herdr pane read": () => ({ stdout: EMPTY_CLAUDE }),
		"herdr agent get": () => agentGet("idle", { focused: true }),
		"herdr agent prompt": (args) => {
			requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3])![1]!;
			return agentPrompted("done");
		},
		"herdr agent read": () => answerScreen(requestId, "ok"),
	});
	const result = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(result.ok, true);
	assert.equal(result.waitedMs, undefined);
	assert.equal(count("herdr agent prompt"), 1);
});

test("default pane-read fixture guards a focused target without unknown fallback", async () => {
	const { deps, count } = fakeExec({
		"herdr agent get": () => agentGet("idle", { focused: true }),
		"herdr agent prompt": () => agentPrompted("done"),
		"herdr agent read": () => ({ stdout: "no answer markers" }),
	});
	const result = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "x" }, SENDER_PANE);
	assert.equal(result.status, "response_unverified");
	assert.equal(count("herdr pane read"), 1);
	assert.equal(count("herdr agent prompt"), 1);
});

test("call aborts during input reads or sleeps never reach preflight and release inFlight", async () => {
	for (const abortDuring of ["read", "sleep"]) {
		const controller = new AbortController();
		const { deps, count, advance } = fakeExec({
			"herdr pane read": () => {
				if (abortDuring === "read") {
					controller.abort();
					return new Error("read aborted");
				}
				return { stdout: TYPING_CLAUDE };
			},
		});
		deps.sleep = async (ms) => { advance(ms); controller.abort(); };
		const result = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "x" }, SENDER_PANE, controller.signal);
		assert.equal(result.status, "not_sent");
		assert.equal(result.delivery, "not_sent");
		assert.equal(result.error?.code, "aborted");
		assert.equal(result.pane, TARGET_PANE);
		assert.equal(count("herdr agent get"), 0);
		assert.equal(count("herdr agent prompt"), 0);
		assert.equal(deps.inFlight.size, 0);
	}
});

test("answer read throw or abort preserves submitted delivery and target pane", async () => {
	for (const abort of [false, true]) {
		const controller = new AbortController();
		const { deps, count } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": () => agentPrompted("done"),
			"herdr agent read": () => {
				if (abort) controller.abort();
				return new Error(abort ? "read aborted" : "spawn EIO");
			},
		});
		const result = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "x" }, SENDER_PANE, controller.signal);
		assert.equal(result.status, "read_failed");
		assert.equal(result.delivery, "submitted");
		assert.equal(result.pane, TARGET_PANE);
		assert.equal(result.error?.code, abort ? "aborted" : "read_failed");
		assert.equal(count("herdr agent prompt"), 1);
		assert.equal(count("herdr agent read"), 1);
		assert.equal(deps.inFlight.size, 0);
	}
});

test("read delays are excluded from the call budget with actual elapsed time", async () => {
	const screens = [TYPING_CLAUDE, EMPTY_CLAUDE];
	let requestId = "";
	const { deps, calls, advance } = fakeExec({
		"herdr pane read": () => {
			advance(900);
			return { stdout: screens.shift() ?? EMPTY_CLAUDE };
		},
		"herdr agent get": () => { advance(300.5); return agentGet("idle"); },
		"herdr agent prompt": (args) => {
			requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3])![1]!;
			advance(100);
			return agentPrompted("done");
		},
		"herdr agent read": () => answerScreen(requestId, "ok"),
	});
	const result = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "x" }, SENDER_PANE);
	assert.equal(result.ok, true);
	assert.equal(result.waitedMs, 3_800);
	assert.equal(result.elapsedMs, 4_200.5);
	const prompt = calls.find(({ args }) => args[1] === "prompt")!;
	assert.match(prompt.args[6], /^\d+$/);
	assert.equal(Number(prompt.args[6]), 56_699);
	assert.equal(prompt.options?.timeout, 59_699);
});

test("a clipped input box is not sent even when the target is unfocused", async () => {
	const { deps, count } = fakeExec({ "herdr pane read": () => ({ stdout: `  draft continuation\n${RULE_LINE}` }) });
	deps.inputWaitMs = 0;
	const result = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "x" }, SENDER_PANE);
	assert.equal(result.error?.code, "target_typing");
	assert.equal(count("herdr agent prompt"), 0);
	assert.equal(deps.inFlight.size, 0);
});

test("fractional list and get budgets reach exec only as positive integers", async () => {
	const { deps, calls } = fakeExec({
		"herdr agent list": () => ok({ result: { agents: [{ name: "reviewer", pane_id: TARGET_PANE }] } }),
		"herdr agent get": () => agentGet("idle"),
	});
	let ticks = 0;
	deps.now = () => ticks++ === 0 ? 0 : 57_000.5;
	const result = await callRegisteredAgent(deps, { target: "reviewer", text: "x" }, SENDER_PANE);
	assert.equal(result.error?.code, "timeout");
	assert.equal(result.delivery, "not_sent");
	assert.deepEqual(calls.filter(({ args }) => args[1] === "list" || args[1] === "get").map(({ options }) => options?.timeout), [2_999, 2_999]);
});

test("fractional answer-read budgets floor or preserve submitted on sub-ms exhaustion", async () => {
	for (const readBudget of [2_998.75, 0.75]) {
		let requestId = "";
		const { deps, calls, count, advance } = fakeExec({
			"herdr agent get": () => { advance(0.25); return agentGet("idle"); },
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3])![1]!;
				advance(60_000 - 0.25 - readBudget);
				return agentPrompted("done");
			},
			"herdr agent read": () => answerScreen(requestId, "ok"),
		});
		const result = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "x" }, SENDER_PANE);
		assert.equal(result.delivery, "submitted");
		assert.equal(result.pane, TARGET_PANE);
		assert.equal(result.status, readBudget < 1 ? "read_failed" : "answered");
		assert.equal(calls.find(({ args }) => args[1] === "prompt")?.options?.timeout, 59_999);
		assert.equal(count("herdr agent read"), readBudget < 1 ? 0 : 1);
		if (readBudget >= 1) assert.equal(calls.find(({ args }) => args[1] === "read" && args[0] === "agent")?.options?.timeout, 2_998);
		else assert.equal(result.error?.code, "timeout");
		assert.equal(deps.inFlight.size, 0);
	}
});

test("positive sub-ms lookup budget uses timeout refusal instead of spawning with zero", async () => {
	const { deps, calls } = fakeExec({});
	let ticks = 0;
	deps.now = () => ticks++ === 0 ? 0 : 59_999.25;
	const result = await callRegisteredAgent(deps, { target: "reviewer", text: "x" }, SENDER_PANE);
	assert.equal(result.status, "not_sent");
	assert.equal(result.error?.code, "timeout");
	assert.equal(calls.length, 0);
});

test("agy-shaped input box is accepted for agy targets and kept typing for non-agy targets", async () => {
	const emptyAgy = `${RULE_LINE}\n>\n${RULE_LINE}\n? for shortcuts                                                 Gemini 4 Argon · hig`;

	let requestId = "";
	const byPane = fakeExec({
		"herdr pane read": () => ({ stdout: emptyAgy }),
		"herdr agent get": () => agentGet("idle", { agent: "agy" }),
		"herdr agent prompt": (args) => {
			requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3])![1]!;
			return agentPrompted("done");
		},
		"herdr agent read": () => answerScreen(requestId, "agy ok"),
	});
	const paneResult = await callRegisteredAgent(byPane.deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(paneResult.ok, true);
	assert.equal(paneResult.status, "answered");
	assert.equal(paneResult.answer, "agy ok");

	let namedRequestId = "";
	const byName = fakeExec({
		"herdr agent list": () =>
			ok({ result: { agents: [{ name: "agy-mate", pane_id: TARGET_PANE, agent: "agy" }] } }),
		"herdr pane read": () => ({ stdout: emptyAgy }),
		"herdr agent get": () => agentGet("idle", { agent: "agy" }),
		"herdr agent prompt": (args) => {
			namedRequestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3])![1]!;
			return agentPrompted("done");
		},
		"herdr agent read": () => answerScreen(namedRequestId, "named agy ok"),
	});
	const namedResult = await callRegisteredAgent(byName.deps, { target: "agy-mate", text: "hi" }, SENDER_PANE);
	assert.equal(namedResult.ok, true);
	assert.equal(byName.count("herdr agent get"), 1);

	const claudeTarget = fakeExec({
		"herdr pane read": () => ({ stdout: emptyAgy }),
		"herdr agent get": () => agentGet("idle", { agent: "claude" }),
	});
	claudeTarget.deps.inputWaitMs = 0;
	const refused = await callRegisteredAgent(claudeTarget.deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(refused.ok, false);
	assert.equal(refused.status, "not_sent");
	assert.equal(refused.error?.code, "target_typing");
	assert.equal(claudeTarget.count("herdr agent prompt"), 0);

	for (const draftScreen of [
		`${RULE_LINE}\n> draft\n${RULE_LINE}\n? for shortcuts`,
		`${RULE_LINE}\n> first line\n  second line\n${RULE_LINE}\n? for shortcuts`,
		`${RULE_LINE}\n>\n  second line\n${RULE_LINE}\n? for shortcuts`,
	]) {
		const typingAgy = fakeExec({
			"herdr pane read": () => ({ stdout: draftScreen }),
		});
		typingAgy.deps.inputWaitMs = 4_000;
		const typingResult = await callRegisteredAgent(typingAgy.deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
		assert.equal(typingResult.ok, false);
		assert.equal(typingResult.status, "not_sent");
		assert.equal(typingResult.error?.code, "target_typing");
		assert.equal(typingAgy.count("herdr agent get"), 0);
		assert.equal(typingAgy.count("herdr agent prompt"), 0);
	}
});

test("lazy agy kind lookup is bounded by remaining input-wait budget and excludes input wait from call deadline", async () => {
	const emptyAgy = `${RULE_LINE}\n>\n${RULE_LINE}\n? for shortcuts                                                 Gemini 4 Argon · hig`;

	const shortWait = fakeExec({
		"herdr pane read": () => {
			shortWait.advance(90);
			return { stdout: emptyAgy };
		},
		"herdr agent get": (_args, options) => {
			shortWait.advance(options?.timeout ?? 0);
			return { killed: true, code: 0, stdout: "", stderr: "" };
		},
	});
	shortWait.deps.inputWaitMs = 100;
	const shortResult = await callRegisteredAgent(shortWait.deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	const getCall = shortWait.calls.find(({ args }) => args[0] === "agent" && args[1] === "get");
	assert.equal(getCall?.options?.timeout, 10);
	assert.equal(shortResult.status, "not_sent");
	assert.equal(shortResult.error?.code, "target_typing");
	assert.equal(shortResult.waitedMs, 100);
	assert.equal(shortResult.elapsedMs, 100);

	const screens = [...Array(35).fill(TYPING_CLAUDE), emptyAgy];
	let requestId = "";
	const longWait = fakeExec({
		"herdr pane read": () => ({ stdout: screens.shift() ?? emptyAgy }),
		"herdr agent get": () => agentGet("idle", { agent: "agy" }),
		"herdr agent prompt": (args) => {
			requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3])![1]!;
			return agentPrompted("done");
		},
		"herdr agent read": () => answerScreen(requestId, "after 70s wait"),
	});
	longWait.deps.inputWaitMs = 120_000;
	const longResult = await callRegisteredAgent(longWait.deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(longResult.ok, true);
	assert.equal(longResult.status, "answered");
	assert.equal(longResult.waitedMs, 70_000);
	assert.equal(longResult.answer, "after 70s wait");
	assert.equal(longWait.count("herdr agent get"), 2);
});

test("a focused pane with an unreadable input box waits until unfocused and then prompts once", async () => {
	let gets = 0;
	let requestId = "";
	const sleeps: number[] = [];
	const { deps, count, advance } = fakeExec({
		"herdr pane read": () => ({ stdout: "$ plain shell\n" }),
		"herdr agent get": () => agentGet("idle", { focused: ++gets < 3 }),
		"herdr agent prompt": (args) => {
			requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3])![1]!;
			return agentPrompted("done");
		},
		"herdr agent read": () => answerScreen(requestId, "unfocused ok"),
	});
	deps.sleep = async (ms) => {
		sleeps.push(ms);
		advance(ms);
	};
	const result = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(result.ok, true);
	assert.equal(result.status, "answered");
	assert.equal(result.answer, "unfocused ok");
	assert.equal(result.waitedMs, 4_000);
	assert.deepEqual(sleeps, [2_000, 2_000]);
	assert.equal(count("herdr pane read"), 3);
	assert.equal(count("herdr agent get"), 3);
	assert.equal(count("herdr agent prompt"), 1);

	const stuck = fakeExec({
		"herdr pane read": () => ({ stdout: "$ plain shell\n" }),
		"herdr agent get": () => agentGet("idle", { focused: true }),
	});
	stuck.deps.inputWaitMs = 6_000;
	const refused = await callRegisteredAgent(stuck.deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(refused.ok, false);
	assert.equal(refused.status, "not_sent");
	assert.equal(refused.delivery, "not_sent");
	assert.equal(refused.error?.code, "target_focused");
	assert.match(refused.error?.message ?? "", /after 6s; not sent\. Retry later\./);
	assert.equal(refused.waitedMs, 6_000);
	assert.equal(stuck.count("herdr agent prompt"), 0);
	assert.equal(stuck.deps.inFlight.size, 0);
});

test("a working target waits until idle and gives up as target_busy when the wait cap expires", async () => {
	const states = ["working", "working", "idle"];
	let requestId = "";
	const sleeps: number[] = [];
	const { deps, count, advance } = fakeExec({
		"herdr agent get": () => agentGet(states.shift() ?? "idle"),
		"herdr agent prompt": (args) => {
			requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3])![1]!;
			return agentPrompted("done");
		},
		"herdr agent read": () => answerScreen(requestId, "now idle"),
	});
	deps.sleep = async (ms) => {
		sleeps.push(ms);
		advance(ms);
	};
	const result = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(result.ok, true);
	assert.equal(result.status, "answered");
	assert.equal(result.answer, "now idle");
	assert.equal(result.waitedMs, 4_000);
	assert.deepEqual(sleeps, [2_000, 2_000]);
	assert.equal(count("herdr agent get"), 3);
	assert.equal(count("herdr agent prompt"), 1);

	const stuck = fakeExec({
		"herdr agent get": () => agentGet("working"),
	});
	stuck.deps.inputWaitMs = 6_000;
	const busy = await callRegisteredAgent(stuck.deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(busy.ok, false);
	assert.equal(busy.status, "not_sent");
	assert.equal(busy.delivery, "not_sent");
	assert.equal(busy.error?.code, "target_busy");
	assert.match(busy.error?.message ?? "", /after 6s; not sent\. Retry later\./);
	assert.equal(busy.waitedMs, 6_000);
	assert.equal(stuck.count("herdr agent prompt"), 0);
	assert.equal(stuck.deps.inFlight.size, 0);
});

test("inputWaitMs = 0 refuses focused-unknown and working targets immediately without sleeping", async () => {
	for (const [screen, state, focused, expectedStatus, code] of [
		["$ plain shell\n", "idle", true, "not_sent", "target_focused"],
		[EMPTY_CLAUDE, "working", false, "not_sent", "target_busy"],
		["$ plain shell\n", "blocked", true, "blocked", "agent_blocked"],
		["$ plain shell\n", "unknown", true, "not_sent", "target_state_unknown"],
	] as const) {
		for (const waitBudget of [0, 6_000]) {
			if (waitBudget > 0 && (code === "target_focused" || code === "target_busy")) continue;
			const sleeps: number[] = [];
			const { deps, count, advance } = fakeExec({
				"herdr pane read": () => ({ stdout: screen }),
				"herdr agent get": () => agentGet(state, { focused }),
			});
			deps.inputWaitMs = waitBudget;
			deps.sleep = async (ms) => {
				sleeps.push(ms);
				advance(ms);
			};
			const result = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
			assert.equal(result.ok, false);
			assert.equal(result.status, expectedStatus);
			assert.equal(result.delivery, "not_sent");
			assert.equal(result.error?.code, code);
			assert.equal(result.waitedMs, undefined);
			assert.equal(sleeps.length, 0);
			assert.equal(count("herdr pane read"), 1);
			assert.equal(count("herdr agent get"), 1);
			assert.equal(count("herdr agent prompt"), 0);
		}
	}
});

test("typing wait and preflight readiness wait share one inputWaitMs cap and do not eat the call budget", async () => {
	const screens = [TYPING_CLAUDE, "$ plain shell\n", EMPTY_CLAUDE, EMPTY_CLAUDE];
	const preflightStates: [string, boolean][] = [
		["idle", true],
		["working", false],
		["idle", false],
	];
	let requestId = "";
	const sleeps: number[] = [];
	const { deps, calls, count, advance } = fakeExec({
		"herdr pane read": () => ({ stdout: screens.shift() ?? EMPTY_CLAUDE }),
		"herdr agent get": () => {
			const [state, focused] = preflightStates.shift() ?? ["idle", false];
			return agentGet(state, { focused });
		},
		"herdr agent prompt": (args) => {
			requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3])![1]!;
			return agentPrompted("done");
		},
		"herdr agent read": () => answerScreen(requestId, "shared budget ok"),
	});
	deps.inputWaitMs = 8_000;
	deps.sleep = async (ms) => {
		sleeps.push(ms);
		advance(ms);
	};
	const okResult = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(okResult.ok, true);
	assert.equal(okResult.waitedMs, 6_000);
	assert.deepEqual(sleeps, [2_000, 2_000, 2_000]);
	assert.equal(count("herdr agent prompt"), 1);
	const promptCall = calls.find(({ args }) => args[1] === "prompt")!;
	assert.equal(Number(promptCall.args[6]), 57_000);
	assert.equal(promptCall.options?.timeout, 60_000);

	const cappedScreens = [TYPING_CLAUDE, TYPING_CLAUDE, EMPTY_CLAUDE, EMPTY_CLAUDE];
	const cappedSleeps: number[] = [];
	const capped = fakeExec({
		"herdr pane read": () => ({ stdout: cappedScreens.shift() ?? EMPTY_CLAUDE }),
		"herdr agent get": () => agentGet("working"),
	});
	capped.deps.inputWaitMs = 5_000;
	capped.deps.sleep = async (ms) => {
		cappedSleeps.push(ms);
		capped.advance(ms);
	};
	const cappedResult = await callRegisteredAgent(capped.deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(cappedResult.ok, false);
	assert.equal(cappedResult.error?.code, "target_busy");
	assert.equal(cappedResult.waitedMs, 5_000);
	assert.deepEqual(cappedSleeps, [2_000, 2_000, 1_000]);
	assert.equal(capped.count("herdr agent prompt"), 0);
});

test("readiness sleep abort, final lookup elapsed time, bounded retry timeouts, and small remaining budgets", async () => {
	const abortController = new AbortController();
	const aborted = fakeExec({
		"herdr pane read": () => ({ stdout: "$ plain shell\n" }),
		"herdr agent get": () => agentGet("idle", { focused: true }),
	});
	aborted.deps.sleep = async (ms) => {
		aborted.advance(ms);
		abortController.abort();
	};
	const abortResult = await callRegisteredAgent(
		aborted.deps,
		{ target: TARGET_PANE, text: "hi" },
		SENDER_PANE,
		abortController.signal,
	);
	assert.equal(abortResult.status, "not_sent");
	assert.equal(abortResult.delivery, "not_sent");
	assert.equal(abortResult.error?.code, "aborted");
	assert.equal(abortResult.waitedMs, 2_000);
	assert.equal(aborted.count("herdr agent prompt"), 0);
	assert.equal(aborted.deps.inFlight.size, 0);

	let gets = 0;
	let requestId = "";
	const timed = fakeExec({
		"herdr pane read": () => {
			timed.advance(gets === 0 ? 100 : 200);
			return { stdout: EMPTY_CLAUDE };
		},
		"herdr agent get": () => {
			if (++gets === 1) return agentGet("working");
			timed.advance(500);
			return agentGet("idle");
		},
		"herdr agent prompt": (args) => {
			requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3])![1]!;
			return agentPrompted("done");
		},
		"herdr agent read": () => answerScreen(requestId, "timed ok"),
	});
	const timedResult = await callRegisteredAgent(timed.deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(timedResult.ok, true);
	assert.equal(timedResult.status, "answered");
	assert.equal(timedResult.waitedMs, 2_800);
	const promptCall = timed.calls.find(({ args }) => args[1] === "prompt")!;
	assert.equal(Number(promptCall.args[6]), 57_000);
	assert.equal(promptCall.options?.timeout, 60_000);

	for (const overMode of ["killed", "late-idle"] as const) {
		let overGets = 0;
		const over = fakeExec({
			"herdr pane read": () => {
				if (overGets > 0) over.advance(300);
				return { stdout: EMPTY_CLAUDE };
			},
			"herdr agent get": (_args, options) => {
				if (++overGets === 1) return agentGet("working");
				assert.equal(options?.timeout, 1_200);
				if (overMode === "killed") {
					over.advance(options?.timeout ?? 0);
					return { killed: true, code: 0, stdout: "", stderr: "" };
				}
				over.advance(2_000);
				return agentGet("idle");
			},
		});
		over.deps.inputWaitMs = 3_500;
		const overResult = await callRegisteredAgent(over.deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
		assert.equal(overResult.ok, false);
		assert.equal(overResult.status, "not_sent");
		assert.equal(overResult.error?.code, "target_busy");
		assert.equal(over.count("herdr agent prompt"), 0);
		if (overMode === "killed") assert.equal(overResult.waitedMs, 3_500);
	}

	const subRecheck = fakeExec({
		"herdr pane read": () => {
			subRecheck.advance(0.4);
			return { stdout: "$ plain shell\n" };
		},
		"herdr agent get": () => agentGet("idle", { focused: true }),
	});
	subRecheck.deps.inputWaitMs = 2_001.5;
	const subResult = await callRegisteredAgent(subRecheck.deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(subResult.status, "not_sent");
	assert.equal(subResult.error?.code, "target_focused");
	assert.equal(subResult.waitedMs, 2_000.4);
	assert.equal(subRecheck.count("herdr pane read"), 1);

	const emptyAgy = `${RULE_LINE}\n>\n${RULE_LINE}\n? for shortcuts                                                 Gemini 4 Argon · hig`;
	let agyGets = 0;
	const agyExhausted = fakeExec({
		"herdr pane read": () => {
			if (agyGets > 0) {
				agyExhausted.advance(1_200);
				return { stdout: emptyAgy };
			}
			return { stdout: "$ plain shell\n" };
		},
		"herdr agent get": () => {
			agyGets++;
			return ok({
				result: {
					type: "agent_info",
					agent: {
						agent_status: "working",
						pane_id: TARGET_PANE,
						terminal_id: TERMINAL,
					},
				},
			});
		},
	});
	agyExhausted.deps.inputWaitMs = 3_200;
	const agyResult = await callRegisteredAgent(agyExhausted.deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(agyResult.status, "not_sent");
	assert.equal(agyResult.error?.code, "target_busy");
	assert.equal(agyResult.waitedMs, 3_200);
});

test("--result-file command parsing accepts a leading path, rejects missing values, and keeps trailing flags in text", () => {
	assert.deepEqual(parseCallCommandArgs("  --result-file /tmp/out.md wE:p2 hello world"), {
		target: "wE:p2",
		text: "hello world",
		resultFile: "/tmp/out.md",
	});
	assert.deepEqual(
		parseCallCommandArgs("wE:p2 --result-file /tmp/out.md keep as prompt"),
		{
			target: "wE:p2",
			text: "--result-file /tmp/out.md keep as prompt",
		},
	);
	assert.deepEqual(
		parseCallCommandArgs("--result-file /tmp/a.md reviewer --result-file /tmp/b.md"),
		{
			target: "reviewer",
			text: "--result-file /tmp/b.md",
			resultFile: "/tmp/a.md",
		},
	);
	assert.equal(parseCallCommandArgs("--result-file"), USAGE);
	assert.equal(parseCallCommandArgs("--result-file   "), USAGE);
	assert.equal(parseCallCommandArgs("--result-file /tmp/only-path"), USAGE);
	assert.equal(
		parseCallCommandArgs("--result-file /tmp/a.md --result-file /tmp/b.md wE:p2 hi"),
		USAGE,
	);
});

function enoentError(): Error {
	return Object.assign(new Error("ENOENT: no such file or directory"), {
		code: "ENOENT",
	});
}

function fakeFileHandle(
	content: string | Uint8Array,
	overrides?: Partial<ResultFileStat> & {
		onStat?: () => Promise<ResultFileStat> | ResultFileStat;
		onRead?: (
			buffer: Uint8Array,
			offset: number,
			length: number,
			position: number | null,
		) => Promise<ResultFileReadResult> | ResultFileReadResult;
		onClose?: () => Promise<void> | void;
	},
): {
	handle: ResultFileHandle;
	counts: { stat: number; read: number; close: number };
} {
	const bytes =
		typeof content === "string" ? new TextEncoder().encode(content) : content;
	const counts = { stat: 0, read: 0, close: 0 };
	let cursor = 0;
	const handle: ResultFileHandle = {
		stat: async () => {
			counts.stat++;
			if (overrides?.onStat) return await overrides.onStat();
			return {
				isFile: overrides?.isFile ?? (() => true),
				nlink: overrides?.nlink ?? 1,
				size: overrides?.size ?? bytes.byteLength,
			};
		},
		read: async (buffer, offset, length, position) => {
			counts.read++;
			if (overrides?.onRead) {
				return await overrides.onRead(buffer, offset, length, position);
			}
			const start = position ?? cursor;
			const slice = bytes.subarray(start, start + length);
			buffer.set(slice, offset);
			if (position === null) cursor += slice.byteLength;
			return { bytesRead: slice.byteLength, buffer };
		},
		close: async () => {
			counts.close++;
			await overrides?.onClose?.();
		},
	};
	return { handle, counts };
}

test("result_file rejects invalid paths, CR/LF, and any pre-existing file, symlink, or directory before any prompt", async () => {
	for (const badPath of [
		"relative/out.md",
		"./out.md",
		"",
		"   ",
		" /tmp/out.md",
		"/tmp/out.md ",
		"/tmp/bad\0path.md",
		"/tmp/bad\rpath.md",
		"/tmp/bad\npath.md",
	]) {
		const { deps, calls } = fakeExec({});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "hi", resultFile: badPath },
			SENDER_PANE,
		);
		assert.equal(result.ok, false);
		assert.equal(result.status, "not_sent");
		assert.equal(result.delivery, "not_sent");
		assert.equal(result.error?.code, "invalid_request");
		assert.equal(calls.length, 0);
	}

	for (const kind of ["regular", "symlink", "directory"] as const) {
		let openCalls = 0;
		const { deps, calls } = fakeExec({});
		deps.fs = {
			lstat: async () => ({
				isFile: () => kind === "regular",
				isSymbolicLink: () => kind === "symlink",
				size: 10,
			}),
			open: async () => {
				openCalls++;
				throw new Error("should not open");
			},
		};
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "hi", resultFile: `/tmp/preexisting-${kind}` },
			SENDER_PANE,
		);
		assert.equal(result.ok, false);
		assert.equal(result.status, "not_sent");
		assert.equal(result.delivery, "not_sent");
		assert.equal(result.error?.code, "invalid_request");
		assert.match(result.error?.message ?? "", /already exists/);
		assert.equal(calls.length, 0);
		assert.equal(openCalls, 0);
	}
});

test("result_file rechecks absence after the #34 readiness wait and refuses if created while working", async () => {
	const resultPath = "/tmp/gjc-herdr-created-during-wait.md";
	const states = ["working", "idle"];
	let createdDuringWait = false;
	let lstatCalls = 0;
	let openCalls = 0;
	const { deps, count, advance } = fakeExec({
		"herdr agent get": () => agentGet(states.shift() ?? "idle"),
		"herdr agent prompt": () => agentPrompted("done"),
	});
	deps.sleep = async (ms) => {
		advance(ms);
		createdDuringWait = true;
	};
	deps.fs = {
		lstat: async (path) => {
			assert.equal(path, resultPath);
			lstatCalls++;
			if (!createdDuringWait) throw enoentError();
			return { isFile: () => true, size: 12 };
		},
		open: async () => {
			openCalls++;
			throw new Error("should not open");
		},
	};
	const result = await callRegisteredAgent(
		deps,
		{ target: TARGET_PANE, text: "hi", resultFile: resultPath },
		SENDER_PANE,
	);
	assert.equal(result.ok, false);
	assert.equal(result.status, "not_sent");
	assert.equal(result.delivery, "not_sent");
	assert.equal(result.error?.code, "invalid_request");
	assert.match(result.error?.message ?? "", /already exists/);
	assert.equal(result.waitedMs, 2_000);
	assert.equal(lstatCalls, 2);
	assert.equal(openCalls, 0);
	assert.equal(count("herdr agent prompt"), 0);
});

test("result_file recovers a new regular file from a single handle with markerVerified true or false", async () => {
	const resultPath = "/tmp/gjc-herdr-answer.md";
	const expectedFlags =
		fsConstants.O_RDONLY |
		(fsConstants.O_NOFOLLOW ?? 0) |
		(fsConstants.O_NONBLOCK ?? 0);

	for (const screenMode of ["matching", "missing", "different-path"] as const) {
		let requestId = "";
		let lstatCalls = 0;
		let openCalls = 0;
		const { handle, counts } = fakeFileHandle("full file answer\nline 2");
		const { deps, count } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				assert.match(args[3]!, new RegExp(`new file at ${resultPath}`));
				assert.doesNotMatch(args[3]!, /overwrite/i);
				return agentPrompted("done");
			},
			"herdr agent read": () => {
				if (screenMode === "matching") return answerScreen(requestId, resultPath);
				if (screenMode === "different-path") {
					return answerScreen(requestId, "/tmp/other-path.md");
				}
				return { stdout: "screen folded or markers missing" };
			},
		});
		deps.fs = {
			lstat: async (path) => {
				assert.equal(path, resultPath);
				lstatCalls++;
				throw enoentError();
			},
			open: async (path, flags) => {
				assert.equal(path, resultPath);
				assert.equal(flags, expectedFlags);
				openCalls++;
				return handle;
			},
		};
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "summarize", resultFile: resultPath },
			SENDER_PANE,
		);
		assert.equal(result.ok, true);
		assert.equal(result.status, "answered");
		assert.equal(result.delivery, "submitted");
		assert.equal(result.answer, "full file answer\nline 2");
		assert.equal(result.resultFile, resultPath);
		assert.equal(result.markerVerified, screenMode === "matching");
		assert.equal(lstatCalls, 2);
		assert.equal(openCalls, 1);
		assert.equal(counts.stat, 1);
		assert.ok(counts.read >= 1);
		assert.equal(counts.close, 1);
		assert.equal(count("herdr agent prompt"), 1);
		assert.match(describeCallResult(result), new RegExp(`resultFile ${resultPath}`));
	}
});

test("result_file enforces handle stat, link count, byte bounds (0, 1 MiB, 1 MiB + 1), and fatal UTF-8", async () => {
	const resultPath = "/tmp/gjc-herdr-bounds.md";
	const exactOneMiB = "a".repeat(1_024 * 1_024);

	{
		let requestId = "";
		const { handle, counts } = fakeFileHandle(exactOneMiB);
		const { deps } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				return agentPrompted("done");
			},
			"herdr agent read": () => answerScreen(requestId, resultPath),
		});
		deps.fs = {
			lstat: async () => {
				throw enoentError();
			},
			open: async () => handle,
		};
		const okOneMiB = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "1mib", resultFile: resultPath },
			SENDER_PANE,
		);
		assert.equal(okOneMiB.ok, true);
		assert.equal(okOneMiB.status, "answered");
		assert.equal(okOneMiB.answer?.length, 1_024 * 1_024);
		assert.equal(okOneMiB.markerVerified, true);
		assert.equal(counts.stat, 1);
		assert.ok(counts.read >= 1);
		assert.equal(counts.close, 1);
	}

	for (const scenario of [
		"missing",
		"eloop",
		"fifo",
		"hardlink",
		"empty-stat",
		"empty-read",
		"oversize-stat",
		"oversize-read",
		"bad-utf8",
	] as const) {
		let requestId = "";
		const { handle, counts } =
			scenario === "fifo"
				? fakeFileHandle("ignored", { isFile: () => false, size: 10 })
				: scenario === "hardlink"
					? fakeFileHandle("ignored", { nlink: 2, size: 10 })
					: scenario === "empty-stat"
						? fakeFileHandle("", { size: 0 })
						: scenario === "empty-read"
							? fakeFileHandle("", { size: 10 })
							: scenario === "oversize-stat"
								? fakeFileHandle("x", { size: 1_024 * 1_024 + 1 })
								: scenario === "oversize-read"
									? fakeFileHandle("a".repeat(1_024 * 1_024 + 1), { size: 64 })
									: fakeFileHandle(new Uint8Array([0x61, 0xff, 0x62]));
		const { deps } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				return agentPrompted("done");
			},
			"herdr agent read": () => answerScreen(requestId, resultPath),
		});
		deps.fs = {
			lstat: async () => {
				throw enoentError();
			},
			open: async () => {
				if (scenario === "missing") throw enoentError();
				if (scenario === "eloop") {
					throw Object.assign(new Error("ELOOP: too many symbolic links encountered"), {
						code: "ELOOP",
					});
				}
				return handle;
			},
		};
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "check", resultFile: resultPath },
			SENDER_PANE,
		);
		assert.equal(result.ok, false, `scenario=${scenario}`);
		assert.equal(result.status, "response_unverified", `scenario=${scenario}`);
		assert.equal(result.delivery, "submitted", `scenario=${scenario}`);
		assert.equal(result.resultFile, resultPath, `scenario=${scenario}`);
		assert.equal(
			result.error?.code,
			scenario === "missing" ? "result_file_missing" : "result_file_invalid",
			`scenario=${scenario}`,
		);
		assert.match(result.capture ?? "", new RegExp(resultPath), `scenario=${scenario}`);
		if (scenario !== "missing" && scenario !== "eloop") {
			assert.equal(counts.stat, 1, `scenario=${scenario}`);
			assert.equal(counts.close, 1, `scenario=${scenario}`);
		}
		if (
			scenario === "fifo" ||
			scenario === "hardlink" ||
			scenario === "empty-stat" ||
			scenario === "oversize-stat"
		) {
			assert.equal(counts.read, 0, `scenario=${scenario}`);
		}
	}
});

test("result_file recovers when screen read fails or throws, and preserves screen error when file also fails", async () => {
	const resultPath = "/tmp/gjc-herdr-screen-fallback.md";

	for (const readMode of ["nonzero", "throw"] as const) {
		const { handle, counts } = fakeFileHandle("recovered despite screen read failure");
		const { deps } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": () => agentPrompted("done"),
			"herdr agent read": () => {
				if (readMode === "throw") throw new Error("read process crashed");
				return {
					code: 1,
					stderr: JSON.stringify({
						error: { code: "read_error", message: "tmux capture failed" },
					}),
				};
			},
		});
		deps.fs = {
			lstat: async () => {
				throw enoentError();
			},
			open: async () => handle,
		};
		const okResult = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "check", resultFile: resultPath },
			SENDER_PANE,
		);
		assert.equal(okResult.ok, true);
		assert.equal(okResult.status, "answered");
		assert.equal(okResult.delivery, "submitted");
		assert.equal(okResult.answer, "recovered despite screen read failure");
		assert.equal(okResult.resultFile, resultPath);
		assert.equal(okResult.markerVerified, false);
		assert.equal(counts.close, 1);

		const { deps: failDeps } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": () => agentPrompted("done"),
			"herdr agent read": () => {
				if (readMode === "throw") throw new Error("read process crashed");
				return {
					code: 1,
					stderr: JSON.stringify({
						error: { code: "read_error", message: "tmux capture failed" },
					}),
				};
			},
		});
		failDeps.fs = {
			lstat: async () => {
				throw enoentError();
			},
			open: async () => {
				throw enoentError();
			},
		};
		const failResult = await callRegisteredAgent(
			failDeps,
			{ target: TARGET_PANE, text: "check", resultFile: resultPath },
			SENDER_PANE,
		);
		assert.equal(failResult.ok, false);
		assert.equal(failResult.status, "response_unverified");
		assert.equal(failResult.delivery, "submitted");
		assert.equal(failResult.error?.code, "result_file_missing");
		assert.match(failResult.error?.message ?? "", /Result file was not created/);
		assert.match(
			failResult.error?.message ?? "",
			readMode === "throw" ? /read process crashed/ : /tmux capture failed/,
		);
	}
});

test("result_file honors abort during pre-prompt lstat and during file recovery (open, stat, and first read)", async () => {
	const resultPath = "/tmp/gjc-herdr-abort.md";

	{
		const controller = new AbortController();
		let lstatCalls = 0;
		let openCalls = 0;
		const { deps, count } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": () => agentPrompted("done"),
		});
		deps.fs = {
			lstat: async () => {
				if (++lstatCalls === 2) controller.abort();
				throw enoentError();
			},
			open: async () => {
				openCalls++;
				throw new Error("should not open");
			},
		};
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "hi", resultFile: resultPath },
			SENDER_PANE,
			controller.signal,
		);
		assert.equal(result.ok, false);
		assert.equal(result.status, "not_sent");
		assert.equal(result.delivery, "not_sent");
		assert.equal(result.error?.code, "aborted");
		assert.equal(result.answer, undefined);
		assert.equal(lstatCalls, 2);
		assert.equal(openCalls, 0);
		assert.equal(count("herdr agent prompt"), 0);
	}

	for (const abortAt of ["open", "stat", "first-read"] as const) {
		const controller = new AbortController();
		let requestId = "";
		const bytes = new TextEncoder().encode("SAFE");
		const { handle, counts } = fakeFileHandle(bytes, {
			onStat: () => {
				if (abortAt === "stat") controller.abort();
				return { isFile: () => true, nlink: 1, size: bytes.byteLength };
			},
			onRead: (buffer, offset, _length, position) => {
				const start = position ?? 0;
				const slice = bytes.subarray(start, start + 2);
				buffer.set(slice, offset);
				if (abortAt === "first-read") controller.abort();
				return { bytesRead: slice.byteLength, buffer };
			},
		});
		const { deps, count } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				return agentPrompted("done");
			},
			"herdr agent read": () => answerScreen(requestId, resultPath),
		});
		deps.fs = {
			lstat: async () => {
				throw enoentError();
			},
			open: async () => {
				if (abortAt === "open") controller.abort();
				return handle;
			},
		};
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "hi", resultFile: resultPath },
			SENDER_PANE,
			controller.signal,
		);
		assert.equal(result.ok, false, `abortAt=${abortAt}`);
		assert.equal(result.status, "read_failed", `abortAt=${abortAt}`);
		assert.equal(result.delivery, "submitted", `abortAt=${abortAt}`);
		assert.equal(result.error?.code, "aborted", `abortAt=${abortAt}`);
		assert.equal(result.answer, undefined, `abortAt=${abortAt}`);
		assert.equal(count("herdr agent prompt"), 1, `abortAt=${abortAt}`);
		assert.equal(counts.close, 1, `abortAt=${abortAt}`);
		if (abortAt === "open") {
			assert.equal(counts.stat, 0);
			assert.equal(counts.read, 0);
		} else if (abortAt === "stat") {
			assert.equal(counts.stat, 1);
			assert.equal(counts.read, 0);
		} else {
			assert.equal(counts.stat, 1);
			assert.equal(counts.read, 1);
		}
	}
});

test("r3 (#52): retries with --source recent when recent-unwrapped has only the end marker, recovers Claude bullet answers, and rejects folded prompt echoes", async () => {
	// 1. recent-unwrapped has only end marker, recent has full pair in Claude format (⏺ bullet + 2-space indent) -> answered
	{
		let requestId = "";
		const readSources: string[] = [];
		const { deps, count, advance } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				advance(1_000);
				return agentPrompted("done");
			},
			"herdr agent read": (args) => {
				const sourceIdx = args.indexOf("--source");
				const source = sourceIdx >= 0 ? args[sourceIdx + 1]! : "";
				readSources.push(source);
				if (source === "recent-unwrapped") {
					return {
						stdout: `  row-23\n  row-24\n  GJC_HERDR_END_${requestId}\n`,
					};
				}
				return {
					stdout: `⏺ GJC_HERDR_BEGIN_${requestId}\n  row-01\n  row-02\n  GJC_HERDR_END_${requestId}\n`,
				};
			},
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "list rows" },
			SENDER_PANE,
		);
		assert.equal(result.ok, true);
		assert.equal(result.status, "answered");
		assert.equal(result.delivery, "submitted");
		assert.equal(result.answer, "row-01\nrow-02");
		assert.equal(count("herdr agent read"), 2);
		assert.deepEqual(readSources, ["recent-unwrapped", "recent"]);
	}

	// 2. Both reads lack the begin marker -> response_unverified, read twice, keeps first capture
	{
		let requestId = "";
		const { deps, count } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				return agentPrompted("done");
			},
			"herdr agent read": (args) => {
				const source = args[args.indexOf("--source") + 1];
				return {
					stdout:
						source === "recent-unwrapped"
							? `first-unwrapped\nGJC_HERDR_END_${requestId}\n`
							: `second-recent\nGJC_HERDR_END_${requestId}\n`,
				};
			},
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "list rows" },
			SENDER_PANE,
		);
		assert.equal(result.ok, false);
		assert.equal(result.status, "response_unverified");
		assert.equal(result.delivery, "submitted");
		assert.equal(result.capture, `first-unwrapped\nGJC_HERDR_END_${requestId}\n`);
		assert.equal(count("herdr agent read"), 2);
	}

	// 3. First read has no end marker either -> no second read (1 read)
	{
		const { deps, count } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": () => agentPrompted("done"),
			"herdr agent read": () => ({ stdout: "row-23\nrow-24\nno markers at all\n" }),
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "list rows" },
			SENDER_PANE,
		);
		assert.equal(result.ok, false);
		assert.equal(result.status, "response_unverified");
		assert.equal(count("herdr agent read"), 1);
	}

	// 4. First read succeeds -> only 1 read
	{
		let requestId = "";
		const { deps, count } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				return agentPrompted("done");
			},
			"herdr agent read": () => answerScreen(requestId, "single read ok"),
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "list rows" },
			SENDER_PANE,
		);
		assert.equal(result.ok, true);
		assert.equal(result.status, "answered");
		assert.equal(result.answer, "single read ok");
		assert.equal(count("herdr agent read"), 1);
	}

	// 5a. Folded prompt echo in recent has a standalone GJC_HERDR_BEGIN_<id> line, no real begin marker below, only end marker -> response_unverified
	{
		let requestId = "";
		const { deps, count } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				return agentPrompted("done");
			},
			"herdr agent read": (args) => {
				const source = args[args.indexOf("--source") + 1];
				if (source === "recent-unwrapped") {
					return { stdout: `  row-23\n  GJC_HERDR_END_${requestId}\n` };
				}
				return {
					stdout: [
						"❯ Please inspect the module.",
						"  Answer with the exact token",
						`  GJC_HERDR_BEGIN_${requestId}`,
						`  on the first line of your final answer and GJC_HERDR_END_${requestId} on the last line.`,
						"  row-23",
						`  GJC_HERDR_END_${requestId}`,
					].join("\n"),
				};
			},
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "Please inspect the module." },
			SENDER_PANE,
		);
		assert.equal(result.ok, false);
		assert.equal(result.status, "response_unverified");
		assert.equal(result.answer, undefined);
		assert.equal(count("herdr agent read"), 2);
	}

	// 5b. Folded prompt echo in recent has a standalone GJC_HERDR_BEGIN_<id> line AND a real Claude begin marker below -> recovers only real answer without echoed prompt text
	{
		let requestId = "";
		const { deps, count } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				return agentPrompted("done");
			},
			"herdr agent read": (args) => {
				const source = args[args.indexOf("--source") + 1];
				if (source === "recent-unwrapped") {
					return { stdout: `  row-23\n  GJC_HERDR_END_${requestId}\n` };
				}
				return {
					stdout: [
						"❯ Please inspect the module.",
						"  Answer with the exact token",
						`  GJC_HERDR_BEGIN_${requestId}`,
						"  on the first line of your final answer and",
						`  GJC_HERDR_END_${requestId}`,
						"  on the last line.",
						"  extra prompt line after echo",
						`⏺ GJC_HERDR_BEGIN_${requestId}`,
						"  row-01",
						"  row-60",
						`  GJC_HERDR_END_${requestId}`,
					].join("\n"),
				};
			},
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "Please inspect the module." },
			SENDER_PANE,
		);
		assert.equal(result.ok, true);
		assert.equal(result.status, "answered");
		assert.equal(result.answer, "row-01\nrow-60");
		assert.ok(!result.answer.includes("on the first line"));
		assert.ok(!result.answer.includes("extra prompt line"));
		assert.equal(count("herdr agent read"), 2);
	}

	// 6. Second read budget is bounded by remaining budget and skipped when < 1ms remains after first read
	{
		let requestId = "";
		let reads = 0;
		const { deps, calls, count, advance } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				advance(57_000);
				return agentPrompted("done");
			},
			"herdr agent read": () => {
				reads++;
				if (reads === 1) {
					advance(1_800);
					return { stdout: `  row-23\n  GJC_HERDR_END_${requestId}\n` };
				}
				return {
					stdout: `⏺ GJC_HERDR_BEGIN_${requestId}\n  row-01\n  GJC_HERDR_END_${requestId}\n`,
				};
			},
		});
		const bounded = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "list rows" },
			SENDER_PANE,
		);
		assert.equal(bounded.ok, true);
		assert.equal(bounded.status, "answered");
		assert.equal(count("herdr agent read"), 2);
		const readCalls = calls.filter(({ args }) => args[0] === "agent" && args[1] === "read");
		assert.equal(readCalls[0]?.options?.timeout, 3_000);
		assert.equal(readCalls[1]?.options?.timeout, 1_200);

		let exhaustedId = "";
		const exhausted = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				exhaustedId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				exhausted.advance(57_000);
				return agentPrompted("done");
			},
			"herdr agent read": () => {
				exhausted.advance(3_000);
				return { stdout: `  row-23\n  GJC_HERDR_END_${exhaustedId}\n` };
			},
		});
		const noBudgetResult = await callRegisteredAgent(
			exhausted.deps,
			{ target: TARGET_PANE, text: "list rows" },
			SENDER_PANE,
		);
		assert.equal(noBudgetResult.ok, false);
		assert.equal(noBudgetResult.status, "response_unverified");
		assert.equal(exhausted.count("herdr agent read"), 1);
	}

	// 7. r3 boundary: valid answer whose first body line starts with "on the first line..." is conservatively response_unverified on recent retry
	{
		let requestId = "";
		const { deps, count } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				return agentPrompted("done");
			},
			"herdr agent read": (args) => {
				const source = args[args.indexOf("--source") + 1];
				if (source === "recent-unwrapped") {
					return { stdout: `  row-23\n  GJC_HERDR_END_${requestId}\n` };
				}
				return {
					stdout: [
						`⏺ GJC_HERDR_BEGIN_${requestId}`,
						"  on the first line of the config, set foo=bar",
						"  second line",
						`  GJC_HERDR_END_${requestId}`,
					].join("\n"),
				};
			},
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "explain config" },
			SENDER_PANE,
		);
		assert.equal(result.ok, false);
		assert.equal(result.status, "response_unverified");
		assert.equal(result.capture, `  row-23\n  GJC_HERDR_END_${requestId}\n`);
		assert.equal(count("herdr agent read"), 2);
	}

	// 8. r3 boundary: BEGIN marker line itself folded across two lines -> response_unverified
	{
		let requestId = "";
		const { deps, count } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				return agentPrompted("done");
			},
			"herdr agent read": (args) => {
				const source = args[args.indexOf("--source") + 1];
				if (source === "recent-unwrapped") {
					return { stdout: `  row-23\n  GJC_HERDR_END_${requestId}\n` };
				}
				const half = Math.floor(requestId.length / 2);
				return {
					stdout: [
						`⏺ GJC_HERDR_BEGIN_${requestId.slice(0, half)}`,
						`  ${requestId.slice(half)}`,
						"  row-01",
						`  GJC_HERDR_END_${requestId}`,
					].join("\n"),
				};
			},
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "narrow pane" },
			SENDER_PANE,
		);
		assert.equal(result.ok, false);
		assert.equal(result.status, "response_unverified");
		assert.equal(count("herdr agent read"), 2);
	}

	// 9. r3 boundary: second read fails (nonzero) or throws -> response_unverified keeping first capture
	for (const failMode of ["nonzero", "throw"] as const) {
		let requestId = "";
		let reads = 0;
		const { deps, count } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				return agentPrompted("done");
			},
			"herdr agent read": () => {
				reads++;
				if (reads === 1) {
					return { stdout: `first-capture-kept\nGJC_HERDR_END_${requestId}\n` };
				}
				if (failMode === "throw") return new Error("retry read crashed");
				return herdrError("agent_read_failed", "retry read failed");
			},
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "retry failure" },
			SENDER_PANE,
		);
		assert.equal(result.ok, false);
		assert.equal(result.status, "response_unverified");
		assert.equal(result.delivery, "submitted");
		assert.equal(result.capture, `first-capture-kept\nGJC_HERDR_END_${requestId}\n`);
		assert.equal(count("herdr agent read"), 2);
	}
});

test("u1 (#52): confirms delivery after timeout only when this request's echo is on the target recent screen", async () => {
	// 1. Another sender's activity or a different request ID echo on screen (even if counters advance) -> uncertain
	{
		let gets = 0;
		const { deps, count, advance } = fakeExec({
			"herdr agent get": () => {
				gets++;
				return gets === 1
					? agentGet("idle", { revision: 7, state_change_seq: 12 })
					: agentGet("working", { revision: 8, state_change_seq: 13 });
			},
			"herdr agent prompt": () => {
				advance(57_500);
				return herdrError("timeout", "timed out waiting for agent status");
			},
			"herdr agent read": () => ({
				stdout: [
					"❯ Some other sender's prompt",
					"  Answer with the exact token GJC_HERDR_BEGIN_00000000-0000-0000-0000-000000000000 on the first line",
					"  of your final answer and GJC_HERDR_END_00000000-0000-0000-0000-000000000000 on the last line.",
				].join("\n"),
			}),
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "deep analysis" },
			SENDER_PANE,
		);
		assert.equal(result.ok, false);
		assert.equal(result.status, "uncertain");
		assert.equal(result.delivery, "unknown");
		assert.equal(result.error?.code, "timeout");
		assert.equal(count("herdr agent get"), 1);
		assert.equal(count("herdr agent read"), 1);
	}

	// 2. Timeout followed by recent screen containing this request's echo (single-line and folded two-line ID) -> answer_pending
	for (const echoMode of ["single-line", "folded-id", "folded-at-hyphen"] as const) {
		let requestId = "";
		const { deps, calls, count, advance } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				advance(57_500);
				return herdrError("timeout", "timed out waiting for agent status");
			},
			"herdr agent read": (args) => {
				assert.deepEqual(args, [
					"agent",
					"read",
					TARGET_PANE,
					"--source",
					"recent",
					"--lines",
					"200",
				]);
				if (echoMode === "single-line") {
					return {
						stdout: `❯ deep analysis\n  Answer with the exact token GJC_HERDR_BEGIN_${requestId} on the first line\n✻ Thinking…\n`,
					};
				}
				if (echoMode === "folded-at-hyphen") {
					const dash = requestId.indexOf("-");
					return {
						stdout: [
							"❯ deep analysis",
							`  Answer with the exact token GJC_HERDR_BEGIN_${requestId.slice(0, dash)}`,
							`  ${requestId.slice(dash)} on the first line of your final answer`,
						].join("\n"),
					};
				}
				const splitAt = 14;
				return {
					stdout: [
						"• deep analysis",
						`  Answer with the exact token GJC_HERDR_BEGIN_${requestId.slice(0, splitAt)}`,
						`  ${requestId.slice(splitAt)} on the first line of your final answer`,
					].join("\n"),
				};
			},
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "deep analysis" },
			SENDER_PANE,
		);
		assert.equal(result.ok, false, `echoMode=${echoMode}`);
		assert.equal(result.status, "answer_pending", `echoMode=${echoMode}`);
		assert.equal(result.delivery, "submitted", `echoMode=${echoMode}`);
		assert.equal(result.pane, TARGET_PANE, `echoMode=${echoMode}`);
		assert.equal(result.error?.code, "answer_timeout", `echoMode=${echoMode}`);
		assert.equal(result.error?.herdrCode, "timeout", `echoMode=${echoMode}`);
		assert.equal(result.error?.exitCode, 1, `echoMode=${echoMode}`);
		assert.equal(
			result.error?.message,
			"Prompt was delivered (this request's marker instruction is on the target screen) but no answer arrived within the call budget; the target may still be answering. Do not resend; check the target or ask it to reply again later.",
			`echoMode=${echoMode}`,
		);
		assert.equal(count("herdr agent get"), 1, `echoMode=${echoMode}`);
		assert.equal(count("herdr agent read"), 1, `echoMode=${echoMode}`);
		const confirmRead = calls.find(({ args }) => args[0] === "agent" && args[1] === "read")!;
		assert.equal(confirmRead.options?.timeout, 2_500);
		const formatted = describeCallResult(result);
		assert.match(formatted, /^herdr-call answer_pending \(delivery submitted, request /);
		assert.match(
			formatted,
			/this request's marker instruction is on the target screen[\s\S]*\(herdr timeout\)$/,
		);
	}

	// 3. Confirmation read fails (nonzero, throw, or killed) -> uncertain
	for (const failKind of ["nonzero", "throw", "killed"] as const) {
		const { deps, count, advance } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": () => {
				advance(57_000);
				return herdrError("timeout", "timed out waiting for agent status");
			},
			"herdr agent read": () => {
				if (failKind === "throw") return new Error("read failed");
				if (failKind === "killed") return { killed: true, code: 0, stdout: "", stderr: "" };
				return herdrError("agent_read_failed", "read failed");
			},
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "deep analysis" },
			SENDER_PANE,
		);
		assert.equal(result.status, "uncertain", `failKind=${failKind}`);
		assert.equal(result.delivery, "unknown", `failKind=${failKind}`);
		assert.equal(result.error?.code, "timeout", `failKind=${failKind}`);
		assert.equal(count("herdr agent read"), 1, `failKind=${failKind}`);
	}

	// 4. Abort during confirmation read -> uncertain
	{
		const controller = new AbortController();
		let requestId = "";
		const { deps, count, advance } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				advance(57_000);
				return herdrError("timeout", "timed out waiting for agent status");
			},
			"herdr agent read": () => {
				controller.abort();
				return {
					stdout: `❯ Answer with the exact token GJC_HERDR_BEGIN_${requestId} on the first line`,
				};
			},
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "deep analysis" },
			SENDER_PANE,
			controller.signal,
		);
		assert.equal(result.status, "uncertain");
		assert.equal(result.delivery, "unknown");
		assert.equal(result.error?.code, "timeout");
		assert.equal(count("herdr agent read"), 1);
	}

	// 5. Remaining budget 0 -> uncertain without calling confirmation read
	{
		const { deps, count, advance } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": () => {
				advance(60_000);
				return herdrError("timeout", "timed out waiting for agent status");
			},
		});
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "deep analysis" },
			SENDER_PANE,
		);
		assert.equal(result.status, "uncertain");
		assert.equal(result.delivery, "unknown");
		assert.equal(result.error?.code, "timeout");
		assert.equal(count("herdr agent read"), 0);
	}

	// 6. result_file mode timeout + echo on screen -> answer_pending (with resultFile preserved)
	{
		const resultPath = "/tmp/gjc-herdr-u1-result.md";
		let requestId = "";
		const { deps, count, advance } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				requestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				advance(57_500);
				return herdrError("timeout", "timed out waiting for agent status");
			},
			"herdr agent read": () => ({
				stdout: [
					`❯ Write your complete final answer as a new file at ${resultPath},`,
					`  and reply on screen with only three lines: the exact token GJC_HERDR_BEGIN_${requestId.slice(0, 12)}`,
					`  ${requestId.slice(12)} on the first line`,
				].join("\n"),
			}),
		});
		deps.fs = {
			lstat: async () => {
				throw enoentError();
			},
			open: async () => {
				throw new Error("should not open result_file after prompt timeout");
			},
		};
		const result = await callRegisteredAgent(
			deps,
			{ target: TARGET_PANE, text: "write file", resultFile: resultPath },
			SENDER_PANE,
		);
		assert.equal(result.ok, false);
		assert.equal(result.status, "answer_pending");
		assert.equal(result.delivery, "submitted");
		assert.equal(result.resultFile, resultPath);
		assert.equal(result.error?.code, "answer_timeout");
		assert.equal(count("herdr agent read"), 1);
	}

	// 7. Command and tool surface answer_pending status and details directly
	{
		let lastRequestId = "";
		const messages: { content: string; details: AgentCallResult }[] = [];
		let cmdHandler: ((args: string) => Promise<void>) | undefined;
		let toolExecute:
			| ((
					toolCallId: string,
					params: { target: string; text: string },
			  ) => Promise<{ content: { type: string; text: string }[]; details: AgentCallResult; isError: boolean }>)
			| undefined;
		const { deps } = fakeExec({
			"herdr agent get": () => agentGet("idle"),
			"herdr agent prompt": (args) => {
				lastRequestId = /GJC_HERDR_BEGIN_([0-9a-f-]{36})/.exec(args[3]!)![1]!;
				return herdrError("timeout", "timed out waiting for agent status");
			},
			"herdr agent read": () => ({
				stdout: `❯ Answer with the exact token GJC_HERDR_BEGIN_${lastRequestId} on the first line`,
			}),
		});
		const api = {
			logger: { info() {}, warn() {} },
			exec: deps.exec,
			registerCommand(_name: string, def: { handler: (args: string) => Promise<void> }) {
				cmdHandler = def.handler;
			},
			registerTool(tool: { execute: typeof toolExecute }) {
				toolExecute = tool.execute;
			},
			sendMessage: async (message: { content: string; details: AgentCallResult }) => {
				messages.push(message);
			},
			zod: {
				z: {
					object: (shape: unknown) => shape,
					string: () => {
						const field = { optional: () => field, describe: () => field };
						return field;
					},
				},
			},
		} as unknown as ExtensionAPI;
		registerCallFeatures(api, "herdr", SENDER_PANE);
		await cmdHandler!(`${TARGET_PANE} check command`);
		assert.equal(messages.length, 1);
		assert.equal(messages[0]?.details.status, "answer_pending");
		assert.equal(messages[0]?.details.delivery, "submitted");
		assert.equal(messages[0]?.details.error?.code, "answer_timeout");
		assert.match(messages[0]?.content ?? "", /^herdr-call answer_pending \(delivery submitted/);

		const toolRes = await toolExecute!("t-u1", { target: TARGET_PANE, text: "check tool" });
		assert.equal(toolRes.isError, true);
		assert.equal(toolRes.details.status, "answer_pending");
		assert.equal(toolRes.details.delivery, "submitted");
		assert.equal(toolRes.details.error?.code, "answer_timeout");
		assert.match(toolRes.content[0]?.text ?? "", /^herdr-call answer_pending \(delivery submitted/);
	}
});

// ============================================================================
// #86 3a / 3a-r2: hc backend call tests (boundaries 1~6 + F1~F4)
// ============================================================================

const HC_CALLER_ID = "t1";
const HC_TARGET_ID = "t2";
const HC_RESULT_PATH = "/tmp/gjc-herdr-hc-result.md";

type HcHandler = (
	args: string[],
	options: ExecOptions,
) => Partial<ExecResult> | Error | Promise<Partial<ExecResult>>;

function hcTerminalJson(
	address: string,
	statusState: string | null = "idle",
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		address,
		name:
			address === HC_TARGET_ID
				? "worker"
				: address === HC_CALLER_ID
					? "caller"
					: `name-${address.replace("/", "-")}`,
		state: "live",
		reported: statusState !== null,
		turn: 4,
		status:
			statusState === null
				? null
				: {
						state: statusState,
						kind: "claude",
						msg: "SECRET_STATUS_MSG_NEVER_EXPOSE",
					},
		...overrides,
	};
}

function hcWaitJson(
	terminal: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		terminal,
		ended: true,
		reason: "status",
		status: "done",
		turn: 5,
		children: [],
		...overrides,
	};
}

function hcSendJson(
	terminal: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		turn: 4,
		started: true,
		status: "done",
		wait: hcWaitJson(terminal),
		...overrides,
	};
}

function hcErr(
	kind: string,
	message: string,
	useDataKind = false,
	exitCode = 1,
): Partial<ExecResult> {
	const errorObj = useDataKind
		? { kind: "rpc_error", message, data: { kind } }
		: { kind, message };
	return {
		code: exitCode,
		stderr: JSON.stringify({ error: errorObj }),
	};
}

function fakeHcExec(
	routes: Record<string, Partial<ExecResult> | HcHandler>,
	resultContent = "hc file answer",
) {
	let clock = 1_000;
	const calls: { command: string; args: string[]; options: ExecOptions }[] = [];
	const exec: AgentCallDeps["exec"] = async (command, args, options) => {
		assertExecTimeout(options?.timeout);
		calls.push({ command, args, options });
		const key = `${command} ${args[0]}`;
		const route = routes[key];
		assert(route, `unexpected hc exec: ${command} ${args.join(" ")}`);
		const out = typeof route === "function" ? await route(args, options) : route;
		if (out instanceof Error) throw out;
		return { stdout: "", stderr: "", code: 0, killed: false, ...out };
	};
	const { handle, counts } = fakeFileHandle(resultContent);
	let lstatCalls = 0;
	let openCalls = 0;
	const advance = (ms: number) => {
		clock += ms;
	};
	const deps: AgentCallDeps = {
		exec,
		herdrBin: "herdr",
		backend: "hc",
		hcBin: "hc",
		hcCallerId: HC_CALLER_ID,
		inFlight: new Set(),
		now: () => clock,
		sleep: async (ms) => advance(ms),
		fs: {
			lstat: async () => {
				lstatCalls++;
				throw enoentError();
			},
			open: async () => {
				openCalls++;
				return handle;
			},
		},
	};
	return {
		deps,
		calls,
		counts,
		advance,
		setClock: (value: number) => {
			clock = value;
		},
		getLstatCalls: () => lstatCalls,
		getOpenCalls: () => openCalls,
	};
}

test("hc boundary 1: SendResult variations (started true/false/null/omitted, status null/omitted) succeed when wait finishes turn, and wait null/omitted/not_started handle stalled vs protocol without resend", async () => {
	const rawVariants: Array<Record<string, unknown>> = [
		{ turn: 4, started: true, status: "done" },
		{ turn: 4, started: false, status: "done" },
		{ turn: 4, started: null, status: null },
		// F4a: truly omitted started and status keys in stdout JSON
		{ turn: 4 },
	];
	assert.equal("started" in rawVariants[3]!, false);
	assert.equal("status" in rawVariants[3]!, false);

	for (const rawBase of rawVariants) {
		const { deps, calls, counts } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": (args) => {
				assert.deepEqual(args.slice(0, 6), [
					"send",
					"--json",
					"--if",
					"idle",
					"--wait",
					"--timeout",
				]);
				const payload = {
					...rawBase,
					wait: hcWaitJson(HC_TARGET_ID, {
						ended: true,
						reason: "status",
						status: "done",
						turn: 5,
					}),
				};
				if (rawBase === rawVariants[3]) {
					assert.equal("started" in payload, false);
					assert.equal("status" in payload, false);
				}
				return ok(payload);
			},
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "check variant", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, true);
		assert.equal(res.status, "answered");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.answer, "hc file answer");
		assert.equal(res.markerVerified, false);
		assert.equal(res.capture, undefined);
		assert.equal(counts.close, 1);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 1);
		assert.equal(
			calls.some(
				(c) =>
					c.args[0] === "read" ||
					c.args[0] === "attach" ||
					c.command === "herdr",
			),
			false,
		);
	}

	// wait: null or omitted with started=false -> stalled, submitted, 0 resend; with started=true/null -> uncertain/protocol, submitted
	for (const [waitVal, startedVal, expectedStatus, expectedCode] of [
		[null, false, "stalled", "stalled"],
		[undefined, false, "stalled", "stalled"],
		[null, true, "uncertain", "protocol"],
		[undefined, null, "uncertain", "protocol"],
	] as const) {
		const { deps, calls, getOpenCalls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () =>
				ok({
					turn: 4,
					started: startedVal,
					status: "idle",
					...(waitVal !== undefined ? { wait: waitVal } : {}),
				}),
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "null wait check", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, expectedStatus);
		assert.equal(res.delivery, "submitted");
		assert.equal(res.error?.code, expectedCode);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 1);
		assert.equal(calls.filter((c) => c.args[0] === "wait").length, 0);
		assert.equal(getOpenCalls(), 0);
	}

	// wait.reason = "not_started" -> stalled, submitted, 0 resend, 0 follow-up wait
	{
		const { deps, calls, getOpenCalls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () =>
				ok(
					hcSendJson(HC_TARGET_ID, {
						started: false,
						status: "idle",
						wait: hcWaitJson(HC_TARGET_ID, {
							ended: false,
							reason: "not_started",
							status: "idle",
							turn: 4,
						}),
					}),
				),
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "stall check", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "stalled");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.error?.code, "stalled");
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 1);
		assert.equal(calls.filter((c) => c.args[0] === "wait").length, 0);
		assert.equal(getOpenCalls(), 0);
	}
});

test("hc boundary 1: malformed SendResult, 2 envelopes x 9 send kinds, and needs_target/bare/non-object envelopes classify delivery without resend", async () => {
	// Malformed SendResult payloads -> delivery: "unknown", status: "uncertain", code: "protocol_error", 0 resend
	for (const badSendStdout of [
		"",
		"not json",
		"[]",
		JSON.stringify({}),
		JSON.stringify({ turn: -1 }),
		JSON.stringify({ turn: 1.5 }),
		JSON.stringify({ turn: 4, started: "yes" }),
		JSON.stringify({ turn: 4, status: 123 }),
	]) {
		const { deps, calls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle")),
			"hc send": () => ({ stdout: badSendStdout }),
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "bad send stdout", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "uncertain");
		assert.equal(res.delivery, "unknown");
		assert.equal(res.error?.code, "protocol_error");
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 1);
	}

	// Pre-input explicit rejection kinds (7 kinds x 2 envelopes: error.kind and error.data.kind) -> delivery: "not_sent"
	const preInputCases: Array<{ kind: string; code: string }> = [
		{ kind: "status_mismatch", code: "status_mismatch" },
		{ kind: "blocked", code: "agent_blocked" },
		{ kind: "finished", code: "terminal_finished" },
		{ kind: "not_found", code: "target_not_found" },
		{ kind: "machine_unknown", code: "machine_unknown" },
		{ kind: "invalid_params", code: "invalid_params" },
		{ kind: "config", code: "hc_config" },
	];
	for (const { kind, code } of preInputCases) {
		for (const useDataKind of [false, true]) {
			const { deps, calls } = fakeHcExec({
				"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle")),
				"hc send": () => hcErr(kind, `SECRET_ERR_${kind}`, useDataKind),
			});
			const res = await callRegisteredAgent(
				deps,
				{ target: HC_TARGET_ID, text: "pre-input reject", resultFile: HC_RESULT_PATH },
				"",
			);
			assert.equal(res.ok, false);
			assert.equal(res.status, "not_sent");
			assert.equal(res.delivery, "not_sent");
			assert.equal(res.error?.code, code);
			assert.doesNotMatch(res.error?.message ?? "", /SECRET_ERR_/);
			assert.equal(calls.filter((c) => c.args[0] === "send").length, 1);
		}
	}

	// 2 unknown send kinds x 2 envelopes -> delivery: "unknown", status: "uncertain", 0 resend
	for (const [kind, code] of [
		["unavailable", "hc_unavailable"],
		["cancelled", "hc_cancelled"],
	] as const) {
		for (const useDataKind of [false, true]) {
			const { deps, calls } = fakeHcExec({
				"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle")),
				"hc send": () => hcErr(kind, `SECRET_ERR_${kind}`, useDataKind),
			});
			const res = await callRegisteredAgent(
				deps,
				{ target: HC_TARGET_ID, text: "unknown send kind", resultFile: HC_RESULT_PATH },
				"",
			);
			assert.equal(res.ok, false);
			assert.equal(res.status, "uncertain");
			assert.equal(res.delivery, "unknown");
			assert.equal(res.error?.code, code);
			assert.match(res.error?.message ?? "", /Do not resend/);
			assert.doesNotMatch(res.error?.message ?? "", /SECRET_ERR_/);
			assert.equal(calls.filter((c) => c.args[0] === "send").length, 1);
		}
	}

	// F2: needs_target on send, bare kind, bare data.kind, null/non-object error, unrecognized kind, killed, throw -> unknown + Do not resend, 1 send
	for (const ambiguousSend of [
		() => hcErr("needs_target", "wait-only kind", false),
		() => hcErr("needs_target", "wait-only data kind", true),
		() => ({ code: 1, stderr: JSON.stringify({ kind: "status_mismatch" }) }),
		() => ({ code: 1, stderr: JSON.stringify({ data: { kind: "status_mismatch" } }) }),
		() => ({ code: 1, stderr: JSON.stringify({ error: null, kind: "status_mismatch" }) }),
		() => ({ code: 1, stderr: JSON.stringify({ error: "status_mismatch" }) }),
		() => hcErr("mystery_kind", "unexpected error"),
		() => ({ code: 1, stderr: "plain stderr failure" }),
		() => ({ code: 1, killed: true, stderr: "" }),
		() => new Error("spawn EIO"),
	]) {
		const { deps, calls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle")),
			"hc send": ambiguousSend,
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "ambiguous send", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "uncertain");
		assert.equal(res.delivery, "unknown");
		assert.match(res.error?.message ?? "", /Do not resend/);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 1);
	}
});

test("hc boundary 2: WaitResult validation (malformed wait, terminal mismatch, turn regression or non-advance, ended=false with idle/done, unexpected ended=true) and follow-up hc wait after timeout/message", async () => {
	// Invalid or non-advancing WaitResult cases -> status: "uncertain", delivery: "submitted", code: "protocol", 0 file open
	for (const badWait of [
		// malformed wait object (missing children array)
		{ terminal: HC_TARGET_ID, ended: true, reason: "status", status: "done", turn: 5 },
		// terminal mismatch
		hcWaitJson("t999", { ended: true, reason: "status", status: "done", turn: 5 }),
		// turn regression (< send.turn)
		hcWaitJson(HC_TARGET_ID, { ended: true, reason: "status", status: "done", turn: 3 }),
		// turn non-advancing (=== send.turn, e.g. stale done without working)
		hcWaitJson(HC_TARGET_ID, { ended: true, reason: "status", status: "done", turn: 4 }),
		// ended=false with idle/done or non-continuable reason
		hcWaitJson(HC_TARGET_ID, { ended: false, reason: "status", status: "done", turn: 5 }),
		hcWaitJson(HC_TARGET_ID, { ended: false, reason: "status", status: "idle", turn: 5 }),
		hcWaitJson(HC_TARGET_ID, { ended: false, reason: "timeout", status: "done", turn: 5 }),
		hcWaitJson(HC_TARGET_ID, { ended: false, reason: "timeout", status: "idle", turn: 5 }),
		// ended=true with unexpected reason or working/null status
		hcWaitJson(HC_TARGET_ID, { ended: true, reason: "timeout", status: "done", turn: 5 }),
		hcWaitJson(HC_TARGET_ID, { ended: true, reason: "message", status: "done", turn: 5 }),
		hcWaitJson(HC_TARGET_ID, { ended: true, reason: "status", status: "working", turn: 5 }),
		hcWaitJson(HC_TARGET_ID, { ended: true, reason: "status", status: null, turn: 5 }),
	]) {
		const { deps, getOpenCalls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () =>
				ok(
					hcSendJson(HC_TARGET_ID, {
						started: true,
						status: "working",
						wait: badWait,
					}),
				),
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "check wait validation", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "uncertain");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.error?.code, "protocol");
		assert.equal(getOpenCalls(), 0);
	}

	// Turn regression between preflight hcGet (turn: 5) and hcSend (turn: 4) -> uncertain/protocol, submitted
	{
		const { deps, getOpenCalls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 5 })),
			"hc send": () => ok(hcSendJson(HC_TARGET_ID, { turn: 4 })),
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "preflight turn regression", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "uncertain");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.error?.code, "protocol");
		assert.equal(getOpenCalls(), 0);
	}

	// Follow-up hc wait loop when send.wait has ended=false with reason="timeout" then "message" then idle
	{
		const waitResponses = [
			ok(
				hcWaitJson(HC_TARGET_ID, {
					ended: false,
					reason: "message",
					status: "working",
					turn: 5,
				}),
			),
			ok(
				hcWaitJson(HC_TARGET_ID, {
					ended: true,
					reason: "status",
					status: "idle",
					turn: 5,
				}),
			),
		];
		const { deps, calls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () =>
				ok(
					hcSendJson(HC_TARGET_ID, {
						started: true,
						status: "working",
						wait: hcWaitJson(HC_TARGET_ID, {
							ended: false,
							reason: "timeout",
							status: "working",
							turn: 5,
						}),
					}),
				),
			"hc wait": () => waitResponses.shift()!,
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "follow-up wait", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, true);
		assert.equal(res.status, "answered");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.state, "idle");
		assert.equal(res.answer, "hc file answer");
		assert.equal(calls.filter((c) => c.args[0] === "wait").length, 2);
	}

	// Turn regression across follow-up hc wait (send.turn=4 -> wait1.turn=6 -> wait2.turn=5) -> uncertain/protocol
	{
		const waitResponses = [
			ok(
				hcWaitJson(HC_TARGET_ID, {
					ended: true,
					reason: "status",
					status: "done",
					turn: 5,
				}),
			),
		];
		const { deps, getOpenCalls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () =>
				ok(
					hcSendJson(HC_TARGET_ID, {
						started: true,
						status: "working",
						wait: hcWaitJson(HC_TARGET_ID, {
							ended: false,
							reason: "timeout",
							status: "working",
							turn: 6,
						}),
					}),
				),
			"hc wait": () => waitResponses.shift()!,
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "monotonic turn check", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "uncertain");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.error?.code, "protocol");
		assert.equal(getOpenCalls(), 0);
	}
});

test("hc boundary 2: preflight hc get states (finished, reported=false, done, working, blocked, error) and post-send blocked, error, exit, and follow-up wait failure (including needs_target)", async () => {
	// Preflight state="finished", reported=false, status.state="done"|"working"|"blocked"|"error" -> all rejected before hc send
	const preflightCases: Array<{
		terminal: Record<string, unknown>;
		expectedCode: string;
		expectedMessage?: RegExp;
	}> = [
		{
			terminal: hcTerminalJson(HC_TARGET_ID, "idle", { state: "finished" }),
			expectedCode: "terminal_finished",
		},
		{
			terminal: hcTerminalJson(HC_TARGET_ID, null, { reported: false }),
			expectedCode: "not_reported",
		},
		{
			terminal: hcTerminalJson(HC_TARGET_ID, "done"),
			expectedCode: "agent_done",
			expectedMessage: /target finished its last turn; a new turn needs idle/,
		},
		{
			terminal: hcTerminalJson(HC_TARGET_ID, "working"),
			expectedCode: "agent_busy",
		},
		{
			terminal: hcTerminalJson(HC_TARGET_ID, "blocked"),
			expectedCode: "agent_blocked",
		},
		{
			terminal: hcTerminalJson(HC_TARGET_ID, "error"),
			expectedCode: "agent_state_unknown",
		},
	];
	for (const { terminal, expectedCode, expectedMessage } of preflightCases) {
		const { deps, calls } = fakeHcExec({
			"hc get": () => ok(terminal),
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "preflight gate", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "not_sent");
		assert.equal(res.delivery, "not_sent");
		assert.equal(res.error?.code, expectedCode);
		if (expectedMessage) {
			assert.match(res.error?.message ?? "", expectedMessage);
		}
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 0);
	}

	// Post-send status="blocked" -> response_unverified, submitted, error.code="agent_blocked", 0 file open, 0 keys/--force
	{
		const { deps, calls, getOpenCalls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () =>
				ok(
					hcSendJson(HC_TARGET_ID, {
						started: true,
						status: "blocked",
						wait: hcWaitJson(HC_TARGET_ID, {
							ended: true,
							reason: "status",
							status: "blocked",
							turn: 5,
						}),
					}),
				),
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "needs approval", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "response_unverified");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.error?.code, "agent_blocked");
		assert.equal(getOpenCalls(), 0);
		assert.equal(
			calls.some((c) => c.args.includes("keys") || c.args.includes("--force")),
			false,
		);
	}

	// Post-send status="error" -> response_unverified, submitted, error.code="agent_error"
	{
		const { deps, getOpenCalls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () =>
				ok(
					hcSendJson(HC_TARGET_ID, {
						started: true,
						status: "error",
						wait: hcWaitJson(HC_TARGET_ID, {
							ended: true,
							reason: "status",
							status: "error",
							turn: 5,
						}),
					}),
				),
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "triggers error", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "response_unverified");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.error?.code, "agent_error");
		assert.equal(getOpenCalls(), 0);
	}

	// Post-send reason="exit" with exit_code and numeric signal -> response_unverified, submitted, error.code="terminal_finished"
	{
		const { deps, getOpenCalls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () =>
				ok(
					hcSendJson(HC_TARGET_ID, {
						started: true,
						status: "working",
						wait: hcWaitJson(HC_TARGET_ID, {
							ended: true,
							reason: "exit",
							status: null,
							turn: 5,
							exit_code: 137,
							signal: 9,
						}),
					}),
				),
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "crashes", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "response_unverified");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.error?.code, "terminal_finished");
		assert.equal(res.error?.exitCode, 137);
		assert.match(res.error?.message ?? "", /exit_code=137/);
		assert.match(res.error?.message ?? "", /signal=9/);
		assert.equal(getOpenCalls(), 0);
	}

	// Post-send follow-up hc wait failure (including needs_target) preserves delivery="submitted"
	for (const waitErrKind of ["unavailable", "not_found", "needs_target"] as const) {
		const { deps, calls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () =>
				ok(
					hcSendJson(HC_TARGET_ID, {
						started: true,
						status: "working",
						wait: hcWaitJson(HC_TARGET_ID, {
							ended: false,
							reason: "timeout",
							status: "working",
							turn: 5,
						}),
					}),
				),
			"hc wait": () => hcErr(waitErrKind, "wait failed after send"),
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "wait fails", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "uncertain");
		assert.equal(res.delivery, "submitted");
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 1);
	}
});

test("hc boundary 3: 60s budget with 5s file reserve, fractional timeout rounding, AbortController during send/wait, and fs seam deadline/abort during open/stat/read", async () => {
	// Lookup + get elapsed time reduces hc send --wait budget (60s total - 5s reserve - 4s lookup/get = 51s)
	{
		let sendArgs: string[] = [];
		let sendExecTimeout: number | undefined;
		const { deps, advance } = fakeHcExec({
			"hc ls": () => {
				advance(2_000);
				return ok({
					terminals: [{ address: HC_TARGET_ID, name: "worker" }],
					hidden_finished: 0,
					machines: [],
				});
			},
			"hc get": () => {
				advance(2_000);
				return ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 }));
			},
			"hc send": (args, options) => {
				sendArgs = args;
				sendExecTimeout = options?.timeout;
				return ok(hcSendJson(HC_TARGET_ID));
			},
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: "worker", text: "budget check", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, true);
		assert.equal(sendArgs[sendArgs.indexOf("--timeout") + 1], "51");
		assert.equal(sendExecTimeout, 51_000);
	}

	// Fractional remaining ms (1500.7ms before waitDeadline) -> CLI "--timeout 2", exec timeout 1500 (integer)
	{
		let waitArgs: string[] = [];
		let waitExecTimeout: number | undefined;
		const { deps, setClock } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () => {
				setClock(54_499.3);
				return ok(
					hcSendJson(HC_TARGET_ID, {
						started: true,
						status: "working",
						wait: hcWaitJson(HC_TARGET_ID, {
							ended: false,
							reason: "timeout",
							status: "working",
							turn: 5,
						}),
					}),
				);
			},
			"hc wait": (args, options) => {
				waitArgs = args;
				waitExecTimeout = options?.timeout;
				return ok(hcWaitJson(HC_TARGET_ID));
			},
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "fractional timeout", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, true);
		assert.equal(waitArgs[waitArgs.indexOf("--timeout") + 1], "2");
		assert.equal(waitExecTimeout, 1_500);
		assert.equal(Number.isInteger(waitExecTimeout), true);
	}

	// Remaining < 1ms before follow-up wait -> does not spawn hc wait, returns timeout with delivery="submitted"
	{
		const { deps, calls, setClock } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () => {
				setClock(55_999.5);
				return ok(
					hcSendJson(HC_TARGET_ID, {
						started: true,
						status: "working",
						wait: hcWaitJson(HC_TARGET_ID, {
							ended: false,
							reason: "timeout",
							status: "working",
							turn: 5,
						}),
					}),
				);
			},
			"hc wait": () => {
				throw new Error("should not spawn hc wait when < 1ms remains");
			},
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "sub-ms cutoff", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "uncertain");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.error?.code, "timeout");
		assert.equal(calls.filter((c) => c.args[0] === "wait").length, 0);
		assert.equal(deps.inFlight.size, 0);
	}

	// F4c: AbortController signal forwarded and aborted during hc send -> delivery="unknown", inFlight cleared
	{
		const controller = new AbortController();
		let receivedSignal: AbortSignal | undefined;
		const { deps } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": (_args, options) => {
				receivedSignal = options?.signal;
				controller.abort();
				return { code: 1, killed: true, stderr: "" };
			},
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "abort during send", resultFile: HC_RESULT_PATH },
			"",
			controller.signal,
		);
		assert.equal(receivedSignal, controller.signal);
		assert.equal(res.ok, false);
		assert.equal(res.status, "uncertain");
		assert.equal(res.delivery, "unknown");
		assert.equal(res.error?.code, "aborted");
		assert.equal(deps.inFlight.size, 0);
	}

	// F4c: AbortController signal forwarded and aborted during follow-up hc wait -> delivery="submitted", inFlight cleared
	{
		const controller = new AbortController();
		let receivedWaitSignal: AbortSignal | undefined;
		const { deps } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () =>
				ok(
					hcSendJson(HC_TARGET_ID, {
						started: true,
						status: "working",
						wait: hcWaitJson(HC_TARGET_ID, {
							ended: false,
							reason: "timeout",
							status: "working",
							turn: 5,
						}),
					}),
				),
			"hc wait": (_args, options) => {
				receivedWaitSignal = options?.signal;
				controller.abort();
				return { code: 1, killed: true, stderr: "" };
			},
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "abort during wait", resultFile: HC_RESULT_PATH },
			"",
			controller.signal,
		);
		assert.equal(receivedWaitSignal, controller.signal);
		assert.equal(res.ok, false);
		assert.equal(res.status, "uncertain");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.error?.code, "aborted");
		assert.equal(deps.inFlight.size, 0);
	}

	// F3: Budget expiration during open, stat, and first read -> 0 extra reads, no success, submitted preserved, handle closed, inFlight cleared
	for (const expireStage of ["open", "stat", "read"] as const) {
		const { deps, setClock } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () => ok(hcSendJson(HC_TARGET_ID)),
		});
		const { handle, counts } = fakeFileHandle("chunk-1-chunk-2", {
			onStat: () => {
				if (expireStage === "stat") setClock(61_000);
				return { isFile: () => true, nlink: 1, size: 15 };
			},
			onRead: (buffer, offset) => {
				if (expireStage === "read") setClock(61_000);
				// Return only partial bytes (5 of 15) so a second read would happen if not stopped by deadline
				buffer.set(new TextEncoder().encode("chunk"), offset);
				return { bytesRead: 5, buffer };
			},
		});
		deps.fs = {
			lstat: async () => {
				throw enoentError();
			},
			open: async () => {
				if (expireStage === "open") setClock(61_000);
				return handle;
			},
		};
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: `expire in ${expireStage}`, resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false, expireStage);
		assert.equal(res.status, "uncertain", expireStage);
		assert.equal(res.delivery, "submitted", expireStage);
		assert.equal(res.error?.code, "timeout", expireStage);
		if (expireStage === "open") {
			assert.equal(counts.stat, 0);
			assert.equal(counts.read, 0);
		} else if (expireStage === "stat") {
			assert.equal(counts.stat, 1);
			assert.equal(counts.read, 0);
		} else {
			assert.equal(counts.stat, 1);
			assert.equal(counts.read, 1);
		}
		assert.equal(counts.close, 1, expireStage);
		assert.equal(deps.inFlight.size, 0, expireStage);
	}

	// F3: Abort during first read of multi-chunk file stops further reads, closes handle, and clears inFlight
	{
		const controller = new AbortController();
		const { deps } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () => ok(hcSendJson(HC_TARGET_ID)),
		});
		const { handle: abortingHandle, counts: abortCounts } = fakeFileHandle("0123456789", {
			onRead: async (buffer, offset) => {
				controller.abort();
				buffer.set(new Uint8Array([48, 49]), offset);
				return { bytesRead: 2, buffer };
			},
		});
		deps.fs = {
			lstat: async () => {
				throw enoentError();
			},
			open: async () => abortingHandle,
		};
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "abort in read", resultFile: HC_RESULT_PATH },
			"",
			controller.signal,
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "read_failed");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.error?.code, "aborted");
		assert.equal(abortCounts.read, 1);
		assert.equal(abortCounts.close, 1);
		assert.equal(deps.inFlight.size, 0);
	}

	// R13-F1: Pending open Promise held by external gate finishes on deadline timer BEFORE gate release, clears inFlight, and closes late handle on gate release
	{
		let resolveOpenGate!: (h: ResultFileHandle) => void;
		let openEnteredResolve!: () => void;
		const openEntered = new Promise<void>((r) => {
			openEnteredResolve = r;
		});
		const openGate = new Promise<ResultFileHandle>((r) => {
			resolveOpenGate = r;
		});
		const { deps, setClock } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () => {
				// Leave 5ms before the 61_000ms call deadline (startedAt = 1_000)
				setClock(60_995);
				return ok(hcSendJson(HC_TARGET_ID));
			},
		});
		const { handle: lateHandle, counts: lateOpenCounts } = fakeFileHandle("late-answer");
		deps.fs = {
			lstat: async () => {
				throw enoentError();
			},
			open: () => {
				openEnteredResolve();
				return openGate;
			},
		};
		const callPromise = callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "gated open timeout", resultFile: HC_RESULT_PATH },
			"",
		);
		await openEntered;
		assert.equal(deps.inFlight.has(HC_TARGET_ID), true);
		// Wait for the 5ms residual budget timer to fire while openGate is still pending
		const gatedOpenRes = await callPromise;
		assert.equal(gatedOpenRes.ok, false);
		assert.equal(gatedOpenRes.status, "uncertain");
		assert.equal(gatedOpenRes.delivery, "submitted");
		assert.equal(gatedOpenRes.error?.code, "timeout");
		assert.equal(deps.inFlight.size, 0);
		assert.equal(lateOpenCounts.close, 0);

		// Release the open gate afterwards -> late handle is closed and 0 reads are started
		resolveOpenGate(lateHandle);
		await new Promise((r) => setTimeout(r, 5));
		assert.equal(lateOpenCounts.close, 1);
		assert.equal(lateOpenCounts.stat, 0);
		assert.equal(lateOpenCounts.read, 0);
	}

	// R13-F1: Pending read Promise held by external gate finishes on abort BEFORE gate release, clears inFlight, and closes handle without further reads on gate release
	{
		const controller = new AbortController();
		let resolveReadGate!: (v: { bytesRead: number; buffer: Uint8Array }) => void;
		let readEnteredResolve!: () => void;
		const readEntered = new Promise<void>((r) => {
			readEnteredResolve = r;
		});
		const readGate = new Promise<{ bytesRead: number; buffer: Uint8Array }>((r) => {
			resolveReadGate = r;
		});
		const { deps } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () => ok(hcSendJson(HC_TARGET_ID)),
		});
		let gatedReadCalls = 0;
		let gatedCloseCalls = 0;
		let gatedBuf!: Uint8Array;
		const gatedHandle: ResultFileHandle = {
			stat: async () => ({ isFile: () => true, nlink: 1, size: 12 }),
			read: (buffer) => {
				gatedReadCalls++;
				gatedBuf = buffer;
				readEnteredResolve();
				return readGate;
			},
			close: async () => {
				gatedCloseCalls++;
			},
		};
		deps.fs = {
			lstat: async () => {
				throw enoentError();
			},
			open: async () => gatedHandle,
		};
		const callPromise = callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "gated read abort", resultFile: HC_RESULT_PATH },
			"",
			controller.signal,
		);
		await readEntered;
		assert.equal(deps.inFlight.has(HC_TARGET_ID), true);
		controller.abort();
		// Finishes BEFORE readGate is released
		const gatedReadRes = await callPromise;
		assert.equal(gatedReadRes.ok, false);
		assert.equal(gatedReadRes.status, "read_failed");
		assert.equal(gatedReadRes.delivery, "submitted");
		assert.equal(gatedReadRes.error?.code, "aborted");
		assert.equal(deps.inFlight.size, 0);
		assert.equal(gatedReadCalls, 1);

		// Release readGate with partial bytes (4 of 12) -> no second read is started, handle is closed
		gatedBuf.set(new TextEncoder().encode("part"), 0);
		resolveReadGate({ bytesRead: 4, buffer: gatedBuf });
		await new Promise((r) => setTimeout(r, 5));
		assert.equal(gatedReadCalls, 1);
		assert.equal(gatedCloseCalls, 1);
	}

	// R13-F1: Pre-send lstat Promise held by external gate finishes on deadline timer BEFORE gate release -> send 0, not_sent ("result file check timed out"), inFlight cleared
	{
		let resolveLstatGate!: () => void;
		let lstatEnteredResolve!: () => void;
		const lstatEntered = new Promise<void>((r) => {
			lstatEnteredResolve = r;
		});
		const lstatGate = new Promise<ResultFileStat>((r) => {
			resolveLstatGate = () => r({ isFile: () => true, nlink: 1, size: 1 });
		});
		const { deps, calls, setClock } = fakeHcExec({
			"hc get": () => {
				// Leave 5ms before waitDeadline (56_000ms, startedAt = 1_000) for pre-send lstat re-check
				setClock(55_995);
				return ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 }));
			},
			"hc send": () => {
				throw new Error("should not spawn hc send when pre-send lstat times out");
			},
		});
		let lstatCalls = 0;
		deps.fs = {
			lstat: () => {
				lstatCalls++;
				if (lstatCalls === 1) {
					return Promise.reject(enoentError());
				}
				lstatEnteredResolve();
				return lstatGate;
			},
			open: async () => {
				throw new Error("should not open");
			},
		};
		const callPromise = callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "gated pre-send lstat", resultFile: HC_RESULT_PATH },
			"",
		);
		await lstatEntered;
		assert.equal(deps.inFlight.has(HC_TARGET_ID), true);
		// Finishes BEFORE lstatGate is released
		const gatedLstatRes = await callPromise;
		assert.equal(gatedLstatRes.ok, false);
		assert.equal(gatedLstatRes.status, "not_sent");
		assert.equal(gatedLstatRes.delivery, "not_sent");
		assert.equal(gatedLstatRes.error?.code, "timeout");
		assert.equal(gatedLstatRes.error?.message, "result file check timed out");
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 0);
		assert.equal(deps.inFlight.size, 0);

		resolveLstatGate();
		await new Promise((r) => setTimeout(r, 5));
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 0);
	}
});

test("hc boundary 4: self_target (by ID and by name), inFlight across name and ID, remote address rejection, name resolution, and leading '-' text rejection", async () => {
	// Self target by ID and by resolved name -> self_target, not_sent, 0 send
	for (const selfTarget of [HC_CALLER_ID, "caller"]) {
		const { deps, calls } = fakeHcExec({
			"hc ls": () =>
				ok({
					terminals: [{ address: HC_CALLER_ID, name: "caller" }],
					hidden_finished: 0,
					machines: [],
				}),
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: selfTarget, text: "self call", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "not_sent");
		assert.equal(res.delivery, "not_sent");
		assert.equal(res.error?.code, "self_target");
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 0);
	}

	// Remote address direct ("rohan/t7") and resolved via name ("remote-worker" -> "rohan/t7") -> rejected before send
	for (const target of ["rohan/t7", "remote-worker"]) {
		const { deps, calls } = fakeHcExec({
			"hc ls": () =>
				ok({
					terminals: [{ address: "rohan/t7", name: "remote-worker" }],
					hidden_finished: 0,
					machines: [],
				}),
		});
		const res = await callRegisteredAgent(
			deps,
			{ target, text: "remote call", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "not_sent");
		assert.equal(res.delivery, "not_sent");
		assert.equal(res.error?.code, "invalid_request");
		assert.equal(res.error?.message, "remote result file recovery unsupported");
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 0);
	}

	// Name resolution: 0 matches, 2+ matches, and broken rows
	{
		const { deps: deps0 } = fakeHcExec({
			"hc ls": () =>
				ok({
					terminals: [{ address: "t9", name: "other" }],
					hidden_finished: 0,
					machines: [],
				}),
		});
		const res0 = await callRegisteredAgent(
			deps0,
			{ target: "missing-agent", text: "hi", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res0.error?.code, "target_not_found");

		const { deps: deps2 } = fakeHcExec({
			"hc ls": () =>
				ok({
					terminals: [
						{ address: "t2", name: "dup" },
						{ address: "t3", name: "dup" },
					],
					hidden_finished: 0,
					machines: [],
				}),
		});
		const res2 = await callRegisteredAgent(
			deps2,
			{ target: "dup", text: "hi", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res2.error?.code, "target_ambiguous");

		const { deps: depsBroken } = fakeHcExec({
			"hc ls": () =>
				ok({
					terminals: [{ bad: true }],
					hidden_finished: 0,
					machines: [],
				}),
		});
		const resBroken = await callRegisteredAgent(
			depsBroken,
			{ target: "worker", text: "hi", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(resBroken.error?.code, "protocol_error");
	}

	// Text starting with '-' is rejected on hc before any lstat or hc exec
	for (const dashText of ["-v", "--help", "--json"]) {
		const { deps, calls, getLstatCalls } = fakeHcExec({});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: dashText, resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "not_sent");
		assert.equal(res.delivery, "not_sent");
		assert.equal(res.error?.code, "invalid_request");
		assert.equal(res.error?.message, "text starting with '-' unsupported on hc");
		assert.equal(getLstatCalls(), 0);
		assert.equal(calls.length, 0);
	}

	// Concurrent call by name ("reviewer" -> "t7") and by ID ("t7"): second call while first is in flight is rejected with target_busy on canonical address "t7", and embedded flags in text are preserved
	{
		let releaseFirstSend!: () => void;
		const firstSendGate = new Promise<void>((resolve) => {
			releaseFirstSend = resolve;
		});
		const { deps, calls } = fakeHcExec({
			"hc ls": () =>
				ok({
					terminals: [{ address: "t7", name: "reviewer" }],
					hidden_finished: 0,
					machines: [],
				}),
			"hc get": () => ok(hcTerminalJson("t7", "idle", { name: "reviewer", turn: 4 })),
			"hc send": async () => {
				await firstSendGate;
				return ok(hcSendJson("t7"));
			},
		});

		const p1 = callRegisteredAgent(
			deps,
			{
				target: "reviewer",
				text: "run --help -v --json",
				resultFile: "/tmp/gjc-hc-1.md",
			},
			"",
		);
		await new Promise((r) => setTimeout(r, 10));
		assert.equal(deps.inFlight.has("t7"), true);

		// Concurrent call by ID "t7" hits the canonical inFlight set on "t7" without sending
		const r2 = await callRegisteredAgent(
			deps,
			{ target: "t7", text: "concurrent", resultFile: "/tmp/gjc-hc-2.md" },
			"",
		);
		assert.equal(r2.ok, false);
		assert.equal(r2.status, "not_sent");
		assert.equal(r2.delivery, "not_sent");
		assert.equal(r2.error?.code, "target_busy");
		assert.equal(r2.pane, "t7");

		releaseFirstSend();
		const r1 = await p1;
		assert.equal(r1.ok, true);
		assert.equal(r1.pane, "t7");
		const sendCalls = calls.filter((c) => c.args[0] === "send");
		assert.equal(sendCalls.length, 1);
		assert.equal(sendCalls[0]!.args[sendCalls[0]!.args.length - 2], "t7");
		assert.match(
			sendCalls[0]!.args[sendCalls[0]!.args.length - 1]!,
			/^run --help -v --json/,
		);
		assert.equal(deps.inFlight.size, 0);
	}
});

test("hc boundary 5: requires --result-file, supports result_file alias, rejects bad paths and initial/pre-send lstat conflicts without raw Error.message, and enforces handle bounds", async () => {
	// Missing resultFile -> rejected before any hc command
	{
		const { deps, calls } = fakeHcExec({});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "no result file" },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "not_sent");
		assert.equal(res.delivery, "not_sent");
		assert.equal(res.error?.code, "invalid_request");
		assert.equal(res.error?.message, "hc backend requires --result-file");
		assert.equal(calls.length, 0);
	}

	// F4d: result_file snake_case alias works on hc
	{
		const { deps } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () => ok(hcSendJson(HC_TARGET_ID)),
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "alias check", result_file: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, true);
		assert.equal(res.resultFile, HC_RESULT_PATH);
	}

	// F4d: Invalid paths rejected on hc before any lstat or hc call
	for (const badPath of [
		"relative/out.md",
		"./out.md",
		"",
		"   ",
		" /tmp/out.md",
		"/tmp/out.md ",
		"/tmp/bad\0path.md",
		"/tmp/bad\rpath.md",
		"/tmp/bad\npath.md",
	]) {
		const { deps, calls, getLstatCalls } = fakeHcExec({});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "bad path", resultFile: badPath },
			"",
		);
		assert.equal(res.ok, false, badPath);
		assert.equal(res.status, "not_sent", badPath);
		assert.equal(res.delivery, "not_sent", badPath);
		assert.equal(res.error?.code, "invalid_request", badPath);
		assert.equal(getLstatCalls(), 0, badPath);
		assert.equal(calls.length, 0, badPath);
	}

	// F4d & F1: Initial lstat existing file and initial lstat throwing Error with secret message -> rejected before any hc call without leaking Error.message or path
	for (const initialMode of ["exists", "eacces"] as const) {
		const { deps, calls } = fakeHcExec({});
		deps.fs = {
			lstat: async () => {
				if (initialMode === "exists") {
					return { isFile: () => true, size: 10 };
				}
				throw Object.assign(
					new Error("EACCES: SECRET_LSTAT_ERR_MSG /tmp/secret.sock"),
					{ code: "EACCES" },
				);
			},
			open: async () => {
				throw new Error("should not open");
			},
		};
		const res = await callRegisteredAgent(
			deps,
			{
				target: HC_TARGET_ID,
				text: "initial lstat check",
				resultFile: "/tmp/SECRET_RESULT_PATH_INIT.md",
			},
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "not_sent");
		assert.equal(res.delivery, "not_sent");
		assert.equal(res.error?.code, "invalid_request");
		assert.match(res.error?.message ?? "", /^result file check failed:/);
		assert.doesNotMatch(res.error?.message ?? "", /SECRET_/);
		assert.equal(calls.length, 0);
	}

	// File created during preflight hc get -> rejected on second lstat before hc send
	{
		let createdDuringGet = false;
		let lstatCalls = 0;
		const { deps, calls } = fakeHcExec({
			"hc get": () => {
				createdDuringGet = true;
				return ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 }));
			},
		});
		deps.fs = {
			lstat: async () => {
				lstatCalls++;
				if (!createdDuringGet) throw enoentError();
				return { isFile: () => true, size: 5 };
			},
			open: async () => {
				throw new Error("should not open");
			},
		};
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "race check", resultFile: HC_RESULT_PATH },
			"",
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "not_sent");
		assert.equal(res.delivery, "not_sent");
		assert.equal(res.error?.code, "invalid_request");
		assert.equal(res.error?.message, "result file check failed: already exists");
		assert.equal(lstatCalls, 2);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 0);
	}

	// Post-send file validation failures (missing, ELOOP, stat throw, read throw, not-file, nlink !== 1, > 1 MiB, invalid UTF-8): fixed message, 0 Error.message leak, submitted, handle closed
	for (const mode of [
		"missing",
		"eloop",
		"stat-throw",
		"read-throw",
		"not-file",
		"nlink-2",
		"too-large",
		"bad-utf8",
	] as const) {
		const content =
			mode === "bad-utf8"
				? new Uint8Array([0xff, 0xfe, 0xfd])
				: "valid content";
		const { handle, counts } = fakeFileHandle(content, {
			isFile: () => mode !== "not-file",
			nlink: mode === "nlink-2" ? 2 : 1,
			size: mode === "too-large" ? 1_024 * 1_024 + 1 : undefined,
			onStat:
				mode === "stat-throw"
					? () => {
							throw new Error("SECRET_STAT_ERROR_MESSAGE");
						}
					: undefined,
			onRead:
				mode === "read-throw"
					? () => {
							throw new Error("SECRET_READ_ERROR_MESSAGE");
						}
					: undefined,
		});
		const { deps, calls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () => ok(hcSendJson(HC_TARGET_ID)),
		});
		deps.fs = {
			lstat: async () => {
				throw enoentError();
			},
			open: async () => {
				if (mode === "missing") throw enoentError();
				if (mode === "eloop") {
					throw Object.assign(
						new Error("ELOOP: SECRET_OPEN_SYMLINK_ERROR"),
						{ code: "ELOOP" },
					);
				}
				return handle;
			},
		};
		const res = await callRegisteredAgent(
			deps,
			{
				target: HC_TARGET_ID,
				text: `mode ${mode}`,
				resultFile: "/tmp/SECRET_POST_SEND_PATH.md",
			},
			"",
		);
		assert.equal(res.ok, false, mode);
		assert.equal(res.status, "response_unverified", mode);
		assert.equal(res.delivery, "submitted", mode);
		const expectedCode =
			mode === "missing" ? "result_file_missing" : "result_file_invalid";
		assert.equal(res.error?.code, expectedCode, mode);
		assert.equal(
			res.error?.message,
			`result file check failed: ${expectedCode}`,
			mode,
		);
		assert.doesNotMatch(res.error?.message ?? "", /SECRET_/, mode);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 1, mode);
		if (mode !== "missing" && mode !== "eloop") {
			assert.equal(counts.close, 1, mode);
		}
	}
});

test("hc boundary 6: registerCallFeatures with hc backend verifies descriptions, custom hcBin exec, 0 herdr fallback, missing caller, and 0 secret leakage across command, tool, and logger", async () => {
	let commandDesc = "";
	let commandHandler: ((args: string) => Promise<void>) | undefined;
	let toolDesc = "";
	let toolExecute:
		| ((
				toolCallId: string,
				params: { target: string; text: string; result_file?: string },
				signal?: AbortSignal,
		  ) => Promise<{
				content: Array<{ type: string; text: string }>;
				details: AgentCallResult;
				isError: boolean;
		  }>)
		| undefined;
	const messages: Array<{ content: string; details: AgentCallResult }> = [];
	const loggedEntries: Array<{ msg: string; meta: unknown }> = [];
	const execCalls: Array<{ cmd: string; args: string[] }> = [];
	let nextExecImpl: (cmd: string, args: string[]) => Partial<ExecResult> = () => ({
		stdout: "",
		stderr: "",
		code: 1,
		killed: false,
	});

	const api = {
		exec: async (cmd: string, args: string[]) => {
			execCalls.push({ cmd, args });
			return {
				stdout: "",
				stderr: "",
				code: 0,
				killed: false,
				...nextExecImpl(cmd, args),
			};
		},
		logger: {
			info: (msg: string, meta?: unknown) => {
				loggedEntries.push({ msg, meta });
			},
			warn: (msg: string, meta?: unknown) => {
				loggedEntries.push({ msg, meta });
			},
		},
		registerCommand: (
			_name: string,
			cmd: { description: string; handler: (args: string) => Promise<void> },
		) => {
			commandDesc = cmd.description;
			commandHandler = cmd.handler;
		},
		registerTool: (tool: {
			description: string;
			execute: typeof toolExecute;
		}) => {
			toolDesc = tool.description;
			toolExecute = tool.execute;
		},
		sendMessage: async (msg: { content: string; details: AgentCallResult }) => {
			messages.push(msg);
		},
		zod: {
			z: {
				object: (shape: unknown) => shape,
				string: () => {
					const field = { optional: () => field, describe: () => field };
					return field;
				},
			},
		},
	} as unknown as ExtensionAPI;

	// 1. Missing hcCallerId -> invalid_request ("hc caller unknown"), 0 exec calls
	registerCallFeatures(api, "herdr", "", {
		backend: "hc",
		hcBin: "/custom/hc",
		hcCallerId: "",
	});
	assert.match(
		commandDesc,
		/hc: unattended target assumed \(not verified by the plugin\); a target left in done cannot take a follow-up automatically; text delivery only, no GJC session token/,
	);
	assert.match(
		toolDesc,
		/hc: unattended target assumed \(not verified by the plugin\); a target left in done cannot take a follow-up automatically; text delivery only, no GJC session token/,
	);
	// hc tool description must not claim 200-line screen reads or screen marker extraction
	assert.doesNotMatch(toolDesc, /200-line screen reads/);
	assert.doesNotMatch(toolDesc, /per-request marker lines/);

	await commandHandler!(
		`--result-file ${HC_RESULT_PATH} ${HC_TARGET_ID} SECRET_PROMPT_TEXT`,
	);
	assert.equal(messages.length, 1);
	assert.equal(messages[0]?.details.error?.code, "invalid_request");
	assert.equal(messages[0]?.details.error?.message, "hc caller unknown");
	assert.doesNotMatch(messages[0]?.content ?? "", /SECRET_PROMPT_TEXT/);
	assert.equal(execCalls.length, 0);

	// 2. F4b & F1: Registered with valid hcCallerId ("t1") and custom hcBin ("/custom/hc")
	messages.length = 0;
	loggedEntries.length = 0;
	execCalls.length = 0;
	registerCallFeatures(api, "herdr", SENDER_PANE, {
		backend: "hc",
		hcBin: "/custom/hc",
		hcCallerId: HC_CALLER_ID,
	});

	// 2a. Command call where hc send fails with stderr containing secret prompt, msg, session, socket -> custom hcBin used, 0 herdr fallback, 0 secret leak
	const nonExistentResultPath = `/tmp/gjc-herdr-nonexistent-${Date.now()}-${Math.random().toString(36).slice(2)}.md`;
	nextExecImpl = (_cmd, args) => {
		if (args[0] === "get") {
			return ok(
				hcTerminalJson(HC_TARGET_ID, "idle", {
					turn: 4,
					status: {
						state: "idle",
						kind: "claude",
						msg: "SECRET_MSG_TOKEN_999",
					},
				}),
			);
		}
		return {
			code: 1,
			stderr: JSON.stringify({
				error: {
					kind: "unavailable",
					message:
						"SECRET_PROMPT_BODY SECRET_MSG_TOKEN_999 session=SECRET_SESSION_UUID socket=/tmp/SECRET_SOCK.sock",
				},
			}),
		};
	};
	await commandHandler!(
		`--result-file ${nonExistentResultPath} ${HC_TARGET_ID} SECRET_PROMPT_BODY`,
	);
	assert.equal(execCalls.length, 2);
	assert.equal(execCalls[0]?.cmd, "/custom/hc");
	assert.equal(execCalls[1]?.cmd, "/custom/hc");
	assert.equal(
		execCalls.some((c) => c.cmd === "herdr"),
		false,
	);
	assert.equal(messages.length, 1);
	assert.equal(messages[0]?.details.delivery, "unknown");
	assert.equal(messages[0]?.details.status, "uncertain");
	assert.equal(messages[0]?.details.error?.code, "hc_unavailable");

	// 2b. Tool call where hc send succeeds (turn 4 -> 5) but result file is missing on disk -> 1 send, delivery="submitted", code="result_file_missing", 0 secret leak
	execCalls.length = 0;
	nextExecImpl = (_cmd, args) => {
		if (args[0] === "get") {
			return ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 }));
		}
		return ok(hcSendJson(HC_TARGET_ID));
	};
	const toolMissingRes = await toolExecute!("call-missing", {
		target: HC_TARGET_ID,
		text: "SECRET_PROMPT_BODY_2",
		result_file: nonExistentResultPath,
	});
	assert.equal(toolMissingRes.isError, true);
	assert.equal(toolMissingRes.details.delivery, "submitted");
	assert.equal(toolMissingRes.details.status, "response_unverified");
	assert.equal(toolMissingRes.details.error?.code, "result_file_missing");
	assert.equal(
		execCalls.filter((c) => c.cmd === "/custom/hc" && c.args[0] === "send")
			.length,
		1,
	);
	assert.equal(
		execCalls.some((c) => c.cmd === "herdr"),
		false,
	);

	// 2c. Tool call where initial lstat finds an existing path (`/tmp`) -> 0 send, delivery="not_sent", fixed message without path or Error.message
	execCalls.length = 0;
	const toolExistsRes = await toolExecute!("call-exists", {
		target: HC_TARGET_ID,
		text: "SECRET_PROMPT_BODY_3",
		result_file: "/tmp",
	});
	assert.equal(toolExistsRes.isError, true);
	assert.equal(toolExistsRes.details.delivery, "not_sent");
	assert.equal(toolExistsRes.details.status, "not_sent");
	assert.equal(toolExistsRes.details.error?.code, "invalid_request");
	assert.equal(
		toolExistsRes.details.error?.message,
		"result file check failed: already exists",
	);
	assert.equal(execCalls.length, 0);

	// Verify 0 secret leakage across all command messages, tool outputs, and logger entries, and verify logger excludes raw resultFile path
	const combinedOutputs = JSON.stringify({
		messages,
		toolMissingRes: toolMissingRes.content,
		toolExistsRes: toolExistsRes.content,
		loggedEntries,
	});
	for (const secret of [
		"SECRET_PROMPT_BODY",
		"SECRET_MSG_TOKEN_999",
		"SECRET_SESSION_UUID",
		"SECRET_SOCK.sock",
	]) {
		assert.equal(
			combinedOutputs.includes(secret),
			false,
			`leaked ${secret}`,
		);
	}
	const loggerJson = JSON.stringify(loggedEntries);
	assert.equal(loggerJson.includes(nonExistentResultPath), false);
	assert.match(loggerJson, /"hasResultFile":true/);
	assert.match(
		loggerJson,
		new RegExp(`"resultFileLength":${nonExistentResultPath.length}`),
	);
});



