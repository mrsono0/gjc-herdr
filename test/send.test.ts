import assert from "node:assert/strict";
import test from "node:test";
import type {
	ExecResult,
	ExtensionAPI,
	ExtensionContext,
} from "@gajae-code/coding-agent";
import * as zod from "zod/v4";
import { SESSION_ID_KEY } from "../src/metadata.ts";
import {
	deliverPrompt,
	GJC_NOT_FOUND,
	parseCommandArgs,
	registerSendFeatures,
	type SendDeps,
	type SendResult,
	USAGE,
} from "../src/send.ts";

const SENDER = { sessionId: "sender-session", pane: "wE:p1" };
const TARGET = "receiver-session";

type Handler = (args: string[]) => Partial<ExecResult> | Error;

function ok(body: unknown): Partial<ExecResult> {
	return { stdout: JSON.stringify(body) };
}

function herdrError(code: string, message: string): Partial<ExecResult> {
	return { code: 1, stderr: JSON.stringify({ error: { code, message } }) };
}

function paneGet(
	paneId: string,
	tokens: Record<string, string> = {},
	extra: Record<string, unknown> = {},
) {
	return ok({
		result: { pane: { pane_id: paneId, agent: "gjc", tokens, ...extra } },
	});
}

/** Routes `herdr <a> <b>` and `gjc sdk session <verb>` calls; unrouted calls fail the test. */
function fakeExec(routes: Record<string, Handler>) {
	const calls: { command: string; args: string[] }[] = [];
	const exec: SendDeps["exec"] = async (command, args) => {
		calls.push({ command, args });
		const key =
			command === "gjc" ? `gjc ${args[2]}` : `herdr ${args[0]} ${args[1]}`;
		const handler = routes[key];
		assert(handler, `unexpected exec ${command} ${args.join(" ")}`);
		const result = handler(args);
		if (result instanceof Error) throw result;
		return { stdout: "", stderr: "", code: 0, killed: false, ...result };
	};
	const count = (key: string) =>
		calls.filter(({ command, args }) =>
			command === "gjc"
				? `gjc ${args[2]}` === key
				: `herdr ${args[0]} ${args[1]}` === key,
		).length;
	const deps: SendDeps = { exec, herdrBin: "herdr" };
	return { deps, calls, count };
}

const sent = (status: string, operationRef = "op-1") =>
	ok({ ok: true, result: { version: 2, operationRef, status } });

test("command arguments keep everything after the target separator verbatim", () => {
	assert.deepEqual(parseCommandArgs("wE:p2 hello"), {
		pane: "wE:p2",
		text: "hello",
	});
	assert.deepEqual(
		parseCommandArgs(' --wait  recvb  say "hi"\n  --raw --wait\tdone  '),
		{
			pane: "recvb",
			text: ' say "hi"\n  --raw --wait\tdone  ',
			wait: true,
		},
	);
	assert.deepEqual(parseCommandArgs("--raw wE:p2 x"), {
		pane: "wE:p2",
		text: "x",
		raw: true,
	});
	assert.equal(parseCommandArgs("--force wE:p2 x"), USAGE);
	assert.deepEqual(parseCommandArgs("  "), { pane: "", text: "" });
});

test("invalid requests are rejected before any exec", async () => {
	for (const [request, error] of [
		[{ pane: " ", text: "x" }, "Pane is required."],
		[{ pane: "wE:p2", text: " \n" }, "Prompt text must not be empty."],
		[
			{ pane: "wE:p2", text: "x", raw: true, wait: true },
			"Raw delivery does not support wait.",
		],
	] as const) {
		const { deps, calls } = fakeExec({});
		const result = await deliverPrompt(deps, request, SENDER);
		assert.equal(result.error, error);
		assert.equal(result.status, "not_sent");
		assert.equal(calls.length, 0);
	}
});

test("a session ID token is used directly and the prompt is sent exactly once", async () => {
	const { deps, calls, count } = fakeExec({
		"herdr pane get": () => paneGet("wE:p2", { [SESSION_ID_KEY]: TARGET }),
		"gjc send": () => sent("accepted"),
	});
	const text = '  line1\n"quoted" --wait  ';
	const result = await deliverPrompt(deps, { pane: "wE:p2", text }, SENDER);
	assert.deepEqual(result, {
		ok: true,
		mode: "sdk",
		status: "accepted",
		sessionId: TARGET,
		operationRef: "op-1",
		pane: "wE:p2",
	});
	assert.equal(count("herdr pane process-info"), 0);
	assert.equal(count("gjc list"), 0);
	const send = calls.find((call) => call.command === "gjc")!;
	assert.deepEqual(send.args, [
		"sdk",
		"session",
		"send",
		TARGET,
		"--text",
		text,
		"--json",
	]);
});

test("without a token, only a live session owning a foreground PID matches", async () => {
	const rows = [
		{ sessionId: "stale", pid: 101, live: false },
		{ sessionId: "elsewhere", pid: 999, live: true },
		{ sessionId: TARGET, pid: 101, live: true },
	];
	const run = (sessions: unknown[]) =>
		fakeExec({
			"herdr agent get": () =>
				ok({ result: { agent: { name: "recvb", pane_id: "wE:p2" } } }),
			"herdr pane get": (args) => {
				assert.equal(args[2], "wE:p2");
				return paneGet("wE:p2");
			},
			"herdr pane process-info": () =>
				ok({
					result: {
						process_info: {
							shell_pid: 100,
							foreground_processes: [{ pid: 101, argv0: "gjc" }],
						},
					},
				}),
			"gjc list": () => ok({ ok: true, result: { sessions } }),
			"gjc send": () => sent("accepted"),
		});

	const hit = run(rows);
	const result = await deliverPrompt(hit.deps, { pane: "recvb", text: "x" }, SENDER);
	assert.equal(result.ok, true);
	assert.equal(result.sessionId, TARGET);
	assert.equal(hit.count("gjc send"), 1);

	for (const [sessions, error] of [
		[rows.slice(0, 2), "No live GJC session found for pane wE:p2."],
		[
			[...rows, { sessionId: "twin", pid: 101, live: true }],
			"Multiple live GJC sessions found for pane wE:p2.",
		],
	] as const) {
		const miss = run([...sessions]);
		const failed = await deliverPrompt(miss.deps, { pane: "recvb", text: "x" }, SENDER);
		assert.equal(failed.error, error);
		assert.equal(miss.count("gjc send"), 0);
	}
});

test("malformed or failed lookups keep their specific error and send nothing", async () => {
	const info = (processes: unknown) =>
		ok({ result: { process_info: { foreground_processes: processes } } });
	const live = () =>
		ok({ ok: true, result: { sessions: [{ sessionId: TARGET, pid: 7, live: true }] } });
	const cases: [Record<string, Handler>, string][] = [
		[{ "herdr pane get": () => ok({ result: {} }) }, "Herdr pane get returned an invalid response."],
		[{ "herdr pane get": () => ({ stdout: "not json" }) }, "Herdr pane get returned an invalid response."],
		[
			{ "herdr pane get": () => paneGet("wE:p2"), "herdr pane process-info": () => info(undefined) },
			"Herdr pane process-info returned an invalid response.",
		],
		[
			{
				"herdr pane get": () => paneGet("wE:p2"),
				"herdr pane process-info": () => herdrError("io", "boom"),
			},
			"Herdr process-info failed for pane wE:p2: boom",
		],
		[
			{
				"herdr pane get": () => paneGet("wE:p2"),
				"herdr pane process-info": () => info([{ pid: 7 }]),
				"gjc list": () => ok({ ok: true, result: {} }),
			},
			"GJC session list returned an invalid response.",
		],
		[
			{
				"herdr pane get": () => paneGet("wE:p2"),
				"herdr pane process-info": () => info([{ pid: 7 }]),
				"gjc list": () => ({
					code: 1,
					...ok({ ok: false, error: { code: "operation_failed", message: "no repo" } }),
				}),
			},
			"GJC session list failed: no repo",
		],
		[
			{
				"herdr pane get": () => paneGet("wE:p2"),
				"herdr pane process-info": () => info([{ pid: 7 }]),
				"gjc list": () => ({ code: 127, stderr: "gjc: command not found" }),
			},
			GJC_NOT_FOUND,
		],
		[
			{
				"herdr pane get": () => paneGet("wE:p2"),
				"herdr pane process-info": () => info([{ pid: "7" }, { pid: -7 }]),
				"gjc list": live,
			},
			"No live GJC session found for pane wE:p2.",
		],
	];
	for (const [routes, error] of cases) {
		const { deps, count } = fakeExec(routes);
		const result = await deliverPrompt(deps, { pane: "wE:p2", text: "x" }, SENDER);
		assert.equal(result.error, error);
		assert.equal(result.status, "not_sent");
		assert.equal(count("gjc send"), 0);
	}
	const noPane = fakeExec({
		"herdr agent get": () => ok({ result: { agent: { name: "recvb" } } }),
	});
	const result = await deliverPrompt(noPane.deps, { pane: "recvb", text: "x", raw: true }, SENDER);
	assert.equal(result.error, "Herdr agent get returned an invalid response.");
	assert.equal(noPane.calls.length, 1);
});

test("unknown targets and Herdr failures send nothing", async () => {
	const unknownAgent = fakeExec({
		"herdr agent get": () =>
			herdrError("agent_not_found", "agent target nosuch not found"),
	});
	const result = await deliverPrompt(
		unknownAgent.deps,
		{ pane: "nosuch", text: "x" },
		SENDER,
	);
	assert.equal(result.error, "Herdr target not found: nosuch.");
	assert.equal(unknownAgent.calls.length, 1);

	const noHerdr = fakeExec({
		"herdr pane get": () =>
			Object.assign(new Error('Executable not found in $PATH: "herdr"'), {
				code: "ENOENT",
			}),
	});
	const unavailable = await deliverPrompt(
		noHerdr.deps,
		{ pane: "wE:p2", text: "x", raw: true },
		SENDER,
	);
	assert.match(unavailable.error!, /^Herdr is unavailable: /);
	assert.equal(noHerdr.calls.length, 1);
});

test("self delivery is refused before transport in both modes", async () => {
	for (const request of [
		{ pane: "wE:p1", text: "x" },
		{ pane: "me", text: "x", raw: true },
	]) {
		const { deps, count } = fakeExec({
			"herdr agent get": () =>
				ok({ result: { agent: { name: "me", pane_id: "wE:p1" } } }),
			"herdr pane get": () =>
				paneGet("wE:p1", { [SESSION_ID_KEY]: SENDER.sessionId }),
		});
		const result = await deliverPrompt(deps, request, SENDER);
		assert.equal(
			result.error,
			request.raw
				? "Cannot send raw input to the current Herdr pane."
				: "Cannot send a prompt to the current GJC session.",
		);
		assert.equal(
			count("gjc send") + count("herdr pane send-text") + count("herdr pane send-keys"),
			0,
		);
	}
});

test("a blocked target refuses delivery in both modes and sends nothing", async () => {
	for (const raw of [false, true]) {
		const { deps, count } = fakeExec({
			"herdr pane get": () =>
				ok({
					result: {
						pane: {
							pane_id: "wE:p2",
							agent_status: "blocked",
							tokens: { [SESSION_ID_KEY]: TARGET },
						},
					},
				}),
		});
		const result = await deliverPrompt(deps, { pane: "wE:p2", text: "x", raw }, SENDER);
		assert.equal(result.ok, false);
		assert.equal(result.status, "not_sent");
		assert.match(result.error ?? "", /blocked/);
		assert.equal(
			count("gjc send") + count("herdr pane send-text") + count("herdr pane send-keys"),
			0,
		);
	}
});

test("SDK send outcomes are classified without retries", async () => {
	const enoent = Object.assign(
		new Error('Executable not found in $PATH: "gjc"'),
		{ code: "ENOENT" },
	);
	// Observed in Phase 0: `gjc sdk session send <id> --text "" --json` (exit 2, stdout envelope).
	const usageEnvelope = {
		schema: "gjc.command-error",
		version: 1,
		ok: false,
		error: {
			code: "usage",
			category: "usage",
			message: "The command arguments are invalid.",
			outcomeCertainty: "not-applied",
			references: [{ kind: "sessionId", value: TARGET }],
		},
	};
	const cases: [Handler, boolean | undefined, Partial<SendResult>][] = [
		[() => enoent, false, { ok: false, status: "not_sent", error: GJC_NOT_FOUND }],
		[
			() => ({ code: 127, stderr: "gjc: command not found" }),
			false,
			{ ok: false, status: "not_sent", error: GJC_NOT_FOUND },
		],
		[
			() => ({ code: 2, ...ok(usageEnvelope) }),
			false,
			{
				ok: false,
				status: "not_sent",
				error: "GJC session send failed: The command arguments are invalid.",
			},
		],
		[
			() => ({
				code: 1,
				...ok({
					ok: false,
					error: {
						code: "endpoint_stale",
						message: "The SDK endpoint is stale or unavailable.",
						outcomeCertainty: "unknown",
						references: [{ kind: "operationRef", value: "op-stale" }],
					},
				}),
			}),
			false,
			{ ok: false, status: "uncertain", operationRef: "op-stale" },
		],
		[
			() => ({
				code: 1,
				...ok({
					ok: false,
					error: {
						code: "wait_timeout",
						message: "timed out",
						references: [{ kind: "operationRef", value: "op-wait" }],
					},
				}),
			}),
			true,
			{
				ok: false,
				status: "uncertain",
				operationRef: "op-wait",
				error: "GJC session wait timed out; the prompt may already be accepted.",
			},
		],
		[
			() => ({ killed: true }),
			false,
			{
				ok: false,
				status: "uncertain",
				error: "GJC session send timed out; delivery may already have been accepted.",
			},
		],
		[
			() => ok({ ok: true, result: { status: "accepted" } }),
			false,
			{ ok: false, status: "uncertain", error: "GJC session send returned an invalid response." },
		],
		[
			() => ({ code: 1, ...sent("accepted") }),
			false,
			{
				ok: false,
				status: "uncertain",
				operationRef: "op-1",
				error: "GJC session send returned an invalid response.",
			},
		],
		[
			() => sent("queued"),
			false,
			{ ok: false, status: "uncertain", error: "GJC session send returned an invalid response." },
		],
		[() => sent("terminal_ok"), true, { ok: true, status: "terminal_ok", operationRef: "op-1" }],
		[
			() => sent("failed"),
			true,
			{
				ok: false,
				status: "failed",
				operationRef: "op-1",
				error: "GJC target turn failed (operationRef op-1).",
			},
		],
	];
	for (const [handler, wait, expected] of cases) {
		const { deps, calls, count } = fakeExec({
			"herdr pane get": () => paneGet("wE:p2", { [SESSION_ID_KEY]: TARGET }),
			"gjc send": handler,
		});
		const result = await deliverPrompt(
			deps,
			{ pane: "wE:p2", text: "x", wait },
			SENDER,
		);
		for (const [key, value] of Object.entries(expected)) {
			assert.equal(result[key as keyof SendResult], value, `${key} for ${JSON.stringify(expected)}`);
		}
		assert.equal(count("gjc send"), 1);
		assert.equal(count("herdr pane send-text"), 0);
		const args = calls.find((call) => call.command === "gjc")!.args;
		assert.equal(args.includes("--wait"), wait === true);
	}
});

test("raw delivery types then submits, and reports partial failure", async () => {
	const run = (text: Handler, keys: Handler) =>
		fakeExec({
			"herdr pane get": () => paneGet("wE:p2"),
			"herdr pane send-text": text,
			"herdr pane send-keys": keys,
		});
	const success = run(() => ({}), () => ({}));
	const result = await deliverPrompt(
		success.deps,
		{ pane: "wE:p2", text: "hi there", raw: true },
		SENDER,
	);
	assert.deepEqual(result, {
		ok: true,
		mode: "raw",
		status: "raw_written",
		pane: "wE:p2",
	});
	assert.deepEqual(
		success.calls.slice(2).map((call) => call.args),
		[
			["pane", "send-text", "wE:p2", "hi there"],
			["pane", "send-keys", "wE:p2", "enter"],
		],
	);

	const textFails = run(() => herdrError("io", "write failed"), () => ({}));
	const noText = await deliverPrompt(textFails.deps, { pane: "wE:p2", text: "x", raw: true }, SENDER);
	assert.equal(noText.error, "Herdr raw text delivery failed: write failed");
	assert.equal(textFails.count("herdr pane send-keys"), 0);

	const enterFails = run(() => ({}), () => herdrError("io", "key failed"));
	const partial = await deliverPrompt(enterFails.deps, { pane: "wE:p2", text: "x", raw: true }, SENDER);
	assert.equal(partial.status, "raw_partial");
	assert.equal(partial.error, "Herdr raw submit failed; text may already be present: key failed");
});

test("command and tool share delivery and read the sender session per call", async () => {
	let command: ((args: string, ctx: ExtensionContext) => Promise<void>) | undefined;
	let tool:
		| {
				execute: (...args: unknown[]) => Promise<{
					content: { text: string }[];
					details: SendResult;
					isError: boolean;
				}>;
		  }
		| undefined;
	const logs: string[] = [];
	const { exec, count } = (() => {
		const fake = fakeExec({
			"herdr pane get": () => paneGet("wE:p2", { [SESSION_ID_KEY]: TARGET }),
			"gjc send": () => sent("accepted"),
		});
		return { exec: fake.deps.exec, count: fake.count };
	})();
	registerSendFeatures(
		{
			zod,
			exec,
			logger: {
				info: (message: string) => logs.push(`info:${message}`),
				warn: (message: string) => logs.push(`warn:${message}`),
			},
			registerCommand: (_name: string, options: { handler: typeof command }) => {
				command = options.handler;
			},
			registerTool: (definition: typeof tool) => {
				tool = definition;
			},
		} as unknown as ExtensionAPI,
		"herdr",
		"wE:p1",
	);
	const ctx = (sessionId: string) =>
		({ hasUI: false, sessionManager: { getSessionId: () => sessionId } }) as unknown as ExtensionContext;

	await command!("wE:p2 hello", ctx(SENDER.sessionId));
	await command!("--bogus wE:p2 hello", ctx(SENDER.sessionId));
	assert.match(logs[0], /^info:Prompt accepted by GJC session receiver-session on pane wE:p2 \(operationRef op-1\)/);
	assert.equal(logs[1], `warn:${USAGE}`);

	const accepted = await tool!.execute("call-1", { pane: "wE:p2", text: "hi" }, undefined, undefined, ctx(SENDER.sessionId));
	assert.equal(accepted.details.status, "accepted");
	assert.equal(accepted.isError, false);
	const self = await tool!.execute("call-2", { pane: "wE:p2", text: "hi" }, undefined, undefined, ctx(TARGET));
	assert.equal(self.details.error, "Cannot send a prompt to the current GJC session.");
	assert.equal(self.isError, true);
	assert.equal(count("gjc send"), 2);
});

const RULE_LINE = "─".repeat(60);
const EMPTY_CLAUDE = `${RULE_LINE}\n❯\n${RULE_LINE}\n  -- INSERT --`;
const TYPING_CLAUDE = `${RULE_LINE}\n❯ 권고 내용으로 적\n${RULE_LINE}\n  -- INSERT --`;
const SENDS = (calls: { args: string[] }[]) =>
	calls.filter(({ args }) => args[1] === "send-text" || args[1] === "send-keys");

test("raw delivery waits for a typed-in input box, then sends once", async () => {
	const screens = [TYPING_CLAUDE, EMPTY_CLAUDE];
	const { deps, calls } = fakeExec({
		"herdr pane get": () => paneGet("wE:p2", {}, { focused: true }),
		"herdr pane read": () => ({ stdout: screens.shift() ?? EMPTY_CLAUDE }),
		"herdr pane send-text": () => ({}),
		"herdr pane send-keys": () => ({}),
	});
	deps.sleep = async () => {};
	const result = await deliverPrompt(deps, { pane: "wE:p2", text: "x", raw: true }, SENDER);
	assert.equal(result.status, "raw_written");
	assert.equal(result.waitedMs, 2_000);
	assert.equal(SENDS(calls).length, 2);
});

test("raw delivery gives up on a stuck input box without typing anything", async () => {
	const { deps, calls } = fakeExec({
		"herdr pane get": () => paneGet("wE:p2"),
		"herdr pane read": () => ({ stdout: TYPING_CLAUDE }),
	});
	deps.sleep = async () => {};
	deps.inputWaitMs = 4_000;
	const result = await deliverPrompt(deps, { pane: "wE:p2", text: "x", raw: true }, SENDER);
	assert.equal(result.ok, false);
	assert.equal(result.status, "not_sent");
	assert.match(result.error ?? "", /input box still has text after 4s/);
	assert.equal(result.waitedMs, 4_000);
	assert.equal(SENDS(calls).length, 0);
});

test("raw delivery falls back to the focus rule when the input box is unreadable; SDK is unaffected", async () => {
	const focused = fakeExec({
		"herdr pane get": () => paneGet("wE:p2", {}, { focused: true }),
		"herdr pane read": () => ({ stdout: "$ plain shell" }),
	});
	const refused = await deliverPrompt(focused.deps, { pane: "wE:p2", text: "x", raw: true }, SENDER);
	assert.equal(refused.status, "not_sent");
	assert.match(refused.error ?? "", /could not be read and the pane is focused/);
	assert.equal(SENDS(focused.calls).length, 0);

	const unfocused = fakeExec({
		"herdr pane get": () => paneGet("wE:p2", {}, { focused: false }),
		"herdr pane read": () => ({ stdout: "$ plain shell" }),
		"herdr pane send-text": () => ({}),
		"herdr pane send-keys": () => ({}),
	});
	const written = await deliverPrompt(unfocused.deps, { pane: "wE:p2", text: "x", raw: true }, SENDER);
	assert.equal(written.status, "raw_written");

	const sdk = fakeExec({
		"herdr pane get": () => paneGet("wE:p2", { [SESSION_ID_KEY]: TARGET }, { focused: true }),
		"gjc send": () => sent("accepted"),
	});
	const accepted = await deliverPrompt(sdk.deps, { pane: "wE:p2", text: "x" }, SENDER);
	assert.equal(accepted.status, "accepted");
	assert(!sdk.calls.some(({ args }) => args[1] === "read"));
});
