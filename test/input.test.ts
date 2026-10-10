import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
	classifyInput,
	inputWaitMs,
	readInputState,
	waitForEmptyInput,
	type InputGuardDeps,
} from "../src/input.ts";

const E = "\x1b";
const RULE = "─".repeat(70);
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

// Shapes captured from live Herdr panes (ANSI via `herdr pane read --source visible --format ansi`).
const claude = (inputRow: string, below = "  -- INSERT -- ⏵⏵ auto mode on") =>
	`✻ Churned for 8s\n${E}[0m${E}[38;2;136;136;136m${RULE}${E}[0m\n${inputRow}\n${E}[0m${E}[38;2;136;136;136m${RULE}${E}[0m\n${below}`;
const gjc = (row: string) =>
	`${E}[0m${E}[38;2;248;119;166m╭${"─".repeat(70)}╮${E}[0m\n${row}\n${E}[0m${E}[38;2;248;119;166m╰${"─".repeat(70)}╯${E}[0m\n\n ⠇ Working\n ⬢ opus-5.5`;
const gjcRow = (body: string) =>
	`${E}[0m${E}[38;2;248;119;166m│ ${E}[0m${E}[38;2;94;200;255m>${E}[0m ${body}${E}[38;2;248;119;166m │${E}[0m`;

test("Claude Code input box: empty, dim placeholder, and real text", () => {
	assert.equal(classifyInput(claude(`❯${E}[0m `)), "empty");
	assert.equal(classifyInput(claude(`${E}[0m❯ ${E}[0m${E}[2m계속 진행${E}[0m`)), "empty");
	assert.equal(classifyInput(claude(`❯ ${E}[2mPress up to edit queued messages${E}[0m`)), "empty");
	assert.equal(classifyInput(claude(`❯ 권고 내용으로 적`)), "typing");
	assert.equal(classifyInput(claude(`❯ ${E}[7m${E}[0m${E}[38;2;255;255;255mhello${E}[0m`)), "typing");
	// truecolor "…;2;r;g;b" must not be mistaken for the dim attribute
	assert.equal(classifyInput(claude(`❯ ${E}[38;2;1;2;3mhello${E}[0m`)), "typing");
});

test("Claude Code multi-line input counts as typing", () => {
	assert.equal(classifyInput(claude("❯\n  second line")), "typing");
});

test("Claude draft rules do not replace the unindented UI borders", () => {
	assert.equal(classifyInput(claude(`❯ user draft\n  ${RULE}\n  ❯`)), "typing");
	assert.equal(classifyInput(` ${RULE}\n❯\n ${RULE}`), "unknown");
});

test("Claude colon color parameters do not become dim or reset attributes", () => {
	for (const color of ["38:2::1:2:2", "38:2:1:2:2", "38:5:2", "48:2::1:2:2", "48:5:2"]) {
		assert.equal(classifyInput(claude(`❯ ${E}[${color}mhello${E}[0m`)), "typing", color);
	}
	assert.equal(classifyInput(claude(`❯ ${E}[2;38:2::1:2:0mplaceholder${E}[0m`)), "empty");
	assert.equal(classifyInput(claude(`❯ ${E}[38:2::1:2:2;2mplaceholder${E}[0m`)), "empty");
	assert.equal(classifyInput(claude(`❯ ${E}[2;38:5:2;22mhello${E}[0m`)), "typing");
});

test("Claude dim state persists across input rows until reset", () => {
	assert.equal(classifyInput(claude(`❯ ${E}[2mplaceholder\ncontinued hint${E}[0m`)), "empty");
	assert.equal(classifyInput(claude(`❯ ${E}[2mhint\n${E}[22mreal draft`)), "typing");
});

test("GJC input box: placeholder, empty, and real text", () => {
	assert.equal(
		classifyInput(gjc(gjcRow(`${E}[38;2;85;112;138mType your message... ⌥Q: Queue (busy) · ⇧⇥: Thinking${E}[0m`))),
		"empty",
	);
	assert.equal(classifyInput(gjc(gjcRow(""))), "empty");
	assert.equal(classifyInput(gjc(gjcRow("안녕 반가워"))), "typing");
	assert.equal(classifyInput(gjc(`${gjcRow("")}\n│ 둘째 줄 │`)), "typing");
});

test("GJC placeholder prefixes in user text are typing unless the hint suffix is recognized", () => {
	assert.equal(classifyInput(gjc(gjcRow("Type your message..."))), "empty");
	for (const hint of ["↩: Steer", "⌥Q: Queue", "⇧⇥: Thinking", "⌃L: Model", "…"]) {
		assert.equal(classifyInput(gjc(gjcRow(`Type your message... ${hint}`))), "empty", hint);
	}
	for (const draft of ["Type your message... this is my draft", "Type your message...↩", "Type your message...x"]) {
		assert.equal(classifyInput(gjc(gjcRow(draft))), "typing", draft);
	}
});

test("visible lower input boundaries with clipped upper rows are conservatively typing", () => {
	const longClaude = claude(`❯ draft\n${Array(70).fill("  more draft").join("\n")}`);
	assert.equal(classifyInput(longClaude.split("\n").slice(-60).join("\n")), "typing");
	const longGjc = gjc(`${gjcRow("draft")}\n${Array(70).fill("│ more draft │").join("\n")}`);
	assert.equal(classifyInput(longGjc.split("\n").slice(-60).join("\n")), "typing");
	assert.equal(classifyInput(`${RULE}\nnot an input row\n${RULE}`), "typing");
});

test("unrecognized screens are unknown, never empty", () => {
	assert.equal(classifyInput(""), "unknown");
	assert.equal(classifyInput(" mrsono0  ~/proj   main\n❯"), "unknown");
	assert.equal(classifyInput("just some output\nmore output"), "unknown");
	// a rule far above the bottom is conversation output, not the input box
	assert.equal(
		classifyInput(`${RULE}\n❯ x\n${RULE}\na\nb\nc\nd\ne`),
		"unknown",
	);
});

test("GJC_HERDR_INPUT_WAIT_SEC defaults to 60s and rejects bad values", () => {
	assert.equal(inputWaitMs({}), 60_000);
	assert.equal(inputWaitMs({ GJC_HERDR_INPUT_WAIT_SEC: "15" }), 15_000);
	assert.equal(inputWaitMs({ GJC_HERDR_INPUT_WAIT_SEC: "0" }), 0);
	assert.equal(inputWaitMs({ GJC_HERDR_INPUT_WAIT_SEC: "-3" }), 60_000);
	assert.equal(inputWaitMs({ GJC_HERDR_INPUT_WAIT_SEC: "abc" }), 60_000);
	assert.equal(inputWaitMs({ GJC_HERDR_INPUT_WAIT_SEC: "99999" }), 600_000);
});

function reader(screens: (string | Error)[], readMs = 0) {
	let reads = 0;
	let clock = 0;
	const sleeps: number[] = [];
	const timeouts: number[] = [];
	const deps: InputGuardDeps = {
		herdrBin: "herdr",
		now: () => clock,
		exec: (async (_command: string, args: string[], options: Parameters<InputGuardDeps["exec"]>[2]) => {
			assertExecTimeout(options?.timeout);
			if (options?.timeout !== undefined) timeouts.push(options.timeout);
			assert.deepEqual(args.slice(0, 2), ["pane", "read"]);
			assert(args.includes("ansi") && args.includes("visible"));
			assert.equal(args[args.indexOf("--lines") + 1], "60");
			reads++;
			clock += readMs;
			const next = screens.shift() ?? "";
			if (next instanceof Error) throw next;
			return { stdout: next, stderr: "", code: 0, killed: false };
		}) as InputGuardDeps["exec"],
		sleep: async (ms) => {
			sleeps.push(ms);
			clock += ms;
		},
	};
	return { deps, sleeps, timeouts, reads: () => reads };
}

test("waitForEmptyInput polls every 2s, caps at the limit, and returns at once on unknown", async () => {
	const typing = claude("❯ draft");
	const done = reader([typing, typing, claude("❯")]);
	assert.deepEqual(await waitForEmptyInput(done.deps, "w1:p1", 60_000), { state: "empty", waitedMs: 4_000 });
	assert.deepEqual(done.sleeps, [2_000, 2_000]);

	const stuck = reader(Array(10).fill(typing));
	assert.deepEqual(await waitForEmptyInput(stuck.deps, "w1:p1", 5_000), { state: "typing", waitedMs: 5_000 });
	assert.deepEqual(stuck.sleeps, [2_000, 2_000, 1_000]);

	const none = reader([typing]);
	assert.deepEqual(await waitForEmptyInput(none.deps, "w1:p1", 0), { state: "typing", waitedMs: 0 });
	assert.equal(none.sleeps.length, 0);

	const shell = reader(["$ prompt"]);
	assert.deepEqual(await waitForEmptyInput(shell.deps, "w1:p1", 60_000), { state: "unknown", waitedMs: 0 });

	const broken = reader([new Error("spawn failed")]);
	assert.deepEqual(await waitForEmptyInput(broken.deps, "w1:p1", 60_000), { state: "unknown", waitedMs: 0 });
});

test("waitForEmptyInput stops waiting once aborted", async () => {
	const controller = new AbortController();
	const typing = claude("❯ draft");
	const r = reader(Array(10).fill(typing));
	const original = r.deps.sleep!;
	r.deps.sleep = async (ms) => {
		await original(ms);
		controller.abort();
	};
	const result = await waitForEmptyInput(r.deps, "w1:p1", 60_000, controller.signal);
	assert.equal(result.state, "typing");
	assert.equal(r.sleeps.length, 1);
	assert.equal(r.reads(), 1);
});

test("waitForEmptyInput includes read delays and never sleeps beyond the remaining budget", async () => {
	const r = reader(Array(10).fill(claude("❯ draft")), 900);
	assert.deepEqual(await waitForEmptyInput(r.deps, "w1:p1", 5_000), { state: "typing", waitedMs: 5_000 });
	assert.deepEqual(r.sleeps, [2_000, 1_200]);
	assert.equal(r.reads(), 2);

	const emptied = reader([claude("❯ draft"), claude("❯")], 900);
	assert.deepEqual(await waitForEmptyInput(emptied.deps, "w1:p1", 5_000), { state: "empty", waitedMs: 3_800 });
});

test("waitForEmptyInput bounds a read by the remaining time and skips reads after abort", async () => {
	let clock = 0;
	let reads = 0;
	const deps: InputGuardDeps = {
		herdrBin: "herdr",
		now: () => clock,
		exec: async (_command, _args, options) => {
			assertExecTimeout(options?.timeout);
			reads++;
			assert.equal(options?.timeout, 1_000);
			clock += 1_000;
			return { stdout: "", stderr: "", code: 0, killed: true };
		},
	};
	assert.deepEqual(await waitForEmptyInput(deps, "w1:p1", 1_000), { state: "unknown", waitedMs: 1_000 });
	const controller = new AbortController();
	controller.abort();
	assert.deepEqual(await waitForEmptyInput(deps, "w1:p1", 1_000, controller.signal), { state: "unknown", waitedMs: 0 });
	assert.equal(reads, 1);
});

test("readInputState floors fractional exec timeouts and does not read with a sub-ms budget", async () => {
	const r = reader([claude("❯ draft")]);
	assert.equal(await readInputState(r.deps, "w1:p1", undefined, 1_991.141083), "typing");
	assert.deepEqual(r.timeouts, [1_991]);
	for (const exhausted of [0.75, 0, -0.25]) {
		assert.equal(await readInputState(r.deps, "w1:p1", undefined, exhausted), "typing");
	}
	assert.equal(r.reads(), 1);
});

test("fractional elapsed input waits send only integer timeouts and keep the typing verdict", async () => {
	const r = reader(Array(10).fill(claude("❯ draft")), 0.25);
	assert.deepEqual(await waitForEmptyInput(r.deps, "w1:p1", 5_000.75), { state: "typing", waitedMs: 5_000.75 });
	assert.deepEqual(r.timeouts, [3_000, 3_000, 1_000]);
	assert.equal(r.reads(), 3);
});

test("sub-ms input wait budgets refuse without exec or an unknown fallback", async () => {
	const r = reader([claude("❯ draft")]);
	assert.deepEqual(await waitForEmptyInput(r.deps, "w1:p1", 0.75), { state: "typing", waitedMs: 0 });
	assert.equal(r.reads(), 0);
	assert.deepEqual(r.timeouts, []);
});
