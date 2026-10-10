import assert from "node:assert/strict";
import test from "node:test";
import {
	classifyInput,
	inputWaitMs,
	waitForEmptyInput,
	type InputGuardDeps,
} from "../src/input.ts";

const E = "\x1b";
const RULE = "─".repeat(70);

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

test("GJC input box: placeholder, empty, and real text", () => {
	assert.equal(
		classifyInput(gjc(gjcRow(`${E}[38;2;85;112;138mType your message... ⌥Q: Queue (busy) · ⇧⇥: Thinking${E}[0m`))),
		"empty",
	);
	assert.equal(classifyInput(gjc(gjcRow(""))), "empty");
	assert.equal(classifyInput(gjc(gjcRow("안녕 반가워"))), "typing");
	assert.equal(classifyInput(gjc(`${gjcRow("")}\n│ 둘째 줄 │`)), "typing");
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
	assert.equal(classifyInput(`${RULE}\nnot an input row\n${RULE}`), "unknown");
});

test("GJC_HERDR_INPUT_WAIT_SEC defaults to 60s and rejects bad values", () => {
	assert.equal(inputWaitMs({}), 60_000);
	assert.equal(inputWaitMs({ GJC_HERDR_INPUT_WAIT_SEC: "15" }), 15_000);
	assert.equal(inputWaitMs({ GJC_HERDR_INPUT_WAIT_SEC: "0" }), 0);
	assert.equal(inputWaitMs({ GJC_HERDR_INPUT_WAIT_SEC: "-3" }), 60_000);
	assert.equal(inputWaitMs({ GJC_HERDR_INPUT_WAIT_SEC: "abc" }), 60_000);
	assert.equal(inputWaitMs({ GJC_HERDR_INPUT_WAIT_SEC: "99999" }), 600_000);
});

function reader(screens: (string | Error)[]) {
	let reads = 0;
	const sleeps: number[] = [];
	const deps: InputGuardDeps = {
		herdrBin: "herdr",
		exec: (async (_command: string, args: string[]) => {
			assert.deepEqual(args.slice(0, 2), ["pane", "read"]);
			assert(args.includes("ansi") && args.includes("visible"));
			reads++;
			const next = screens.shift() ?? "";
			if (next instanceof Error) throw next;
			return { stdout: next, stderr: "", code: 0, killed: false };
		}) as InputGuardDeps["exec"],
		sleep: async (ms) => void sleeps.push(ms),
	};
	return { deps, sleeps, reads: () => reads };
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
});
