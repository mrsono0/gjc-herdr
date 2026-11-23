import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import type {
	ExecResult,
	ExtensionAPI,
	ExtensionContext,
} from "@gajae-code/coding-agent";
import * as zod from "zod/v4";
import {
	HC_SEND_ERROR_KINDS,
	HC_SEND_NOT_SENT_KINDS,
	type HcSendErrorKind,
} from "../src/hc.ts";
import {
	deliverPrompt,
	deliverViaHc,
	describeResult,
	HC_SEND_NOTE,
	parseCommandArgs,
	registerSendFeatures,
	type SendDeps,
	type SendResult,
	USAGE,
} from "../src/send.ts";

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

// ============================================================================
// #86 3b: hc backend send tests (boundaries 1, 2, 3, 4, 6)
// ============================================================================

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

	registerSendFeatures(api, {
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

test("hc send migrated boundaries: rejects invalid requests and failed name lookups before send, classifies killed/thrown hc send as uncertain without resend, and surfaces USAGE and tool success", async () => {
	// Invalid requests rejected before any hc exec
	for (const [request, expectedError] of [
		[{ pane: " ", text: "x" }, "Pane is required."],
		[
			{ pane: "--current", text: "x" },
			"Target must be an hc terminal address or name, not an option.",
		],
		[{ pane: HC_TARGET, text: " \n" }, "Prompt text must not be empty."],
		[
			{ pane: "a/b/t2", text: "x" },
			"Target is neither a valid hc terminal address nor a valid terminal name.",
		],
	] as const) {
		const { deps, calls } = fakeHcSendExec({});
		const res = await deliverViaHc(deps, request);
		assert.equal(res.ok, false, expectedError);
		assert.equal(res.mode, "hc", expectedError);
		assert.equal(res.status, "not_sent", expectedError);
		assert.equal(res.error, expectedError);
		assert.equal(calls.length, 0, expectedError);
	}

	// Failed hc ls name lookups (0 matches, 2 matches, malformed row) -> not_sent, 0 hc send
	for (const [target, terminals] of [
		["missing-worker", [{ address: "t9", name: "other" }]],
		[
			"dup-worker",
			[
				{ address: "t2", name: "dup-worker" },
				{ address: "t3", name: "dup-worker" },
			],
		],
		["worker", [{ bad: true }]],
	] as const) {
		const { deps, calls } = fakeHcSendExec({
			"hc ls": () =>
				ok({
					terminals,
					hidden_finished: 0,
					machines: [],
				}),
		});
		const res = await deliverViaHc(deps, { pane: target, text: "hi" });
		assert.equal(res.ok, false, target);
		assert.equal(res.mode, "hc", target);
		assert.equal(res.status, "not_sent", target);
		assert.equal(calls.filter((c) => c.args[0] === "send").length, 0, target);
	}

	// Killed or throwing hc send -> uncertain, 1 send, 0 resend
	for (const sendImpl of [
		() => ({ code: 1, killed: true, stderr: "" }),
		() => new Error("spawn EIO"),
	]) {
		const { deps, calls } = fakeHcSendExec({
			"hc send": sendImpl,
		});
		const res = await deliverViaHc(deps, { pane: HC_TARGET, text: "uncertain send" });
		assert.equal(res.ok, false);
		assert.equal(res.mode, "hc");
		assert.equal(res.status, "uncertain");
		assert.equal(calls.length, 1);
	}

	// registerSendFeatures: invalid command flag surfaces USAGE via warn log (0 execs), and tool execute returns ok/sent
	{
		let commandHandler: ((args: string, ctx: ExtensionContext) => Promise<void>) | undefined;
		let toolExecute:
			| ((
					toolCallId: string,
					params: { pane: string; text: string; wait?: boolean; raw?: boolean },
					signal?: AbortSignal,
			  ) => Promise<{
					content: { type: string; text: string }[];
					details: SendResult;
					isError: boolean;
			  }>)
			| undefined;
		const logs: string[] = [];
		const execCalls: { command: string; args: string[] }[] = [];
		const api = {
			zod,
			exec: async (command: string, args: string[], options: ExecOptions) => {
				assertExecTimeout(options?.timeout);
				execCalls.push({ command, args });
				return { stdout: JSON.stringify(hcSendPayload()), stderr: "", code: 0, killed: false };
			},
			logger: {
				info: (message: string) => logs.push(`info:${message}`),
				warn: (message: string) => logs.push(`warn:${message}`),
			},
			registerCommand: (
				_name: string,
				options: { handler: typeof commandHandler },
			) => {
				commandHandler = options.handler;
			},
			registerTool: (definition: { execute: typeof toolExecute }) => {
				toolExecute = definition.execute;
			},
		} as unknown as ExtensionAPI;

		registerSendFeatures(api, { hcBin: "hc", hcCallerId: HC_CALLER });
		const headlessCtx = {
			hasUI: false,
			sessionManager: { getSessionId: () => "unused-session" },
		} as unknown as ExtensionContext;

		await commandHandler!(`--bogus ${HC_TARGET} hello`, headlessCtx);
		assert.equal(execCalls.length, 0);
		assert.equal(
			logs[0],
			`warn:${USAGE} [backend=hc, phase=pre_send, status=not_sent, textLength=0]`,
		);

		const toolRes = await toolExecute!("call-ok", {
			pane: HC_TARGET,
			text: "hello tool",
		});
		assert.equal(execCalls.length, 1);
		assert.equal(toolRes.isError, false);
		assert.deepEqual(toolRes.details, {
			ok: true,
			mode: "hc",
			status: "sent",
			pane: HC_TARGET,
		});
		assert.equal(toolRes.content[0]?.text.includes(HC_SEND_NOTE), true);
	}
});
