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
