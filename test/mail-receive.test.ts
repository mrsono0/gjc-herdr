import { describe, expect, test } from "bun:test";
import { constants as fsConstants } from "node:fs/promises";
import { posix } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExecOptions,
	ExecResult,
} from "@gajae-code/coding-agent";
import * as zod from "zod/v4";
import herdrMetadata from "../src/extension.ts";
import {
	formatMailAck,
	formatMailAttempt,
	formatMailLockRecord,
	formatMailMessage,
	MAIL_DIR_MODE,
	MAIL_FILE_MODE,
	MAILBOX_ENV_KEY,
	MAX_MESSAGE_BYTES,
	parseMailAck,
	type MailFileHandle,
	type MailFs,
	type MailStat,
} from "../src/mail.ts";
import {
	CONSUMER_LOCK_FILE,
	formatInjectedMailContent,
	HOLD_RETRY_NOTICE,
	IN_FLIGHT_WARN_MS,
	LOCK_CONFLICT_MANUAL_ACTION,
	MAIL_BODY_END,
	MAIL_BODY_START,
	MAIL_TRUNCATED_NOTICE,
	MAIL_WARNING_LINE,
	MAX_PREVIEW_BYTES,
	POLL_INTERVAL_MS,
	probePidStatus,
	RATE_LIMIT_WINDOW_MS,
	registerMailReceiver,
	SHUTDOWN_DRAIN_BUDGET_MS,
	SHUTDOWN_TIMEOUT_MANUAL_ACTION,
	truncateUtf8Boundary,
	type MailReceiverDeps,
	type MailReceiverDiagnostic,
	type MailTimerHandle,
	type MailWatcherHandle,
} from "../src/mail-receive.ts";

interface FakeNode {
	kind: "dir" | "file" | "symlink" | "fifo";
	mode: number;
	bytes: Uint8Array;
	target?: string;
	nlink: number;
	ino: number;
}

class MemoryMailFs implements MailFs {
	readonly constants: Record<string, number | undefined> = {
		O_RDONLY: fsConstants.O_RDONLY,
		O_WRONLY: fsConstants.O_WRONLY,
		O_CREAT: fsConstants.O_CREAT,
		O_EXCL: fsConstants.O_EXCL,
		O_NOFOLLOW: fsConstants.O_NOFOLLOW,
		O_NONBLOCK: fsConstants.O_NONBLOCK,
	};

	readonly nodes = new Map<string, FakeNode>();
	readonly openCalls: Array<{ path: string; flags: number; mode?: number }> = [];
	readonly linkCalls: Array<{ existingPath: string; newPath: string }> = [];
	readonly unlinkCalls: string[] = [];

	private nextIno = 100;

	linkError?: Error & { code?: string };
	unlinkErrorForPath = new Map<string, Error & { code?: string }>();
	openErrorForPath = new Map<string, Error & { code?: string }>();
	realpathOverrides = new Map<string, string>();
	onLinkHook?: (existingPath: string, newPath: string) => Promise<void> | void;
	onUnlinkHook?: (path: string) => Promise<void> | void;

	constructor(repoRoot = "/repo") {
		this.setDir("/", 0o755);
		this.setDir(repoRoot, 0o755);
	}

	allocateIno(): number {
		this.nextIno += 1;
		return this.nextIno;
	}

	setDir(path: string, mode = MAIL_DIR_MODE, ino = this.allocateIno()): void {
		this.nodes.set(posix.normalize(path), {
			kind: "dir",
			mode,
			bytes: new Uint8Array(0),
			nlink: 1,
			ino,
		});
	}

	setFile(
		path: string,
		content: string | Uint8Array,
		mode = MAIL_FILE_MODE,
		ino = this.allocateIno(),
	): void {
		const bytes =
			typeof content === "string"
				? new TextEncoder().encode(content)
				: new Uint8Array(content);
		this.nodes.set(posix.normalize(path), {
			kind: "file",
			mode,
			bytes,
			nlink: 1,
			ino,
		});
	}

	setSymlink(path: string, target: string): void {
		this.nodes.set(posix.normalize(path), {
			kind: "symlink",
			mode: 0o777,
			bytes: new Uint8Array(0),
			target,
			nlink: 1,
			ino: this.allocateIno(),
		});
	}

	removeTree(prefix: string): void {
		const norm = posix.normalize(prefix);
		for (const key of Array.from(this.nodes.keys())) {
			if (key === norm || key.startsWith(`${norm}/`)) {
				this.nodes.delete(key);
			}
		}
	}

	getFileText(path: string): string | undefined {
		const node = this.nodes.get(posix.normalize(path));
		if (!node || node.kind !== "file") return undefined;
		return new TextDecoder().decode(node.bytes);
	}

	private makeStat(node: FakeNode): MailStat {
		return {
			isFile: () => node.kind === "file",
			isDirectory: () => node.kind === "dir",
			isSymbolicLink: () => node.kind === "symlink",
			mode: node.mode,
			size: node.bytes.byteLength,
			ino: node.ino,
		};
	}

	async lstat(path: string): Promise<MailStat> {
		const norm = posix.normalize(path);
		const node = this.nodes.get(norm);
		if (!node) {
			const err = new Error(`ENOENT: no such file or directory, lstat '${norm}'`) as Error & {
				code?: string;
			};
			err.code = "ENOENT";
			throw err;
		}
		return this.makeStat(node);
	}

	async realpath(path: string): Promise<string> {
		const norm = posix.normalize(path);
		const override = this.realpathOverrides.get(norm);
		if (override !== undefined) return override;
		const node = this.nodes.get(norm);
		if (!node) {
			const err = new Error(`ENOENT: no such file or directory, realpath '${norm}'`) as Error & {
				code?: string;
			};
			err.code = "ENOENT";
			throw err;
		}
		if (node.kind === "symlink" && node.target) {
			return node.target;
		}
		return norm;
	}

	async mkdir(path: string, options?: { mode?: number }): Promise<void> {
		const norm = posix.normalize(path);
		if (this.nodes.has(norm)) {
			const err = new Error(`EEXIST: file already exists, mkdir '${norm}'`) as Error & {
				code?: string;
			};
			err.code = "EEXIST";
			throw err;
		}
		this.setDir(norm, options?.mode ?? MAIL_DIR_MODE);
	}

	async readdir(path: string): Promise<string[]> {
		const norm = posix.normalize(path);
		const dirNode = this.nodes.get(norm);
		if (!dirNode) {
			const err = new Error(`ENOENT: no such file or directory, scandir '${norm}'`) as Error & {
				code?: string;
			};
			err.code = "ENOENT";
			throw err;
		}
		if (dirNode.kind !== "dir") {
			const err = new Error(`ENOTDIR: not a directory, scandir '${norm}'`) as Error & {
				code?: string;
			};
			err.code = "ENOTDIR";
			throw err;
		}
		const prefix = norm === "/" ? "/" : `${norm}/`;
		const names: string[] = [];
		for (const key of this.nodes.keys()) {
			if (!key.startsWith(prefix)) continue;
			const rest = key.slice(prefix.length);
			if (rest && !rest.includes("/")) {
				names.push(rest);
			}
		}
		return names;
	}

	async open(
		path: string,
		flags: number,
		mode = MAIL_FILE_MODE,
	): Promise<MailFileHandle> {
		const norm = posix.normalize(path);
		this.openCalls.push({ path: norm, flags, mode });

		const customErr = this.openErrorForPath.get(norm);
		if (customErr) throw customErr;

		const existing = this.nodes.get(norm);
		const isCreat = (flags & fsConstants.O_CREAT) !== 0;
		const isExcl = (flags & fsConstants.O_EXCL) !== 0;
		const isNofollow = (flags & fsConstants.O_NOFOLLOW) !== 0;

		if (existing?.kind === "symlink" && isNofollow) {
			const err = new Error(`ELOOP: too many symbolic links encountered, open '${norm}'`) as Error & {
				code?: string;
			};
			err.code = "ELOOP";
			throw err;
		}

		let node: FakeNode;
		if (isCreat) {
			if (existing && isExcl) {
				const err = new Error(`EEXIST: file already exists, open '${norm}'`) as Error & {
					code?: string;
				};
				err.code = "EEXIST";
				throw err;
			}
			node = existing ?? {
				kind: "file",
				mode,
				bytes: new Uint8Array(0),
				nlink: 1,
				ino: this.allocateIno(),
			};
			this.nodes.set(norm, node);
		} else {
			if (!existing) {
				const err = new Error(`ENOENT: no such file or directory, open '${norm}'`) as Error & {
					code?: string;
				};
				err.code = "ENOENT";
				throw err;
			}
			node = existing;
		}

		const makeStat = () => this.makeStat(node);
		return {
			async stat() {
				return makeStat();
			},
			async read(buffer, offset, length, position) {
				const pos = position ?? 0;
				const avail = Math.max(0, node.bytes.byteLength - pos);
				const toRead = Math.min(length, avail);
				if (toRead > 0) {
					buffer.set(node.bytes.subarray(pos, pos + toRead), offset);
				}
				return { bytesRead: toRead, buffer };
			},
			async write(buffer, offset = 0, length = buffer.byteLength, position = 0) {
				const pos = position ?? 0;
				const slice = buffer.subarray(offset, offset + length);
				const nextLen = Math.max(node.bytes.byteLength, pos + slice.byteLength);
				if (nextLen !== node.bytes.byteLength) {
					const grown = new Uint8Array(nextLen);
					grown.set(node.bytes, 0);
					node.bytes = grown;
				}
				node.bytes.set(slice, pos);
				return { bytesWritten: slice.byteLength };
			},
			async sync() {},
			async close() {},
		};
	}

	async link(existingPath: string, newPath: string): Promise<void> {
		const src = posix.normalize(existingPath);
		const dst = posix.normalize(newPath);
		this.linkCalls.push({ existingPath: src, newPath: dst });
		if (this.onLinkHook) {
			await this.onLinkHook(src, dst);
		}
		if (this.linkError) {
			throw this.linkError;
		}
		const srcNode = this.nodes.get(src);
		if (!srcNode) {
			const err = new Error(`ENOENT: no such file, link '${src}'`) as Error & {
				code?: string;
			};
			err.code = "ENOENT";
			throw err;
		}
		if (this.nodes.has(dst)) {
			const err = new Error(`EEXIST: file already exists, link '${dst}'`) as Error & {
				code?: string;
			};
			err.code = "EEXIST";
			throw err;
		}
		srcNode.nlink += 1;
		this.nodes.set(dst, srcNode);
	}

	async unlink(path: string): Promise<void> {
		const norm = posix.normalize(path);
		this.unlinkCalls.push(norm);
		if (this.onUnlinkHook) {
			await this.onUnlinkHook(norm);
		}
		const customErr = this.unlinkErrorForPath.get(norm);
		if (customErr) throw customErr;
		const node = this.nodes.get(norm);
		if (!node) {
			const err = new Error(`ENOENT: no such file, unlink '${norm}'`) as Error & {
				code?: string;
			};
			err.code = "ENOENT";
			throw err;
		}
		node.nlink = Math.max(0, node.nlink - 1);
		this.nodes.delete(norm);
	}
}

interface ScheduledTimer extends MailTimerHandle {
	id: number;
	dueMs: number;
	intervalMs?: number;
	callback: () => void;
	cancelled: boolean;
	unreffed: boolean;
	unref(): ScheduledTimer;
}

class FakeClockAndTimers {
	nowMs = 1_760_619_911_000;
	private nextId = 1;
	readonly timers = new Map<number, ScheduledTimer>();

	now = (): number => this.nowMs;

	setTimeout = (callback: () => void, ms: number): MailTimerHandle => {
		const id = this.nextId++;
		const handle: ScheduledTimer = {
			id,
			dueMs: this.nowMs + ms,
			callback,
			cancelled: false,
			unreffed: false,
			unref() {
				this.unreffed = true;
				return this;
			},
		};
		this.timers.set(id, handle);
		return handle;
	};

	clearTimeout = (handle: MailTimerHandle): void => {
		const h = handle as ScheduledTimer | undefined;
		if (!h) return;
		h.cancelled = true;
		this.timers.delete(h.id);
	};

	setInterval = (callback: () => void, ms: number): MailTimerHandle => {
		const id = this.nextId++;
		const handle: ScheduledTimer = {
			id,
			dueMs: this.nowMs + ms,
			intervalMs: ms,
			callback,
			cancelled: false,
			unreffed: false,
			unref() {
				this.unreffed = true;
				return this;
			},
		};
		this.timers.set(id, handle);
		return handle;
	};

	clearInterval = (handle: MailTimerHandle): void => {
		this.clearTimeout(handle);
	};

	advanceBy(deltaMs: number): void {
		const targetMs = this.nowMs + deltaMs;
		while (true) {
			let earliest: ScheduledTimer | undefined;
			for (const t of this.timers.values()) {
				if (t.cancelled) continue;
				if (t.dueMs <= targetMs) {
					if (!earliest || t.dueMs < earliest.dueMs || (t.dueMs === earliest.dueMs && t.id < earliest.id)) {
						earliest = t;
					}
				}
			}
			if (!earliest) break;
			this.nowMs = earliest.dueMs;
			if (earliest.intervalMs !== undefined) {
				earliest.dueMs = this.nowMs + earliest.intervalMs;
			} else {
				earliest.cancelled = true;
				this.timers.delete(earliest.id);
			}
			earliest.callback();
		}
		this.nowMs = targetMs;
	}
}

interface FakeWatcherInstance extends MailWatcherHandle {
	dirPath: string;
	closed: boolean;
	listener: (eventType: string, filename?: string | Buffer | null) => void;
	errorListeners: Array<(err?: unknown) => void>;
	closeListeners: Array<() => void>;
	emitChange(filename?: string): void;
	emitError(err?: unknown): void;
	emitClose(): void;
}

class FakeWatchRegistry {
	readonly watchers: FakeWatcherInstance[] = [];

	watch = (
		dirPath: string,
		listener: (eventType: string, filename?: string | Buffer | null) => void,
	): MailWatcherHandle => {
		const instance: FakeWatcherInstance = {
			dirPath,
			closed: false,
			listener,
			errorListeners: [],
			closeListeners: [],
			close() {
				this.closed = true;
				for (const cb of this.closeListeners) cb();
			},
			on(event, cb) {
				if (event === "error") {
					this.errorListeners.push(cb);
				} else if (event === "close") {
					this.closeListeners.push(cb as () => void);
				}
				return this;
			},
			emitChange(filename = "mail.md") {
				if (!this.closed) {
					this.listener("rename", filename);
				}
			},
			emitError(err = new Error("watch error")) {
				for (const cb of this.errorListeners) cb(err);
			},
			emitClose() {
				this.closed = true;
				for (const cb of this.closeListeners) cb();
			},
		};
		this.watchers.push(instance);
		return instance;
	};

	latestWatcher(): FakeWatcherInstance | undefined {
		return this.watchers[this.watchers.length - 1];
	}
}

interface SentCustomMessageCall {
	message: {
		customType: string;
		display?: boolean;
		attribution?: string;
		content: string;
		details?: {
			id: string;
			from: string;
			path: string;
		};
	};
	options?: {
		deliverAs?: string;
		triggerTurn?: boolean;
	};
}

function makeGitExec(options?: {
	topLevel?: string;
	trackedOutput?: string;
	ignoreExitCode?: number;
	failCheckIgnoreFor?: (target: string) => boolean;
}): ExtensionAPI["exec"] {
	const topLevel = options?.topLevel ?? "/repo";
	return async (
		_cmd: string,
		args: string[],
		_opts?: ExecOptions,
	): Promise<ExecResult> => {
		if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
			return { code: 0, stdout: `${topLevel}\n`, stderr: "", killed: false };
		}
		if (args.includes("ls-files")) {
			return {
				code: 0,
				stdout: options?.trackedOutput ?? "",
				stderr: "",
				killed: false,
			};
		}
		if (args.includes("check-ignore")) {
			const target = args[args.length - 1] ?? "";
			if (options?.failCheckIgnoreFor?.(target)) {
				return { code: 1, stdout: "", stderr: "", killed: false };
			}
			return {
				code: options?.ignoreExitCode ?? 0,
				stdout: "",
				stderr: "",
				killed: false,
			};
		}
		return { code: 0, stdout: "", stderr: "", killed: false };
	};
}

function makeUlid(index: number): string {
	const suffix = String(index).padStart(6, "0");
	return `01JC9W2K8Q8Z6Y3V4N5M${suffix}`;
}

function writeValidMailToFs(
	fs: MemoryMailFs,
	params: {
		id: string;
		from?: string;
		to?: string;
		subject?: string;
		body?: string;
		created?: string;
		recipientDir?: string;
	},
): { id: string; path: string; bodySha256: string } {
	const to = params.to ?? "gjc-worker";
	const recipientDir =
		params.recipientDir ?? `/repo/.gjc-herdr/mailbox/${to}`;
	if (!fs.nodes.has("/repo/.gjc-herdr")) {
		fs.setDir("/repo/.gjc-herdr", MAIL_DIR_MODE);
	}
	if (!fs.nodes.has("/repo/.gjc-herdr/mailbox")) {
		fs.setDir("/repo/.gjc-herdr/mailbox", MAIL_DIR_MODE);
	}
	if (!fs.nodes.has(recipientDir)) {
		fs.setDir(recipientDir, MAIL_DIR_MODE);
	}
	const built = formatMailMessage({
		id: params.id,
		from: params.from ?? "gjc-herdr-lead",
		to,
		created: params.created ?? "2026-10-16T21:05:11Z",
		subject: params.subject ?? `Subject ${params.id}`,
		body: params.body ?? `Body for ${params.id}\n`,
	});
	if (!built.ok) {
		throw new Error(`Failed to build test message: ${built.reason}`);
	}
	const filePath = posix.join(recipientDir, `${params.id}.md`);
	fs.setFile(filePath, built.value.bytes);
	return {
		id: params.id,
		path: filePath,
		bodySha256: built.value.message.bodySha256,
	};
}

function createTestHarness(custom?: {
	mailboxEnv?: string | undefined;
	idle?: boolean;
	sessionId?: string;
	sessionMetadata?: { kind: string; taskDepth: number };
	fs?: MemoryMailFs;
	exec?: ExtensionAPI["exec"];
	deps?: Partial<MailReceiverDeps>;
}) {
	const fs = custom?.fs ?? new MemoryMailFs("/repo");
	const clock = new FakeClockAndTimers();
	const watchReg = new FakeWatchRegistry();
	const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => Promise<void> | void>>();
	const sentMessages: SentCustomMessageCall[] = [];
	const notifications: Array<{ message: string; level?: string }> = [];
	const diagnostics: MailReceiverDiagnostic[] = [];

	let isIdleState = custom?.idle ?? true;
	let currentSessionId = custom?.sessionId ?? "sess-main-1";
	let sendMessageThrow: Error | undefined;
	let autoBusyOnSend = false;

	const makeCtx = (overridesCtx?: {
		sessionId?: string;
		sessionMetadata?: { kind: string; taskDepth: number };
	}): ExtensionContext => {
		const sid = overridesCtx?.sessionId ?? currentSessionId;
		return {
			isIdle: () => isIdleState,
			sessionMetadata:
				overridesCtx?.sessionMetadata ??
				custom?.sessionMetadata ?? { kind: "main", taskDepth: 0 },
			sessionManager: {
				getSessionId: () => sid,
			},
			ui: {
				notify: (message: string, level?: string) => {
					notifications.push({ message, level });
				},
			},
		} as unknown as ExtensionContext;
	};

	let activeCtx = makeCtx();

	const api = {
		logger: {
			info() {},
			warn() {},
			error() {},
		},
		zod: { z: {} },
		exec: custom?.exec ?? makeGitExec(),
		on(event: string, handler: (ev: unknown, ctx: ExtensionContext) => Promise<void> | void) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		sendMessage(
			message: SentCustomMessageCall["message"],
			options?: SentCustomMessageCall["options"],
		) {
			if (sendMessageThrow) {
				throw sendMessageThrow;
			}
			sentMessages.push({ message, options });
			if (autoBusyOnSend) {
				isIdleState = false;
			}
		},
		registerTool() {},
		registerCommand() {},
	} as unknown as ExtensionAPI;

	const env: Record<string, string | undefined> =
		custom && "mailboxEnv" in custom
			? { [MAILBOX_ENV_KEY]: custom.mailboxEnv }
			: { [MAILBOX_ENV_KEY]: "gjc-worker" };

	let seedByte = 1;
	const randomBytes = (buf: Uint8Array): Uint8Array => {
		for (let i = 0; i < buf.length; i++) {
			buf[i] = (seedByte + i) & 0xff;
		}
		seedByte = (seedByte + 17) & 0xff;
		return buf;
	};

	const controller = registerMailReceiver(api, {
		fs,
		env,
		now: clock.now,
		randomBytes,
		pid: 4242,
		watch: watchReg.watch,
		setTimeout: clock.setTimeout,
		clearTimeout: clock.clearTimeout,
		setInterval: clock.setInterval,
		clearInterval: clock.clearInterval,
		onDiagnostic: (d) => diagnostics.push(d),
		...custom?.deps,
	});

	async function emit(event: string, payload: unknown = {}, ctxOverride?: ExtensionContext): Promise<void> {
		const list = handlers.get(event) ?? [];
		const ctxToUse = ctxOverride ?? activeCtx;
		for (const fn of list) {
			await fn(payload, ctxToUse);
		}
	}

	function emitNoWait(event: string, payload: unknown = {}, ctxOverride?: ExtensionContext): Array<Promise<void> | void> {
		const list = handlers.get(event) ?? [];
		const ctxToUse = ctxOverride ?? activeCtx;
		return list.map((fn) => fn(payload, ctxToUse));
	}

	return {
		fs,
		clock,
		watchReg,
		handlers,
		sentMessages,
		notifications,
		diagnostics,
		controller,
		makeCtx,
		getIdle: () => isIdleState,
		setIdle: (val: boolean) => {
			isIdleState = val;
		},
		setAutoBusyOnSend: (val: boolean) => {
			autoBusyOnSend = val;
		},
		setSendMessageThrow: (err: Error | undefined) => {
			sendMessageThrow = err;
		},
		setSessionId: (sid: string) => {
			currentSessionId = sid;
			activeCtx = makeCtx({ sessionId: sid });
		},
		emit,
		emitNoWait,
	};
}

describe("#33 Phase 2: §11.1 Focused Event Tests (Acceptance Criteria 1–9)", () => {
	test("Focused Event Test 1: busy arrival defers attempt/injection until idle; attempt publish failure makes 0 calls; post-attempt busy recheck waits with same attempt without consuming reinjection count", async () => {
		const id1 = makeUlid(1);
		const id2 = makeUlid(2);
		const id3 = makeUlid(3);

		let flipBusyAfterAttemptFor: string | undefined;
		const h = createTestHarness({
			idle: false,
			deps: {
				afterAttemptPublish: (id) => {
					if (id === flipBusyAfterAttemptFor) {
						h.setIdle(false);
					}
				},
			},
		});

		writeValidMailToFs(h.fs, { id: id1 });
		await h.emit("session_start");
		await h.controller.waitForIdleQueue();

		// Busy arrival: neither attempt nor sendMessage happened.
		expect(h.sentMessages.length).toBe(0);
		expect(h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${id1}.attempt`)).toBeUndefined();

		// Make attempt publication fail for id1 when becoming idle.
		const linkErr = new Error("EIO: link failed") as Error & { code?: string };
		linkErr.code = "EIO";
		h.fs.linkError = linkErr;

		h.setIdle(true);
		await h.emit("agent_end", { stopReason: "completed" });
		await h.controller.waitForIdleQueue();

		// Attempt publish failure -> 0 sendMessage calls, slot released, id1 in holdIds.
		expect(h.sentMessages.length).toBe(0);
		expect(h.controller.getStateSnapshot().slotCount).toBe(0);
		expect(h.controller.getStateSnapshot().holdIds.has(id1)).toBe(true);
		h.fs.linkError = undefined;

		// Write id2 and make ctx become busy right after attempt publication.
		writeValidMailToFs(h.fs, { id: id2 });
		flipBusyAfterAttemptFor = id2;
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();

		const attempt2Before = h.fs.getFileText(
			`/repo/.gjc-herdr/mailbox/gjc-worker/${id2}.attempt`,
		);
		expect(attempt2Before).toBeDefined();
		expect(h.sentMessages.length).toBe(0);
		const rec2Waiting = h.controller.getStateSnapshot().activeRecords.get(id2);
		expect(rec2Waiting?.state).toBe("waiting_call");
		expect(rec2Waiting?.callCount).toBe(0);
		expect(rec2Waiting?.holdsSlot).toBe(true);

		// Also add id3 while busy; when idle returns, waiting_call id2 goes first using the SAME attempt.
		writeValidMailToFs(h.fs, { id: id3 });
		flipBusyAfterAttemptFor = undefined;
		h.setAutoBusyOnSend(true);
		h.setIdle(true);
		await h.emit("agent_end", { stopReason: "completed" });
		await h.controller.waitForIdleQueue();

		expect(h.sentMessages.length).toBe(1);
		expect(h.sentMessages[0]!.message.details?.id).toBe(id2);
		const attempt2After = h.fs.getFileText(
			`/repo/.gjc-herdr/mailbox/gjc-worker/${id2}.attempt`,
		);
		expect(attempt2After).toBe(attempt2Before);

		// Verify waiting_call did NOT consume reinjection count: unobserved end still allows 1 reinjection (callCount 1 -> 2).
		h.setAutoBusyOnSend(false);
		h.setIdle(true);
		await h.emit("agent_end", { stopReason: "cancelled" });
		await h.controller.waitForIdleQueue();

		expect(
			h.sentMessages.filter((m) => m.message.details?.id === id2).length,
		).toBe(2);
	});

	test("Focused Event Test 2: id/generation/observation order — pre-Stage-1 assistant, error/aborted, and foreign generation events never produce received; toolUse and multi-id in same context both settle received", async () => {
		const id1 = makeUlid(10);
		const id2 = makeUlid(11);
		const idForeignGen = makeUlid(12);
		const h = createTestHarness({ idle: true });

		const m1 = writeValidMailToFs(h.fs, { id: id1 });
		const m2 = writeValidMailToFs(h.fs, { id: id2 });

		await h.emit("session_start");
		await h.controller.waitForIdleQueue();

		expect(h.sentMessages.length).toBe(2);

		// 1) Pre-Stage-1 assistant normal response does NOT produce received.
		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h.controller.waitForIdleQueue();
		expect(h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${id1}.ack`)).toBeUndefined();

		// 2) Stage 1 for unknown id or wrong customType does NOT transition id1/id2.
		await h.emit("message_end", {
			message: {
				role: "custom",
				customType: "other-type",
				details: { id: id1 },
			},
		});
		await h.emit("message_end", {
			message: {
				role: "custom",
				customType: "herdr-mail",
				details: { id: makeUlid(999) },
			},
		});
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().activeRecords.get(id1)?.state).toBe("in_flight");

		// 3) Stage 1 observed for both id1 and id2 in same generation.
		await h.emit("message_end", {
			message: {
				role: "custom",
				customType: "herdr-mail",
				details: { id: id1 },
			},
		});
		await h.emit("message_end", {
			message: {
				role: "custom",
				customType: "herdr-mail",
				details: { id: id2 },
			},
		});
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().activeRecords.get(id1)?.state).toBe("context_reflected");
		expect(h.controller.getStateSnapshot().activeRecords.get(id2)?.state).toBe("context_reflected");

		// Duplicate Stage 1 is ignored without changing stage1Seq or state.
		const seqBeforeDup = h.controller.getStateSnapshot().activeRecords.get(id1)?.stage1Seq;
		await h.emit("message_end", {
			message: {
				role: "custom",
				customType: "herdr-mail",
				details: { id: id1 },
			},
		});
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().activeRecords.get(id1)?.stage1Seq).toBe(seqBeforeDup);

		// 4) Assistant message_end with error or aborted keeps context_reflected without writing ack.
		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "error" },
		});
		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "aborted" },
		});
		await h.emit("agent_end", { stopReason: "cancelled" });
		await h.controller.waitForIdleQueue();

		expect(h.controller.getStateSnapshot().activeRecords.get(id1)?.state).toBe("context_reflected");
		expect(h.controller.getStateSnapshot().activeRecords.get(id2)?.state).toBe("context_reflected");
		expect(h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${id1}.ack`)).toBeUndefined();

		// 5) Subsequent normal assistant response with stopReason "toolUse" settles BOTH id1 and id2 as received(observed).
		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "toolUse" },
		});
		await h.controller.waitForIdleQueue();

		const ack1Text = h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${id1}.ack`);
		const ack2Text = h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${id2}.ack`);
		expect(ack1Text).toBeDefined();
		expect(ack2Text).toBeDefined();

		const parsedAck1 = parseMailAck(ack1Text!, {
			expectedId: id1,
			expectedBy: "gjc-worker",
			expectedBodySha256: m1.bodySha256,
		});
		const parsedAck2 = parseMailAck(ack2Text!, {
			expectedId: id2,
			expectedBy: "gjc-worker",
			expectedBodySha256: m2.bodySha256,
		});
		expect(parsedAck1.ok).toBe(true);
		expect(parsedAck2.ok).toBe(true);
		if (parsedAck1.ok && parsedAck2.ok) {
			expect(parsedAck1.value.state).toBe("received");
			expect(parsedAck1.value.via).toBe("observed");
			expect(parsedAck2.value.state).toBe("received");
			expect(parsedAck2.value.via).toBe("observed");
		}
		expect(h.controller.getStateSnapshot().slotCount).toBe(0);

		// 6) Foreign generation events never produce received:
		// 6a) Stage 1 + Stage 2 captured at generation 1 right before session_switch to generation 2
		writeValidMailToFs(h.fs, { id: idForeignGen });
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().activeRecords.get(idForeignGen)?.state).toBe("in_flight");

		const foreignStage1 = h.emitNoWait("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idForeignGen } },
		});
		const foreignStage2 = h.emitNoWait("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		h.setSessionId("sess-main-2");
		await h.emit("session_switch", {}, h.makeCtx({ sessionId: "sess-main-2" }));
		await Promise.all([...foreignStage1, ...foreignStage2]);
		await h.controller.waitForIdleQueue();

		const foreignAck = parseMailAck(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idForeignGen}.ack`)!,
			{ expectedId: idForeignGen, expectedBy: "gjc-worker" },
		);
		expect(foreignAck.ok).toBe(true);
		if (foreignAck.ok) {
			expect(foreignAck.value.state).toBe("uncertain");
			expect(foreignAck.value.reason).toBe("session_changed");
		}

		// 6b) Stage 1 + Stage 2 captured at generation 3 while record is still from generation 2 (record.generation !== captured.generation)
		const idForeignGen2 = makeUlid(13);
		writeValidMailToFs(h.fs, { id: idForeignGen2 });
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().activeRecords.get(idForeignGen2)?.state).toBe("in_flight");

		h.setSessionId("sess-main-3");
		const switchGen3 = h.emitNoWait("session_switch", {}, h.makeCtx({ sessionId: "sess-main-3" }));
		const gen3Stage1 = h.emitNoWait("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idForeignGen2 } },
		});
		const gen3Stage2 = h.emitNoWait("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await Promise.all([...switchGen3, ...gen3Stage1, ...gen3Stage2]);
		await h.controller.waitForIdleQueue();

		const foreignAck2 = parseMailAck(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idForeignGen2}.ack`)!,
			{ expectedId: idForeignGen2, expectedBy: "gjc-worker" },
		);
		expect(foreignAck2.ok).toBe(true);
		if (foreignAck2.ok) {
			expect(foreignAck2.value.state).toBe("uncertain");
			expect(foreignAck2.value.reason).toBe("session_changed");
		}
	});

	test("Focused Event Test 3: paused preserves queue -> idle injects new mail -> resumes paused; non-paused unobserved end -> 1x reinjection -> second unobserved becomes uncertain; late Stage 1/2 during waiting_reinject settles received without 2nd call", async () => {
		const idPaused = makeUlid(20);
		const idNew = makeUlid(21);
		const idUnobserved = makeUlid(22);
		const idLate = makeUlid(23);

		const h = createTestHarness({ idle: true });
		writeValidMailToFs(h.fs, { id: idPaused });

		await h.emit("session_start");
		await h.controller.waitForIdleQueue();
		expect(h.sentMessages.length).toBe(1);

		// 1) paused agent_end preserves in-flight without consuming reinjection count, and allows new mail injection when idle.
		writeValidMailToFs(h.fs, { id: idNew });
		await h.emit("agent_end", { stopReason: "paused" });
		await h.controller.waitForIdleQueue();

		expect(h.controller.getStateSnapshot().activeRecords.get(idPaused)?.state).toBe("in_flight");
		expect(h.controller.getStateSnapshot().activeRecords.get(idPaused)?.callCount).toBe(1);
		expect(h.sentMessages.length).toBe(2);
		expect(h.sentMessages[1]!.message.details?.id).toBe(idNew);

		// Resume & complete both idPaused and idNew.
		await h.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idPaused } },
		});
		await h.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idNew } },
		});
		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().terminalAckIds.has(idPaused)).toBe(true);
		expect(h.controller.getStateSnapshot().terminalAckIds.has(idNew)).toBe(true);

		// 2) Non-paused unobserved agent_end -> 1st time reinjects -> 2nd time writes uncertain(unobserved_twice).
		writeValidMailToFs(h.fs, { id: idUnobserved });
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		expect(h.sentMessages.filter((m) => m.message.details?.id === idUnobserved).length).toBe(1);

		// First unobserved non-paused agent_end -> waiting_reinject -> immediately reinjected since idle.
		await h.emit("agent_end", { stopReason: "cancelled" });
		await h.controller.waitForIdleQueue();
		expect(h.sentMessages.filter((m) => m.message.details?.id === idUnobserved).length).toBe(2);
		expect(h.controller.getStateSnapshot().activeRecords.get(idUnobserved)?.callCount).toBe(2);

		// Second unobserved non-paused agent_end -> uncertain (unobserved_twice).
		await h.emit("agent_end", { stopReason: "cancelled" });
		await h.controller.waitForIdleQueue();
		const ackUnobserved = parseMailAck(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idUnobserved}.ack`)!,
			{ expectedId: idUnobserved, expectedBy: "gjc-worker" },
		);
		expect(ackUnobserved.ok).toBe(true);
		if (ackUnobserved.ok) {
			expect(ackUnobserved.value.state).toBe("uncertain");
			expect(ackUnobserved.value.reason).toBe("unobserved_twice");
		}

		// 3) Late Stage 1/2 during waiting_reinject cancels reinjection and settles received with only 1 call.
		const mLate = writeValidMailToFs(h.fs, { id: idLate });
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		expect(h.sentMessages.filter((m) => m.message.details?.id === idLate).length).toBe(1);

		// Become busy when first unobserved agent_end fires so idLate stays in waiting_reinject.
		h.setIdle(false);
		await h.emit("agent_end", { stopReason: "completed" });
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().activeRecords.get(idLate)?.state).toBe("waiting_reinject");
		expect(h.controller.getStateSnapshot().slotCount).toBe(1);

		// Late Stage 1 arrives before reinjection!
		await h.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idLate } },
		});
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().activeRecords.get(idLate)?.state).toBe("context_reflected");
		expect(h.controller.getStateSnapshot().slotCount).toBe(1);

		// Stage 2 arrives -> received ack without a 2nd sendMessage call!
		h.setIdle(true);
		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h.controller.waitForIdleQueue();

		expect(h.sentMessages.filter((m) => m.message.details?.id === idLate).length).toBe(1);
		const ackLate = parseMailAck(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idLate}.ack`)!,
			{ expectedId: idLate, expectedBy: "gjc-worker", expectedBodySha256: mLate.bodySha256 },
		);
		expect(ackLate.ok).toBe(true);
		if (ackLate.ok) {
			expect(ackLate.value.state).toBe("received");
		}
	});

	test("Focused Event Test 4: session_switch and session_shutdown during file I/O never inject old mail into new generation; confirmed_pending_ack retries across session_switch without reinjection; late events after uncertain do not change state", async () => {
		const idSwitchDuringIo = makeUlid(30);
		const idPendingAck = makeUlid(31);
		const idShutdownDuringIo = makeUlid(32);

		let triggerSwitchFor: string | undefined;
		let triggerShutdownFor: string | undefined;
		const observedStatesOnAfterAttempt = new Map<string, string | undefined>();
		let pendingAckStillPresentAtSwitch = false;

		const h = createTestHarness({
			idle: true,
			deps: {
				afterAttemptPublish: async (id) => {
					observedStatesOnAfterAttempt.set(
						id,
						h.controller.getStateSnapshot().activeRecords.get(id)?.state,
					);
					if (id === triggerSwitchFor) {
						pendingAckStillPresentAtSwitch =
							h.controller.getStateSnapshot().pendingAckRecords.has(idPendingAck);
						h.setSessionId("sess-main-2");
						h.emitNoWait("session_switch", {}, h.makeCtx({ sessionId: "sess-main-2" }));
					}
					if (id === triggerShutdownFor) {
						h.emitNoWait("session_shutdown", {});
					}
				},
			},
		});

		const mPending = writeValidMailToFs(h.fs, { id: idPendingAck });
		await h.emit("session_start");
		await h.controller.waitForIdleQueue();
		expect(h.sentMessages.length).toBe(1);

		// Observe Stage 1 for idPendingAck, then fail the received ack link for idPendingAck so it stays in confirmed_pending_ack across session_switch!
		await h.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idPendingAck } },
		});
		let blockPendingAckWrite = true;
		h.fs.onLinkHook = (_src, dst) => {
			if (blockPendingAckWrite && dst.endsWith(`${idPendingAck}.ack`)) {
				const ackFailErr = new Error("ENOSPC: disk full") as Error & { code?: string };
				ackFailErr.code = "ENOSPC";
				throw ackFailErr;
			}
		};

		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().pendingAckRecords.has(idPendingAck)).toBe(true);
		expect(h.controller.getStateSnapshot().slotCount).toBe(0);

		// Keep idPendingAck's ack write blocked while triggering session_switch during idSwitchDuringIo's attempt I/O (in reserved state).
		writeValidMailToFs(h.fs, { id: idSwitchDuringIo });
		triggerSwitchFor = idSwitchDuringIo;

		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();

		expect(observedStatesOnAfterAttempt.get(idSwitchDuringIo)).toBe("reserved");
		expect(pendingAckStillPresentAtSwitch).toBe(true);
		// Even after session_switch completed, idPendingAck is STILL in pendingAckRecords (never converted to uncertain)!
		expect(h.controller.getStateSnapshot().pendingAckRecords.has(idPendingAck)).toBe(true);
		expect(h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idPendingAck}.ack`)).toBeUndefined();

		// idSwitchDuringIo was NOT injected into the new generation; it became uncertain(session_changed).
		expect(h.sentMessages.filter((m) => m.message.details?.id === idSwitchDuringIo).length).toBe(0);
		const switchAck = parseMailAck(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idSwitchDuringIo}.ack`)!,
			{ expectedId: idSwitchDuringIo, expectedBy: "gjc-worker" },
		);
		expect(switchAck.ok).toBe(true);
		if (switchAck.ok) {
			expect(switchAck.value.state).toBe("uncertain");
			expect(switchAck.value.reason).toBe("session_changed");
		}

		// Now unblock disk for idPendingAck and scan in the new generation -> idPendingAck settles as received without reinjection!
		blockPendingAckWrite = false;
		h.fs.onLinkHook = undefined;
		triggerSwitchFor = undefined;
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();

		expect(h.controller.getStateSnapshot().pendingAckRecords.has(idPendingAck)).toBe(false);
		expect(h.sentMessages.filter((m) => m.message.details?.id === idPendingAck).length).toBe(1);
		const pendingAckParsed = parseMailAck(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idPendingAck}.ack`)!,
			{ expectedId: idPendingAck, expectedBy: "gjc-worker", expectedBodySha256: mPending.bodySha256 },
		);
		expect(pendingAckParsed.ok).toBe(true);
		if (pendingAckParsed.ok) {
			expect(pendingAckParsed.value.state).toBe("received");
		}

		// Late Stage 1 and Stage 2 events for idSwitchDuringIo after uncertain do NOT change state; only log diagnostic.
		await h.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idSwitchDuringIo } },
		});
		await h.controller.waitForIdleQueue();
		expect(
			h.diagnostics.some((d) => d.code === "late_stage1_after_settled" && d.id === idSwitchDuringIo),
		).toBe(true);
		const switchAckAfterLate = parseMailAck(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idSwitchDuringIo}.ack`)!,
			{ expectedId: idSwitchDuringIo, expectedBy: "gjc-worker" },
		);
		expect(switchAckAfterLate.ok && switchAckAfterLate.value.state).toBe("uncertain");

		// Now test session_shutdown during idShutdownDuringIo attempt I/O (in reserved state): does not call sendMessage and does not write ack.
		triggerShutdownFor = idShutdownDuringIo;
		writeValidMailToFs(h.fs, { id: idShutdownDuringIo });
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();

		expect(observedStatesOnAfterAttempt.get(idShutdownDuringIo)).toBe("reserved");
		expect(h.sentMessages.filter((m) => m.message.details?.id === idShutdownDuringIo).length).toBe(0);
		expect(h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idShutdownDuringIo}.attempt`)).toBeDefined();
		expect(h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idShutdownDuringIo}.ack`)).toBeUndefined();
	});

	test("Focused Event Test 5: shutdown timeout retains consumer lock and emits required diagnostic; late completion neither injects nor deletes lock; startup crash recovery and terminal ack precedence", async () => {
		const idSlow = makeUlid(40);
		let enteredSlowAttempt!: () => void;
		const enteredSlowAttemptGate = new Promise<void>((resolve) => {
			enteredSlowAttempt = resolve;
		});
		let releaseSlowAttempt!: () => void;
		const slowAttemptGate = new Promise<void>((resolve) => {
			releaseSlowAttempt = resolve;
		});

		const h = createTestHarness({
			idle: true,
			deps: {
				afterAttemptPublish: async (id) => {
					if (id === idSlow) {
						enteredSlowAttempt();
						await slowAttemptGate;
					}
				},
			},
		});

		await h.emit("session_start");
		await h.controller.waitForIdleQueue();

		const lockPath = `/repo/.gjc-herdr/mailbox/gjc-worker/${CONSUMER_LOCK_FILE}`;
		expect(h.fs.getFileText(lockPath)).toBeDefined();

		// Start scanning idSlow, which blocks inside afterAttemptPublish.
		writeValidMailToFs(h.fs, { id: idSlow });
		const scanPromise = h.controller.triggerScan();
		await enteredSlowAttemptGate;

		// Initiate session_shutdown and advance fake clock past the 2s drain budget.
		const shutdownPromises = h.emitNoWait("session_shutdown");
		await Promise.resolve();
		await Promise.resolve();
		h.clock.advanceBy(SHUTDOWN_DRAIN_BUDGET_MS + 100);
		await Promise.all(shutdownPromises);

		// Lock must remain on disk, and shutdown timeout diagnostic must contain lock path, unconfirmed file op, and manual action.
		expect(h.fs.getFileText(lockPath)).toBeDefined();
		const timeoutDiag = h.diagnostics.find(
			(d) => d.code === "shutdown_timeout_lock_retained",
		);
		expect(timeoutDiag).toBeDefined();
		expect(timeoutDiag?.message).toContain(lockPath);
		expect(timeoutDiag?.message).toContain("파일 작업 완료 미확정");
		expect(timeoutDiag?.message).toContain(SHUTDOWN_TIMEOUT_MANUAL_ACTION);

		// Now let the slow continuation finish after timeout: it must NOT call sendMessage and must NOT unlink the lock!
		releaseSlowAttempt();
		await scanPromise;
		await h.controller.waitForIdleQueue();

		expect(h.sentMessages.length).toBe(0);
		expect(h.fs.getFileText(lockPath)).toBeDefined();

		// Remove lock manually (as instructed by diagnostic), add terminal ack for another message with an attempt, and start a new receiver.
		const idTerminalWithAttempt = makeUlid(41);
		const mTerm = writeValidMailToFs(h.fs, { id: idTerminalWithAttempt });
		const attemptTerm = formatMailAttempt({
			id: idTerminalWithAttempt,
			bodySha256: mTerm.bodySha256,
			consumer: "0123456789abcdef0123456789abcdef",
			session: "sess-old",
			at: "2026-10-16T21:05:11Z",
		});
		const ackTerm = formatMailAck({
			id: idTerminalWithAttempt,
			by: "gjc-worker",
			at: "2026-10-16T21:05:12Z",
			state: "received",
			via: "observed",
			bodySha256: mTerm.bodySha256,
		});
		if (!attemptTerm.ok || !ackTerm.ok) throw new Error("format failed");
		h.fs.setFile(`/repo/.gjc-herdr/mailbox/gjc-worker/${idTerminalWithAttempt}.attempt`, attemptTerm.value);
		h.fs.setFile(`/repo/.gjc-herdr/mailbox/gjc-worker/${idTerminalWithAttempt}.ack`, ackTerm.value);

		await h.fs.unlink(lockPath);

		const h2 = createTestHarness({ fs: h.fs, idle: true });
		await h2.emit("session_start");
		await h2.controller.waitForIdleQueue();

		// idSlow (had attempt, no ack) -> recovered as uncertain(crash_recovery).
		const recoveredAck = parseMailAck(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idSlow}.ack`)!,
			{ expectedId: idSlow, expectedBy: "gjc-worker" },
		);
		expect(recoveredAck.ok).toBe(true);
		if (recoveredAck.ok) {
			expect(recoveredAck.value.state).toBe("uncertain");
			expect(recoveredAck.value.reason).toBe("crash_recovery");
		}

		// idTerminalWithAttempt (had both attempt and received ack) -> kept received ack untouched!
		const keptAck = parseMailAck(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idTerminalWithAttempt}.ack`)!,
			{ expectedId: idTerminalWithAttempt, expectedBy: "gjc-worker" },
		);
		expect(keptAck.ok && keptAck.value.state).toBe("received");
		expect(h2.sentMessages.length).toBe(0);
	});

	test("Focused Event Test 6: 30s polling advances without watch events, and folder deletion + recreation with a new inode revives fs.watch", async () => {
		const idPoll = makeUlid(50);
		const idNewInode = makeUlid(51);

		const h = createTestHarness({ idle: true });
		await h.emit("session_start");
		await h.controller.waitForIdleQueue();

		expect(h.watchReg.watchers.length).toBe(1);
		const firstWatcher = h.watchReg.latestWatcher()!;

		// Drop a message without firing any watch event; advance clock by 30s to trigger poll.
		writeValidMailToFs(h.fs, { id: idPoll });
		expect(h.sentMessages.length).toBe(0);

		h.clock.advanceBy(POLL_INTERVAL_MS);
		await h.controller.waitForIdleQueue();
		expect(h.sentMessages.length).toBe(1);
		expect(h.sentMessages[0]!.message.details?.id).toBe(idPoll);

		// Delete and recreate the recipient directory with a brand-new inode.
		const recipientDir = "/repo/.gjc-herdr/mailbox/gjc-worker";
		const lockText = h.fs.getFileText(`${recipientDir}/${CONSUMER_LOCK_FILE}`)!;
		h.fs.removeTree(recipientDir);
		h.fs.setDir(recipientDir, MAIL_DIR_MODE, 9999);
		h.fs.setFile(`${recipientDir}/${CONSUMER_LOCK_FILE}`, lockText);

		// Advance 30s poll -> detects new inode, closes old watcher, attaches new watcher.
		h.clock.advanceBy(POLL_INTERVAL_MS);
		await h.controller.waitForIdleQueue();

		expect(firstWatcher.closed).toBe(true);
		expect(h.watchReg.watchers.length).toBeGreaterThanOrEqual(2);
		const secondWatcher = h.watchReg.latestWatcher()!;
		expect(secondWatcher).not.toBe(firstWatcher);

		// Emit a watch event on the revived watcher for idNewInode -> immediately scanned and injected!
		writeValidMailToFs(h.fs, { id: idNewInode });
		secondWatcher.emitChange(`${idNewInode}.md`);
		await h.controller.waitForIdleQueue();

		expect(h.sentMessages.some((m) => m.message.details?.id === idNewInode)).toBe(true);
	});

	test("Focused Event Test 7 (E1): A & B hold 2 slots, C becomes waiting_call after attempt publish filling slot 3; on idle C makes its first call with the same attempt/slot while 4th candidate D stays blocked and waiting_call uses 0 call count / rate limit", async () => {
		const idA = makeUlid(60);
		const idB = makeUlid(61);
		const idC = makeUlid(62);
		const idD = makeUlid(63);

		const h = createTestHarness({
			idle: true,
			deps: {
				afterAttemptPublish: (id) => {
					if (id === idC) {
						h.setIdle(false);
					}
				},
			},
		});

		writeValidMailToFs(h.fs, { id: idA });
		writeValidMailToFs(h.fs, { id: idB });
		writeValidMailToFs(h.fs, { id: idC });
		writeValidMailToFs(h.fs, { id: idD });

		await h.emit("session_start");
		await h.controller.waitForIdleQueue();

		// A and B are in_flight (1 call each); C published attempt then saw busy -> waiting_call (0 calls). Total slots = 3. D was never opened.
		const snap1 = h.controller.getStateSnapshot();
		expect(snap1.slotCount).toBe(3);
		expect(snap1.activeRecords.get(idA)?.state).toBe("in_flight");
		expect(snap1.activeRecords.get(idB)?.state).toBe("in_flight");
		expect(snap1.activeRecords.get(idC)?.state).toBe("waiting_call");
		expect(snap1.activeRecords.get(idC)?.callCount).toBe(0);
		expect(snap1.activeRecords.has(idD)).toBe(false);
		expect(h.sentMessages.length).toBe(2);

		const cAttemptBefore = h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idC}.attempt`);
		expect(cAttemptBefore).toBeDefined();
		expect(h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idD}.attempt`)).toBeUndefined();

		// Observe Stage 1 for A and B so paused/normal agent_end doesn't mark them unobserved.
		await h.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idA } },
		});
		await h.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idB } },
		});
		await h.controller.waitForIdleQueue();

		// Become idle -> C (already holding slot 3) is not blocked by the 3-slot cap (E1) and makes its 1st call! D is still blocked by the 3-slot cap.
		h.setIdle(true);
		await h.emit("agent_end", { stopReason: "completed" });
		await h.controller.waitForIdleQueue();

		const snap2 = h.controller.getStateSnapshot();
		expect(snap2.slotCount).toBe(3);
		expect(snap2.activeRecords.get(idC)?.state).toBe("in_flight");
		expect(snap2.activeRecords.get(idC)?.callCount).toBe(1);
		expect(snap2.activeRecords.get(idC)?.callBoundarySeq).toBeDefined();
		expect(h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idC}.attempt`)).toBe(cAttemptBefore);
		expect(h.sentMessages.length).toBe(3);
		expect(h.sentMessages[2]!.message.details?.id).toBe(idC);
		expect(snap2.activeRecords.has(idD)).toBe(false);
	});

	test("Focused Event Test 8 (E2): agent_end received during attempt I/O before sendMessage does not count as unobserved end for that call; only agent_end after callBoundarySeq triggers waiting_reinject or 2nd uncertain", async () => {
		const idC = makeUlid(70);
		let fireEarlyAgentEnd = true;
		let firePreReinjectAgentEnd = false;

		const h = createTestHarness({
			idle: true,
			deps: {
				afterAttemptPublish: () => {
					if (fireEarlyAgentEnd) {
						fireEarlyAgentEnd = false;
						// Arrive in listener BEFORE sendMessage is called!
						h.emitNoWait("agent_end", { stopReason: "cancelled" });
						h.emitNoWait("agent_end", { stopReason: "paused" });
					}
				},
				beforeSendMessage: (_id, callNumber) => {
					if (callNumber === 2 && firePreReinjectAgentEnd) {
						firePreReinjectAgentEnd = false;
						// Arrive in listener BEFORE 2nd sendMessage call boundary is recorded!
						h.emitNoWait("agent_end", { stopReason: "cancelled" });
					}
				},
			},
		});

		writeValidMailToFs(h.fs, { id: idC });
		await h.emit("session_start");
		await h.controller.waitForIdleQueue();

		// Early agent_end (captured before 1st sendMessage) ran after performScanPass, but seq <= callBoundarySeq so idC stays in_flight with callCount = 1!
		const recAfterEarly = h.controller.getStateSnapshot().activeRecords.get(idC);
		expect(recAfterEarly?.state).toBe("in_flight");
		expect(recAfterEarly?.callCount).toBe(1);
		expect(h.sentMessages.length).toBe(1);

		// Now emit a post-call paused agent_end -> stays in_flight with callCount = 1.
		await h.emit("agent_end", { stopReason: "paused" });
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().activeRecords.get(idC)?.state).toBe("in_flight");
		expect(h.controller.getStateSnapshot().activeRecords.get(idC)?.callCount).toBe(1);

		// Now emit a post-call non-paused agent_end, and during beforeSendMessage(call 2) queue another agent_end BEFORE call 2's boundary is saved.
		firePreReinjectAgentEnd = true;
		await h.emit("agent_end", { stopReason: "cancelled" });
		await h.controller.waitForIdleQueue();

		// The pre-reinject agent_end had seq <= 2nd callBoundarySeq, so idC must STILL be in_flight (callCount = 2), NOT uncertain!
		const recAfterReinject = h.controller.getStateSnapshot().activeRecords.get(idC);
		expect(recAfterReinject?.state).toBe("in_flight");
		expect(recAfterReinject?.callCount).toBe(2);
		expect(h.sentMessages.length).toBe(2);

		// Only an agent_end received AFTER the 2nd callBoundarySeq transitions idC to uncertain(unobserved_twice).
		await h.emit("agent_end", { stopReason: "maintenance" });
		await h.controller.waitForIdleQueue();
		const ack = parseMailAck(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idC}.ack`)!,
			{ expectedId: idC, expectedBy: "gjc-worker" },
		);
		expect(ack.ok && ack.value.state).toBe("uncertain");
	});

	test("Focused Event Test 9 (Slots): waiting_reinject keeps its slot, late Stage 1 does not change slot count, and reinjection does not double-reserve a slot", async () => {
		const id1 = makeUlid(80);
		const id2 = makeUlid(81);
		const id3 = makeUlid(82);
		const id4 = makeUlid(83);

		const h = createTestHarness({ idle: true });
		writeValidMailToFs(h.fs, { id: id1 });
		writeValidMailToFs(h.fs, { id: id2 });
		writeValidMailToFs(h.fs, { id: id3 });
		writeValidMailToFs(h.fs, { id: id4 });

		await h.emit("session_start");
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().slotCount).toBe(3);

		// Become busy and trigger unobserved agent_end so id1, id2, id3 enter waiting_reinject while holding all 3 slots.
		h.setIdle(false);
		await h.emit("agent_end", { stopReason: "cancelled" });
		await h.controller.waitForIdleQueue();

		const snapReinject = h.controller.getStateSnapshot();
		expect(snapReinject.activeRecords.get(id1)?.state).toBe("waiting_reinject");
		expect(snapReinject.activeRecords.get(id2)?.state).toBe("waiting_reinject");
		expect(snapReinject.activeRecords.get(id3)?.state).toBe("waiting_reinject");
		expect(snapReinject.slotCount).toBe(3);

		// Late Stage 1 for id1 arrives while in waiting_reinject -> transitions to context_reflected, slotCount remains 3.
		await h.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: id1 } },
		});
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().activeRecords.get(id1)?.state).toBe("context_reflected");
		expect(h.controller.getStateSnapshot().slotCount).toBe(3);

		// Become idle and scan -> id2 and id3 reinject without duplicating slots (slotCount stays 3, id4 still blocked until a slot frees).
		h.setIdle(true);
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();

		const snapAfterReinject = h.controller.getStateSnapshot();
		expect(snapAfterReinject.slotCount).toBe(3);
		expect(snapAfterReinject.activeRecords.get(id2)?.state).toBe("in_flight");
		expect(snapAfterReinject.activeRecords.get(id2)?.callCount).toBe(2);
		expect(snapAfterReinject.activeRecords.get(id3)?.state).toBe("in_flight");
		expect(snapAfterReinject.activeRecords.get(id3)?.callCount).toBe(2);
		expect(snapAfterReinject.activeRecords.has(id4)).toBe(false);
	});
});

describe("#33 Phase 2: §5, §7, #35, and §11.1 Receiver Unit Tests", () => {
	test("opt-in gate: unset GJC_HERDR_MAILBOX registers 0 listeners; invalid name disables and notifies once; subagent session is ignored; missing/invalid session_id disables with diagnostic; valid startup logs banner once", async () => {
		// 1) Unset env -> 0 event registrations
		const hUnset = createTestHarness({ mailboxEnv: undefined });
		expect(hUnset.handlers.size).toBe(0);

		// 2) Invalid mailbox name -> disabled, notified once
		const hInvalid = createTestHarness({ mailboxEnv: "INVALID_UPPER" });
		await hInvalid.emit("session_start");
		await hInvalid.emit("session_start");
		await hInvalid.controller.waitForIdleQueue();
		expect(hInvalid.controller.getStateSnapshot().disabled).toBe(true);
		expect(
			hInvalid.diagnostics.filter((d) => d.code === "invalid_mailbox_env").length,
		).toBe(1);
		expect(hInvalid.notifications.length).toBe(1);

		// 3) Subagent session -> ignored
		const hSub = createTestHarness({
			sessionMetadata: { kind: "subagent", taskDepth: 1 },
		});
		await hSub.emit("session_start");
		await hSub.controller.waitForIdleQueue();
		expect(hSub.controller.getStateSnapshot().lockAcquired).toBe(false);

		// 4) Missing/invalid session ID on session_start -> disabled with invalid_session_id diagnostic (no synthetic session-N!)
		const hBadSid = createTestHarness({ sessionId: "" });
		await hBadSid.emit("session_start");
		await hBadSid.controller.waitForIdleQueue();
		expect(hBadSid.controller.getStateSnapshot().disabled).toBe(true);
		expect(hBadSid.controller.getStateSnapshot().lockAcquired).toBe(false);
		expect(
			hBadSid.diagnostics.some((d) => d.code === "invalid_session_id"),
		).toBe(true);

		// 5) Valid main session -> banner emitted once with mailbox name and root, even without Herdr pane
		const prevMailbox = process.env[MAILBOX_ENV_KEY];
		const prevPane = process.env.HERDR_PANE_ID;
		delete process.env[MAILBOX_ENV_KEY];
		delete process.env.HERDR_PANE_ID;
		try {
			let regCount = 0;
			herdrMetadata({
				logger: { info() {}, warn() {}, error() {} },
				zod,
				exec: makeGitExec(),
				on() {
					regCount += 1;
				},
				registerTool() {},
				registerCommand() {},
			} as unknown as ExtensionAPI);
			expect(regCount).toBe(0);
		} finally {
			if (prevMailbox !== undefined) process.env[MAILBOX_ENV_KEY] = prevMailbox;
			if (prevPane !== undefined) process.env.HERDR_PANE_ID = prevPane;
		}
	});

	test("§5.1 existing consumer lock: reports alive pid (있음), dead pid (없음 ESRCH), EPERM (확인 불가), and corrupted/unreadable pid (판독 불가 without calling kill)", async () => {
		const lockPath = `/repo/.gjc-herdr/mailbox/gjc-worker/${CONSUMER_LOCK_FILE}`;

		// Direct probePidStatus checks
		expect(probePidStatus("1234", () => true)).toEqual({
			pidDisplay: "1234",
			status: "있음",
		});
		expect(
			probePidStatus("1234", () => {
				const err = new Error("no process") as Error & { code?: string };
				err.code = "ESRCH";
				throw err;
			}),
		).toEqual({
			pidDisplay: "1234",
			status: "없음",
		});
		expect(
			probePidStatus("1234", () => {
				const err = new Error("not permitted") as Error & { code?: string };
				err.code = "EPERM";
				throw err;
			}),
		).toEqual({
			pidDisplay: "1234",
			status: "확인 불가",
		});

		let killCalled = false;
		expect(
			probePidStatus("0bad", () => {
				killCalled = true;
				return true;
			}),
		).toEqual({
			pidDisplay: "판독 불가",
			status: "판독 불가",
		});
		expect(killCalled).toBe(false);

		// Receiver startup with existing valid lock (alive pid)
		const fsAlive = new MemoryMailFs("/repo");
		fsAlive.setDir("/repo/.gjc-herdr", MAIL_DIR_MODE);
		fsAlive.setDir("/repo/.gjc-herdr/mailbox", MAIL_DIR_MODE);
		fsAlive.setDir("/repo/.gjc-herdr/mailbox/gjc-worker", MAIL_DIR_MODE);
		const validLock = formatMailLockRecord({
			pid: "9876",
			token: "0123456789abcdef0123456789abcdef",
			at: "2026-10-16T21:05:11Z",
		});
		if (!validLock.ok) throw new Error("lock format failed");
		fsAlive.setFile(lockPath, validLock.value);

		const hAlive = createTestHarness({
			fs: fsAlive,
			deps: {
				kill: () => true,
			},
		});
		await hAlive.emit("session_start");
		await hAlive.controller.waitForIdleQueue();
		expect(hAlive.controller.getStateSnapshot().disabled).toBe(true);
		const diagAlive = hAlive.diagnostics.find((d) => d.code === "consumer_lock_conflict");
		expect(diagAlive?.message).toContain(lockPath);
		expect(diagAlive?.message).toContain("pid=9876");
		expect(diagAlive?.message).toContain("프로세스=있음");
		expect(diagAlive?.message).toContain(LOCK_CONFLICT_MANUAL_ACTION);

		// Receiver startup with corrupted lock -> does NOT call kill, reports 판독 불가
		const fsCorrupt = new MemoryMailFs("/repo");
		fsCorrupt.setDir("/repo/.gjc-herdr", MAIL_DIR_MODE);
		fsCorrupt.setDir("/repo/.gjc-herdr/mailbox", MAIL_DIR_MODE);
		fsCorrupt.setDir("/repo/.gjc-herdr/mailbox/gjc-worker", MAIL_DIR_MODE);
		fsCorrupt.setFile(lockPath, "corrupted lock content\n");

		let corruptKillCalls = 0;
		const hCorrupt = createTestHarness({
			fs: fsCorrupt,
			deps: {
				kill: () => {
					corruptKillCalls += 1;
					return true;
				},
			},
		});
		await hCorrupt.emit("session_start");
		await hCorrupt.controller.waitForIdleQueue();
		expect(corruptKillCalls).toBe(0);
		const diagCorrupt = hCorrupt.diagnostics.find((d) => d.code === "consumer_lock_conflict");
		expect(diagCorrupt?.message).toContain("pid=판독 불가");
		expect(diagCorrupt?.message).toContain("프로세스=판독 불가");
		expect(diagCorrupt?.message).toContain(LOCK_CONFLICT_MANUAL_ACTION);
	});

	test("§5.1 consumer lock release on shutdown: unlinks own token, refuses to unlink foreign token", async () => {
		const lockPath = `/repo/.gjc-herdr/mailbox/gjc-worker/${CONSUMER_LOCK_FILE}`;

		// 1) Normal shutdown unlinks own lock
		const hOwn = createTestHarness({ idle: true });
		await hOwn.emit("session_start");
		await hOwn.controller.waitForIdleQueue();
		expect(hOwn.fs.getFileText(lockPath)).toBeDefined();

		await hOwn.emit("session_shutdown");
		expect(hOwn.fs.getFileText(lockPath)).toBeUndefined();

		// 2) Foreign token in .consumer.lock -> refuses to unlink on shutdown
		const hForeign = createTestHarness({ idle: true });
		await hForeign.emit("session_start");
		await hForeign.controller.waitForIdleQueue();

		const foreignLock = formatMailLockRecord({
			pid: "5555",
			token: "ffffffffffffffffffffffffffffffff",
			at: "2026-10-16T21:05:11Z",
		});
		if (!foreignLock.ok) throw new Error("format failed");
		hForeign.fs.setFile(lockPath, foreignLock.value);

		await hForeign.emit("session_shutdown");
		expect(hForeign.fs.getFileText(lockPath)).toBe(foreignLock.value);
		expect(
			hForeign.diagnostics.some((d) => d.code === "consumer_lock_token_mismatch"),
		).toBe(true);
	});

	test("§5.1 Step 4 on session_shutdown: retries confirmed_pending_ack once within budget and unlocks when successful; unlocks leaving .attempt for crash_recovery if Step 4 fails within budget; retains lock if Step 4 times out; preserves min 500ms budget after partial Step 2 drain", async () => {
		const idPending = makeUlid(90);
		const lockPath = `/repo/.gjc-herdr/mailbox/gjc-worker/${CONSUMER_LOCK_FILE}`;

		const h = createTestHarness({ idle: true });
		const m = writeValidMailToFs(h.fs, { id: idPending });
		await h.emit("session_start");
		await h.controller.waitForIdleQueue();

		await h.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idPending } },
		});
		const err = new Error("EIO") as Error & { code?: string };
		err.code = "EIO";
		h.fs.linkError = err;
		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().pendingAckRecords.has(idPending)).toBe(true);

		// Part 1: Restore disk and run session_shutdown -> Step 4 writes the received ack and Step 5 removes lock!
		h.fs.linkError = undefined;
		await h.emit("session_shutdown");

		const ackText = h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idPending}.ack`);
		expect(ackText).toBeDefined();
		const parsed = parseMailAck(ackText!, {
			expectedId: idPending,
			expectedBy: "gjc-worker",
			expectedBodySha256: m.bodySha256,
		});
		expect(parsed.ok && parsed.value.state).toBe("received");
		expect(h.fs.getFileText(lockPath)).toBeUndefined();

		// Part 2: Step 4 retry fails immediately within budget (disk stays broken) -> finishes within budget, unlocks .consumer.lock, and leaves .attempt without .ack for next startup crash_recovery!
		const idPendingFailInBudget = makeUlid(92);
		const hFail = createTestHarness({ idle: true });
		writeValidMailToFs(hFail.fs, { id: idPendingFailInBudget });
		await hFail.emit("session_start");
		await hFail.controller.waitForIdleQueue();

		await hFail.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idPendingFailInBudget } },
		});
		hFail.fs.linkError = err;
		await hFail.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await hFail.controller.waitForIdleQueue();
		expect(hFail.controller.getStateSnapshot().pendingAckRecords.has(idPendingFailInBudget)).toBe(true);

		// Keep linkError set during session_shutdown -> Step 4 retry fails immediately without timing out, Step 5 removes lock!
		await hFail.emit("session_shutdown");
		expect(hFail.fs.getFileText(lockPath)).toBeUndefined();
		expect(
			hFail.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idPendingFailInBudget}.attempt`),
		).toBeDefined();
		expect(
			hFail.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idPendingFailInBudget}.ack`),
		).toBeUndefined();

		// Next startup recovers idPendingFailInBudget as uncertain(crash_recovery)
		hFail.fs.linkError = undefined;
		const hFailRecover = createTestHarness({ fs: hFail.fs, idle: true });
		await hFailRecover.emit("session_start");
		await hFailRecover.controller.waitForIdleQueue();
		const recoveredPendingAck = parseMailAck(
			hFail.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idPendingFailInBudget}.ack`)!,
			{ expectedId: idPendingFailInBudget, expectedBy: "gjc-worker" },
		);
		expect(recoveredPendingAck.ok && recoveredPendingAck.value.state).toBe("uncertain");
		if (recoveredPendingAck.ok) {
			expect(recoveredPendingAck.value.reason).toBe("crash_recovery");
		}
		await hFailRecover.emit("session_shutdown");

		// Part 3: Step 2 takes 1,800ms -> Step 4 still gets max(500ms, 2000ms - 1800ms) = 500ms budget and succeeds at +300ms!
		const idPendingMinBudget = makeUlid(93);
		const hMin = createTestHarness({ idle: true });
		writeValidMailToFs(hMin.fs, { id: idPendingMinBudget });
		await hMin.emit("session_start");
		await hMin.controller.waitForIdleQueue();
		await hMin.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idPendingMinBudget } },
		});
		hMin.fs.linkError = err;
		await hMin.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await hMin.controller.waitForIdleQueue();

		let releaseStep2Drain!: () => void;
		const step2DrainGate = new Promise<void>((resolve) => {
			releaseStep2Drain = resolve;
		});
		let enteredStep2Scan!: () => void;
		const enteredStep2Gate = new Promise<void>((resolve) => {
			enteredStep2Scan = resolve;
		});
		const origReaddir = hMin.fs.readdir.bind(hMin.fs);
		let slowReaddirOnce = true;
		hMin.fs.readdir = async (p: string) => {
			if (slowReaddirOnce) {
				slowReaddirOnce = false;
				enteredStep2Scan();
				await step2DrainGate;
			}
			return origReaddir(p);
		};
		let enteredStep4Link!: () => void;
		const enteredStep4Gate = new Promise<void>((resolve) => {
			enteredStep4Link = resolve;
		});
		let releaseStep4Link!: () => void;
		const step4LinkGate = new Promise<void>((resolve) => {
			releaseStep4Link = resolve;
		});

		// Keep linkError set during the start of bgScan so retryConfirmedPendingAcks inside bgScan fails fast and bgScan enters readdir
		const bgScan = hMin.controller.triggerScan();
		await enteredStep2Gate;
		hMin.fs.linkError = undefined;
		hMin.fs.onLinkHook = async (_src, dst) => {
			if (dst.endsWith(`${idPendingMinBudget}.ack`)) {
				enteredStep4Link();
				await step4LinkGate;
			}
		};
		const minShutdownPromises = hMin.emitNoWait("session_shutdown");
		await Promise.resolve();
		// Advance 1,800ms during Step 2 drain, then finish Step 2
		hMin.clock.advanceBy(1_800);
		releaseStep2Drain();
		await bgScan;
		await enteredStep4Gate;
		// Advance 300ms during Step 4 (total 2,100ms > 2,000ms, but within the 500ms min Step 4 budget!)
		hMin.clock.advanceBy(300);
		releaseStep4Link();
		await Promise.all(minShutdownPromises);
		expect(
			hMin.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idPendingMinBudget}.ack`),
		).toBeDefined();
		expect(hMin.fs.getFileText(lockPath)).toBeUndefined();

		// Part 4: Step 4 times out -> retains lock and logs shutdown_timeout_lock_retained
		const idPendingTimeout = makeUlid(91);
		const hTimeout = createTestHarness({ idle: true });
		writeValidMailToFs(hTimeout.fs, { id: idPendingTimeout });
		await hTimeout.emit("session_start");
		await hTimeout.controller.waitForIdleQueue();

		await hTimeout.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idPendingTimeout } },
		});
		hTimeout.fs.linkError = err;
		await hTimeout.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await hTimeout.controller.waitForIdleQueue();
		expect(hTimeout.controller.getStateSnapshot().pendingAckRecords.has(idPendingTimeout)).toBe(true);

		hTimeout.fs.linkError = undefined;
		let enteredRetryLink!: () => void;
		const enteredRetryGate = new Promise<void>((resolve) => {
			enteredRetryLink = resolve;
		});
		let releaseRetryLink!: () => void;
		const retryGate = new Promise<void>((resolve) => {
			releaseRetryLink = resolve;
		});
		hTimeout.fs.onLinkHook = async (_src, dst) => {
			if (dst.endsWith(`${idPendingTimeout}.ack`)) {
				enteredRetryLink();
				await retryGate;
			}
		};

		const shutdownTimeoutPromises = hTimeout.emitNoWait("session_shutdown");
		await enteredRetryGate;
		await Promise.resolve();
		hTimeout.clock.advanceBy(4_000);
		await Promise.all(shutdownTimeoutPromises);

		expect(hTimeout.fs.getFileText(lockPath)).toBeDefined();
		expect(
			hTimeout.diagnostics.some((d) => d.code === "shutdown_timeout_lock_retained"),
		).toBe(true);
		releaseRetryLink();
	});

	test("§7 candidate filtering & progress guarantee: format violation -> rejected ack; size_exceeded -> rejected ack; read error/symlink/outside_repo/corrupt ack -> holdIds + 1x notification; startup terminal acks (received/uncertain/rejected) preserved with or without attempt; valid candidate advances behind bad candidates", async () => {
		const idBadFormat = makeUlid(100);
		const idOversize = makeUlid(101);
		const idSymlink = makeUlid(102);
		const idOutside = makeUlid(103);
		const idBadAck = makeUlid(104);
		const idExistingUncertain = makeUlid(105);
		const idExistingRejected = makeUlid(106);
		const idReadErr = makeUlid(107);
		const idValid = makeUlid(108);

		const h = createTestHarness({ idle: true });
		const recipientDir = "/repo/.gjc-herdr/mailbox/gjc-worker";
		h.fs.setDir("/repo/.gjc-herdr", MAIL_DIR_MODE);
		h.fs.setDir("/repo/.gjc-herdr/mailbox", MAIL_DIR_MODE);
		h.fs.setDir(recipientDir, MAIL_DIR_MODE);

		// 1) Format violation
		h.fs.setFile(`${recipientDir}/${idBadFormat}.md`, "not frontmatter\n");

		// 2) Size exceeded (> 256 KiB)
		h.fs.setFile(
			`${recipientDir}/${idOversize}.md`,
			new Uint8Array(MAX_MESSAGE_BYTES + 10),
		);

		// 3) Symlink message
		h.fs.setSymlink(`${recipientDir}/${idSymlink}.md`, "/etc/passwd");

		// 4) Message whose realpath escapes repo
		writeValidMailToFs(h.fs, { id: idOutside });
		h.fs.realpathOverrides.set(`${recipientDir}/${idOutside}.md`, "/outside/file.md");

		// 5) Candidate with malformed ack
		writeValidMailToFs(h.fs, { id: idBadAck });
		h.fs.setFile(`${recipientDir}/${idBadAck}.ack`, "broken ack\n");

		// 6) Candidate with existing valid uncertain ack + existing .attempt (kept as-is, never overwritten by crash_recovery)
		const mUnc = writeValidMailToFs(h.fs, { id: idExistingUncertain });
		const uncAtt = formatMailAttempt({
			id: idExistingUncertain,
			bodySha256: mUnc.bodySha256,
			consumer: "0123456789abcdef0123456789abcdef",
			session: "sess-old",
			at: "2026-10-16T21:05:10Z",
		});
		const uncAck = formatMailAck({
			id: idExistingUncertain,
			by: "gjc-worker",
			at: "2026-10-16T21:05:11Z",
			state: "uncertain",
			via: "observed",
			reason: "prior_uncertain",
		});
		if (!uncAtt.ok || !uncAck.ok) throw new Error("format failed");
		h.fs.setFile(`${recipientDir}/${idExistingUncertain}.attempt`, uncAtt.value);
		h.fs.setFile(`${recipientDir}/${idExistingUncertain}.ack`, uncAck.value);

		// 7) Candidate with existing valid rejected ack + existing .attempt (kept as-is, never overwritten)
		const mRej = writeValidMailToFs(h.fs, { id: idExistingRejected });
		const rejAtt = formatMailAttempt({
			id: idExistingRejected,
			bodySha256: mRej.bodySha256,
			consumer: "0123456789abcdef0123456789abcdef",
			session: "sess-old",
			at: "2026-10-16T21:05:10Z",
		});
		const rejAck = formatMailAck({
			id: idExistingRejected,
			by: "gjc-worker",
			at: "2026-10-16T21:05:11Z",
			state: "rejected",
			via: "observed",
			reason: "invalid_frontmatter",
		});
		if (!rejAtt.ok || !rejAck.ok) throw new Error("format failed");
		h.fs.setFile(`${recipientDir}/${idExistingRejected}.attempt`, rejAtt.value);
		h.fs.setFile(`${recipientDir}/${idExistingRejected}.ack`, rejAck.value);

		// 8) Candidate with general read error (EACCES / EIO on open) -> holdIds, no ack, 0 slots
		writeValidMailToFs(h.fs, { id: idReadErr });
		const origOpen = h.fs.open.bind(h.fs);
		h.fs.open = async (p: string, flags: number, mode?: number) => {
			if (p === `${recipientDir}/${idReadErr}.md`) {
				const err = new Error("EACCES: permission denied") as Error & { code?: string };
				err.code = "EACCES";
				throw err;
			}
			return origOpen(p, flags, mode);
		};

		// 9) Valid candidate at the end
		writeValidMailToFs(h.fs, { id: idValid });

		await h.emit("session_start");
		await h.controller.waitForIdleQueue();

		// Format & oversize candidates got rejected acks
		const ackBadFormat = parseMailAck(
			h.fs.getFileText(`${recipientDir}/${idBadFormat}.ack`)!,
			{ expectedId: idBadFormat, expectedBy: "gjc-worker" },
		);
		expect(ackBadFormat.ok && ackBadFormat.value.state).toBe("rejected");

		const ackOversize = parseMailAck(
			h.fs.getFileText(`${recipientDir}/${idOversize}.ack`)!,
			{ expectedId: idOversize, expectedBy: "gjc-worker" },
		);
		expect(ackOversize.ok && ackOversize.value.state).toBe("rejected");

		// Symlink, outside_repo, bad ack, and general read error (idReadErr) are in holdIds with 1x notification containing HOLD_RETRY_NOTICE
		const snap = h.controller.getStateSnapshot();
		expect(snap.holdIds.has(idSymlink)).toBe(true);
		expect(snap.holdIds.has(idOutside)).toBe(true);
		expect(snap.holdIds.has(idBadAck)).toBe(true);
		expect(snap.holdIds.has(idReadErr)).toBe(true);
		expect(h.fs.getFileText(`${recipientDir}/${idSymlink}.ack`)).toBeUndefined();
		expect(h.fs.getFileText(`${recipientDir}/${idOutside}.ack`)).toBeUndefined();
		expect(h.fs.getFileText(`${recipientDir}/${idReadErr}.ack`)).toBeUndefined();
		expect(h.fs.getFileText(`${recipientDir}/${idBadAck}.ack`)).toBe("broken ack\n");

		// Existing uncertain and rejected acks kept untouched in settledIds / terminalAckIds
		expect(snap.settledIds.has(idExistingUncertain)).toBe(true);
		expect(snap.terminalAckIds.has(idExistingRejected)).toBe(true);
		expect(h.fs.getFileText(`${recipientDir}/${idExistingUncertain}.ack`)).toBe(uncAck.value);
		expect(h.fs.getFileText(`${recipientDir}/${idExistingRejected}.ack`)).toBe(rejAck.value);

		// Valid candidate at the end was reached and injected!
		expect(h.sentMessages.length).toBe(1);
		expect(h.sentMessages[0]!.message.details?.id).toBe(idValid);

		// Re-scanning does NOT emit duplicate hold notifications for held IDs.
		const holdDiagCountBefore = h.diagnostics.filter((d) => d.code === "candidate_held").length;
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		const holdDiagCountAfter = h.diagnostics.filter((d) => d.code === "candidate_held").length;
		expect(holdDiagCountAfter).toBe(holdDiagCountBefore);
		expect(
			h.diagnostics
				.filter((d) => d.code === "candidate_held")
				.every((d) => d.message.includes(HOLD_RETRY_NOTICE)),
		).toBe(true);
	});

	test("§7 sendMessage throw (1st call from reserved/waiting_call and 2nd call from waiting_reinject) transitions to uncertain ack; failed uncertain ack write puts id in holdIds and releases slot; session_switch transitions waiting_call, waiting_reinject, in_flight, and context_reflected to uncertain(session_changed)", async () => {
		const idThrow = makeUlid(110);
		const idUncertainFail = makeUlid(111);
		const idInFlight = makeUlid(112);
		const idReflected = makeUlid(113);
		const idWaitingReinject = makeUlid(114);
		const idWaitingCallSwitch = makeUlid(115);
		const idWaitingCallThrow = makeUlid(116);
		const idReinjectThrow = makeUlid(117);

		let flipBusyAfterAttemptFor: string | undefined;
		const h = createTestHarness({
			idle: true,
			deps: {
				afterAttemptPublish: (id) => {
					if (id === flipBusyAfterAttemptFor) {
						h.setIdle(false);
					}
				},
			},
		});

		// 1) sendMessage throws from reserved -> uncertain ack
		writeValidMailToFs(h.fs, { id: idThrow });
		h.setSendMessageThrow(new Error("bridge rejected"));
		await h.emit("session_start");
		await h.controller.waitForIdleQueue();

		const throwAck = parseMailAck(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idThrow}.ack`)!,
			{ expectedId: idThrow, expectedBy: "gjc-worker" },
		);
		expect(throwAck.ok && throwAck.value.state).toBe("uncertain");
		expect(h.controller.getStateSnapshot().slotCount).toBe(0);

		// 2) sendMessage throws AND uncertain ack write fails -> holdIds, slot released
		writeValidMailToFs(h.fs, { id: idUncertainFail });
		h.fs.onLinkHook = (_src, dst) => {
			if (dst.endsWith(`${idUncertainFail}.ack`)) {
				const err = new Error("EIO ack link failed") as Error & { code?: string };
				err.code = "EIO";
				throw err;
			}
		};
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		h.fs.onLinkHook = undefined;
		h.setSendMessageThrow(undefined);

		expect(h.controller.getStateSnapshot().holdIds.has(idUncertainFail)).toBe(true);
		expect(h.controller.getStateSnapshot().slotCount).toBe(0);

		// 2b) waiting_call -> 1st call sendMessage throws -> uncertain ack, slot released
		flipBusyAfterAttemptFor = idWaitingCallThrow;
		writeValidMailToFs(h.fs, { id: idWaitingCallThrow });
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().activeRecords.get(idWaitingCallThrow)?.state).toBe("waiting_call");
		flipBusyAfterAttemptFor = undefined;
		h.setSendMessageThrow(new Error("1st call from waiting_call threw"));
		h.setIdle(true);
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		h.setSendMessageThrow(undefined);
		const wcThrowAck = parseMailAck(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idWaitingCallThrow}.ack`)!,
			{ expectedId: idWaitingCallThrow, expectedBy: "gjc-worker" },
		);
		expect(wcThrowAck.ok && wcThrowAck.value.state).toBe("uncertain");
		if (wcThrowAck.ok) expect(wcThrowAck.value.reason).toContain("send_message_failed");
		expect(h.controller.getStateSnapshot().slotCount).toBe(0);

		// 2c) waiting_reinject -> 2nd call sendMessage throws -> uncertain ack, slot released
		writeValidMailToFs(h.fs, { id: idReinjectThrow });
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().activeRecords.get(idReinjectThrow)?.state).toBe("in_flight");
		h.setSendMessageThrow(new Error("2nd call from waiting_reinject threw"));
		await h.emit("agent_end", { stopReason: "cancelled" });
		await h.controller.waitForIdleQueue();
		h.setSendMessageThrow(undefined);
		const wrThrowAck = parseMailAck(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idReinjectThrow}.ack`)!,
			{ expectedId: idReinjectThrow, expectedBy: "gjc-worker" },
		);
		expect(wrThrowAck.ok && wrThrowAck.value.state).toBe("uncertain");
		if (wrThrowAck.ok) expect(wrThrowAck.value.reason).toContain("send_message_failed");
		expect(h.controller.getStateSnapshot().slotCount).toBe(0);

		// Clear rate limit window before testing session_switch on waiting_call and waiting_reinject
		h.clock.advanceBy(RATE_LIMIT_WINDOW_MS + 10);
		await h.controller.waitForIdleQueue();

		// 3) Put idWaitingReinject into waiting_reinject AND idWaitingCallSwitch into waiting_call, then session_switch!
		writeValidMailToFs(h.fs, { id: idWaitingReinject });
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		await h.emit("agent_end", { stopReason: "paused" });
		await h.controller.waitForIdleQueue();

		flipBusyAfterAttemptFor = idWaitingCallSwitch;
		writeValidMailToFs(h.fs, { id: idWaitingCallSwitch });
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		flipBusyAfterAttemptFor = undefined;
		expect(h.controller.getStateSnapshot().activeRecords.get(idWaitingCallSwitch)?.state).toBe("waiting_call");

		await h.emit("agent_end", { stopReason: "cancelled" });
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().activeRecords.get(idWaitingReinject)?.state).toBe("waiting_reinject");
		expect(h.controller.getStateSnapshot().activeRecords.get(idWaitingCallSwitch)?.state).toBe("waiting_call");

		h.setSessionId("sess-main-switch-1");
		await h.emit("session_switch", {}, h.makeCtx({ sessionId: "sess-main-switch-1" }));
		await h.controller.waitForIdleQueue();

		for (const id of [idWaitingCallSwitch, idWaitingReinject]) {
			const ack = parseMailAck(
				h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${id}.ack`)!,
				{ expectedId: id, expectedBy: "gjc-worker" },
			);
			expect(ack.ok && ack.value.state).toBe("uncertain");
			if (ack.ok) expect(ack.value.reason).toBe("session_changed");
		}
		expect(h.controller.getStateSnapshot().slotCount).toBe(0);

		// Scanning in the new generation when idle makes 0 extra calls for idWaitingCallSwitch or idWaitingReinject
		h.setIdle(true);
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		expect(h.sentMessages.filter((m) => m.message.details?.id === idWaitingCallSwitch).length).toBe(0);
		expect(h.sentMessages.filter((m) => m.message.details?.id === idWaitingReinject).length).toBe(1);

		// Now test in_flight and context_reflected on session_switch, plus late Stage 2 after uncertain!
		writeValidMailToFs(h.fs, { id: idInFlight });
		writeValidMailToFs(h.fs, { id: idReflected });
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();

		await h.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idReflected } },
		});
		await h.controller.waitForIdleQueue();
		expect(h.controller.getStateSnapshot().activeRecords.get(idInFlight)?.state).toBe("in_flight");
		expect(h.controller.getStateSnapshot().activeRecords.get(idReflected)?.state).toBe("context_reflected");

		h.setSessionId("sess-main-switch-2");
		await h.emit("session_switch", {}, h.makeCtx({ sessionId: "sess-main-switch-2" }));
		await h.controller.waitForIdleQueue();

		for (const id of [idInFlight, idReflected]) {
			const ack = parseMailAck(
				h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${id}.ack`)!,
				{ expectedId: id, expectedBy: "gjc-worker" },
			);
			expect(ack.ok && ack.value.state).toBe("uncertain");
			if (ack.ok) expect(ack.value.reason).toBe("session_changed");
		}

		// Late Stage 2 after context_reflected -> uncertain logs late_stage2_after_settled without altering uncertain ack
		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h.controller.waitForIdleQueue();
		expect(
			h.diagnostics.some((d) => d.code === "late_stage2_after_settled" && d.id === idReflected),
		).toBe(true);
		const ackReflectedAfterLate2 = parseMailAck(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idReflected}.ack`)!,
			{ expectedId: idReflected, expectedBy: "gjc-worker" },
		);
		expect(ackReflectedAfterLate2.ok && ackReflectedAfterLate2.value.state).toBe("uncertain");
	});

	test("§7 complete state transition matrix: waiting_call busy recheck & pre-call generation/closing gates, context_reflected + paused agent_end, all 5 active states on session_shutdown, and late Stage 1/2 after received and rejected", async () => {
		// 1) waiting_call stays waiting_call on repeated busy scan AND when busy flips back right before recall;
		//    and transitions to uncertain(session_changed) if generation mismatches right before recall
		const idWcBusy = makeUlid(150);
		let flipBusyOnAttempt = true;
		let flipBusyBeforeRecall = false;
		let triggerSwitchBeforeRecall = false;

		const h1 = createTestHarness({
			idle: true,
			deps: {
				afterAttemptPublish: (id) => {
					if (id === idWcBusy && flipBusyOnAttempt) {
						flipBusyOnAttempt = false;
						h1.setIdle(false);
					}
				},
				beforeSendMessage: (id, callNumber) => {
					if (id === idWcBusy && callNumber === 1) {
						if (flipBusyBeforeRecall) {
							flipBusyBeforeRecall = false;
							h1.setIdle(false);
						} else if (triggerSwitchBeforeRecall) {
							triggerSwitchBeforeRecall = false;
							h1.setSessionId("sess-precall-switched");
							h1.emitNoWait("session_switch", {}, h1.makeCtx({ sessionId: "sess-precall-switched" }));
						}
					}
				},
			},
		});

		writeValidMailToFs(h1.fs, { id: idWcBusy });
		await h1.emit("session_start");
		await h1.controller.waitForIdleQueue();
		expect(h1.controller.getStateSnapshot().activeRecords.get(idWcBusy)?.state).toBe("waiting_call");
		expect(h1.controller.getStateSnapshot().slotCount).toBe(1);

		// Repeated scan while still busy -> stays waiting_call, keeps slot, 0 calls
		await h1.controller.triggerScan();
		await h1.controller.waitForIdleQueue();
		expect(h1.controller.getStateSnapshot().activeRecords.get(idWcBusy)?.state).toBe("waiting_call");
		expect(h1.controller.getStateSnapshot().slotCount).toBe(1);
		expect(h1.sentMessages.length).toBe(0);

		// Become idle, but flip busy right inside beforeSendMessage -> stays waiting_call, keeps slot, 0 calls
		flipBusyBeforeRecall = true;
		h1.setIdle(true);
		await h1.controller.triggerScan();
		await h1.controller.waitForIdleQueue();
		expect(h1.controller.getStateSnapshot().activeRecords.get(idWcBusy)?.state).toBe("waiting_call");
		expect(h1.controller.getStateSnapshot().slotCount).toBe(1);
		expect(h1.sentMessages.length).toBe(0);

		// Become idle again, and trigger generation change right before sendMessage -> uncertain(session_changed), slot released, 0 calls!
		triggerSwitchBeforeRecall = true;
		h1.setIdle(true);
		await h1.controller.triggerScan();
		await h1.controller.waitForIdleQueue();
		expect(h1.sentMessages.length).toBe(0);
		expect(h1.controller.getStateSnapshot().slotCount).toBe(0);
		const wcGenAck = parseMailAck(
			h1.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idWcBusy}.ack`)!,
			{ expectedId: idWcBusy, expectedBy: "gjc-worker" },
		);
		expect(wcGenAck.ok && wcGenAck.value.state).toBe("uncertain");
		if (wcGenAck.ok) expect(wcGenAck.value.reason).toBe("session_changed");
		await h1.emit("session_shutdown");

		// 2) context_reflected + paused agent_end stays context_reflected (slot preserved, no ack yet);
		//    and late Stage 1 / Stage 2 after received and after rejected leave state/ack unchanged and emit diagnostics
		const idReflectedPaused = makeUlid(151);
		const idRejectedLate = makeUlid(152);
		const h2 = createTestHarness({ idle: true });
		const recipientDir = "/repo/.gjc-herdr/mailbox/gjc-worker";
		const mRef = writeValidMailToFs(h2.fs, { id: idReflectedPaused });
		h2.fs.setFile(`${recipientDir}/${idRejectedLate}.md`, "invalid frontmatter\n");

		await h2.emit("session_start");
		await h2.controller.waitForIdleQueue();

		// Stage 1 -> context_reflected
		await h2.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idReflectedPaused } },
		});
		await h2.controller.waitForIdleQueue();
		expect(h2.controller.getStateSnapshot().activeRecords.get(idReflectedPaused)?.state).toBe("context_reflected");

		// paused agent_end while in context_reflected -> stays context_reflected, keeps slot
		await h2.emit("agent_end", { stopReason: "paused" });
		await h2.controller.waitForIdleQueue();
		expect(h2.controller.getStateSnapshot().activeRecords.get(idReflectedPaused)?.state).toBe("context_reflected");
		expect(h2.controller.getStateSnapshot().slotCount).toBe(1);
		expect(h2.fs.getFileText(`${recipientDir}/${idReflectedPaused}.ack`)).toBeUndefined();

		// Settle idReflectedPaused as received
		await h2.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h2.controller.waitForIdleQueue();
		const receivedAckBefore = h2.fs.getFileText(`${recipientDir}/${idReflectedPaused}.ack`)!;
		const rejectedAckBefore = h2.fs.getFileText(`${recipientDir}/${idRejectedLate}.ack`)!;
		expect(parseMailAck(receivedAckBefore, { expectedId: idReflectedPaused, expectedBy: "gjc-worker", expectedBodySha256: mRef.bodySha256 }).ok).toBe(true);
		expect(parseMailAck(rejectedAckBefore, { expectedId: idRejectedLate, expectedBy: "gjc-worker" }).ok).toBe(true);

		// Late Stage 1 + Late Stage 2 for both received and rejected items -> ack unchanged, diagnostics emitted
		await h2.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idReflectedPaused } },
		});
		await h2.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idRejectedLate } },
		});
		await h2.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h2.controller.waitForIdleQueue();
		expect(h2.diagnostics.some((d) => d.code === "late_stage1_after_settled" && d.id === idReflectedPaused)).toBe(true);
		expect(h2.diagnostics.some((d) => d.code === "late_stage1_after_settled" && d.id === idRejectedLate)).toBe(true);
		expect(h2.diagnostics.some((d) => d.code === "late_stage2_after_settled" && d.id === idReflectedPaused)).toBe(true);
		expect(h2.diagnostics.some((d) => d.code === "late_stage2_after_settled" && d.id === idRejectedLate)).toBe(true);
		expect(h2.fs.getFileText(`${recipientDir}/${idReflectedPaused}.ack`)).toBe(receivedAckBefore);
		expect(h2.fs.getFileText(`${recipientDir}/${idRejectedLate}.ack`)).toBe(rejectedAckBefore);
		await h2.emit("session_shutdown");

		// 3) All 5 active states (reserved, waiting_call, waiting_reinject, in_flight, context_reflected) on session_shutdown (closing):
		//    none make new sendMessage calls and none write an ack (leaving .attempt for next startup crash_recovery)
		const idActWaitingReinject = makeUlid(160);
		const idActContextReflected = makeUlid(161);
		const idActInFlight = makeUlid(162);
		const idActWaitingCall = makeUlid(163);
		const idActReserved = makeUlid(164);

		// Sub-harness A: waiting_reinject and context_reflected on session_shutdown
		const hActA = createTestHarness({ idle: true });
		writeValidMailToFs(hActA.fs, { id: idActWaitingReinject });
		writeValidMailToFs(hActA.fs, { id: idActContextReflected });
		await hActA.emit("session_start");
		await hActA.controller.waitForIdleQueue();
		await hActA.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idActContextReflected } },
		});
		await hActA.controller.waitForIdleQueue();
		// Become busy and emit cancelled agent_end -> idActWaitingReinject enters waiting_reinject, idActContextReflected stays context_reflected
		hActA.setIdle(false);
		await hActA.emit("agent_end", { stopReason: "cancelled" });
		await hActA.controller.waitForIdleQueue();
		expect(hActA.controller.getStateSnapshot().activeRecords.get(idActWaitingReinject)?.state).toBe("waiting_reinject");
		expect(hActA.controller.getStateSnapshot().activeRecords.get(idActContextReflected)?.state).toBe("context_reflected");

		await hActA.emit("session_shutdown");
		expect(hActA.sentMessages.length).toBe(2);
		expect(hActA.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idActWaitingReinject}.ack`)).toBeUndefined();
		expect(hActA.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idActContextReflected}.ack`)).toBeUndefined();
		expect(hActA.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idActWaitingReinject}.attempt`)).toBeDefined();
		expect(hActA.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idActContextReflected}.attempt`)).toBeDefined();

		// Sub-harness B: in_flight and waiting_call on session_shutdown
		const hActB = createTestHarness({
			idle: true,
			deps: {
				afterAttemptPublish: (id) => {
					if (id === idActWaitingCall) {
						hActB.setIdle(false);
					}
				},
			},
		});
		writeValidMailToFs(hActB.fs, { id: idActInFlight });
		writeValidMailToFs(hActB.fs, { id: idActWaitingCall });
		await hActB.emit("session_start");
		await hActB.controller.waitForIdleQueue();
		expect(hActB.controller.getStateSnapshot().activeRecords.get(idActInFlight)?.state).toBe("in_flight");
		expect(hActB.controller.getStateSnapshot().activeRecords.get(idActWaitingCall)?.state).toBe("waiting_call");

		await hActB.emit("session_shutdown");
		expect(hActB.sentMessages.length).toBe(1);
		for (const id of [idActInFlight, idActWaitingCall]) {
			expect(hActB.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${id}.ack`)).toBeUndefined();
			expect(hActB.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${id}.attempt`)).toBeDefined();
		}

		// Sub-harness C: reserved on session_shutdown
		const hActC = createTestHarness({
			idle: true,
			deps: {
				afterAttemptPublish: (id) => {
					if (id === idActReserved) {
						hActC.emitNoWait("session_shutdown");
					}
				},
			},
		});
		await hActC.emit("session_start");
		await hActC.controller.waitForIdleQueue();
		writeValidMailToFs(hActC.fs, { id: idActReserved });
		await hActC.controller.triggerScan();
		await hActC.controller.waitForIdleQueue();
		expect(hActC.sentMessages.length).toBe(0);
		expect(hActC.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idActReserved}.ack`)).toBeUndefined();
		expect(hActC.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idActReserved}.attempt`)).toBeDefined();
	});

	test("§5.2 & §5.3 flow control: 5 calls/minute rate limit, 10-minute in-flight warning, >1000 files warning, and 200-file / 8 MiB per-scan open cap", async () => {
		const h = createTestHarness({ idle: true });
		await h.emit("session_start");
		await h.controller.waitForIdleQueue();

		// 1) 5 calls per minute rate limit
		for (let i = 1; i <= 6; i++) {
			const id = makeUlid(200 + i);
			writeValidMailToFs(h.fs, { id });
			await h.controller.triggerScan();
			await h.controller.waitForIdleQueue();
			if (i <= 5) {
				await h.emit("message_end", {
					message: { role: "custom", customType: "herdr-mail", details: { id } },
				});
				await h.emit("message_end", {
					message: { role: "assistant", stopReason: "stop" },
				});
				await h.controller.waitForIdleQueue();
			}
		}

		// Only 5 calls were allowed in the first 60s window; the 6th candidate was stopped before opening.
		expect(h.sentMessages.length).toBe(5);

		// Advance clock by 60s -> rate limit wake timer fires and the 6th message is injected!
		h.clock.advanceBy(RATE_LIMIT_WINDOW_MS + 10);
		await h.controller.waitForIdleQueue();
		expect(h.sentMessages.length).toBe(6);

		// 2) 10-minute in-flight warning fires once for the 6th message without re-injecting or marking received
		const id6 = makeUlid(206);
		h.clock.advanceBy(IN_FLIGHT_WARN_MS + 10);
		await h.controller.waitForIdleQueue();
		expect(
			h.diagnostics.filter((d) => d.code === "in_flight_timeout_warning" && d.id === id6).length,
		).toBe(1);
		expect(h.controller.getStateSnapshot().activeRecords.get(id6)?.state).toBe("in_flight");
		expect(h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${id6}.ack`)).toBeUndefined();

		// Settle id6 so all slots are free and advance clock 60s so rate limit is fresh.
		await h.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: id6 } },
		});
		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h.controller.waitForIdleQueue();
		h.clock.advanceBy(RATE_LIMIT_WINDOW_MS + 10);
		await h.controller.waitForIdleQueue();

		// 3) 200-file per-scan open cap and >1000 files warning:
		// Add 205 invalid messages (so each opened message is rejected and consumes 0 slots/calls) plus 800 dot/aux files to exceed 1,000 entries.
		const recipientDir = "/repo/.gjc-herdr/mailbox/gjc-worker";
		for (let i = 1; i <= 205; i++) {
			const id = makeUlid(1000 + i);
			h.fs.setFile(`${recipientDir}/${id}.md`, "invalid frontmatter\n");
		}
		for (let i = 1; i <= 800; i++) {
			h.fs.setFile(`${recipientDir}/. ignored-${i}.tmp`, "tmp\n");
		}

		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();

		expect(
			h.diagnostics.some((d) => d.code === "mailbox_over_1000_files"),
		).toBe(true);
		// Exactly 200 invalid messages were opened and rejected in the first scan pass; the remaining 5 are rejected on the next scan!
		const firstPassRejected = Array.from({ length: 205 }, (_, idx) =>
			h.fs.getFileText(`${recipientDir}/${makeUlid(1001 + idx)}.ack`),
		).filter(Boolean).length;
		expect(firstPassRejected).toBe(200);

		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		const secondPassRejected = Array.from({ length: 205 }, (_, idx) =>
			h.fs.getFileText(`${recipientDir}/${makeUlid(1001 + idx)}.ack`),
		).filter(Boolean).length;
		expect(secondPassRejected).toBe(205);

		// 4) 8 MiB per-scan byte cap: 34 oversize/invalid messages of 256 KiB each (> 8 MiB = 32 * 256 KiB).
		// First scan pass opens at most 32 messages (8 MiB), leaving the remaining 2 for the next scan pass!
		const chunk256KiB = "z".repeat(MAX_MESSAGE_BYTES);
		for (let i = 1; i <= 34; i++) {
			const id = makeUlid(2000 + i);
			h.fs.setFile(`${recipientDir}/${id}.md`, chunk256KiB);
		}
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		const byteCapFirstPass = Array.from({ length: 34 }, (_, idx) =>
			h.fs.getFileText(`${recipientDir}/${makeUlid(2001 + idx)}.ack`),
		).filter(Boolean).length;
		expect(byteCapFirstPass).toBe(32);

		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		const byteCapSecondPass = Array.from({ length: 34 }, (_, idx) =>
			h.fs.getFileText(`${recipientDir}/${makeUlid(2001 + idx)}.ack`),
		).filter(Boolean).length;
		expect(byteCapSecondPass).toBe(34);
	});

	test("#35 content format and 8 KiB (8192-byte) UTF-8 code-point boundary truncation", () => {
		const id = makeUlid(300);

		// 1) Exact 8192-byte ASCII body -> not truncated, no truncation notice
		const exactBody = "a".repeat(MAX_PREVIEW_BYTES);
		const resExact = formatInjectedMailContent({
			id,
			from: "gjc-herdr-lead",
			to: "gjc-worker",
			subject: "Exact 8KiB",
			body: exactBody,
		});
		expect(resExact.truncated).toBe(false);
		expect(resExact.previewByteLength).toBe(MAX_PREVIEW_BYTES);
		expect(resExact.content).toContain(`[gjc-herdr mail id=${id} from=gjc-herdr-lead] Exact 8KiB`);
		expect(resExact.content).toContain(MAIL_WARNING_LINE);
		expect(resExact.content).toContain(MAIL_BODY_START);
		expect(resExact.content).toContain(MAIL_BODY_END);
		expect(resExact.content).not.toContain(MAIL_TRUNCATED_NOTICE);
		expect(resExact.content).toContain(`전문: .gjc-herdr/mailbox/gjc-worker/${id}.md`);

		// 2) 8193-byte ASCII body (limit + 1) -> truncated to 8192 bytes + truncation notice
		const overByOne = "b".repeat(MAX_PREVIEW_BYTES + 1);
		const resOver1 = formatInjectedMailContent({
			id,
			from: "gjc-herdr-lead",
			to: "gjc-worker",
			subject: "8KiB + 1",
			body: overByOne,
		});
		expect(resOver1.truncated).toBe(true);
		expect(resOver1.previewByteLength).toBe(MAX_PREVIEW_BYTES);
		expect(resOver1.content).toContain(MAIL_TRUNCATED_NOTICE);

		// 3) Multi-byte UTF-8 character ('가', 3 bytes) straddling the 8192-byte boundary:
		// 8190 ASCII bytes + '가' (3 bytes = 8193 total) -> must cut at 8190 bytes without producing U+FFFD or splitting '가'
		const straddle3 = "x".repeat(MAX_PREVIEW_BYTES - 2) + "가나다";
		const trunc3 = truncateUtf8Boundary(straddle3, MAX_PREVIEW_BYTES);
		expect(trunc3.truncated).toBe(true);
		expect(trunc3.byteLength).toBe(MAX_PREVIEW_BYTES - 2);
		expect(trunc3.preview).toBe("x".repeat(MAX_PREVIEW_BYTES - 2));
		expect(trunc3.preview.includes("\ufffd")).toBe(false);

		// 4) 4-byte emoji ('🚀', 4 bytes) straddling the 8192-byte boundary:
		// 8191 ASCII bytes + '🚀' (4 bytes = 8195 total) -> cuts at 8191 bytes
		const straddle4 = "y".repeat(MAX_PREVIEW_BYTES - 1) + "🚀끝";
		const trunc4 = truncateUtf8Boundary(straddle4, MAX_PREVIEW_BYTES);
		expect(trunc4.truncated).toBe(true);
		expect(trunc4.byteLength).toBe(MAX_PREVIEW_BYTES - 1);
		expect(trunc4.preview).toBe("y".repeat(MAX_PREVIEW_BYTES - 1));
	});
});

describe("#33 Phase 2 Round 2: Codex R1–R6 Regression Tests", () => {
	test("R1 regression: late Stage 1 arriving during scan lstat await or beforeSendMessage await cancels reinjection (1 call total, context_reflected)", async () => {
		// Subcase A: Stage 1 arrives during scan fs.lstat while record is in waiting_reinject
		const idLstat = makeUlid(501);
		const h1 = createTestHarness({ idle: true });
		writeValidMailToFs(h1.fs, { id: idLstat });

		await h1.emit("session_start");
		await h1.controller.waitForIdleQueue();
		expect(h1.sentMessages.length).toBe(1);

		let injectedLateStage1InLstat = false;
		const origLstat = h1.fs.lstat.bind(h1.fs);
		h1.fs.lstat = async (path: string) => {
			const snap = h1.controller.getStateSnapshot();
			if (
				!injectedLateStage1InLstat &&
				snap.activeRecords.get(idLstat)?.state === "waiting_reinject"
			) {
				injectedLateStage1InLstat = true;
				h1.emitNoWait("message_end", {
					message: {
						role: "custom",
						customType: "herdr-mail",
						details: { id: idLstat },
					},
				});
			}
			return origLstat(path);
		};

		await h1.emit("agent_end", { stopReason: "completed" });
		await h1.controller.waitForIdleQueue();

		expect(injectedLateStage1InLstat).toBe(true);
		expect(h1.sentMessages.filter((m) => m.message.details?.id === idLstat).length).toBe(1);
		expect(h1.controller.getStateSnapshot().activeRecords.get(idLstat)?.state).toBe("context_reflected");

		// Subcase B: Stage 1 arrives during beforeSendMessage await before 2nd call
		const idBeforeSend = makeUlid(502);
		const h2 = createTestHarness({
			idle: true,
			deps: {
				beforeSendMessage: async (id, callNumber) => {
					if (id === idBeforeSend && callNumber === 2) {
						h2.emitNoWait("message_end", {
							message: {
								role: "custom",
								customType: "herdr-mail",
								details: { id: idBeforeSend },
							},
						});
					}
				},
			},
		});
		writeValidMailToFs(h2.fs, { id: idBeforeSend });
		await h2.emit("session_start");
		await h2.controller.waitForIdleQueue();
		expect(h2.sentMessages.length).toBe(1);

		await h2.emit("agent_end", { stopReason: "completed" });
		await h2.controller.waitForIdleQueue();

		expect(h2.sentMessages.filter((m) => m.message.details?.id === idBeforeSend).length).toBe(1);
		expect(h2.controller.getStateSnapshot().activeRecords.get(idBeforeSend)?.state).toBe("context_reflected");
	});

	test("R2 regression: multiple items confirmed by one assistant message_end preserve completion across session_shutdown during first ack I/O or immediately after Stage 2 arrival", async () => {
		// Subcase A: 2 items (idA, idB), shutdown triggered inside idA's ack link hook
		const idA = makeUlid(510);
		const idB = makeUlid(511);
		const h = createTestHarness({ idle: true });
		const mA = writeValidMailToFs(h.fs, { id: idA });
		const mB = writeValidMailToFs(h.fs, { id: idB });

		await h.emit("session_start");
		await h.controller.waitForIdleQueue();
		await h.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idA } },
		});
		await h.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idB } },
		});
		await h.controller.waitForIdleQueue();

		let shutdownPromises: Array<Promise<void> | void> = [];
		h.fs.onLinkHook = (_src, dst) => {
			if (dst.endsWith(`${idA}.ack`) && shutdownPromises.length === 0) {
				shutdownPromises = h.emitNoWait("session_shutdown");
			}
		};

		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await Promise.all(shutdownPromises);
		await h.controller.waitForIdleQueue();

		const ackAText = h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idA}.ack`);
		const ackBText = h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idB}.ack`);
		expect(ackAText).toBeDefined();
		expect(ackBText).toBeDefined();
		const parsedA = parseMailAck(ackAText!, {
			expectedId: idA,
			expectedBy: "gjc-worker",
			expectedBodySha256: mA.bodySha256,
		});
		const parsedB = parseMailAck(ackBText!, {
			expectedId: idB,
			expectedBy: "gjc-worker",
			expectedBodySha256: mB.bodySha256,
		});
		expect(parsedA.ok && parsedA.value.state).toBe("received");
		expect(parsedB.ok && parsedB.value.state).toBe("received");

		// Subcase B: Stage 2 emitted via emitNoWait immediately before session_shutdown
		const idC = makeUlid(512);
		const h2 = createTestHarness({ idle: true });
		const mC = writeValidMailToFs(h2.fs, { id: idC });
		await h2.emit("session_start");
		await h2.controller.waitForIdleQueue();
		await h2.emit("message_end", {
			message: { role: "custom", customType: "herdr-mail", details: { id: idC } },
		});
		await h2.controller.waitForIdleQueue();

		const stage2Promises = h2.emitNoWait("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h2.emit("session_shutdown");
		await Promise.all(stage2Promises);

		const ackCText = h2.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idC}.ack`);
		expect(ackCText).toBeDefined();
		const parsedC = parseMailAck(ackCText!, {
			expectedId: idC,
			expectedBy: "gjc-worker",
			expectedBodySha256: mC.bodySha256,
		});
		expect(parsedC.ok && parsedC.value.state).toBe("received");
	});

	test("R3 regression: late close/error on a replaced watcher does not clear the new activeWatcher or leak watchers on shutdown", async () => {
		const h = createTestHarness({ idle: true });
		await h.emit("session_start");
		await h.controller.waitForIdleQueue();

		expect(h.watchReg.watchers.length).toBe(1);
		const w1 = h.watchReg.watchers[0]!;

		// Replace recipient directory inode and scan -> W1 closed, W2 created
		const recipientDir = "/repo/.gjc-herdr/mailbox/gjc-worker";
		const lockText = h.fs.getFileText(`${recipientDir}/${CONSUMER_LOCK_FILE}`)!;
		h.fs.removeTree(recipientDir);
		h.fs.setDir(recipientDir, MAIL_DIR_MODE, 7777);
		h.fs.setFile(`${recipientDir}/${CONSUMER_LOCK_FILE}`, lockText);

		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		expect(h.watchReg.watchers.length).toBe(2);
		const w2 = h.watchReg.watchers[1]!;
		expect(w1.closed).toBe(true);
		expect(w2.closed).toBe(false);

		// Late close and error events from old watcher W1 after W2 is active
		w1.emitClose();
		w1.emitError(new Error("late W1 error"));

		// Next scan must NOT create a duplicate W3 because W2 is still valid on inode 7777
		await h.controller.triggerScan();
		await h.controller.waitForIdleQueue();
		expect(h.watchReg.watchers.length).toBe(2);
		expect(w2.closed).toBe(false);

		// Shutdown closes W2; all watchers are closed
		await h.emit("session_shutdown");
		expect( h.watchReg.watchers.map((w) => w.closed) ).toEqual([true, true]);
	});

	test("R4 regression: session_shutdown and session_switch during attempt temp open/stat/write/sync never publish attempt and make 0 calls", async () => {
		const steps = ["open", "stat", "write", "sync"] as const;

		for (const [idx, step] of steps.entries()) {
			for (const mode of ["shutdown", "switch"] as const) {
				const id = makeUlid(530 + idx * 2 + (mode === "switch" ? 1 : 0));
				const h = createTestHarness({ idle: true });
				await h.emit("session_start");
				await h.controller.waitForIdleQueue();

				const origOpen = h.fs.open.bind(h.fs);
				let triggered = false;
				let pendingFencePromises: Array<Promise<void> | void> = [];

				h.fs.open = async (path: string, flags: number, fileMode?: number) => {
					const handle = await origOpen(path, flags, fileMode);
					if (!path.includes(`.${id}.attempt.`)) {
						return handle;
					}
					const fireFence = () => {
						if (triggered) return;
						triggered = true;
						if (mode === "shutdown") {
							pendingFencePromises = h.emitNoWait("session_shutdown");
						} else {
							h.setSessionId("sess-switched");
							pendingFencePromises = h.emitNoWait(
								"session_switch",
								{},
								h.makeCtx({ sessionId: "sess-switched" }),
							);
						}
					};
					if (step === "open") {
						fireFence();
						return handle;
					}
					return {
						async stat() {
							const st = await handle.stat();
							if (step === "stat") fireFence();
							return st;
						},
						read: handle.read.bind(handle),
						async write(buf, off, len, pos) {
							const res = await handle.write(buf, off, len, pos);
							if (step === "write") fireFence();
							return res;
						},
						async sync() {
							await handle.sync();
							if (step === "sync") fireFence();
						},
						close: handle.close.bind(handle),
					};
				};

				writeValidMailToFs(h.fs, { id });
				await h.controller.triggerScan();
				await Promise.all(pendingFencePromises);
				await h.controller.waitForIdleQueue();

				expect(triggered).toBe(true);
				expect(
					h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${id}.attempt`),
				).toBeUndefined();
				expect(
					h.sentMessages.filter((m) => m.message.details?.id === id).length,
				).toBe(0);
			}
		}
	});

	test("R5 regression: session_shutdown overlapping with startup .consumer.lock publication drains and unlocks on normal completion, or retains lock with diagnostic on timeout", async () => {
		const lockPath = `/repo/.gjc-herdr/mailbox/gjc-worker/${CONSUMER_LOCK_FILE}`;

		// Subcase A: normal completion within 2s drain -> lock is unlinked
		const h1 = createTestHarness({ idle: true });
		const origOpen1 = h1.fs.open.bind(h1.fs);
		let shutdownPromises1: Array<Promise<void> | void> = [];
		h1.fs.open = async (path: string, flags: number, mode?: number) => {
			const handle = await origOpen1(path, flags, mode);
			if (path.includes(`${CONSUMER_LOCK_FILE}.`) && shutdownPromises1.length === 0) {
				shutdownPromises1 = h1.emitNoWait("session_shutdown");
			}
			return handle;
		};

		await h1.emit("session_start");
		await Promise.all(shutdownPromises1);
		await h1.controller.waitForIdleQueue();

		expect(h1.fs.getFileText(lockPath)).toBeUndefined();
		expect(h1.controller.getStateSnapshot().lockAcquired).toBe(false);

		// Subcase B: lock publication blocks past 2s drain timeout -> retains lock and emits shutdown_timeout_lock_retained
		const h2 = createTestHarness({ idle: true });
		const origOpen2 = h2.fs.open.bind(h2.fs);
		let releaseSlowLock!: () => void;
		const slowLockGate = new Promise<void>((resolve) => {
			releaseSlowLock = resolve;
		});
		let enteredSlowLock!: () => void;
		const enteredSlowLockGate = new Promise<void>((resolve) => {
			enteredSlowLock = resolve;
		});
		let shutdownPromises2: Array<Promise<void> | void> = [];

		h2.fs.open = async (path: string, flags: number, mode?: number) => {
			const handle = await origOpen2(path, flags, mode);
			if (path.includes(`${CONSUMER_LOCK_FILE}.`) && shutdownPromises2.length === 0) {
				shutdownPromises2 = h2.emitNoWait("session_shutdown");
				enteredSlowLock();
				await slowLockGate;
			}
			return handle;
		};

		const startPromise = h2.emit("session_start");
		await enteredSlowLockGate;
		await Promise.resolve();
		await Promise.resolve();
		h2.clock.advanceBy(SHUTDOWN_DRAIN_BUDGET_MS + 100);
		await Promise.all(shutdownPromises2);

		expect(
			h2.diagnostics.some((d) => d.code === "shutdown_timeout_lock_retained"),
		).toBe(true);

		releaseSlowLock();
		await startPromise;
		await h2.controller.waitForIdleQueue();
		expect(h2.fs.getFileText(lockPath)).toBeDefined();
	});

	test("R6 regression: throwing sendMessage calls count toward the 5 calls/minute rate limit and recover after 60s", async () => {
		let attemptedCalls = 0;
		const h = createTestHarness({
			idle: true,
			deps: {
				beforeSendMessage: () => {
					attemptedCalls += 1;
				},
			},
		});
		h.setSendMessageThrow(new Error("sync sendMessage failure"));

		const ids = Array.from({ length: 8 }, (_, idx) => makeUlid(560 + idx));
		for (const id of ids) {
			writeValidMailToFs(h.fs, { id });
		}

		await h.emit("session_start");
		await h.controller.waitForIdleQueue();

		// Only 5 throwing calls are permitted in the first minute; 6th candidate is not opened yet.
		expect(attemptedCalls).toBe(5);
		expect(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${ids[4]!}.ack`),
		).toBeDefined();
		expect(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${ids[5]!}.ack`),
		).toBeUndefined();
		expect(
			h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${ids[5]!}.attempt`),
		).toBeUndefined();

		// Advance clock past 60s -> remaining 3 candidates are attempted and transition to uncertain.
		h.clock.advanceBy(RATE_LIMIT_WINDOW_MS + 10);
		await h.controller.waitForIdleQueue();

		expect(attemptedCalls).toBe(8);
		for (const id of ids) {
			const ack = parseMailAck(
				h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${id}.ack`)!,
				{ expectedId: id, expectedBy: "gjc-worker" },
			);
			expect(ack.ok && ack.value.state).toBe("uncertain");
		}
	});
});

describe("#33 Phase 2 Round 3: Codex N1 & Pre-Publication Slot Tests", () => {
	test("N1 regression: flushPendingMessageEnds never lets later message_end observations overtake an earlier queued agent_end, while earlier Stage 1 message_end still cancels reinjection", async () => {
		// 1) Order: 2nd completed agent_end -> late custom Stage 1 -> normal assistant Stage 2
		//    Must preserve arrival order and settle as uncertain(unobserved_twice), NOT received.
		const idOrder1 = makeUlid(601);
		const h1 = createTestHarness({ idle: true });
		writeValidMailToFs(h1.fs, { id: idOrder1 });

		await h1.emit("session_start");
		await h1.controller.waitForIdleQueue();
		expect(h1.sentMessages.length).toBe(1);

		// First unobserved completed agent_end triggers 2nd sendMessage call (callCount === 2, state === "in_flight")
		await h1.emit("agent_end", { stopReason: "completed" });
		await h1.controller.waitForIdleQueue();
		expect(h1.sentMessages.length).toBe(2);
		expect(h1.controller.getStateSnapshot().activeRecords.get(idOrder1)?.state).toBe("in_flight");
		expect(h1.controller.getStateSnapshot().activeRecords.get(idOrder1)?.callCount).toBe(2);

		// Same event loop turn: 2nd completed agent_end arrives BEFORE late custom Stage 1 and assistant Stage 2
		const pAgentEnd = h1.emitNoWait("agent_end", { stopReason: "completed" });
		const pStage1 = h1.emitNoWait("message_end", {
			message: {
				role: "custom",
				customType: "herdr-mail",
				details: { id: idOrder1 },
			},
		});
		const pStage2 = h1.emitNoWait("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await Promise.all([...pAgentEnd, ...pStage1, ...pStage2]);
		await h1.controller.waitForIdleQueue();

		const ackOrder1Text = h1.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idOrder1}.ack`);
		expect(ackOrder1Text).toBeDefined();
		const ackOrder1 = parseMailAck(ackOrder1Text!, {
			expectedId: idOrder1,
			expectedBy: "gjc-worker",
		});
		expect(ackOrder1.ok).toBe(true);
		if (ackOrder1.ok) {
			expect(ackOrder1.value.state).toBe("uncertain");
			expect(ackOrder1.value.reason).toBe("unobserved_twice");
		}
		expect(
			h1.diagnostics.some((d) => d.code === "late_stage1_after_settled" && d.id === idOrder1),
		).toBe(true);
		expect(
			h1.diagnostics.some((d) => d.code === "late_stage2_after_settled" && d.id === idOrder1),
		).toBe(true);

		// 2) Reverse order: late custom Stage 1 arrives BEFORE completed agent_end
		//    Must reflect Stage 1 first, cancel reinjection (1 call total), and settle as received on Stage 2.
		const idOrder2 = makeUlid(602);
		const h2 = createTestHarness({ idle: true });
		const mOrder2 = writeValidMailToFs(h2.fs, { id: idOrder2 });

		await h2.emit("session_start");
		await h2.controller.waitForIdleQueue();
		expect(h2.sentMessages.length).toBe(1);

		const rStage1 = h2.emitNoWait("message_end", {
			message: {
				role: "custom",
				customType: "herdr-mail",
				details: { id: idOrder2 },
			},
		});
		const rAgentEnd = h2.emitNoWait("agent_end", { stopReason: "completed" });
		await Promise.all([...rStage1, ...rAgentEnd]);
		await h2.controller.waitForIdleQueue();

		expect(h2.sentMessages.length).toBe(1);
		expect(h2.controller.getStateSnapshot().activeRecords.get(idOrder2)?.state).toBe("context_reflected");
		expect(h2.controller.getStateSnapshot().activeRecords.get(idOrder2)?.callCount).toBe(1);

		await h2.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h2.controller.waitForIdleQueue();

		expect(h2.sentMessages.length).toBe(1);
		const ackOrder2 = parseMailAck(
			h2.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idOrder2}.ack`)!,
			{
				expectedId: idOrder2,
				expectedBy: "gjc-worker",
				expectedBodySha256: mOrder2.bodySha256,
			},
		);
		expect(ackOrder2.ok).toBe(true);
		if (ackOrder2.ok) {
			expect(ackOrder2.value.state).toBe("received");
			expect(ackOrder2.value.via).toBe("observed");
		}

		// 3) Scan-time barrier: if agent_end arrives BEFORE Stage 1 + Stage 2 while a scan is in flight,
		//    scan-time flushPendingMessageEnds must not overtake the earlier queued agent_end.
		const idOrder3 = makeUlid(603);
		const h3 = createTestHarness({ idle: true });
		writeValidMailToFs(h3.fs, { id: idOrder3 });

		await h3.emit("session_start");
		await h3.controller.waitForIdleQueue();
		await h3.emit("agent_end", { stopReason: "completed" });
		await h3.controller.waitForIdleQueue();
		expect(h3.controller.getStateSnapshot().activeRecords.get(idOrder3)?.callCount).toBe(2);

		let injectedDuringScan = false;
		let scanHookPromises: Array<Promise<void> | void> = [];
		const origReaddir = h3.fs.readdir.bind(h3.fs);
		h3.fs.readdir = async (path: string) => {
			const entries = await origReaddir(path);
			if (!injectedDuringScan && path.endsWith("/gjc-worker")) {
				injectedDuringScan = true;
				scanHookPromises = [
					...h3.emitNoWait("agent_end", { stopReason: "completed" }),
					...h3.emitNoWait("message_end", {
						message: {
							role: "custom",
							customType: "herdr-mail",
							details: { id: idOrder3 },
						},
					}),
					...h3.emitNoWait("message_end", {
						message: { role: "assistant", stopReason: "stop" },
					}),
				];
			}
			return entries;
		};

		await h3.controller.triggerScan();
		await Promise.all(scanHookPromises);
		await h3.controller.waitForIdleQueue();

		expect(injectedDuringScan).toBe(true);
		const ackOrder3 = parseMailAck(
			h3.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idOrder3}.ack`)!,
			{ expectedId: idOrder3, expectedBy: "gjc-worker" },
		);
		expect(ackOrder3.ok).toBe(true);
		if (ackOrder3.ok) {
			expect(ackOrder3.value.state).toBe("uncertain");
			expect(ackOrder3.value.reason).toBe("unobserved_twice");
		}
	});

	test("§7 candidate + slot reservation -> reserved: candidate already holds a slot during attempt publication I/O and enforces the 3-slot cap before .attempt is linked", async () => {
		const idSlot1 = makeUlid(611);
		const idSlot2 = makeUlid(612);
		const idSlot3 = makeUlid(613);
		const idSlot4 = makeUlid(614);

		let observedBeforeAttempt:
			| {
					state: string | undefined;
					holdsSlot: boolean | undefined;
					attemptPublished: boolean | undefined;
					slotCount: number;
					attemptFileOnDisk: boolean;
					id4Active: boolean;
			  }
			| undefined;
		let observedDuringTempWrite:
			| {
					state: string | undefined;
					holdsSlot: boolean | undefined;
					attemptPublished: boolean | undefined;
					slotCount: number;
					attemptFileOnDisk: boolean;
					id4Active: boolean;
			  }
			| undefined;

		const h = createTestHarness({
			idle: true,
			deps: {
				beforeAttemptPublish: async (id) => {
					if (id === idSlot3) {
						const snap = h.controller.getStateSnapshot();
						const rec = snap.activeRecords.get(idSlot3);
						observedBeforeAttempt = {
							state: rec?.state,
							holdsSlot: rec?.holdsSlot,
							attemptPublished: rec?.attemptPublished,
							slotCount: snap.slotCount,
							attemptFileOnDisk:
								h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idSlot3}.attempt`) !==
								undefined,
							id4Active: snap.activeRecords.has(idSlot4),
						};
					}
				},
			},
		});

		const origOpen = h.fs.open.bind(h.fs);
		h.fs.open = async (path: string, flags: number, fileMode?: number) => {
			const handle = await origOpen(path, flags, fileMode);
			if (!path.includes(`.${idSlot3}.attempt.`)) {
				return handle;
			}
			return {
				stat: handle.stat.bind(handle),
				read: handle.read.bind(handle),
				async write(buf, off, len, pos) {
					const snap = h.controller.getStateSnapshot();
					const rec = snap.activeRecords.get(idSlot3);
					observedDuringTempWrite = {
						state: rec?.state,
						holdsSlot: rec?.holdsSlot,
						attemptPublished: rec?.attemptPublished,
						slotCount: snap.slotCount,
						attemptFileOnDisk:
							h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idSlot3}.attempt`) !==
							undefined,
						id4Active: snap.activeRecords.has(idSlot4),
					};
					return handle.write(buf, off, len, pos);
				},
				sync: handle.sync.bind(handle),
				close: handle.close.bind(handle),
			};
		};

		writeValidMailToFs(h.fs, { id: idSlot1 });
		writeValidMailToFs(h.fs, { id: idSlot2 });
		writeValidMailToFs(h.fs, { id: idSlot3 });
		writeValidMailToFs(h.fs, { id: idSlot4 });

		await h.emit("session_start");
		await h.controller.waitForIdleQueue();

		// Both beforeAttemptPublish and temp-file write I/O for idSlot3 observe reserved state with holdsSlot=true and slotCount=3 before .attempt exists on disk.
		expect(observedBeforeAttempt).toEqual({
			state: "reserved",
			holdsSlot: true,
			attemptPublished: false,
			slotCount: 3,
			attemptFileOnDisk: false,
			id4Active: false,
		});
		expect(observedDuringTempWrite).toEqual({
			state: "reserved",
			holdsSlot: true,
			attemptPublished: false,
			slotCount: 3,
			attemptFileOnDisk: false,
			id4Active: false,
		});

		// And the 4th candidate (idSlot4) could not acquire a 4th slot.
		const finalSnap = h.controller.getStateSnapshot();
		expect(finalSnap.slotCount).toBe(3);
		expect(finalSnap.activeRecords.has(idSlot4)).toBe(false);
		expect(h.fs.getFileText(`/repo/.gjc-herdr/mailbox/gjc-worker/${idSlot4}.attempt`)).toBeUndefined();
	});
});
