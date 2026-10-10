import assert from "node:assert/strict";
import test from "node:test";
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

type Handler = (args: string[]) => Partial<ExecResult> | Error;

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
	const calls: { command: string; args: string[] }[] = [];
	const exec: AgentCallDeps["exec"] = async (command, args) => {
		calls.push({ command, args });
		const key = `${command} ${args[0]} ${args[1]}`;
		const handler = routes[key];
		assert(handler, `unexpected exec ${command} ${args.join(" ")}`);
		const result = handler(args);
		if (result instanceof Error) throw result;
		return { stdout: "", stderr: "", code: 0, killed: false, ...result };
	};
	const count = (key: string) =>
		calls.filter(({ command, args }) => `${command} ${args[0]} ${args[1]}` === key)
			.length;
	const deps: AgentCallDeps = { exec, herdrBin: "herdr", inFlight: new Set() };
	return { deps, calls, count };
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
		assert.equal(calls.length, 1);
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

test("a focused target is not prompted and nothing is sent", async () => {
	const { deps, count } = fakeExec({
		"herdr agent get": () => agentGet("idle", { focused: true }),
	});
	const result = await callRegisteredAgent(deps, { target: TARGET_PANE, text: "hi" }, SENDER_PANE);
	assert.equal(result.ok, false);
	assert.equal(result.status, "not_sent");
	assert.equal(result.delivery, "not_sent");
	assert.equal(result.error?.code, "target_focused");
	assert.equal(count("herdr agent prompt"), 0);
});
