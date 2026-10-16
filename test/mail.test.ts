import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs/promises";
import test from "node:test";
import type { ExecResult, ExtensionAPI } from "@gajae-code/coding-agent";
import * as zod from "zod/v4";
import herdrMetadata from "../src/extension.ts";
import {
	computeSha256Hex,
	createUlid,
	formatMailAck,
	formatMailAttempt,
	formatMailLockRecord,
	formatMailMessage,
	isValidMailboxName,
	isValidRfc3339Timestamp,
	isValidUlid,
	MAIL_CREATE_TMP_FLAGS,
	MAIL_DIR_MODE,
	MAIL_FILE_MODE,
	MAX_HEADER_BYTES,
	MAX_MESSAGE_BYTES,
	MAX_RECORD_BYTES,
	type MailDeps,
	type MailFileHandle,
	type MailFs,
	type MailStat,
	parseKvBlock,
	parseMailAck,
	parseMailAttempt,
	parseMailLockRecord,
	parseMailMessage,
	readMailAckFile,
	readMailAttemptFile,
	readMailboxFileBytes,
	readMailMessageFile,
	registerMailFeatures,
	sendMail,
} from "../src/mail.ts";

const REPO_TOP = "/repo";
const VALID_ID = "01JC9W2K8Q8Z6Y3V4N5M7P0R1S";
const VALID_REPLY_ID = "01JC9V00000000000000000000";
const VALID_SHA = "a".repeat(64);
const VALID_TOKEN = "b".repeat(32);
const VALID_TIME = "2026-10-16T21:05:11+09:00";

interface FakeNode {
	kind: "file" | "dir" | "symlink" | "fifo";
	mode: number;
	bytes: Uint8Array;
	realPath?: string;
}

function createFakeMailEnv(options?: {
	topLevel?: string;
	gitHandler?: (
		args: string[],
	) => Partial<ExecResult> | Error | undefined;
	openHook?: (path: string, flags: number, mode?: number) => void;
	linkHook?: (existingPath: string, newPath: string) => void;
	unlinkHook?: (path: string) => void;
	syncHook?: (path: string) => void;
	env?: Record<string, string | undefined>;
	nowMs?: number;
}) {
	const topLevel = options?.topLevel ?? REPO_TOP;
	const nodes = new Map<string, FakeNode>();
	nodes.set(topLevel, {
		kind: "dir",
		mode: MAIL_DIR_MODE,
		bytes: new Uint8Array(0),
	});

	const gitCalls: string[][] = [];
	const fsOpsLog: string[] = [];

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
			fsOpsLog.push(`mkdir:${path}:${(opts?.mode ?? 0o777).toString(8)}`);
			if (nodes.has(path)) throw makeErr("EEXIST", path);
			nodes.set(path, {
				kind: "dir",
				mode: opts?.mode ?? MAIL_DIR_MODE,
				bytes: new Uint8Array(0),
			});
		},
		async open(
			path: string,
			flags: number,
			mode?: number,
		): Promise<MailFileHandle> {
			fsOpsLog.push(`open:${path}:${flags}:${mode ?? 0}`);
			options?.openHook?.(path, flags, mode);
			const existing = nodes.get(path);
			const isCreate = (flags & fsConstants.O_CREAT) !== 0;
			const isExcl = (flags & fsConstants.O_EXCL) !== 0;
			const isNoFollow = (flags & (fsConstants.O_NOFOLLOW ?? 0)) !== 0;

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
					const slice = buffer.subarray(offset, offset + length);
					const pos = position ?? node!.bytes.byteLength;
					const next = new Uint8Array(Math.max(node!.bytes.byteLength, pos + slice.byteLength));
					next.set(node!.bytes, 0);
					next.set(slice, pos);
					node!.bytes = next;
					fsOpsLog.push(`write:${path}:${slice.byteLength}`);
					return { bytesWritten: slice.byteLength };
				},
				async sync(): Promise<void> {
					fsOpsLog.push(`sync:${path}`);
					options?.syncHook?.(path);
				},
				async close(): Promise<void> {
					fsOpsLog.push(`close:${path}`);
				},
			};
		},
		async link(existingPath: string, newPath: string): Promise<void> {
			fsOpsLog.push(`link:${existingPath}->${newPath}`);
			options?.linkHook?.(existingPath, newPath);
			const src = nodes.get(existingPath);
			if (!src) throw makeErr("ENOENT", existingPath);
			if (nodes.has(newPath)) throw makeErr("EEXIST", newPath);
			nodes.set(newPath, {
				kind: src.kind,
				mode: src.mode,
				bytes: new Uint8Array(src.bytes),
			});
		},
		async unlink(path: string): Promise<void> {
			fsOpsLog.push(`unlink:${path}`);
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
			return { stdout: `${topLevel}\n`, stderr: "", code: 0, killed: false };
		}
		assert.equal(args[0], "-C");
		assert.equal(args[1], topLevel);
		if (args[2] === "ls-files") {
			return { stdout: "", stderr: "", code: 0, killed: false };
		}
		if (args[2] === "check-ignore" && args[3] === "-q") {
			return { stdout: "", stderr: "", code: 0, killed: false };
		}
		throw new Error(`Unexpected git args: ${args.join(" ")}`);
	};

	let randSeed = 1;
	const deps: MailDeps = {
		exec,
		fs,
		env: options?.env ?? { GJC_HERDR_MAILBOX: "gjc-herdr-mate" },
		now: () => options?.nowMs ?? Date.parse("2026-10-16T12:00:00.000Z"),
		randomBytes: (buf) => {
			for (let i = 0; i < buf.length; i++) {
				buf[i] = (randSeed * 37 + i * 13) & 0xff;
			}
			randSeed++;
			return buf;
		},
	};

	return { deps, fs, nodes, gitCalls, fsOpsLog, makeErr };
}

test("ULID generation produces 26-char Crockford Base32 IDs sorted chronologically", () => {
	const t1 = 1_700_000_000_000;
	const t2 = 1_700_000_000_001;
	const t3 = 1_700_000_100_000;
	const id1 = createUlid(t1);
	const id2 = createUlid(t2);
	const id3 = createUlid(t3);

	assert.equal(id1.length, 26);
	assert.equal(isValidUlid(id1), true);
	assert.equal(isValidUlid(id2), true);
	assert.equal(isValidUlid(id3), true);
	assert(id1 < id2, `Expected ${id1} < ${id2}`);
	assert(id2 < id3, `Expected ${id2} < ${id3}`);

	for (const bad of [
		"",
		"01JC9W2K8Q8Z6Y3V4N5M7P0R1",
		"01JC9W2K8Q8Z6Y3V4N5M7P0R1SS",
		"01JC9W2K8Q8Z6Y3V4N5M7P0R1I", // I is excluded in Crockford Base32
		"01JC9W2K8Q8Z6Y3V4N5M7P0R1L", // L is excluded
		"01JC9W2K8Q8Z6Y3V4N5M7P0R1O", // O is excluded
		"01JC9W2K8Q8Z6Y3V4N5M7P0R1U", // U is excluded
		"01jc9w2k8q8z6y3v4n5m7p0r1s", // lowercase forbidden
	]) {
		assert.equal(isValidUlid(bad), false, `Expected invalid ULID: ${bad}`);
	}
	assert.throws(() => createUlid(-1), RangeError);
	assert.throws(() => createUlid(0x1000000000000), RangeError);
});

test("§3.0 timestamp validation rejects invalid calendar dates, leap seconds, and offsets >= 24:00", () => {
	for (const valid of [
		"2026-10-16T21:05:11Z",
		"2026-10-16T21:05:11.123+09:00",
		"2024-02-29T00:00:00-23:59",
		"2026-12-31T23:59:59+23:59",
	]) {
		assert.equal(
			isValidRfc3339Timestamp(valid),
			true,
			`Expected valid timestamp: ${valid}`,
		);
	}

	for (const invalid of [
		"2026-02-30T10:00:00Z", // Feb 30
		"2026-02-29T10:00:00Z", // Feb 29 on non-leap year
		"2100-02-29T10:00:00Z", // 2100 is not a leap year
		"2026-13-01T10:00:00Z", // month 13
		"2026-00-01T10:00:00Z", // month 00
		"2026-04-31T10:00:00Z", // April 31
		"2026-10-16T24:00:00Z", // hour 24
		"2026-10-16T10:60:00Z", // minute 60
		"2026-10-16T23:59:60Z", // leap second 60
		"2026-10-16T10:00:00+24:00", // offset +24:00
		"2026-10-16T10:00:00-24:00", // offset -24:00
		"2026-10-16T10:00:00+00:60", // offset minute 60
		"2026-10-16T10:00:00", // missing offset
		"2026-10-16 10:00:00Z", // space instead of T
		"2026-10-16T10:00:00.1234Z", // >3 fractional digits
	]) {
		assert.equal(
			isValidRfc3339Timestamp(invalid),
			false,
			`Expected invalid timestamp: ${invalid}`,
		);
	}
});

test("§3.0 line grammar rejects BOM, CR, blank lines, missing final LF, whitespace, unknown/duplicate keys, and oversize blocks", () => {
	const opts = {
		allowedKeys: new Set(["pid", "token", "at"]),
		requiredKeys: new Set(["pid", "token", "at"]),
		maxBytes: MAX_RECORD_BYTES,
	};
	const base = `pid: 1234\ntoken: ${VALID_TOKEN}\nat: ${VALID_TIME}\n`;
	assert.equal(parseKvBlock(base, opts).ok, true);

	// BOM (string and UTF-8 bytes)
	assert.equal(parseKvBlock(`\ufeff${base}`, opts).ok, false);
	const bomBytes = new Uint8Array([
		0xef,
		0xbb,
		0xbf,
		...new TextEncoder().encode(base),
	]);
	const bomRes = parseKvBlock(bomBytes, opts);
	assert.equal(bomRes.ok, false);
	if (!bomRes.ok) assert.equal(bomRes.code, "bom_forbidden");

	// CR in record
	const crRes = parseKvBlock(base.replace("\n", "\r\n"), opts);
	assert.equal(crRes.ok, false);
	if (!crRes.ok) assert.equal(crRes.code, "cr_forbidden");

	// Missing final LF and blank lines
	const noLf = parseKvBlock(base.trimEnd(), opts);
	assert.equal(noLf.ok, false);
	if (!noLf.ok) assert.equal(noLf.code, "missing_trailing_lf");

	for (const withBlank of [`\n${base}`, `${base}\n`, `pid: 1234\n\ntoken: ${VALID_TOKEN}\nat: ${VALID_TIME}\n`]) {
		const res = parseKvBlock(withBlank, opts);
		assert.equal(res.ok, false);
		if (!res.ok) assert.equal(res.code, "empty_line");
	}

	// Leading/trailing whitespace and double space after colon
	for (const badWs of [
		` pid: 1234\ntoken: ${VALID_TOKEN}\nat: ${VALID_TIME}\n`,
		`pid : 1234\ntoken: ${VALID_TOKEN}\nat: ${VALID_TIME}\n`,
		`pid:  1234\ntoken: ${VALID_TOKEN}\nat: ${VALID_TIME}\n`,
		`pid: 1234 \ntoken: ${VALID_TOKEN}\nat: ${VALID_TIME}\n`,
	]) {
		const res = parseKvBlock(badWs, opts);
		assert.equal(res.ok, false);
	}

	// Unknown key and duplicate key
	const unknownRes = parseKvBlock(`${base}extra: 1\n`, opts);
	assert.equal(unknownRes.ok, false);
	if (!unknownRes.ok) assert.equal(unknownRes.code, "unknown_key");

	const dupRes = parseKvBlock(`pid: 1234\npid: 1234\ntoken: ${VALID_TOKEN}\nat: ${VALID_TIME}\n`, opts);
	assert.equal(dupRes.ok, false);
	if (!dupRes.ok) assert.equal(dupRes.code, "duplicate_key");

	// Size cap (1 KiB for records, 4 KiB for headers)
	const over1KiB = "a".repeat(MAX_RECORD_BYTES + 1) + "\n";
	const recSizeRes = parseKvBlock(over1KiB, opts);
	assert.equal(recSizeRes.ok, false);
	if (!recSizeRes.ok) assert.equal(recSizeRes.code, "size_exceeded");

	const over4KiB = "a".repeat(MAX_HEADER_BYTES + 1) + "\n";
	const hdrSizeRes = parseKvBlock(over4KiB, {
		...opts,
		maxBytes: MAX_HEADER_BYTES,
	});
	assert.equal(hdrSizeRes.ok, false);
	if (!hdrSizeRes.ok) assert.equal(hdrSizeRes.code, "size_exceeded");

	// Lock record round-trip
	const lockFormatted = formatMailLockRecord({
		pid: "4321",
		token: VALID_TOKEN,
		at: VALID_TIME,
	});
	assert.equal(lockFormatted.ok, true);
	if (lockFormatted.ok) {
		const lockParsed = parseMailLockRecord(lockFormatted.value);
		assert.equal(lockParsed.ok, true);
	}
});

test("§3.1 message round-trip, body CR preservation, and validation of stem, to, sha256, UTF-8, size, and reply_to", () => {
	// Normal round-trip with CRLF in body (CR allowed in body, forbidden in header)
	const bodyWithCr = "첫째 줄\r\n둘째 줄\n셋째 줄";
	const created = formatMailMessage({
		id: VALID_ID,
		from: "gjc-herdr-mate",
		to: "gjc-herdr-lead",
		created: VALID_TIME,
		subject: "명세 1차 완료",
		replyTo: VALID_REPLY_ID,
		body: bodyWithCr,
	});
	assert.equal(created.ok, true);
	if (!created.ok) return;

	const parsed = parseMailMessage(created.value.bytes, {
		expectedId: VALID_ID,
		expectedTo: "gjc-herdr-lead",
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.id, VALID_ID);
		assert.equal(parsed.value.from, "gjc-herdr-mate");
		assert.equal(parsed.value.to, "gjc-herdr-lead");
		assert.equal(parsed.value.replyTo, VALID_REPLY_ID);
		assert.equal(parsed.value.body, bodyWithCr);
	}

	// CR in header is rejected
	const headerCrText = created.value.text.replace(
		`id: ${VALID_ID}\n`,
		`id: ${VALID_ID}\r\n`,
	);
	const headerCrRes = parseMailMessage(headerCrText);
	assert.equal(headerCrRes.ok, false);
	if (!headerCrRes.ok) assert.equal(headerCrRes.code, "cr_forbidden");

	// stem mismatch
	const stemMismatch = parseMailMessage(created.value.bytes, {
		expectedId: VALID_REPLY_ID,
		expectedTo: "gjc-herdr-lead",
	});
	assert.equal(stemMismatch.ok, false);
	if (!stemMismatch.ok) assert.equal(stemMismatch.code, "stem_mismatch");

	// to mismatch
	const toMismatch = parseMailMessage(created.value.bytes, {
		expectedId: VALID_ID,
		expectedTo: "other-agent",
	});
	assert.equal(toMismatch.ok, false);
	if (!toMismatch.ok) assert.equal(toMismatch.code, "to_mismatch");

	// body_sha256 mismatch
	const tamperedText = `${created.value.text}추가글`;
	const shaMismatch = parseMailMessage(tamperedText, {
		expectedId: VALID_ID,
		expectedTo: "gjc-herdr-lead",
	});
	assert.equal(shaMismatch.ok, false);
	if (!shaMismatch.ok) assert.equal(shaMismatch.code, "sha256_mismatch");

	// Invalid UTF-8 bytes
	const badUtf8 = new Uint8Array(created.value.bytes.byteLength + 2);
	badUtf8.set(created.value.bytes, 0);
	badUtf8[badUtf8.byteLength - 2] = 0xff;
	badUtf8[badUtf8.byteLength - 1] = 0xfe;
	const utf8Res = parseMailMessage(badUtf8);
	assert.equal(utf8Res.ok, false);
	if (!utf8Res.ok) assert.equal(utf8Res.code, "invalid_utf8");

	// > 256 KiB rejected on both format and parse
	const hugeBody = "x".repeat(MAX_MESSAGE_BYTES);
	const hugeFormat = formatMailMessage({
		id: VALID_ID,
		from: "gjc-herdr-mate",
		to: "gjc-herdr-lead",
		created: VALID_TIME,
		subject: "제목",
		body: hugeBody,
	});
	assert.equal(hugeFormat.ok, false);
	if (!hugeFormat.ok) assert.equal(hugeFormat.code, "size_exceeded");

	const hugeRaw = new Uint8Array(MAX_MESSAGE_BYTES + 1);
	const hugeParse = parseMailMessage(hugeRaw);
	assert.equal(hugeParse.ok, false);
	if (!hugeParse.ok) assert.equal(hugeParse.code, "size_exceeded");

	// Invalid reply_to format and subject > 200 UTF-8 bytes
	const badReply = formatMailMessage({
		id: VALID_ID,
		from: "gjc-herdr-mate",
		to: "gjc-herdr-lead",
		created: VALID_TIME,
		subject: "제목",
		replyTo: "not-a-ulid",
		body: "본문",
	});
	assert.equal(badReply.ok, false);
	if (!badReply.ok) assert.equal(badReply.code, "invalid_ulid");

	const longSubject = "가".repeat(67); // 201 UTF-8 bytes
	const badSubject = formatMailMessage({
		id: VALID_ID,
		from: "gjc-herdr-mate",
		to: "gjc-herdr-lead",
		created: VALID_TIME,
		subject: longSubject,
		body: "본문",
	});
	assert.equal(badSubject.ok, false);
	if (!badSubject.ok) assert.equal(badSubject.code, "invalid_subject");
});

test("§3.3 ack and §3.4 attempt format and state-specific validation", () => {
	// Valid received ack
	const recAck = formatMailAck({
		id: VALID_ID,
		by: "gjc-herdr-lead",
		at: VALID_TIME,
		state: "received",
		via: "observed",
		bodySha256: VALID_SHA,
	});
	assert.equal(recAck.ok, true);
	if (recAck.ok) {
		const parsed = parseMailAck(recAck.value, {
			expectedId: VALID_ID,
			expectedBy: "gjc-herdr-lead",
			expectedBodySha256: VALID_SHA,
		});
		assert.equal(parsed.ok, true);
	}

	// Valid rejected & uncertain acks
	for (const state of ["rejected", "uncertain"] as const) {
		const ack = formatMailAck({
			id: VALID_ID,
			by: "gjc-herdr-lead",
			at: VALID_TIME,
			state,
			via: "manual",
			reason: "invalid_header",
		});
		assert.equal(ack.ok, true);
		if (ack.ok) {
			const parsed = parseMailAck(ack.value, {
				expectedId: VALID_ID,
				expectedBy: "gjc-herdr-lead",
			});
			assert.equal(parsed.ok, true);
		}
	}

	// received missing body_sha256 -> rejected
	const recNoSha = parseMailAck(
		`id: ${VALID_ID}\nby: gjc-herdr-lead\nat: ${VALID_TIME}\nstate: received\nvia: observed\n`,
	);
	assert.equal(recNoSha.ok, false);
	if (!recNoSha.ok) assert.equal(recNoSha.code, "missing_key");

	// received with valid optional reason -> allowed (F4)
	const recWithReason = parseMailAck(
		`id: ${VALID_ID}\nby: gjc-herdr-lead\nat: ${VALID_TIME}\nstate: received\nvia: observed\nbody_sha256: ${VALID_SHA}\nreason: extra note\n`,
	);
	assert.equal(recWithReason.ok, true);
	if (recWithReason.ok) {
		assert.equal(recWithReason.value.reason, "extra note");
	}

	// rejected/uncertain with valid optional body_sha256 -> allowed, invalid body_sha256 -> format error (F4)
	for (const state of ["rejected", "uncertain"] as const) {
		const withSha = parseMailAck(
			`id: ${VALID_ID}\nby: gjc-herdr-lead\nat: ${VALID_TIME}\nstate: ${state}\nvia: manual\nbody_sha256: ${VALID_SHA}\nreason: invalid_header\n`,
		);
		assert.equal(withSha.ok, true);
		if (withSha.ok) {
			assert.equal(withSha.value.bodySha256, VALID_SHA);
		}

		const badSha = parseMailAck(
			`id: ${VALID_ID}\nby: gjc-herdr-lead\nat: ${VALID_TIME}\nstate: ${state}\nvia: manual\nbody_sha256: NOT_A_SHA\nreason: invalid_header\n`,
		);
		assert.equal(badSha.ok, false);
		if (!badSha.ok) assert.equal(badSha.code, "invalid_sha256");
	}

	// rejected/uncertain missing reason -> rejected
	for (const state of ["rejected", "uncertain"] as const) {
		const noReason = parseMailAck(
			`id: ${VALID_ID}\nby: gjc-herdr-lead\nat: ${VALID_TIME}\nstate: ${state}\nvia: manual\n`,
		);
		assert.equal(noReason.ok, false);
		if (!noReason.ok) assert.equal(noReason.code, "missing_key");
	}

	// by mismatch and stem mismatch
	if (recAck.ok) {
		const wrongBy = parseMailAck(recAck.value, {
			expectedId: VALID_ID,
			expectedBy: "other-agent",
		});
		assert.equal(wrongBy.ok, false);
		if (!wrongBy.ok) assert.equal(wrongBy.code, "by_mismatch");

		const wrongStem = parseMailAck(recAck.value, {
			expectedId: VALID_REPLY_ID,
			expectedBy: "gjc-herdr-lead",
		});
		assert.equal(wrongStem.ok, false);
		if (!wrongStem.ok) assert.equal(wrongStem.code, "stem_mismatch");
	}

	// Invalid via and invalid state
	const badVia = parseMailAck(
		`id: ${VALID_ID}\nby: gjc-herdr-lead\nat: ${VALID_TIME}\nstate: received\nvia: magic\nbody_sha256: ${VALID_SHA}\n`,
	);
	assert.equal(badVia.ok, false);
	if (!badVia.ok) assert.equal(badVia.code, "invalid_via");

	const badState = parseMailAck(
		`id: ${VALID_ID}\nby: gjc-herdr-lead\nat: ${VALID_TIME}\nstate: done\nvia: manual\nreason: ok\n`,
	);
	assert.equal(badState.ok, false);
	if (!badState.ok) assert.equal(badState.code, "invalid_state");

	// §3.4 attempt round-trip and stem/field validation
	const attempt = formatMailAttempt({
		id: VALID_ID,
		bodySha256: VALID_SHA,
		consumer: VALID_TOKEN,
		session: "session-abc-123",
		at: VALID_TIME,
	});
	assert.equal(attempt.ok, true);
	if (attempt.ok) {
		const parsed = parseMailAttempt(attempt.value, { expectedId: VALID_ID });
		assert.equal(parsed.ok, true);

		const badStem = parseMailAttempt(attempt.value, {
			expectedId: VALID_REPLY_ID,
		});
		assert.equal(badStem.ok, false);
		if (!badStem.ok) assert.equal(badStem.code, "stem_mismatch");
	}

	const missingConsumer = parseMailAttempt(
		`id: ${VALID_ID}\nbody_sha256: ${VALID_SHA}\nsession: sess-1\nat: ${VALID_TIME}\n`,
	);
	assert.equal(missingConsumer.ok, false);
	if (!missingConsumer.ok) assert.equal(missingConsumer.code, "missing_key");
});

test("§2 boundary rejects git failures, unignored paths, tracked files, symlinks, outside realpath, and non-regular files", async () => {
	// 1. git rev-parse failure -> fail closed
	{
		const { deps } = createFakeMailEnv({
			gitHandler: (args) =>
				args[0] === "rev-parse"
					? { code: 128, stderr: "fatal: not a git repository" }
					: undefined,
		});
		const res = await sendMail(deps, {
			to: "gjc-herdr-lead",
			subject: "보고",
			body: "본문",
		});
		assert.equal(res.ok, false);
		assert.equal(res.error?.code, "git_failed");
	}

	// 2. check-ignore not ignoring path -> rejected
	for (const rejectIndex of [0, 1, 2]) {
		let checkIgnoreCount = 0;
		const { deps } = createFakeMailEnv({
			gitHandler: (args) => {
				if (args[2] === "check-ignore") {
					if (checkIgnoreCount++ === rejectIndex) {
						return { code: 1, stdout: "", stderr: "" };
					}
				}
				return undefined;
			},
		});
		const res = await sendMail(deps, {
			to: "gjc-herdr-lead",
			subject: "보고",
			body: "본문",
		});
		assert.equal(res.ok, false);
		assert.equal(res.error?.code, "not_ignored");
	}

	// 3. ls-files has tracked files -> rejected
	{
		const { deps } = createFakeMailEnv({
			gitHandler: (args) =>
				args[2] === "ls-files"
					? {
							code: 0,
							stdout: `.gjc-herdr/mailbox/gjc-herdr-lead/${VALID_ID}.md\n`,
						}
					: undefined,
		});
		const res = await sendMail(deps, {
			to: "gjc-herdr-lead",
			subject: "보고",
			body: "본문",
		});
		assert.equal(res.ok, false);
		assert.equal(res.error?.code, "tracked_files");
	}

	// 4. Path element is a symlink -> rejected via lstat
	for (const symDir of [
		`${REPO_TOP}/.gjc-herdr`,
		`${REPO_TOP}/.gjc-herdr/mailbox`,
		`${REPO_TOP}/.gjc-herdr/mailbox/gjc-herdr-lead`,
	]) {
		const { deps, nodes } = createFakeMailEnv();
		if (symDir !== `${REPO_TOP}/.gjc-herdr`) {
			nodes.set(`${REPO_TOP}/.gjc-herdr`, {
				kind: "dir",
				mode: MAIL_DIR_MODE,
				bytes: new Uint8Array(0),
			});
		}
		if (symDir === `${REPO_TOP}/.gjc-herdr/mailbox/gjc-herdr-lead`) {
			nodes.set(`${REPO_TOP}/.gjc-herdr/mailbox`, {
				kind: "dir",
				mode: MAIL_DIR_MODE,
				bytes: new Uint8Array(0),
			});
		}
		nodes.set(symDir, {
			kind: "symlink",
			mode: 0o777,
			bytes: new Uint8Array(0),
		});
		const res = await sendMail(deps, {
			to: "gjc-herdr-lead",
			subject: "보고",
			body: "본문",
		});
		assert.equal(res.ok, false);
		assert.equal(res.error?.code, "symlink_rejected");
	}

	// 5. realpath escapes repository root -> rejected
	{
		const { deps, nodes } = createFakeMailEnv();
		nodes.set(`${REPO_TOP}/.gjc-herdr`, {
			kind: "dir",
			mode: MAIL_DIR_MODE,
			bytes: new Uint8Array(0),
		});
		nodes.set(`${REPO_TOP}/.gjc-herdr/mailbox`, {
			kind: "dir",
			mode: MAIL_DIR_MODE,
			bytes: new Uint8Array(0),
			realPath: "/repo-outside/mailbox",
		});
		const res = await sendMail(deps, {
			to: "gjc-herdr-lead",
			subject: "보고",
			body: "본문",
		});
		assert.equal(res.ok, false);
		assert.equal(res.error?.code, "outside_repo");
	}

	// 6. Existing directory with mode != 0700 is kept as-is and produces a warning
	{
		const { deps, nodes } = createFakeMailEnv();
		const boxDir = `${REPO_TOP}/.gjc-herdr/mailbox`;
		nodes.set(`${REPO_TOP}/.gjc-herdr`, {
			kind: "dir",
			mode: MAIL_DIR_MODE,
			bytes: new Uint8Array(0),
		});
		nodes.set(boxDir, {
			kind: "dir",
			mode: 0o755,
			bytes: new Uint8Array(0),
		});
		const res = await sendMail(deps, {
			to: "gjc-herdr-lead",
			subject: "보고",
			body: "본문",
		});
		assert.equal(res.ok, true);
		assert.equal(nodes.get(boxDir)?.mode, 0o755);
		assert.equal(res.warnings?.[0]?.code, "dir_mode_not_0700");
		assert.equal(res.warnings?.[0]?.path, boxDir);
	}

	// 7. Final file is a symlink or non-regular file -> read fails
	{
		const { fs, nodes } = createFakeMailEnv();
		const linkPath = `${REPO_TOP}/.gjc-herdr/mailbox/gjc-herdr-lead/${VALID_ID}.md`;
		nodes.set(linkPath, {
			kind: "symlink",
			mode: 0o777,
			bytes: new Uint8Array(0),
		});
		const symRead = await readMailMessageFile(fs, linkPath);
		assert.equal(symRead.ok, false);
		if (!symRead.ok) assert.equal(symRead.code, "symlink_rejected");

		const fifoPath = `${REPO_TOP}/.gjc-herdr/mailbox/gjc-herdr-lead/${VALID_REPLY_ID}.md`;
		nodes.set(fifoPath, {
			kind: "fifo",
			mode: 0o600,
			bytes: new Uint8Array(0),
		});
		const fifoRead = await readMailboxFileBytes(fs, fifoPath);
		assert.equal(fifoRead.ok, false);
		if (!fifoRead.ok) assert.equal(fifoRead.code, "not_regular_file");
	}
});

test("§3.2 exclusive publication covers normal flow, link EEXIST, link error, unlink warning, and tmp EEXIST", async () => {
	// 1. Normal publication
	{
		const openCalls: { path: string; flags: number; mode?: number }[] = [];
		const { deps, fs, nodes, fsOpsLog } = createFakeMailEnv({
			openHook: (path, flags, mode) => openCalls.push({ path, flags, mode }),
		});
		const res = await sendMail(deps, {
			to: "gjc-herdr-lead",
			subject: "1단계 보고",
			body: "정상 본문입니다.",
		});
		assert.equal(res.ok, true);
		assert(res.id && isValidUlid(res.id));
		assert.equal(
			res.path,
			`${REPO_TOP}/.gjc-herdr/mailbox/gjc-herdr-lead/${res.id}.md`,
		);
		assert.equal(res.warnings, undefined);

		// Verify each required write flag bit individually + mode 0600, and order stat < write < sync < close < link < unlink
		assert.equal(openCalls.length, 1);
		const writeFlags = openCalls[0]!.flags;
		assert.match(openCalls[0]!.path, /\/\.\w+\.[0-9a-f]{8}\.tmp$/);
		assert.notEqual(writeFlags & fsConstants.O_WRONLY, 0);
		assert.notEqual(writeFlags & fsConstants.O_CREAT, 0);
		assert.notEqual(writeFlags & fsConstants.O_EXCL, 0);
		assert.notEqual(writeFlags & fsConstants.O_NOFOLLOW, 0);
		assert.notEqual(writeFlags & fsConstants.O_NONBLOCK, 0);
		assert.equal(openCalls[0]!.mode, MAIL_FILE_MODE);
		assert.equal(nodes.has(openCalls[0]!.path), false);

		const statIdx = fsOpsLog.findIndex((entry) => entry.startsWith("fstat:"));
		const writeIdx = fsOpsLog.findIndex((entry) => entry.startsWith("write:"));
		const syncIdx = fsOpsLog.findIndex((entry) => entry.startsWith("sync:"));
		const closeIdx = fsOpsLog.findIndex((entry) => entry.startsWith("close:"));
		const linkIdx = fsOpsLog.findIndex((entry) => entry.startsWith("link:"));
		const unlinkIdx = fsOpsLog.findIndex((entry) =>
			entry.startsWith("unlink:"),
		);
		assert(
			statIdx > 0 &&
				writeIdx > statIdx &&
				syncIdx > writeIdx &&
				closeIdx > syncIdx &&
				linkIdx > closeIdx &&
				unlinkIdx > linkIdx,
		);

		// Read back via readMailMessageFile (O_RDONLY|O_NOFOLLOW|O_NONBLOCK + fstat)
		const readBack = await readMailMessageFile(fs, res.path!);
		assert.equal(readBack.ok, true);
		if (readBack.ok) {
			assert.equal(readBack.value.id, res.id);
			assert.equal(readBack.value.from, "gjc-herdr-mate");
			assert.equal(readBack.value.to, "gjc-herdr-lead");
			assert.equal(readBack.value.subject, "1단계 보고");
			assert.equal(readBack.value.body, "정상 본문입니다.");
			assert.equal(
				readBack.value.bodySha256,
				computeSha256Hex(new TextEncoder().encode("정상 본문입니다.")),
			);
		}
		assert.equal(openCalls.length, 2);
		const readFlags = openCalls[1]!.flags;
		assert.notEqual(readFlags & fsConstants.O_NOFOLLOW, 0);
		assert.notEqual(readFlags & fsConstants.O_NONBLOCK, 0);
		assert.equal(readFlags & (fsConstants.O_WRONLY | fsConstants.O_RDWR), fsConstants.O_RDONLY);
	}

	// 2. link EEXIST -> id_conflict, tmp removed, existing final file untouched
	{
		let capturedTmp = "";
		const originalBytes = new TextEncoder().encode("existing-file");
		const { deps, nodes, makeErr } = createFakeMailEnv({
			linkHook: (tmpPath, finalPath) => {
				capturedTmp = tmpPath;
				nodes.set(finalPath, {
					kind: "file",
					mode: MAIL_FILE_MODE,
					bytes: originalBytes,
				});
				throw makeErr("EEXIST", finalPath);
			},
		});
		const res = await sendMail(deps, {
			to: "gjc-herdr-lead",
			subject: "충돌",
			body: "새 본문",
		});
		assert.equal(res.ok, false);
		assert.equal(res.error?.code, "id_conflict");
		assert.equal(nodes.has(capturedTmp), false);
		const finalEntry = [...nodes.entries()].find(([k]) => k.endsWith(".md"));
		assert.deepEqual(finalEntry?.[1].bytes, originalBytes);
	}

	// 3. Other link failure (e.g. EXDEV) -> publish_failed with original code, tmp removed
	{
		let capturedTmp = "";
		const { deps, nodes, makeErr } = createFakeMailEnv({
			linkHook: (tmpPath) => {
				capturedTmp = tmpPath;
				throw makeErr("EXDEV", "cross-device link not permitted");
			},
		});
		const res = await sendMail(deps, {
			to: "gjc-herdr-lead",
			subject: "링크 실패",
			body: "본문",
		});
		assert.equal(res.ok, false);
		assert.equal(res.error?.code, "publish_failed");
		assert.equal(res.error?.causeCode, "EXDEV");
		assert.match(res.error?.message ?? "", /EXDEV/);
		assert.equal(nodes.has(capturedTmp), false);
	}

	// 4. Unlink failure after link succeeds -> ok: true + warning tmp_cleanup_failed
	{
		let capturedTmp = "";
		const { deps, nodes, makeErr } = createFakeMailEnv({
			unlinkHook: (tmpPath) => {
				capturedTmp = tmpPath;
				throw makeErr("EACCES", "unlink denied");
			},
		});
		const res = await sendMail(deps, {
			to: "gjc-herdr-lead",
			subject: "정리 실패",
			body: "본문",
		});
		assert.equal(res.ok, true);
		assert.equal(res.warnings?.length, 1);
		assert.equal(res.warnings?.[0]?.code, "tmp_cleanup_failed");
		assert.equal(res.warnings?.[0]?.path, capturedTmp);
		assert.equal(nodes.has(res.path!), true);
	}

	// 5. Tmp exclusive creation conflict (open EEXIST) -> fails without link or unlink
	{
		const { deps, fsOpsLog, makeErr } = createFakeMailEnv({
			openHook: (path) => {
				throw makeErr("EEXIST", path);
			},
		});
		const res = await sendMail(deps, {
			to: "gjc-herdr-lead",
			subject: "임시 파일 충돌",
			body: "본문",
		});
		assert.equal(res.ok, false);
		assert.equal(res.error?.code, "publish_failed");
		assert.equal(res.error?.causeCode, "EEXIST");
		assert.equal(
			fsOpsLog.some((e) => e.startsWith("link:") || e.startsWith("unlink:")),
			false,
		);
	}
});

test("§4 herdr_mail_send tool and extension registration work without a Herdr pane", async () => {
	// Missing or invalid GJC_HERDR_MAILBOX is rejected before any git/fs call
	for (const envVal of [undefined, "", "Invalid_Name", "-bad", "a".repeat(33)]) {
		const { deps, gitCalls, fsOpsLog } = createFakeMailEnv({
			env: { GJC_HERDR_MAILBOX: envVal },
		});
		const res = await sendMail(deps, {
			to: "gjc-herdr-lead",
			subject: "제목",
			body: "본문",
		});
		assert.equal(res.ok, false);
		assert.equal(gitCalls.length, 0);
		assert.equal(fsOpsLog.length, 0);
	}

	assert.equal(isValidMailboxName("gjc-herdr-lead"), true);
	assert.equal(isValidMailboxName("a"), true);
	assert.equal(isValidMailboxName("1abc"), false);
	assert.equal(isValidMailboxName("bad_name"), false);

	// Invalid recipient / subject / reply_to / size rejected before git/fs
	{
		const { deps, gitCalls, fsOpsLog } = createFakeMailEnv();
		for (const req of [
			{ to: "BAD_TO", subject: "제목", body: "본문" },
			{ to: "gjc-herdr-lead", subject: "", body: "본문" },
			{ to: "gjc-herdr-lead", subject: "제목\n두줄", body: "본문" },
			{
				to: "gjc-herdr-lead",
				subject: "제목",
				body: "본문",
				reply_to: "bad-ulid",
			},
			{
				to: "gjc-herdr-lead",
				subject: "제목",
				body: "x".repeat(MAX_MESSAGE_BYTES),
			},
		]) {
			const res = await sendMail(deps, req);
			assert.equal(res.ok, false);
		}
		assert.equal(gitCalls.length, 0);
		assert.equal(fsOpsLog.length, 0);
	}

	// Tool registration & execution via registerMailFeatures
	const { deps, fs } = createFakeMailEnv();
	let registeredTool:
		| {
				name: string;
				execute: (
					toolCallId: string,
					params: {
						to: string;
						subject: string;
						body: string;
						reply_to?: string;
					},
					signal?: AbortSignal,
				) => Promise<{
					content: { type: string; text: string }[];
					details: Awaited<ReturnType<typeof sendMail>>;
					isError: boolean;
				}>;
		  }
		| undefined;

	registerMailFeatures(
		{
			zod,
			exec: deps.exec,
			registerTool: (def: typeof registeredTool) => {
				registeredTool = def;
			},
		} as unknown as ExtensionAPI,
		deps,
	);
	assert.equal(registeredTool?.name, "herdr_mail_send");

	const toolOut = await registeredTool!.execute("call-1", {
		to: "gjc-herdr-lead",
		subject: "도구 전송 테스트",
		body: "우편 본문",
		reply_to: VALID_REPLY_ID,
	});
	assert.equal(toolOut.isError, false);
	assert.equal(toolOut.details.ok, true);
	assert(toolOut.details.id && isValidUlid(toolOut.details.id));
	assert.equal(
		toolOut.details.path,
		`${REPO_TOP}/.gjc-herdr/mailbox/gjc-herdr-lead/${toolOut.details.id}.md`,
	);

	// Also verify ack and attempt file readers on the same fake fs
	const ackPath = `${REPO_TOP}/.gjc-herdr/mailbox/gjc-herdr-lead/${toolOut.details.id}.ack`;
	const formattedAck = formatMailAck({
		id: toolOut.details.id!,
		by: "gjc-herdr-lead",
		at: VALID_TIME,
		state: "received",
		via: "manual",
		bodySha256: computeSha256Hex(new TextEncoder().encode("우편 본문")),
	});
	assert.equal(formattedAck.ok, true);
	if (formattedAck.ok) {
		const h = await fs.open(ackPath, MAIL_CREATE_TMP_FLAGS, MAIL_FILE_MODE);
		await h.write(new TextEncoder().encode(formattedAck.value));
		await h.close();
		const ackRead = await readMailAckFile(fs, ackPath);
		assert.equal(ackRead.ok, true);
	}

	const attemptPath = `${REPO_TOP}/.gjc-herdr/mailbox/gjc-herdr-lead/${toolOut.details.id}.attempt`;
	const formattedAttempt = formatMailAttempt({
		id: toolOut.details.id!,
		bodySha256: computeSha256Hex(new TextEncoder().encode("우편 본문")),
		consumer: VALID_TOKEN,
		session: "sess-01",
		at: VALID_TIME,
	});
	assert.equal(formattedAttempt.ok, true);
	if (formattedAttempt.ok) {
		const h = await fs.open(attemptPath, MAIL_CREATE_TMP_FLAGS, MAIL_FILE_MODE);
		await h.write(new TextEncoder().encode(formattedAttempt.value));
		await h.close();
		const attemptRead = await readMailAttemptFile(fs, attemptPath);
		assert.equal(attemptRead.ok, true);
	}

	// Verify src/extension.ts registers herdr_mail_send even without Herdr pane env
	const prevEnv = process.env.HERDR_ENV;
	const prevPane = process.env.HERDR_PANE_ID;
	delete process.env.HERDR_ENV;
	delete process.env.HERDR_PANE_ID;
	try {
		const registeredTools: string[] = [];
		herdrMetadata({
			zod,
			exec: deps.exec,
			logger: { info: () => {}, warn: () => {} },
			registerCommand: () => {},
			registerTool: (def: { name: string }) => {
				registeredTools.push(def.name);
			},
			on: () => {},
		} as unknown as ExtensionAPI);
		assert(registeredTools.includes("herdr_mail_send"));
	} finally {
		if (prevEnv !== undefined) process.env.HERDR_ENV = prevEnv;
		if (prevPane !== undefined) process.env.HERDR_PANE_ID = prevPane;
	}
});

test("F1 supplementary Unicode (emoji & non-BMP CJK) succeeds in body, subject, and reason while isolated surrogates are rejected", () => {
	// 1. Valid surrogate pairs in subject, body, and ack reason succeed, and string vs Uint8Array parsing matches
	const emojiSubject = "완료 보고 😀 𠀋";
	const emojiBody = "본문 이모지 😀와 비BMP 한자 𠀋 포함\n둘째 줄 🚀";
	const created = formatMailMessage({
		id: VALID_ID,
		from: "gjc-herdr-mate",
		to: "gjc-herdr-lead",
		created: VALID_TIME,
		subject: emojiSubject,
		body: emojiBody,
	});
	assert.equal(created.ok, true);
	if (!created.ok) return;

	const fromString = parseMailMessage(created.value.text, {
		expectedId: VALID_ID,
		expectedTo: "gjc-herdr-lead",
	});
	const fromBytes = parseMailMessage(created.value.bytes, {
		expectedId: VALID_ID,
		expectedTo: "gjc-herdr-lead",
	});
	assert.equal(fromString.ok, true);
	assert.equal(fromBytes.ok, true);
	if (fromString.ok && fromBytes.ok) {
		assert.deepEqual(fromString.value, fromBytes.value);
		assert.equal(fromString.value.subject, emojiSubject);
		assert.equal(fromString.value.body, emojiBody);
	}

	const emojiAck = formatMailAck({
		id: VALID_ID,
		by: "gjc-herdr-lead",
		at: VALID_TIME,
		state: "rejected",
		via: "manual",
		reason: "거절 사유 😀 𠀋",
	});
	assert.equal(emojiAck.ok, true);
	if (emojiAck.ok) {
		const ackStr = parseMailAck(emojiAck.value);
		const ackBytes = parseMailAck(new TextEncoder().encode(emojiAck.value));
		assert.equal(ackStr.ok, true);
		assert.equal(ackBytes.ok, true);
		if (ackStr.ok && ackBytes.ok) {
			assert.deepEqual(ackStr.value, ackBytes.value);
			assert.equal(ackStr.value.reason, "거절 사유 😀 𠀋");
		}
	}

	// 2. Isolated high surrogate (\ud83d) and isolated low surrogate (\ude00) are rejected
	for (const lone of ["앞\ud83d뒤", "앞\ude00뒤", "\ud83d", "\ude00"]) {
		const badBody = formatMailMessage({
			id: VALID_ID,
			from: "gjc-herdr-mate",
			to: "gjc-herdr-lead",
			created: VALID_TIME,
			subject: "정상 제목",
			body: lone,
		});
		assert.equal(badBody.ok, false);
		if (!badBody.ok) assert.equal(badBody.code, "invalid_utf8");

		const badSubj = formatMailMessage({
			id: VALID_ID,
			from: "gjc-herdr-mate",
			to: "gjc-herdr-lead",
			created: VALID_TIME,
			subject: lone,
			body: "정상 본문",
		});
		assert.equal(badSubj.ok, false);
		if (!badSubj.ok) assert.equal(badSubj.code, "invalid_subject");

		const badReason = formatMailAck({
			id: VALID_ID,
			by: "gjc-herdr-lead",
			at: VALID_TIME,
			state: "rejected",
			via: "manual",
			reason: lone,
		});
		assert.equal(badReason.ok, false);
		if (!badReason.ok) assert.equal(badReason.code, "invalid_reason");

		const badParseMsg = parseMailMessage(`${created.value.text}${lone}`);
		assert.equal(badParseMsg.ok, false);
		if (!badParseMsg.ok) assert.equal(badParseMsg.code, "invalid_utf8");
	}
});

test("F2 abort signal stops before publication, cleans up own tmp on mid-write abort, and preserves success after link", async () => {
	// 1. Abort during boundary check -> link 0 times, code 'aborted'
	{
		const controller = new AbortController();
		const { deps, fs, fsOpsLog } = createFakeMailEnv();
		const origRealpath = fs.realpath.bind(fs);
		fs.realpath = async (path: string) => {
			const out = await origRealpath(path);
			controller.abort();
			return out;
		};
		const res = await sendMail(
			deps,
			{ to: "gjc-herdr-lead", subject: "취소1", body: "본문" },
			controller.signal,
		);
		assert.equal(res.ok, false);
		assert.equal(res.error?.code, "aborted");
		assert.equal(
			fsOpsLog.filter((e) => e.startsWith("open:")).length,
			0,
		);
		assert.equal(
			fsOpsLog.filter((e) => e.startsWith("link:")).length,
			0,
		);
	}

	// 2. Abort during first write -> close 1 time, own tmp unlink 1 time, link 0 times, code 'aborted'
	{
		const controller = new AbortController();
		let createdTmpPath = "";
		const { deps, fs, nodes, fsOpsLog } = createFakeMailEnv();
		const origOpen = fs.open.bind(fs);
		fs.open = async (path, flags, mode) => {
			createdTmpPath = path;
			const handle = await origOpen(path, flags, mode);
			const origWrite = handle.write.bind(handle);
			return {
				...handle,
				async write(buffer, offset, length, position) {
					const out = await origWrite(buffer, offset, length, position);
					controller.abort();
					return out;
				},
			};
		};
		const otherTmp = `${REPO_TOP}/.gjc-herdr/mailbox/gjc-herdr-lead/.other.00000000.tmp`;
		nodes.set(otherTmp, {
			kind: "file",
			mode: MAIL_FILE_MODE,
			bytes: new Uint8Array([1, 2, 3]),
		});

		const res = await sendMail(
			deps,
			{ to: "gjc-herdr-lead", subject: "취소2", body: "본문" },
			controller.signal,
		);
		assert.equal(res.ok, false);
		assert.equal(res.error?.code, "aborted");
		assert.equal(
			fsOpsLog.filter((e) => e === `close:${createdTmpPath}`).length,
			1,
		);
		assert.equal(
			fsOpsLog.filter((e) => e === `unlink:${createdTmpPath}`).length,
			1,
		);
		assert.equal(
			fsOpsLog.filter((e) => e.startsWith("link:")).length,
			0,
		);
		assert.equal(nodes.has(createdTmpPath), false);
		assert.equal(nodes.has(otherTmp), true);
	}

	// 3. Abort right after link succeeds -> ok: true
	{
		const controller = new AbortController();
		const { deps, nodes } = createFakeMailEnv({
			linkHook: () => {
				controller.abort();
			},
		});
		const res = await sendMail(
			deps,
			{ to: "gjc-herdr-lead", subject: "링크 후 취소", body: "본문" },
			controller.signal,
		);
		assert.equal(res.ok, true);
		assert(res.path && nodes.has(res.path));
	}
});

test("F3 & P3 write-side non-regular file rejection, missing fs.constants rejection, and isMissingPath code precedence", async () => {
	// 1. Write-side handle.stat() returning non-regular file -> close 1, unlink 1, link 0, publish_failed
	{
		let createdTmpPath = "";
		const { deps, fs, nodes, fsOpsLog } = createFakeMailEnv({
			openHook: (path) => {
				createdTmpPath = path;
			},
		});
		const origOpen = fs.open.bind(fs);
		fs.open = async (path, flags, mode) => {
			const handle = await origOpen(path, flags, mode);
			const node = nodes.get(path)!;
			node.kind = "fifo";
			return handle;
		};
		const res = await sendMail(deps, {
			to: "gjc-herdr-lead",
			subject: "비정규 임시파일",
			body: "본문",
		});
		assert.equal(res.ok, false);
		assert.equal(res.error?.code, "publish_failed");
		assert.equal(
			fsOpsLog.filter((e) => e === `close:${createdTmpPath}`).length,
			1,
		);
		assert.equal(
			fsOpsLog.filter((e) => e === `unlink:${createdTmpPath}`).length,
			1,
		);
		assert.equal(
			fsOpsLog.filter((e) => e.startsWith("link:")).length,
			0,
		);
		assert.equal(nodes.has(createdTmpPath), false);
	}

	// 2. Missing required fs.constants rejects with unsupported_platform before open
	{
		const { deps, fs, fsOpsLog } = createFakeMailEnv();
		fs.constants = {
			...fsConstants,
			O_NOFOLLOW: undefined,
		};
		const sendRes = await sendMail(deps, {
			to: "gjc-herdr-lead",
			subject: "플랫폼 미지원",
			body: "본문",
		});
		assert.equal(sendRes.ok, false);
		assert.equal(sendRes.error?.code, "unsupported_platform");
		assert.equal(
			fsOpsLog.filter((e) => e.startsWith("open:")).length,
			0,
		);

		const readRes = await readMailboxFileBytes(
			fs,
			`${REPO_TOP}/.gjc-herdr/mailbox/gjc-herdr-lead/${VALID_ID}.md`,
		);
		assert.equal(readRes.ok, false);
		if (!readRes.ok) assert.equal(readRes.code, "unsupported_platform");
	}

	// 3. isMissingPath checks only error.code when present (ignores ENOENT in message if code is EACCES)
	{
		const { deps, fs } = createFakeMailEnv();
		fs.lstat = async () => {
			throw Object.assign(new Error("EACCES: permission denied (not ENOENT)"), {
				code: "EACCES",
			});
		};
		const res = await sendMail(deps, {
			to: "gjc-herdr-lead",
			subject: "권한 오류",
			body: "본문",
		});
		assert.equal(res.ok, false);
		assert.equal(res.error?.code, "path_boundary_failed");
		assert.equal(res.error?.causeCode, "EACCES");
	}
});
