import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = fs.realpathSync(path.resolve(import.meta.dir, ".."));
const MATE_WATCH_SH = path.join(REPO_ROOT, "scripts", "mate-watch.sh");

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
const MATE_PANE = "w1:p2";

// test/dialog-watch.test.ts의 기존 확인창 사례 및 보통 화면
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

const SCREEN_NORMAL_DONE = `Completed task verification.
All 12 unit tests passed.

❯
`;

interface RunMateWatchOptions {
	args: string[];
	agentStatus?: string;
	screen?: string;
	resultContent?: string;
	writeResultOnFirstRead?: string;
	intervalSec?: number | string;
	cwd?: string;
}

function runMateWatch(options: RunMateWatchOptions): {
	status: number | null;
	stdout: string;
	stderr: string;
	calls: string[];
} {
	const rawTmp = fs.mkdtempSync("/tmp/gjch-t-mate-watch-");
	const tmpDir = fs.realpathSync(rawTmp);
	try {
		const binDir = path.join(tmpDir, "bin");
		const homeDir = path.join(tmpDir, "home");
		const logPath = path.join(tmpDir, "herdr-calls.log");
		const agentJsonPath = path.join(tmpDir, "mate-agent.json");
		const screenPath = path.join(tmpDir, "mate-screen.txt");
		const resultPath = path.join(tmpDir, "result.md");
		const delayedContentPath = path.join(tmpDir, "delayed-result.md");

		fs.mkdirSync(binDir, { recursive: true });
		fs.mkdirSync(homeDir, { recursive: true });
		fs.symlinkSync(REAL_PYTHON3, path.join(binDir, "python3"));

		const agentPayload = {
			result: {
				agent: {
					name: MATE_NAME,
					pane_id: MATE_PANE,
					agent_status: options.agentStatus ?? "idle",
					state_change_seq: 1,
					revision: 1,
					focused: false,
				},
			},
		};
		fs.writeFileSync(agentJsonPath, JSON.stringify(agentPayload), "utf8");
		fs.writeFileSync(screenPath, options.screen ?? SCREEN_NORMAL_DONE, "utf8");
		if (options.resultContent !== undefined) {
			fs.writeFileSync(resultPath, options.resultContent, "utf8");
		}
		if (options.writeResultOnFirstRead !== undefined) {
			fs.writeFileSync(delayedContentPath, options.writeResultOnFirstRead, "utf8");
		}

		const fakeHerdr = `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}
case "$1 $2" in
	"agent get")
		if [ "\${3:-}" != ${JSON.stringify(MATE_NAME)} ]; then
			printf '{"error":{"code":"agent_not_found","message":"not found"}}\\n' >&2
			exit 1
		fi
		cat ${JSON.stringify(agentJsonPath)}
		printf '\\n'
		exit 0
		;;
	"agent read")
		if [ "\${3:-}" != ${JSON.stringify(MATE_NAME)} ]; then
			printf 'read error\\n' >&2
			exit 1
		fi
		if [ -f ${JSON.stringify(delayedContentPath)} ] && [ ! -f ${JSON.stringify(resultPath)} ]; then
			cp ${JSON.stringify(delayedContentPath)} ${JSON.stringify(resultPath)}
		fi
		cat ${JSON.stringify(screenPath)}
		exit 0
		;;
	*)
		printf 'unexpected or mutating herdr command: %s\\n' "$*" >&2
		exit 99
		;;
esac
`;
		const herdrBin = path.join(binDir, "herdr");
		fs.writeFileSync(herdrBin, fakeHerdr, "utf8");
		fs.chmodSync(herdrBin, 0o755);

		const relResultPath = path.relative(REPO_ROOT, resultPath);
		const resolvedArgs = options.args.map((arg) => {
			if (arg === "__RESULT_FILE__") return resultPath;
			if (arg === "__REL_RESULT_FILE__") return relResultPath;
			return arg;
		});

		const env: NodeJS.ProcessEnv = {
			...process.env,
			PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
			HOME: homeDir,
			PYTHONDONTWRITEBYTECODE: "1",
			PYTHONNOUSERSITE: "1",
			GJCH_MATE_NAME: MATE_NAME,
			...(options.intervalSec !== undefined
				? { GJCH_MATE_WATCH_INTERVAL: String(options.intervalSec) }
				: {}),
		};

		const proc = spawnSync("/bin/bash", [MATE_WATCH_SH, ...resolvedArgs], {
			cwd: options.cwd ?? REPO_ROOT,
			env,
			encoding: "utf8",
			timeout: 15_000,
		});

		const calls = fs.existsSync(logPath)
			? fs
					.readFileSync(logPath, "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
			: [];

		return {
			status: proc.status,
			stdout: proc.stdout ?? "",
			stderr: proc.stderr ?? "",
			calls,
		};
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

describe("scripts/mate-watch.sh (#79)", () => {
	test("(a) 결과 파일에 완료 줄이 생기면 rc 0·DONE <HH:MM:SS>", () => {
		const res = runMateWatch({
			args: ["__RESULT_FILE__", "#79 1회차 완료", "5"],
			resultContent: "작업 요약\n#79 1회차 완료\n",
			intervalSec: 1,
		});
		expect(res.status).toBe(0);
		expect(res.stdout.trim()).toMatch(/^DONE \d{2}:\d{2}:\d{2}$/);
	});

	test("(b) 화면에 알려진 확인창 글자를 주면 실제 dialog-watch.py를 거쳐 rc 10·DIALOG 줄 + 시각", () => {
		const res = runMateWatch({
			args: ["__RESULT_FILE__", "#79 1회차 완료", "5"],
			agentStatus: "blocked",
			screen: SCREEN_AGY_COMMAND_SHORT,
			intervalSec: 1,
		});
		expect(res.status).toBe(10);
		expect(res.stdout.trim()).toMatch(
			/^DIALOG gjc-herdr-mate w1:p2 agy-command cmd=echo chars=10 잘림=아니오 \(1\. Yes, run command \/ 4\. No, cancel\) \d{2}:\d{2}:\d{2}$/,
		);
		expect(res.calls).toContain("agent get gjc-herdr-mate");
		expect(res.calls).toContain("agent read gjc-herdr-mate --source visible");
	});

	test("(c) 시간 상한 2초·간격 1초에 아무 일 없으면 rc 1·TIMEOUT", () => {
		const res = runMateWatch({
			args: ["__RESULT_FILE__", "#79 1회차 완료", "2"],
			agentStatus: "working",
			screen: SCREEN_NORMAL_DONE,
			intervalSec: 1,
		});
		expect(res.status).toBe(1);
		expect(res.stdout.trim()).toBe("TIMEOUT");
	});

	test("(d) 인자 없거나 시간 상한이 범위 밖(0, 86401, 아주 긴 수)이면 rc 2와 사용법", () => {
		for (const badArgs of [
			[],
			["__RESULT_FILE__", "#79 1회차 완료", "0"],
			["__RESULT_FILE__", "#79 1회차 완료", "86401"],
			["__RESULT_FILE__", "#79 1회차 완료", "9999999999999999999999999"],
		]) {
			const res = runMateWatch({
				args: badArgs,
			});
			expect(res.status).toBe(2);
			expect(res.stderr).toContain("사용법:");
			expect(res.calls).toHaveLength(0);
		}
	});

	test("(e) 경계 사례: 감시 도중 결과 파일 생성, 저장소 기준 상대 경로, 정규식 특수문자가 든 완료 줄 고정 문자열 매칭", () => {
		// 1) 감시 도중 결과 파일이 생기는 흐름: 첫 폴링 시점에는 결과 파일이 없어 dialog-watch(agent get/read)가 1회 불리고, 그 도중 생성된 파일을 다음 폴링에서 감지
		const delayedRes = runMateWatch({
			args: ["__RESULT_FILE__", "#79 1회차 완료", "5"],
			agentStatus: "working",
			screen: SCREEN_NORMAL_DONE,
			writeResultOnFirstRead: "진행 후 작성됨\n#79 1회차 완료\n",
			intervalSec: 1,
		});
		expect(delayedRes.status).toBe(0);
		expect(delayedRes.stdout.trim()).toMatch(/^DONE \d{2}:\d{2}:\d{2}$/);
		expect(delayedRes.calls).toEqual([
			"agent get gjc-herdr-mate",
			"agent read gjc-herdr-mate --source visible",
		]);

		// 2) 저장소 기준 상대 경로(실행 cwd가 /tmp여도 저장소 루트 기준으로 해석) + 정규식 특수문자 완료 줄 고정 문자열 매칭
		const specialDoneLine = "#79 1회차 완료 (a.b*) [c+d?^$]";
		const regexOnlyMismatchRes = runMateWatch({
			args: ["__REL_RESULT_FILE__", specialDoneLine, "1"],
			resultContent: "#79 1회차 완료 (axbb) [c+d?^$]\n",
			intervalSec: 1,
			cwd: "/tmp",
		});
		expect(regexOnlyMismatchRes.status).toBe(1);
		expect(regexOnlyMismatchRes.stdout.trim()).toBe("TIMEOUT");

		const exactMatchRelRes = runMateWatch({
			args: ["__REL_RESULT_FILE__", specialDoneLine, "5"],
			resultContent: `본문\n${specialDoneLine}\n`,
			intervalSec: 1,
			cwd: "/tmp",
		});
		expect(exactMatchRelRes.status).toBe(0);
		expect(exactMatchRelRes.stdout.trim()).toMatch(/^DONE \d{2}:\d{2}:\d{2}$/);
	});

	test("(f) 범위 밖 간격(0, 3601, 아주 긴 수)은 기본값(20)으로 동작", () => {
		for (const badInterval of [
			"0",
			"3601",
			"9999999999999999999999999",
		]) {
			// 완료 줄이 있는 경우 오류 없이 즉시 DONE(rc 0)
			const doneRes = runMateWatch({
				args: ["__RESULT_FILE__", "#79 1회차 완료", "5"],
				resultContent: "#79 1회차 완료\n",
				intervalSec: badInterval,
			});
			expect(doneRes.status).toBe(0);
			expect(doneRes.stdout.trim()).toMatch(/^DONE \d{2}:\d{2}:\d{2}$/);
		}

		// 아주 긴 수가 오버플로우로 1초 간격 등이 되지 않고 기본값 20으로 폴백되어, 시간 상한 2초 동안 첫 폴링 1회만 호출되는지 확인
		const timeoutRes = runMateWatch({
			args: ["__RESULT_FILE__", "#79 1회차 완료", "2"],
			agentStatus: "working",
			screen: SCREEN_NORMAL_DONE,
			intervalSec: "9999999999999999999999999",
		});
		expect(timeoutRes.status).toBe(1);
		expect(timeoutRes.stdout.trim()).toBe("TIMEOUT");
		expect(
			timeoutRes.calls.filter((c) => c === "agent get gjc-herdr-mate"),
		).toHaveLength(1);
	});
});
