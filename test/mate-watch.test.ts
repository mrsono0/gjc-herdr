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
	statusByPoll?: string[];
	screen?: string;
	resultContent?: string;
	writeResultOnFirstRead?: string;
	writeResultOnPoll?: { poll: number; content: string };
	writeResultDuringGetPoll?: { pollIdx: number; content: string };
	intervalSec?: number | string;
	stallSec?: number | string;
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
		const statusListPath = path.join(tmpDir, "status-list.json");
		const pollIdxPath = path.join(tmpDir, "poll-idx");
		const screenPath = path.join(tmpDir, "mate-screen.txt");
		const resultPath = path.join(tmpDir, "result.md");
		const delayedContentPath = path.join(tmpDir, "delayed-result.md");
		const pollWriteContentPath = path.join(tmpDir, "poll-write-result.md");
		const pollWriteTargetIdx = options.writeResultOnPoll?.poll ?? 0;
		const getWriteContentPath = path.join(tmpDir, "get-write-result.md");
		const getWriteTargetIdx = options.writeResultDuringGetPoll?.pollIdx ?? -1;

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
		if (options.statusByPoll && options.statusByPoll.length > 0) {
			fs.writeFileSync(statusListPath, JSON.stringify(options.statusByPoll), "utf8");
			fs.writeFileSync(pollIdxPath, "0", "utf8");
		}
		fs.writeFileSync(screenPath, options.screen ?? SCREEN_NORMAL_DONE, "utf8");
		if (options.resultContent !== undefined) {
			fs.writeFileSync(resultPath, options.resultContent, "utf8");
		}
		if (options.writeResultOnFirstRead !== undefined) {
			fs.writeFileSync(delayedContentPath, options.writeResultOnFirstRead, "utf8");
		}
		if (options.writeResultOnPoll !== undefined) {
			fs.writeFileSync(pollWriteContentPath, options.writeResultOnPoll.content, "utf8");
		}
		if (options.writeResultDuringGetPoll !== undefined) {
			fs.writeFileSync(
				getWriteContentPath,
				options.writeResultDuringGetPoll.content,
				"utf8",
			);
		}

		const fakeHerdr = `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}
case "$1 $2" in
	"agent get")
		if [ "\${3:-}" != ${JSON.stringify(MATE_NAME)} ]; then
			printf '{"error":{"code":"agent_not_found","message":"not found"}}\\n' >&2
			exit 1
		fi
		if [ -f ${JSON.stringify(statusListPath)} ]; then
			idx="$(cat ${JSON.stringify(pollIdxPath)} 2>/dev/null || echo 0)"
			if [ "$idx" -eq ${JSON.stringify(String(getWriteTargetIdx))} ] && [ -f ${JSON.stringify(getWriteContentPath)} ] && [ ! -f ${JSON.stringify(resultPath)} ]; then
				cp ${JSON.stringify(getWriteContentPath)} ${JSON.stringify(resultPath)}
			fi
			python3 -c 'import json,sys
statuses=json.load(open(sys.argv[1],encoding="utf-8"))
try: idx=int(open(sys.argv[2],encoding="utf-8").read().strip() or "0")
except Exception: idx=0
st=statuses[idx] if idx<len(statuses) else statuses[-1]
if st=="__FAIL__":
    print(json.dumps({"error":{"code":"internal_error","message":"lookup failed"}}),file=sys.stderr)
    sys.exit(1)
doc=json.load(open(sys.argv[3],encoding="utf-8"))
doc["result"]["agent"]["agent_status"]=st
doc["result"]["agent"]["state_change_seq"]=idx+1
print(json.dumps(doc))' ${JSON.stringify(statusListPath)} ${JSON.stringify(pollIdxPath)} ${JSON.stringify(agentJsonPath)}
			exit $?
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
		if [ -f ${JSON.stringify(pollIdxPath)} ]; then
			idx="$(cat ${JSON.stringify(pollIdxPath)})"
			next_idx=$((idx + 1))
			printf '%s' "$next_idx" > ${JSON.stringify(pollIdxPath)}
			if [ "$next_idx" -eq ${JSON.stringify(String(pollWriteTargetIdx))} ] && [ -f ${JSON.stringify(pollWriteContentPath)} ]; then
				cp ${JSON.stringify(pollWriteContentPath)} ${JSON.stringify(resultPath)}
			fi
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
			...(options.stallSec !== undefined
				? { GJCH_MATE_WATCH_STALL: String(options.stallSec) }
				: {}),
		};

		const proc = spawnSync("/bin/bash", [MATE_WATCH_SH, ...resolvedArgs], {
			cwd: options.cwd ?? REPO_ROOT,
			env,
			encoding: "utf8",
			timeout: 20_000,
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

describe("scripts/mate-watch.sh (#79, #80)", () => {
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
		// 1) 감시 도중 결과 파일이 생기는 흐름: 첫 폴링 시점에는 결과 파일이 없어 상태 조회 + dialog-watch가 1회 불리고, 그 도중 생성된 파일을 다음 폴링에서 감지
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

		// 아주 긴 수가 오버플로우로 1초 간격 등이 되지 않고 기본값 20으로 폴백되어, 시간 상한 2초 동안 첫 폴링 1회만 수행되는지 확인
		const timeoutRes = runMateWatch({
			args: ["__RESULT_FILE__", "#79 1회차 완료", "2"],
			agentStatus: "working",
			screen: SCREEN_NORMAL_DONE,
			intervalSec: "9999999999999999999999999",
		});
		expect(timeoutRes.status).toBe(1);
		expect(timeoutRes.stdout.trim()).toBe("TIMEOUT");
		expect(
			timeoutRes.calls.filter((c) => c === "agent read gjc-herdr-mate --source visible"),
		).toHaveLength(1);
	});

	test("(g) #80 working 뒤 결과 없이 멈춤(NO_RESULT, rc 11): (1) working→done 유예 경과 시 rc 11, (2) 처음부터 idle만이면 TIMEOUT, (3) 유예 안 완료 줄 생성 시 rc 0, (4) working→idle→working 복귀 시 기억 해제 후 완료 줄 rc 0, (5) NO_RESULT 직전 완료 줄 재확인 rc 0, (6) 조회 실패 시 멈춤 시간 리셋", () => {
		// (1) working -> done이고 완료 줄이 없으며 GJCH_MATE_WATCH_STALL=1·간격 1 -> rc 11·NO_RESULT done <HH:MM:SS>
		const stallDoneRes = runMateWatch({
			args: ["__RESULT_FILE__", "#80 1회차 완료", "6"],
			statusByPoll: ["working", "done", "done"],
			intervalSec: 1,
			stallSec: 1,
		});
		expect(stallDoneRes.status).toBe(11);
		expect(stallDoneRes.stdout.trim()).toMatch(
			/^NO_RESULT done \d{2}:\d{2}:\d{2}$/,
		);

		// (2) 처음부터 idle만(working 없음) -> 신호 없음, 시간 상한까지 TIMEOUT(rc 1)
		const idleOnlyRes = runMateWatch({
			args: ["__RESULT_FILE__", "#80 1회차 완료", "2"],
			statusByPoll: ["idle", "idle", "idle"],
			intervalSec: 1,
			stallSec: 1,
		});
		expect(idleOnlyRes.status).toBe(1);
		expect(idleOnlyRes.stdout.trim()).toBe("TIMEOUT");

		// (3) working -> done 뒤 유예 안에 완료 줄이 생김 -> rc 0·DONE
		const doneWithinStallRes = runMateWatch({
			args: ["__RESULT_FILE__", "#80 1회차 완료", "6"],
			statusByPoll: ["working", "done", "done"],
			writeResultOnPoll: { poll: 2, content: "결과\n#80 1회차 완료\n" },
			intervalSec: 1,
			stallSec: 3,
		});
		expect(doneWithinStallRes.status).toBe(0);
		expect(doneWithinStallRes.stdout.trim()).toMatch(
			/^DONE \d{2}:\d{2}:\d{2}$/,
		);

		// (4) working -> idle -> working -> (유예 안) -> 완료 줄 -> rc 0 (다시 working이 되면 이전 idle 시각 기억이 지워짐)
		const resumedWorkingRes = runMateWatch({
			args: ["__RESULT_FILE__", "#80 1회차 완료", "8"],
			statusByPoll: ["working", "idle", "working", "idle", "idle"],
			writeResultOnPoll: { poll: 4, content: "결과\n#80 1회차 완료\n" },
			intervalSec: 1,
			stallSec: 2,
		});
		expect(resumedWorkingRes.status).toBe(0);
		expect(resumedWorkingRes.stdout.trim()).toMatch(
			/^DONE \d{2}:\d{2}:\d{2}$/,
		);

		// (5) #80 r2: 가짜 herdr의 agent get이 응답하기 전에 결과 파일에 완료 줄을 쓰는 사례(유예 1초) -> NO_RESULT 직전 완료 줄 재확인으로 rc 0
		const raceRecheckRes = runMateWatch({
			args: ["__RESULT_FILE__", "#80 1회차 완료", "6"],
			statusByPoll: ["working", "done", "done"],
			writeResultDuringGetPoll: {
				pollIdx: 2,
				content: "agent get 도중 작성됨\n#80 1회차 완료\n",
			},
			intervalSec: 1,
			stallSec: 1,
		});
		expect(raceRecheckRes.status).toBe(0);
		expect(raceRecheckRes.stdout.trim()).toMatch(
			/^DONE \d{2}:\d{2}:\d{2}$/,
		);

		// (6) #80 r2: working -> idle -> 조회 실패 여러 번(유예 1초보다 길게) -> done -> 곧바로 NO_RESULT가 나지 않고(해당 done 폴링에서 dialog-watch까지 진행) 유예를 다시 센 뒤에야 NO_RESULT가 남
		// 주의: 조회 실패(__FAIL__) 폴링에서는 dialog-watch.py가 agent read를 부르지 않으므로,
		// agent get 호출 시점마다 다음 상태로 넘어가도록 하기 위해 여기서는 agent get 단위로 전이하는 별도 검증을 수행한다.
	}, 45_000);

	test("(h) #80 r2: working → idle → 조회 실패 여러 번(유예보다 길게) → done → 곧바로 NO_RESULT가 나지 않고 유예를 다시 센 뒤에야 rc 11", () => {
		const rawTmp = fs.mkdtempSync("/tmp/gjch-t-mate-watch-fail-");
		const tmpDir = fs.realpathSync(rawTmp);
		try {
			const binDir = path.join(tmpDir, "bin");
			const homeDir = path.join(tmpDir, "home");
			const resultPath = path.join(tmpDir, "result.md");
			const mwGetCountPath = path.join(tmpDir, "mw-get-count");
			const dwPhaseLogPath = path.join(tmpDir, "dw-phase.log");

			fs.mkdirSync(binDir, { recursive: true });
			fs.mkdirSync(homeDir, { recursive: true });
			fs.symlinkSync(REAL_PYTHON3, path.join(binDir, "python3"));

			// mate-watch.sh는 매 폴링마다 herdr agent get 1회 -> dialog-watch.py(agent get 1회 + 필요시 agent read 1회)를 부른다.
			// 폴링 1: working, 폴링 2: idle, 폴링 3: 조회 실패, 폴링 4: 조회 실패(유예 1초보다 긺), 폴링 5: done(새 유예 시작), 폴링 6: done(유예 1초 경과 -> NO_RESULT)
			// 매 폴링에서 mate-watch.sh의 첫 agent get과 dialog-watch.py의 두 번째 agent get이 있어, 호출 번호(1..12)에서 poll = (call_num + 1) / 2 로 폴링 번호를 계산한다.
			const fakeHerdr = `#!/bin/sh
case "$1 $2" in
	"agent get")
		cnt=0
		[ -f ${JSON.stringify(mwGetCountPath)} ] && cnt="$(cat ${JSON.stringify(mwGetCountPath)})"
		cnt=$((cnt + 1))
		printf '%s' "$cnt" > ${JSON.stringify(mwGetCountPath)}
		poll=$(( (cnt + 1) / 2 ))
		case "$poll" in
			1) st="working" ;;
			2) st="idle" ;;
			3|4)
				printf '{"error":{"code":"internal_error","message":"lookup failed"}}\\n' >&2
				exit 1
				;;
			*) st="done" ;;
		esac
		printf '{"result":{"agent":{"name":"gjc-herdr-mate","pane_id":"w1:p2","agent_status":"%s","state_change_seq":%d,"revision":1,"focused":false}}}\\n' "$st" "$poll"
		exit 0
		;;
	"agent read")
		cnt="$(cat ${JSON.stringify(mwGetCountPath)} 2>/dev/null || echo 0)"
		poll=$(( (cnt + 1) / 2 ))
		printf 'read_at_poll=%s\\n' "$poll" >> ${JSON.stringify(dwPhaseLogPath)}
		printf 'Completed.\\n❯\\n'
		exit 0
		;;
	*)
		exit 99
		;;
esac
`;
			const herdrBin = path.join(binDir, "herdr");
			fs.writeFileSync(herdrBin, fakeHerdr, "utf8");
			fs.chmodSync(herdrBin, 0o755);

			const proc = spawnSync(
				"/bin/bash",
				[MATE_WATCH_SH, resultPath, "#80 2회차 완료", "12"],
				{
					cwd: REPO_ROOT,
					env: {
						...process.env,
						PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
						HOME: homeDir,
						PYTHONDONTWRITEBYTECODE: "1",
						PYTHONNOUSERSITE: "1",
						GJCH_MATE_NAME: MATE_NAME,
						GJCH_MATE_WATCH_INTERVAL: "1",
						GJCH_MATE_WATCH_STALL: "1",
					},
					encoding: "utf8",
					timeout: 20_000,
				},
			);

			expect(proc.status).toBe(11);
			expect((proc.stdout ?? "").trim()).toMatch(
				/^NO_RESULT done \d{2}:\d{2}:\d{2}$/,
			);
			const readPhases = fs.existsSync(dwPhaseLogPath)
				? fs.readFileSync(dwPhaseLogPath, "utf8").trim().split("\n").filter(Boolean)
				: [];
			// 폴링 5(조회 실패 뒤 첫 done)에서 곧바로 NO_RESULT로 죽지 않고 dialog-watch(agent read)까지 실행된 뒤, 폴링 6에서 NO_RESULT로 끝났음을 확인
			expect(readPhases).toContain("read_at_poll=5");
			expect(readPhases).not.toContain("read_at_poll=6");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	}, 25_000);
});
