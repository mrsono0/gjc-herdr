import assert from "node:assert/strict";
import test from "node:test";
import { spyOn } from "bun:test";
import type { ExtensionAPI } from "@gajae-code/coding-agent";
import * as zod from "zod/v4";
import herdrMetadata from "../src/extension.ts";
import { isMainSession } from "../src/metadata.ts";

test("isMainSession accepts only main sessions at taskDepth 0", () => {
	assert.equal(
		isMainSession({ sessionMetadata: { kind: "main", taskDepth: 0 } }),
		true,
	);
	for (const sessionMetadata of [
		undefined,
		{ kind: "sub" as const, taskDepth: 0 },
		{ kind: "sub" as const, taskDepth: 1 },
		{ kind: "main" as const, taskDepth: 1 },
	]) {
		assert.equal(isMainSession({ sessionMetadata }), false);
	}
});

test("HC_TERMINAL_ID registers send/call/mail features without hooks, timer, or exec and wires hc backend", async () => {
	const savedEnvironment = {
		GJC_HERDR_DISABLE: process.env.GJC_HERDR_DISABLE,
		GJC_HERDR_MAILBOX: process.env.GJC_HERDR_MAILBOX,
		HERDR_ENV: process.env.HERDR_ENV,
		HERDR_PANE_ID: process.env.HERDR_PANE_ID,
		HC_TERMINAL_ID: process.env.HC_TERMINAL_ID,
		GJC_HERDR_BACKEND: process.env.GJC_HERDR_BACKEND,
		GJC_HERDR_HC_BIN: process.env.GJC_HERDR_HC_BIN,
	};
	delete process.env.GJC_HERDR_DISABLE;
	delete process.env.GJC_HERDR_MAILBOX;
	delete process.env.HERDR_ENV;
	delete process.env.HERDR_PANE_ID;
	delete process.env.GJC_HERDR_BACKEND;
	process.env.GJC_HERDR_HC_BIN = "/custom/hc";
	process.env.HC_TERMINAL_ID = "t1";

	const intervalSpy = spyOn(globalThis, "setInterval");

	let registrations = 0;
	let execs = 0;
	const execCalls: { command: string; args: string[] }[] = [];
	const commands: string[] = [];
	const tools: string[] = [];
	let sendCommandHandler:
		| ((args: string, ctx: unknown) => Promise<void>)
		| undefined;
	let callToolExecute:
		| ((
				toolCallId: string,
				params: { target: string; text: string; result_file?: string },
		  ) => Promise<{
				details: { status: string; error?: { code: string; message: string } };
		  }>)
		| undefined;

	try {
		herdrMetadata({
			logger: { info() {}, warn() {} },
			zod,
			on() {
				registrations++;
			},
			registerCommand(
				name: string,
				options?: { handler?: typeof sendCommandHandler },
			) {
				commands.push(name);
				if (name === "herdr-send") {
					sendCommandHandler = options?.handler;
				}
			},
			registerTool(tool: { name: string; execute?: typeof callToolExecute }) {
				tools.push(tool.name);
				if (tool.name === "herdr_agent_call") {
					callToolExecute = tool.execute;
				}
			},
			exec: async (command: string, args: string[]) => {
				execs++;
				execCalls.push({ command, args });
				if (args[0] === "get") {
					return {
						stdout: JSON.stringify({
							address: args[2],
							state: "live",
							reported: true,
							turn: 4,
							status: { state: "idle", kind: null, msg: "idle" },
						}),
						stderr: "",
						code: 0,
						killed: false,
					};
				}
				return {
					stdout: JSON.stringify({ turn: 4, started: true, status: "working" }),
					stderr: "",
					code: 0,
					killed: false,
				};
			},
		} as unknown as ExtensionAPI);

		assert.equal(registrations, 0);
		assert.equal(intervalSpy.mock.calls.length, 0);
		assert.equal(execs, 0);
		assert.deepEqual(commands, ["herdr-send", "herdr-call"]);
		assert.deepEqual(tools, [
			"herdr_send",
			"herdr_agent_call",
			"herdr_mail_send",
		]);
		assert.equal(process.env.HC_TERMINAL_ID, "t1");
		assert.equal(process.env.HERDR_ENV, undefined);

		// Verify herdr_agent_call was wired to the hc backend (--result-file required, 0 execs)
		assert.ok(callToolExecute);
		const callRes = await callToolExecute!("t-hc-1", {
			target: "t7",
			text: "ping",
		});
		assert.equal(callRes.details.status, "not_sent");
		assert.equal(callRes.details.error?.code, "invalid_request");
		assert.match(
			callRes.details.error?.message ?? "",
			/hc backend requires --result-file/,
		);
		assert.equal(execs, 0);

		// Verify /herdr-send command was wired via extension to the hc backend using custom GJC_HERDR_HC_BIN
		assert.ok(sendCommandHandler);
		await sendCommandHandler!("t7 ping", {
			hasUI: false,
			sessionManager: { getSessionId: () => "session-hc" },
		});
		assert.equal(execs, 2);
		assert.deepEqual(execCalls[0], {
			command: "/custom/hc",
			args: ["get", "--json", "t7"],
		});
		assert.deepEqual(execCalls[1], {
			command: "/custom/hc",
			args: ["send", "--json", "--if", "idle", "t7", "ping"],
		});
	} finally {
		intervalSpy.mockRestore();
		for (const [key, value] of Object.entries(savedEnvironment)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test("without HC_TERMINAL_ID, Herdr env vars do not register send or call and only register mail", () => {
	const savedEnvironment = {
		GJC_HERDR_DISABLE: process.env.GJC_HERDR_DISABLE,
		GJC_HERDR_MAILBOX: process.env.GJC_HERDR_MAILBOX,
		HC_TERMINAL_ID: process.env.HC_TERMINAL_ID,
		HERDR_ENV: process.env.HERDR_ENV,
		HERDR_PANE_ID: process.env.HERDR_PANE_ID,
		GJC_HERDR_BACKEND: process.env.GJC_HERDR_BACKEND,
	};
	delete process.env.GJC_HERDR_DISABLE;
	delete process.env.GJC_HERDR_MAILBOX;
	delete process.env.GJC_HERDR_BACKEND;
	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "wC:p5";

	const intervalSpy = spyOn(globalThis, "setInterval");

	try {
		for (const value of [undefined, "", "   "]) {
			if (value === undefined) delete process.env.HC_TERMINAL_ID;
			else process.env.HC_TERMINAL_ID = value;

			let registrations = 0;
			const commands: string[] = [];
			const tools: string[] = [];
			let execs = 0;

			herdrMetadata({
				logger: { info() {}, warn() {} },
				zod,
				on() {
					registrations++;
				},
				registerCommand(name: string) {
					commands.push(name);
				},
				registerTool(tool: { name: string }) {
					tools.push(tool.name);
				},
				exec: async () => {
					execs++;
					return { stdout: "", stderr: "", code: 0, killed: false };
				},
			} as unknown as ExtensionAPI);

			assert.deepEqual(commands, []);
			assert.deepEqual(tools, ["herdr_mail_send"]);
			assert.equal(registrations, 0);
			assert.equal(execs, 0);
			assert.equal(intervalSpy.mock.calls.length, 0);
		}
	} finally {
		intervalSpy.mockRestore();
		for (const [key, value] of Object.entries(savedEnvironment)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test("GJC_HERDR_DISABLE=1 skips hooks, commands, tools, exec, and timers", () => {
	const savedEnvironment = {
		GJC_HERDR_DISABLE: process.env.GJC_HERDR_DISABLE,
		GJC_HERDR_MAILBOX: process.env.GJC_HERDR_MAILBOX,
		HC_TERMINAL_ID: process.env.HC_TERMINAL_ID,
		HERDR_ENV: process.env.HERDR_ENV,
		HERDR_PANE_ID: process.env.HERDR_PANE_ID,
	};
	process.env.GJC_HERDR_DISABLE = "1";
	process.env.GJC_HERDR_MAILBOX = "gjc-worker";
	process.env.HC_TERMINAL_ID = "t1";
	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "wC:p5";

	const intervalSpy = spyOn(globalThis, "setInterval");

	const infoLogs: string[] = [];
	let registrations = 0;
	const commands: string[] = [];
	const tools: string[] = [];
	let execs = 0;

	try {
		herdrMetadata({
			logger: {
				info(message: string) {
					infoLogs.push(message);
				},
				warn() {},
			},
			zod,
			on() {
				registrations++;
			},
			registerCommand(name: string) {
				commands.push(name);
			},
			registerTool(tool: { name: string }) {
				tools.push(tool.name);
			},
			exec: async () => {
				execs++;
				return { stdout: "", stderr: "", code: 0, killed: false };
			},
		} as unknown as ExtensionAPI);

		assert.deepEqual(infoLogs, [
			"gjc-herdr extension loaded",
			"gjc-herdr disabled by GJC_HERDR_DISABLE=1",
		]);
		assert.equal(registrations, 0);
		assert.deepEqual(commands, []);
		assert.deepEqual(tools, []);
		assert.equal(execs, 0);
		assert.equal(intervalSpy.mock.calls.length, 0);
	} finally {
		intervalSpy.mockRestore();
		for (const [key, value] of Object.entries(savedEnvironment)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test("GJC_HERDR_DISABLE values other than '1' keep normal HC command and tool registration", () => {
	const savedEnvironment = {
		GJC_HERDR_DISABLE: process.env.GJC_HERDR_DISABLE,
		GJC_HERDR_MAILBOX: process.env.GJC_HERDR_MAILBOX,
		HERDR_ENV: process.env.HERDR_ENV,
		HERDR_PANE_ID: process.env.HERDR_PANE_ID,
		HC_TERMINAL_ID: process.env.HC_TERMINAL_ID,
		GJC_HERDR_BACKEND: process.env.GJC_HERDR_BACKEND,
	};
	delete process.env.GJC_HERDR_MAILBOX;
	delete process.env.HERDR_ENV;
	delete process.env.HERDR_PANE_ID;
	delete process.env.GJC_HERDR_BACKEND;
	process.env.HC_TERMINAL_ID = "t1";

	const intervalSpy = spyOn(globalThis, "setInterval");

	try {
		for (const value of ["0", "true", " 1", ""]) {
			process.env.GJC_HERDR_DISABLE = value;
			const infoLogs: string[] = [];
			let registrations = 0;
			const commands: string[] = [];
			const tools: string[] = [];
			let execs = 0;

			herdrMetadata({
				logger: {
					info(message: string) {
						infoLogs.push(message);
					},
					warn() {},
				},
				zod,
				on() {
					registrations++;
				},
				registerCommand(name: string) {
					commands.push(name);
				},
				registerTool(tool: { name: string }) {
					tools.push(tool.name);
				},
				exec: async () => {
					execs++;
					return { stdout: "", stderr: "", code: 0, killed: false };
				},
			} as unknown as ExtensionAPI);

			assert.deepEqual(infoLogs, ["gjc-herdr extension loaded"]);
			assert.equal(registrations, 0);
			assert.equal(intervalSpy.mock.calls.length, 0);
			assert.equal(execs, 0);
			assert.deepEqual(commands, ["herdr-send", "herdr-call"]);
			assert.deepEqual(tools, [
				"herdr_send",
				"herdr_agent_call",
				"herdr_mail_send",
			]);
		}
	} finally {
		intervalSpy.mockRestore();
		for (const [key, value] of Object.entries(savedEnvironment)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test("GJC_HERDR_BACKEND=herdr is ignored both with and without HC_TERMINAL_ID", async () => {
	const savedEnvironment = {
		GJC_HERDR_DISABLE: process.env.GJC_HERDR_DISABLE,
		GJC_HERDR_MAILBOX: process.env.GJC_HERDR_MAILBOX,
		GJC_HERDR_BACKEND: process.env.GJC_HERDR_BACKEND,
		HC_TERMINAL_ID: process.env.HC_TERMINAL_ID,
		HERDR_ENV: process.env.HERDR_ENV,
		HERDR_PANE_ID: process.env.HERDR_PANE_ID,
		GJC_HERDR_HC_BIN: process.env.GJC_HERDR_HC_BIN,
	};
	delete process.env.GJC_HERDR_DISABLE;
	delete process.env.GJC_HERDR_MAILBOX;
	delete process.env.GJC_HERDR_HC_BIN;
	process.env.GJC_HERDR_BACKEND = "herdr";
	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "wC:p5";

	const intervalSpy = spyOn(globalThis, "setInterval");

	try {
		// (a) With HC_TERMINAL_ID: registers send/call/mail on hc backend without warnings
		process.env.HC_TERMINAL_ID = "t1";
		{
			const warnLogs: string[] = [];
			let registrations = 0;
			const commands: string[] = [];
			const tools: string[] = [];
			let execs = 0;
			let callToolExecute:
				| ((
						toolCallId: string,
						params: { target: string; text: string; result_file?: string },
				  ) => Promise<{
						details: { status: string; error?: { code: string; message: string } };
				  }>)
				| undefined;

			herdrMetadata({
				logger: {
					info() {},
					warn(message: string) {
						warnLogs.push(message);
					},
				},
				zod,
				on() {
					registrations++;
				},
				registerCommand(name: string) {
					commands.push(name);
				},
				registerTool(tool: { name: string; execute?: typeof callToolExecute }) {
					tools.push(tool.name);
					if (tool.name === "herdr_agent_call") {
						callToolExecute = tool.execute;
					}
				},
				exec: async () => {
					execs++;
					return { stdout: "", stderr: "", code: 0, killed: false };
				},
			} as unknown as ExtensionAPI);

			assert.deepEqual(commands, ["herdr-send", "herdr-call"]);
			assert.deepEqual(tools, [
				"herdr_send",
				"herdr_agent_call",
				"herdr_mail_send",
			]);
			assert.equal(registrations, 0);
			assert.equal(execs, 0);
			assert.equal(intervalSpy.mock.calls.length, 0);
			assert.deepEqual(warnLogs, []);

			assert.ok(callToolExecute);
			const callRes = await callToolExecute!("t-hc-backend-ignored", {
				target: "t7",
				text: "ping",
			});
			assert.equal(callRes.details.status, "not_sent");
			assert.equal(callRes.details.error?.code, "invalid_request");
			assert.match(
				callRes.details.error?.message ?? "",
				/hc backend requires --result-file/,
			);
			assert.equal(execs, 0);
		}

		// (b) Without HC_TERMINAL_ID: registers only mail even when GJC_HERDR_BACKEND=herdr
		delete process.env.HC_TERMINAL_ID;
		{
			const warnLogs: string[] = [];
			let registrations = 0;
			const commands: string[] = [];
			const tools: string[] = [];
			let execs = 0;

			herdrMetadata({
				logger: {
					info() {},
					warn(message: string) {
						warnLogs.push(message);
					},
				},
				zod,
				on() {
					registrations++;
				},
				registerCommand(name: string) {
					commands.push(name);
				},
				registerTool(tool: { name: string }) {
					tools.push(tool.name);
				},
				exec: async () => {
					execs++;
					return { stdout: "", stderr: "", code: 0, killed: false };
				},
			} as unknown as ExtensionAPI);

			assert.deepEqual(commands, []);
			assert.deepEqual(tools, ["herdr_mail_send"]);
			assert.equal(registrations, 0);
			assert.equal(execs, 0);
			assert.equal(intervalSpy.mock.calls.length, 0);
			assert.deepEqual(warnLogs, []);
		}
	} finally {
		intervalSpy.mockRestore();
		for (const [key, value] of Object.entries(savedEnvironment)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});
