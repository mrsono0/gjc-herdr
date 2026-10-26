import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = fs.realpathSync(path.resolve(import.meta.dir, ".."));
const DIALOG_WATCH_PY = path.join(REPO_ROOT, "scripts", "dialog-watch.py");

function resolvePython3(): string {
	for (const candidate of ["/opt/homebrew/bin/python3", "/usr/bin/python3"]) {
		if (fs.existsSync(candidate)) {
			try {
				return fs.realpathSync(candidate);
			} catch {
				return candidate;
			}
		}
	}
	throw new Error("python3 not found");
}

const REAL_PYTHON3 = resolvePython3();

const MATE_NAME = "gjc-herdr-mate";
const CRITIC_NAME = "gjc-herdr-critic";
const MATE_PANE = "w1:p2";
const CRITIC_PANE = "w1:p3";

// 지시서 §배경 다섯 화면 + 짧은 명령 화면 + 보통 화면
const SCREEN_AGY_TRUST = `Do you trust the contents of this project?

Antigravity CLI requires permission to read, edit, and execute files here.

> Yes, I trust this folder
  No, exit

  ↑/↓ Navigate · enter Confirm
`;

const SCREEN_AGY_COMMAND_TRUNCATED = `Requesting permission for:
   echo SEG01-abcdefghij SEG02-abcdefghij ...

Run this command?
> 1. Yes, run command
  2. Yes, and always allow in this conversation for commands that start with 'echo'
  3. Yes, and always allow for commands that start with 'echo' (Persist to settings.json)
  4. No, cancel

  ↑/↓ Navigate · tab Amend · ctrl+g edit/expand command
esc to cancel                      Gemini 4 Argon · high · AI: 939 (/credits to add mor
`;

const SCREEN_AGY_COMMAND_SHORT = `Requesting permission for:
   echo hello

Run this command?
> 1. Yes, run command
  2. Yes, and always allow in this conversation for commands that start with 'echo'
  3. Yes, and always allow for commands that start with 'echo' (Persist to settings.json)
  4. No, cancel

  ↑/↓ Navigate · tab Amend · enter Confirm
esc to cancel                      Gemini 4 Argon · high · AI: 939 (/credits to add mor
`;

const SCREEN_AGY_EDITOR = `    SEG029-abcdefghij SEG030-abcdefghij SEG031-abcdefghij SEG032-abcdefghij

  enter confirm · esc back · pgup/pgdown scroll Full Command
esc to cancel                      Gemini 4 Argon · high · AI: 939 (/credits to add mor
`;

const SCREEN_CODEX_TRUST = `  Folder access
  /Users/test-secret-owner/private-project-path

  Trust this folder? Codex can read, edit, and run files here, subject to your
  permission settings. ...

› 1. Trust and continue
  2. Back to Agent Command Center

  enter continue · esc back
`;

const SCREEN_QUESTION = `Which deployment target should be used for this task?

> 1. Local staging
  2. Remote sandbox

  ↑/↓ Navigate · enter Confirm
`;

const SCREEN_NORMAL_DONE = `Completed task verification.
All 12 unit tests passed.

❯
`;

interface AgentFixture {
	mode: "ok" | "not_found" | "fail";
	pane_id?: string;
	agent_status?: string;
	state_change_seq?: number;
	revision?: number;
	screen?: string;
	readFail?: boolean;
	readNotIdle?: boolean;
	emptyReadOnce?: boolean;
}

function expectStatus(
	res: { status: number | null; stdout: string; stderr: string },
	expected: number,
): void {
	if (res.status !== expected) {
		throw new Error(
			`Expected status ${expected} but got ${String(res.status)}\nstdout: ${JSON.stringify(res.stdout)}\nstderr: ${JSON.stringify(res.stderr)}`,
		);
	}
	expect(res.status).toBe(expected);
}

interface Harness {
	tmpDir: string;
	binDir: string;
	statePath: string;
	herdrLogPath: string;
	setAgent: (name: string, fixture: AgentFixture) => void;
	readHerdrCalls: () => string[];
	clearHerdrCalls: () => void;
	assertReadOnlyHerdrCalls: () => void;
	runSync: (args?: string[]) => {
		status: number | null;
		stdout: string;
		stderr: string;
	};
	cleanup: () => void;
}

function createHarness(): Harness {
	const rawTmp = fs.mkdtempSync("/tmp/gjch-t-dw-");
	const tmpDir = fs.realpathSync(rawTmp);
	const binDir = path.join(tmpDir, "bin");
	const fixturesDir = path.join(tmpDir, "fixtures");
	const homeDir = path.join(tmpDir, "home");
	const statePath = path.join(tmpDir, "state", "dialog-watch.state");
	const herdrLogPath = path.join(tmpDir, "herdr-calls.log");
	const mutatingLogPath = path.join(tmpDir, "herdr-mutating.log");

	fs.mkdirSync(binDir, { recursive: true });
	fs.mkdirSync(fixturesDir, { recursive: true });
	fs.mkdirSync(homeDir, { recursive: true });

	fs.symlinkSync(REAL_PYTHON3, path.join(binDir, "python3"));

	const fakeHerdr = `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(herdrLogPath)}
cmd="\${1:-}"
sub="\${2:-}"
case "$cmd $sub" in
	"agent get")
		name="\${3:-}"
		mode_file="${fixturesDir}/\${name}.mode"
		json_file="${fixturesDir}/\${name}.json"
		if [ ! -f "$mode_file" ]; then
			printf '{"error":{"code":"agent_not_found","message":"not found"}}\\n' >&2
			exit 1
		fi
		mode=$(cat "$mode_file")
		if [ "$mode" = "not_found" ]; then
			printf '{"error":{"code":"agent_not_found","message":"not found"}}\\n' >&2
			exit 1
		fi
		if [ "$mode" = "fail" ]; then
			printf '{"error":{"code":"internal_error","message":"lookup failed"}}\\n' >&2
			exit 1
		fi
		cat "$json_file"
		printf '\\n'
		exit 0
		;;
	"agent read")
		name="\${3:-}"
		read_fail_file="${fixturesDir}/\${name}.read_fail"
		read_not_idle_file="${fixturesDir}/\${name}.read_not_idle"
		empty_once_file="${fixturesDir}/\${name}.empty_once"
		status_file="${fixturesDir}/\${name}.status"
		screen_file="${fixturesDir}/\${name}.screen"
		st="idle"
		if [ -f "$status_file" ]; then
			st=$(cat "$status_file")
		fi
		case " $* " in
			*" --source recent-unwrapped "*)
				if [ "$st" = "working" ]; then
					printf '{"error":{"code":"agent_not_idle","message":"cannot read 40 lines while %s is working: its alternate-screen history can only be captured by scroll…"}}\\n' "$name" >&2
					exit 1
				fi
				;;
		esac
		if [ -f "$read_not_idle_file" ]; then
			printf '{"error":{"code":"agent_not_idle","message":"cannot read 40 lines while %s is working: its alternate-screen history can only be captured by scroll…"}}\\n' "$name" >&2
			exit 1
		fi
		if [ -f "$read_fail_file" ]; then
			printf 'read error\\n' >&2
			exit 1
		fi
		if [ -f "$empty_once_file" ]; then
			rm -f "$empty_once_file"
			printf '   \\n\\t\\n'
			exit 0
		fi
		if [ -f "$screen_file" ]; then
			cat "$screen_file"
		fi
		exit 0
		;;
	*)
		printf '%s\\n' "$*" >> ${JSON.stringify(mutatingLogPath)}
		printf 'unexpected or mutating herdr command: %s\\n' "$*" >&2
		exit 99
		;;
esac
`;
	const herdrBin = path.join(binDir, "herdr");
	fs.writeFileSync(herdrBin, fakeHerdr, "utf8");
	fs.chmodSync(herdrBin, 0o755);

	function setAgent(name: string, fixture: AgentFixture): void {
		const modeFile = path.join(fixturesDir, `${name}.mode`);
		const jsonFile = path.join(fixturesDir, `${name}.json`);
		const statusFile = path.join(fixturesDir, `${name}.status`);
		const screenFile = path.join(fixturesDir, `${name}.screen`);
		const readFailFile = path.join(fixturesDir, `${name}.read_fail`);
		const readNotIdleFile = path.join(fixturesDir, `${name}.read_not_idle`);
		const emptyOnceFile = path.join(fixturesDir, `${name}.empty_once`);

		fs.writeFileSync(modeFile, fixture.mode, "utf8");
		fs.writeFileSync(statusFile, fixture.agent_status ?? "idle", "utf8");
		if (fixture.mode === "ok") {
			const payload = {
				result: {
					agent: {
						name,
						pane_id: fixture.pane_id ?? (name === CRITIC_NAME ? CRITIC_PANE : MATE_PANE),
						agent_status: fixture.agent_status ?? "idle",
						state_change_seq: fixture.state_change_seq ?? 1,
						revision: fixture.revision ?? 1,
						focused: false,
					},
				},
			};
			fs.writeFileSync(jsonFile, JSON.stringify(payload), "utf8");
		}
		fs.writeFileSync(screenFile, fixture.screen ?? SCREEN_NORMAL_DONE, "utf8");
		if (fixture.readFail) {
			fs.writeFileSync(readFailFile, "1", "utf8");
		} else {
			fs.rmSync(readFailFile, { force: true });
		}
		if (fixture.readNotIdle) {
			fs.writeFileSync(readNotIdleFile, "1", "utf8");
		} else {
			fs.rmSync(readNotIdleFile, { force: true });
		}
		if (fixture.emptyReadOnce) {
			fs.writeFileSync(emptyOnceFile, "1", "utf8");
		} else {
			fs.rmSync(emptyOnceFile, { force: true });
		}
	}

	// 기본값: 두 팀원 모두 idle 보통 화면
	setAgent(MATE_NAME, {
		mode: "ok",
		pane_id: MATE_PANE,
		agent_status: "idle",
		state_change_seq: 1,
		screen: SCREEN_NORMAL_DONE,
	});
	setAgent(CRITIC_NAME, {
		mode: "ok",
		pane_id: CRITIC_PANE,
		agent_status: "idle",
		state_change_seq: 1,
		screen: SCREEN_NORMAL_DONE,
	});

	function readHerdrCalls(): string[] {
		if (!fs.existsSync(herdrLogPath)) return [];
		return fs
			.readFileSync(herdrLogPath, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean);
	}

	function clearHerdrCalls(): void {
		fs.rmSync(herdrLogPath, { force: true });
	}

	function assertReadOnlyHerdrCalls(): void {
		expect(fs.existsSync(mutatingLogPath)).toBe(false);
		const calls = readHerdrCalls();
		const forbidden = [
			"send-keys",
			"send-text",
			"prompt",
			"rename",
			"split",
			"move",
			"resize",
			"start",
			"close",
			"focus",
			"zoom",
		];
		for (const call of calls) {
			for (const word of forbidden) {
				expect(call).not.toContain(word);
			}
			const allowed =
				call.startsWith("agent get ") || call.startsWith("agent read ");
			expect(allowed).toBe(true);
		}
	}

	function runSync(args: string[] = []): {
		status: number | null;
		stdout: string;
		stderr: string;
	} {
		const env: NodeJS.ProcessEnv = {
			...process.env,
			PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
			HOME: homeDir,
			PYTHONDONTWRITEBYTECODE: "1",
			PYTHONNOUSERSITE: "1",
		};
		const res = spawnSync(REAL_PYTHON3, [DIALOG_WATCH_PY, ...args], {
			cwd: REPO_ROOT,
			env,
			encoding: "utf8",
			timeout: 20_000,
		});
		return {
			status: res.status,
			stdout: res.stdout ?? "",
			stderr: res.stderr ?? "",
		};
	}

	return {
		tmpDir,
		binDir,
		statePath,
		herdrLogPath,
		setAgent,
		readHerdrCalls,
		clearHerdrCalls,
		assertReadOnlyHerdrCalls,
		runSync,
		cleanup: () => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		},
	};
}

describe("scripts/dialog-watch.py (#60)", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		while (cleanups.length > 0) {
			const fn = cleanups.pop();
			try {
				fn?.();
			} catch {
				// ignore
			}
		}
	});

	test("1. 다섯 화면 각각의 판정(종류·요약) 및 agy-command 잘린 명령·짧은 명령 구분", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);

		// (1) agy 폴더 신뢰 (blocked) -> agy-trust
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "blocked",
			screen: SCREEN_AGY_TRUST,
		});
		const r1 = h.runSync(["--once", "--state", h.statePath]);
		expect(r1.status).toBe(10);
		expect(r1.stdout.trim()).toBe(
			`DIALOG ${MATE_NAME} ${MATE_PANE} agy-trust Do you trust the contents of this project? (Yes, I trust this folder / No, exit)`,
		);

		// (2a) agy 명령 확인 - 잘린 명령 (blocked) -> agy-command (첫 낱말 echo, 글자 수 42, 잘림=예)
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "blocked",
			screen: SCREEN_AGY_COMMAND_TRUNCATED,
		});
		const r2a = h.runSync(["--once", "--state", h.statePath]);
		expect(r2a.status).toBe(10);
		expect(r2a.stdout.trim()).toBe(
			`DIALOG ${MATE_NAME} ${MATE_PANE} agy-command cmd=echo chars=42 잘림=예 (1. Yes, run command / 4. No, cancel)`,
		);

		// (2b) agy 명령 확인 - 짧은 명령 (blocked) -> agy-command (첫 낱말 echo, 글자 수 10, 잘림=아니오)
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "blocked",
			screen: SCREEN_AGY_COMMAND_SHORT,
		});
		const r2b = h.runSync(["--once", "--state", h.statePath]);
		expect(r2b.status).toBe(10);
		expect(r2b.stdout.trim()).toBe(
			`DIALOG ${MATE_NAME} ${MATE_PANE} agy-command cmd=echo chars=10 잘림=아니오 (1. Yes, run command / 4. No, cancel)`,
		);

		// (3) agy 전문 보기 편집기 (done) -> agy-editor
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "done",
			state_change_seq: 2,
			screen: SCREEN_AGY_EDITOR,
		});
		const r3 = h.runSync(["--once", "--state", h.statePath]);
		expect(r3.status).toBe(10);
		expect(r3.stdout.trim()).toBe(
			`DIALOG ${MATE_NAME} ${MATE_PANE} agy-editor Full Command 편집기 (enter confirm · esc back)`,
		);

		// (4) Codex 폴더 신뢰 (blocked) -> codex-trust (경로 미포함)
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "idle",
			screen: SCREEN_NORMAL_DONE,
		});
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "blocked",
			screen: SCREEN_CODEX_TRUST,
		});
		const r4 = h.runSync(["--once", "--state", h.statePath]);
		expect(r4.status).toBe(10);
		expect(r4.stdout.trim()).toBe(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} codex-trust Trust this folder? (1. Trust and continue / 2. Back to Agent Command Center)`,
		);
		expect(r4.stdout).not.toContain("/Users/");
		expect(r4.stdout).not.toContain("private-project-path");

		// (5) 그 밖의 질문 (blocked) -> question (고정 요약 '선택지 <n>개')
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "blocked",
			screen: SCREEN_QUESTION,
		});
		const r5 = h.runSync(["--once", "--state", h.statePath]);
		expect(r5.status).toBe(10);
		expect(r5.stdout.trim()).toBe(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} question 선택지 2개`,
		);

		h.assertReadOnlyHerdrCalls();
	});

	test("2. done + 편집기 → agy-editor, done + 보통 화면 → 알림 없음, 상태 seq 미변경 시 read 생략", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);

		// done + 보통 화면 -> --once에서 none (rc 0)
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "done",
			state_change_seq: 10,
			screen: SCREEN_NORMAL_DONE,
		});
		h.setAgent(CRITIC_NAME, { mode: "not_found" });

		const rNormal = h.runSync(["--once", "--state", h.statePath]);
		expect(rNormal.status).toBe(0);
		expect(rNormal.stdout.trim()).toBe("none");

		// 폴링 감시에서 done + 같은 state_change_seq(10)이면 첫 폴링만 agent read를 부르고 이후 폴링은 생략
		h.clearHerdrCalls();
		const rTimeout = h.runSync([
			"--names",
			MATE_NAME,
			"--interval",
			"0.02",
			"--timeout",
			"0.45",
			"--state",
			h.statePath,
		]);
		expectStatus(rTimeout, 0);
		expect(rTimeout.stdout.trim()).toBe("DIALOG-WATCH timeout");

		const calls = h.readHerdrCalls();
		const getCalls = calls.filter((c) => c === `agent get ${MATE_NAME}`);
		const readCalls = calls.filter((c) =>
			c.startsWith(`agent read ${MATE_NAME}`),
		);
		expect(getCalls.length).toBeGreaterThanOrEqual(2);
		expect(readCalls.length).toBe(1);

		// done + 편집기 -> agy-editor (rc 10)
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "done",
			state_change_seq: 11,
			screen: SCREEN_AGY_EDITOR,
		});
		const rEditor = h.runSync([
			"--names",
			MATE_NAME,
			"--interval",
			"0.05",
			"--timeout",
			"15.0",
			"--state",
			h.statePath,
		]);
		expectStatus(rEditor, 10);
		expect(rEditor.stdout.trim()).toContain(
			`DIALOG ${MATE_NAME} ${MATE_PANE} agy-editor`,
		);

		h.assertReadOnlyHerdrCalls();
	});

	test("3. 같은 창 두 번째 감시 → 알리지 않음(상태 파일 기록·중복 억제), 다른 창으로 바뀌면 알림", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);

		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "blocked",
			screen: SCREEN_AGY_TRUST,
		});
		h.setAgent(CRITIC_NAME, { mode: "not_found" });

		// 첫 번째 감시: DIALOG 출력 + rc 10 + 상태 파일 생성
		const first = h.runSync([
			"--names",
			MATE_NAME,
			"--interval",
			"0.05",
			"--timeout",
			"15.0",
			"--state",
			h.statePath,
		]);
		expectStatus(first, 10);
		expect(first.stdout.trim()).toContain(
			`DIALOG ${MATE_NAME} ${MATE_PANE} agy-trust`,
		);
		expect(fs.existsSync(h.statePath)).toBe(true);

		const savedState = JSON.parse(fs.readFileSync(h.statePath, "utf8"));
		expect(savedState.name).toBe(MATE_NAME);
		expect(savedState.pane).toBe(MATE_PANE);
		expect(savedState.kind).toBe("agy-trust");
		expect(typeof savedState.summary).toBe("string");
		expect(savedState.fingerprint).toMatch(/^[0-9a-f]{16}$/);
		expect(typeof savedState.at).toBe("string");

		// 같은 창에서 두 번째 감시(폴링): 알리지 않고 감시를 계속하다가 timeout(rc 0)으로 종료
		const second = h.runSync([
			"--names",
			MATE_NAME,
			"--interval",
			"0.02",
			"--timeout",
			"0.35",
			"--state",
			h.statePath,
		]);
		expectStatus(second, 0);
		expect(second.stdout.trim()).toBe("DIALOG-WATCH timeout");

		// 같은 창에서 --once 실행: 상태 파일과 지문·이름·종류가 같으므로 none (rc 0)
		const secondOnce = h.runSync([
			"--once",
			"--names",
			MATE_NAME,
			"--state",
			h.statePath,
		]);
		expectStatus(secondOnce, 0);
		expect(secondOnce.stdout.trim()).toBe("none");

		// 다른 창(agy-command)으로 바뀌면 즉시 새 창을 알림 (rc 10)
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "blocked",
			screen: SCREEN_AGY_COMMAND_SHORT,
		});
		const third = h.runSync([
			"--names",
			MATE_NAME,
			"--interval",
			"0.05",
			"--timeout",
			"15.0",
			"--state",
			h.statePath,
		]);
		expectStatus(third, 10);
		expect(third.stdout.trim()).toContain(
			`DIALOG ${MATE_NAME} ${MATE_PANE} agy-command`,
		);

		h.assertReadOnlyHerdrCalls();
	});

	test("4. --once가 상태 파일을 만들거나 바꾸지 않음. 알릴 것이 없으면 rc 0과 none", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);

		// 초기 상태: 알릴 것이 없음 -> rc 0, none, 상태 파일(및 상위 폴더) 미생성
		expect(fs.existsSync(h.statePath)).toBe(false);
		const rNone = h.runSync(["--once", "--state", h.statePath]);
		expect(rNone.status).toBe(0);
		expect(rNone.stdout.trim()).toBe("none");
		expect(fs.existsSync(h.statePath)).toBe(false);
		expect(fs.existsSync(path.dirname(h.statePath))).toBe(false);

		// 알릴 창(agy-trust)이 있을 때 --once -> rc 10, DIALOG 출력하지만 상태 파일은 만들지 않음
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "blocked",
			screen: SCREEN_AGY_TRUST,
		});
		const rDialog = h.runSync(["--once", "--state", h.statePath]);
		expect(rDialog.status).toBe(10);
		expect(rDialog.stdout.trim()).toContain(
			`DIALOG ${MATE_NAME} ${MATE_PANE} agy-trust`,
		);
		expect(fs.existsSync(h.statePath)).toBe(false);

		// 이미 상태 파일이 있을 때도 --once는 상태 파일 내용을 바꾸지 않음
		fs.mkdirSync(path.dirname(h.statePath), { recursive: true });
		const preExisting = JSON.stringify({
			name: "other-agent",
			pane: "w9:p9",
			kind: "question",
			summary: "keep-me",
			fingerprint: "0000111122223333",
			at: "2026-10-20T00:00:00+09:00",
		});
		fs.writeFileSync(h.statePath, preExisting, "utf8");

		const rDialog2 = h.runSync(["--once", "--state", h.statePath]);
		expect(rDialog2.status).toBe(10);
		expect(fs.readFileSync(h.statePath, "utf8")).toBe(preExisting);

		h.assertReadOnlyHerdrCalls();
	});

	test("5. 요약에 명령 원문 전체·경로·비밀이 나오지 않음(긴 명령의 뒷부분 표식 미노출) 및 마지막 창 기준 판정", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);

		const tailMarker = "TAIL_SECRET_MARKER_DO_NOT_LEAK_987654";
		const secretArg = "API_TOKEN=sk-secret-value-12345";
		const screenWithLongCmdAndEarlierTrust = `${SCREEN_AGY_TRUST}

Requesting permission for:
   /usr/local/bin/python3 /Users/secret/run.py --token ${secretArg} ${tailMarker} ...

Run this command?
> 1. Yes, run command
  4. No, cancel

  ↑/↓ Navigate · tab Amend · ctrl+g edit/expand command
`;
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "blocked",
			screen: screenWithLongCmdAndEarlierTrust,
		});

		const res = h.runSync(["--once", "--state", h.statePath]);
		expect(res.status).toBe(10);
		const line = res.stdout.trim();
		// 위쪽의 agy-trust가 아니라 마지막에 나온 agy-command로 판정
		expect(line).toContain(`DIALOG ${MATE_NAME} ${MATE_PANE} agy-command`);
		expect(line).toContain("cmd=python3");
		expect(line).toContain("잘림=예");
		// 명령 뒷부분 표식·경로·비밀값이 출력에 절대 포함되지 않음
		expect(line).not.toContain(tailMarker);
		expect(line).not.toContain("sk-secret-value");
		expect(line).not.toContain("/usr/local/bin");
		expect(line).not.toContain("/Users/secret");

		h.assertReadOnlyHerdrCalls();
	});

	test("6. 대상 하나가 agent_not_found면 건너뜀, 모든 대상 연속 3회 조회 실패 → DIALOG-WATCH unavailable 및 rc 2", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);

		// (a) mate는 agent_not_found, critic은 blocked(codex-trust) -> mate 건너뛰고 critic 판정 (stderr 없음)
		h.setAgent(MATE_NAME, { mode: "not_found" });
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "blocked",
			screen: SCREEN_CODEX_TRUST,
		});
		const rSkip = h.runSync(["--once", "--state", h.statePath]);
		expect(rSkip.status).toBe(10);
		expect(rSkip.stderr).toBe("");
		expect(rSkip.stdout.trim()).toContain(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} codex-trust`,
		);

		// (b) mate는 조회 실패(fail), critic은 정상(blocked) -> mate는 stderr 한 줄 남기고 건너뛰며 critic 정상 판정
		h.setAgent(MATE_NAME, { mode: "fail" });
		const rOneFail = h.runSync(["--once", "--state", h.statePath]);
		expect(rOneFail.status).toBe(10);
		expect(rOneFail.stderr.trim().split("\n").length).toBe(1);
		expect(rOneFail.stdout.trim()).toContain(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} codex-trust`,
		);

		// (c) 모든 대상이 연속 3회 조회 실패 -> DIALOG-WATCH unavailable 출력 후 rc 2
		h.setAgent(MATE_NAME, { mode: "fail" });
		h.setAgent(CRITIC_NAME, { mode: "fail" });
		h.clearHerdrCalls();

		const rUnavail = h.runSync([
			"--interval",
			"0.03",
			"--timeout",
			"15.0",
			"--state",
			h.statePath,
		]);
		expectStatus(rUnavail, 2);
		expect(rUnavail.stdout.trim()).toBe("DIALOG-WATCH unavailable");
		const errLines = rUnavail.stderr.trim().split("\n").filter(Boolean);
		// 2개 대상 × 3회 연속 폴링 = 6줄의 stderr 오류 기록
		expect(errLines.length).toBe(6);

		h.assertReadOnlyHerdrCalls();
	});

	test("7. (#60 2회차) idle 상태의 Codex 신뢰 창·worktree 선택창(1번·2번 선택)·모르는 번호 목록 판정", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);

		h.setAgent(MATE_NAME, { mode: "not_found" });

		// (a) idle 상태의 Codex 신뢰 창 -> codex-trust
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "idle",
			state_change_seq: 1,
			screen: SCREEN_CODEX_TRUST,
		});
		const rTrust = h.runSync(["--once", "--state", h.statePath]);
		expect(rTrust.status).toBe(10);
		expect(rTrust.stdout.trim()).toBe(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} codex-trust Trust this folder? (1. Trust and continue / 2. Back to Agent Command Center)`,
		);

		// (b) 새 사실 4 규칙: 제목 줄이 잘렸어도 마지막 0번째 칸 › N. 줄부터 끝까지 Trust가 있으면 codex-trust
		const screenTrustMinimal = `› 1. Trust this directory and continue
  2. Quit

  enter continue · esc back
`;
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "idle",
			state_change_seq: 2,
			screen: screenTrustMinimal,
		});
		const rTrustMin = h.runSync(["--once", "--state", h.statePath]);
		expect(rTrustMin.status).toBe(10);
		expect(rTrustMin.stdout.trim()).toContain(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} codex-trust`,
		);

		// (c) worktree 선택창 (idle, 1번 선택) -> codex-worktree
		const screenWorktreePick1 = `Where should the new conversation run?

› 1. Use current Git worktree
  2. Create a new Git worktree

  enter select · esc back
`;
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "idle",
			state_change_seq: 3,
			screen: screenWorktreePick1,
		});
		const rWt1 = h.runSync(["--once", "--state", h.statePath]);
		expect(rWt1.status).toBe(10);
		expect(rWt1.stdout.trim()).toBe(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} codex-worktree Where should the new conversation run? (선택: 1. Use current Git worktree)`,
		);

		// (d) worktree 선택창 (idle, 2번 선택, 좁은 pane에서 제목이 접힌 꼴) -> codex-worktree
		const screenWorktreePick2 = `Where should the new
conversation run?

  1. Use current Git worktree
› 2. Create a new Git worktree

  enter select · esc back
`;
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "idle",
			state_change_seq: 4,
			screen: screenWorktreePick2,
		});
		const rWt2 = h.runSync(["--once", "--state", h.statePath]);
		expect(rWt2.status).toBe(10);
		expect(rWt2.stdout.trim()).toBe(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} codex-worktree Where should the new conversation run? (선택: 2. Create a new Git worktree)`,
		);

		// (e) 모르는 Codex 번호 목록 (예: 로그인 선택 화면 등) -> codex-menu
		const screenCodexMenu = `Sign in to continue

› 1. Sign in with ChatGPT
  2. Provide API key manually

  enter select · esc back
`;
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "idle",
			state_change_seq: 5,
			screen: screenCodexMenu,
		});
		const rMenu = h.runSync(["--once", "--state", h.statePath]);
		expect(rMenu.status).toBe(10);
		expect(rMenu.stdout.trim()).toBe(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} codex-menu 선택지 2개`,
		);

		h.assertReadOnlyHerdrCalls();
	});

	test("8. (#60 2회차) agy 편집 확인(agy-confirm)·인증 오류(auth-error)·첫 관측 idle 창 감지", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);

		h.setAgent(CRITIC_NAME, { mode: "not_found" });

		// (a) agy 편집 확인: 실제 원문이 없으니 꼴만 맞춘 예 (제목 Create file, 선택지 1. Yes ... No, cancel, ↑/↓ Navigate 안내)
		const screenAgyConfirm = `Create file
   /Users/secret/project/src/new-feature.ts

> 1. Yes, create file
  2. Yes, allow all file edits in this session
  3. No, cancel

  ↑/↓ Navigate · enter Confirm
esc to cancel                      Gemini 4 Argon · high · AI: 939
`;
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "blocked",
			state_change_seq: 1,
			screen: screenAgyConfirm,
		});
		const rConfirm = h.runSync(["--once", "--state", h.statePath]);
		expect(rConfirm.status).toBe(10);
		expect(rConfirm.stdout.trim()).toBe(
			`DIALOG ${MATE_NAME} ${MATE_PANE} agy-confirm Create file (선택지 3개)`,
		);
		expect(rConfirm.stdout).not.toContain("/Users/secret");

		// (b) done + 인증 오류 문구 (refresh token was already used / sign in again) -> auth-error
		const screenAuthErr1 = `Error: Your refresh token was already used.
Please re-authenticate.

› Ask Codex to do anything
  Context 100% left · 0 in · 0 out
`;
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "done",
			state_change_seq: 2,
			screen: screenAuthErr1,
		});
		const rAuth1 = h.runSync(["--once", "--state", h.statePath]);
		expect(rAuth1.status).toBe(10);
		expect(rAuth1.stdout.trim()).toBe(
			`DIALOG ${MATE_NAME} ${MATE_PANE} auth-error 인증 오류 (refresh token was already used)`,
		);

		const screenAuthErr2 = `Session expired: please Sign In Again to continue.
`;
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "done",
			state_change_seq: 3,
			screen: screenAuthErr2,
		});
		const rAuth2 = h.runSync(["--once", "--state", h.statePath]);
		expect(rAuth2.status).toBe(10);
		expect(rAuth2.stdout.trim()).toBe(
			`DIALOG ${MATE_NAME} ${MATE_PANE} auth-error 인증 오류 (sign in again)`,
		);

		// 상태가 blocked일 때는 auth-error가 아니라 question으로 판정
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "blocked",
			state_change_seq: 4,
			screen: screenAuthErr2,
		});
		const rAuthBlocked = h.runSync(["--once", "--state", h.statePath]);
		expect(rAuthBlocked.status).toBe(10);
		expect(rAuthBlocked.stdout.trim()).toContain(
			`DIALOG ${MATE_NAME} ${MATE_PANE} question`,
		);

		// (c) 첫 관측에서 이미 떠 있던 idle 창 감지 (상시 폴링 모드에서도 즉시 첫 폴링에 감지)
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "idle",
			state_change_seq: 1,
			screen: SCREEN_NORMAL_DONE,
		});
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "idle",
			state_change_seq: 1,
			screen: SCREEN_CODEX_TRUST,
		});
		const rFirstWatch = h.runSync([
			"--interval",
			"0.05",
			"--timeout",
			"15.0",
			"--state",
			h.statePath,
		]);
		expectStatus(rFirstWatch, 10);
		expect(rFirstWatch.stdout.trim()).toBe(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} codex-trust Trust this folder? (1. Trust and continue / 2. Back to Agent Command Center)`,
		);

		h.assertReadOnlyHerdrCalls();
	});

	test("9. (#60 2회차) 오탐 줄이기: 끝쪽 범위 밖(위쪽)의 옛 창 문구·인용된 sign in again 무시", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);

		h.setAgent(MATE_NAME, { mode: "not_found" });

		// (a) 위쪽 scrollback에 옛 Run this command?, Where should, Trust가 있고 아래쪽 15줄은 정상 출력 + 빈 입력란인 idle 화면 -> 알림 없음
		const oldDialogsAboveIdlePrompt = [
			"Where should the new conversation run?",
			"› 1. Use current Git worktree",
			"  2. Create new Git worktree",
			"enter select · esc back",
			"Trust this folder? Codex can read, edit, and run files here.",
			"› 1. Trust and continue",
			"Requesting permission for:",
			"   echo old-command",
			"Run this command?",
			"> 1. Yes, run command",
			"  4. No, cancel",
			"  ↑/↓ Navigate · enter Confirm",
			"--- normal conversation output below (16 lines) ---",
			"Line 01: Checked repository status.",
			"Line 02: Updated configuration parser.",
			"Line 03: Added unit test cases.",
			"Line 04: Verified edge cases.",
			"Line 05: All checks passed.",
			"Line 06: No warnings found.",
			"Line 07: Clean working tree.",
			"Line 08: Ready for review.",
			"Line 09: Summary written to result file.",
			"Line 10: Done.",
			"",
			"› Ask Codex to do anything",
			"  Context 96% left · 1.2K in · 340 out",
			"  ? for shortcuts",
		].join("\n");

		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "idle",
			state_change_seq: 10,
			screen: oldDialogsAboveIdlePrompt,
		});
		const rOld = h.runSync(["--once", "--state", h.statePath]);
		expect(rOld.status).toBe(0);
		expect(rOld.stdout.trim()).toBe("none");

		// (b) 대화 본문 위쪽(끝쪽 범위 밖)에 "sign in again" 및 "refresh token was already used"가 인용된 경우 -> 알림 없음
		const quotedAuthAboveNormal = [
			'User asked: why did the log mention "sign in again" and "refresh token was already used"?',
			"Answer: That message appears when an OAuth token is rotated.",
			"Line 01: Explanation detail 1.",
			"Line 02: Explanation detail 2.",
			"Line 03: Explanation detail 3.",
			"Line 04: Explanation detail 4.",
			"Line 05: Explanation detail 5.",
			"Line 06: Explanation detail 6.",
			"Line 07: Explanation detail 7.",
			"Line 08: Explanation detail 8.",
			"Line 09: Explanation detail 9.",
			"Line 10: Explanation detail 10.",
			"Line 11: Explanation detail 11.",
			"Line 12: Explanation detail 12.",
			"Line 13: Explanation detail 13.",
			"Line 14: Explanation detail 14.",
			"› Ask Codex to do anything",
			"  Context 92% left · 2.1K in · 520 out",
			"  ? for shortcuts",
		].join("\n");

		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "done",
			state_change_seq: 11,
			screen: quotedAuthAboveNormal,
		});
		const rQuoted = h.runSync(["--once", "--state", h.statePath]);
		expect(rQuoted.status).toBe(0);
		expect(rQuoted.stdout.trim()).toBe("none");

		h.assertReadOnlyHerdrCalls();
	});

	test("10. (#60 4·5회차) working 중 --source visible 조회·agent read 실패 시 unavailable 미집계·R1 auth-error 오탐/JSON 경로 좁히기·R2 자유 텍스트 미노출·빈 visible 화면 재시도·P3 마감", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);

		// (A-1·A-3) 가짜 herdr가 working 상태에서 --source recent-unwrapped를 agent_not_idle(rc 1)로 거부하는지 직접 확인
		h.setAgent(MATE_NAME, { mode: "not_found" });
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "working",
			state_change_seq: 1,
			screen: SCREEN_NORMAL_DONE,
		});
		const rejectRecent = spawnSync(
			path.join(h.binDir, "herdr"),
			["agent", "read", CRITIC_NAME, "--source", "recent-unwrapped", "--lines", "40"],
			{ encoding: "utf8", timeout: 5_000 },
		);
		expect(rejectRecent.status).toBe(1);
		expect(rejectRecent.stderr).toContain('"code":"agent_not_idle"');
		h.clearHerdrCalls();

		// dialog-watch.py는 --source visible을 써서 working 중에도 끝나지 않고 계속 돌며, 화면에 창이 있으면 판정한다
		const rWorkingWatch = h.runSync([
			"--names",
			CRITIC_NAME,
			"--interval",
			"0.02",
			"--timeout",
			"0.45",
			"--state",
			h.statePath,
		]);
		expectStatus(rWorkingWatch, 0);
		expect(rWorkingWatch.stdout.trim()).toBe("DIALOG-WATCH timeout");
		expect(rWorkingWatch.stderr).toBe("");
		const workingCalls = h.readHerdrCalls();
		expect(
			workingCalls.some((c) => c === `agent read ${CRITIC_NAME} --source visible`),
		).toBe(true);
		expect(
			workingCalls.some((c) => c.includes("recent-unwrapped")),
		).toBe(false);

		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "working",
			state_change_seq: 2,
			screen: SCREEN_CODEX_TRUST,
		});
		const rWorkingJudge = h.runSync(["--once", "--state", h.statePath]);
		expectStatus(rWorkingJudge, 10);
		expect(rWorkingJudge.stdout.trim()).toContain(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} codex-trust`,
		);

		// (A-2) agent get은 되는데 agent read만 실패하면 unavailable(rc 2)로 세지 않고 stderr 한 줄만 남긴 뒤 다음 주기에 다시 본다.
		//       agent_not_idle 오류 code면 조용히 건너뛴다.
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "blocked",
			state_change_seq: 3,
			screen: SCREEN_CODEX_TRUST,
			readNotIdle: true,
		});
		const rNotIdle = h.runSync([
			"--names",
			CRITIC_NAME,
			"--interval",
			"0.01",
			"--timeout",
			"0.45",
			"--state",
			h.statePath,
		]);
		expectStatus(rNotIdle, 0);
		expect(rNotIdle.stdout.trim()).toBe("DIALOG-WATCH timeout");
		expect(rNotIdle.stderr).toBe("");

		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "blocked",
			state_change_seq: 4,
			screen: SCREEN_CODEX_TRUST,
			readFail: true,
		});
		const rReadFailOnly = h.runSync([
			"--names",
			CRITIC_NAME,
			"--interval",
			"0.01",
			"--timeout",
			"0.80",
			"--state",
			h.statePath,
		]);
		expectStatus(rReadFailOnly, 0);
		expect(rReadFailOnly.stdout.trim()).toBe("DIALOG-WATCH timeout");
		const readFailErrLines = rReadFailOnly.stderr.trim().split("\n").filter(Boolean);
		expect(readFailErrLines.length).toBeGreaterThanOrEqual(3);

		// (B-1: 필수 R1 & 5회차 항목 1) 끝 15줄 안의 평문 인용·평문 앞뒤에 JSON이 낀 인용·error 필드가 없는 JSON 줄 -> 알림 없음
		const inWindowQuotedAuth = [
			"검토 결과: sign in again 문구를 단독 검색하면 오탐이다.",
			"또한 refresh token was already used 문구도 일반 본문 인용이면 무시해야 한다.",
			'검토 예시: {"message":"sign in again"}는 안내 문구이며 오류가 아니다.',
			'검토 예시: {"error":{"code":"auth_failed","message":"sign in again"}}는 평문 앞뒤에 낀 인용이다.',
			'{"message":"sign in again"}',
			'{"code":"info","message":"refresh token was already used"}',
			"› Ask Codex to do anything",
			"  Context 98% left · 400 in · 120 out",
		].join("\n");
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "done",
			state_change_seq: 5,
			screen: inWindowQuotedAuth,
		});
		const rQuotedInWindow = h.runSync(["--once", "--state", h.statePath]);
		expectStatus(rQuotedInWindow, 0);
		expect(rQuotedInWindow.stdout.trim()).toBe("none");

		// 줄머리가 Error:/■/⚠ 또는 줄 전체가 파싱되는 JSON의 error 객체·문자열인 행은 정상 감지
		for (const [idx, errScreen] of [
			"Error: Your refresh token was already used.\n",
			"■ Your refresh token was already used.\n",
			"⚠ Please sign in again to continue.\n",
			'  {"error":{"code":"auth_failed","message":"Please sign in again"}}  \n',
			'{"error":"Your refresh token was already used."}\n',
		].entries()) {
			h.setAgent(CRITIC_NAME, {
				mode: "ok",
				pane_id: CRITIC_PANE,
				agent_status: "done",
				state_change_seq: 10 + idx,
				screen: errScreen,
			});
			const rErrLine = h.runSync(["--once", "--state", h.statePath]);
			expectStatus(rErrLine, 10);
			expect(rErrLine.stdout.trim()).toContain(
				`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} auth-error`,
			);
		}

		// (5회차 항목 3: 빈 visible 화면)
		// (a) blocked여도 빈 화면(또는 공백뿐인 화면)이면 question을 내지 않고 관측 실패로 다룬다
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "blocked",
			state_change_seq: 18,
			screen: "   \n  \t  \n",
		});
		const rEmptyBlockedOnce = h.runSync(["--once", "--state", h.statePath]);
		expectStatus(rEmptyBlockedOnce, 0);
		expect(rEmptyBlockedOnce.stdout.trim()).toBe("none");

		// (b) 빈 화면(emptyReadOnce=true) 다음에 같은 state_change_seq로 정상 창이 나오면 seq를 소비하지 않았으므로 다음 주기에 읽어서 알린다(rc 10)
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "idle",
			state_change_seq: 19,
			revision: 1,
			screen: SCREEN_CODEX_TRUST,
			emptyReadOnce: true,
		});
		h.clearHerdrCalls();
		const rEmptyThenDialog = h.runSync([
			"--names",
			CRITIC_NAME,
			"--interval",
			"0.03",
			"--timeout",
			"15.0",
			"--state",
			h.statePath,
		]);
		expectStatus(rEmptyThenDialog, 10);
		expect(rEmptyThenDialog.stdout.trim()).toContain(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} codex-trust`,
		);
		const emptyRetryCalls = h.readHerdrCalls().filter(
			(c) => c === `agent read ${CRITIC_NAME} --source visible`,
		);
		expect(emptyRetryCalls.length).toBe(2);

		// (B-2: 필수 R2) question·codex-menu·agy-confirm 각각에서 합성 비밀(DEMO_PRIVATE_VALUE)과 세션 식별자(DEMO_SESSION_ID)가 stdout과 상태 파일에 모두 없는지 확인
		const secretQuestionScreen = `Select credential to use:
> 1. password: DEMO_PRIVATE_VALUE
  2. session: DEMO_SESSION_ID
`;
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "blocked",
			state_change_seq: 20,
			screen: secretQuestionScreen,
		});
		const rSecQ = h.runSync([
			"--names",
			CRITIC_NAME,
			"--interval",
			"0.05",
			"--timeout",
			"15.0",
			"--state",
			h.statePath,
		]);
		expectStatus(rSecQ, 10);
		expect(rSecQ.stdout.trim()).toBe(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} question 선택지 2개`,
		);
		const stateAfterQ = fs.readFileSync(h.statePath, "utf8");
		for (const text of [rSecQ.stdout, stateAfterQ]) {
			expect(text).not.toContain("DEMO_PRIVATE_VALUE");
			expect(text).not.toContain("DEMO_SESSION_ID");
			expect(text).not.toContain("password");
		}

		const secretMenuScreen = `Choose account DEMO_SESSION_ID
› 1. password: DEMO_PRIVATE_VALUE
  2. session: DEMO_SESSION_ID
  enter select · esc back
`;
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "idle",
			state_change_seq: 21,
			screen: secretMenuScreen,
		});
		const rSecMenu = h.runSync([
			"--names",
			CRITIC_NAME,
			"--interval",
			"0.05",
			"--timeout",
			"15.0",
			"--state",
			h.statePath,
		]);
		expectStatus(rSecMenu, 10);
		expect(rSecMenu.stdout.trim()).toBe(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} codex-menu 선택지 2개`,
		);
		const stateAfterMenu = fs.readFileSync(h.statePath, "utf8");
		for (const text of [rSecMenu.stdout, stateAfterMenu]) {
			expect(text).not.toContain("DEMO_PRIVATE_VALUE");
			expect(text).not.toContain("DEMO_SESSION_ID");
			expect(text).not.toContain("password");
		}

		const secretConfirmUnknownTitle = `Custom header DEMO_SESSION_ID
> 1. password: DEMO_PRIVATE_VALUE
  2. session: DEMO_SESSION_ID
  3. No, cancel
  ↑/↓ Navigate · enter Confirm
`;
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "blocked",
			state_change_seq: 22,
			screen: secretConfirmUnknownTitle,
		});
		const rSecConfirm = h.runSync([
			"--names",
			CRITIC_NAME,
			"--interval",
			"0.05",
			"--timeout",
			"15.0",
			"--state",
			h.statePath,
		]);
		expectStatus(rSecConfirm, 10);
		expect(rSecConfirm.stdout.trim()).toBe(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} agy-confirm 확인창(선택지 3개)`,
		);
		const stateAfterConfirm = fs.readFileSync(h.statePath, "utf8");
		for (const text of [rSecConfirm.stdout, stateAfterConfirm]) {
			expect(text).not.toContain("DEMO_PRIVATE_VALUE");
			expect(text).not.toContain("DEMO_SESSION_ID");
			expect(text).not.toContain("Custom header");
		}

		// (B-4: 제안 P3) 정상 입력란 위(15줄 안)에 옛 "Run this command?" 블록이 인용된 idle 화면 -> 알림 없음 (agy 빈 '>' 입력란 및 Codex '›' 입력란 각각)
		const quotedCmdAboveAgyIdle = [
			"Run this command?",
			"> 1. Yes, run command",
			"  4. No, cancel",
			"  ↑/↓ Navigate · enter Confirm",
			"Previous command was cancelled.",
			">",
			"  accept-edits · shift+tab to cycle mode",
		].join("\n");
		h.setAgent(MATE_NAME, {
			mode: "ok",
			pane_id: MATE_PANE,
			agent_status: "idle",
			state_change_seq: 30,
			screen: quotedCmdAboveAgyIdle,
		});
		h.setAgent(CRITIC_NAME, { mode: "not_found" });
		const rAgyIdleAbove = h.runSync(["--once", "--state", h.statePath]);
		expectStatus(rAgyIdleAbove, 0);
		expect(rAgyIdleAbove.stdout.trim()).toBe("none");

		const quotedCmdAboveCodexIdle = [
			"Run this command?",
			"> 1. Yes, run command",
			"  4. No, cancel",
			"  ↑/↓ Navigate · enter Confirm",
			"› Ask Codex to do anything",
			"  Context 95% left · 500 in · 100 out",
		].join("\n");
		h.setAgent(MATE_NAME, { mode: "not_found" });
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "idle",
			state_change_seq: 31,
			screen: quotedCmdAboveCodexIdle,
		});
		const rCodexIdleAbove = h.runSync(["--once", "--state", h.statePath]);
		expectStatus(rCodexIdleAbove, 0);
		expect(rCodexIdleAbove.stdout.trim()).toBe("none");

		// (B-4: 제안 P3) 상태 파일 저장 실패 시 stderr에 고정 진단 한 줄 출력 (경로·원문 미포함)
		const blockerFile = path.join(h.tmpDir, "SECRET_STATE_PARENT_FILE");
		fs.writeFileSync(blockerFile, "not a directory", "utf8");
		const invalidStatePath = path.join(blockerFile, "dialog-watch.state");
		h.setAgent(CRITIC_NAME, {
			mode: "ok",
			pane_id: CRITIC_PANE,
			agent_status: "blocked",
			state_change_seq: 32,
			screen: SCREEN_CODEX_TRUST,
		});
		const rStateFail = h.runSync([
			"--names",
			CRITIC_NAME,
			"--interval",
			"0.05",
			"--timeout",
			"15.0",
			"--state",
			invalidStatePath,
		]);
		expectStatus(rStateFail, 10);
		expect(rStateFail.stdout.trim()).toContain(
			`DIALOG ${CRITIC_NAME} ${CRITIC_PANE} codex-trust`,
		);
		expect(rStateFail.stderr.trim()).toBe(
			"dialog-watch: failed to write state file",
		);
		expect(rStateFail.stderr).not.toContain("SECRET_STATE_PARENT_FILE");

		// (B-4: 제안 P3) subprocess timeout 하한 0.1초 제거 결정적 검증 (rem=0.02 -> 0.02 전달, rem<=0 -> 미호출)
		const pyTimeoutFloorTest = spawnSync(
			REAL_PYTHON3,
			[
				"-B",
				"-c",
				`import importlib.util, json, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("dialog_watch", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

recorded_timeouts = []
def fake_fetch_info(name, cmd_timeout=10.0):
    recorded_timeouts.append(("info", round(cmd_timeout, 6)))
    return ("ok", {"pane_id": "w1:p2", "agent_status": "idle", "state_change_seq": 1, "revision": 1}, "")

def fake_fetch_screen(name, cmd_timeout=10.0):
    recorded_timeouts.append(("screen", round(cmd_timeout, 6)))
    return ("ok", "normal\\n>\\n", "")

mod.fetch_agent_info = fake_fetch_info
mod.fetch_agent_screen = fake_fetch_screen

# Case 1: rem = 0.02 (< 0.1) for info & screen, then expires before sleep
times = iter([100.0, 100.0, 100.0, 100.08, 100.08, 100.12])
mod.time.monotonic = lambda: next(times, 100.20)
rc1 = mod.main(["--names", "gjc-herdr-mate", "--timeout", "0.10", "--interval", "0.05"])

# Case 2: rem <= 0 immediately -> 0 calls
before_cnt = len(recorded_timeouts)
times2 = iter([200.0, 200.5, 200.5])
mod.time.monotonic = lambda: next(times2, 200.5)
rc2 = mod.main(["--names", "gjc-herdr-mate", "--timeout", "0.10", "--interval", "0.05"])
after_cnt = len(recorded_timeouts)

print(json.dumps({
    "rc1": rc1,
    "rc2": rc2,
    "recorded_timeouts": recorded_timeouts,
    "zero_calls_when_expired": (after_cnt == before_cnt),
}))
`,
				DIALOG_WATCH_PY,
			],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
				timeout: 5_000,
			},
		);
		expect(pyTimeoutFloorTest.status).toBe(0);
		const tfOut = JSON.parse(
			pyTimeoutFloorTest.stdout.trim().split("\n").pop() ?? "{}",
		) as {
			rc1: number;
			rc2: number;
			recorded_timeouts: Array<[string, number]>;
			zero_calls_when_expired: boolean;
		};
		expect(tfOut.rc1).toBe(0);
		expect(tfOut.rc2).toBe(0);
		expect(tfOut.recorded_timeouts).toEqual([
			["info", 0.02],
			["screen", 0.02],
		]);
		expect(tfOut.zero_calls_when_expired).toBe(true);

		h.assertReadOnlyHerdrCalls();
	});

	test("18. (#80) docs/dev-environment.md '알려진 확인창 글자' 표의 화면 글자 열이 scripts/dialog-watch.py 판정 정규식 상수와 양방향 일치(거짓 통과 방지 검증 포함)", () => {
		const docPath = path.join(REPO_ROOT, "docs", "dev-environment.md");
		const docText = fs.readFileSync(docPath, "utf8");

		// 확인용 사본 1: 표 글자를 바꾼 메모리 내 문자열 사본
		const mutatedPhraseDoc = docText.replace(
			"`Run this command?`",
			"`Execute this shell line?`",
		);
		expect(mutatedPhraseDoc).not.toBe(docText);

		// 확인용 사본 2: 두 종류(agy-trust와 codex-trust)의 화면 글자를 서로 바꾼 메모리 내 문자열 사본
		const agyTrustCell = "`Do you trust the contents of this project?`";
		const codexTrustCell = "`Trust this folder?` · `Trust and continue`";
		const swappedKindsDoc = docText
			.replace(agyTrustCell, "__SWAP_PLACEHOLDER__")
			.replace(codexTrustCell, agyTrustCell)
			.replace("__SWAP_PLACEHOLDER__", codexTrustCell);
		expect(swappedKindsDoc).not.toBe(docText);

		const pyVerify = spawnSync(
			REAL_PYTHON3,
			[
				"-c",
				`import importlib.util, json, re, sys

mod_path = sys.argv[1]
payload = json.loads(sys.stdin.read())

spec = importlib.util.spec_from_file_location("dialog_watch", mod_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

EXPECTED_KINDS = [
    "agy-trust",
    "agy-command",
    "agy-editor",
    "agy-confirm",
    "codex-trust",
    "codex-worktree",
    "codex-menu",
    "auth-error",
    "question",
]

KIND_CONSTS = {
    "agy-trust": ["AGY_TRUST_RE"],
    "agy-command": ["REQ_PERM_RE", "RUN_THIS_CMD_RE", "NO_CANCEL_RE", "NAVIGATE_RE"],
    "agy-editor": ["FULL_COMMAND_RE", "ENTER_CONFIRM_RE", "CTRL_G_EXPAND_RE"],
    "agy-confirm": ["NO_CANCEL_RE", "NAVIGATE_RE"],
    "codex-trust": ["TRUST_FOLDER_RE", "TRUST_CONTINUE_RE"],
    "codex-worktree": ["WHERE_SHOULD_RE"],
    "auth-error": ["AUTH_ERROR_RE"],
}

NON_LITERAL_KINDS = {
    "codex-menu": "마지막 입력란 줄이 \`› 1. …\` 꼴",
    "question": "(blocked일 때만)",
}

def verify_doc_table(doc_text: str):
    m = re.search(r"### 알려진 확인창 글자\\s*\\n([\\s\\S]*?)(?=\\n## |\\n### |$)", doc_text)
    if not m:
        return {"ok": False, "reason": "missing_section"}
    body = m.group(1)
    if "판정은 \`scripts/dialog-watch.py\`이며, 판정 글자를 바꾸면 이 표도 함께 고친다." not in body:
        return {"ok": False, "reason": "missing_note"}

    table_lines = [
        ln.strip()
        for ln in body.splitlines()
        if ln.strip().startswith("|") and ln.strip().endswith("|")
    ]
    if len(table_lines) < 3:
        return {"ok": False, "reason": "no_table_rows"}

    header_cols = [c.strip() for c in table_lines[0][1:-1].split("|")]
    if header_cols != ["종류", "도구", "화면 글자", "누가 답하는가"]:
        return {"ok": False, "reason": f"bad_header:{header_cols}"}

    rows = [
        [c.strip() for c in ln[1:-1].split("|")]
        for ln in table_lines[2:]
    ]
    if any(len(r) != 4 for r in rows):
        return {"ok": False, "reason": "bad_col_count"}

    seen_kinds = [r[0].strip("\`") for r in rows]
    if seen_kinds != EXPECTED_KINDS:
        return {"ok": False, "reason": f"kinds_mismatch:{seen_kinds}"}

    for cols in rows:
        kind = cols[0].strip("\`")
        screen_cell = cols[2]
        if kind in NON_LITERAL_KINDS:
            if screen_cell != NON_LITERAL_KINDS[kind]:
                return {"ok": False, "reason": f"non_literal_mismatch:{kind}:{screen_cell}"}
            continue

        const_names = KIND_CONSTS.get(kind)
        if not const_names:
            return {"ok": False, "reason": f"unknown_kind:{kind}"}

        phrases = re.findall(r"\`([^\`]+)\`", screen_cell)
        if not phrases:
            return {"ok": False, "reason": f"empty_phrases:{kind}"}

        consts = [(cname, getattr(mod, cname)) for cname in const_names]

        # 방향 1: 표의 각 글자가 그 종류의 상수 가운데 하나에 search로 맞아야 함
        for p in phrases:
            if not any(cre.search(p) is not None for _, cre in consts):
                return {"ok": False, "reason": f"phrase_unmatched:{kind}:{p}"}

        # 방향 2: 각 상수는 표의 그 종류 글자 가운데 적어도 하나에 search로 맞아야 함
        for cname, cre in consts:
            if not any(cre.search(p) is not None for p in phrases):
                return {"ok": False, "reason": f"const_unmatched:{kind}:{cname}"}

    return {"ok": True}

print(json.dumps({
    "real": verify_doc_table(payload["real"]),
    "mutated_phrase": verify_doc_table(payload["mutated_phrase"]),
    "swapped_kinds": verify_doc_table(payload["swapped_kinds"]),
}))
`,
				DIALOG_WATCH_PY,
			],
			{
				cwd: REPO_ROOT,
				input: JSON.stringify({
					real: docText,
					mutated_phrase: mutatedPhraseDoc,
					swapped_kinds: swappedKindsDoc,
				}),
				encoding: "utf8",
				env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
				timeout: 10_000,
			},
		);

		expect(pyVerify.status).toBe(0);
		const result = JSON.parse(pyVerify.stdout.trim()) as {
			real: { ok: boolean; reason?: string };
			mutated_phrase: { ok: boolean; reason?: string };
			swapped_kinds: { ok: boolean; reason?: string };
		};
		expect(result.real).toEqual({ ok: true });
		expect(result.mutated_phrase.ok).toBe(false);
		expect(result.mutated_phrase.reason).toContain("agy-command");
		expect(result.swapped_kinds.ok).toBe(false);
	});
});
