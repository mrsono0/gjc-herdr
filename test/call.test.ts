import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs/promises";
import test, { afterEach } from "node:test";
import type { ExecResult, ExtensionAPI } from "@gajae-code/coding-agent";
import {
	callRegisteredAgent,
	callViaHc,
	describeCallResult,
	HC_CALL_BACKEND_NOTE,
	parseCallCommandArgs,
	registerCallFeatures,
	USAGE,
	type AgentCallDeps,
	type AgentCallResult,
	type ResultFileHandle,
	type ResultFileReadResult,
	type ResultFileStat,
} from "../src/call.ts";
import { HC_DONE_NON_ATOMIC_NOTE } from "../src/send.ts";

type ExecOptions = Parameters<ExtensionAPI["exec"]>[2];
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
		hcBin: "hc",
		hcCallerId: HC_CALLER_ID,
		inFlight: new Set(),
		now: () => clock,
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
		);
		assert.equal(res.ok, true);
		assert.equal(res.status, "answered");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.answer, "hc file answer");
		assert.equal(res.markerVerified, false);
		assert.equal("capture" in res, false);
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
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "uncertain");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.error?.code, "protocol");
		assert.equal(getOpenCalls(), 0);
	}
});

test("hc boundary 2: preflight hc get states (finished, reported=false, working, blocked, error rejected; done allowed without --if) and post-send blocked, error, exit, and follow-up wait failure (including needs_target)", async () => {
	// Preflight state="finished", reported=false, status.state="working"|"blocked"|"error" -> all rejected before hc send
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

	// Preflight status.state="done" is allowed (omits --if, recovers answer, surfaces non-atomic note)
	{
		const { deps, calls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "done", { turn: 4 })),
			"hc send": (args) => {
				assert.equal(args.includes("--if"), false);
				assert.deepEqual(args.slice(0, 4), [
					"send",
					"--json",
					"--wait",
					"--timeout",
				]);
				return ok(hcSendJson(HC_TARGET_ID));
			},
		});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: "preflight done allowed", resultFile: HC_RESULT_PATH },
		);
		assert.equal(res.ok, true);
		assert.equal(res.status, "answered");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.answer, "hc file answer");
		assert.equal(res.nonAtomicDone, true);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 1);
		const formatted = describeCallResult(res);
		assert.equal(formatted.includes(HC_DONE_NON_ATOMIC_NOTE), true);
		assert.equal(formatted.includes("hc file answer"), true);
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
		);
		assert.equal(resBroken.error?.code, "protocol_error");
	}

	// Text starting with '-' is rejected on hc before any lstat or hc exec
	for (const dashText of ["-v", "--help", "--json"]) {
		const { deps, calls, getLstatCalls } = fakeHcExec({});
		const res = await callRegisteredAgent(
			deps,
			{ target: HC_TARGET_ID, text: dashText, resultFile: HC_RESULT_PATH },
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
		);
		await new Promise((r) => setTimeout(r, 10));
		assert.equal(deps.inFlight.has("t7"), true);

		// Concurrent call by ID "t7" hits the canonical inFlight set on "t7" without sending
		const r2 = await callRegisteredAgent(
			deps,
			{ target: "t7", text: "concurrent", resultFile: "/tmp/gjc-hc-2.md" },
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
	registerCallFeatures(api, {
		hcBin: "/custom/hc",
		hcCallerId: "",
	});
	assert.equal(commandDesc.includes(HC_CALL_BACKEND_NOTE), true);
	assert.equal(toolDesc.includes(HC_CALL_BACKEND_NOTE), true);
	assert.match(commandDesc, /idle or done targets only.*not atomic/i);
	assert.match(toolDesc, /idle or done targets only.*not atomic/i);
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
	registerCallFeatures(api, {
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

test("hc result_file: enforces O_NOFOLLOW open flags, exact 1 MiB acceptance, zero-byte/oversize-read/stat bounds with zero reads on stat rejection, and pre-existing symlink/directory refusal", async () => {
	const resultPath = "/tmp/gjc-herdr-hc-bounds.md";
	const expectedFlags =
		fsConstants.O_RDONLY |
		(fsConstants.O_NOFOLLOW ?? 0) |
		(fsConstants.O_NONBLOCK ?? 0);

	// Pre-existing regular file, symlink, and directory are all rejected by initial lstat before any hc call or open
	for (const kind of ["regular", "symlink", "directory"] as const) {
		let openCalls = 0;
		const { deps, calls } = fakeHcExec({});
		deps.fs = {
			lstat: async (path) => {
				assert.equal(path, resultPath);
				return {
					isFile: () => kind === "regular",
					isSymbolicLink: () => kind === "symlink",
					size: 10,
				};
			},
			open: async () => {
				openCalls++;
				throw new Error("should not open");
			},
		};
		const res = await callViaHc(deps, {
			target: HC_TARGET_ID,
			text: `preexisting ${kind}`,
			resultFile: resultPath,
		});
		assert.equal(res.ok, false, kind);
		assert.equal(res.status, "not_sent", kind);
		assert.equal(res.delivery, "not_sent", kind);
		assert.equal(res.error?.code, "invalid_request", kind);
		assert.equal(
			res.error?.message,
			"result file check failed: already exists",
			kind,
		);
		assert.equal(calls.length, 0, kind);
		assert.equal(openCalls, 0, kind);
	}

	// Exact 1 MiB file succeeds and verifies O_RDONLY | O_NOFOLLOW | O_NONBLOCK open flags and describeCallResult format
	{
		const exactOneMiB = "a".repeat(1_024 * 1_024);
		const { handle, counts } = fakeFileHandle(exactOneMiB);
		let openCalls = 0;
		const { deps } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () => ok(hcSendJson(HC_TARGET_ID)),
		});
		deps.fs = {
			lstat: async () => {
				throw enoentError();
			},
			open: async (path, flags) => {
				assert.equal(path, resultPath);
				assert.equal(flags, expectedFlags);
				openCalls++;
				return handle;
			},
		};
		const okOneMiB = await callViaHc(deps, {
			target: HC_TARGET_ID,
			text: "1mib",
			resultFile: resultPath,
		});
		assert.equal(okOneMiB.ok, true);
		assert.equal(okOneMiB.status, "answered");
		assert.equal(okOneMiB.delivery, "submitted");
		assert.equal(okOneMiB.answer?.length, 1_024 * 1_024);
		assert.equal(okOneMiB.resultFile, resultPath);
		assert.equal(okOneMiB.markerVerified, false);
		assert.equal(openCalls, 1);
		assert.equal(counts.stat, 1);
		assert.ok(counts.read >= 1);
		assert.equal(counts.close, 1);
		const formatted = describeCallResult(okOneMiB);
		assert.match(formatted.slice(0, 200), /^herdr-call answered \(delivery submitted,/);
		assert.equal(formatted.slice(0, 200).includes(`resultFile ${resultPath}`), true);
	}

	// Zero-byte (empty-stat / empty-read), oversize-read (> 1 MiB read despite small stat), and stat rejections (fifo, hardlink, empty-stat, oversize-stat) with zero reads
	for (const scenario of [
		"fifo",
		"hardlink",
		"empty-stat",
		"empty-read",
		"oversize-stat",
		"oversize-read",
	] as const) {
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
								: fakeFileHandle("a".repeat(1_024 * 1_024 + 1), { size: 64 });
		const { deps } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () => ok(hcSendJson(HC_TARGET_ID)),
		});
		deps.fs = {
			lstat: async () => {
				throw enoentError();
			},
			open: async () => handle,
		};
		const res = await callViaHc(deps, {
			target: HC_TARGET_ID,
			text: `bounds ${scenario}`,
			resultFile: resultPath,
		});
		assert.equal(res.ok, false, scenario);
		assert.equal(res.status, "response_unverified", scenario);
		assert.equal(res.delivery, "submitted", scenario);
		assert.equal(res.resultFile, resultPath, scenario);
		assert.equal(res.error?.code, "result_file_invalid", scenario);
		assert.equal(
			res.error?.message,
			"result file check failed: result_file_invalid",
			scenario,
		);
		assert.equal(counts.stat, 1, scenario);
		assert.equal(counts.close, 1, scenario);
		if (
			scenario === "fifo" ||
			scenario === "hardlink" ||
			scenario === "empty-stat" ||
			scenario === "oversize-stat"
		) {
			assert.equal(counts.read, 0, scenario);
		} else {
			assert.ok(counts.read >= 1, scenario);
		}
	}
});

test("hc result_file: honors abort during pre-send lstat recheck and during open/stat recovery", async () => {
	const resultPath = "/tmp/gjc-herdr-hc-abort.md";

	// Abort during second (pre-send) lstat -> not_sent, aborted, 0 send, inFlight cleared
	{
		const controller = new AbortController();
		let lstatCalls = 0;
		let openCalls = 0;
		const { deps, calls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "idle", { turn: 4 })),
			"hc send": () => {
				throw new Error("should not send after pre-send lstat abort");
			},
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
		const res = await callViaHc(
			deps,
			{ target: HC_TARGET_ID, text: "abort pre-send lstat", resultFile: resultPath },
			controller.signal,
		);
		assert.equal(res.ok, false);
		assert.equal(res.status, "not_sent");
		assert.equal(res.delivery, "not_sent");
		assert.equal(res.error?.code, "aborted");
		assert.equal(res.answer, undefined);
		assert.equal(lstatCalls, 2);
		assert.equal(openCalls, 0);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 0);
		assert.equal(deps.inFlight.size, 0);
	}

	// Abort during open and during stat recovery -> read_failed, submitted, aborted, handle closed, inFlight cleared
	for (const abortAt of ["open", "stat"] as const) {
		const controller = new AbortController();
		const bytes = new TextEncoder().encode("SAFE");
		const { handle, counts } = fakeFileHandle(bytes, {
			onStat: () => {
				if (abortAt === "stat") controller.abort();
				return { isFile: () => true, nlink: 1, size: bytes.byteLength };
			},
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
				if (abortAt === "open") controller.abort();
				return handle;
			},
		};
		const res = await callViaHc(
			deps,
			{ target: HC_TARGET_ID, text: `abort ${abortAt}`, resultFile: resultPath },
			controller.signal,
		);
		await new Promise((r) => setTimeout(r, 5));
		assert.equal(res.ok, false, abortAt);
		assert.equal(res.status, "read_failed", abortAt);
		assert.equal(res.delivery, "submitted", abortAt);
		assert.equal(res.error?.code, "aborted", abortAt);
		assert.equal(res.answer, undefined, abortAt);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 1, abortAt);
		assert.equal(counts.close, 1, abortAt);
		assert.equal(deps.inFlight.size, 0, abortAt);
		if (abortAt === "open") {
			assert.equal(counts.stat, 0, abortAt);
			assert.equal(counts.read, 0, abortAt);
		} else {
			assert.equal(counts.stat, 1, abortAt);
			assert.equal(counts.read, 0, abortAt);
		}
	}
});

test("hc call done target: omits --if and recovers answer with non-atomic note, preserves done state on pre-send failure, classifies core pre-input rejection vs uncertain without resend, and keeps idle note-free", async () => {
	assert.equal(
		USAGE,
		"Usage: /herdr-call --result-file <abs-path> <terminal> <text>",
	);

	// 1. Preflight idle keeps --if idle and omits non-atomic note
	{
		const { deps, calls } = fakeHcExec({
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
				return ok(hcSendJson(HC_TARGET_ID));
			},
		});
		const res = await callRegisteredAgent(deps, {
			target: HC_TARGET_ID,
			text: "idle call",
			resultFile: HC_RESULT_PATH,
		});
		assert.equal(res.ok, true);
		assert.equal(res.status, "answered");
		assert.equal(res.nonAtomicDone, undefined);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 1);
		assert.equal(describeCallResult(res).includes(HC_DONE_NON_ATOMIC_NOTE), false);
	}

	// 2. Preflight done omits --if, supports follow-up hc wait, recovers result file, and surfaces non-atomic note
	{
		const { deps, calls } = fakeHcExec(
			{
				"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "done", { turn: 4 })),
				"hc send": (args) => {
					assert.equal(args.includes("--if"), false);
					assert.deepEqual(args.slice(0, 4), [
						"send",
						"--json",
						"--wait",
						"--timeout",
					]);
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
				"hc wait": () =>
					ok(
						hcWaitJson(HC_TARGET_ID, {
							ended: true,
							reason: "status",
							status: "done",
							turn: 5,
						}),
					),
			},
			"done follow-up answer",
		);
		const res = await callRegisteredAgent(deps, {
			target: HC_TARGET_ID,
			text: "done follow-up call",
			resultFile: HC_RESULT_PATH,
		});
		assert.equal(res.ok, true);
		assert.equal(res.status, "answered");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.state, "done");
		assert.equal(res.answer, "done follow-up answer");
		assert.equal(res.markerVerified, false);
		assert.equal(res.nonAtomicDone, true);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 1);
		assert.equal(calls.filter((c) => c.args[0] === "wait").length, 1);
		const formatted = describeCallResult(res);
		assert.match(formatted, /^herdr-call answered \(delivery submitted,/);
		assert.equal(formatted.includes(HC_DONE_NON_ATOMIC_NOTE), true);
		assert.equal(formatted.includes("done follow-up answer"), true);
	}

	// 3. Preflight done + stale wait turn (turn === send.turn) still rejected as uncertain/protocol with 0 file open
	{
		const { deps, getOpenCalls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "done", { turn: 4 })),
			"hc send": () =>
				ok(
					hcSendJson(HC_TARGET_ID, {
						turn: 4,
						wait: hcWaitJson(HC_TARGET_ID, {
							ended: true,
							reason: "status",
							status: "done",
							turn: 4,
						}),
					}),
				),
		});
		const res = await callRegisteredAgent(deps, {
			target: HC_TARGET_ID,
			text: "stale done turn",
			resultFile: HC_RESULT_PATH,
		});
		assert.equal(res.ok, false);
		assert.equal(res.status, "uncertain");
		assert.equal(res.delivery, "submitted");
		assert.equal(res.error?.code, "protocol");
		assert.equal(res.nonAtomicDone, true);
		assert.equal(getOpenCalls(), 0);
		assert.equal(describeCallResult(res).includes(HC_DONE_NON_ATOMIC_NOTE), true);
	}

	// 4. Preflight done + budget exhausted before hc send -> not_sent, state="done" (not "idle"), 0 sends, no non-atomic note
	{
		const { deps, calls, setClock } = fakeHcExec({
			"hc get": () => {
				setClock(56_000);
				return ok(hcTerminalJson(HC_TARGET_ID, "done", { turn: 4 }));
			},
			"hc send": () => {
				throw new Error("should not spawn hc send when budget exhausted");
			},
		});
		deps.fs = {
			lstat: async () => {
				throw enoentError();
			},
			open: async () => {
				throw new Error("should not open");
			},
		};
		// First lstat succeeds (ENOENT), hc get sets clock to waitDeadline (56_000) -> pre-send lstat times out with state="done"
		const resLstatTimeout = await callRegisteredAgent(deps, {
			target: HC_TARGET_ID,
			text: "done budget out before lstat",
			resultFile: HC_RESULT_PATH,
		});
		assert.equal(resLstatTimeout.ok, false);
		assert.equal(resLstatTimeout.status, "not_sent");
		assert.equal(resLstatTimeout.delivery, "not_sent");
		assert.equal(resLstatTimeout.state, "done");
		assert.equal(resLstatTimeout.nonAtomicDone, undefined);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 0);
		assert.equal(
			describeCallResult(resLstatTimeout).includes(HC_DONE_NON_ATOMIC_NOTE),
			false,
		);

		// Budget expires right after pre-send lstat -> budget exhausted before hc send preserves state="done"
		let lstatCount = 0;
		let postSecondLstatNowCalls = 0;
		const { deps: deps2, calls: calls2 } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "done", { turn: 4 })),
			"hc send": () => {
				throw new Error("should not spawn hc send when budget exhausted");
			},
		});
		deps2.now = () => {
			if (lstatCount < 2) return 1_000;
			postSecondLstatNowCalls++;
			// First call after 2nd lstat is raceResultFileOp's post-check (still 1ms left); next call is sendRemMs (0ms left)
			return postSecondLstatNowCalls === 1 ? 55_999 : 56_000;
		};
		deps2.fs = {
			lstat: async () => {
				lstatCount++;
				throw enoentError();
			},
			open: async () => {
				throw new Error("should not open");
			},
		};
		const resSendBudget = await callRegisteredAgent(deps2, {
			target: HC_TARGET_ID,
			text: "done budget out before send",
			resultFile: HC_RESULT_PATH,
		});
		assert.equal(resSendBudget.ok, false);
		assert.equal(resSendBudget.status, "not_sent");
		assert.equal(resSendBudget.delivery, "not_sent");
		assert.equal(resSendBudget.state, "done");
		assert.equal(resSendBudget.error?.code, "timeout");
		assert.equal(
			resSendBudget.error?.message,
			"Call budget exhausted before hc send.",
		);
		assert.equal(resSendBudget.nonAtomicDone, undefined);
		assert.equal(calls2.filter((c) => c.args[0] === "send").length, 0);
		assert.equal(
			describeCallResult(resSendBudget).includes(HC_DONE_NON_ATOMIC_NOTE),
			false,
		);
	}

	// 5. Preflight done -> Core pre-input rejection (blocked/finished) returns not_sent without nonAtomicDone, 1 send, 0 resend
	for (const [kind, code] of [
		["blocked", "agent_blocked"],
		["finished", "terminal_finished"],
	] as const) {
		const { deps, calls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "done", { turn: 4 })),
			"hc send": (args) => {
				assert.equal(args.includes("--if"), false);
				return hcErr(kind, `SECRET_DONE_${kind}`);
			},
		});
		const res = await callRegisteredAgent(deps, {
			target: HC_TARGET_ID,
			text: `done core ${kind}`,
			resultFile: HC_RESULT_PATH,
		});
		assert.equal(res.ok, false, kind);
		assert.equal(res.status, "not_sent", kind);
		assert.equal(res.delivery, "not_sent", kind);
		assert.equal(res.error?.code, code, kind);
		assert.equal(res.nonAtomicDone, undefined, kind);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 1, kind);
		const formatted = describeCallResult(res);
		assert.equal(formatted.includes(`SECRET_DONE_${kind}`), false, kind);
		assert.equal(formatted.includes(HC_DONE_NON_ATOMIC_NOTE), false, kind);
	}

	// 6. Preflight done -> Core uncertain send outcome (killed/unavailable/throw) returns uncertain with delivery="unknown", 0 resend, and non-atomic note
	for (const [label, sendImpl] of [
		["killed", () => ({ code: 1, killed: true, stderr: "" })],
		["unavailable", () => hcErr("unavailable", "SECRET_DONE_UNAVAIL")],
		["throw", () => new Error("spawn EIO")],
	] as const) {
		const { deps, calls } = fakeHcExec({
			"hc get": () => ok(hcTerminalJson(HC_TARGET_ID, "done", { turn: 4 })),
			"hc send": (args) => {
				assert.equal(args.includes("--if"), false);
				return sendImpl();
			},
		});
		const res = await callRegisteredAgent(deps, {
			target: HC_TARGET_ID,
			text: `done uncertain ${label}`,
			resultFile: HC_RESULT_PATH,
		});
		assert.equal(res.ok, false, label);
		assert.equal(res.status, "uncertain", label);
		assert.equal(res.delivery, "unknown", label);
		assert.equal(res.nonAtomicDone, true, label);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 1, label);
		const formatted = describeCallResult(res);
		assert.match(formatted, /Do not resend/, label);
		assert.equal(formatted.includes("SECRET_DONE_UNAVAIL"), false, label);
		assert.equal(formatted.includes(HC_DONE_NON_ATOMIC_NOTE), true, label);
	}
});



