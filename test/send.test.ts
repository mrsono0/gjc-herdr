import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
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
	sendRawPrompt,
	type SendDeps,
	type SendResult,
	USAGE,
} from "../src/send.ts";

const SENDER = { sessionId: "sender-session", pane: "wE:p1" };
const TARGET = "receiver-session";
const RULE_LINE = "─".repeat(60);
const EMPTY_CLAUDE = `${RULE_LINE}\n❯\n${RULE_LINE}\n  -- INSERT --`;
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
	let clock = 0;
	const calls: { command: string; args: string[]; options: ExecOptions }[] = [];
	const handlers: Record<string, Handler> = { "herdr pane read": () => ({ stdout: EMPTY_CLAUDE }), ...routes };
	const exec: SendDeps["exec"] = async (command, args, options) => {
		assertExecTimeout(options?.timeout);
		calls.push({ command, args, options });
		const key =
			command === "gjc" ? `gjc ${args[2]}` : `herdr ${args[0]} ${args[1]}`;
		const handler = handlers[key];
		assert(handler, `unexpected exec ${command} ${args.join(" ")}`);
		const result = handler(args, options);
		if (result instanceof Error) throw result;
		return { stdout: "", stderr: "", code: 0, killed: false, ...result };
	};
	const count = (key: string) =>
		calls.filter(({ command, args }) =>
			command === "gjc"
				? `gjc ${args[2]}` === key
				: `herdr ${args[0]} ${args[1]}` === key,
		).length;
	const advance = (ms: number) => { clock += ms; };
	const deps: SendDeps = { exec, herdrBin: "herdr", now: () => clock, sleep: async (ms) => advance(ms) };
	return { deps, calls, count, advance };
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

test("raw rechecks blocked and focused state after waiting", async () => {
	for (const latest of [
		"blocked",
		"blocked-unknown-ui",
		"typing-cap-exhausted",
		"focused",
		"focused-then-typing",
	] as const) {
		let agentGets = 0;
		let gets = 0;
		const screens =
			latest === "blocked"
				? [TYPING_CLAUDE, EMPTY_CLAUDE]
				: latest === "blocked-unknown-ui"
					? [TYPING_CLAUDE, "$ approval / unknown UI"]
					: latest === "typing-cap-exhausted"
						? [TYPING_CLAUDE]
						: latest === "focused"
							? [TYPING_CLAUDE, "$ approval / unknown UI", "$ approval / unknown UI"]
							: [TYPING_CLAUDE, "$ approval / unknown UI", TYPING_CLAUDE];
		const { deps, calls, count, advance } = fakeExec({
			"herdr agent get": (_args, options) => {
				if (++agentGets > 1) advance(1_000);
				assert.equal(options?.timeout, 3_000);
				return ok({ result: { agent: { pane_id: "wE:p2" } } });
			},
			"herdr pane get": (_args, options) => {
				if (++gets === 1) {
					return paneGet("wE:p2", {}, { focused: false, agent_status: "idle" });
				}
				if (latest === "blocked-unknown-ui") assert.equal(options?.timeout, 1_500);
				if (latest === "typing-cap-exhausted") advance(1_000);
				return paneGet(
					"wE:p2",
					{},
					{
						focused: latest === "focused-then-typing" ? gets === 2 : true,
						agent_status: latest.startsWith("blocked") ? "blocked" : "idle",
					},
				);
			},
			"herdr pane read": () => ({ stdout: screens.shift() ?? "$ approval / unknown UI" }),
		});
		deps.inputWaitMs =
			latest === "typing-cap-exhausted"
				? 2_000
				: latest === "blocked-unknown-ui"
					? 3_500
					: 6_000;
		const target = latest === "typing-cap-exhausted" ? "receiver" : "wE:p2";
		const result = await deliverPrompt(deps, { pane: target, text: "x", raw: true }, SENDER);
		assert.equal(result.status, "not_sent");
		assert.equal(
			result.waitedMs,
			latest.startsWith("blocked") || latest === "typing-cap-exhausted" ? 2_000 : 6_000,
		);
		assert.match(
			result.error ?? "",
			latest.startsWith("blocked")
				? /Target is blocked/
				: latest === "typing-cap-exhausted"
					? /input box still has text after 2s; raw input not sent/
					: latest === "focused"
						? /could not be read and the pane is focused.*after 6s/
						: /input box still has text after 6s; raw input not sent/,
		);
		if (latest === "typing-cap-exhausted") {
			assert.equal(count("herdr agent get"), 1);
			assert.equal(count("herdr pane get"), 1);
			assert.equal(count("herdr pane read"), 1);
		} else {
			assert.equal(count("herdr pane get"), latest === "focused" ? 3 : 2);
			assert.equal(count("herdr pane read"), latest.startsWith("blocked") ? 2 : 3);
		}
		assert.equal(SENDS(calls).length, 0);
	}
});

test("raw re-resolves names and refuses a refreshed self target", async () => {
	let selfGets = 0;
	const selfScreens = [TYPING_CLAUDE, EMPTY_CLAUDE];
	const selfTarget = fakeExec({
		"herdr agent get": () =>
			ok({ result: { agent: { pane_id: ++selfGets === 1 ? "wE:p2" : SENDER.pane } } }),
		"herdr pane get": (args) => paneGet(args[2]),
		"herdr pane read": () => ({ stdout: selfScreens.shift()! }),
	});
	const selfResult = await deliverPrompt(
		selfTarget.deps,
		{ pane: "receiver", text: "x", raw: true },
		SENDER,
	);
	assert.equal(selfResult.status, "not_sent");
	assert.equal(selfResult.pane, SENDER.pane);
	assert.equal(selfResult.waitedMs, 2_000);
	assert.match(selfResult.error ?? "", /current Herdr pane/);
	assert.equal(selfTarget.count("herdr agent get"), 2);
	assert.equal(SENDS(selfTarget.calls).length, 0);

	for (const waitReason of ["typing", "focused-unknown"] as const) {
		let movedGets = 0;
		const movedScreens =
			waitReason === "typing"
				? [TYPING_CLAUDE, EMPTY_CLAUDE]
				: ["$ plain shell", EMPTY_CLAUDE];
		const moved = fakeExec({
			"herdr agent get": () =>
				ok({ result: { agent: { pane_id: ++movedGets === 1 ? "wE:p2" : "wE:p3" } } }),
			"herdr pane get": (args) =>
				paneGet(args[2], {}, { focused: waitReason === "focused-unknown" && args[2] === "wE:p2" }),
			"herdr pane read": (args) => {
				assert.equal(args[2], "wE:p2");
				return { stdout: movedScreens.shift() ?? TYPING_CLAUDE };
			},
		});
		const movedResult = await deliverPrompt(
			moved.deps,
			{ pane: "receiver", text: "x", raw: true },
			SENDER,
		);
		assert.equal(movedResult.status, "not_sent");
		assert.equal(movedResult.pane, "wE:p3");
		assert.equal(movedResult.waitedMs, 2_000);
		assert.match(
			movedResult.error ?? "",
			/Target receiver moved from pane wE:p2 to wE:p3 while waiting; raw input not sent/,
		);
		assert.equal(moved.count("herdr agent get"), 2);
		assert.equal(SENDS(moved.calls).length, 0);
	}

	let goneGets = 0;
	const goneScreens = [TYPING_CLAUDE, EMPTY_CLAUDE];
	const gone = fakeExec({
		"herdr agent get": () =>
			++goneGets === 1
				? ok({ result: { agent: { pane_id: "wE:p2" } } })
				: herdrError("agent_not_found", "no such agent"),
		"herdr pane get": (args) => paneGet(args[2]),
		"herdr pane read": () => ({ stdout: goneScreens.shift()! }),
	});
	const goneResult = await deliverPrompt(
		gone.deps,
		{ pane: "receiver", text: "x", raw: true },
		SENDER,
	);
	assert.equal(goneResult.status, "not_sent");
	assert.equal(goneResult.waitedMs, 2_000);
	assert.match(goneResult.error ?? "", /Herdr target not found: receiver\./);
	assert.equal(gone.count("herdr agent get"), 2);
	assert.equal(SENDS(gone.calls).length, 0);
});

test("raw abort before lookup or during input reads and sleeps sends no input", async () => {
	for (const when of ["before", "read", "sleep", "readiness-sleep"] as const) {
		const controller = new AbortController();
		if (when === "before") controller.abort();
		const { deps, calls, advance } = fakeExec({
			"herdr pane get": () => paneGet("wE:p2", {}, { focused: when === "readiness-sleep" }),
			"herdr pane read": () => {
				if (when === "read") {
					controller.abort();
					return new Error("read aborted");
				}
				return { stdout: when === "readiness-sleep" ? "$ plain shell" : TYPING_CLAUDE };
			},
		});
		deps.sleep = async (ms) => { advance(ms); controller.abort(); };
		const result = await deliverPrompt(deps, { pane: "wE:p2", text: "x", raw: true }, SENDER, controller.signal);
		assert.equal(result.status, "not_sent");
		assert.match(result.error ?? "", /aborted/);
		assert.equal(SENDS(calls).length, 0);
		if (when === "before") assert.equal(calls.length, 0);
		if (when === "readiness-sleep") assert.equal(result.waitedMs, 2_000);
	}
});

test("raw passes the signal to both writes and preserves partial delivery on intervening abort", async () => {
	for (const abortAfterText of [false, true]) {
		const controller = new AbortController();
		const { deps, count } = fakeExec({
			"herdr pane send-text": (_args, options) => {
				assert.equal(options?.signal, controller.signal);
				if (abortAfterText) controller.abort();
				return {};
			},
			"herdr pane send-keys": (_args, options) => {
				assert.equal(options?.signal, controller.signal);
				return {};
			},
		});
		const result = await sendRawPrompt(deps, "wE:p2", "x", controller.signal);
		assert.equal(result.status, abortAfterText ? "raw_partial" : "raw_written");
		assert.equal(count("herdr pane send-text"), 1);
		assert.equal(count("herdr pane send-keys"), abortAfterText ? 0 : 1);
	}
});

test("raw default empty fixture works for focused targets and clipped drafts cannot fall back", async () => {
	const empty = fakeExec({
		"herdr pane get": () => paneGet("wE:p2", {}, { focused: true }),
		"herdr pane send-text": () => ({}),
		"herdr pane send-keys": () => ({}),
	});
	assert.equal((await deliverPrompt(empty.deps, { pane: "wE:p2", text: "x", raw: true }, SENDER)).status, "raw_written");
	const clipped = fakeExec({
		"herdr pane get": () => paneGet("wE:p2", {}, { focused: false }),
		"herdr pane read": () => ({ stdout: `  draft continuation\n${RULE_LINE}` }),
	});
	clipped.deps.inputWaitMs = 0;
	const result = await deliverPrompt(clipped.deps, { pane: "wE:p2", text: "x", raw: true }, SENDER);
	assert.equal(result.status, "not_sent");
	assert.match(result.error ?? "", /input box still has text/);
	assert.equal(SENDS(clipped.calls).length, 0);
});

test("fractional clock and wait budgets never turn a typing draft into unfocused raw delivery", async () => {
	for (const waitBudget of [2_000.5, 5_000.75]) {
		const { deps, calls, count, advance } = fakeExec({
			"herdr pane get": () => paneGet("wE:p2", {}, { focused: false }),
			"herdr pane read": () => { advance(0.25); return { stdout: TYPING_CLAUDE }; },
			"herdr pane send-text": () => ({}),
			"herdr pane send-keys": () => ({}),
		});
		advance(0.25);
		deps.inputWaitMs = waitBudget;
		const result = await deliverPrompt(deps, { pane: "wE:p2", text: "agent prompt", raw: true }, SENDER);
		assert.equal(result.status, "not_sent");
		assert.match(result.error ?? "", /input box still has text/);
		assert.equal(count("herdr pane read"), waitBudget < 3_000 ? 1 : 3);
		assert.equal(SENDS(calls).length, 0);
	}
});

test("raw delivery waits on a focused pane with an unreadable input box, gives up at the cap, and refuses immediately when inputWaitMs = 0", async () => {
	let gets = 0;
	const sleeps: number[] = [];
	const { deps, calls, count, advance } = fakeExec({
		"herdr pane get": () => paneGet("wE:p2", {}, { focused: ++gets < 3 }),
		"herdr pane read": () => ({ stdout: "$ plain shell" }),
		"herdr pane send-text": () => ({}),
		"herdr pane send-keys": () => ({}),
	});
	deps.sleep = async (ms) => {
		sleeps.push(ms);
		advance(ms);
	};
	const written = await deliverPrompt(deps, { pane: "wE:p2", text: "ls", raw: true }, SENDER);
	assert.equal(written.ok, true);
	assert.equal(written.status, "raw_written");
	assert.equal(written.waitedMs, 4_000);
	assert.deepEqual(sleeps, [2_000, 2_000]);
	assert.equal(count("herdr pane get"), 3);
	assert.equal(count("herdr pane read"), 3);
	assert.equal(SENDS(calls).length, 2);

	const stuck = fakeExec({
		"herdr pane get": () => paneGet("wE:p2", {}, { focused: true }),
		"herdr pane read": () => ({ stdout: "$ plain shell" }),
	});
	stuck.deps.inputWaitMs = 6_000;
	const refused = await deliverPrompt(stuck.deps, { pane: "wE:p2", text: "ls", raw: true }, SENDER);
	assert.equal(refused.ok, false);
	assert.equal(refused.status, "not_sent");
	assert.equal(refused.waitedMs, 6_000);
	assert.match(refused.error ?? "", /could not be read and the pane is focused.*after 6s; raw input not sent\. Retry later\./);
	assert.equal(SENDS(stuck.calls).length, 0);

	const zeroSleeps: number[] = [];
	const zero = fakeExec({
		"herdr pane get": () => paneGet("wE:p2", {}, { focused: true }),
		"herdr pane read": () => ({ stdout: "$ plain shell" }),
	});
	zero.deps.inputWaitMs = 0;
	zero.deps.sleep = async (ms) => {
		zeroSleeps.push(ms);
		zero.advance(ms);
	};
	const immediate = await deliverPrompt(zero.deps, { pane: "wE:p2", text: "ls", raw: true }, SENDER);
	assert.equal(immediate.ok, false);
	assert.equal(immediate.status, "not_sent");
	assert.equal(immediate.waitedMs, undefined);
	assert.equal(zeroSleeps.length, 0);
	assert.equal(zero.count("herdr pane get"), 1);
	assert.equal(zero.count("herdr pane read"), 1);
	assert.equal(SENDS(zero.calls).length, 0);
});

test("raw retry lookups bound sequential name resolution by waitDeadline, include final lookup time, and keep focused refusal on small remainders", async () => {
	let timedGets = 0;
	let timedReads = 0;
	const timed = fakeExec({
		"herdr pane get": () => {
			if (++timedGets === 1) return paneGet("wE:p2", {}, { focused: true });
			timed.advance(500);
			return paneGet("wE:p2", {}, { focused: false });
		},
		"herdr pane read": () => {
			if (++timedReads > 1) timed.advance(100);
			return { stdout: "$ plain shell" };
		},
		"herdr pane send-text": () => ({}),
		"herdr pane send-keys": () => ({}),
	});
	const timedResult = await deliverPrompt(timed.deps, { pane: "wE:p2", text: "ls", raw: true }, SENDER);
	assert.equal(timedResult.status, "raw_written");
	assert.equal(timedResult.waitedMs, 2_600);

	for (const overMode of ["killed", "late-unfocused"] as const) {
		let agentGets = 0;
		let paneGets = 0;
		let paneReads = 0;
		const over = fakeExec({
			"herdr agent get": (_args, options) => {
				if (++agentGets > 1) {
					assert.equal(options?.timeout, 1_200);
					over.advance(700);
				}
				return ok({ result: { agent: { pane_id: "wE:p2" } } });
			},
			"herdr pane get": (_args, options) => {
				if (++paneGets === 1) return paneGet("wE:p2", {}, { focused: true });
				assert.equal(options?.timeout, 500);
				if (overMode === "killed") {
					over.advance(options?.timeout ?? 0);
					return { killed: true, code: 0, stdout: "", stderr: "" };
				}
				over.advance(2_000);
				return paneGet("wE:p2", {}, { focused: false });
			},
			"herdr pane read": () => {
				if (++paneReads > 1) over.advance(300);
				return { stdout: "$ plain shell" };
			},
		});
		over.deps.inputWaitMs = 3_500;
		const overResult = await deliverPrompt(over.deps, { pane: "receiver", text: "ls", raw: true }, SENDER);
		assert.equal(overResult.status, "not_sent");
		assert.match(overResult.error ?? "", /could not be read and the pane is focused/);
		assert.equal(SENDS(over.calls).length, 0);
		if (overMode === "killed") assert.equal(overResult.waitedMs, 3_500);
	}

	const subRecheck = fakeExec({
		"herdr pane get": () => paneGet("wE:p2", {}, { focused: true }),
		"herdr pane read": () => {
			subRecheck.advance(0.4);
			return { stdout: "$ plain shell" };
		},
	});
	subRecheck.deps.inputWaitMs = 2_001.5;
	const subResult = await deliverPrompt(subRecheck.deps, { pane: "wE:p2", text: "ls", raw: true }, SENDER);
	assert.equal(subResult.status, "not_sent");
	assert.match(subResult.error ?? "", /could not be read and the pane is focused/);
	assert.equal(subResult.waitedMs, 2_000.4);
	assert.equal(subRecheck.count("herdr pane read"), 1);
});

// ============================================================================
// #86 3b: hc backend send tests (boundaries 1, 2, 3, 4, 6)
// ============================================================================

import {
	HC_SEND_ERROR_KINDS,
	HC_SEND_NOT_SENT_KINDS,
	type HcSendErrorKind,
} from "../src/hc.ts";
import { describeResult, HC_SEND_NOTE } from "../src/send.ts";

const HC_CALLER = "t1";
const HC_TARGET = "t2";

function hcWaitPayload(
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

function hcSendPayload(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	const base: Record<string, unknown> = {
		turn: 4,
	};
	if ("started" in overrides) base.started = overrides.started;
	else base.started = true;
	if ("status" in overrides) base.status = overrides.status;
	else base.status = "idle";
	return {
		...base,
		...overrides,
	};
}

function hcErrorResult(
	kind: string,
	message: string,
	useDataKind = false,
	exitCode = 1,
): Partial<ExecResult> {
	const errorObj = useDataKind
		? { code: -32000, message, data: { kind } }
		: { kind, message };
	return {
		code: exitCode,
		stderr: JSON.stringify({ error: errorObj }),
	};
}

function fakeHcSendExec(routes: Record<string, Handler>) {
	let clock = 1_000;
	const calls: { command: string; args: string[]; options: ExecOptions }[] = [];
	const exec: SendDeps["exec"] = async (command, args, options) => {
		assertExecTimeout(options?.timeout);
		assert.notEqual(args[0], "read", "hc send must never read terminal screen");
		assert.notEqual(args[0], "attach", "hc send must never attach");
		assert.notEqual(args[1], "send-keys", "hc send must never send Enter keys");
		calls.push({ command, args, options });
		const key = `${command} ${args[0]}`;
		const handler = routes[key];
		assert(handler, `unexpected exec ${command} ${args.join(" ")}`);
		const out = handler(args, options);
		if (out instanceof Error) throw out;
		return { stdout: "", stderr: "", code: 0, killed: false, ...out };
	};
	const advance = (ms: number) => {
		clock += ms;
	};
	const setClock = (ms: number) => {
		clock = ms;
	};
	const deps: SendDeps = {
		exec,
		herdrBin: "herdr",
		backend: "hc",
		hcBin: "hc",
		hcCallerId: HC_CALLER,
		now: () => clock,
	};
	return { deps, calls, advance, setClock };
}

test("hc send boundary 1: default, --raw, --wait, and --raw --wait execute one hc send with --if idle, 0 Enter, 0 screen read, and classify SendResult & 2x9 error kinds", async () => {
	// Default and --raw both run `hc send --json --if idle t2 <text>` once
	for (const raw of [false, true]) {
		const { deps, calls } = fakeHcSendExec({
			"hc send": () => ok(hcSendPayload()),
		});
		const res = await deliverPrompt(
			deps,
			{ pane: HC_TARGET, text: "hello hc", raw },
			SENDER,
		);
		assert.deepEqual(res, {
			ok: true,
			mode: "hc",
			status: "sent",
			pane: HC_TARGET,
		});
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0]?.args, [
			"send",
			"--json",
			"--if",
			"idle",
			HC_TARGET,
			"hello hc",
		]);
		assert.match(describeResult(res), new RegExp(HC_SEND_NOTE));
	}

	// --wait and --raw --wait are both allowed on hc and run `hc send --json --if idle --wait --timeout 60 t2 <text>` once
	for (const raw of [false, true]) {
		const { deps, calls } = fakeHcSendExec({
			"hc send": () =>
				ok(
					hcSendPayload({
						wait: hcWaitPayload(HC_TARGET, {
							ended: true,
							reason: "status",
							status: "done",
							turn: 5,
						}),
					}),
				),
		});
		const res = await deliverPrompt(
			deps,
			{ pane: HC_TARGET, text: "wait hc", wait: true, raw },
			SENDER,
		);
		assert.deepEqual(res, {
			ok: true,
			mode: "hc",
			status: "sent",
			pane: HC_TARGET,
			waited: {
				reason: "status",
				status: "done",
				ended: true,
				turn: 5,
			},
		});
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0]?.args, [
			"send",
			"--json",
			"--if",
			"idle",
			"--wait",
			"--timeout",
			"60",
			HC_TARGET,
			"wait hc",
		]);
		assert.match(describeResult(res), /turn completed.*status=done, ended=true, turn=5/);
	}

	// SendResult optional field variations (started true/false/null/omitted, status null/omitted) succeed when not waiting
	for (const payload of [
		{ turn: 4, started: true, status: "idle" },
		{ turn: 4, started: false, status: "idle" },
		{ turn: 4, started: null, status: null },
		{ turn: 4 },
	]) {
		const { deps, calls } = fakeHcSendExec({
			"hc send": () => ok(payload),
		});
		const res = await deliverPrompt(
			deps,
			{ pane: HC_TARGET, text: "optional fields" },
			SENDER,
		);
		assert.equal(res.ok, true);
		assert.equal(res.mode, "hc");
		assert.equal(res.status, "sent");
		assert.equal(calls.length, 1);
	}

	// Malformed SendResult (invalid JSON, missing/negative turn, invalid started/status) -> uncertain, 1 send
	for (const badStdout of [
		"not-json",
		JSON.stringify({ started: true }),
		JSON.stringify({ turn: -1 }),
		JSON.stringify({ turn: 4, started: "yes" }),
		JSON.stringify({ turn: 4, status: 123 }),
	]) {
		const { deps, calls } = fakeHcSendExec({
			"hc send": () => ({ code: 0, stdout: badStdout }),
		});
		const res = await deliverPrompt(
			deps,
			{ pane: HC_TARGET, text: "bad stdout", wait: true },
			SENDER,
		);
		assert.equal(res.ok, false, badStdout);
		assert.equal(res.mode, "hc", badStdout);
		assert.equal(res.status, "uncertain", badStdout);
		assert.equal(calls.length, 1, badStdout);
	}

	// Valid turn + malformed nested wait -> status="sent", ok=false, no waited, 1 send, 0 resends (both wait=true and wait=false)
	for (const waitRequested of [true, false]) {
		const { deps, calls } = fakeHcSendExec({
			"hc send": () => ({
				code: 0,
				stdout: JSON.stringify({ turn: 4, wait: "invalid" }),
			}),
		});
		const res = await deliverPrompt(
			deps,
			{ pane: HC_TARGET, text: "invalid wait", wait: waitRequested },
			SENDER,
		);
		assert.equal(res.ok, false);
		assert.equal(res.mode, "hc");
		assert.equal(res.status, "sent");
		assert.equal("waited" in res, false);
		assert.equal(res.waited, undefined);
		assert.equal(
			res.error,
			"text delivered; wait result invalid; completion unconfirmed; do not resend",
		);
		assert.equal(calls.length, 1);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 1);
		const formatted = describeResult(res);
		assert.match(formatted, /status: sent/);
		assert.equal(
			formatted.includes(
				"text delivered; wait result invalid; completion unconfirmed; do not resend",
			),
			true,
		);
	}

	// 2 error envelopes x 9 send error kinds + needs_target/bare/non-object envelopes
	const all9Kinds = [...HC_SEND_ERROR_KINDS] as HcSendErrorKind[];
	assert.equal(all9Kinds.length, 9);
	for (const useDataKind of [false, true]) {
		for (const kind of all9Kinds) {
			const { deps, calls } = fakeHcSendExec({
				"hc send": () =>
					hcErrorResult(kind, "SECRET_RAW_STDERR_MSG", useDataKind),
			});
			const res = await deliverPrompt(
				deps,
				{ pane: HC_TARGET, text: "kind check" },
				SENDER,
			);
			const expectedStatus = HC_SEND_NOT_SENT_KINDS.has(kind as never)
				? "not_sent"
				: "uncertain";
			assert.equal(res.ok, false);
			assert.equal(res.mode, "hc");
			assert.equal(res.status, expectedStatus, `kind=${kind}`);
			assert.equal(calls.length, 1);
			assert.equal(describeResult(res).includes("SECRET_RAW_STDERR_MSG"), false);
		}
	}

	for (const badStderr of [
		JSON.stringify({ error: { kind: "needs_target" } }),
		JSON.stringify({ kind: "status_mismatch" }),
		JSON.stringify({ data: { kind: "status_mismatch" } }),
		JSON.stringify({ error: null }),
		"plain stderr failure",
	]) {
		const { deps, calls } = fakeHcSendExec({
			"hc send": () => ({ code: 1, stderr: badStderr }),
		});
		const res = await deliverPrompt(
			deps,
			{ pane: HC_TARGET, text: "unrecognized err" },
			SENDER,
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "uncertain");
		assert.equal(calls.length, 1);
	}
});

test("hc send boundary 2: --wait separates delivery (status=sent) from waited outcome; timeout/message/not_started are not completed and blocked/error/exit are surfaced", async () => {
	// timeout, message, not_started -> ok=false (NOT completed), status="sent", waited preserved
	for (const [reason, status] of [
		["timeout", "working"],
		["message", "working"],
		["not_started", "idle"],
	] as const) {
		const { deps, calls } = fakeHcSendExec({
			"hc send": () =>
				ok(
					hcSendPayload({
						started: reason !== "not_started",
						status,
						wait: hcWaitPayload(HC_TARGET, {
							ended: false,
							reason,
							status,
							turn: reason === "not_started" ? 4 : 5,
						}),
					}),
				),
		});
		const res = await deliverPrompt(
			deps,
			{ pane: HC_TARGET, text: `wait ${reason}`, wait: true, raw: true },
			SENDER,
		);
		assert.equal(res.ok, false, reason);
		assert.equal(res.mode, "hc", reason);
		assert.equal(res.status, "sent", reason);
		assert.deepEqual(res.waited, {
			reason,
			status,
			ended: false,
			turn: reason === "not_started" ? 4 : 5,
		});
		assert.equal(calls.length, 1, reason);
		const formatted = describeResult(res);
		assert.match(formatted, /status: sent/);
		assert.match(formatted, new RegExp(`reason=${reason}`));
		assert.match(formatted, /turn is not completed/i);
		assert.doesNotMatch(formatted, /turn completed/);
	}

	// Raw stdout without WaitResult ({"turn":4,"started":false} and {"turn":4,"started":false,"wait":null}) -> status="sent", ok=false, no synthesized waited, no reason=not_started
	for (const rawNoWait of [
		'{"turn":4,"started":false}',
		'{"turn":4,"started":false,"wait":null}',
	]) {
		const { deps, calls } = fakeHcSendExec({
			"hc send": () => ({ code: 0, stdout: rawNoWait }),
		});
		const res = await deliverPrompt(
			deps,
			{ pane: HC_TARGET, text: "no wait result", wait: true },
			SENDER,
		);
		assert.equal(res.ok, false, rawNoWait);
		assert.equal(res.mode, "hc", rawNoWait);
		assert.equal(res.status, "sent", rawNoWait);
		assert.equal("waited" in res, false, rawNoWait);
		assert.equal(res.waited, undefined, rawNoWait);
		assert.equal(
			res.error,
			"start was not observed; no wait result; completion unconfirmed",
			rawNoWait,
		);
		assert.equal(calls.length, 1, rawNoWait);
		const formatted = describeResult(res);
		assert.match(formatted, /status: sent/);
		assert.equal(
			formatted.includes(
				"start was not observed; no wait result; completion unconfirmed",
			),
			true,
			rawNoWait,
		);
		assert.equal(formatted.includes("not_started"), false, rawNoWait);
	}

	// blocked, error, exit -> ok=false, status="sent", waited preserved and displayed in describeResult
	{
		const { deps: blockedDeps } = fakeHcSendExec({
			"hc send": () =>
				ok(
					hcSendPayload({
						wait: hcWaitPayload(HC_TARGET, {
							ended: false,
							reason: "status",
							status: "blocked",
							turn: 5,
						}),
					}),
				),
		});
		const blockedRes = await deliverPrompt(
			blockedDeps,
			{ pane: HC_TARGET, text: "wait blocked", wait: true },
			SENDER,
		);
		assert.equal(blockedRes.ok, false);
		assert.equal(blockedRes.status, "sent");
		assert.deepEqual(blockedRes.waited, {
			reason: "status",
			status: "blocked",
			ended: false,
			turn: 5,
		});
		assert.match(describeResult(blockedRes), /status=blocked/);

		const { deps: errorDeps } = fakeHcSendExec({
			"hc send": () =>
				ok(
					hcSendPayload({
						wait: hcWaitPayload(HC_TARGET, {
							ended: true,
							reason: "status",
							status: "error",
							turn: 5,
						}),
					}),
				),
		});
		const errorRes = await deliverPrompt(
			errorDeps,
			{ pane: HC_TARGET, text: "wait error", wait: true },
			SENDER,
		);
		assert.equal(errorRes.ok, false);
		assert.equal(errorRes.status, "sent");
		assert.deepEqual(errorRes.waited, {
			reason: "status",
			status: "error",
			ended: true,
			turn: 5,
		});
		assert.match(describeResult(errorRes), /status=error/);

		const { deps: exitDeps } = fakeHcSendExec({
			"hc send": () =>
				ok(
					hcSendPayload({
						wait: hcWaitPayload(HC_TARGET, {
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
		const exitRes = await deliverPrompt(
			exitDeps,
			{ pane: HC_TARGET, text: "wait exit", wait: true },
			SENDER,
		);
		assert.equal(exitRes.ok, false);
		assert.equal(exitRes.status, "sent");
		assert.deepEqual(exitRes.waited, {
			reason: "exit",
			status: null,
			ended: true,
			turn: 5,
			exitCode: 137,
			signal: 9,
		});
		assert.match(describeResult(exitRes), /reason=exit.*exit_code=137, signal=9/);
	}

	// Turn non-advance (turn <= send.turn) or mismatched terminal -> ok=false, status="sent"
	{
		const { deps } = fakeHcSendExec({
			"hc send": () =>
				ok(
					hcSendPayload({
						turn: 4,
						wait: hcWaitPayload(HC_TARGET, {
							ended: true,
							reason: "status",
							status: "done",
							turn: 4,
						}),
					}),
				),
		});
		const res = await deliverPrompt(
			deps,
			{ pane: HC_TARGET, text: "no turn advance", wait: true },
			SENDER,
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "sent");
		assert.equal(res.waited?.turn, 4);

		const { deps: mismatchDeps } = fakeHcSendExec({
			"hc send": () =>
				ok(
					hcSendPayload({
						turn: 4,
						wait: hcWaitPayload("t99", {
							ended: true,
							reason: "status",
							status: "done",
							turn: 5,
						}),
					}),
				),
		});
		const mismatchRes = await deliverPrompt(
			mismatchDeps,
			{ pane: HC_TARGET, text: "mismatched wait terminal", wait: true },
			SENDER,
		);
		assert.equal(mismatchRes.ok, false);
		assert.equal(mismatchRes.mode, "hc");
		assert.equal(mismatchRes.status, "sent");
		assert.equal(mismatchRes.waited?.turn, 5);
		assert.match(mismatchRes.error ?? "", /mismatched terminal/i);
		assert.match(describeResult(mismatchRes), /wait did not confirm turn completion/i);
		assert.doesNotMatch(describeResult(mismatchRes), /and turn completed/);
	}
});

test("hc send boundary 3 & 4: allows remote addresses, refuses self (ID and name) and missing caller, resolves unique names, rejects leading '-' text, and respects budget", async () => {
	// Remote address direct ("rohan/t7") and remote address resolved by name ("remote-worker" -> "rohan/t7") are allowed!
	{
		const { deps, calls } = fakeHcSendExec({
			"hc ls": () =>
				ok({
					terminals: [{ address: "rohan/t7", name: "remote-worker" }],
					hidden_finished: 0,
					machines: [],
				}),
			"hc send": () => ok(hcSendPayload()),
		});
		const directRemote = await deliverPrompt(
			deps,
			{ pane: "rohan/t7", text: "remote direct" },
			SENDER,
		);
		assert.deepEqual(directRemote, {
			ok: true,
			mode: "hc",
			status: "sent",
			pane: "rohan/t7",
		});
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.args[4], "rohan/t7");

		const namedRemote = await deliverPrompt(
			deps,
			{ pane: "remote-worker", text: "remote by name" },
			SENDER,
		);
		assert.deepEqual(namedRemote, {
			ok: true,
			mode: "hc",
			status: "sent",
			pane: "rohan/t7",
		});
		assert.equal(calls.length, 3); // 1 direct send + 1 ls + 1 send

		// Remote "rohan/t1" is distinct from local caller "t1"
		const remoteSameNum = await deliverPrompt(
			deps,
			{ pane: `rohan/${HC_CALLER}`, text: "remote t1 is not local t1" },
			SENDER,
		);
		assert.equal(remoteSameNum.ok, true);
		assert.equal(remoteSameNum.status, "sent");
		assert.equal(remoteSameNum.pane, `rohan/${HC_CALLER}`);
	}

	// Self target by ID ("t1") and by resolved name ("caller" -> "t1") is refused with 0 sends
	for (const selfTarget of [HC_CALLER, "caller"]) {
		const { deps, calls } = fakeHcSendExec({
			"hc ls": () =>
				ok({
					terminals: [{ address: HC_CALLER, name: "caller" }],
					hidden_finished: 0,
					machines: [],
				}),
		});
		const res = await deliverPrompt(
			deps,
			{ pane: selfTarget, text: "self send" },
			SENDER,
		);
		assert.equal(res.ok, false);
		assert.equal(res.mode, "hc");
		assert.equal(res.status, "not_sent");
		assert.equal(res.pane, HC_CALLER);
		assert.match(res.error ?? "", /current hc terminal/);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 0);
	}

	// Missing or invalid hcCallerId -> refused with 0 execs
	for (const badCaller of [undefined, "", "  ", "wE:p1"]) {
		const { deps, calls } = fakeHcSendExec({});
		deps.hcCallerId = badCaller;
		const res = await deliverPrompt(
			deps,
			{ pane: HC_TARGET, text: "no caller" },
			SENDER,
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "not_sent");
		assert.equal(res.error, "hc caller unknown");
		assert.equal(calls.length, 0);
	}

	// Leading '-' in text rejected with 0 execs and no '--' insertion; multiline text with embedded flags kept verbatim
	for (const dashText of ["-n", "--help", "-rf /"]) {
		const { deps, calls } = fakeHcSendExec({});
		const res = await deliverPrompt(
			deps,
			{ pane: HC_TARGET, text: dashText },
			SENDER,
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "not_sent");
		assert.equal(res.error, "text starting with '-' unsupported on hc");
		assert.equal(calls.length, 0);
	}

	{
		let sentArgs: string[] = [];
		const { deps } = fakeHcSendExec({
			"hc send": (args) => {
				sentArgs = args;
				return ok(hcSendPayload());
			},
		});
		const complexText = 'first line\n"quoted" --wait --raw --force';
		const res = await deliverPrompt(
			deps,
			{ pane: HC_TARGET, text: complexText },
			SENDER,
		);
		assert.equal(res.ok, true);
		assert.equal(sentArgs.includes("--"), false);
		assert.equal(sentArgs[sentArgs.length - 1], complexText);
	}

	// Lookup elapsed time reduces send --wait timeout budget; < 1ms remaining before send returns not_sent
	{
		let sendArgs: string[] = [];
		let sendExecTimeout: number | undefined;
		const { deps, advance, setClock } = fakeHcSendExec({
			"hc ls": () => {
				advance(2_400);
				return ok({
					terminals: [{ address: HC_TARGET, name: "worker" }],
					hidden_finished: 0,
					machines: [],
				});
			},
			"hc send": (args, options) => {
				sendArgs = args;
				sendExecTimeout = options?.timeout;
				return ok(
					hcSendPayload({
						wait: hcWaitPayload(HC_TARGET, { turn: 5 }),
					}),
				);
			},
		});
		const okRes = await deliverPrompt(
			deps,
			{ pane: "worker", text: "budgeted wait", wait: true },
			SENDER,
		);
		assert.equal(okRes.ok, true);
		assert.equal(sendArgs[sendArgs.indexOf("--timeout") + 1], "58");
		assert.equal(sendExecTimeout, 57_600);

		const { deps: exhaustedDeps, calls: exhaustedCalls, setClock: setExClock } =
			fakeHcSendExec({
				"hc ls": () => {
					setExClock(61_000);
					return ok({
						terminals: [{ address: HC_TARGET, name: "worker" }],
						hidden_finished: 0,
						machines: [],
					});
				},
			});
		const exRes = await deliverPrompt(
			exhaustedDeps,
			{ pane: "worker", text: "exhausted" },
			SENDER,
		);
		assert.equal(exRes.ok, false);
		assert.equal(exRes.status, "not_sent");
		assert.equal(exhaustedCalls.filter((c) => c.args[0] === "send").length, 0);
		void setClock;
	}

	// Pre-aborted signal (0 execs) and abort during hc ls lookup (1 exec, same AbortSignal forwarded, 0 sends)
	{
		const preAborted = new AbortController();
		preAborted.abort();
		const { deps: preDeps, calls: preCalls } = fakeHcSendExec({});
		const preRes = await deliverPrompt(
			preDeps,
			{ pane: HC_TARGET, text: "pre-aborted" },
			SENDER,
			preAborted.signal,
		);
		assert.equal(preRes.ok, false);
		assert.equal(preRes.mode, "hc");
		assert.equal(preRes.status, "not_sent");
		assert.equal(preCalls.length, 0);

		const midLookup = new AbortController();
		const { deps: midDeps, calls: midCalls } = fakeHcSendExec({
			"hc ls": (_args, options) => {
				assert.equal(options?.signal, midLookup.signal);
				midLookup.abort();
				return { code: 1, killed: true, stderr: "aborted" };
			},
		});
		const midRes = await deliverPrompt(
			midDeps,
			{ pane: "worker", text: "abort during ls" },
			SENDER,
			midLookup.signal,
		);
		assert.equal(midRes.ok, false);
		assert.equal(midRes.mode, "hc");
		assert.equal(midRes.status, "not_sent");
		assert.equal(midCalls.length, 1);
		assert.equal(midCalls[0]?.args[0], "ls");
		assert.equal(midCalls[0]?.options?.signal, midLookup.signal);
		assert.equal(midCalls.filter((c) => c.args[0] === "send").length, 0);
	}
});

test("hc send boundary 6: registerSendFeatures with hc backend verifies descriptions, custom hcBin, 0 herdr/gjc fallback, and 0 secret leakage in describeResult/command/tool/logger", async () => {
	let commandDesc = "";
	let commandHandler: ((args: string, ctx: ExtensionContext) => Promise<void>) | undefined;
	let toolDesc = "";
	let toolExecute:
		| ((
				toolCallId: string,
				params: { pane: string; text: string; wait?: boolean; raw?: boolean },
				signal?: AbortSignal,
				onUpdate?: unknown,
				ctx?: ExtensionContext,
		  ) => Promise<{
				content: { type: string; text: string }[];
				details: SendResult;
				isError: boolean;
		  }>)
		| undefined;
	const logs: string[] = [];
	const execCalls: { command: string; args: string[] }[] = [];
	let currentSendResult: Partial<ExecResult> = ok(hcSendPayload());

	const api = {
		zod,
		exec: async (command: string, args: string[], options: ExecOptions) => {
			assertExecTimeout(options?.timeout);
			assert.equal(command, "/custom/hc", "must use custom hcBin and never fall back to herdr or gjc");
			execCalls.push({ command, args });
			return {
				stdout: "",
				stderr: "",
				code: 0,
				killed: false,
				...currentSendResult,
			};
		},
		logger: {
			info: (message: string) => logs.push(`info:${message}`),
			warn: (message: string) => logs.push(`warn:${message}`),
		},
		registerCommand: (
			_name: string,
			options: { description: string; handler: typeof commandHandler },
		) => {
			commandDesc = options.description;
			commandHandler = options.handler;
		},
		registerTool: (definition: {
			description: string;
			execute: typeof toolExecute;
		}) => {
			toolDesc = definition.description;
			toolExecute = definition.execute;
		},
	} as unknown as ExtensionAPI;

	registerSendFeatures(api, "herdr", undefined, {
		backend: "hc",
		hcBin: "/custom/hc",
		hcCallerId: HC_CALLER,
	});

	assert.equal(commandDesc.includes(HC_SEND_NOTE), true);
	assert.equal(toolDesc.includes(HC_SEND_NOTE), true);

	const headlessCtx = {
		hasUI: false,
		sessionManager: { getSessionId: () => "SECRET_GJC_SESSION_ID_999" },
	} as unknown as ExtensionContext;

	// --raw --wait via /herdr-send command
	currentSendResult = ok(
		hcSendPayload({
			wait: hcWaitPayload(HC_TARGET, {
				ended: true,
				reason: "status",
				status: "done",
				turn: 5,
			}),
		}),
	);
	await commandHandler!(`--raw --wait ${HC_TARGET} SECRET_PROMPT_TEXT_777`, headlessCtx);
	assert.equal(execCalls.length, 1);
	assert.equal(execCalls[0]?.command, "/custom/hc");
	assert.deepEqual(execCalls[0]?.args, [
		"send",
		"--json",
		"--if",
		"idle",
		"--wait",
		"--timeout",
		"60",
		HC_TARGET,
		"SECRET_PROMPT_TEXT_777",
	]);
	assert.equal(logs.length, 1);
	assert.match(logs[0]!, /^info:hc text delivered \(status: sent\) and turn completed/);
	assert.match(logs[0]!, /\[backend=hc, phase=post_send, status=sent, textLength=22\]$/);
	assert.equal(logs[0]!.includes(HC_SEND_NOTE), true);
	assert.equal(logs[0]!.includes(HC_TARGET), false);

	// Remote address via /herdr-send command -> stub exec argv gets remote address once, logger has neither address nor machine name
	currentSendResult = ok(hcSendPayload());
	await commandHandler!("rohan/t7 SECRET_PROMPT_TEXT_777", headlessCtx);
	assert.equal(execCalls.length, 2);
	assert.equal(
		execCalls[1]?.args.filter((arg) => arg === "rohan/t7").length,
		1,
	);
	assert.equal(logs.length, 2);
	assert.match(logs[1]!, /^info:hc text delivered \(status: sent\)/);
	assert.match(logs[1]!, /\[backend=hc, phase=post_send, status=sent, textLength=22\]$/);
	for (const forbiddenTargetToken of ["rohan/t7", "rohan", "t7", HC_TARGET]) {
		assert.equal(
			JSON.stringify(logs).includes(forbiddenTargetToken),
			false,
			`logger leaked target/machine token: ${forbiddenTargetToken}`,
		);
	}

	// Secret leakage check across error kinds and synthetic raw errors
	const secrets = [
		"SECRET_PROMPT_TEXT_777",
		"SECRET_STATUS_MSG_888",
		"SECRET_GJC_SESSION_ID_999",
		"/tmp/SECRET_HC_SOCKET.sock",
	];
	for (const errCase of [
		hcErrorResult(
			"status_mismatch",
			"SECRET_STATUS_MSG_888 /tmp/SECRET_HC_SOCKET.sock SECRET_GJC_SESSION_ID_999",
		),
		hcErrorResult(
			"unavailable",
			"SECRET_STATUS_MSG_888 /tmp/SECRET_HC_SOCKET.sock SECRET_PROMPT_TEXT_777",
			true,
		),
		{
			code: 1,
			stderr: "unstructured error SECRET_STATUS_MSG_888 /tmp/SECRET_HC_SOCKET.sock",
		},
	]) {
		currentSendResult = errCase;
		await commandHandler!(`rohan/t7 SECRET_PROMPT_TEXT_777`, headlessCtx);
		const toolOut = await toolExecute!(
			"call-hc",
			{ pane: "rohan/t7", text: "SECRET_PROMPT_TEXT_777" },
			undefined,
			undefined,
			headlessCtx,
		);
		assert.equal(toolOut.isError, true);
		const combined = JSON.stringify({ logs, toolOut: toolOut.content });
		for (const secret of [...secrets, "rohan", "t7", HC_TARGET]) {
			assert.equal(
				combined.includes(secret),
				false,
				`leaked secret or target: ${secret}`,
			);
		}
		for (const secret of secrets) {
			assert.equal(
				JSON.stringify(toolOut.details).includes(secret),
				false,
				`leaked secret in details: ${secret}`,
			);
		}
	}

	// Even if a synthetic SendResult has a raw error or pane, describeResult never leaks it on mode="hc"
	const syntheticFormatted = describeResult({
		ok: false,
		mode: "hc",
		status: "not_sent",
		pane: "SECRET_GJC_SESSION_ID_999",
		error: "SECRET_STATUS_MSG_888 /tmp/SECRET_HC_SOCKET.sock",
	});
	for (const secret of secrets) {
		assert.equal(syntheticFormatted.includes(secret), false);
	}
});
