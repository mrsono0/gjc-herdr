import { createHash } from "node:crypto";
import {
	constants as fsConstants,
	link as nodeLink,
	lstat as nodeLstat,
	mkdir as nodeMkdir,
	open as nodeOpen,
	readdir as nodeReaddir,
	realpath as nodeRealpath,
	rename as nodeRename,
	unlink as nodeUnlink,
} from "node:fs/promises";
import { posix } from "node:path";
import type { ExtensionAPI, ExecResult } from "@gajae-code/coding-agent";
import { isInteractiveMainSession } from "./metadata.ts";

type Exec = ExtensionAPI["exec"];

const GIT_TIMEOUT_MS = 5_000;
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const MAILBOX_ENV_KEY = "GJC_HERDR_MAILBOX";
export const MAILBOX_REL_ROOT = ".gjc-herdr/mailbox";
export const MAX_RECORD_BYTES = 1_024;
export const MAX_HEADER_BYTES = 4_096;
export const MAX_MESSAGE_BYTES = 256 * 1_024;
export const MAX_SHORT_TEXT_BYTES = 200;
export const MAIL_DIR_MODE = 0o700;
export const MAIL_FILE_MODE = 0o600;

export const MAIL_CREATE_TMP_FLAGS =
	fsConstants.O_WRONLY |
	fsConstants.O_CREAT |
	fsConstants.O_EXCL |
	fsConstants.O_NOFOLLOW |
	fsConstants.O_NONBLOCK;

export const MAIL_READ_OPEN_FLAGS =
	fsConstants.O_RDONLY |
	fsConstants.O_NOFOLLOW |
	fsConstants.O_NONBLOCK;

const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const KEY_RE = /^[a-z_0-9]+$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const PID_RE = /^[1-9][0-9]{0,9}$/;
const TOKEN_RE = /^[0-9a-f]{32}$/;
const SESSION_RE = /^[A-Za-z0-9-]{1,64}$/;
const TIMESTAMP_RE =
	/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(Z|([+-])(\d\d):(\d\d))$/;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f-\u009f]/;

export type AckState = "received" | "rejected" | "uncertain";
export type AckVia = "observed" | "manual";

export interface MailStat {
	isFile(): boolean;
	isDirectory(): boolean;
	isSymbolicLink(): boolean;
	mode?: number;
	size: number;
	ino?: number | bigint;
}

export interface MailReadResult {
	bytesRead: number;
	buffer: Uint8Array;
}

export interface MailWriteResult {
	bytesWritten: number;
}

export interface MailFileHandle {
	stat(): Promise<MailStat>;
	read(
		buffer: Uint8Array,
		offset: number,
		length: number,
		position: number | null,
	): Promise<MailReadResult>;
	write(
		buffer: Uint8Array,
		offset?: number,
		length?: number,
		position?: number | null,
	): Promise<MailWriteResult | number>;
	sync(): Promise<void>;
	close(): Promise<void>;
}

export interface MailFs {
	constants?: Record<string, number | undefined>;
	lstat(path: string): Promise<MailStat>;
	realpath(path: string): Promise<string>;
	mkdir(path: string, options?: { mode?: number }): Promise<unknown>;
	open(path: string, flags: number, mode?: number): Promise<MailFileHandle>;
	link(existingPath: string, newPath: string): Promise<void>;
	unlink(path: string): Promise<void>;
	readdir?(path: string): Promise<string[]>;
	rename?(oldPath: string, newPath: string): Promise<void>;
}

export interface MailDeps {
	exec: Exec;
	fs?: MailFs;
	env?: Record<string, string | undefined>;
	now?: () => number;
	randomBytes?: (target: Uint8Array) => Uint8Array;
}

export interface MailWarning {
	code: "tmp_cleanup_failed" | "dir_mode_not_0700";
	path: string;
	message: string;
}

export interface MailError {
	code: string;
	message: string;
	causeCode?: string;
}

export interface MailSendRequest {
	to: string;
	subject: string;
	body: string;
	reply_to?: string;
}

export interface MailSendResult {
	ok: boolean;
	id?: string;
	path?: string;
	warnings?: MailWarning[];
	error?: MailError;
}

export type ParseResult<T> =
	| { ok: true; value: T }
	| { ok: false; code: string; reason: string };

export interface MailMessage {
	id: string;
	from: string;
	to: string;
	created: string;
	subject: string;
	replyTo?: string;
	bodySha256: string;
	body: string;
}

export interface MailAck {
	id: string;
	by: string;
	at: string;
	state: AckState;
	via: AckVia;
	bodySha256?: string;
	reason?: string;
}

export interface MailAttempt {
	id: string;
	bodySha256: string;
	consumer: string;
	session: string;
	at: string;
}

export interface MailLockRecord {
	pid: string;
	token: string;
	at: string;
}

export const defaultMailFs: MailFs = {
	lstat: (path) => nodeLstat(path),
	realpath: (path) => nodeRealpath(path),
	mkdir: (path, options) => nodeMkdir(path, options),
	open: async (path, flags, mode) =>
		(await nodeOpen(path, flags, mode)) as unknown as MailFileHandle,
	link: (existingPath, newPath) => nodeLink(existingPath, newPath),
	unlink: (path) => nodeUnlink(path),
	readdir: (path) => nodeReaddir(path),
	rename: (oldPath, newPath) => nodeRename(oldPath, newPath),
};

const defaultFs: MailFs = defaultMailFs;

function resolveReadOpenFlags(
	constants: Record<string, number | undefined> = fsConstants,
): number | undefined {
	const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = constants;
	if (
		typeof O_RDONLY !== "number" ||
		typeof O_NOFOLLOW !== "number" ||
		O_NOFOLLOW === 0 ||
		typeof O_NONBLOCK !== "number" ||
		O_NONBLOCK === 0
	) {
		return undefined;
	}
	return O_RDONLY | O_NOFOLLOW | O_NONBLOCK;
}

function resolveCreateTmpFlags(
	constants: Record<string, number | undefined> = fsConstants,
): number | undefined {
	const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_NONBLOCK } = constants;
	if (
		typeof O_WRONLY !== "number" ||
		O_WRONLY === 0 ||
		typeof O_CREAT !== "number" ||
		O_CREAT === 0 ||
		typeof O_EXCL !== "number" ||
		O_EXCL === 0 ||
		typeof O_NOFOLLOW !== "number" ||
		O_NOFOLLOW === 0 ||
		typeof O_NONBLOCK !== "number" ||
		O_NONBLOCK === 0
	) {
		return undefined;
	}
	return O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_NONBLOCK;
}

function abortedError(message = "Mail operation was aborted."): MailError {
	return {
		code: "aborted",
		message,
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | undefined)?.code;
	return typeof code === "string" && code ? code : undefined;
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
	return (
		bytes.byteLength >= 3 &&
		bytes[0] === 0xef &&
		bytes[1] === 0xbb &&
		bytes[2] === 0xbf
	);
}

function decodeStrictUtf8(bytes: Uint8Array): ParseResult<string> {
	if (hasUtf8Bom(bytes)) {
		return {
			ok: false,
			code: "bom_forbidden",
			reason: "File must not start with a UTF-8 BOM.",
		};
	}
	try {
		const text = new TextDecoder("utf-8", {
			fatal: true,
			ignoreBOM: true,
		}).decode(bytes);
		if (text.startsWith("\ufeff")) {
			return {
				ok: false,
				code: "bom_forbidden",
				reason: "File must not start with a BOM.",
			};
		}
		return { ok: true, value: text };
	} catch (error) {
		return {
			ok: false,
			code: "invalid_utf8",
			reason: `Invalid UTF-8 byte sequence: ${errorMessage(error)}`,
		};
	}
}

function hasLoneSurrogate(value: string): boolean {
	for (const ch of value) {
		const cp = ch.codePointAt(0)!;
		if (cp >= 0xd800 && cp <= 0xdfff) return true;
	}
	return false;
}

function toUtf8Bytes(input: string | Uint8Array): ParseResult<{
	bytes: Uint8Array;
	text: string;
}> {
	if (typeof input === "string") {
		if (input.startsWith("\ufeff")) {
			return {
				ok: false,
				code: "bom_forbidden",
				reason: "Input must not start with a BOM.",
			};
		}
		if (hasLoneSurrogate(input)) {
			return {
				ok: false,
				code: "invalid_utf8",
				reason: "Input contains an unpaired UTF-16 surrogate.",
			};
		}
		const bytes = new TextEncoder().encode(input);
		return { ok: true, value: { bytes, text: input } };
	}
	const decoded = decodeStrictUtf8(input);
	if (!decoded.ok) return decoded;
	return { ok: true, value: { bytes: input, text: decoded.value } };
}

export function isValidMailboxName(value: string): boolean {
	return NAME_RE.test(value);
}

export function isValidUlid(value: string): boolean {
	return ULID_RE.test(value);
}

/**
 * Generates a 26-character Crockford Base32 ULID:
 * 48-bit millisecond timestamp (10 chars) + 80-bit crypto randomness (16 chars).
 */
export function createUlid(
	nowMs = Date.now(),
	fillRandom: (target: Uint8Array) => Uint8Array = (buf) =>
		crypto.getRandomValues(buf),
): string {
	if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs > 0xffffffffffff) {
		throw new RangeError(`ULID timestamp out of 48-bit range: ${nowMs}`);
	}
	const timeChars = new Array<string>(10);
	let rem = nowMs;
	for (let i = 9; i >= 0; i--) {
		timeChars[i] = CROCKFORD_BASE32[rem & 31]!;
		rem = Math.floor(rem / 32);
	}
	const rnd = fillRandom(new Uint8Array(10));
	const randChars = new Array<string>(16);
	for (let block = 0; block < 2; block++) {
		const offset = block * 5;
		const b0 = rnd[offset]!;
		const b1 = rnd[offset + 1]!;
		const b2 = rnd[offset + 2]!;
		const b3 = rnd[offset + 3]!;
		const b4 = rnd[offset + 4]!;
		const out = block * 8;
		randChars[out] = CROCKFORD_BASE32[(b0 >> 3) & 31]!;
		randChars[out + 1] = CROCKFORD_BASE32[((b0 & 7) << 2) | ((b1 >> 6) & 3)]!;
		randChars[out + 2] = CROCKFORD_BASE32[(b1 >> 1) & 31]!;
		randChars[out + 3] = CROCKFORD_BASE32[((b1 & 1) << 4) | ((b2 >> 4) & 15)]!;
		randChars[out + 4] = CROCKFORD_BASE32[((b2 & 15) << 1) | ((b3 >> 7) & 1)]!;
		randChars[out + 5] = CROCKFORD_BASE32[(b3 >> 2) & 31]!;
		randChars[out + 6] = CROCKFORD_BASE32[((b3 & 3) << 3) | ((b4 >> 5) & 7)]!;
		randChars[out + 7] = CROCKFORD_BASE32[b4 & 31]!;
	}
	return timeChars.join("") + randChars.join("");
}

export function randomHex8(
	fillRandom: (target: Uint8Array) => Uint8Array = (buf) =>
		crypto.getRandomValues(buf),
): string {
	const bytes = fillRandom(new Uint8Array(4));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomHex16(
	fillRandom: (target: Uint8Array) => Uint8Array = (buf) =>
		crypto.getRandomValues(buf),
): string {
	const bytes = fillRandom(new Uint8Array(16));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
	switch (month) {
		case 2:
			return isLeapYear(year) ? 29 : 28;
		case 4:
		case 6:
		case 9:
		case 11:
			return 30;
		default:
			return 31;
	}
}

export function isValidRfc3339Timestamp(value: string): boolean {
	const match = TIMESTAMP_RE.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const second = Number(match[6]);
	if (year < 1 || month < 1 || month > 12) return false;
	if (day < 1 || day > daysInMonth(year, month)) return false;
	if (hour > 23 || minute > 59 || second > 59) return false;
	if (match[7] !== "Z") {
		const offHour = Number(match[9]);
		const offMin = Number(match[10]);
		if (offHour > 23 || offMin > 59) return false;
	}
	return true;
}

export function computeSha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function isTrimmedSingleLineText(value: string): boolean {
	if (!value || value !== value.trim()) return false;
	if (CONTROL_CHAR_RE.test(value) || hasLoneSurrogate(value)) return false;
	const byteLength = Buffer.byteLength(value, "utf8");
	return byteLength >= 1 && byteLength <= MAX_SHORT_TEXT_BYTES;
}

export function validateFieldValue(
	key: string,
	value: string,
): ParseResult<string> {
	if (!value) {
		return {
			ok: false,
			code: "empty_value",
			reason: `Value for ${key} must not be empty.`,
		};
	}
	if (value !== value.trim()) {
		return {
			ok: false,
			code: "whitespace_forbidden",
			reason: `Value for ${key} must not have leading or trailing whitespace.`,
		};
	}
	if (CONTROL_CHAR_RE.test(value)) {
		return {
			ok: false,
			code: "control_char_forbidden",
			reason: `Value for ${key} contains a control character.`,
		};
	}
	switch (key) {
		case "created":
		case "at":
			return isValidRfc3339Timestamp(value)
				? { ok: true, value }
				: {
						ok: false,
						code: "invalid_timestamp",
						reason: `Invalid RFC 3339 timestamp for ${key}: ${value}`,
					};
		case "id":
		case "reply_to":
			return isValidUlid(value)
				? { ok: true, value }
				: {
						ok: false,
						code: "invalid_ulid",
						reason: `Invalid ULID for ${key}: ${value}`,
					};
		case "from":
		case "to":
		case "by":
			return isValidMailboxName(value)
				? { ok: true, value }
				: {
						ok: false,
						code: "invalid_name",
						reason: `Invalid mailbox name for ${key}: ${value}`,
					};
		case "body_sha256":
			return SHA256_RE.test(value)
				? { ok: true, value }
				: {
						ok: false,
						code: "invalid_sha256",
						reason: `Invalid body_sha256: ${value}`,
					};
		case "pid":
			return PID_RE.test(value)
				? { ok: true, value }
				: {
						ok: false,
						code: "invalid_pid",
						reason: `Invalid pid: ${value}`,
					};
		case "token":
		case "consumer":
			return TOKEN_RE.test(value)
				? { ok: true, value }
				: {
						ok: false,
						code: "invalid_token",
						reason: `Invalid 32-hex token for ${key}: ${value}`,
					};
		case "session":
			return SESSION_RE.test(value)
				? { ok: true, value }
				: {
						ok: false,
						code: "invalid_session",
						reason: `Invalid session ID: ${value}`,
					};
		case "state":
			return value === "received" ||
				value === "rejected" ||
				value === "uncertain"
				? { ok: true, value }
				: {
						ok: false,
						code: "invalid_state",
						reason: `Invalid ack state: ${value}`,
					};
		case "via":
			return value === "observed" || value === "manual"
				? { ok: true, value }
				: {
						ok: false,
						code: "invalid_via",
						reason: `Invalid ack via: ${value}`,
					};
		case "subject":
		case "reason":
			return isTrimmedSingleLineText(value)
				? { ok: true, value }
				: {
						ok: false,
						code: `invalid_${key}`,
						reason: `Invalid ${key}: must be 1–200 UTF-8 bytes without leading/trailing whitespace or control characters.`,
					};
		default:
			return {
				ok: false,
				code: "unknown_key",
				reason: `Unknown key: ${key}`,
			};
	}
}

export interface KvParseOptions {
	allowedKeys: ReadonlySet<string>;
	requiredKeys?: ReadonlySet<string>;
	maxBytes?: number;
}

/**
 * §3.0 line grammar parser shared by message frontmatter and record files
 * (ack, attempt, consumer lock).
 */
export function parseKvBlock(
	input: string | Uint8Array,
	options: KvParseOptions,
): ParseResult<Record<string, string>> {
	const maxBytes = options.maxBytes ?? MAX_RECORD_BYTES;
	const converted = toUtf8Bytes(input);
	if (!converted.ok) return converted;
	const { bytes, text } = converted.value;
	if (bytes.byteLength > maxBytes) {
		return {
			ok: false,
			code: "size_exceeded",
			reason: `Block size ${bytes.byteLength} bytes exceeds the ${maxBytes}-byte limit.`,
		};
	}
	if (text.includes("\r")) {
		return {
			ok: false,
			code: "cr_forbidden",
			reason: "CR is not permitted in headers or record files.",
		};
	}
	if (!text.endsWith("\n")) {
		return {
			ok: false,
			code: "missing_trailing_lf",
			reason: "Every line in a header or record file must end with LF.",
		};
	}
	const body = text.slice(0, -1);
	if (!body) {
		return {
			ok: false,
			code: "empty_line",
			reason: "Empty record or header block is not permitted.",
		};
	}
	const lines = body.split("\n");
	const result: Record<string, string> = {};
	const seen = new Set<string>();

	for (const line of lines) {
		if (!line) {
			return {
				ok: false,
				code: "empty_line",
				reason: "Blank lines are not permitted in headers or record files.",
			};
		}
		if (line !== line.trim()) {
			return {
				ok: false,
				code: "whitespace_forbidden",
				reason: "Leading or trailing whitespace is not permitted.",
			};
		}
		const colonIndex = line.indexOf(":");
		if (colonIndex <= 0) {
			return {
				ok: false,
				code: "invalid_line",
				reason: `Malformed line (missing '<key>: <value>'): ${line}`,
			};
		}
		const key = line.slice(0, colonIndex);
		if (key !== key.trim()) {
			return {
				ok: false,
				code: "whitespace_forbidden",
				reason: `Whitespace around key is not permitted: ${key}`,
			};
		}
		if (!KEY_RE.test(key)) {
			return {
				ok: false,
				code: "invalid_key",
				reason: `Invalid key syntax: ${key}`,
			};
		}
		if (line[colonIndex + 1] !== " ") {
			return {
				ok: false,
				code: "invalid_line",
				reason: `Key '${key}' must be followed by ': ' (colon and a single space).`,
			};
		}
		if (!options.allowedKeys.has(key)) {
			return {
				ok: false,
				code: "unknown_key",
				reason: `Unknown key: ${key}`,
			};
		}
		if (seen.has(key)) {
			return {
				ok: false,
				code: "duplicate_key",
				reason: `Duplicate key: ${key}`,
			};
		}
		const rawValue = line.slice(colonIndex + 2);
		const validated = validateFieldValue(key, rawValue);
		if (!validated.ok) return validated;
		seen.add(key);
		result[key] = validated.value;
	}

	if (options.requiredKeys) {
		for (const req of options.requiredKeys) {
			if (!seen.has(req)) {
				return {
					ok: false,
					code: "missing_key",
					reason: `Missing required key: ${req}`,
				};
			}
		}
	}

	return { ok: true, value: result };
}

/**
 * §3.0 serializer for record files and header blocks.
 */
export function serializeKvBlock(
	entries: ReadonlyArray<readonly [string, string]>,
	options: KvParseOptions,
): ParseResult<string> {
	const lines: string[] = [];
	for (const [key, value] of entries) {
		if (!KEY_RE.test(key)) {
			return {
				ok: false,
				code: "invalid_key",
				reason: `Invalid key syntax: ${key}`,
			};
		}
		const validated = validateFieldValue(key, value);
		if (!validated.ok) return validated;
		lines.push(`${key}: ${value}\n`);
	}
	const text = lines.join("");
	const checked = parseKvBlock(text, options);
	if (!checked.ok) return checked;
	return { ok: true, value: text };
}

const MESSAGE_ALLOWED_KEYS = new Set([
	"id",
	"from",
	"to",
	"created",
	"subject",
	"reply_to",
	"body_sha256",
]);

const MESSAGE_REQUIRED_KEYS = new Set([
	"id",
	"from",
	"to",
	"created",
	"subject",
	"body_sha256",
]);

export interface CreateMessageInput {
	id: string;
	from: string;
	to: string;
	created: string;
	subject: string;
	body: string;
	replyTo?: string;
}

/**
 * §3.1 Builds and validates a complete message (header + UTF-8 Markdown body).
 */
export function formatMailMessage(
	input: CreateMessageInput,
): ParseResult<{ text: string; bytes: Uint8Array; message: MailMessage }> {
	if (typeof input.body !== "string" || hasLoneSurrogate(input.body)) {
		return {
			ok: false,
			code: "invalid_utf8",
			reason: "Message body is not valid UTF-8.",
		};
	}
	const bodyBytes = new TextEncoder().encode(input.body);
	const bodySha256 = computeSha256Hex(bodyBytes);
	const entries: Array<readonly [string, string]> = [
		["id", input.id],
		["from", input.from],
		["to", input.to],
		["created", input.created],
		["subject", input.subject],
		...(input.replyTo !== undefined
			? ([["reply_to", input.replyTo]] as const)
			: []),
		["body_sha256", bodySha256],
	];
	const headerKv = serializeKvBlock(entries, {
		allowedKeys: MESSAGE_ALLOWED_KEYS,
		requiredKeys: MESSAGE_REQUIRED_KEYS,
		maxBytes: MAX_HEADER_BYTES,
	});
	if (!headerKv.ok) return headerKv;
	const frontmatter = `---\n${headerKv.value}---\n`;
	const frontmatterBytes = new TextEncoder().encode(frontmatter);
	if (frontmatterBytes.byteLength > MAX_HEADER_BYTES) {
		return {
			ok: false,
			code: "size_exceeded",
			reason: `Message header (${frontmatterBytes.byteLength} bytes) exceeds 4 KiB.`,
		};
	}
	const totalLength = frontmatterBytes.byteLength + bodyBytes.byteLength;
	if (totalLength > MAX_MESSAGE_BYTES) {
		return {
			ok: false,
			code: "size_exceeded",
			reason: `Message size (${totalLength} bytes) exceeds 256 KiB.`,
		};
	}
	const bytes = new Uint8Array(totalLength);
	bytes.set(frontmatterBytes, 0);
	bytes.set(bodyBytes, frontmatterBytes.byteLength);
	const text = frontmatter + input.body;
	return {
		ok: true,
		value: {
			text,
			bytes,
			message: {
				id: input.id,
				from: input.from,
				to: input.to,
				created: input.created,
				subject: input.subject,
				...(input.replyTo !== undefined ? { replyTo: input.replyTo } : {}),
				bodySha256,
				body: input.body,
			},
		},
	};
}

export interface ValidateMessageOptions {
	expectedId?: string;
	expectedTo?: string;
}

/**
 * §3.1 Parses and validates a raw message file against all §3.0 and §3.1 rules.
 */
export function parseMailMessage(
	input: string | Uint8Array,
	options?: ValidateMessageOptions,
): ParseResult<MailMessage> {
	const rawBytes =
		typeof input === "string"
			? hasLoneSurrogate(input)
				? undefined
				: input.startsWith("\ufeff")
					? new Uint8Array([0xef, 0xbb, 0xbf])
					: new TextEncoder().encode(input)
			: input;
	if (!rawBytes) {
		return {
			ok: false,
			code: "invalid_utf8",
			reason: "Message contains an unpaired UTF-16 surrogate.",
		};
	}
	if (rawBytes.byteLength > MAX_MESSAGE_BYTES) {
		return {
			ok: false,
			code: "size_exceeded",
			reason: `Message size (${rawBytes.byteLength} bytes) exceeds 256 KiB.`,
		};
	}
	const decoded = decodeStrictUtf8(rawBytes);
	if (!decoded.ok) return decoded;
	const text = decoded.value;

	if (text.startsWith("---\r\n")) {
		return {
			ok: false,
			code: "cr_forbidden",
			reason: "CR is not permitted in message frontmatter.",
		};
	}
	if (!text.startsWith("---\n")) {
		return {
			ok: false,
			code: "invalid_header",
			reason: "Message must start with '---\\n'.",
		};
	}

	let pos = 4;
	let closingLineStart = -1;
	let bodyCharOffset = -1;
	while (pos <= text.length) {
		const nl = text.indexOf("\n", pos);
		if (nl === -1) {
			if (text.slice(pos).includes("\r")) {
				return {
					ok: false,
					code: "cr_forbidden",
					reason: "CR is not permitted in message frontmatter.",
				};
			}
			break;
		}
		const line = text.slice(pos, nl);
		if (line.includes("\r")) {
			return {
				ok: false,
				code: "cr_forbidden",
				reason: "CR is not permitted in message frontmatter.",
			};
		}
		if (line === "---") {
			closingLineStart = pos;
			bodyCharOffset = nl + 1;
			break;
		}
		pos = nl + 1;
	}

	if (closingLineStart === -1 || bodyCharOffset === -1) {
		return {
			ok: false,
			code: "invalid_header",
			reason: "Message frontmatter is missing a closing '---' line.",
		};
	}

	const frontmatterText = text.slice(0, bodyCharOffset);
	const frontmatterByteLen = Buffer.byteLength(frontmatterText, "utf8");
	if (frontmatterByteLen > MAX_HEADER_BYTES) {
		return {
			ok: false,
			code: "size_exceeded",
			reason: `Message header (${frontmatterByteLen} bytes) exceeds 4 KiB.`,
		};
	}

	const innerHeaderText = text.slice(4, closingLineStart);
	const parsedHeader = parseKvBlock(innerHeaderText, {
		allowedKeys: MESSAGE_ALLOWED_KEYS,
		requiredKeys: MESSAGE_REQUIRED_KEYS,
		maxBytes: MAX_HEADER_BYTES,
	});
	if (!parsedHeader.ok) return parsedHeader;
	const fields = parsedHeader.value;

	if (options?.expectedId !== undefined && fields.id !== options.expectedId) {
		return {
			ok: false,
			code: "stem_mismatch",
			reason: `Message id (${fields.id}) does not match file stem (${options.expectedId}).`,
		};
	}
	if (options?.expectedTo !== undefined && fields.to !== options.expectedTo) {
		return {
			ok: false,
			code: "to_mismatch",
			reason: `Message recipient (${fields.to}) does not match mailbox (${options.expectedTo}).`,
		};
	}

	const bodyBytes = rawBytes.subarray(frontmatterByteLen);
	const actualSha256 = computeSha256Hex(bodyBytes);
	if (actualSha256 !== fields.body_sha256) {
		return {
			ok: false,
			code: "sha256_mismatch",
			reason: `body_sha256 mismatch: expected ${fields.body_sha256}, got ${actualSha256}.`,
		};
	}

	return {
		ok: true,
		value: {
			id: fields.id!,
			from: fields.from!,
			to: fields.to!,
			created: fields.created!,
			subject: fields.subject!,
			...(fields.reply_to !== undefined ? { replyTo: fields.reply_to } : {}),
			bodySha256: fields.body_sha256!,
			body: text.slice(bodyCharOffset),
		},
	};
}

const ACK_ALLOWED_KEYS = new Set([
	"id",
	"by",
	"at",
	"state",
	"via",
	"body_sha256",
	"reason",
]);

const ACK_BASE_REQUIRED_KEYS = new Set(["id", "by", "at", "state", "via"]);

export interface ValidateAckOptions {
	expectedId?: string;
	expectedBy?: string;
	expectedBodySha256?: string;
}

/**
 * §3.3 Formats and validates an ack record.
 */
export function formatMailAck(ack: MailAck): ParseResult<string> {
	const entries: Array<readonly [string, string]> = [
		["id", ack.id],
		["by", ack.by],
		["at", ack.at],
		["state", ack.state],
		["via", ack.via],
		...(ack.bodySha256 !== undefined
			? ([["body_sha256", ack.bodySha256]] as const)
			: []),
		...(ack.reason !== undefined ? ([["reason", ack.reason]] as const) : []),
	];
	const serialized = serializeKvBlock(entries, {
		allowedKeys: ACK_ALLOWED_KEYS,
		requiredKeys: ACK_BASE_REQUIRED_KEYS,
		maxBytes: MAX_RECORD_BYTES,
	});
	if (!serialized.ok) return serialized;
	const verified = parseMailAck(serialized.value, {
		expectedId: ack.id,
		expectedBy: ack.by,
	});
	if (!verified.ok) return verified;
	return { ok: true, value: serialized.value };
}

/**
 * §3.3 Parses and validates an ack record.
 */
export function parseMailAck(
	input: string | Uint8Array,
	options?: ValidateAckOptions,
): ParseResult<MailAck> {
	const parsed = parseKvBlock(input, {
		allowedKeys: ACK_ALLOWED_KEYS,
		requiredKeys: ACK_BASE_REQUIRED_KEYS,
		maxBytes: MAX_RECORD_BYTES,
	});
	if (!parsed.ok) return parsed;
	const fields = parsed.value;
	const state = fields.state as AckState;
	const via = fields.via as AckVia;

	if (state === "received") {
		if (fields.body_sha256 === undefined) {
			return {
				ok: false,
				code: "missing_key",
				reason: "Ack with state 'received' requires body_sha256.",
			};
		}
	} else {
		if (fields.reason === undefined) {
			return {
				ok: false,
				code: "missing_key",
				reason: `Ack with state '${state}' requires reason.`,
			};
		}
	}

	if (options?.expectedId !== undefined && fields.id !== options.expectedId) {
		return {
			ok: false,
			code: "stem_mismatch",
			reason: `Ack id (${fields.id}) does not match file stem (${options.expectedId}).`,
		};
	}
	if (options?.expectedBy !== undefined && fields.by !== options.expectedBy) {
		return {
			ok: false,
			code: "by_mismatch",
			reason: `Ack by (${fields.by}) does not match mailbox (${options.expectedBy}).`,
		};
	}
	if (
		state === "received" &&
		options?.expectedBodySha256 !== undefined &&
		fields.body_sha256 !== options.expectedBodySha256
	) {
		return {
			ok: false,
			code: "sha256_mismatch",
			reason: `Ack body_sha256 (${fields.body_sha256}) does not match message (${options.expectedBodySha256}).`,
		};
	}

	return {
		ok: true,
		value: {
			id: fields.id!,
			by: fields.by!,
			at: fields.at!,
			state,
			via,
			...(fields.body_sha256 !== undefined
				? { bodySha256: fields.body_sha256 }
				: {}),
			...(fields.reason !== undefined ? { reason: fields.reason } : {}),
		},
	};
}

const ATTEMPT_KEYS = new Set([
	"id",
	"body_sha256",
	"consumer",
	"session",
	"at",
]);

export interface ValidateAttemptOptions {
	expectedId?: string;
}

/**
 * §3.4 Formats and validates an attempt ledger record.
 */
export function formatMailAttempt(attempt: MailAttempt): ParseResult<string> {
	const entries: Array<readonly [string, string]> = [
		["id", attempt.id],
		["body_sha256", attempt.bodySha256],
		["consumer", attempt.consumer],
		["session", attempt.session],
		["at", attempt.at],
	];
	const serialized = serializeKvBlock(entries, {
		allowedKeys: ATTEMPT_KEYS,
		requiredKeys: ATTEMPT_KEYS,
		maxBytes: MAX_RECORD_BYTES,
	});
	if (!serialized.ok) return serialized;
	return { ok: true, value: serialized.value };
}

/**
 * §3.4 Parses and validates an attempt ledger record.
 */
export function parseMailAttempt(
	input: string | Uint8Array,
	options?: ValidateAttemptOptions,
): ParseResult<MailAttempt> {
	const parsed = parseKvBlock(input, {
		allowedKeys: ATTEMPT_KEYS,
		requiredKeys: ATTEMPT_KEYS,
		maxBytes: MAX_RECORD_BYTES,
	});
	if (!parsed.ok) return parsed;
	const fields = parsed.value;
	if (options?.expectedId !== undefined && fields.id !== options.expectedId) {
		return {
			ok: false,
			code: "stem_mismatch",
			reason: `Attempt id (${fields.id}) does not match file stem (${options.expectedId}).`,
		};
	}
	return {
		ok: true,
		value: {
			id: fields.id!,
			bodySha256: fields.body_sha256!,
			consumer: fields.consumer!,
			session: fields.session!,
			at: fields.at!,
		},
	};
}

const LOCK_KEYS = new Set(["pid", "token", "at"]);

/**
 * §3.0 / §5.1 Formats and parses consumer lock records using the shared line grammar.
 */
export function formatMailLockRecord(
	lock: MailLockRecord,
): ParseResult<string> {
	return serializeKvBlock(
		[
			["pid", lock.pid],
			["token", lock.token],
			["at", lock.at],
		],
		{
			allowedKeys: LOCK_KEYS,
			requiredKeys: LOCK_KEYS,
			maxBytes: MAX_RECORD_BYTES,
		},
	);
}

export function parseMailLockRecord(
	input: string | Uint8Array,
): ParseResult<MailLockRecord> {
	const parsed = parseKvBlock(input, {
		allowedKeys: LOCK_KEYS,
		requiredKeys: LOCK_KEYS,
		maxBytes: MAX_RECORD_BYTES,
	});
	if (!parsed.ok) return parsed;
	return {
		ok: true,
		value: {
			pid: parsed.value.pid!,
			token: parsed.value.token!,
			at: parsed.value.at!,
		},
	};
}

function isMissingPath(error: unknown): boolean {
	const code = errorCode(error);
	if (code !== undefined) return code === "ENOENT";
	return error instanceof Error && /\bENOENT\b/.test(error.message);
}

function isInsideRepo(realPath: string, realTopLevel: string): boolean {
	if (realPath === realTopLevel) return true;
	const prefix = realTopLevel.endsWith("/")
		? realTopLevel
		: `${realTopLevel}/`;
	return realPath.startsWith(prefix);
}

async function runGit(
	exec: Exec,
	args: string[],
	signal?: AbortSignal,
): Promise<ExecResult | MailError> {
	if (signal?.aborted) {
		return abortedError();
	}
	try {
		const res = await exec("git", args, {
			timeout: GIT_TIMEOUT_MS,
			signal,
		});
		if (signal?.aborted) {
			return abortedError();
		}
		if (res.killed) {
			return {
				code: "git_failed",
				message: `git ${args.join(" ")} timed out.`,
			};
		}
		return res;
	} catch (error) {
		if (signal?.aborted) {
			return abortedError();
		}
		return {
			code: "git_failed",
			message: `git ${args.join(" ")} failed: ${errorMessage(error)}`,
			...(errorCode(error) ? { causeCode: errorCode(error) } : {}),
		};
	}
}

export interface MailboxBoundary {
	topLevel: string;
	realTopLevel: string;
	mailboxRoot: string;
	recipientDir: string;
	warnings: MailWarning[];
}

export type ReadBoundaryOutcome =
	| { ok: true; exists: boolean; boundary: MailboxBoundary }
	| { ok: false; error: MailError; warnings: MailWarning[] };

async function resolveMailboxGitAndRealTop(
	deps: MailDeps,
	recipient: string,
	pathsToIgnore: readonly string[],
	warnings: MailWarning[],
	signal?: AbortSignal,
): Promise<
	| {
			ok: true;
			topLevel: string;
			realTopLevel: string;
			dotDir: string;
			mailboxRoot: string;
			recipientDir: string;
	  }
	| { ok: false; error: MailError; warnings: MailWarning[] }
> {
	const fsOps = deps.fs ?? defaultFs;

	if (signal?.aborted) {
		return { ok: false, warnings, error: abortedError() };
	}

	if (!isValidMailboxName(recipient)) {
		return {
			ok: false,
			warnings,
			error: {
				code: "invalid_recipient",
				message: `Invalid recipient mailbox name: ${recipient}`,
			},
		};
	}

	const topRes = await runGit(
		deps.exec,
		["rev-parse", "--show-toplevel"],
		signal,
	);
	if ("message" in topRes) {
		return { ok: false, warnings, error: topRes };
	}
	const rawTop = topRes.stdout.trim();
	if (topRes.code !== 0 || !rawTop.startsWith("/")) {
		return {
			ok: false,
			warnings,
			error: {
				code: "git_failed",
				message:
					topRes.stderr.trim() ||
					"Failed to resolve git top-level directory.",
			},
		};
	}
	const topLevel =
		rawTop.length > 1 ? rawTop.replace(/\/+$/, "") : rawTop;

	const lsRes = await runGit(
		deps.exec,
		["-C", topLevel, "ls-files", "--", MAILBOX_REL_ROOT],
		signal,
	);
	if ("message" in lsRes) {
		return { ok: false, warnings, error: lsRes };
	}
	if (lsRes.code !== 0) {
		return {
			ok: false,
			warnings,
			error: {
				code: "git_failed",
				message:
					lsRes.stderr.trim() || "git ls-files failed for mailbox root.",
			},
		};
	}
	if (lsRes.stdout.trim() !== "") {
		return {
			ok: false,
			warnings,
			error: {
				code: "tracked_files",
				message: `${MAILBOX_REL_ROOT} contains tracked files in Git.`,
			},
		};
	}

	const dotDir = posix.join(topLevel, ".gjc-herdr");
	const mailboxRoot = posix.join(topLevel, MAILBOX_REL_ROOT);
	const recipientDir = posix.join(mailboxRoot, recipient);

	const ignoreTargets = [
		mailboxRoot,
		...pathsToIgnore.map((relOrAbs) =>
			relOrAbs.startsWith("/") ? relOrAbs : posix.join(recipientDir, relOrAbs),
		),
	];
	for (const targetPath of ignoreTargets) {
		const ignoreRes = await runGit(
			deps.exec,
			["-C", topLevel, "check-ignore", "-q", targetPath],
			signal,
		);
		if ("message" in ignoreRes) {
			return { ok: false, warnings, error: ignoreRes };
		}
		if (ignoreRes.code === 1 && !ignoreRes.stderr.trim()) {
			return {
				ok: false,
				warnings,
				error: {
					code: "not_ignored",
					message: `Path is not ignored by Git (.gitignore must ignore /.gjc-herdr/): ${targetPath}`,
				},
			};
		}
		if (ignoreRes.code !== 0) {
			return {
				ok: false,
				warnings,
				error: {
					code: "git_failed",
					message:
						ignoreRes.stderr.trim() ||
						`git check-ignore failed for ${targetPath} (exit ${ignoreRes.code}).`,
				},
			};
		}
	}

	if (signal?.aborted) {
		return { ok: false, warnings, error: abortedError() };
	}

	let realTopLevel: string;
	try {
		realTopLevel = await fsOps.realpath(topLevel);
	} catch (error) {
		if (signal?.aborted) {
			return { ok: false, warnings, error: abortedError() };
		}
		return {
			ok: false,
			warnings,
			error: {
				code: "path_boundary_failed",
				message: `Cannot resolve realpath of git top-level ${topLevel}: ${errorMessage(error)}`,
				...(errorCode(error) ? { causeCode: errorCode(error) } : {}),
			},
		};
	}
	if (signal?.aborted) {
		return { ok: false, warnings, error: abortedError() };
	}

	return {
		ok: true,
		topLevel,
		realTopLevel,
		dotDir,
		mailboxRoot,
		recipientDir,
	};
}

/**
 * §2 Resolves the Git top-level, verifies `.gjc-herdr/mailbox` is ignored and has
 * zero tracked files, checks every path element for symlinks and `realpath`
 * containment, and creates missing directories with mode 0700 (warning if an
 * existing directory has a mode other than 0700).
 */
export async function prepareMailboxWriteBoundary(
	deps: MailDeps,
	recipient: string,
	pathsToWrite: readonly string[],
	signal?: AbortSignal,
): Promise<
	| { ok: true; boundary: MailboxBoundary }
	| { ok: false; error: MailError; warnings: MailWarning[] }
> {
	const warnings: MailWarning[] = [];
	const fsOps = deps.fs ?? defaultFs;
	const resolved = await resolveMailboxGitAndRealTop(
		deps,
		recipient,
		pathsToWrite,
		warnings,
		signal,
	);
	if (!resolved.ok) return resolved;
	const { topLevel, realTopLevel, dotDir, mailboxRoot, recipientDir } =
		resolved;

	for (const dir of [dotDir, mailboxRoot, recipientDir]) {
		if (signal?.aborted) {
			return { ok: false, warnings, error: abortedError() };
		}
		let stat: MailStat | undefined;
		try {
			stat = await fsOps.lstat(dir);
		} catch (error) {
			if (signal?.aborted) {
				return { ok: false, warnings, error: abortedError() };
			}
			if (!isMissingPath(error)) {
				return {
					ok: false,
					warnings,
					error: {
						code: "path_boundary_failed",
						message: `Cannot inspect path element ${dir}: ${errorMessage(error)}`,
						...(errorCode(error) ? { causeCode: errorCode(error) } : {}),
					},
				};
			}
		}
		if (signal?.aborted) {
			return { ok: false, warnings, error: abortedError() };
		}

		if (stat) {
			if (stat.isSymbolicLink()) {
				return {
					ok: false,
					warnings,
					error: {
						code: "symlink_rejected",
						message: `Symlink is not permitted in mailbox path: ${dir}`,
					},
				};
			}
			if (!stat.isDirectory()) {
				return {
					ok: false,
					warnings,
					error: {
						code: "not_a_directory",
						message: `Mailbox path element is not a directory: ${dir}`,
					},
				};
			}
			if (
				typeof stat.mode === "number" &&
				(stat.mode & 0o777) !== MAIL_DIR_MODE
			) {
				warnings.push({
					code: "dir_mode_not_0700",
					path: dir,
					message: `Directory ${dir} has mode 0${(stat.mode & 0o777).toString(8)} instead of 0700.`,
				});
			}
		} else {
			try {
				await fsOps.mkdir(dir, { mode: MAIL_DIR_MODE });
				if (signal?.aborted) {
					return { ok: false, warnings, error: abortedError() };
				}
				const createdStat = await fsOps.lstat(dir);
				if (signal?.aborted) {
					return { ok: false, warnings, error: abortedError() };
				}
				if (createdStat.isSymbolicLink() || !createdStat.isDirectory()) {
					return {
						ok: false,
						warnings,
						error: {
							code: "symlink_rejected",
							message: `Created mailbox directory is not a regular directory: ${dir}`,
						},
					};
				}
			} catch (error) {
				if (signal?.aborted) {
					return { ok: false, warnings, error: abortedError() };
				}
				return {
					ok: false,
					warnings,
					error: {
						code: "path_boundary_failed",
						message: `Failed to create mailbox directory ${dir}: ${errorMessage(error)}`,
						...(errorCode(error) ? { causeCode: errorCode(error) } : {}),
					},
				};
			}
		}

		let realDir: string;
		try {
			realDir = await fsOps.realpath(dir);
		} catch (error) {
			if (signal?.aborted) {
				return { ok: false, warnings, error: abortedError() };
			}
			return {
				ok: false,
				warnings,
				error: {
					code: "path_boundary_failed",
					message: `Cannot resolve realpath of ${dir}: ${errorMessage(error)}`,
					...(errorCode(error) ? { causeCode: errorCode(error) } : {}),
				},
			};
		}
		if (signal?.aborted) {
			return { ok: false, warnings, error: abortedError() };
		}
		if (!isInsideRepo(realDir, realTopLevel)) {
			return {
				ok: false,
				warnings,
				error: {
					code: "outside_repo",
					message: `Resolved path ${realDir} escapes repository root ${realTopLevel}.`,
				},
			};
		}
	}

	return {
		ok: true,
		boundary: {
			topLevel,
			realTopLevel,
			mailboxRoot,
			recipientDir,
			warnings,
		},
	};
}

/**
 * §2 + §6 Read-only mailbox boundary inspection for `mail-watch.sh`.
 * Performs the same Git top-level, `-C`, tracked-file, ignore, symlink, and
 * `realpath` containment checks as `prepareMailboxWriteBoundary`, but never
 * creates directories. Missing `.gjc-herdr`, `.gjc-herdr/mailbox`, or
 * `<recipient>` (`ENOENT`) yields `{ ok: true, exists: false, boundary }`.
 */
export async function inspectMailboxReadBoundary(
	deps: MailDeps,
	recipient: string,
	signal?: AbortSignal,
): Promise<ReadBoundaryOutcome> {
	const warnings: MailWarning[] = [];
	const fsOps = deps.fs ?? defaultFs;
	const resolved = await resolveMailboxGitAndRealTop(
		deps,
		recipient,
		[""],
		warnings,
		signal,
	);
	if (!resolved.ok) return resolved;
	const { topLevel, realTopLevel, dotDir, mailboxRoot, recipientDir } =
		resolved;

	for (const dir of [dotDir, mailboxRoot, recipientDir]) {
		if (signal?.aborted) {
			return { ok: false, warnings, error: abortedError() };
		}
		let stat: MailStat;
		try {
			stat = await fsOps.lstat(dir);
		} catch (error) {
			if (signal?.aborted) {
				return { ok: false, warnings, error: abortedError() };
			}
			if (isMissingPath(error)) {
				return {
					ok: true,
					exists: false,
					boundary: {
						topLevel,
						realTopLevel,
						mailboxRoot,
						recipientDir,
						warnings,
					},
				};
			}
			return {
				ok: false,
				warnings,
				error: {
					code: "path_boundary_failed",
					message: `Cannot inspect path element ${dir}: ${errorMessage(error)}`,
					...(errorCode(error) ? { causeCode: errorCode(error) } : {}),
				},
			};
		}
		if (signal?.aborted) {
			return { ok: false, warnings, error: abortedError() };
		}

		if (stat.isSymbolicLink()) {
			return {
				ok: false,
				warnings,
				error: {
					code: "symlink_rejected",
					message: `Symlink is not permitted in mailbox path: ${dir}`,
				},
			};
		}
		if (!stat.isDirectory()) {
			return {
				ok: false,
				warnings,
				error: {
					code: "not_a_directory",
					message: `Mailbox path element is not a directory: ${dir}`,
				},
			};
		}
		if (
			typeof stat.mode === "number" &&
			(stat.mode & 0o777) !== MAIL_DIR_MODE
		) {
			warnings.push({
				code: "dir_mode_not_0700",
				path: dir,
				message: `Directory ${dir} has mode 0${(stat.mode & 0o777).toString(8)} instead of 0700.`,
			});
		}

		let realDir: string;
		try {
			realDir = await fsOps.realpath(dir);
		} catch (error) {
			if (signal?.aborted) {
				return { ok: false, warnings, error: abortedError() };
			}
			return {
				ok: false,
				warnings,
				error: {
					code: "path_boundary_failed",
					message: `Cannot resolve realpath of ${dir}: ${errorMessage(error)}`,
					...(errorCode(error) ? { causeCode: errorCode(error) } : {}),
				},
			};
		}
		if (signal?.aborted) {
			return { ok: false, warnings, error: abortedError() };
		}
		if (!isInsideRepo(realDir, realTopLevel)) {
			return {
				ok: false,
				warnings,
				error: {
					code: "outside_repo",
					message: `Resolved path ${realDir} escapes repository root ${realTopLevel}.`,
				},
			};
		}
	}

	return {
		ok: true,
		exists: true,
		boundary: {
			topLevel,
			realTopLevel,
			mailboxRoot,
			recipientDir,
			warnings,
		},
	};
}

/**
 * §2 Opens a mailbox file with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, verifies via
 * the open handle's `fstat` that it is a regular file within `maxBytes`, and reads
 * its raw bytes.
 */
export async function readMailboxFileBytes(
	fsOps: MailFs,
	filePath: string,
	maxBytes = MAX_MESSAGE_BYTES,
): Promise<ParseResult<Uint8Array>> {
	const openFlags = resolveReadOpenFlags(fsOps.constants);
	if (openFlags === undefined) {
		return {
			ok: false,
			code: "unsupported_platform",
			reason:
				"Required fs.constants (O_RDONLY, O_NOFOLLOW, O_NONBLOCK) are unavailable on this platform.",
		};
	}
	let handle: MailFileHandle;
	try {
		handle = await fsOps.open(filePath, openFlags);
	} catch (error) {
		const code = errorCode(error);
		return {
			ok: false,
			code:
				code === "ELOOP" || code === "EFTYPE"
					? "symlink_rejected"
					: code === "ENOENT"
						? "file_missing"
						: "open_failed",
			reason: `Cannot open mailbox file ${filePath}: ${errorMessage(error)}`,
		};
	}
	try {
		const stat = await handle.stat();
		if (
			(typeof stat.isSymbolicLink === "function" && stat.isSymbolicLink()) ||
			!stat.isFile()
		) {
			return {
				ok: false,
				code: "not_regular_file",
				reason: `Mailbox file ${filePath} is not a regular file.`,
			};
		}
		if (stat.size < 0 || stat.size > maxBytes) {
			return {
				ok: false,
				code: "size_exceeded",
				reason: `Mailbox file ${filePath} (${stat.size} bytes) exceeds the ${maxBytes}-byte limit.`,
			};
		}
		const maxRead = maxBytes + 1;
		const buffer = new Uint8Array(maxRead);
		let totalBytes = 0;
		while (totalBytes < maxRead) {
			const { bytesRead, buffer: chunkBuffer } = await handle.read(
				buffer,
				totalBytes,
				maxRead - totalBytes,
				totalBytes,
			);
			if (bytesRead <= 0) break;
			if (chunkBuffer && chunkBuffer !== buffer) {
				const copyLen = Math.min(bytesRead, maxRead - totalBytes);
				buffer.set(chunkBuffer.subarray(0, copyLen), totalBytes);
			}
			totalBytes += bytesRead;
		}
		if (totalBytes > maxBytes) {
			return {
				ok: false,
				code: "size_exceeded",
				reason: `Mailbox file ${filePath} (${totalBytes} bytes) exceeds the ${maxBytes}-byte limit.`,
			};
		}
		return { ok: true, value: buffer.subarray(0, totalBytes) };
	} catch (error) {
		return {
			ok: false,
			code: "read_failed",
			reason: `Cannot read mailbox file ${filePath}: ${errorMessage(error)}`,
		};
	} finally {
		try {
			await handle.close();
		} catch {
			// Preserve primary read result.
		}
	}
}

function defaultStemAndParent(
	filePath: string,
	ext: string,
): { stem: string; parent: string } {
	const base = posix.basename(filePath);
	const stem = base.endsWith(ext) ? base.slice(0, -ext.length) : base;
	const parent = posix.basename(posix.dirname(filePath));
	return { stem, parent };
}

/**
 * §2 + §3.1 Reads a message file safely (`O_RDONLY|O_NOFOLLOW|O_NONBLOCK` + `fstat`)
 * and validates its format, stem (`id`), recipient (`to`), and `body_sha256`.
 */
export async function readMailMessageFile(
	fsOps: MailFs,
	filePath: string,
	options?: ValidateMessageOptions,
): Promise<ParseResult<MailMessage>> {
	const raw = await readMailboxFileBytes(fsOps, filePath, MAX_MESSAGE_BYTES);
	if (!raw.ok) return raw;
	const { stem, parent } = defaultStemAndParent(filePath, ".md");
	return parseMailMessage(raw.value, {
		expectedId: options?.expectedId ?? stem,
		expectedTo: options?.expectedTo ?? parent,
	});
}

/**
 * §2 + §3.3 Reads an ack file safely (`O_RDONLY|O_NOFOLLOW|O_NONBLOCK` + `fstat`)
 * and validates its format, stem (`id`), `by`, and state-specific keys.
 */
export async function readMailAckFile(
	fsOps: MailFs,
	filePath: string,
	options?: ValidateAckOptions,
): Promise<ParseResult<MailAck>> {
	const raw = await readMailboxFileBytes(fsOps, filePath, MAX_RECORD_BYTES);
	if (!raw.ok) return raw;
	const { stem, parent } = defaultStemAndParent(filePath, ".ack");
	return parseMailAck(raw.value, {
		expectedId: options?.expectedId ?? stem,
		expectedBy: options?.expectedBy ?? parent,
		...(options?.expectedBodySha256 !== undefined
			? { expectedBodySha256: options.expectedBodySha256 }
			: {}),
	});
}

/**
 * §2 + §3.4 Reads an attempt file safely (`O_RDONLY|O_NOFOLLOW|O_NONBLOCK` + `fstat`)
 * and validates its format and stem (`id`).
 */
export async function readMailAttemptFile(
	fsOps: MailFs,
	filePath: string,
	options?: ValidateAttemptOptions,
): Promise<ParseResult<MailAttempt>> {
	const raw = await readMailboxFileBytes(fsOps, filePath, MAX_RECORD_BYTES);
	if (!raw.ok) return raw;
	const { stem } = defaultStemAndParent(filePath, ".attempt");
	return parseMailAttempt(raw.value, {
		expectedId: options?.expectedId ?? stem,
	});
}

/**
 * §2 + §5.1 Reads a consumer lock file safely (`O_RDONLY|O_NOFOLLOW|O_NONBLOCK` + `fstat`)
 * and validates its format (`pid`, `token`, `at`).
 */
export async function readMailLockFile(
	fsOps: MailFs,
	filePath: string,
): Promise<ParseResult<MailLockRecord>> {
	const raw = await readMailboxFileBytes(fsOps, filePath, MAX_RECORD_BYTES);
	if (!raw.ok) return raw;
	return parseMailLockRecord(raw.value);
}

export type PublishOutcome =
	| { ok: true; path: string; warnings: MailWarning[] }
	| { ok: false; error: MailError; warnings: MailWarning[] };

async function writeAndSyncExclusiveTmpFile(
	fsOps: MailFs,
	tmpPath: string,
	bytes: Uint8Array,
	warnings: MailWarning[],
	signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; error: MailError; warnings: MailWarning[] }> {
	const openFlags = resolveCreateTmpFlags(fsOps.constants);
	if (openFlags === undefined) {
		return {
			ok: false,
			warnings,
			error: {
				code: "unsupported_platform",
				message:
					"Required fs.constants (O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_NONBLOCK) are unavailable on this platform.",
			},
		};
	}
	if (signal?.aborted) {
		return {
			ok: false,
			warnings,
			error: abortedError(),
		};
	}

	let handle: MailFileHandle;
	try {
		handle = await fsOps.open(tmpPath, openFlags, MAIL_FILE_MODE);
	} catch (error) {
		if (signal?.aborted) {
			return {
				ok: false,
				warnings,
				error: abortedError(),
			};
		}
		const causeCode = errorCode(error);
		return {
			ok: false,
			warnings,
			error: {
				code: "publish_failed",
				message: `Failed to create exclusive temporary file ${tmpPath}${causeCode ? ` (${causeCode})` : ""}: ${errorMessage(error)}`,
				...(causeCode ? { causeCode } : {}),
			},
		};
	}

	let closed = false;
	const cleanupTmp = async (): Promise<void> => {
		if (!closed) {
			closed = true;
			try {
				await handle.close();
			} catch {
				// Ignore close error during pre-publication cleanup.
			}
		}
		try {
			await fsOps.unlink(tmpPath);
		} catch {
			// Best-effort cleanup of own temporary file before publication.
		}
	};

	if (signal?.aborted) {
		await cleanupTmp();
		return {
			ok: false,
			warnings,
			error: abortedError(),
		};
	}

	try {
		const stat = await handle.stat();
		if (signal?.aborted) {
			await cleanupTmp();
			return {
				ok: false,
				warnings,
				error: abortedError(),
			};
		}
		if (
			(typeof stat.isSymbolicLink === "function" && stat.isSymbolicLink()) ||
			!stat.isFile()
		) {
			await cleanupTmp();
			return {
				ok: false,
				warnings,
				error: {
					code: "publish_failed",
					message: `Temporary mailbox file ${tmpPath} is not a regular file.`,
				},
			};
		}

		let offset = 0;
		while (offset < bytes.byteLength) {
			if (signal?.aborted) {
				await cleanupTmp();
				return {
					ok: false,
					warnings,
					error: abortedError(),
				};
			}
			const res = await handle.write(
				bytes,
				offset,
				bytes.byteLength - offset,
				offset,
			);
			if (signal?.aborted) {
				await cleanupTmp();
				return {
					ok: false,
					warnings,
					error: abortedError(),
				};
			}
			const written =
				typeof res === "number" ? res : (res?.bytesWritten ?? 0);
			if (written <= 0) {
				throw new Error("Short write to temporary mailbox file.");
			}
			offset += written;
		}
		if (signal?.aborted) {
			await cleanupTmp();
			return {
				ok: false,
				warnings,
				error: abortedError(),
			};
		}
		await handle.sync();
		if (signal?.aborted) {
			await cleanupTmp();
			return {
				ok: false,
				warnings,
				error: abortedError(),
			};
		}
		await handle.close();
		closed = true;
		if (signal?.aborted) {
			await cleanupTmp();
			return {
				ok: false,
				warnings,
				error: abortedError(),
			};
		}
	} catch (error) {
		await cleanupTmp();
		if (signal?.aborted) {
			return {
				ok: false,
				warnings,
				error: abortedError(),
			};
		}
		const causeCode = errorCode(error);
		return {
			ok: false,
			warnings,
			error: {
				code: "publish_failed",
				message: `Failed to write or sync temporary file ${tmpPath}${causeCode ? ` (${causeCode})` : ""}: ${errorMessage(error)}`,
				...(causeCode ? { causeCode } : {}),
			},
		};
	}

	return { ok: true };
}

/**
 * §3.2 Exclusive publication via temp file (`O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_NONBLOCK`, 0600) +
 * `fstat` + `write` + `fsync` + `close` + `link(tmp, final)` + `unlink(tmp)`. Never uses `rename` or a fallback.
 */
export async function publishExclusiveFile(
	fsOps: MailFs,
	tmpPath: string,
	finalPath: string,
	bytes: Uint8Array,
	initialWarnings: readonly MailWarning[] = [],
	signal?: AbortSignal,
): Promise<PublishOutcome> {
	const warnings = [...initialWarnings];
	const tmpRes = await writeAndSyncExclusiveTmpFile(
		fsOps,
		tmpPath,
		bytes,
		warnings,
		signal,
	);
	if (!tmpRes.ok) return tmpRes;

	try {
		await fsOps.link(tmpPath, finalPath);
	} catch (error) {
		try {
			await fsOps.unlink(tmpPath);
		} catch {
			// Best-effort cleanup on link failure; never touch finalPath.
		}
		const causeCode = errorCode(error);
		if (causeCode === "EEXIST") {
			return {
				ok: false,
				warnings,
				error: {
					code: "id_conflict",
					message: `Target file already exists: ${finalPath}`,
					causeCode,
				},
			};
		}
		return {
			ok: false,
			warnings,
			error: {
				code: "publish_failed",
				message: `Hard-link publication failed for ${finalPath}${causeCode ? ` (${causeCode})` : ""}: ${errorMessage(error)}`,
				...(causeCode ? { causeCode } : {}),
			},
		};
	}

	try {
		await fsOps.unlink(tmpPath);
	} catch (error) {
		warnings.push({
			code: "tmp_cleanup_failed",
			path: tmpPath,
			message: `Published ${finalPath}, but failed to remove temporary file ${tmpPath}: ${errorMessage(error)}`,
		});
	}

	return {
		ok: true,
		path: finalPath,
		warnings,
	};
}

/**
 * §3.3 / §6 Replaces an `uncertain` ack with a terminal (`received` or `rejected`) ack.
 * Writes and fsyncs an exclusive temporary file in the same directory, re-opens and
 * re-validates `finalPath` right before replacement to confirm it is still a valid
 * `uncertain` ack, and then atomically replaces it with `rename(tmpPath, finalPath)`.
 */
export async function replaceUncertainAckFile(
	fsOps: MailFs,
	tmpPath: string,
	finalPath: string,
	bytes: Uint8Array,
	verifyOptions?: ValidateAckOptions,
	initialWarnings: readonly MailWarning[] = [],
	signal?: AbortSignal,
): Promise<PublishOutcome> {
	const warnings = [...initialWarnings];
	if (typeof fsOps.rename !== "function") {
		return {
			ok: false,
			warnings,
			error: {
				code: "unsupported_platform",
				message: "fs.rename is unavailable on this MailFs implementation.",
			},
		};
	}

	const tmpRes = await writeAndSyncExclusiveTmpFile(
		fsOps,
		tmpPath,
		bytes,
		warnings,
		signal,
	);
	if (!tmpRes.ok) return tmpRes;

	const cleanupTmp = async (): Promise<void> => {
		try {
			await fsOps.unlink(tmpPath);
		} catch {
			// Best-effort cleanup of own temporary file before rename.
		}
	};

	const currentAck = await readMailAckFile(fsOps, finalPath, verifyOptions);
	if (!currentAck.ok) {
		await cleanupTmp();
		return {
			ok: false,
			warnings,
			error: {
				code: currentAck.code,
				message: `Pre-rename recheck of ${finalPath} failed: ${currentAck.reason}`,
			},
		};
	}
	if (currentAck.value.state !== "uncertain") {
		await cleanupTmp();
		return {
			ok: false,
			warnings,
			error: {
				code: "ack_not_uncertain",
				message: `Cannot overwrite ack ${finalPath} with state '${currentAck.value.state}' (expected 'uncertain').`,
			},
		};
	}
	if (signal?.aborted) {
		await cleanupTmp();
		return {
			ok: false,
			warnings,
			error: abortedError(),
		};
	}

	try {
		await fsOps.rename(tmpPath, finalPath);
	} catch (error) {
		await cleanupTmp();
		const causeCode = errorCode(error);
		return {
			ok: false,
			warnings,
			error: {
				code: "publish_failed",
				message: `Failed to replace uncertain ack ${finalPath}${causeCode ? ` (${causeCode})` : ""}: ${errorMessage(error)}`,
				...(causeCode ? { causeCode } : {}),
			},
		};
	}

	return {
		ok: true,
		path: finalPath,
		warnings,
	};
}

/**
 * §4 `herdr_mail_send` implementation.
 */
export async function sendMail(
	deps: MailDeps,
	request: MailSendRequest,
	signal?: AbortSignal,
): Promise<MailSendResult> {
	if (signal?.aborted) {
		return {
			ok: false,
			error: abortedError(),
		};
	}
	const env = deps.env ?? process.env;
	const from = env[MAILBOX_ENV_KEY];
	if (!from) {
		return {
			ok: false,
			error: {
				code: "missing_sender_mailbox",
				message: `${MAILBOX_ENV_KEY} is required to send mail.`,
			},
		};
	}
	if (!isValidMailboxName(from)) {
		return {
			ok: false,
			error: {
				code: "invalid_sender_mailbox",
				message: `${MAILBOX_ENV_KEY} (${from}) does not match ^[a-z][a-z0-9-]{0,31}$.`,
			},
		};
	}
	if (!isValidMailboxName(request.to)) {
		return {
			ok: false,
			error: {
				code: "invalid_recipient",
				message: `Recipient 'to' (${request.to}) does not match ^[a-z][a-z0-9-]{0,31}$.`,
			},
		};
	}
	const replyTo = request.reply_to;
	if (replyTo !== undefined && !isValidUlid(replyTo)) {
		return {
			ok: false,
			error: {
				code: "invalid_reply_to",
				message: `reply_to (${replyTo}) is not a valid 26-character ULID.`,
			},
		};
	}

	const nowMs = deps.now ? deps.now() : Date.now();
	let id: string;
	try {
		id = createUlid(nowMs, deps.randomBytes);
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "invalid_timestamp",
				message: errorMessage(error),
			},
		};
	}
	const created = new Date(nowMs).toISOString();
	const formatted = formatMailMessage({
		id,
		from,
		to: request.to,
		created,
		subject: request.subject,
		body: request.body,
		...(replyTo !== undefined ? { replyTo } : {}),
	});
	if (!formatted.ok) {
		return {
			ok: false,
			error: {
				code: formatted.code,
				message: formatted.reason,
			},
		};
	}

	const tmpName = `.${id}.${randomHex8(deps.randomBytes)}.tmp`;
	const finalName = `${id}.md`;
	const boundaryRes = await prepareMailboxWriteBoundary(
		deps,
		request.to,
		[tmpName, finalName],
		signal,
	);
	if (!boundaryRes.ok) {
		return {
			ok: false,
			...(boundaryRes.warnings.length > 0
				? { warnings: boundaryRes.warnings }
				: {}),
			error: boundaryRes.error,
		};
	}

	const { recipientDir, warnings: boundaryWarnings } = boundaryRes.boundary;
	const tmpPath = posix.join(recipientDir, tmpName);
	const finalPath = posix.join(recipientDir, finalName);
	const fsOps = deps.fs ?? defaultFs;
	const published = await publishExclusiveFile(
		fsOps,
		tmpPath,
		finalPath,
		formatted.value.bytes,
		boundaryWarnings,
		signal,
	);
	if (!published.ok) {
		return {
			ok: false,
			...(published.warnings.length > 0
				? { warnings: published.warnings }
				: {}),
			error: published.error,
		};
	}

	return {
		ok: true,
		id,
		path: published.path,
		...(published.warnings.length > 0 ? { warnings: published.warnings } : {}),
	};
}

export function describeMailSendResult(result: MailSendResult): string {
	if (!result.ok) {
		const code = result.error?.code ?? "send_failed";
		const cause = result.error?.causeCode ? ` (${result.error.causeCode})` : "";
		const msg = result.error?.message ?? "Mail send failed.";
		return `herdr_mail_send failed [${code}${cause}]: ${msg}`;
	}
	const base = `herdr_mail_send ok (id ${result.id}, path ${result.path})`;
	if (!result.warnings || result.warnings.length === 0) return base;
	const warnLines = result.warnings.map(
		(w) => `warning [${w.code}] (${w.path}): ${w.message}`,
	);
	return [base, ...warnLines].join("\n");
}

export function registerMailFeatures(
	api: ExtensionAPI,
	overrides?: Partial<MailDeps>,
): void {
	const deps: MailDeps = {
		exec: api.exec.bind(api),
		...overrides,
	};
	const { z } = api.zod;
	api.registerTool({
		name: "herdr_mail_send",
		label: "Herdr Mail Send",
		description:
			"Send a durable file mailbox message to `<git-toplevel>/.gjc-herdr/mailbox/<to>/<id>.md` using exclusive hard-link publication. " +
			"Requires `GJC_HERDR_MAILBOX` in the sender environment for `from`, and requires `/.gjc-herdr/` to be ignored by Git. " +
			"Only available in an interactive main GJC session.",
		parameters: z.object({
			to: z
				.string()
				.describe("Recipient mailbox name (^[a-z][a-z0-9-]{0,31}$)"),
			subject: z
				.string()
				.describe("Single-line message subject (1–200 UTF-8 bytes)"),
			body: z.string().describe("UTF-8 Markdown message body"),
			reply_to: z
				.string()
				.optional()
				.describe("Optional ULID of the message being replied to"),
		}),
		async execute(_toolCallId: string, params, signal, _onUpdate, ctx) {
			if (!isInteractiveMainSession(ctx)) {
				const result: MailSendResult = {
					ok: false,
					error: {
						code: "non_interactive_session",
						message:
							"herdr_mail_send requires an interactive main GJC session because inherited GJC_HERDR_MAILBOX in non-interactive or subagent sessions may misidentify `from`. Have the parent interactive main GJC session send the mail.",
					},
				};
				return {
					content: [{ type: "text", text: describeMailSendResult(result) }],
					details: result,
					isError: true,
				};
			}
			const result = await sendMail(
				deps,
				{
					to: params.to,
					subject: params.subject,
					body: params.body,
					...(params.reply_to !== undefined
						? { reply_to: params.reply_to }
						: {}),
				},
				signal,
			);
			return {
				content: [{ type: "text", text: describeMailSendResult(result) }],
				details: result,
				isError: !result.ok,
			};
		},
	});
}
