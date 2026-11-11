import assert from "node:assert/strict";
import test from "node:test";
import type { ExecResult, ExtensionAPI } from "@gajae-code/coding-agent";
import {
	INVALID_BACKEND_WARNING,
	selectBackend,
} from "../src/extension.ts";
import {
	extractHcErrorKind,
	HC_ERROR_SPECS,
	HC_SEND_ERROR_KINDS,
	HC_SEND_NOT_SENT_KINDS,
	hcGet,
	hcResolveTarget,
	hcSend,
	hcWait,
	isRemoteHcAddress,
	isSelf,
	isValidHcAddress,
	parseWaitFacts,
	runHc,
	type HcErrorKind,
	type HcExecDeps,
	type HcSendErrorKind,
} from "../src/hc.ts";

type ExecOptions = Parameters<ExtensionAPI["exec"]>[2];

function makeDeps(
	handler: (
		command: string,
		args: string[],
		options: ExecOptions,
	) => Partial<ExecResult> | Error,
	hcBin = "hc",
) {
	const calls: { command: string; args: string[]; options: ExecOptions }[] = [];
	const deps: HcExecDeps = {
		hcBin,
		exec: async (command, args, options) => {
			assert(
				options?.timeout !== undefined &&
					Number.isInteger(options.timeout) &&
					options.timeout > 0,
				`exec timeout must be a positive integer, got ${options?.timeout}`,
			);
			calls.push({ command, args, options });
			const out = handler(command, args, options);
			if (out instanceof Error) throw out;
			return { stdout: "", stderr: "", code: 0, killed: false, ...out };
		},
	};
	return { deps, calls };
}

test("address helpers distinguish local, remote, invalid, and self addresses", () => {
	assert.equal(isValidHcAddress("t7"), true);
	assert.equal(isValidHcAddress("t1b"), true);
	assert.equal(isValidHcAddress("rohan/t7"), true);
	assert.equal(isValidHcAddress("node_1.a-b/t9z"), true);
	assert.equal(isValidHcAddress("reviewer"), false);
	assert.equal(isValidHcAddress("rohan/reviewer"), false);
	assert.equal(isValidHcAddress("/t7"), false);
	assert.equal(isValidHcAddress("a/b/t7"), false);
	assert.equal(isValidHcAddress(""), false);

	assert.equal(isRemoteHcAddress("t7"), false);
	assert.equal(isRemoteHcAddress("rohan/t7"), true);

	assert.equal(isSelf("t7", "t7"), true);
	assert.equal(isSelf(" t7 ", "t7"), true);
	assert.equal(isSelf("rohan/t7", "t7"), false);
	assert.equal(isSelf("t7", "rohan/t7"), false);
	assert.equal(isSelf("rohan/t7", "rohan/t7"), true);
	assert.equal(isSelf("t7", undefined), false);
	assert.equal(isSelf("t7", ""), false);
	assert.equal(isSelf("t7", "not-an-addr"), false);
});

test("extractHcErrorKind requires an error object, reads error.kind -> error.data.kind, and enforces phase kind sets", () => {
	assert.equal(
		extractHcErrorKind(
			JSON.stringify({
				error: { kind: "status_mismatch", message: "SECRET_MSG" },
			}),
			"send",
		),
		"status_mismatch",
	);
	assert.equal(
		extractHcErrorKind(
			JSON.stringify({
				error: {
					code: -32000,
					message: "blocked",
					data: { kind: "blocked" },
				},
			}),
			"send",
		),
		"blocked",
	);
	// Wrapper error.kind not in set falls through to recognized error.data.kind
	assert.equal(
		extractHcErrorKind(
			JSON.stringify({
				error: {
					kind: "rpc_error",
					message: "SECRET",
					data: { kind: "status_mismatch" },
				},
			}),
			"send",
		),
		"status_mismatch",
	);
	// needs_target is rejected on send/get/lookup but accepted on wait
	assert.equal(
		extractHcErrorKind(
			JSON.stringify({ error: { kind: "needs_target" } }),
			"send",
		),
		undefined,
	);
	assert.equal(
		extractHcErrorKind(
			JSON.stringify({ error: { data: { kind: "needs_target" } } }),
			"send",
		),
		undefined,
	);
	assert.equal(
		extractHcErrorKind(
			JSON.stringify({ error: { kind: "needs_target" } }),
			"wait",
		),
		"needs_target",
	);
	// Bare top-level kind / data.kind or null / non-object error must NOT match
	for (const invalidEnvelope of [
		{ kind: "status_mismatch" },
		{ data: { kind: "status_mismatch" } },
		{ error: null, kind: "status_mismatch" },
		{ error: "status_mismatch", kind: "status_mismatch" },
		{ error: ["status_mismatch"] },
		{ error: { code: -32000, message: "status_mismatch" } },
		{ error: { kind: "unknown_future_kind" } },
	]) {
		assert.equal(
			extractHcErrorKind(JSON.stringify(invalidEnvelope), "send"),
			undefined,
		);
	}
	assert.equal(extractHcErrorKind("status_mismatch plain stderr"), undefined);
	assert.equal(extractHcErrorKind(""), undefined);
});

test("runHc classifies 2 envelopes x 9 send kinds, rejects needs_target/bare/non-object envelopes on send as unknown, and keeps wait as submitted", async () => {
	const preInputKinds: HcSendErrorKind[] = [
		"status_mismatch",
		"blocked",
		"finished",
		"not_found",
		"machine_unknown",
		"invalid_params",
		"config",
	];
	const unknownSendKinds: HcSendErrorKind[] = ["unavailable", "cancelled"];
	assert.equal(HC_SEND_NOT_SENT_KINDS.size, 7);
	assert.equal(HC_SEND_ERROR_KINDS.size, 9);

	for (const kind of preInputKinds) {
		assert.equal(HC_ERROR_SPECS[kind].sendCertainty, "not_sent");
		for (const useDataKind of [false, true]) {
			const stderr = JSON.stringify({
				error: useDataKind
					? { kind: "rpc_wrapper", message: "SECRET", data: { kind } }
					: { kind, message: "SECRET" },
			});
			const { deps } = makeDeps(() => ({ code: 1, stderr }));
			const res = await runHc(
				deps,
				["send", "--json", "--if", "idle", "t7", "hi"],
				1000,
			);
			assert.equal(res.ok, false);
			assert.equal(res.phase, "send");
			assert.equal(res.errorKind, kind);
			assert.equal(res.certainty, "not_sent");
			assert.equal(res.errorCode, HC_ERROR_SPECS[kind].callCode);
			assert.doesNotMatch(res.message ?? "", /SECRET/);
		}
	}

	for (const kind of unknownSendKinds) {
		assert.equal(HC_ERROR_SPECS[kind].sendCertainty, "unknown");
		for (const useDataKind of [false, true]) {
			const stderr = JSON.stringify({
				error: useDataKind
					? { code: -32000, message: "SECRET", data: { kind } }
					: { kind, message: "SECRET" },
			});
			const { deps } = makeDeps(() => ({ code: 1, stderr }));
			const res = await runHc(
				deps,
				["send", "--json", "--if", "idle", "t7", "hi"],
				1000,
			);
			assert.equal(res.ok, false);
			assert.equal(res.errorKind, kind);
			assert.equal(res.certainty, "unknown");
			assert.equal(res.errorCode, HC_ERROR_SPECS[kind].callCode);
			assert.match(res.message ?? "", /Do not resend/);
		}
	}

	// Send with needs_target, bare kind, bare data.kind, null/non-object error, unrecognized kind -> unknown + Do not resend
	for (const badStderr of [
		JSON.stringify({ error: { kind: "needs_target" } }),
		JSON.stringify({ error: { data: { kind: "needs_target" } } }),
		JSON.stringify({ kind: "status_mismatch" }),
		JSON.stringify({ data: { kind: "status_mismatch" } }),
		JSON.stringify({ error: null, kind: "status_mismatch" }),
		JSON.stringify({ error: "status_mismatch" }),
		JSON.stringify({ error: { kind: "weird" } }),
	]) {
		const { deps } = makeDeps(() => ({ code: 1, stderr: badStderr }));
		const res = await runHc(
			deps,
			["send", "--json", "--if", "idle", "t7", "hi"],
			1000,
		);
		assert.equal(res.ok, false, badStderr);
		assert.equal(res.certainty, "unknown", badStderr);
		assert.equal(res.errorKind, undefined, badStderr);
		assert.equal(res.errorCode, "prompt_failed", badStderr);
		assert.match(res.message ?? "", /Do not resend/, badStderr);
	}

	// Killed, thrown Error, malformed JSON, and invalid turn on send -> unknown
	for (const scenario of ["killed", "throw", "bad_json", "bad_turn"] as const) {
		const { deps } = makeDeps(() => {
			if (scenario === "killed") return { code: 0, killed: true };
			if (scenario === "throw") return new Error("socket hang up");
			if (scenario === "bad_json") return { code: 0, stdout: "not json" };
			return { code: 0, stdout: JSON.stringify({ turn: -1 }) };
		});
		const res = await runHc(
			deps,
			["send", "--json", "--if", "idle", "t7", "hi"],
			1000,
		);
		assert.equal(res.ok, false, scenario);
		assert.equal(res.certainty, "unknown", scenario);
	}

	// ENOENT missing executable -> not_sent
	{
		const enoent = Object.assign(new Error("spawn hc ENOENT"), {
			code: "ENOENT",
		});
		const { deps } = makeDeps(() => enoent);
		const res = await runHc(
			deps,
			["send", "--json", "--if", "idle", "t7", "hi"],
			1000,
		);
		assert.equal(res.ok, false);
		assert.equal(res.certainty, "not_sent");
		assert.equal(res.failureReason, "hc_missing");
	}

	// Wait phase failures (including needs_target) always preserve `submitted` certainty
	for (const kind of ["not_found", "unavailable", "needs_target"] as const satisfies readonly HcErrorKind[]) {
		const { deps } = makeDeps(() => ({
			code: 1,
			stderr: JSON.stringify({ error: { kind } }),
		}));
		const res = await runHc(
			deps,
			["wait", "--json", "t7", "--timeout", "5"],
			5000,
		);
		assert.equal(res.ok, false);
		assert.equal(res.phase, "wait");
		assert.equal(res.errorKind, kind);
		assert.equal(res.certainty, "submitted");
		assert.match(res.message ?? "", /already submitted\. Do not resend/);
	}

	// Pre-send lookup/get with unavailable/cancelled uses preSendMessage ("no input was sent"), never "delivery state is unknown"
	for (const kind of ["unavailable", "cancelled"] as const) {
		const { deps } = makeDeps(() => ({
			code: 1,
			stderr: JSON.stringify({ error: { kind } }),
		}));
		const getRes = await hcGet(deps, "t7", 1000);
		assert.equal(getRes.ok, false);
		if (!getRes.ok) {
			assert.equal(getRes.certainty, "not_sent");
			assert.match(getRes.message, /no input was sent/);
			assert.doesNotMatch(getRes.message, /delivery state is unknown/);
		}
	}

	// Sub-1ms budget or pre-aborted signal skips exec
	{
		const { deps, calls } = makeDeps(() => ({ stdout: "{}" }));
		const budgetRes = await runHc(deps, ["get", "--json", "t7"], 0.5);
		assert.equal(budgetRes.ok, false);
		assert.equal(budgetRes.certainty, "not_sent");
		assert.equal(budgetRes.failureReason, "budget_exhausted");
		assert.equal(calls.length, 0);

		const waitBudgetRes = await runHc(
			deps,
			["wait", "--json", "t7", "--timeout", "1"],
			0,
		);
		assert.equal(waitBudgetRes.ok, false);
		assert.equal(waitBudgetRes.certainty, "submitted");
		assert.equal(calls.length, 0);

		const preAborted = new AbortController();
		preAborted.abort();
		const preAbortedSend = await runHc(
			deps,
			["send", "--json", "--if", "idle", "t7", "hi"],
			1000,
			preAborted.signal,
			"send",
		);
		assert.equal(preAbortedSend.ok, false);
		assert.equal(preAbortedSend.certainty, "not_sent");
		assert.equal(preAbortedSend.failureReason, "aborted");
		assert.equal(calls.length, 0);
	}
});

test("hcResolveTarget resolves addresses directly and names via hc ls --json", async () => {
	// Explicit local & remote addresses require 0 execs
	{
		const { deps, calls } = makeDeps(() => {
			throw new Error("should not exec");
		});
		const local = await hcResolveTarget(deps, " t7 ", 3000);
		assert.deepEqual(local, { ok: true, address: "t7", remote: false });
		const remote = await hcResolveTarget(deps, "rohan/t7", 3000);
		assert.deepEqual(remote, { ok: true, address: "rohan/t7", remote: true });
		assert.equal(calls.length, 0);

		for (const bad of ["", "  ", "--all", "rohan/bad", "/t7", "a/b/t7", "bad name"]) {
			const invalid = await hcResolveTarget(deps, bad, 3000);
			assert.equal(invalid.ok, false, bad);
			if (!invalid.ok) {
				assert.equal(invalid.certainty, "not_sent");
				assert.equal(invalid.code, "invalid_request");
			}
		}
		assert.equal(calls.length, 0);
	}

	// Name lookup: 1 match, 0 matches (with disconnected machine note), 2+ matches, broken row
	{
		const { deps, calls } = makeDeps((_cmd, args) => {
			assert.deepEqual(args, ["ls", "--json"]);
			return {
				stdout: JSON.stringify({
					terminals: [
						{ address: "t2", name: "lead" },
						{ address: "t7", name: "critic" },
						{ address: "rohan/t9", name: "remote-worker" },
					],
					hidden_finished: 0,
					machines: [{ name: "gondor", state: "unreachable" }],
				}),
			};
		});
		const one = await hcResolveTarget(deps, "critic", 3000);
		assert.deepEqual(one, { ok: true, address: "t7", remote: false });
		assert.equal(calls.length, 1);

		const remoteByName = await hcResolveTarget(deps, "remote-worker", 3000);
		assert.deepEqual(remoteByName, {
			ok: true,
			address: "rohan/t9",
			remote: true,
		});

		const zero = await hcResolveTarget(deps, "missing-agent", 3000);
		assert.equal(zero.ok, false);
		if (!zero.ok) {
			assert.equal(zero.code, "target_not_found");
			assert.match(zero.message, /disconnected machines are not searched/);
		}
	}

	// Ambiguous name
	{
		const { deps } = makeDeps(() => ({
			stdout: JSON.stringify({
				terminals: [
					{ address: "t3", name: "dup" },
					{ address: "rohan/t4", name: "dup" },
				],
				hidden_finished: 0,
				machines: [],
			}),
		}));
		const dup = await hcResolveTarget(deps, "dup", 3000);
		assert.equal(dup.ok, false);
		if (!dup.ok) {
			assert.equal(dup.code, "target_ambiguous");
			assert.equal(dup.certainty, "not_sent");
		}
	}

	// Broken terminal row in hc ls
	{
		const { deps } = makeDeps(() => ({
			stdout: JSON.stringify({
				terminals: [{ address: "invalid_addr", name: "critic" }],
				hidden_finished: 0,
				machines: [],
			}),
		}));
		const broken = await hcResolveTarget(deps, "critic", 3000);
		assert.equal(broken.ok, false);
		if (!broken.ok) {
			assert.equal(broken.code, "protocol_error");
			assert.equal(broken.certainty, "not_sent");
		}
	}
});

test("hcGet validates terminal schema and strips raw status.msg", async () => {
	const { deps, calls } = makeDeps((_cmd, args) => {
		assert.deepEqual(args, ["get", "--json", "t7"]);
		return {
			stdout: JSON.stringify({
				address: "t7",
				state: "live",
				reported: true,
				turn: 3,
				status: {
					state: "idle",
					kind: null,
					msg: "SECRET_STATUS_MSG_DO_NOT_EXPOSE",
					title: "SECRET_TITLE",
				},
			}),
		};
	});
	const res = await hcGet(deps, "t7", 3000);
	assert.equal(calls.length, 1);
	assert.equal(res.ok, true);
	if (res.ok) {
		assert.deepEqual(res.facts, {
			address: "t7",
			state: "live",
			reported: true,
			statusState: "idle",
			turn: 3,
		});
		assert.equal(
			JSON.stringify(res.facts).includes("SECRET_STATUS_MSG_DO_NOT_EXPOSE"),
			false,
		);
	}

	// Mismatched address or invalid status record rejected
	for (const payload of [
		{ address: "t8", state: "live", reported: true, status: { state: "idle" } },
		{ address: "t7", state: "weird", reported: true, status: { state: "idle" } },
		{ address: "t7", state: "live", reported: "yes", status: { state: "idle" } },
		{ address: "t7", state: "live", reported: true, status: {} },
	]) {
		const bad = makeDeps(() => ({ stdout: JSON.stringify(payload) }));
		const badRes = await hcGet(bad.deps, "t7", 3000);
		assert.equal(badRes.ok, false);
		if (!badRes.ok) {
			assert.equal(badRes.code, "protocol_error");
			assert.equal(badRes.certainty, "not_sent");
		}
	}
});

test("hcSend rejects text starting with '-', builds exact argv without '--', and hcWait rounds timeout seconds", async () => {
	const textWithEmbeddedFlags = 'check --force --wait -h\n"quoted" line';
	const { deps, calls } = makeDeps(() => ({
		stdout: JSON.stringify({
			turn: 4,
			// started, status, wait omitted
		}),
	}), "/opt/custom/hc");

	// Leading '-' in text is rejected before any exec
	const leadingDash = await hcSend(
		deps,
		"t7",
		"--force",
		{ wait: false },
		3000,
	);
	assert.deepEqual(leadingDash, {
		ok: false,
		certainty: "not_sent",
		code: "invalid_request",
		message: "text starting with '-' unsupported on hc",
	});
	assert.equal(calls.length, 0);

	const sendNoWait = await hcSend(
		deps,
		"t7",
		textWithEmbeddedFlags,
		{ wait: false },
		3000,
	);
	assert.equal(sendNoWait.ok, true);
	assert.equal(calls[0]?.command, "/opt/custom/hc");
	assert.deepEqual(calls[0]?.args, [
		"send",
		"--json",
		"--if",
		"idle",
		"t7",
		textWithEmbeddedFlags,
	]);
	if (sendNoWait.ok) {
		assert.equal(sendNoWait.certainty, "submitted");
		assert.equal(sendNoWait.turn, 4);
		assert.equal(sendNoWait.started, null);
		assert.equal(sendNoWait.status, null);
		assert.equal(sendNoWait.wait, undefined);
		assert.equal(sendNoWait.waitValid, true);
	}

	const { deps: waitDeps, calls: waitCalls } = makeDeps(() => ({
		stdout: JSON.stringify({
			terminal: "t7",
			ended: true,
			reason: "status",
			status: "done",
			turn: 5,
			children: [],
		}),
	}));
	const waitRes = await hcWait(waitDeps, "t7", 12.2, 12200);
	assert.equal(waitRes.ok, true);
	assert.deepEqual(waitCalls[0]?.args, [
		"wait",
		"--json",
		"t7",
		"--timeout",
		"13",
	]);
	assert.equal(waitCalls[0]?.options?.timeout, 12200);

	assert.deepEqual(parseWaitFacts(null), { wait: null, valid: true });
	assert.deepEqual(parseWaitFacts(undefined), { wait: undefined, valid: true });
	assert.equal(parseWaitFacts({ terminal: "t7" }).valid, false);
});

test("selectBackend follows priority rules and logs fixed warning without leaking bad values", () => {
	const warnings: string[] = [];
	const logger = {
		warn(msg: string) {
			warnings.push(msg);
		},
	};
	const helper = { paneId: "w1:p1", binPath: "herdr" };

	// helper valid + HC_TERMINAL_ID present -> herdr
	assert.equal(
		selectBackend({ HC_TERMINAL_ID: "t1" }, helper, logger),
		"herdr",
	);
	// helper null + HC_TERMINAL_ID present -> hc
	assert.equal(selectBackend({ HC_TERMINAL_ID: "t1" }, null, logger), "hc");
	// both absent -> herdr
	assert.equal(selectBackend({}, null, logger), "herdr");
	// forced GJC_HERDR_BACKEND overrides automatic
	assert.equal(
		selectBackend(
			{ GJC_HERDR_BACKEND: "hc", HC_TERMINAL_ID: "t1" },
			helper,
			logger,
		),
		"hc",
	);
	assert.equal(
		selectBackend(
			{ GJC_HERDR_BACKEND: "herdr", HC_TERMINAL_ID: "t1" },
			null,
			logger,
		),
		"herdr",
	);
	assert.equal(warnings.length, 0);

	// Invalid / empty GJC_HERDR_BACKEND warns with fixed message and falls back to automatic
	assert.equal(
		selectBackend(
			{ GJC_HERDR_BACKEND: "SECRET_BAD_BACKEND", HC_TERMINAL_ID: "t1" },
			null,
			logger,
		),
		"hc",
	);
	assert.equal(
		selectBackend({ GJC_HERDR_BACKEND: "" }, helper, logger),
		"herdr",
	);
	assert.deepEqual(warnings, [
		INVALID_BACKEND_WARNING,
		INVALID_BACKEND_WARNING,
	]);
	assert.equal(
		warnings.some((w) => w.includes("SECRET_BAD_BACKEND")),
		false,
	);
});
