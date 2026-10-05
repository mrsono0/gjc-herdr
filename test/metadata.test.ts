import assert from "node:assert/strict";
import test from "node:test";
import { spyOn } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@gajae-code/coding-agent";
import * as publicHerdr from "@gajae-code/coding-agent/utils/herdr-pane";
import herdrMetadata from "../src/extension.ts";
import {
	createReporter,
	displayValue,
	isMainSession,
	MODEL_KEY,
	reportArgs,
	SESSION_KEY,
} from "../src/metadata.ts";

test("non-Herdr, malformed panes and sub/nested contexts cannot publish", () => {
	assert.equal(
		publicHerdr.resolveHerdrPaneEnvironment({
			env: { HERDR_PANE_ID: "wC:p5" },
		}),
		null,
	);
	for (const pane of ["", "wC:p5;echo bad", "wC:\np5", "x".repeat(129)]) {
		assert.equal(
			publicHerdr.resolveHerdrPaneEnvironment({
				env: { HERDR_ENV: "1", HERDR_PANE_ID: pane },
			}),
			null,
		);
	}
	for (const sessionMetadata of [
		undefined,
		{ kind: "sub" as const, taskDepth: 1 },
		{ kind: "main" as const, taskDepth: 1 },
	]) {
		assert.equal(isMainSession({ sessionMetadata }), false);
	}
});

test("a denied public pane resolver registers no publisher even for a main context", () => {
	const originalHerdrFlag = process.env.HERDR_ENV;
	const admission = spyOn(
		publicHerdr,
		"resolveHerdrPaneEnvironment",
	).mockImplementation((options) => {
		assert.notEqual(options?.env, process.env);
		assert(options?.env);
		options.env.HERDR_ENV = "0";
		return null;
	});
	let registrations = 0;
	try {
		herdrMetadata({
			logger: { info() {} },
			on() {
				registrations++;
			},
		} as unknown as ExtensionAPI);
		assert.equal(registrations, 0);
		assert.equal(process.env.HERDR_ENV, originalHerdrFlag);
	} finally {
		admission.mockRestore();
	}
});

test("display values are bounded Unicode text and missing values clear only plugin keys", () => {
	assert.equal(displayValue("\n \x1b\r"), undefined);
	assert.equal(displayValue("a\x1bb\nc"), "a b c");
	assert.equal(Array.from(displayValue("😀".repeat(81))!).length, 80);
	const args = reportArgs("wC:p5", "gjc-herdr:test", 1, {
		model: "openai/gpt-4o-mini",
	});
	assert(args.includes(`${MODEL_KEY}=openai/gpt-4o-mini`));
	assert.deepEqual(args.slice(-2), ["--clear-token", SESSION_KEY]);
	assert(
		!args.some((value) =>
			["report-agent", "release-agent", "--title", "--display-agent"].includes(
				value,
			),
		),
	);
});

test("one publisher owns a fresh source, increasing sequence and CLI error handling", async () => {
	const calls: string[][] = [];
	let code = 0;
	const exec: ExtensionAPI["exec"] = async (command, args) => {
		assert.equal(command, "/opt/homebrew/bin/herdr");
		calls.push(args);
		return { stdout: "", stderr: "", code, killed: false };
	};
	const report = createReporter(exec, "wC:p5", "/opt/homebrew/bin/herdr");
	await report({ model: "m", session: "s" });
	await report({});
	const option = (args: string[], key: string) => args[args.indexOf(key) + 1];
	assert.match(option(calls[0], "--source"), /^gjc-herdr:/);
	assert.equal(option(calls[0], "--source"), option(calls[1], "--source"));
	assert.equal(option(calls[0], "--seq"), "1");
	assert.equal(option(calls[1], "--seq"), "2");
	assert.deepEqual(calls[1].slice(-4), [
		"--clear-token",
		MODEL_KEY,
		"--clear-token",
		SESSION_KEY,
	]);
	code = 1;
	await assert.rejects(report({ model: "m" }), /exit 1/);
});

test("session events read current values and shutdown clears without changing native state", async () => {
	const savedEnvironment = {
		HERDR_ENV: process.env.HERDR_ENV,
		HERDR_PANE_ID: process.env.HERDR_PANE_ID,
	};
	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "wC:p5";
	const admission = spyOn(
		publicHerdr,
		"resolveHerdrPaneEnvironment",
	).mockReturnValue({
		paneId: "wC:p5",
		binPath: "herdr",
	});
	const handlers = new Map<
		string,
		(event: unknown, ctx: ExtensionContext) => void | Promise<void>
	>();
	const calls: string[][] = [];
	let name: string | undefined = "first";
	let model = { provider: "openai", id: "gpt-4o-mini" };
	const api = {
		logger: { info() {}, warn() {} },
		on(
			event: string,
			handler: (event: unknown, ctx: ExtensionContext) => Promise<void>,
		) {
			handlers.set(event, handler);
		},
		getSessionName: () => name,
		exec: async (_command: string, args: string[]) => {
			calls.push(args);
			return { stdout: "", stderr: "", code: 0, killed: false };
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		sessionMetadata: { kind: "main", taskDepth: 0 },
		get model() {
			return model;
		},
	} as unknown as ExtensionContext;
	try {
		herdrMetadata(api);
		await handlers.get("session_start")!({}, {
			sessionMetadata: { kind: "sub", taskDepth: 1 },
		} as ExtensionContext);
		assert.equal(calls.length, 0);
		await handlers.get("session_start")!({}, ctx);
		assert(calls[0].includes(`${SESSION_KEY}=first`));
		model = { provider: "openai", id: "gpt-4o" };
		name = undefined;
		await handlers.get("agent_end")!({}, ctx);
		assert(calls[1].includes(`${MODEL_KEY}=openai/gpt-4o`));
		assert.deepEqual(calls[1].slice(-2), ["--clear-token", SESSION_KEY]);
		await handlers.get("session_shutdown")!({}, ctx);
		assert.deepEqual(calls[2].slice(-4), [
			"--clear-token",
			MODEL_KEY,
			"--clear-token",
			SESSION_KEY,
		]);
		await handlers.get("agent_start")!({}, ctx);
		assert.equal(calls.length, 3);
	} finally {
		await handlers.get("session_shutdown")?.({}, ctx);
		admission.mockRestore();
		for (const [key, value] of Object.entries(savedEnvironment)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});
