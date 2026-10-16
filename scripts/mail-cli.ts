import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs/promises";
import { posix } from "node:path";
import type { ExecResult } from "@gajae-code/coding-agent";
import {
	defaultMailFs,
	formatMailAck,
	inspectMailboxReadBoundary,
	isValidMailboxName,
	isValidUlid,
	MAILBOX_ENV_KEY,
	MAX_MESSAGE_BYTES,
	parseMailMessage,
	prepareMailboxWriteBoundary,
	publishExclusiveFile,
	randomHex8,
	readMailAckFile,
	readMailboxFileBytes,
	readMailMessageFile,
	replaceUncertainAckFile,
	sendMail,
	validateFieldValue,
	type MailDeps,
	type MailFileHandle,
	type MailFs,
	type MailWarning,
} from "../src/mail.ts";

export const DEFAULT_WATCH_TIMEOUT_SEC = 1_800;
export const WATCH_POLL_INTERVAL_MS = 1_000;
export const MAILBOX_FILE_WARN_THRESHOLD = 1_000;

export type MailStdinSource =
	| AsyncIterable<Uint8Array | string>
	| Iterable<Uint8Array | string>
	| Uint8Array
	| string;

export interface MailCliDeps {
	exec?: MailDeps["exec"];
	fs?: MailFs;
	env?: Record<string, string | undefined>;
	now?: () => number;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	randomBytes?: (target: Uint8Array) => Uint8Array;
	writeStderr?: (text: string) => void;
	stdin?: MailStdinSource;
	signal?: AbortSignal;
}

export interface MailCliResult {
	exitCode: 0 | 1 | 2;
	stdout: string;
	stderr: string;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | undefined)?.code;
	return typeof code === "string" && code ? code : undefined;
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

export const defaultCliExec: MailDeps["exec"] = (command, args, options) =>
	new Promise<ExecResult>((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let killed = false;
		let settled = false;

		let timer: ReturnType<typeof setTimeout> | undefined;
		if (options?.timeout && options.timeout > 0) {
			timer = setTimeout(() => {
				killed = true;
				child.kill("SIGKILL");
			}, options.timeout);
			timer.unref?.();
		}

		const onAbort = () => {
			killed = true;
			child.kill("SIGKILL");
		};
		if (options?.signal) {
			if (options.signal.aborted) {
				onAbort();
			} else {
				options.signal.addEventListener("abort", onAbort, { once: true });
			}
		}

		child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
		child.on("error", (err) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			options?.signal?.removeEventListener("abort", onAbort);
			reject(err);
		});
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			options?.signal?.removeEventListener("abort", onAbort);
			resolve({
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
				code: code ?? 1,
				killed,
			});
		});
	});

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
	new Promise((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});

const defaultWriteStderr = (text: string): void => {
	process.stderr.write(text);
};

function formatWarningLine(prefix: string, warning: MailWarning): string {
	return `${prefix} warning [${warning.code}] (${warning.path}): ${warning.message}`;
}

async function verifyRealpathInsideRepo(
	fsOps: MailFs,
	filePath: string,
	realTopLevel: string,
): Promise<{ ok: true } | { ok: false; code: string; reason: string }> {
	let realFile: string;
	try {
		realFile = await fsOps.realpath(filePath);
	} catch (error) {
		return {
			ok: false,
			code: "path_boundary_failed",
			reason: `Cannot resolve realpath of ${filePath}: ${errorMessage(error)}`,
		};
	}
	if (!isInsideRepo(realFile, realTopLevel)) {
		return {
			ok: false,
			code: "outside_repo",
			reason: `Resolved path ${realFile} escapes repository root ${realTopLevel}.`,
		};
	}
	return { ok: true };
}

async function verifyRejectedTargetMessageFile(
	fsOps: MailFs,
	msgPath: string,
	realTopLevel: string,
): Promise<{ ok: true } | { ok: false; code: string; reason: string }> {
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
		handle = await fsOps.open(msgPath, openFlags);
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
			reason: `Cannot open message file ${msgPath}: ${errorMessage(error)}`,
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
				reason: `Message file ${msgPath} is not a regular file.`,
			};
		}
	} catch (error) {
		return {
			ok: false,
			code: "read_failed",
			reason: `Cannot inspect message file ${msgPath}: ${errorMessage(error)}`,
		};
	} finally {
		try {
			await handle.close();
		} catch {
			// Ignore close error.
		}
	}
	return verifyRealpathInsideRepo(fsOps, msgPath, realTopLevel);
}

function parseWatchArgs(
	args: readonly string[],
):
	| { ok: true; recipient: string; timeoutSec: number }
	| { ok: false; message: string } {
	if (args.length === 0) {
		return {
			ok: false,
			message: "Usage: mail-watch.sh <recipient> [--timeout <sec>]",
		};
	}
	const recipient = args[0]!;
	if (!isValidMailboxName(recipient)) {
		return {
			ok: false,
			message: `Invalid recipient mailbox name: ${recipient}`,
		};
	}
	let timeoutSec = DEFAULT_WATCH_TIMEOUT_SEC;
	let i = 1;
	while (i < args.length) {
		const arg = args[i]!;
		let rawVal: string | undefined;
		if (arg === "--timeout") {
			rawVal = args[i + 1];
			if (rawVal === undefined) {
				return {
					ok: false,
					message: "Missing value for --timeout.",
				};
			}
			i += 2;
		} else if (arg.startsWith("--timeout=")) {
			rawVal = arg.slice("--timeout=".length);
			i += 1;
		} else {
			return {
				ok: false,
				message: `Unknown argument for watch: ${arg}`,
			};
		}
		if (!/^(0|[1-9][0-9]*)$/.test(rawVal)) {
			return {
				ok: false,
				message: `Invalid --timeout value (must be a non-negative integer): ${rawVal}`,
			};
		}
		const parsed = Number(rawVal);
		if (!Number.isSafeInteger(parsed) || parsed < 0) {
			return {
				ok: false,
				message: `Invalid --timeout value: ${rawVal}`,
			};
		}
		timeoutSec = parsed;
	}
	return { ok: true, recipient, timeoutSec };
}

/**
 * §6 `watch <recipient> [--timeout <sec>]`
 */
export async function watchMailbox(
	args: readonly string[],
	deps?: MailCliDeps,
): Promise<MailCliResult> {
	const parsedArgs = parseWatchArgs(args);
	if (!parsedArgs.ok) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: `mail-watch error [invalid_args]: ${parsedArgs.message}\n`,
		};
	}

	const { recipient, timeoutSec } = parsedArgs;
	const fsOps = deps?.fs ?? defaultMailFs;
	const exec = deps?.exec ?? defaultCliExec;
	const nowFn = deps?.now ?? (() => Date.now());
	const sleepFn = deps?.sleep ?? defaultSleep;
	const writeStderr = deps?.writeStderr ?? defaultWriteStderr;
	const signal = deps?.signal;

	const mailDeps: MailDeps = {
		exec,
		fs: fsOps,
		now: nowFn,
		...(deps?.randomBytes ? { randomBytes: deps.randomBytes } : {}),
	};

	const stderrLines: string[] = [];
	const emittedWarnings = new Set<string>();
	let warnedOver1000 = false;
	let startupBannerShown = false;

	const emitStderrOnce = (line: string) => {
		if (!emittedWarnings.has(line)) {
			emittedWarnings.add(line);
			stderrLines.push(line);
		}
	};

	const startMs = nowFn();
	const deadlineMs = startMs + timeoutSec * 1_000;
	let currentMs = startMs;

	while (true) {
		if (signal?.aborted) {
			stderrLines.push("mail-watch error [aborted]: Watch operation was aborted.");
			return {
				exitCode: 1,
				stdout: "",
				stderr: `${stderrLines.join("\n")}\n`,
			};
		}

		const boundaryRes = await inspectMailboxReadBoundary(
			mailDeps,
			recipient,
			signal,
		);
		if (!boundaryRes.ok) {
			for (const w of boundaryRes.warnings) {
				emitStderrOnce(formatWarningLine("mail-watch", w));
			}
			stderrLines.push(
				`mail-watch error [${boundaryRes.error.code}]: ${boundaryRes.error.message}`,
			);
			return {
				exitCode: 1,
				stdout: "",
				stderr: `${stderrLines.join("\n")}\n`,
			};
		}
		if (!startupBannerShown) {
			startupBannerShown = true;
			writeStderr(
				`mail-watch: root=${boundaryRes.boundary.mailboxRoot} recipient=${recipient} timeout=${timeoutSec}\n`,
			);
		}
		for (const w of boundaryRes.boundary.warnings) {
			emitStderrOnce(formatWarningLine("mail-watch", w));
		}

		if (boundaryRes.exists) {
			const { recipientDir, realTopLevel } = boundaryRes.boundary;
			if (typeof fsOps.readdir !== "function") {
				stderrLines.push(
					"mail-watch error [unsupported_platform]: fs.readdir is unavailable on this MailFs implementation.",
				);
				return {
					exitCode: 1,
					stdout: "",
					stderr: `${stderrLines.join("\n")}\n`,
				};
			}

			let entries: string[] | undefined;
			try {
				entries = await fsOps.readdir(recipientDir);
			} catch (error) {
				if (!isMissingPath(error)) {
					stderrLines.push(
						`mail-watch error [readdir_failed] (${recipientDir}): Cannot read mailbox directory: ${errorMessage(error)}`,
					);
					return {
						exitCode: 1,
						stdout: "",
						stderr: `${stderrLines.join("\n")}\n`,
					};
				}
			}

			if (entries !== undefined) {
				if (entries.length > MAILBOX_FILE_WARN_THRESHOLD && !warnedOver1000) {
					warnedOver1000 = true;
					emitStderrOnce(
						`mail-watch warning [mailbox_file_limit] (${recipientDir}): Mailbox contains ${entries.length} entries (> ${MAILBOX_FILE_WARN_THRESHOLD}); please clean up old mail files.`,
					);
				}

				const ulidIds: string[] = [];
				for (const name of entries) {
					if (name.startsWith(".") || !name.endsWith(".md")) continue;
					const stem = name.slice(0, -3);
					if (isValidUlid(stem)) {
						ulidIds.push(stem);
					}
				}
				ulidIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

				const pendingPaths: string[] = [];

				for (const id of ulidIds) {
					const ackPath = posix.join(recipientDir, `${id}.ack`);
					const msgPath = posix.join(recipientDir, `${id}.md`);

					// 1 & 2: Inspect ack first (format only, no body_sha256 comparison against message).
					const ackRes = await readMailAckFile(fsOps, ackPath, {
						expectedId: id,
						expectedBy: recipient,
					});
					if (ackRes.ok) {
						const ackRealCheck = await verifyRealpathInsideRepo(
							fsOps,
							ackPath,
							realTopLevel,
						);
						if (!ackRealCheck.ok) {
							stderrLines.push(
								`mail-watch error [${ackRealCheck.code}] (${ackPath}): ${ackRealCheck.reason}`,
							);
							return {
								exitCode: 1,
								stdout: "",
								stderr: `${stderrLines.join("\n")}\n`,
							};
						}
						if (
							ackRes.value.state === "received" ||
							ackRes.value.state === "rejected"
						) {
							// 1. Terminal ack with valid format -> done (regardless of message format).
							continue;
						}
						// Valid 'uncertain' ack -> still needs message check (3) and is pending (4).
					} else if (ackRes.code !== "file_missing") {
						// 2. Ack is a symlink, non-regular, unreadable, or malformed -> exit 1.
						stderrLines.push(
							`mail-watch error [${ackRes.code}] (${ackPath}): ${ackRes.reason}`,
						);
						return {
							exitCode: 1,
							stdout: "",
							stderr: `${stderrLines.join("\n")}\n`,
						};
					}

					// 3 & 4: Inspect message file.
					const rawMsg = await readMailboxFileBytes(
						fsOps,
						msgPath,
						MAX_MESSAGE_BYTES,
					);
					if (!rawMsg.ok && rawMsg.code !== "size_exceeded") {
						// 3. Message is a symlink, non-regular file, missing, or unreadable -> exit 1.
						stderrLines.push(
							`mail-watch error [${rawMsg.code}] (${msgPath}): ${rawMsg.reason}`,
						);
						return {
							exitCode: 1,
							stdout: "",
							stderr: `${stderrLines.join("\n")}\n`,
						};
					}

					const msgRealCheck = await verifyRealpathInsideRepo(
						fsOps,
						msgPath,
						realTopLevel,
					);
					if (!msgRealCheck.ok) {
						stderrLines.push(
							`mail-watch error [${msgRealCheck.code}] (${msgPath}): ${msgRealCheck.reason}`,
						);
						return {
							exitCode: 1,
							stdout: "",
							stderr: `${stderrLines.join("\n")}\n`,
						};
					}

					if (!rawMsg.ok) {
						// Regular file exceeding 256 KiB -> pending + reason on stderr.
						emitStderrOnce(
							`mail-watch warning [${rawMsg.code}] (${msgPath}): ${rawMsg.reason}`,
						);
						pendingPaths.push(msgPath);
						continue;
					}

					const parsedMsg = parseMailMessage(rawMsg.value, {
						expectedId: id,
						expectedTo: recipient,
					});
					if (!parsedMsg.ok) {
						// 4. Regular file violating §3.1 format -> pending + reason on stderr.
						emitStderrOnce(
							`mail-watch warning [${parsedMsg.code}] (${msgPath}): ${parsedMsg.reason}`,
						);
					}
					pendingPaths.push(msgPath);
				}

				if (pendingPaths.length > 0) {
					return {
						exitCode: 0,
						stdout: `${pendingPaths.join("\n")}\n`,
						stderr:
							stderrLines.length > 0 ? `${stderrLines.join("\n")}\n` : "",
					};
				}
			}
		}

		currentMs = Math.max(currentMs, nowFn());
		const remainingMs = deadlineMs - currentMs;
		if (remainingMs <= 0) {
			return {
				exitCode: 2,
				stdout: "",
				stderr: stderrLines.length > 0 ? `${stderrLines.join("\n")}\n` : "",
			};
		}

		const stepMs = Math.min(WATCH_POLL_INTERVAL_MS, remainingMs);
		const beforeMs = currentMs;
		await sleepFn(stepMs, signal);
		const afterMs = nowFn();
		currentMs = afterMs > beforeMs ? afterMs : beforeMs + stepMs;
	}
}

function parseAckArgs(
	args: readonly string[],
):
	| {
			ok: true;
			recipient: string;
			id: string;
			state: "received" | "rejected";
			reason?: string;
	  }
	| { ok: false; code: string; message: string } {
	if (args.length < 3 || args.length > 4) {
		return {
			ok: false,
			code: "invalid_args",
			message:
				"Usage: mail-ack.sh <recipient> <id> received|rejected [reason]",
		};
	}
	const [recipient, id, rawState, rawReason] = args as [
		string,
		string,
		string,
		string | undefined,
	];
	if (!isValidMailboxName(recipient)) {
		return {
			ok: false,
			code: "invalid_recipient",
			message: `Invalid recipient mailbox name: ${recipient}`,
		};
	}
	if (!isValidUlid(id)) {
		return {
			ok: false,
			code: "invalid_ulid",
			message: `Invalid message ULID: ${id}`,
		};
	}
	if (rawState !== "received" && rawState !== "rejected") {
		return {
			ok: false,
			code: "invalid_state",
			message: `Invalid terminal ack state '${rawState}' (expected 'received' or 'rejected').`,
		};
	}
	if (rawState === "received") {
		if (rawReason !== undefined) {
			return {
				ok: false,
				code: "reason_forbidden",
				message: "Ack with state 'received' must not include a reason.",
			};
		}
		return { ok: true, recipient, id, state: "received" };
	}
	if (rawReason === undefined) {
		return {
			ok: false,
			code: "missing_reason",
			message: "Ack with state 'rejected' requires a reason (1–200 UTF-8 bytes).",
		};
	}
	const validReason = validateFieldValue("reason", rawReason);
	if (!validReason.ok) {
		return {
			ok: false,
			code: validReason.code,
			message: validReason.reason,
		};
	}
	return {
		ok: true,
		recipient,
		id,
		state: "rejected",
		reason: validReason.value,
	};
}

/**
 * §6 `ack <recipient> <id> received|rejected [reason]`
 */
export async function ackMailbox(
	args: readonly string[],
	deps?: MailCliDeps,
): Promise<MailCliResult> {
	const parsedArgs = parseAckArgs(args);
	if (!parsedArgs.ok) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: `mail-ack error [${parsedArgs.code}]: ${parsedArgs.message}\n`,
		};
	}

	const { recipient, id, state, reason } = parsedArgs;
	const fsOps = deps?.fs ?? defaultMailFs;
	const exec = deps?.exec ?? defaultCliExec;
	const nowFn = deps?.now ?? (() => Date.now());
	const signal = deps?.signal;

	const mailDeps: MailDeps = {
		exec,
		fs: fsOps,
		now: nowFn,
		...(deps?.randomBytes ? { randomBytes: deps.randomBytes } : {}),
	};

	const stderrLines: string[] = [];
	const tmpName = `.${id}.${randomHex8(deps?.randomBytes)}.tmp`;
	const ackName = `${id}.ack`;

	const boundaryRes = await prepareMailboxWriteBoundary(
		mailDeps,
		recipient,
		[tmpName, ackName],
		signal,
	);
	for (const w of boundaryRes.ok
		? boundaryRes.boundary.warnings
		: boundaryRes.warnings) {
		stderrLines.push(formatWarningLine("mail-ack", w));
	}
	if (!boundaryRes.ok) {
		stderrLines.push(
			`mail-ack error [${boundaryRes.error.code}]: ${boundaryRes.error.message}`,
		);
		return {
			exitCode: 1,
			stdout: "",
			stderr: `${stderrLines.join("\n")}\n`,
		};
	}

	const { recipientDir, realTopLevel } = boundaryRes.boundary;
	const msgPath = posix.join(recipientDir, `${id}.md`);
	const ackPath = posix.join(recipientDir, ackName);
	const tmpPath = posix.join(recipientDir, tmpName);

	// Validate original message file before checking or writing ack.
	let verifiedBodySha256: string | undefined;
	if (state === "received") {
		const msgRes = await readMailMessageFile(fsOps, msgPath, {
			expectedId: id,
			expectedTo: recipient,
		});
		if (!msgRes.ok) {
			stderrLines.push(
				`mail-ack error [${msgRes.code}] (${msgPath}): ${msgRes.reason}`,
			);
			return {
				exitCode: 1,
				stdout: "",
				stderr: `${stderrLines.join("\n")}\n`,
			};
		}
		const msgRealCheck = await verifyRealpathInsideRepo(
			fsOps,
			msgPath,
			realTopLevel,
		);
		if (!msgRealCheck.ok) {
			stderrLines.push(
				`mail-ack error [${msgRealCheck.code}] (${msgPath}): ${msgRealCheck.reason}`,
			);
			return {
				exitCode: 1,
				stdout: "",
				stderr: `${stderrLines.join("\n")}\n`,
			};
		}
		verifiedBodySha256 = msgRes.value.bodySha256;
	} else {
		const targetCheck = await verifyRejectedTargetMessageFile(
			fsOps,
			msgPath,
			realTopLevel,
		);
		if (!targetCheck.ok) {
			stderrLines.push(
				`mail-ack error [${targetCheck.code}] (${msgPath}): ${targetCheck.reason}`,
			);
			return {
				exitCode: 1,
				stdout: "",
				stderr: `${stderrLines.join("\n")}\n`,
			};
		}
	}

	// Inspect existing ack file.
	const existingAck = await readMailAckFile(fsOps, ackPath, {
		expectedId: id,
		expectedBy: recipient,
	});
	if (!existingAck.ok && existingAck.code !== "file_missing") {
		stderrLines.push(
			`mail-ack error [${existingAck.code}] (${ackPath}): ${existingAck.reason}`,
		);
		return {
			exitCode: 1,
			stdout: "",
			stderr: `${stderrLines.join("\n")}\n`,
		};
	}

	if (existingAck.ok) {
		const ackRealCheck = await verifyRealpathInsideRepo(
			fsOps,
			ackPath,
			realTopLevel,
		);
		if (!ackRealCheck.ok) {
			stderrLines.push(
				`mail-ack error [${ackRealCheck.code}] (${ackPath}): ${ackRealCheck.reason}`,
			);
			return {
				exitCode: 1,
				stdout: "",
				stderr: `${stderrLines.join("\n")}\n`,
			};
		}

		if (existingAck.value.state === state) {
			if (
				state === "received" &&
				existingAck.value.bodySha256 !== verifiedBodySha256
			) {
				stderrLines.push(
					`mail-ack error [sha256_mismatch] (${ackPath}): Existing received ack body_sha256 (${existingAck.value.bodySha256}) does not match message (${verifiedBodySha256}).`,
				);
				return {
					exitCode: 1,
					stdout: "",
					stderr: `${stderrLines.join("\n")}\n`,
				};
			}
			return {
				exitCode: 0,
				stdout: `${ackPath}\n`,
				stderr: stderrLines.length > 0 ? `${stderrLines.join("\n")}\n` : "",
			};
		}

		if (existingAck.value.state !== "uncertain") {
			stderrLines.push(
				`mail-ack error [ack_state_conflict] (${ackPath}): Existing ack already has terminal state '${existingAck.value.state}' (cannot change to '${state}').`,
			);
			return {
				exitCode: 1,
				stdout: "",
				stderr: `${stderrLines.join("\n")}\n`,
			};
		}
	}

	const nowIso = new Date(nowFn()).toISOString();
	const formattedAck = formatMailAck({
		id,
		by: recipient,
		at: nowIso,
		state,
		via: "manual",
		...(state === "received" ? { bodySha256: verifiedBodySha256! } : {}),
		...(state === "rejected" ? { reason: reason! } : {}),
	});
	if (!formattedAck.ok) {
		stderrLines.push(
			`mail-ack error [${formattedAck.code}]: ${formattedAck.reason}`,
		);
		return {
			exitCode: 1,
			stdout: "",
			stderr: `${stderrLines.join("\n")}\n`,
		};
	}

	const ackBytes = new TextEncoder().encode(formattedAck.value);
	// R1 운영 가정: uncertain 교체의 "재확인 → rename"은 조건부 원자 교체가 아니다.
	// mail-ack.sh는 한 번에 하나씩(단일 팀장 세션, 직렬 호출) 실행한다.
	// 동시에 같은 id로 실행하면 나중 결과가 앞 결과를 덮어쓸 수 있다(uncertain 교체 구간).
	const publishRes = existingAck.ok
		? await replaceUncertainAckFile(
				fsOps,
				tmpPath,
				ackPath,
				ackBytes,
				{ expectedId: id, expectedBy: recipient },
				[],
				signal,
			)
		: await publishExclusiveFile(
				fsOps,
				tmpPath,
				ackPath,
				ackBytes,
				[],
				signal,
			);

	for (const w of publishRes.warnings) {
		stderrLines.push(formatWarningLine("mail-ack", w));
	}
	if (!publishRes.ok) {
		stderrLines.push(
			`mail-ack error [${publishRes.error.code}] (${ackPath}): ${publishRes.error.message}`,
		);
		return {
			exitCode: 1,
			stdout: "",
			stderr: `${stderrLines.join("\n")}\n`,
		};
	}

	return {
		exitCode: 0,
		stdout: `${ackPath}\n`,
		stderr: stderrLines.length > 0 ? `${stderrLines.join("\n")}\n` : "",
	};
}

const SEND_OPTION_FLAGS = new Set([
	"--subject",
	"--from",
	"--reply-to",
	"--body-file",
]);

function parseSendArgs(
	args: readonly string[],
):
	| {
			ok: true;
			recipient: string;
			subject: string;
			from?: string;
			replyTo?: string;
			bodyFile?: string;
			useStdin: boolean;
	  }
	| { ok: false; code: string; message: string } {
	if (args.length === 0) {
		return {
			ok: false,
			code: "invalid_args",
			message:
				"Usage: mail-send.sh <recipient> --subject <subject> [--from <name>] [--reply-to <ulid>] [--body-file <path> | -]",
		};
	}
	const recipient = args[0]!;
	if (recipient.startsWith("-")) {
		return {
			ok: false,
			code: "invalid_args",
			message:
				"Usage: mail-send.sh <recipient> --subject <subject> [--from <name>] [--reply-to <ulid>] [--body-file <path> | -]",
		};
	}

	let subject: string | undefined;
	let from: string | undefined;
	let replyTo: string | undefined;
	let bodyFile: string | undefined;
	let useStdin = false;

	let i = 1;
	while (i < args.length) {
		const arg = args[i]!;
		if (arg === "-") {
			if (useStdin) {
				return {
					ok: false,
					code: "invalid_args",
					message: "Duplicate '-' (stdin) argument.",
				};
			}
			useStdin = true;
			i += 1;
			continue;
		}

		let optName: string | undefined;
		let optValue: string | undefined;
		if (SEND_OPTION_FLAGS.has(arg)) {
			optName = arg;
			const nextArg = args[i + 1];
			if (
				nextArg === undefined ||
				nextArg === "-" ||
				SEND_OPTION_FLAGS.has(nextArg) ||
				nextArg.startsWith("--subject=") ||
				nextArg.startsWith("--from=") ||
				nextArg.startsWith("--reply-to=") ||
				nextArg.startsWith("--body-file=")
			) {
				return {
					ok: false,
					code: "invalid_args",
					message: `Missing value for ${arg}.`,
				};
			}
			optValue = nextArg;
			i += 2;
		} else {
			for (const flag of SEND_OPTION_FLAGS) {
				if (arg.startsWith(`${flag}=`)) {
					optName = flag;
					optValue = arg.slice(flag.length + 1);
					break;
				}
			}
			if (optName === undefined) {
				return {
					ok: false,
					code: "invalid_args",
					message: `Unknown argument for send: ${arg}`,
				};
			}
			if (optValue === "") {
				return {
					ok: false,
					code: "invalid_args",
					message: `Missing value for ${optName}.`,
				};
			}
			i += 1;
		}

		if (optName === "--subject") {
			if (subject !== undefined) {
				return {
					ok: false,
					code: "invalid_args",
					message: "Duplicate --subject option.",
				};
			}
			subject = optValue!;
		} else if (optName === "--from") {
			if (from !== undefined) {
				return {
					ok: false,
					code: "invalid_args",
					message: "Duplicate --from option.",
				};
			}
			from = optValue!;
		} else if (optName === "--reply-to") {
			if (replyTo !== undefined) {
				return {
					ok: false,
					code: "invalid_args",
					message: "Duplicate --reply-to option.",
				};
			}
			replyTo = optValue!;
		} else if (optName === "--body-file") {
			if (bodyFile !== undefined) {
				return {
					ok: false,
					code: "invalid_args",
					message: "Duplicate --body-file option.",
				};
			}
			if (optValue === "") {
				return {
					ok: false,
					code: "invalid_args",
					message: "Missing value for --body-file.",
				};
			}
			bodyFile = optValue!;
		}
	}

	if (bodyFile !== undefined && useStdin) {
		return {
			ok: false,
			code: "invalid_args",
			message: "Cannot specify both --body-file and '-' (stdin).",
		};
	}
	if (subject === undefined) {
		return {
			ok: false,
			code: "invalid_args",
			message: "Missing required --subject option.",
		};
	}

	return {
		ok: true,
		recipient,
		subject,
		...(from !== undefined ? { from } : {}),
		...(replyTo !== undefined ? { replyTo } : {}),
		...(bodyFile !== undefined ? { bodyFile } : {}),
		useStdin,
	};
}

function decodeBodyUtf8(
	bytes: Uint8Array,
): { ok: true; value: string } | { ok: false; code: string; reason: string } {
	try {
		const text = new TextDecoder("utf-8", {
			fatal: true,
			ignoreBOM: true,
		}).decode(bytes);
		return { ok: true, value: text };
	} catch (error) {
		return {
			ok: false,
			code: "invalid_utf8",
			reason: `Message body is not valid UTF-8: ${errorMessage(error)}`,
		};
	}
}

async function readStdinBytes(
	stdinSource: MailStdinSource,
	maxBytes = MAX_MESSAGE_BYTES,
	signal?: AbortSignal,
): Promise<
	| { ok: true; value: Uint8Array }
	| { ok: false; code: string; reason: string }
> {
	if (signal?.aborted) {
		return {
			ok: false,
			code: "aborted",
			reason: "Mail send operation was aborted.",
		};
	}
	const maxRead = maxBytes + 1;
	const buffer = new Uint8Array(maxRead);
	let totalBytes = 0;

	const appendChunk = (chunk: Uint8Array | string): boolean => {
		const bytes =
			typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
		if (bytes.byteLength === 0) return true;
		const copyLen = Math.min(bytes.byteLength, maxRead - totalBytes);
		if (copyLen > 0) {
			buffer.set(bytes.subarray(0, copyLen), totalBytes);
			totalBytes += copyLen;
		}
		return totalBytes <= maxBytes;
	};

	try {
		if (typeof stdinSource === "string" || stdinSource instanceof Uint8Array) {
			appendChunk(stdinSource);
		} else {
			for await (const chunk of stdinSource) {
				if (signal?.aborted) {
					return {
						ok: false,
						code: "aborted",
						reason: "Mail send operation was aborted.",
					};
				}
				if (!appendChunk(chunk)) {
					break;
				}
			}
		}
	} catch (error) {
		return {
			ok: false,
			code: "stdin_read_failed",
			reason: `Cannot read message body from stdin: ${errorMessage(error)}`,
		};
	}

	if (totalBytes > maxBytes) {
		return {
			ok: false,
			code: "size_exceeded",
			reason: `Message body from stdin exceeds the ${maxBytes}-byte limit.`,
		};
	}
	return { ok: true, value: buffer.subarray(0, totalBytes) };
}

/**
 * `send <recipient> --subject <subject> [--from <name>] [--reply-to <ulid>] [--body-file <path> | -]`
 */
export async function sendMailbox(
	args: readonly string[],
	deps?: MailCliDeps,
): Promise<MailCliResult> {
	const parsedArgs = parseSendArgs(args);
	if (!parsedArgs.ok) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: `mail-send error [${parsedArgs.code}]: ${parsedArgs.message}\n`,
		};
	}

	const fsOps = deps?.fs ?? defaultMailFs;
	const exec = deps?.exec ?? defaultCliExec;
	const nowFn = deps?.now ?? (() => Date.now());
	const baseEnv = deps?.env ?? process.env;
	const stdinSource = deps?.stdin ?? process.stdin;
	const signal = deps?.signal;

	const sender =
		parsedArgs.from !== undefined ? parsedArgs.from : baseEnv[MAILBOX_ENV_KEY];
	if (!sender) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: `mail-send error [missing_sender_mailbox]: --from or ${MAILBOX_ENV_KEY} is required to send mail.\n`,
		};
	}
	if (!isValidMailboxName(sender)) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: `mail-send error [invalid_sender_mailbox]: Sender mailbox '${sender}' does not match ^[a-z][a-z0-9-]{0,31}$.\n`,
		};
	}
	if (!isValidMailboxName(parsedArgs.recipient)) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: `mail-send error [invalid_recipient]: Recipient 'to' (${parsedArgs.recipient}) does not match ^[a-z][a-z0-9-]{0,31}$.\n`,
		};
	}
	if (parsedArgs.replyTo !== undefined && !isValidUlid(parsedArgs.replyTo)) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: `mail-send error [invalid_reply_to]: reply_to (${parsedArgs.replyTo}) is not a valid 26-character ULID.\n`,
		};
	}

	let body = "";
	if (parsedArgs.bodyFile !== undefined) {
		const rawFile = await readMailboxFileBytes(
			fsOps,
			parsedArgs.bodyFile,
			MAX_MESSAGE_BYTES,
		);
		if (!rawFile.ok) {
			return {
				exitCode: 1,
				stdout: "",
				stderr: `mail-send error [${rawFile.code}]: ${rawFile.reason}\n`,
			};
		}
		const decoded = decodeBodyUtf8(rawFile.value);
		if (!decoded.ok) {
			return {
				exitCode: 1,
				stdout: "",
				stderr: `mail-send error [${decoded.code}]: ${decoded.reason}\n`,
			};
		}
		body = decoded.value;
	} else if (parsedArgs.useStdin) {
		const rawStdin = await readStdinBytes(
			stdinSource,
			MAX_MESSAGE_BYTES,
			signal,
		);
		if (!rawStdin.ok) {
			return {
				exitCode: 1,
				stdout: "",
				stderr: `mail-send error [${rawStdin.code}]: ${rawStdin.reason}\n`,
			};
		}
		const decoded = decodeBodyUtf8(rawStdin.value);
		if (!decoded.ok) {
			return {
				exitCode: 1,
				stdout: "",
				stderr: `mail-send error [${decoded.code}]: ${decoded.reason}\n`,
			};
		}
		body = decoded.value;
	}

	const mailDeps: MailDeps = {
		exec,
		fs: fsOps,
		env: { ...baseEnv, [MAILBOX_ENV_KEY]: sender },
		now: nowFn,
		...(deps?.randomBytes ? { randomBytes: deps.randomBytes } : {}),
	};

	const sendRes = await sendMail(
		mailDeps,
		{
			to: parsedArgs.recipient,
			subject: parsedArgs.subject,
			body,
			...(parsedArgs.replyTo !== undefined
				? { reply_to: parsedArgs.replyTo }
				: {}),
		},
		signal,
	);

	const stderrLines: string[] = [];
	for (const w of sendRes.warnings ?? []) {
		stderrLines.push(formatWarningLine("mail-send", w));
	}
	if (!sendRes.ok || !sendRes.path) {
		const code = sendRes.error?.code ?? "send_failed";
		const message = sendRes.error?.message ?? "Mail send failed.";
		stderrLines.push(`mail-send error [${code}]: ${message}`);
		return {
			exitCode: 1,
			stdout: "",
			stderr: `${stderrLines.join("\n")}\n`,
		};
	}

	return {
		exitCode: 0,
		stdout: `${sendRes.path}\n`,
		stderr: stderrLines.length > 0 ? `${stderrLines.join("\n")}\n` : "",
	};
}

export async function runMailCli(
	argv: readonly string[],
	deps?: MailCliDeps,
): Promise<MailCliResult> {
	const [subcommand, ...rest] = argv;
	if (subcommand === "watch") {
		return watchMailbox(rest, deps);
	}
	if (subcommand === "ack") {
		return ackMailbox(rest, deps);
	}
	if (subcommand === "send") {
		return sendMailbox(rest, deps);
	}
	return {
		exitCode: 1,
		stdout: "",
		stderr:
			"mail-cli error [invalid_subcommand]: Expected 'watch', 'ack', or 'send'.\n",
	};
}

if (import.meta.main) {
	const result = await runMailCli(process.argv.slice(2));
	if (result.stderr) {
		process.stderr.write(result.stderr);
	}
	if (result.stdout) {
		process.stdout.write(result.stdout);
	}
	process.exit(result.exitCode);
}
