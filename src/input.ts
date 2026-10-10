import type { ExtensionAPI } from "@gajae-code/coding-agent";

type Exec = ExtensionAPI["exec"];

/** empty: nothing typed. typing: text sits in the input box. unknown: the box could not be read or recognized. */
export type InputState = "empty" | "typing" | "unknown";

export interface InputGuardDeps {
	exec: Exec;
	herdrBin: string;
	/** Test seam; defaults to a real timer. */
	sleep?: (ms: number) => Promise<void>;
}

export interface InputWaitResult {
	state: InputState;
	waitedMs: number;
}

const READ_TIMEOUT_MS = 3_000;
const READ_LINES = "30";
const POLL_INTERVAL_MS = 2_000;
export const DEFAULT_INPUT_WAIT_SEC = 60;
const MAX_INPUT_WAIT_SEC = 600;
/** The input box must be near the bottom; anything deeper is conversation output. */
const MAX_LINES_BELOW_BOX = 3;
const RULE = /^[─━]{10,}$/;
const ANSI = /\x1b\[([0-9;:]*)m/g;

const GJC_PLACEHOLDER = "Type your message...";

/** Reads GJC_HERDR_INPUT_WAIT_SEC (0 disables waiting); invalid values fall back to the default. */
export function inputWaitMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env.GJC_HERDR_INPUT_WAIT_SEC;
	if (raw === undefined || raw.trim() === "") return DEFAULT_INPUT_WAIT_SEC * 1_000;
	const sec = Number(raw);
	if (!Number.isFinite(sec) || sec < 0) return DEFAULT_INPUT_WAIT_SEC * 1_000;
	return Math.min(sec, MAX_INPUT_WAIT_SEC) * 1_000;
}

function strip(line: string): string {
	return line.replace(ANSI, "");
}

/** Characters of `line` that are visible and not rendered dim (dim text is a placeholder or hint). */
function brightText(line: string): string {
	let dim = false;
	let out = "";
	let last = 0;
	for (const match of line.matchAll(ANSI)) {
		if (!dim) out += line.slice(last, match.index);
		last = match.index + match[0].length;
		const params = match[1].split(/[;:]/).map((p) => (p === "" ? 0 : Number(p)));
		for (let i = 0; i < params.length; i++) {
			const code = params[i];
			if (code === 38 || code === 48) i += params[i + 1] === 5 ? 2 : 4;
			else if (code === 0) dim = false;
			else if (code === 2) dim = true;
			else if (code === 22) dim = false;
		}
	}
	if (!dim) out += line.slice(last);
	return out;
}

/** Claude Code: the `❯` row(s) between the last two horizontal rules. */
function claudeBox(lines: string[]): InputState | undefined {
	const plain = lines.map((line) => strip(line).trim());
	let bottom = -1;
	for (let i = plain.length - 1; i >= 0; i--) {
		if (RULE.test(plain[i])) {
			bottom = i;
			break;
		}
	}
	if (bottom < 0) return undefined;
	let top = -1;
	for (let i = bottom - 1; i >= 0; i--) {
		if (RULE.test(plain[i])) {
			top = i;
			break;
		}
	}
	if (top < 0 || bottom - top < 2) return undefined;
	if (!plain[top + 1].startsWith("❯")) return undefined;
	if (plain.slice(bottom + 1).filter(Boolean).length > MAX_LINES_BELOW_BOX) {
		return undefined;
	}
	const typed = lines
		.slice(top + 1, bottom)
		.map((line, i) => (i === 0 ? brightText(line).replace(/^\s*❯/, "") : brightText(line)))
		.join("")
		.trim();
	return typed ? "typing" : "empty";
}

/** GJC: the rounded `╭ │ > … │ ╰` box. */
function gjcBox(lines: string[]): InputState | undefined {
	const plain = lines.map((line) => strip(line).trim());
	let bottom = -1;
	for (let i = plain.length - 1; i >= 0; i--) {
		if (plain[i].startsWith("╰")) {
			bottom = i;
			break;
		}
	}
	if (bottom < 0) return undefined;
	let top = -1;
	for (let i = bottom - 1; i >= 0; i--) {
		if (plain[i].startsWith("╭")) {
			top = i;
			break;
		}
	}
	if (top < 0 || bottom - top < 2) return undefined;
	if (plain.slice(bottom + 1).filter(Boolean).length > MAX_LINES_BELOW_BOX) {
		return undefined;
	}
	const rows = plain
		.slice(top + 1, bottom)
		.map((row) => row.replace(/^│\s?/, "").replace(/\s*│$/, ""));
	if (!rows[0]?.startsWith(">")) return undefined;
	const first = rows[0].slice(1).trim();
	const rest = rows.slice(1).join("").trim();
	if (rest) return "typing";
	if (first === "" || first.startsWith(GJC_PLACEHOLDER)) return "empty";
	return "typing";
}

/** Classifies the input box in an ANSI `pane read --source visible` snapshot. */
export function classifyInput(screen: string): InputState {
	const lines = screen.replace(/\s+$/, "").split("\n");
	return claudeBox(lines) ?? gjcBox(lines) ?? "unknown";
}

/** One read-only `herdr pane read`; any failure is `unknown`, never an error. */
export async function readInputState(
	deps: InputGuardDeps,
	paneId: string,
	signal?: AbortSignal,
): Promise<InputState> {
	try {
		const result = await deps.exec(
			deps.herdrBin,
			["pane", "read", paneId, "--source", "visible", "--lines", READ_LINES, "--format", "ansi"],
			{ timeout: READ_TIMEOUT_MS, signal },
		);
		if (result.killed || result.code !== 0) return "unknown";
		return classifyInput(result.stdout);
	} catch {
		return "unknown";
	}
}

/**
 * Re-reads the input box every 2 s until it is empty or `maxWaitMs` elapses.
 * `unknown` returns immediately so the caller can fall back to its own rule.
 */
export async function waitForEmptyInput(
	deps: InputGuardDeps,
	paneId: string,
	maxWaitMs: number,
	signal?: AbortSignal,
): Promise<InputWaitResult> {
	const sleep =
		deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	let waitedMs = 0;
	for (;;) {
		const state = await readInputState(deps, paneId, signal);
		if (state !== "typing") return { state, waitedMs };
		if (waitedMs >= maxWaitMs || signal?.aborted) return { state, waitedMs };
		const step = Math.min(POLL_INTERVAL_MS, maxWaitMs - waitedMs);
		await sleep(step);
		waitedMs += step;
	}
}
