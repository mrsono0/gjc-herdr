import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs/promises";
import test from "node:test";
import type { ExecResult } from "@gajae-code/coding-agent";
import {
	ackMailbox,
	runMailCli,
	sendMailbox,
	watchMailbox,
	type MailCliDeps,
} from "../scripts/mail-cli.ts";
import {
	computeSha256Hex,
	formatMailAck,
	formatMailMessage,
	MAIL_DIR_MODE,
	MAIL_FILE_MODE,
	MAX_MESSAGE_BYTES,
	parseMailAck,
	parseMailMessage,
	type MailDeps,
	type MailFileHandle,
	type MailFs,
	type MailStat,
} from "../src/mail.ts";

const REPO_TOP = "/repo";
const RECIPIENT = "gjc-herdr-lead";
const MAILBOX_ROOT = `${REPO_TOP}/.gjc-herdr/mailbox`;
const RECIPIENT_DIR = `${MAILBOX_ROOT}/${RECIPIENT}`;
const ID_1 = "01JC9W2K8Q8Z6Y3V4N5M7P0R1S";
const ID_2 = "01JC9W2K8Q8Z6Y3V4N5M7P0R1T";
const ID_3 = "01JC9W2K8Q8Z6Y3V4N5M7P0R1V";
const FIXED_TIME = "2026-10-17T04:00:00.000Z";
const FIXED_MS = Date.parse(FIXED_TIME);

interface FakeNode {
	kind: "file" | "dir" | "symlink" | "fifo";
	mode: number;
	bytes: Uint8Array;
	realPath?: string;
}

function makeMessageBytes(
	id = ID_1,
	body = "보고 본문입니다.\n",
	to = RECIPIENT,
): { bytes: Uint8Array; bodySha256: string } {
	const formatted = formatMailMessage({
		id,
		from: "gjc-herdr-mate",
		to,
		created: FIXED_TIME,
		subject: "작업 완료 보고",
		body,
	});
	assert.equal(formatted.ok, true);
	return {
		bytes: formatted.value.bytes,
		bodySha256: formatted.value.message.bodySha256,
	};
}

function makeAckBytes(input: {
	id?: string;
	by?: string;
	at?: string;
	state: "received" | "rejected" | "uncertain";
	via?: "observed" | "manual";
	bodySha256?: string;
	reason?: string;
}): Uint8Array {
	const formatted = formatMailAck({
		id: input.id ?? ID_1,
		by: input.by ?? RECIPIENT,
		at: input.at ?? FIXED_TIME,
		state: input.state,
		via: input.via ?? "observed",
		...(input.bodySha256 !== undefined
			? { bodySha256: input.bodySha256 }
			: {}),
		...(input.reason !== undefined ? { reason: input.reason } : {}),
	});
	assert.equal(formatted.ok, true);
	return new TextEncoder().encode(formatted.value);
}

function createFakeCliEnv(options?: {
	createRecipientDir?: boolean;
	gitHandler?: (args: string[]) => Partial<ExecResult> | Error | undefined;
	openHook?: (path: string, flags: number, mode?: number) => void;
	renameHook?: (oldPath: string, newPath: string) => void;
	unlinkHook?: (path: string) => void;
	onSleep?: (stepIndex: number, ms: number) => void;
}) {
	const nodes = new Map<string, FakeNode>();
	nodes.set(REPO_TOP, {
		kind: "dir",
		mode: MAIL_DIR_MODE,
		bytes: new Uint8Array(0),
	});
	if (options?.createRecipientDir !== false) {
		nodes.set(`${REPO_TOP}/.gjc-herdr`, {
			kind: "dir",
			mode: MAIL_DIR_MODE,
			bytes: new Uint8Array(0),
		});
		nodes.set(MAILBOX_ROOT, {
			kind: "dir",
			mode: MAIL_DIR_MODE,
			bytes: new Uint8Array(0),
		});
		nodes.set(RECIPIENT_DIR, {
			kind: "dir",
			mode: MAIL_DIR_MODE,
			bytes: new Uint8Array(0),
		});
	}

	const fsOpsLog: string[] = [];
	const writeCalls: string[] = [];
	const gitCalls: string[][] = [];
	const sleepCalls: number[] = [];
	const stderrWrites: string[] = [];
	let currentNowMs = FIXED_MS;

	const makeErr = (code: string, message: string): Error =>
		Object.assign(new Error(`${code}: ${message}`), { code });

	const statFor = (node: FakeNode): MailStat => ({
		isFile: () => node.kind === "file",
		isDirectory: () => node.kind === "dir",
		isSymbolicLink: () => node.kind === "symlink",
		mode: node.mode,
		size: node.bytes.byteLength,
	});

	const fs: MailFs = {
		async lstat(path: string): Promise<MailStat> {
			fsOpsLog.push(`lstat:${path}`);
			const node = nodes.get(path);
			if (!node) throw makeErr("ENOENT", path);
			return statFor(node);
		},
		async realpath(path: string): Promise<string> {
			fsOpsLog.push(`realpath:${path}`);
			const node = nodes.get(path);
			if (!node) throw makeErr("ENOENT", path);
			return node.realPath ?? path;
		},
		async mkdir(path: string, opts?: { mode?: number }): Promise<void> {
			fsOpsLog.push(`mkdir:${path}`);
			writeCalls.push(`mkdir:${path}`);
			if (nodes.has(path)) throw makeErr("EEXIST", path);
			nodes.set(path, {
				kind: "dir",
				mode: opts?.mode ?? MAIL_DIR_MODE,
				bytes: new Uint8Array(0),
			});
		},
		async readdir(path: string): Promise<string[]> {
			fsOpsLog.push(`readdir:${path}`);
			const dirNode = nodes.get(path);
			if (!dirNode) throw makeErr("ENOENT", path);
			if (dirNode.kind !== "dir") throw makeErr("ENOTDIR", path);
			const prefix = `${path}/`;
			const entries: string[] = [];
			for (const key of nodes.keys()) {
				if (key.startsWith(prefix)) {
					const rest = key.slice(prefix.length);
					if (rest && !rest.includes("/")) {
						entries.push(rest);
					}
				}
			}
			return entries;
		},
		async open(
			path: string,
			flags: number,
			mode?: number,
		): Promise<MailFileHandle> {
			fsOpsLog.push(`open:${path}:${flags}`);
			options?.openHook?.(path, flags, mode);
			const isCreate = (flags & fsConstants.O_CREAT) !== 0;
			const isExcl = (flags & fsConstants.O_EXCL) !== 0;
			const isWrite = (flags & fsConstants.O_WRONLY) !== 0;
			const isNoFollow = (flags & (fsConstants.O_NOFOLLOW ?? 0)) !== 0;
			if (isCreate || isWrite) {
				writeCalls.push(`open_write:${path}`);
			}

			const existing = nodes.get(path);
			if (existing?.kind === "symlink" && isNoFollow) {
				throw makeErr("ELOOP", path);
			}
			if (isCreate && isExcl && existing) {
				throw makeErr("EEXIST", path);
			}
			let node = existing;
			if (!node) {
				if (!isCreate) throw makeErr("ENOENT", path);
				node = {
					kind: "file",
					mode: mode ?? MAIL_FILE_MODE,
					bytes: new Uint8Array(0),
				};
				nodes.set(path, node);
			}

			return {
				async stat(): Promise<MailStat> {
					fsOpsLog.push(`fstat:${path}`);
					return statFor(node!);
				},
				async read(buffer, offset, length, position) {
					const pos = position ?? 0;
					const avail = Math.max(0, node!.bytes.byteLength - pos);
					const count = Math.min(length, avail);
					if (count > 0) {
						buffer.set(node!.bytes.subarray(pos, pos + count), offset);
					}
					return { bytesRead: count, buffer };
				},
				async write(buffer, offset = 0, length = buffer.byteLength, position) {
					writeCalls.push(`write:${path}`);
					const slice = buffer.subarray(offset, offset + length);
					const pos = position ?? node!.bytes.byteLength;
					const next = new Uint8Array(
						Math.max(node!.bytes.byteLength, pos + slice.byteLength),
					);
					next.set(node!.bytes, 0);
					next.set(slice, pos);
					node!.bytes = next;
					return { bytesWritten: slice.byteLength };
				},
				async sync(): Promise<void> {
					fsOpsLog.push(`sync:${path}`);
					writeCalls.push(`sync:${path}`);
				},
				async close(): Promise<void> {
					fsOpsLog.push(`close:${path}`);
				},
			};
		},
		async link(existingPath: string, newPath: string): Promise<void> {
			fsOpsLog.push(`link:${existingPath}->${newPath}`);
			writeCalls.push(`link:${existingPath}->${newPath}`);
			const src = nodes.get(existingPath);
			if (!src) throw makeErr("ENOENT", existingPath);
			if (nodes.has(newPath)) throw makeErr("EEXIST", newPath);
			nodes.set(newPath, {
				kind: src.kind,
				mode: src.mode,
				bytes: new Uint8Array(src.bytes),
			});
		},
		async rename(oldPath: string, newPath: string): Promise<void> {
			fsOpsLog.push(`rename:${oldPath}->${newPath}`);
			writeCalls.push(`rename:${oldPath}->${newPath}`);
			options?.renameHook?.(oldPath, newPath);
			const src = nodes.get(oldPath);
			if (!src) throw makeErr("ENOENT", oldPath);
			nodes.set(newPath, {
				kind: src.kind,
				mode: src.mode,
				bytes: new Uint8Array(src.bytes),
			});
			nodes.delete(oldPath);
		},
		async unlink(path: string): Promise<void> {
			fsOpsLog.push(`unlink:${path}`);
			writeCalls.push(`unlink:${path}`);
			options?.unlinkHook?.(path);
			if (!nodes.has(path)) throw makeErr("ENOENT", path);
			nodes.delete(path);
		},
	};

	const exec: MailDeps["exec"] = async (command, args) => {
		assert.equal(command, "git");
		gitCalls.push(args);
		if (options?.gitHandler) {
			const custom = options.gitHandler(args);
			if (custom instanceof Error) throw custom;
			if (custom !== undefined) {
				return { stdout: "", stderr: "", code: 0, killed: false, ...custom };
			}
		}
		if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
			return { stdout: `${REPO_TOP}\n`, stderr: "", code: 0, killed: false };
		}
		if (args[0] === "-C" && args[2] === "ls-files") {
			return { stdout: "", stderr: "", code: 0, killed: false };
		}
		if (args[0] === "-C" && args[2] === "check-ignore") {
			return { stdout: "", stderr: "", code: 0, killed: false };
		}
		return { stdout: "", stderr: "unexpected git call", code: 1, killed: false };
	};

	const deps: MailCliDeps = {
		exec,
		fs,
		now: () => currentNowMs,
		sleep: async (ms) => {
			const idx = sleepCalls.length;
			sleepCalls.push(ms);
			currentNowMs += ms;
			options?.onSleep?.(idx, ms);
		},
		randomBytes: (target) => {
			target.fill(0xab);
			return target;
		},
		writeStderr: (text) => {
			stderrWrites.push(text);
		},
	};

	return {
		nodes,
		fsOpsLog,
		writeCalls,
		gitCalls,
		sleepCalls,
		stderrWrites,
		deps,
		advanceClock(ms: number) {
			currentNowMs += ms;
		},
		setFile(
			path: string,
			bytes: Uint8Array | string,
			kind: FakeNode["kind"] = "file",
			realPath?: string,
		) {
			nodes.set(path, {
				kind,
				mode: kind === "dir" ? MAIL_DIR_MODE : MAIL_FILE_MODE,
				bytes:
					typeof bytes === "string"
						? new TextEncoder().encode(bytes)
						: bytes,
				...(realPath ? { realPath } : {}),
			});
		},
	};
}

test("watch: message without ack and message with uncertain ack are reported as pending in ULID ascending order with zero write calls", async () => {
	const env = createFakeCliEnv();
	const msg2 = makeMessageBytes(ID_2, "두 번째 메시지\n");
	const msg1 = makeMessageBytes(ID_1, "첫 번째 메시지\n");
	env.setFile(`${RECIPIENT_DIR}/${ID_2}.md`, msg2.bytes);
	env.setFile(`${RECIPIENT_DIR}/${ID_1}.md`, msg1.bytes);
	env.setFile(
		`${RECIPIENT_DIR}/${ID_2}.ack`,
		makeAckBytes({
			id: ID_2,
			state: "uncertain",
			reason: "unobserved_twice",
		}),
	);
	// Dot-files (temp or lock) must be ignored.
	env.setFile(`${RECIPIENT_DIR}/.consumer.lock`, "pid: 123\ntoken: " + "a".repeat(32) + "\nat: " + FIXED_TIME + "\n");

	const res = await watchMailbox([RECIPIENT, "--timeout", "0"], env.deps);
	assert.equal(res.exitCode, 0);
	assert.equal(
		res.stdout,
		`${RECIPIENT_DIR}/${ID_1}.md\n${RECIPIENT_DIR}/${ID_2}.md\n`,
	);
	assert.equal(res.stderr, "");
	assert.deepEqual(env.stderrWrites, [
		`mail-watch: root=${MAILBOX_ROOT} recipient=${RECIPIENT} timeout=0\n`,
	]);
	assert.deepEqual(env.writeCalls, []);
});

test("watch: messages with valid terminal ack (received or rejected, even with invalid message format) are treated as done", async () => {
	const env = createFakeCliEnv();
	const msg1 = makeMessageBytes(ID_1, "이미 받은 메시지\n");
	env.setFile(`${RECIPIENT_DIR}/${ID_1}.md`, msg1.bytes);
	env.setFile(
		`${RECIPIENT_DIR}/${ID_1}.ack`,
		makeAckBytes({
			id: ID_1,
			state: "received",
			bodySha256: "f".repeat(64), // watch does not compare hash against message (§3.3 / §6)
		}),
	);

	// ID_2 has invalid message format, but a valid 'rejected' terminal ack -> done!
	env.setFile(`${RECIPIENT_DIR}/${ID_2}.md`, "not a valid frontmatter message");
	env.setFile(
		`${RECIPIENT_DIR}/${ID_2}.ack`,
		makeAckBytes({
			id: ID_2,
			state: "rejected",
			reason: "invalid_header",
		}),
	);

	// ID_3 has no ack -> pending
	const msg3 = makeMessageBytes(ID_3, "새 우편\n");
	env.setFile(`${RECIPIENT_DIR}/${ID_3}.md`, msg3.bytes);

	const res = await watchMailbox([RECIPIENT, "--timeout", "0"], env.deps);
	assert.equal(res.exitCode, 0);
	assert.equal(res.stdout, `${RECIPIENT_DIR}/${ID_3}.md\n`);
	assert.equal(res.stderr, "");
	assert.deepEqual(env.stderrWrites, [
		`mail-watch: root=${MAILBOX_ROOT} recipient=${RECIPIENT} timeout=0\n`,
	]);
	assert.deepEqual(env.writeCalls, []);
});

test("watch: malformed ack or symlink ack exits with code 1 and writes diagnostic to stderr", async () => {
	// 1. Malformed ack (empty/fake ack)
	const env1 = createFakeCliEnv();
	env1.setFile(`${RECIPIENT_DIR}/${ID_1}.md`, makeMessageBytes(ID_1).bytes);
	env1.setFile(`${RECIPIENT_DIR}/${ID_1}.ack`, "");

	const res1 = await watchMailbox([RECIPIENT, "--timeout", "0"], env1.deps);
	assert.equal(res1.exitCode, 1);
	assert.equal(res1.stdout, "");
	assert.match(res1.stderr, /mail-watch error \[missing_trailing_lf\]/);
	assert.deepEqual(env1.writeCalls, []);

	// 2. Symlink ack
	const env2 = createFakeCliEnv();
	env2.setFile(`${RECIPIENT_DIR}/${ID_1}.md`, makeMessageBytes(ID_1).bytes);
	env2.setFile(
		`${RECIPIENT_DIR}/${ID_1}.ack`,
		makeAckBytes({ id: ID_1, state: "received", bodySha256: "a".repeat(64) }),
		"symlink",
	);

	const res2 = await watchMailbox([RECIPIENT, "--timeout", "0"], env2.deps);
	assert.equal(res2.exitCode, 1);
	assert.equal(res2.stdout, "");
	assert.match(res2.stderr, /mail-watch error \[symlink_rejected\]/);
	assert.deepEqual(env2.writeCalls, []);
});

test("watch: invalid-format regular message file without terminal ack is pending and emits reason on stderr", async () => {
	const env = createFakeCliEnv();
	env.setFile(`${RECIPIENT_DIR}/${ID_1}.md`, "broken frontmatter\n");

	const res = await watchMailbox([RECIPIENT, "--timeout", "0"], env.deps);
	assert.equal(res.exitCode, 0);
	assert.equal(res.stdout, `${RECIPIENT_DIR}/${ID_1}.md\n`);
	assert.match(res.stderr, /mail-watch warning \[invalid_header\]/);
	assert.deepEqual(env.writeCalls, []);
});

test("watch: symlink message file exits with code 1 and writes diagnostic to stderr", async () => {
	const env = createFakeCliEnv();
	env.setFile(
		`${RECIPIENT_DIR}/${ID_1}.md`,
		makeMessageBytes(ID_1).bytes,
		"symlink",
	);

	const res = await watchMailbox([RECIPIENT, "--timeout", "0"], env.deps);
	assert.equal(res.exitCode, 1);
	assert.equal(res.stdout, "");
	assert.match(res.stderr, /mail-watch error \[symlink_rejected\]/);
	assert.deepEqual(env.writeCalls, []);
});

test("watch: missing mailbox directories (ENOENT) do not create folders and exit with code 2 on --timeout 0", async () => {
	const env = createFakeCliEnv({ createRecipientDir: false });

	const res = await watchMailbox([RECIPIENT, "--timeout", "0"], env.deps);
	assert.equal(res.exitCode, 2);
	assert.equal(res.stdout, "");
	assert.equal(res.stderr, "");
	assert.deepEqual(env.stderrWrites, [
		`mail-watch: root=${MAILBOX_ROOT} recipient=${RECIPIENT} timeout=0\n`,
	]);
	assert.equal(env.nodes.has(`${REPO_TOP}/.gjc-herdr`), false);
	assert.deepEqual(env.writeCalls, []);
});

test("watch: boundary violations (tracked files, not ignored, symlink dir, outside repo, git failure) exit with code 1", async () => {
	// Tracked files
	const envTracked = createFakeCliEnv({
		gitHandler(args) {
			if (args[2] === "ls-files") {
				return { stdout: ".gjc-herdr/mailbox/leaked.md\n", code: 0 };
			}
			return undefined;
		},
	});
	const resTracked = await watchMailbox(
		[RECIPIENT, "--timeout", "0"],
		envTracked.deps,
	);
	assert.equal(resTracked.exitCode, 1);
	assert.match(resTracked.stderr, /tracked_files/);

	// Not ignored
	const envNotIgnored = createFakeCliEnv({
		gitHandler(args) {
			if (args[2] === "check-ignore") {
				return { stdout: "", stderr: "", code: 1 };
			}
			return undefined;
		},
	});
	const resNotIgnored = await watchMailbox(
		[RECIPIENT, "--timeout", "0"],
		envNotIgnored.deps,
	);
	assert.equal(resNotIgnored.exitCode, 1);
	assert.match(resNotIgnored.stderr, /not_ignored/);

	// Symlink directory element
	const envSymlinkDir = createFakeCliEnv();
	envSymlinkDir.nodes.set(RECIPIENT_DIR, {
		kind: "symlink",
		mode: MAIL_DIR_MODE,
		bytes: new Uint8Array(0),
	});
	const resSymlinkDir = await watchMailbox(
		[RECIPIENT, "--timeout", "0"],
		envSymlinkDir.deps,
	);
	assert.equal(resSymlinkDir.exitCode, 1);
	assert.match(resSymlinkDir.stderr, /symlink_rejected/);

	// Realpath outside repo
	const envOutside = createFakeCliEnv();
	envOutside.nodes.set(RECIPIENT_DIR, {
		kind: "dir",
		mode: MAIL_DIR_MODE,
		bytes: new Uint8Array(0),
		realPath: "/tmp/escaped-mailbox",
	});
	const resOutside = await watchMailbox(
		[RECIPIENT, "--timeout", "0"],
		envOutside.deps,
	);
	assert.equal(resOutside.exitCode, 1);
	assert.match(resOutside.stderr, /outside_repo/);

	// Git failure
	const envGitFail = createFakeCliEnv({
		gitHandler(args) {
			if (args[0] === "rev-parse") {
				return { stdout: "", stderr: "fatal: not a git repository\n", code: 128 };
			}
			return undefined;
		},
	});
	const resGitFail = await watchMailbox(
		[RECIPIENT, "--timeout", "0"],
		envGitFail.deps,
	);
	assert.equal(resGitFail.exitCode, 1);
	assert.match(resGitFail.stderr, /git_failed/);
});

test("watch: polls at 1-second intervals until new mail arrives (exit 0) or timeout expires (exit 2), and warns once if entries > 1000", async () => {
	// 1. New mail arrives on the 2nd poll after 1 second sleep
	const envArrive = createFakeCliEnv({
		onSleep(stepIndex) {
			if (stepIndex === 0) {
				envArrive.setFile(
					`${RECIPIENT_DIR}/${ID_1}.md`,
					makeMessageBytes(ID_1).bytes,
				);
			}
		},
	});
	const resArrive = await watchMailbox(
		[RECIPIENT, "--timeout", "3"],
		envArrive.deps,
	);
	assert.equal(resArrive.exitCode, 0);
	assert.equal(resArrive.stdout, `${RECIPIENT_DIR}/${ID_1}.md\n`);
	assert.deepEqual(envArrive.sleepCalls, [1_000]);
	assert.deepEqual(envArrive.writeCalls, []);

	// 2. Timeout reached with > 1000 non-pending entries: warns once and exits 2
	const envTimeout = createFakeCliEnv();
	for (let i = 0; i < 1_001; i++) {
		envTimeout.setFile(`${RECIPIENT_DIR}/.tmp-${i}`, "x");
	}
	const resTimeout = await watchMailbox(
		[RECIPIENT, "--timeout", "2"],
		envTimeout.deps,
	);
	assert.equal(resTimeout.exitCode, 2);
	assert.equal(resTimeout.stdout, "");
	assert.deepEqual(envTimeout.sleepCalls, [1_000, 1_000]);
	const warnMatches = resTimeout.stderr.match(/mailbox_file_limit/g) ?? [];
	assert.equal(warnMatches.length, 1);
	assert.deepEqual(envTimeout.writeCalls, []);
});

test("watch (F1 & F2): accounts for slow git and file read time in deadline without extra sleep/scan, and emits startup root/recipient line to stderr once", async () => {
	// 1. F1: Each git call takes 2000ms and ack read takes 100ms (total >8000ms in first scan).
	// With --timeout 1, watch must exit 2 immediately after the first scan (0 sleeps, 4 git calls).
	const envSlow = createFakeCliEnv({
		gitHandler() {
			envSlow.advanceClock(2_000);
			return undefined;
		},
		openHook() {
			envSlow.advanceClock(100);
		},
	});
	const doneMsg = makeMessageBytes(ID_1);
	envSlow.setFile(`${RECIPIENT_DIR}/${ID_1}.md`, doneMsg.bytes);
	envSlow.setFile(
		`${RECIPIENT_DIR}/${ID_1}.ack`,
		makeAckBytes({
			id: ID_1,
			state: "received",
			bodySha256: doneMsg.bodySha256,
		}),
	);

	const resSlow = await watchMailbox(
		[RECIPIENT, "--timeout", "1"],
		envSlow.deps,
	);
	assert.equal(resSlow.exitCode, 2);
	assert.equal(resSlow.stdout, "");
	assert.deepEqual(envSlow.sleepCalls, []);
	assert.equal(envSlow.gitCalls.length, 4);
	assert.equal(resSlow.stderr, "");
	assert.deepEqual(envSlow.stderrWrites, [
		`mail-watch: root=${MAILBOX_ROOT} recipient=${RECIPIENT} timeout=1\n`,
	]);

	// 2. F1 + F2: Each git call takes 100ms (400ms per scan) with --timeout 1 (1000ms).
	// First scan leaves 600ms -> sleep is min(1000, 600) = 600ms -> second scan (+400ms) exhausts deadline -> exit 2.
	// Startup banner is emitted only once across multiple scans, and stdout stays empty.
	const envPartial = createFakeCliEnv({
		createRecipientDir: false,
		gitHandler() {
			envPartial.advanceClock(100);
			return undefined;
		},
	});
	const resPartial = await watchMailbox(
		[RECIPIENT, "--timeout", "1"],
		envPartial.deps,
	);
	assert.equal(resPartial.exitCode, 2);
	assert.equal(resPartial.stdout, "");
	assert.deepEqual(envPartial.sleepCalls, [600]);
	assert.equal(envPartial.gitCalls.length, 8);
	assert.equal(resPartial.stderr, "");
	assert.deepEqual(envPartial.stderrWrites, [
		`mail-watch: root=${MAILBOX_ROOT} recipient=${RECIPIENT} timeout=1\n`,
	]);
});

test("watch (F2): writes startup root/recipient line via writeStderr immediately before first sleep and does not duplicate it in returned stderr", async () => {
	const expectedBanner = `mail-watch: root=${MAILBOX_ROOT} recipient=${RECIPIENT} timeout=1800\n`;
	let writesObservedDuringFirstSleep: string[] = [];
	let writesObservedDuringSecondSleep: string[] = [];

	const env = createFakeCliEnv({
		onSleep(stepIndex) {
			if (stepIndex === 0) {
				writesObservedDuringFirstSleep = [...env.stderrWrites];
			} else if (stepIndex === 1) {
				writesObservedDuringSecondSleep = [...env.stderrWrites];
				// Deliver an invalid-format regular message file so watch finishes with a returned warning on stderr.
				env.setFile(`${RECIPIENT_DIR}/${ID_1}.md`, "broken frontmatter\n");
			}
		},
	});

	// Default timeout (1800s) watch
	const res = await watchMailbox([RECIPIENT], env.deps);

	// 1. Live writeStderr had already received the startup banner during the very first sleep (while still waiting).
	assert.deepEqual(writesObservedDuringFirstSleep, [expectedBanner]);
	// 2. Subsequent polling iteration did not emit the startup banner again.
	assert.deepEqual(writesObservedDuringSecondSleep, [expectedBanner]);
	assert.deepEqual(env.stderrWrites, [expectedBanner]);

	// 3. Returned stderr contains the pending-file warning, but does NOT duplicate the startup banner.
	assert.equal(res.exitCode, 0);
	assert.equal(res.stdout, `${RECIPIENT_DIR}/${ID_1}.md\n`);
	assert.match(res.stderr, /mail-watch warning \[invalid_header\]/);
	assert.doesNotMatch(res.stderr, /^mail-watch: root=/m);

	// 4. Combined process stderr (live writes + final returned stderr) contains the startup banner exactly once.
	const combinedStderr = env.stderrWrites.join("") + res.stderr;
	const bannerMatches = combinedStderr.match(/^mail-watch: root=.*$/gm) ?? [];
	assert.deepEqual(bannerMatches, [expectedBanner.trimEnd()]);
});

test("ack: creates new received ack (computing body_sha256 from verified message) and new rejected ack (requiring reason)", async () => {
	// 1. New received ack
	const envRec = createFakeCliEnv();
	const msg1 = makeMessageBytes(ID_1, "수신 확인할 본문\n");
	envRec.setFile(`${RECIPIENT_DIR}/${ID_1}.md`, msg1.bytes);

	const resRec = await ackMailbox([RECIPIENT, ID_1, "received"], envRec.deps);
	assert.equal(resRec.exitCode, 0);
	assert.equal(resRec.stdout, `${RECIPIENT_DIR}/${ID_1}.ack\n`);
	assert.equal(resRec.stderr, "");
	const ackNode1 = envRec.nodes.get(`${RECIPIENT_DIR}/${ID_1}.ack`);
	assert.ok(ackNode1);
	const parsed1 = parseMailAck(ackNode1.bytes, {
		expectedId: ID_1,
		expectedBy: RECIPIENT,
		expectedBodySha256: msg1.bodySha256,
	});
	assert.equal(parsed1.ok, true);
	if (parsed1.ok) {
		assert.equal(parsed1.value.state, "received");
		assert.equal(parsed1.value.via, "manual");
		assert.equal(parsed1.value.bodySha256, msg1.bodySha256);
	}

	// 2. New rejected ack
	const envRej = createFakeCliEnv();
	envRej.setFile(`${RECIPIENT_DIR}/${ID_2}.md`, makeMessageBytes(ID_2).bytes);

	const resRej = await ackMailbox(
		[RECIPIENT, ID_2, "rejected", "형식 또는 범위 위반"],
		envRej.deps,
	);
	assert.equal(resRej.exitCode, 0);
	assert.equal(resRej.stdout, `${RECIPIENT_DIR}/${ID_2}.ack\n`);
	const ackNode2 = envRej.nodes.get(`${RECIPIENT_DIR}/${ID_2}.ack`);
	assert.ok(ackNode2);
	const parsed2 = parseMailAck(ackNode2.bytes, {
		expectedId: ID_2,
		expectedBy: RECIPIENT,
	});
	assert.equal(parsed2.ok, true);
	if (parsed2.ok) {
		assert.equal(parsed2.value.state, "rejected");
		assert.equal(parsed2.value.via, "manual");
		assert.equal(parsed2.value.reason, "형식 또는 범위 위반");
	}
});

test("ack: idempotent on same valid terminal state (preserving existing via) and rejects received when existing ack body_sha256 mismatches message", async () => {
	const env = createFakeCliEnv();
	const msg1 = makeMessageBytes(ID_1, "정상 본문\n");
	env.setFile(`${RECIPIENT_DIR}/${ID_1}.md`, msg1.bytes);
	const observedAckBytes = makeAckBytes({
		id: ID_1,
		state: "received",
		via: "observed",
		bodySha256: msg1.bodySha256,
	});
	env.setFile(`${RECIPIENT_DIR}/${ID_1}.ack`, observedAckBytes);

	// Re-requesting received succeeds and keeps via: observed without writing
	const resSame = await ackMailbox([RECIPIENT, ID_1, "received"], env.deps);
	assert.equal(resSame.exitCode, 0);
	assert.equal(resSame.stdout, `${RECIPIENT_DIR}/${ID_1}.ack\n`);
	assert.deepEqual(env.writeCalls, []);
	const afterSame = parseMailAck(
		env.nodes.get(`${RECIPIENT_DIR}/${ID_1}.ack`)!.bytes,
	);
	assert.equal(afterSame.ok, true);
	if (afterSame.ok) {
		assert.equal(afterSame.value.via, "observed");
	}

	// If existing received ack has a mismatched body_sha256, re-requesting received fails with exit 1
	env.setFile(
		`${RECIPIENT_DIR}/${ID_1}.ack`,
		makeAckBytes({
			id: ID_1,
			state: "received",
			via: "observed",
			bodySha256: computeSha256Hex(new TextEncoder().encode("다른 본문")),
		}),
	);
	const resMismatch = await ackMailbox(
		[RECIPIENT, ID_1, "received"],
		env.deps,
	);
	assert.equal(resMismatch.exitCode, 1);
	assert.equal(resMismatch.stdout, "");
	assert.match(resMismatch.stderr, /sha256_mismatch/);
});

test("ack: rejects conflicting terminal state and replaces uncertain ack via rename after pre-rename recheck", async () => {
	// 1. Conflicting terminal state (existing rejected -> requested received, and vice versa)
	const envConflict = createFakeCliEnv();
	const msg1 = makeMessageBytes(ID_1);
	envConflict.setFile(`${RECIPIENT_DIR}/${ID_1}.md`, msg1.bytes);
	envConflict.setFile(
		`${RECIPIENT_DIR}/${ID_1}.ack`,
		makeAckBytes({
			id: ID_1,
			state: "rejected",
			via: "manual",
			reason: "bad_format",
		}),
	);

	const resConflict = await ackMailbox(
		[RECIPIENT, ID_1, "received"],
		envConflict.deps,
	);
	assert.equal(resConflict.exitCode, 1);
	assert.match(resConflict.stderr, /ack_state_conflict/);
	assert.deepEqual(envConflict.writeCalls, []);

	// 2. Existing uncertain ack -> replaced via rename with via: manual
	const envUncertain = createFakeCliEnv();
	envUncertain.setFile(`${RECIPIENT_DIR}/${ID_1}.md`, msg1.bytes);
	envUncertain.setFile(
		`${RECIPIENT_DIR}/${ID_1}.ack`,
		makeAckBytes({
			id: ID_1,
			state: "uncertain",
			via: "observed",
			reason: "unobserved_twice",
		}),
	);

	const resReplace = await ackMailbox(
		[RECIPIENT, ID_1, "received"],
		envUncertain.deps,
	);
	assert.equal(resReplace.exitCode, 0);
	assert.equal(resReplace.stdout, `${RECIPIENT_DIR}/${ID_1}.ack\n`);
	assert.ok(
		envUncertain.writeCalls.some((entry) => entry.startsWith("rename:")),
	);
	assert.equal(
		envUncertain.writeCalls.some((entry) => entry.startsWith("link:")),
		false,
	);
	const replacedAck = parseMailAck(
		envUncertain.nodes.get(`${RECIPIENT_DIR}/${ID_1}.ack`)!.bytes,
	);
	assert.equal(replacedAck.ok, true);
	if (replacedAck.ok) {
		assert.equal(replacedAck.value.state, "received");
		assert.equal(replacedAck.value.via, "manual");
		assert.equal(replacedAck.value.bodySha256, msg1.bodySha256);
	}
});

test("ack: aborts uncertain replacement if pre-rename recheck finds ack changed or malformed, and rejects malformed or symlink ack", async () => {
	// 1. Pre-rename recheck failure: ack changes from uncertain to rejected while temp file is being created
	let ackReadCount = 0;
	const envRace = createFakeCliEnv({
		openHook(path) {
			if (path === `${RECIPIENT_DIR}/${ID_1}.ack`) {
				ackReadCount += 1;
				if (ackReadCount === 2) {
					envRace.setFile(
						`${RECIPIENT_DIR}/${ID_1}.ack`,
						makeAckBytes({
							id: ID_1,
							state: "rejected",
							via: "manual",
							reason: "concurrent_reject",
						}),
					);
				}
			}
		},
	});
	const msg1 = makeMessageBytes(ID_1);
	envRace.setFile(`${RECIPIENT_DIR}/${ID_1}.md`, msg1.bytes);
	envRace.setFile(
		`${RECIPIENT_DIR}/${ID_1}.ack`,
		makeAckBytes({
			id: ID_1,
			state: "uncertain",
			via: "observed",
			reason: "crash_recovery",
		}),
	);

	const resRace = await ackMailbox(
		[RECIPIENT, ID_1, "received"],
		envRace.deps,
	);
	assert.equal(resRace.exitCode, 1);
	assert.match(resRace.stderr, /ack_not_uncertain/);
	assert.equal(
		envRace.writeCalls.some((entry) => entry.startsWith("rename:")),
		false,
	);

	// 2. Malformed existing ack
	const envBadAck = createFakeCliEnv();
	envBadAck.setFile(`${RECIPIENT_DIR}/${ID_1}.md`, msg1.bytes);
	envBadAck.setFile(`${RECIPIENT_DIR}/${ID_1}.ack`, "corrupted ack\n");
	const resBadAck = await ackMailbox(
		[RECIPIENT, ID_1, "received"],
		envBadAck.deps,
	);
	assert.equal(resBadAck.exitCode, 1);
	assert.match(resBadAck.stderr, /invalid_line/);

	// 3. Symlink existing ack
	const envSymAck = createFakeCliEnv();
	envSymAck.setFile(`${RECIPIENT_DIR}/${ID_1}.md`, msg1.bytes);
	envSymAck.setFile(
		`${RECIPIENT_DIR}/${ID_1}.ack`,
		makeAckBytes({
			id: ID_1,
			state: "uncertain",
			reason: "crash_recovery",
		}),
		"symlink",
	);
	const resSymAck = await ackMailbox(
		[RECIPIENT, ID_1, "received"],
		envSymAck.deps,
	);
	assert.equal(resSymAck.exitCode, 1);
	assert.match(resSymAck.stderr, /symlink_rejected/);
});

test("ack: invalid-format message rejects 'received' but permits 'rejected', while missing or symlink message rejects both", async () => {
	const env = createFakeCliEnv();
	env.setFile(`${RECIPIENT_DIR}/${ID_1}.md`, "malformed message body without header");

	// 'received' must fail on malformed message
	const resRec = await ackMailbox([RECIPIENT, ID_1, "received"], env.deps);
	assert.equal(resRec.exitCode, 1);
	assert.match(resRec.stderr, /invalid_header/);
	assert.equal(env.nodes.has(`${RECIPIENT_DIR}/${ID_1}.ack`), false);

	// 'rejected' is permitted on malformed regular message file
	const resRej = await ackMailbox(
		[RECIPIENT, ID_1, "rejected", "invalid_header"],
		env.deps,
	);
	assert.equal(resRej.exitCode, 0);
	assert.equal(resRej.stdout, `${RECIPIENT_DIR}/${ID_1}.ack\n`);

	// Missing original message -> 'rejected' is also refused
	const resMissing = await ackMailbox(
		[RECIPIENT, ID_2, "rejected", "missing_msg"],
		env.deps,
	);
	assert.equal(resMissing.exitCode, 1);
	assert.match(resMissing.stderr, /file_missing/);

	// Symlink original message -> 'rejected' is also refused
	env.setFile(
		`${RECIPIENT_DIR}/${ID_3}.md`,
		makeMessageBytes(ID_3).bytes,
		"symlink",
	);
	const resSymlink = await ackMailbox(
		[RECIPIENT, ID_3, "rejected", "symlink_msg"],
		env.deps,
	);
	assert.equal(resSymlink.exitCode, 1);
	assert.match(resSymlink.stderr, /symlink_rejected/);
});

test("ack: fails on write boundary violation and reports tmp_cleanup_failed warning on stderr while still succeeding after link", async () => {
	// 1. Write boundary failure (not ignored by git)
	const envBoundary = createFakeCliEnv({
		gitHandler(args) {
			if (args[2] === "check-ignore") {
				return { stdout: "", stderr: "", code: 1 };
			}
			return undefined;
		},
	});
	envBoundary.setFile(
		`${RECIPIENT_DIR}/${ID_1}.md`,
		makeMessageBytes(ID_1).bytes,
	);
	const resBoundary = await ackMailbox(
		[RECIPIENT, ID_1, "received"],
		envBoundary.deps,
	);
	assert.equal(resBoundary.exitCode, 1);
	assert.match(resBoundary.stderr, /not_ignored/);

	// 2. Temporary file unlink failure after hard-link publication still exits 0 with warning on stderr
	const envCleanupWarn = createFakeCliEnv({
		unlinkHook(path) {
			if (path.endsWith(".tmp")) {
				throw Object.assign(new Error("EACCES: unlink failed"), {
					code: "EACCES",
				});
			}
		},
	});
	envCleanupWarn.setFile(
		`${RECIPIENT_DIR}/${ID_1}.md`,
		makeMessageBytes(ID_1).bytes,
	);
	const resCleanupWarn = await ackMailbox(
		[RECIPIENT, ID_1, "received"],
		envCleanupWarn.deps,
	);
	assert.equal(resCleanupWarn.exitCode, 0);
	assert.equal(resCleanupWarn.stdout, `${RECIPIENT_DIR}/${ID_1}.ack\n`);
	assert.match(resCleanupWarn.stderr, /tmp_cleanup_failed/);
});

test("runMailCli: argument validation and exit code mapping for watch and ack", async () => {
	const env = createFakeCliEnv();

	// Unknown subcommand
	const resSub = await runMailCli(["unknown"], env.deps);
	assert.equal(resSub.exitCode, 1);
	assert.match(resSub.stderr, /invalid_subcommand/);

	// watch: invalid recipient, negative timeout, non-numeric timeout, missing timeout value
	for (const badWatchArgs of [
		[],
		["INVALID_NAME"],
		[RECIPIENT, "--timeout", "-1"],
		[RECIPIENT, "--timeout", "abc"],
		[RECIPIENT, "--timeout", "1.5"],
		[RECIPIENT, "--timeout"],
		[RECIPIENT, "--unknown-flag"],
	]) {
		const res = await runMailCli(["watch", ...badWatchArgs], env.deps);
		assert.equal(res.exitCode, 1);
		assert.match(res.stderr, /invalid_args/);
	}

	// ack: missing args, invalid recipient, invalid ULID, invalid state ('uncertain'), received with reason, rejected without reason, rejected with invalid reason
	for (const badAckArgs of [
		[RECIPIENT, ID_1],
		["Bad_Name", ID_1, "received"],
		[RECIPIENT, "not-a-ulid", "received"],
		[RECIPIENT, ID_1, "uncertain", "reason"],
		[RECIPIENT, ID_1, "received", "unexpected reason"],
		[RECIPIENT, ID_1, "rejected"],
		[RECIPIENT, ID_1, "rejected", "  leading space  "],
		[RECIPIENT, ID_1, "rejected", "x".repeat(201)],
	]) {
		const res = await runMailCli(["ack", ...badAckArgs], env.deps);
		assert.equal(res.exitCode, 1);
		assert.notEqual(res.stderr, "");
	}
});

test("send: publishes mail using --from, GJC_HERDR_MAILBOX env, and --from overriding env, and rejects missing or invalid sender name", async () => {
	// 1. --from provided (with empty env)
	const envFromFlag = createFakeCliEnv();
	const resFromFlag = await runMailCli(
		[
			"send",
			"gjc-herdr-mate",
			"--from",
			"gjc-herdr-lead",
			"--subject",
			"지시서 전달",
		],
		{ ...envFromFlag.deps, env: {} },
	);
	assert.equal(resFromFlag.exitCode, 0);
	assert.equal(resFromFlag.stderr, "");
	const pathFromFlag = resFromFlag.stdout.trim();
	assert.match(
		pathFromFlag,
		/^\/repo\/\.gjc-herdr\/mailbox\/gjc-herdr-mate\/[0-9A-HJKMNP-TV-Z]{26}\.md$/,
	);
	const msgFromFlag = parseMailMessage(
		envFromFlag.nodes.get(pathFromFlag)!.bytes,
	);
	assert.equal(msgFromFlag.ok, true);
	if (msgFromFlag.ok) {
		assert.equal(msgFromFlag.value.from, "gjc-herdr-lead");
		assert.equal(msgFromFlag.value.to, "gjc-herdr-mate");
		assert.equal(msgFromFlag.value.subject, "지시서 전달");
		assert.equal(msgFromFlag.value.body, "");
	}

	// 2. GJC_HERDR_MAILBOX env used when --from is omitted
	const envFromEnv = createFakeCliEnv();
	const resFromEnv = await sendMailbox(
		["gjc-herdr-mate", "--subject", "환경변수 발신"],
		{
			...envFromEnv.deps,
			env: { GJC_HERDR_MAILBOX: "gjc-herdr-lead" },
		},
	);
	assert.equal(resFromEnv.exitCode, 0);
	const msgFromEnv = parseMailMessage(
		envFromEnv.nodes.get(resFromEnv.stdout.trim())!.bytes,
	);
	assert.equal(msgFromEnv.ok, true);
	if (msgFromEnv.ok) {
		assert.equal(msgFromEnv.value.from, "gjc-herdr-lead");
	}

	// 3. --from overrides GJC_HERDR_MAILBOX env
	const envOverride = createFakeCliEnv();
	const resOverride = await sendMailbox(
		[
			"gjc-herdr-mate",
			"--from",
			"gjc-herdr-lead",
			"--subject",
			"우선순위 확인",
		],
		{
			...envOverride.deps,
			env: { GJC_HERDR_MAILBOX: "gjc-herdr-deputy" },
		},
	);
	assert.equal(resOverride.exitCode, 0);
	const msgOverride = parseMailMessage(
		envOverride.nodes.get(resOverride.stdout.trim())!.bytes,
	);
	assert.equal(msgOverride.ok, true);
	if (msgOverride.ok) {
		assert.equal(msgOverride.value.from, "gjc-herdr-lead");
	}

	// 4. Missing sender name (neither --from nor GJC_HERDR_MAILBOX) -> exit 1
	const envNoSender = createFakeCliEnv();
	const resNoSender = await sendMailbox(
		["gjc-herdr-mate", "--subject", "발신자 없음"],
		{ ...envNoSender.deps, env: {} },
	);
	assert.equal(resNoSender.exitCode, 1);
	assert.equal(resNoSender.stdout, "");
	assert.match(
		resNoSender.stderr,
		/^mail-send error \[missing_sender_mailbox\]:/,
	);
	assert.deepEqual(envNoSender.writeCalls, []);

	// 5. Invalid sender name (via --from and via env) -> exit 1
	for (const badCall of [
		{
			args: ["gjc-herdr-mate", "--from", "Bad_Sender", "--subject", "제목"],
			env: {},
		},
		{
			args: ["gjc-herdr-mate", "--subject", "제목"],
			env: { GJC_HERDR_MAILBOX: "Bad_Sender" },
		},
	]) {
		const envBad = createFakeCliEnv();
		const resBad = await sendMailbox(badCall.args, {
			...envBad.deps,
			env: badCall.env,
		});
		assert.equal(resBad.exitCode, 1);
		assert.equal(resBad.stdout, "");
		assert.match(resBad.stderr, /^mail-send error \[invalid_sender_mailbox\]:/);
		assert.deepEqual(envBad.writeCalls, []);
	}
});

test("send: --body-file reads valid UTF-8 regular file and rejects symlink, non-regular file, size over 256 KiB, and invalid UTF-8", async () => {
	// 1. Valid --body-file
	const envOk = createFakeCliEnv();
	envOk.setFile("/repo/brief.md", "본문 파일 내용입니다.\n둘째 줄입니다.\n");
	const resOk = await sendMailbox(
		[
			RECIPIENT,
			"--from",
			"gjc-herdr-lead",
			"--subject",
			"파일 본문 전송",
			"--body-file",
			"/repo/brief.md",
		],
		envOk.deps,
	);
	assert.equal(resOk.exitCode, 0);
	const msgOk = parseMailMessage(envOk.nodes.get(resOk.stdout.trim())!.bytes);
	assert.equal(msgOk.ok, true);
	if (msgOk.ok) {
		assert.equal(msgOk.value.body, "본문 파일 내용입니다.\n둘째 줄입니다.\n");
	}

	// 2. Symlink --body-file -> exit 1 (symlink_rejected)
	const envSym = createFakeCliEnv();
	envSym.setFile("/repo/link.md", "링크 본문\n", "symlink");
	const resSym = await sendMailbox(
		[
			RECIPIENT,
			"--from",
			"gjc-herdr-lead",
			"--subject",
			"링크 거절",
			"--body-file",
			"/repo/link.md",
		],
		envSym.deps,
	);
	assert.equal(resSym.exitCode, 1);
	assert.match(resSym.stderr, /^mail-send error \[symlink_rejected\]:/);
	assert.deepEqual(envSym.writeCalls, []);

	// 3. Non-regular file (FIFO and directory) -> exit 1 (not_regular_file)
	for (const kind of ["fifo", "dir"] as const) {
		const envNonReg = createFakeCliEnv();
		envNonReg.setFile("/repo/nonreg", "x", kind);
		const resNonReg = await sendMailbox(
			[
				RECIPIENT,
				"--from",
				"gjc-herdr-lead",
				"--subject",
				"비일반 파일 거절",
				"--body-file",
				"/repo/nonreg",
			],
			envNonReg.deps,
		);
		assert.equal(resNonReg.exitCode, 1);
		assert.match(resNonReg.stderr, /^mail-send error \[not_regular_file\]:/);
		assert.deepEqual(envNonReg.writeCalls, []);
	}

	// 4. Size limit exceeded (file > 256 KiB and file where header + body > 256 KiB) -> exit 1 (size_exceeded)
	for (const bodyLen of [MAX_MESSAGE_BYTES + 10, MAX_MESSAGE_BYTES]) {
		const envBig = createFakeCliEnv();
		envBig.setFile("/repo/big.md", new Uint8Array(bodyLen).fill(0x61));
		const resBig = await sendMailbox(
			[
				RECIPIENT,
				"--from",
				"gjc-herdr-lead",
				"--subject",
				"크기 초과",
				"--body-file",
				"/repo/big.md",
			],
			envBig.deps,
		);
		assert.equal(resBig.exitCode, 1);
		assert.match(resBig.stderr, /^mail-send error \[size_exceeded\]:/);
		assert.deepEqual(envBig.writeCalls, []);
	}

	// 5. Invalid UTF-8 in --body-file -> exit 1 (invalid_utf8)
	const envBadUtf8 = createFakeCliEnv();
	envBadUtf8.setFile("/repo/bad.md", new Uint8Array([0x61, 0xff, 0xfe, 0x0a]));
	const resBadUtf8 = await sendMailbox(
		[
			RECIPIENT,
			"--from",
			"gjc-herdr-lead",
			"--subject",
			"잘못된 UTF-8",
			"--body-file",
			"/repo/bad.md",
		],
		envBadUtf8.deps,
	);
	assert.equal(resBadUtf8.exitCode, 1);
	assert.match(resBadUtf8.stderr, /^mail-send error \[invalid_utf8\]:/);
	assert.deepEqual(envBadUtf8.writeCalls, []);
});

test("send: reads body from stdin (-), supports empty body when neither --body-file nor - is given, and enforces stdin size and UTF-8 limits", async () => {
	// 1. Stdin body (-) from chunked async iterable
	const envStdin = createFakeCliEnv();
	async function* fakeStdinChunks() {
		yield new TextEncoder().encode("표준 입력 첫 줄\n");
		yield new TextEncoder().encode("표준 입력 둘째 줄\n");
	}
	const resStdin = await sendMailbox(
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject", "stdin 본문", "-"],
		{ ...envStdin.deps, stdin: fakeStdinChunks() },
	);
	assert.equal(resStdin.exitCode, 0);
	const msgStdin = parseMailMessage(
		envStdin.nodes.get(resStdin.stdout.trim())!.bytes,
	);
	assert.equal(msgStdin.ok, true);
	if (msgStdin.ok) {
		assert.equal(msgStdin.value.body, "표준 입력 첫 줄\n표준 입력 둘째 줄\n");
	}

	// 2. Empty body when neither --body-file nor - is provided
	const envEmpty = createFakeCliEnv();
	const resEmpty = await sendMailbox(
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject", "빈 본문 확인"],
		envEmpty.deps,
	);
	assert.equal(resEmpty.exitCode, 0);
	const msgEmpty = parseMailMessage(
		envEmpty.nodes.get(resEmpty.stdout.trim())!.bytes,
	);
	assert.equal(msgEmpty.ok, true);
	if (msgEmpty.ok) {
		assert.equal(msgEmpty.value.body, "");
	}

	// 3. Stdin size limit: reads at most MAX_MESSAGE_BYTES + 1 bytes and stops consuming further chunks
	const envStdinBig = createFakeCliEnv();
	let chunksYielded = 0;
	async function* hugeStdin() {
		for (let i = 0; i < 5; i++) {
			chunksYielded += 1;
			yield new Uint8Array(100 * 1_024).fill(0x62);
		}
	}
	const resStdinBig = await sendMailbox(
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject", "stdin 초과", "-"],
		{ ...envStdinBig.deps, stdin: hugeStdin() },
	);
	assert.equal(resStdinBig.exitCode, 1);
	assert.equal(chunksYielded, 3); // 300 KiB > 256 KiB + 1, stops on 3rd chunk without reading 4th/5th
	assert.match(resStdinBig.stderr, /^mail-send error \[size_exceeded\]:/);

	// 4. Stdin invalid UTF-8 -> exit 1 (invalid_utf8)
	const envStdinUtf8 = createFakeCliEnv();
	const resStdinUtf8 = await sendMailbox(
		[
			RECIPIENT,
			"--from",
			"gjc-herdr-lead",
			"--subject",
			"stdin 잘못된 인코딩",
			"-",
		],
		{ ...envStdinUtf8.deps, stdin: new Uint8Array([0xc3, 0x28]) },
	);
	assert.equal(resStdinUtf8.exitCode, 1);
	assert.match(resStdinUtf8.stderr, /^mail-send error \[invalid_utf8\]:/);
});

test("send: supports valid --reply-to ULID and rejects invalid --reply-to format", async () => {
	// 1. Valid --reply-to
	const envOk = createFakeCliEnv();
	const resOk = await sendMailbox(
		[
			RECIPIENT,
			"--from",
			"gjc-herdr-lead",
			"--subject",
			"답장 제목",
			"--reply-to",
			ID_1,
		],
		envOk.deps,
	);
	assert.equal(resOk.exitCode, 0);
	const msgOk = parseMailMessage(envOk.nodes.get(resOk.stdout.trim())!.bytes);
	assert.equal(msgOk.ok, true);
	if (msgOk.ok) {
		assert.equal(msgOk.value.replyTo, ID_1);
	}

	// 2. Invalid --reply-to -> exit 1 (invalid_reply_to)
	const envBad = createFakeCliEnv();
	const resBad = await sendMailbox(
		[
			RECIPIENT,
			"--from",
			"gjc-herdr-lead",
			"--subject",
			"잘못된 답장 ID",
			"--reply-to",
			"not-a-valid-ulid",
		],
		envBad.deps,
	);
	assert.equal(resBad.exitCode, 1);
	assert.match(resBad.stderr, /^mail-send error \[invalid_reply_to\]:/);
	assert.deepEqual(envBad.writeCalls, []);
});

test("send: a subject that looks like an option needs --subject=<value>", async () => {
	for (const subject of ["-", "--from"]) {
		// The split form reads the option-like word as a missing value.
		const envSplit = createFakeCliEnv();
		const resSplit = await sendMailbox(
			[RECIPIENT, "--subject", subject, "--from", "gjc-herdr-lead"],
			envSplit.deps,
		);
		assert.equal(resSplit.exitCode, 1);
		assert.match(resSplit.stderr, /^mail-send error \[invalid_args\]:/);
		assert.deepEqual(envSplit.writeCalls, []);

		// The joined form keeps it as the subject.
		const envJoined = createFakeCliEnv();
		const resJoined = await sendMailbox(
			[RECIPIENT, `--subject=${subject}`, "--from", "gjc-herdr-lead"],
			envJoined.deps,
		);
		assert.equal(resJoined.exitCode, 0);
		const msg = parseMailMessage(envJoined.nodes.get(resJoined.stdout.trim())!.bytes);
		assert.equal(msg.ok, true);
		if (msg.ok) {
			assert.equal(msg.value.subject, subject);
		}
	}
});

test("send: rejects all four argument error classes with exit code 1", async () => {
	const env = createFakeCliEnv();

	for (const badArgs of [
		// (1) Unknown option / unexpected positional arg
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject", "제목", "--unknown"],
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject", "제목", "extra-pos"],
		// (2) Option missing its value
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject"],
		[RECIPIENT, "--subject", "제목", "--from"],
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject", "제목", "--reply-to"],
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject", "제목", "--body-file"],
		[RECIPIENT, "--from", "--subject", "제목"],
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject="],
		// (3) Missing --subject
		[RECIPIENT, "--from", "gjc-herdr-lead"],
		// (4) Both --body-file and '-' (stdin) specified together
		[
			RECIPIENT,
			"--from",
			"gjc-herdr-lead",
			"--subject",
			"제목",
			"--body-file",
			"/repo/body.md",
			"-",
		],
	]) {
		const res = await sendMailbox(badArgs, env.deps);
		assert.equal(res.exitCode, 1);
		assert.equal(res.stdout, "");
		assert.match(res.stderr, /^mail-send error \[invalid_args\]:/);
	}
	assert.deepEqual(env.writeCalls, []);
});

test("send: propagates sendMail failure codes (id_conflict, not_ignored, boundary violations) to stderr with exit code 1, and emits warnings on exit code 0", async () => {
	// 1. id_conflict: target message file already exists at the generated ULID path
	const envConflict = createFakeCliEnv();
	const firstRes = await sendMailbox(
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject", "첫 전송"],
		envConflict.deps,
	);
	assert.equal(firstRes.exitCode, 0);
	// Sending again at the exact same fake timestamp + deterministic randomBytes hits EEXIST on link -> id_conflict
	const secondRes = await sendMailbox(
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject", "충돌 전송"],
		envConflict.deps,
	);
	assert.equal(secondRes.exitCode, 1);
	assert.equal(secondRes.stdout, "");
	assert.match(secondRes.stderr, /^mail-send error \[id_conflict\]:/);

	// 2. not_ignored: git check-ignore returns code 1
	const envNotIgnored = createFakeCliEnv({
		gitHandler(args) {
			if (args[2] === "check-ignore") {
				return { stdout: "", stderr: "", code: 1 };
			}
			return undefined;
		},
	});
	const resNotIgnored = await sendMailbox(
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject", "미무시 경로"],
		envNotIgnored.deps,
	);
	assert.equal(resNotIgnored.exitCode, 1);
	assert.match(resNotIgnored.stderr, /^mail-send error \[not_ignored\]:/);

	// 3. Boundary violations: tracked_files, symlink_rejected, outside_repo
	const envTracked = createFakeCliEnv({
		gitHandler(args) {
			if (args[2] === "ls-files") {
				return { stdout: ".gjc-herdr/mailbox/tracked.md\n", code: 0 };
			}
			return undefined;
		},
	});
	const resTracked = await sendMailbox(
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject", "추적 파일 존재"],
		envTracked.deps,
	);
	assert.equal(resTracked.exitCode, 1);
	assert.match(resTracked.stderr, /^mail-send error \[tracked_files\]:/);

	const envSymlinkDir = createFakeCliEnv();
	envSymlinkDir.nodes.set(RECIPIENT_DIR, {
		kind: "symlink",
		mode: MAIL_DIR_MODE,
		bytes: new Uint8Array(0),
	});
	const resSymlinkDir = await sendMailbox(
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject", "심볼릭 링크 폴더"],
		envSymlinkDir.deps,
	);
	assert.equal(resSymlinkDir.exitCode, 1);
	assert.match(resSymlinkDir.stderr, /^mail-send error \[symlink_rejected\]:/);

	const envOutside = createFakeCliEnv();
	envOutside.nodes.set(RECIPIENT_DIR, {
		kind: "dir",
		mode: MAIL_DIR_MODE,
		bytes: new Uint8Array(0),
		realPath: "/tmp/escaped",
	});
	const resOutside = await sendMailbox(
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject", "저장소 밖 탈출"],
		envOutside.deps,
	);
	assert.equal(resOutside.exitCode, 1);
	assert.match(resOutside.stderr, /^mail-send error \[outside_repo\]:/);

	// 4. Post-publication cleanup failure + dir_mode_not_0700 -> exit 0 + stderr warnings
	const envWarn = createFakeCliEnv({
		unlinkHook(path) {
			if (path.endsWith(".tmp")) {
				throw Object.assign(new Error("EACCES: unlink failed"), {
					code: "EACCES",
				});
			}
		},
	});
	envWarn.nodes.get(RECIPIENT_DIR)!.mode = 0o755;
	const resWarn = await sendMailbox(
		[RECIPIENT, "--from", "gjc-herdr-lead", "--subject", "경고 확인"],
		envWarn.deps,
	);
	assert.equal(resWarn.exitCode, 0);
	assert.match(
		resWarn.stdout,
		/^\/repo\/\.gjc-herdr\/mailbox\/gjc-herdr-lead\/[0-9A-HJKMNP-TV-Z]{26}\.md\n$/,
	);
	assert.match(resWarn.stderr, /mail-send warning \[dir_mode_not_0700\]/);
	assert.match(resWarn.stderr, /mail-send warning \[tmp_cleanup_failed\]/);
});
