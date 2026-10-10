import assert from "node:assert/strict";
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
		assert.equal(count("herdr agent read"), 0);
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
		zod: { z: { object: (shape: unknown) => shape, string: () => ({ describe: () => undefined }) } },
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
