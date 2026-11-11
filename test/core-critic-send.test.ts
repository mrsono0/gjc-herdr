import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = fs.realpathSync(path.resolve(import.meta.dir, ".."));
const CRITIC_SEND_SH = path.join(REPO_ROOT, "scripts", "critic-send.sh");
const CORE_CRITIC_SEND_SH = path.join(REPO_ROOT, "scripts", "core-critic-send.sh");

const STRIPPED_ENV_KEYS = [
	"GJCH_CORE",
	"GJCH_CORE_TEAM",
	"GJCH_HC_BIN",
	"GJCH_CORE_DOWN_INTERVAL",
	"GJCH_CORE_DOWN_RETRIES",
	"GJCH_CRITIC_READY_INTERVAL",
	"GJCH_CRITIC_READY_RETRIES",
	"GJCH_CRITIC_WATCH_INTERVAL",
	"GJCH_EXTERNAL_LEAD",
	"HERDR_ENV",
	"HERDR_PANE_ID",
	"HERDR_WORKSPACE_ID",
	"CLAUDE_PROJECT_DIR",
	"GJCH_TEAM_ROLE",
	"GJCH_LEAD_LOCK",
	"PYTHONDONTWRITEBYTECODE",
	"CLAUDE_CODE_SESSION_ID",
	"CLAUDE_CODE_MESSAGING_SOCKET",
] as const;

function resolveRealBinary(name: string, candidates: string[]): string {
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			try {
				return fs.realpathSync(candidate);
			} catch {
				return candidate;
			}
		}
	}
	const res = spawnSync("/bin/sh", ["-c", `command -v ${name}`], {
		encoding: "utf8",
		timeout: 5_000,
	});
	const found = (res.stdout ?? "").trim();
	if (res.status === 0 && found) {
		try {
			return fs.realpathSync(found);
		} catch {
			return found;
		}
	}
	throw new Error(`Required binary not found: ${name}`);
}

const REAL_GIT = resolveRealBinary("git", ["/opt/homebrew/bin/git", "/usr/bin/git"]);
const REAL_PYTHON3 = resolveRealBinary("python3", [
	"/opt/homebrew/bin/python3",
	"/usr/bin/python3",
]);

function writeExecutable(filePath: string, content: string): void {
	fs.writeFileSync(filePath, content, "utf8");
	fs.chmodSync(filePath, 0o755);
}

describe("core-critic-send.sh 및 critic-send.sh 분기 (#86 2b)", () => {
	let tmpDir = "";
	let binDir = "";
	let stateDir = "";
	let tmpHome = "";
	let hcCallsLog = "";
	let lockPath = "";
	let mySockPath = "";
	let otherSockPath = "";
	let briefPath = "";

	function writeLockRecord(params: {
		sessionId: string;
		socketPath: string;
		kind?: "herdr" | "external";
	}): void {
		const pyOut = spawnSync(
			REAL_PYTHON3,
			[
				"-B",
				"-c",
				`import json,os,sys
sock,sid,kind,dst=sys.argv[1:5]
st=os.stat(sock)
rec={
  "session_id": sid,
  "socket": sock,
  "socket_ino": st.st_ino,
  "socket_ctime_ns": st.st_ctime_ns,
  "kind": kind,
  "claimed_at": "2026-11-11T00:00:00+00:00",
}
with open(dst,"w",encoding="utf-8") as f:
  json.dump(rec,f,ensure_ascii=False,indent=2)
  f.write("\\n")
`,
				params.socketPath,
				params.sessionId,
				params.kind ?? "external",
				lockPath,
			],
			{ encoding: "utf8", timeout: 5_000 },
		);
		if (pyOut.status !== 0) {
			throw new Error(`Failed to write lock record: ${pyOut.stderr}`);
		}
	}

	beforeAll(() => {
		const rawTmp = fs.mkdtempSync("/tmp/gjch-t-core-2b-");
		tmpDir = fs.realpathSync(rawTmp);
		binDir = path.join(tmpDir, "bin");
		stateDir = path.join(tmpDir, "state");
		tmpHome = path.join(tmpDir, "home");
		hcCallsLog = path.join(tmpDir, "hc-calls.log");
		lockPath = path.join(tmpDir, "lead-test.json");
		mySockPath = path.join(tmpDir, "my.sock");
		otherSockPath = path.join(tmpDir, "other.sock");
		briefPath = path.join(tmpDir, "brief.md");

		fs.mkdirSync(binDir, { recursive: true });
		fs.mkdirSync(stateDir, { recursive: true });
		fs.mkdirSync(tmpHome, { recursive: true });
		fs.writeFileSync(briefPath, "검토 지시서 SECRET_BRIEF_TEXT_SHOULD_NOT_LEAK\n", "utf8");

		for (const sp of [mySockPath, otherSockPath]) {
			const sockBind = spawnSync(
				REAL_PYTHON3,
				[
					"-B",
					"-c",
					"import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1]); s.close()",
					sp,
				],
				{ encoding: "utf8", timeout: 5_000 },
			);
			if (sockBind.status !== 0) {
				throw new Error(`Failed to create test unix socket: ${sockBind.stderr}`);
			}
		}

		fs.symlinkSync(REAL_GIT, path.join(binDir, "git"));
		fs.symlinkSync(REAL_PYTHON3, path.join(binDir, "python3"));
		writeExecutable(path.join(binDir, "codex"), "#!/bin/sh\nprintf '0.1.0-stub\\n'\n");
		writeExecutable(path.join(binDir, "lsof"), "#!/bin/sh\nprintf '42424\\n'\nexit 0\n");

		writeExecutable(
			path.join(binDir, "hc"),
			`#!/bin/sh
sub="\${1:-}"
scenario="\${HC_STUB_SCENARIO:-default}"
if [ "$sub" = "send" ]; then
	# 지시서 본문 대신 send 호출 메타만 로그에 기록하거나 인자를 그대로 기록
	printf 'send' >> ${JSON.stringify(hcCallsLog)}
	for a in "$@"; do
		case "$a" in
			send) ;;
			*SECRET_BRIEF_TEXT*) printf ' <BRIEF>' >> ${JSON.stringify(hcCallsLog)} ;;
			*) printf ' %s' "$a" >> ${JSON.stringify(hcCallsLog)} ;;
		esac
	done
	printf '\\n' >> ${JSON.stringify(hcCallsLog)}
else
	printf '%s\\n' "$*" >> ${JSON.stringify(hcCallsLog)}
fi

if [ "$sub" = "ls" ]; then
	if [ -f "${stateDir}/ls-critic.json" ]; then
		cat "${stateDir}/ls-critic.json"
		exit 0
	fi
	printf '{"terminals":[],"hidden_finished":0,"machines":[]}\\n'
	exit 0
fi

if [ "$sub" = "get" ]; then
	addr="\${3:-}"
	cnt=0
	if [ -f "${stateDir}/get-\${addr}-count.txt" ]; then
		cnt="$(cat "${stateDir}/get-\${addr}-count.txt")"
	fi
	cnt=$((cnt + 1))
	printf '%s' "$cnt" > "${stateDir}/get-\${addr}-count.txt"
	if [ -f "${stateDir}/hang-get-\${addr}-\${cnt}.txt" ]; then
		printf '%s\\n' "$$" >> "${stateDir}/hang-pids.txt"
		python3 -B -c 'import time; time.sleep(30)' gjch-r3-hang-child &
		hang_child=$!
		printf '%s\\n' "$hang_child" >> "${stateDir}/hang-pids.txt"
		wait "$hang_child"
		exit 0
	fi
	if [ -f "${stateDir}/term-ign-get-\${addr}-\${cnt}.txt" ]; then
		printf '%s\\n' "$$" >> "${stateDir}/term-ign-pids.txt"
		python3 -B -c 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(30)' gjch-r4-term-ign-child &
		ign_child=$!
		printf '%s\\n' "$ign_child" >> "${stateDir}/term-ign-pids.txt"
		trap 'exit 0' TERM
		wait "$ign_child"
		exit 0
	fi
	if [ -f "${stateDir}/delay-get-\${addr}-\${cnt}.txt" ]; then
		sleep "$(cat "${stateDir}/delay-get-\${addr}-\${cnt}.txt")"
	elif [ -f "${stateDir}/delay-get-\${addr}.txt" ]; then
		sleep "$(cat "${stateDir}/delay-get-\${addr}.txt")"
	fi
	if [ -f "${stateDir}/get-\${addr}-\${cnt}.json" ]; then
		if [ -f "${stateDir}/write-on-get-\${addr}-\${cnt}.txt" ] && [ -n "\${TEST_RESULT_FILE:-}" ]; then
			cat "${stateDir}/write-on-get-\${addr}-\${cnt}.txt" > "\$TEST_RESULT_FILE"
		fi
		cat "${stateDir}/get-\${addr}-\${cnt}.json"
		exit 0
	fi
	if [ -f "${stateDir}/get-\${addr}.json" ]; then
		cat "${stateDir}/get-\${addr}.json"
		exit 0
	fi
	printf '{"error":{"kind":"not_found","message":"not_found"}}\\n' >&2
	exit 3
fi

if [ "$sub" = "kill" ]; then
	addr="\${3:-}"
	if [ "$scenario" != "kill_stay_live" ]; then
		if [ -f "${stateDir}/finished-\${addr}.json" ]; then
			cp "${stateDir}/finished-\${addr}.json" "${stateDir}/get-\${addr}.json"
		fi
	fi
	printf '{"address":"%s","state":"finished"}\\n' "$addr"
	exit 0
fi

if [ "$sub" = "rm" ]; then
	addr="\${3:-}"
	printf '{"removed":"%s"}\\n' "$addr"
	exit 0
fi

if [ "$sub" = "run" ]; then
	if [ "$scenario" = "run_fail" ]; then
		printf '{"error":{"kind":"spawn_failed","message":"failed sk-1234567890"}}\\n' >&2
		exit 1
	fi
	if [ -f "${stateDir}/run-response.json" ]; then
		cat "${stateDir}/run-response.json"
		exit 0
	fi
	addr="\${HC_SPAWN_ADDR:-t9critic}"
	if [ -f "${stateDir}/spawned-critic.json" ]; then
		cp "${stateDir}/spawned-critic.json" "${stateDir}/get-\${addr}.json"
	fi
	printf '{"address":"%s","name":"gjch-test-86-critic","cwd":%s,"state":"live","turn":0,"labels":{"team":"gjch-test-86","role":"critic"},"argv":[],"created_ms":1,"screen":"exact","cols":200,"rows":120}\\n' "$addr" ${JSON.stringify(JSON.stringify(REPO_ROOT))}
	exit 0
fi

if [ "$sub" = "send" ]; then
	if [ "$scenario" = "send_hang_with_child" ]; then
		if [ -f "${stateDir}/working-during-send.json" ]; then
			cp "${stateDir}/working-during-send.json" "${stateDir}/get-t9critic.json"
		fi
		printf '%s\\n' "$$" >> "${stateDir}/hang-pids.txt"
		python3 -B -c 'import time; time.sleep(30)' gjch-r3-hang-child &
		send_child=$!
		printf '%s\\n' "$send_child" >> "${stateDir}/hang-pids.txt"
		wait "$send_child"
		exit 0
	fi
	if [ "$scenario" = "send_partial_hang" ]; then
		if [ -f "${stateDir}/working-during-send.json" ]; then
			cp "${stateDir}/working-during-send.json" "${stateDir}/get-t9critic.json"
		fi
		printf '{"turn":1,"started":true,'
		printf '%s\\n' "$$" >> "${stateDir}/partial-hang-pids.txt"
		python3 -B -c 'import time; time.sleep(30)' gjch-r4-partial-hang &
		partial_child=$!
		printf '%s\\n' "$partial_child" >> "${stateDir}/partial-hang-pids.txt"
		wait "$partial_child"
		exit 0
	fi
	if [ "$scenario" = "send_stream_hang" ]; then
		if [ -f "${stateDir}/working-during-send.json" ]; then
			cp "${stateDir}/working-during-send.json" "${stateDir}/get-t9critic.json"
		fi
		printf '%s\\n' "$$" >> "${stateDir}/stream-hang-pids.txt"
		python3 -B -c 'import sys,time
for i in range(500):
    sys.stdout.write("chunk-" + str(i) + "\\n")
    sys.stdout.flush()
    time.sleep(0.02)
' gjch-r5-stream-hang &
		stream_child=$!
		printf '%s\\n' "$stream_child" >> "${stateDir}/stream-hang-pids.txt"
		wait "$stream_child"
		exit 0
	fi
	if [ "$scenario" = "send_finish_after_deadline" ]; then
		sleep 1.6
		if [ -f "${stateDir}/write-on-send.txt" ] && [ -n "\${TEST_RESULT_FILE:-}" ]; then
			cat "${stateDir}/write-on-send.txt" > "\$TEST_RESULT_FILE"
		fi
		if [ -f "${stateDir}/send-result.json" ]; then
			cat "${stateDir}/send-result.json"
			exit 0
		fi
		printf '{"turn":1,"started":true,"status":"idle","wait":{"terminal":"t9critic","ended":true,"reason":"status","status":"idle","turn":1,"children":[]}}\\n'
		exit 0
	fi
	if [ "$scenario" = "send_sleep_blocked" ]; then
		if [ -f "${stateDir}/blocked-during-send.json" ]; then
			cp "${stateDir}/blocked-during-send.json" "${stateDir}/get-t9critic.json"
		fi
		sleep 2
		exit 0
	fi
	if [ "$scenario" = "send_sleep_working" ]; then
		if [ -f "${stateDir}/working-during-send.json" ]; then
			cp "${stateDir}/working-during-send.json" "${stateDir}/get-t9critic.json"
		fi
		sleep 4
		exit 0
	fi
	if [ "$scenario" = "send_rc_fail" ]; then
		printf '{"error":{"kind":"status_mismatch","message":"not idle"}}\\n' >&2
		exit 10
	fi
	if [ "$scenario" = "send_bad_json" ]; then
		printf 'not-valid-json\\n'
		exit 0
	fi
	if [ -f "${stateDir}/write-on-send.txt" ] && [ -n "\${TEST_RESULT_FILE:-}" ]; then
		cat "${stateDir}/write-on-send.txt" > "\$TEST_RESULT_FILE"
	fi
	if [ -f "${stateDir}/send-result.json" ]; then
		cat "${stateDir}/send-result.json"
		exit 0
	fi
	printf '{"turn":1,"started":true,"status":"idle","wait":{"terminal":"t9critic","ended":true,"reason":"status","status":"idle","turn":1,"children":[]}}\\n'
	exit 0
fi
exit 99
`,
		);
	});

	beforeEach(() => {
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(lockPath, { force: true });
		fs.rmSync(`${lockPath}.mutex`, { force: true });
		fs.rmSync(stateDir, { recursive: true, force: true });
		fs.mkdirSync(stateDir, { recursive: true });
		writeLockRecord({
			sessionId: "my-secret-session-uuid-12345678",
			socketPath: mySockPath,
			kind: "external",
		});
	});

	afterAll(() => {
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	function buildEnv(overrides?: Record<string, string | undefined>): NodeJS.ProcessEnv {
		const env: NodeJS.ProcessEnv = { ...process.env };
		for (const k of STRIPPED_ENV_KEYS) {
			delete env[k];
		}
		return {
			...env,
			PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
			HOME: tmpHome,
			PYTHONNOUSERSITE: "1",
			GJCH_CORE: "1",
			GJCH_CORE_TEAM: "gjch-test-86",
			GJCH_EXTERNAL_LEAD: "1",
			GJCH_LEAD_LOCK: lockPath,
			GJCH_CORE_DOWN_INTERVAL: "1",
			GJCH_CORE_DOWN_RETRIES: "2",
			GJCH_CRITIC_READY_INTERVAL: "1",
			GJCH_CRITIC_READY_RETRIES: "2",
			GJCH_CRITIC_WATCH_INTERVAL: "1",
			CLAUDE_CODE_SESSION_ID: "my-secret-session-uuid-12345678",
			CLAUDE_CODE_MESSAGING_SOCKET: mySockPath,
			...overrides,
		};
	}

	function readHcCalls(): string[] {
		if (!fs.existsSync(hcCallsLog)) {
			return [];
		}
		return fs
			.readFileSync(hcCallsLog, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean);
	}

	function seedSpawnedCritic(overrides?: Record<string, unknown>): void {
		fs.writeFileSync(
			path.join(stateDir, "spawned-critic.json"),
			JSON.stringify({
				address: "t9critic",
				name: "gjch-test-86-critic",
				state: "live",
				reported: true,
				turn: 0,
				cwd: REPO_ROOT,
				argv: ["codex", "--no-daemon", "--yolo"],
				labels: { team: "gjch-test-86", role: "critic" },
				status: { state: "idle", kind: null, msg: "ready" },
				...overrides,
			}),
			"utf8",
		);
	}

	test("1. 진입점 critic-send.sh 스위치 off/on 분기 및 잠금 아님(other-live) 시 run·send 0회", () => {
		const fakeRepo = path.join(tmpDir, "fake-repo");
		const fakeScripts = path.join(fakeRepo, "scripts");
		fs.mkdirSync(fakeScripts, { recursive: true });
		fs.copyFileSync(CRITIC_SEND_SH, path.join(fakeScripts, "critic-send.sh"));
		fs.copyFileSync(
			path.join(REPO_ROOT, "scripts", "worktree-guard.sh"),
			path.join(fakeScripts, "worktree-guard.sh"),
		);
		const marker = path.join(stateDir, "core-critic-send-marker.txt");
		writeExecutable(
			path.join(fakeScripts, "core-critic-send.sh"),
			`#!/bin/sh
printf 'called:%s\\n' "$*" > ${JSON.stringify(marker)}
exit 55
`,
		);

		// 스위치 off: 기존 critic-send.sh 본문이 실행되어 core-critic-send.sh는 호출되지 않음
		const offRes = spawnSync("/bin/bash", [path.join(fakeScripts, "critic-send.sh"), "-h"], {
			cwd: fakeRepo,
			encoding: "utf8",
			env: buildEnv({ GJCH_CORE: undefined }),
		});
		expect(offRes.status).toBe(0);
		expect(fs.existsSync(marker)).toBe(false);

		// 스위치 on: core-critic-send.sh로 exec하며 인자 전달
		const onRes = spawnSync(
			"/bin/bash",
			[path.join(fakeScripts, "critic-send.sh"), "--timeout", "5000", briefPath],
			{
				cwd: fakeRepo,
				encoding: "utf8",
				env: buildEnv({ GJCH_CORE: "1" }),
			},
		);
		expect(onRes.status).toBe(55);
		expect(fs.readFileSync(marker, "utf8").trim()).toBe(`called:--timeout 5000 ${briefPath}`);

		// 잠금이 mine이 아닐 때(other-live) -> run·send·kill·rm 모두 0회, rc 1
		writeLockRecord({
			sessionId: "other-session-id-99999999",
			socketPath: otherSockPath,
			kind: "external",
		});
		const lockFailRes = spawnSync("/bin/bash", [CORE_CRITIC_SEND_SH, briefPath], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv(),
		});
		expect(lockFailRes.status).toBe(1);
		expect(readHcCalls()).toEqual([]);
	});

	test("2. 교체 기동 가드: 기존 critic working/blocked 시 kill 0회, finished 미확인 시 rm·run·send 0회, 기동·준비 실패 시 send 0회", () => {
		// (a) 기존 critic이 working일 때 -> kill·rm·run·send 0회, rc 1
		fs.writeFileSync(
			path.join(stateDir, "ls-critic.json"),
			JSON.stringify({
				terminals: [{ address: "t2c", name: "gjch-test-86-critic", state: "live" }],
				hidden_finished: 0,
				machines: [],
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "get-t2c.json"),
			JSON.stringify({
				address: "t2c",
				state: "live",
				reported: true,
				status: { state: "working", kind: null },
			}),
			"utf8",
		);
		const workingRes = spawnSync("/bin/bash", [CORE_CRITIC_SEND_SH, briefPath], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv(),
		});
		expect(workingRes.status).toBe(1);
		expect(workingRes.stderr).toContain("검토 중(working), 교체 안 함");
		const workingCalls = readHcCalls();
		expect(workingCalls.some((c) => c.startsWith("kill ") || c.startsWith("rm ") || c.startsWith("run ") || c.startsWith("send "))).toBe(false);

		// F1: 기존 critic이 blocked / reported=false / reported=unknown / status=null / status=other / status=error 각 경우 변경 호출(kill·rm·run·send) 0회, rc 1
		const nonReplaceableCases: Array<{
			doc: Record<string, unknown>;
			expectedStderr: string;
		}> = [
			{
				doc: {
					address: "t2c",
					state: "live",
					reported: true,
					status: { state: "blocked", kind: "permission" },
				},
				expectedStderr: "검토 중(blocked), 교체 안 함",
			},
			{
				doc: {
					address: "t2c",
					state: "live",
					reported: false,
					status: null,
				},
				expectedStderr: "미보고(reported=false), 교체 안 함",
			},
			{
				doc: {
					address: "t2c",
					state: "live",
					reported: "false",
					status: { state: "idle", kind: null },
				},
				expectedStderr: "미보고(reported=unknown), 교체 안 함",
			},
			{
				doc: {
					address: "t2c",
					state: "live",
					reported: true,
					status: null,
				},
				expectedStderr: "상태 없음(status=null), 교체 안 함",
			},
			{
				doc: {
					address: "t2c",
					state: "live",
					reported: true,
					status: { state: "unexpected_custom_state", kind: null },
				},
				expectedStderr: "상태 불명(status=other), 교체 안 함",
			},
			{
				doc: {
					address: "t2c",
					state: "live",
					reported: true,
					status: { state: "error", kind: null },
				},
				expectedStderr: "오류 상태(status=error), 교체 안 함",
			},
		];
		for (const item of nonReplaceableCases) {
			fs.rmSync(hcCallsLog, { force: true });
			fs.writeFileSync(path.join(stateDir, "get-t2c.json"), JSON.stringify(item.doc), "utf8");
			const nrRes = spawnSync("/bin/bash", [CORE_CRITIC_SEND_SH, briefPath], {
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
			});
			expect(nrRes.status).toBe(1);
			expect(nrRes.stderr).toContain(item.expectedStderr);
			const nrCalls = readHcCalls();
			expect(
				nrCalls.some(
					(c) =>
						c.startsWith("kill ") ||
						c.startsWith("rm ") ||
						c.startsWith("run ") ||
						c.startsWith("send "),
				),
			).toBe(false);
		}

		// (b) 기존 critic이 idle이나 kill 뒤 finished 미확인 -> kill 1회, rm·run·send 0회, rc 1
		writeExecutable(path.join(binDir, "sleep"), "#!/bin/sh\nexit 0\n");
		try {
			fs.rmSync(hcCallsLog, { force: true });
			fs.writeFileSync(
				path.join(stateDir, "get-t2c.json"),
				JSON.stringify({
					address: "t2c",
					state: "live",
					reported: true,
					status: { state: "idle", kind: null },
				}),
				"utf8",
			);
			const stayLiveRes = spawnSync("/bin/bash", [CORE_CRITIC_SEND_SH, briefPath], {
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ HC_STUB_SCENARIO: "kill_stay_live" }),
			});
			expect(stayLiveRes.status).toBe(1);
			expect(stayLiveRes.stderr).toContain("finished 미확인");
			const stayCalls = readHcCalls();
			expect(stayCalls.filter((c) => c.startsWith("kill "))).toEqual(["kill --json t2c"]);
			expect(stayCalls.some((c) => c.startsWith("rm ") || c.startsWith("run ") || c.startsWith("send "))).toBe(false);

			// (c) 교체 기동(hc run) 실패 -> send 0회, rc 1
			fs.rmSync(hcCallsLog, { force: true });
			fs.rmSync(path.join(stateDir, "ls-critic.json"), { force: true });
			const runFailRes = spawnSync("/bin/bash", [CORE_CRITIC_SEND_SH, briefPath], {
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ HC_STUB_SCENARIO: "run_fail" }),
			});
			expect(runFailRes.status).toBe(1);
			expect(runFailRes.stderr).toContain("교체 기동 실패: spawn_failed");
			expect(runFailRes.stderr).not.toContain("sk-1234567890");
			expect(readHcCalls().some((c) => c.startsWith("send "))).toBe(false);

			// (d) 새 critic이 done에 머물러 idle 준비 미확인 -> send 0회, rc 1
			fs.rmSync(hcCallsLog, { force: true });
			seedSpawnedCritic({ status: { state: "done", kind: null } });
			const doneNotIdleRes = spawnSync("/bin/bash", [CORE_CRITIC_SEND_SH, briefPath], {
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
			});
			expect(doneNotIdleRes.status).toBe(1);
			expect(doneNotIdleRes.stderr).toContain("준비 미확인(idle 아님(done))");
			expect(readHcCalls().some((c) => c.startsWith("send "))).toBe(false);

			// (e) F4: run 응답의 address가 숫자/true/배열이면 get·send 0회, rc 1
			for (const badAddr of [123, true, ["t9critic"]]) {
				fs.rmSync(hcCallsLog, { force: true });
				fs.writeFileSync(
					path.join(stateDir, "run-response.json"),
					JSON.stringify({
						address: badAddr,
						name: "gjch-test-86-critic",
						cwd: REPO_ROOT,
						state: "live",
					}),
					"utf8",
				);
				const badRunRes = spawnSync("/bin/bash", [CORE_CRITIC_SEND_SH, briefPath], {
					cwd: REPO_ROOT,
					encoding: "utf8",
					env: buildEnv(),
				});
				expect(badRunRes.status).toBe(1);
				expect(badRunRes.stderr).toContain("invalid_run_response");
				const badRunCalls = readHcCalls();
				expect(badRunCalls.some((c) => c.startsWith("get ") || c.startsWith("send "))).toBe(false);
			}
			fs.rmSync(path.join(stateDir, "run-response.json"), { force: true });
		} finally {
			fs.rmSync(path.join(binDir, "sleep"), { force: true });
		}

		// (f) F2: 준비 지연으로 시간 예산 소진 -> send 0회, rc 2
		fs.rmSync(hcCallsLog, { force: true });
		seedSpawnedCritic({ reported: false, status: null });
		const readyBudgetRes = spawnSync(
			"/bin/bash",
			[CORE_CRITIC_SEND_SH, "--timeout", "1000", briefPath],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({
					GJCH_CRITIC_READY_INTERVAL: "1",
					GJCH_CRITIC_READY_RETRIES: "5",
				}),
			},
		);
		expect(readyBudgetRes.status).toBe(2);
		expect(readyBudgetRes.stderr).toContain("시간 예산 소진");
		expect(readHcCalls().some((c) => c.startsWith("send "))).toBe(false);
	}, 20_000);

	test("3. SendResult 오류(비JSON·started=false) 및 WaitResult 오류(not_started·exit·status=error) 시 실패·재전송 0회", () => {
		seedSpawnedCritic();

		// (a) SendResult 비JSON -> rc 1, send 1회(재전송 0회)
		const badJsonRes = spawnSync("/bin/bash", [CORE_CRITIC_SEND_SH, briefPath], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv({ HC_STUB_SCENARIO: "send_bad_json" }),
		});
		expect(badJsonRes.status).toBe(1);
		expect(readHcCalls().filter((c) => c.startsWith("send ")).length).toBe(1);

		// (b) SendResult started=false / started=null / 필수 키(turn) 누락 / send_rc_fail -> rc 1, send 1회(재전송 0회)
		fs.rmSync(hcCallsLog, { force: true });
		const rcFailRes = spawnSync("/bin/bash", [CORE_CRITIC_SEND_SH, briefPath], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv({ HC_STUB_SCENARIO: "send_rc_fail" }),
		});
		expect(rcFailRes.status).toBe(1);
		expect(rcFailRes.stderr).toContain("send_rc_nonzero");
		expect(readHcCalls().filter((c) => c.startsWith("send ")).length).toBe(1);

		for (const badSendDoc of [
			{ turn: 1, started: false, status: "idle", wait: null },
			{ turn: 1, started: null, status: "idle", wait: null },
			{ started: true, status: "idle", wait: null },
			{ turn: true, started: true, status: "idle", wait: null },
		]) {
			fs.rmSync(hcCallsLog, { force: true });
			fs.writeFileSync(path.join(stateDir, "send-result.json"), JSON.stringify(badSendDoc), "utf8");
			const badSendRes = spawnSync("/bin/bash", [CORE_CRITIC_SEND_SH, briefPath], {
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
			});
			expect(badSendRes.status).toBe(1);
			expect(readHcCalls().filter((c) => c.startsWith("send ")).length).toBe(1);
		}

		// (c) WaitResult reason=not_started / reason=exit / reason=status,status=error 및 F4 필수 키 누락·잘못된 타입·다른 terminal -> 모두 rc 1(성공 0회), 재전송 0회
		for (const waitFixture of [
			{
				terminal: "t9critic",
				turn: 1,
				children: [],
				reason: "not_started",
				ended: false,
				status: "idle",
			},
			{
				terminal: "t9critic",
				turn: 1,
				children: [],
				reason: "exit",
				ended: true,
				status: null,
			},
			{
				terminal: "t9critic",
				turn: 1,
				children: [],
				reason: "status",
				ended: true,
				status: "error",
			},
			// F4: terminal 누락
			{ turn: 1, children: [], reason: "status", ended: true, status: "idle" },
			// F4: 다른 terminal
			{
				terminal: "t_other",
				turn: 1,
				children: [],
				reason: "status",
				ended: true,
				status: "idle",
			},
			// F4: turn 누락
			{ terminal: "t9critic", children: [], reason: "status", ended: true, status: "idle" },
			// F4: turn 잘못된 타입(bool)
			{
				terminal: "t9critic",
				turn: true,
				children: [],
				reason: "status",
				ended: true,
				status: "idle",
			},
			// F4: children 누락
			{ terminal: "t9critic", turn: 1, reason: "status", ended: true, status: "idle" },
			// F4: children 잘못된 타입(문자열)
			{
				terminal: "t9critic",
				turn: 1,
				children: "bad",
				reason: "status",
				ended: true,
				status: "idle",
			},
		]) {
			fs.rmSync(hcCallsLog, { force: true });
			fs.writeFileSync(
				path.join(stateDir, "send-result.json"),
				JSON.stringify({
					turn: 1,
					started: true,
					status: "idle",
					wait: waitFixture,
				}),
				"utf8",
			);
			const wFailRes = spawnSync("/bin/bash", [CORE_CRITIC_SEND_SH, briefPath], {
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
			});
			expect(wFailRes.status).toBe(1);
			expect(readHcCalls().filter((c) => c.startsWith("send ")).length).toBe(1);
		}

		// (d) F8(d): WaitResult에서 wait.status=blocked 직접 반환 -> DIALOG rc 5, send 1회
		fs.rmSync(hcCallsLog, { force: true });
		seedSpawnedCritic({
			status: { state: "idle", kind: "question", msg: "Direct wait blocked msg" },
		});
		fs.writeFileSync(
			path.join(stateDir, "send-result.json"),
			JSON.stringify({
				turn: 1,
				started: true,
				status: "idle",
				wait: {
					terminal: "t9critic",
					ended: false,
					reason: "status",
					status: "blocked",
					turn: 1,
					children: [],
				},
			}),
			"utf8",
		);
		const waitBlockedRes = spawnSync("/bin/bash", [CORE_CRITIC_SEND_SH, briefPath], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv(),
		});
		expect(waitBlockedRes.status).toBe(5);
		expect(waitBlockedRes.stderr).toContain("DIALOG critic question msglen=23");
		expect(readHcCalls().filter((c) => c.startsWith("send ")).length).toBe(1);
	}, 20_000);

	test("4. WaitResult timeout 체크인 계속 대기, blocked(rc 5), 옛 결과 파일(rc 4), 새 결과 파일(rc 0) 및 ms 예산 정합성(R6-F1·R6-F2)", () => {
		const resFile = path.join(stateDir, "critic-result.md");

		// (a1) --timeout 1(1ms)은 앞 단계에서 이미 예산 초과이므로 send 0회·rc 2
		seedSpawnedCritic();
		const timeout1msRes = spawnSync(
			"/bin/bash",
			[CORE_CRITIC_SEND_SH, "--timeout", "1", "--result", resFile, briefPath],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
			},
		);
		expect(timeout1msRes.status).toBe(2);
		expect(timeout1msRes.stderr).toContain("시간 예산 소진");
		expect(readHcCalls().filter((c) => c.startsWith("send "))).toEqual([]);

		// (a2) 옛 결과 파일(전송 전과 같은 lstat mtime_ns·size) -> 충분한 timeout(5000ms)에서 rc 4, hc read 0회
		fs.rmSync(hcCallsLog, { force: true });
		seedSpawnedCritic();
		fs.writeFileSync(resFile, "이전 회차 결과\n", "utf8");
		const staleRes = spawnSync(
			"/bin/bash",
			[CORE_CRITIC_SEND_SH, "--timeout", "5000", "--result", resFile, briefPath],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
			},
		);
		expect(staleRes.status).toBe(4);
		const staleCalls = readHcCalls();
		expect(staleCalls.filter((c) => c.startsWith("send "))).toEqual([
			"send --json --if idle --wait --timeout 5 t9critic <BRIEF>",
		]);
		expect(staleCalls.some((c) => c.startsWith("read "))).toBe(false);

		// (b1) 기존 critic 교체 기동(kill -> finished -> rm -> run) + WaitResult timeout 체크인(ended=false) 뒤 idle 완료 + 새 결과 파일 -> rc 0 (재전송 0회, 9회 호출 순서 단언)
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "get-t9critic-count.txt"), { force: true });
		fs.writeFileSync(
			path.join(stateDir, "ls-critic.json"),
			JSON.stringify({
				terminals: [{ address: "t2old", name: "gjch-test-86-critic", state: "live" }],
				hidden_finished: 0,
				machines: [],
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "get-t2old.json"),
			JSON.stringify({
				address: "t2old",
				state: "live",
				reported: true,
				status: { state: "done", kind: null },
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "finished-t2old.json"),
			JSON.stringify({
				address: "t2old",
				state: "finished",
				reported: true,
				status: null,
			}),
			"utf8",
		);
		seedSpawnedCritic({ status: { state: "idle", kind: null } });
		fs.writeFileSync(
			path.join(stateDir, "send-result.json"),
			JSON.stringify({
				turn: 1,
				started: true,
				status: "idle",
				wait: {
					terminal: "t9critic",
					ended: false,
					reason: "timeout",
					status: "working",
					turn: 1,
					children: [],
				},
			}),
			"utf8",
		);
		fs.writeFileSync(path.join(stateDir, "write-on-send.txt"), "새로운 검토 결과 본문\n", "utf8");

		const okRes = spawnSync(
			"/bin/bash",
			[CORE_CRITIC_SEND_SH, "--timeout", "5000", "--result", resFile, briefPath],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ TEST_RESULT_FILE: resFile }),
			},
		);
		expect(okRes.status).toBe(0);
		expect(okRes.stdout).toContain("완료·결과 파일 확인");
		const okCalls = readHcCalls();
		// F8(e): 교체 성공 시 ls -> 기존 get -> kill -> finished get -> rm -> run -> 새 address get -> send -> 후속 get 호출 순서를 그대로 단언
		expect(okCalls.length).toBe(9);
		expect(okCalls[0]).toBe("ls --json --label team=gjch-test-86 --label role=critic");
		expect(okCalls[1]).toBe("get --json t2old");
		expect(okCalls[2]).toBe("kill --json t2old");
		expect(okCalls[3]).toBe("get --json t2old");
		expect(okCalls[4]).toBe("rm --json t2old");
		expect(okCalls[5]?.startsWith("run --bg --json --no-notify --no-parent --name gjch-test-86-critic ")).toBe(true);
		expect(okCalls[6]).toBe("get --json t9critic");
		expect(okCalls[7]?.startsWith("send --json --if idle --wait --timeout ")).toBe(true);
		expect(okCalls[8]).toBe("get --json t9critic");

		// (b2) 3(b): 6000ms 호출에서 준비 get 스텁이 3000ms(3s) 지연하도록 해 남은 예산 약 2100~2900ms에서 hc send --timeout 3임을 단언
		const budget1500ResFile = path.join(stateDir, "critic-1500ms-result.md");
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "ls-critic.json"), { force: true });
		fs.rmSync(path.join(stateDir, "get-t9critic-count.txt"), { force: true });
		seedSpawnedCritic({ status: { state: "idle", kind: null } });
		fs.writeFileSync(path.join(stateDir, "delay-get-t9critic-1.txt"), "3", "utf8");
		fs.writeFileSync(
			path.join(stateDir, "send-result.json"),
			JSON.stringify({
				turn: 1,
				started: true,
				status: "idle",
				wait: {
					terminal: "t9critic",
					ended: true,
					reason: "status",
					status: "idle",
					turn: 1,
					children: [],
				},
			}),
			"utf8",
		);
		fs.writeFileSync(path.join(stateDir, "write-on-send.txt"), "6000ms 예산 검토 결과\n", "utf8");
		const budget1500Res = spawnSync(
			"/bin/bash",
			[CORE_CRITIC_SEND_SH, "--timeout", "6000", "--result", budget1500ResFile, briefPath],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ TEST_RESULT_FILE: budget1500ResFile }),
				timeout: 10_000,
			},
		);
		fs.rmSync(path.join(stateDir, "delay-get-t9critic-1.txt"), { force: true });
		expect(budget1500Res.status).toBe(0);
		expect(budget1500Res.stdout).toContain("완료·결과 파일 확인");
		const budget1500Calls = readHcCalls();
		expect(budget1500Calls.filter((c) => c.startsWith("send "))).toEqual([
			"send --json --if idle --wait --timeout 3 t9critic <BRIEF>",
		]);

		// (b1b) 3(c): 지연된 기존 critic get(예산 초과 뒤 idle 반환) 시 kill/rm/run/send 0회와 rc 2 단언
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "get-t2old-count.txt"), { force: true });
		fs.writeFileSync(
			path.join(stateDir, "ls-critic.json"),
			JSON.stringify({
				terminals: [{ address: "t2old", name: "gjch-test-86-critic", state: "live" }],
				hidden_finished: 0,
				machines: [],
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "get-t2old.json"),
			JSON.stringify({
				address: "t2old",
				state: "live",
				reported: true,
				status: { state: "idle", kind: null },
			}),
			"utf8",
		);
		fs.writeFileSync(path.join(stateDir, "delay-get-t2old-1.txt"), "0.6", "utf8");
		const delayedOldGetRes = spawnSync(
			"/bin/bash",
			[CORE_CRITIC_SEND_SH, "--timeout", "250", briefPath],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
				timeout: 5_000,
			},
		);
		fs.rmSync(path.join(stateDir, "delay-get-t2old-1.txt"), { force: true });
		fs.rmSync(path.join(stateDir, "get-t2old-count.txt"), { force: true });
		expect(delayedOldGetRes.status).toBe(2);
		expect(delayedOldGetRes.stderr).toContain("시간 예산 소진");
		const delayedOldGetCalls = readHcCalls();
		expect(
			delayedOldGetCalls.some(
				(c) =>
					c.startsWith("kill ") ||
					c.startsWith("rm ") ||
					c.startsWith("run ") ||
					c.startsWith("send "),
			),
		).toBe(false);

		// (b2) F8(a): WaitResult reason=message — 완료로 오인하지 않고 후속 get으로 working -> done 및 결과 파일 작성을 확인(send 1회, rc 0)
		const msgResFile = path.join(stateDir, "critic-message-result.md");
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "ls-critic.json"), { force: true });
		fs.rmSync(path.join(stateDir, "get-t9critic-count.txt"), { force: true });
		fs.rmSync(path.join(stateDir, "write-on-send.txt"), { force: true });
		seedSpawnedCritic({ status: { state: "idle", kind: null } });
		// 1회차 get(준비 확인): idle -> send(reason=message, 아직 결과 파일 없음) -> 2회차 get: working -> 3회차 get: done + 결과 파일 작성
		fs.writeFileSync(
			path.join(stateDir, "get-t9critic-1.json"),
			JSON.stringify({
				address: "t9critic",
				state: "live",
				reported: true,
				status: { state: "idle", kind: null },
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "get-t9critic-2.json"),
			JSON.stringify({
				address: "t9critic",
				state: "live",
				reported: true,
				status: { state: "working", kind: null },
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "get-t9critic-3.json"),
			JSON.stringify({
				address: "t9critic",
				state: "live",
				reported: true,
				status: { state: "done", kind: null },
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "write-on-get-t9critic-3.txt"),
			"message 후속 폴링에서 작성된 결과\n",
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "send-result.json"),
			JSON.stringify({
				turn: 1,
				started: true,
				status: "working",
				wait: {
					terminal: "t9critic",
					ended: false,
					reason: "message",
					status: "working",
					turn: 1,
					children: [],
				},
			}),
			"utf8",
		);
		const msgWaitRes = spawnSync(
			"/bin/bash",
			[CORE_CRITIC_SEND_SH, "--timeout", "10000", "--result", msgResFile, briefPath],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ TEST_RESULT_FILE: msgResFile }),
			},
		);
		expect(msgWaitRes.status).toBe(0);
		expect(msgWaitRes.stdout).toContain("완료·결과 파일 확인");
		const msgWaitCalls = readHcCalls();
		expect(msgWaitCalls.filter((c) => c.startsWith("send ")).length).toBe(1);
		expect(msgWaitCalls.filter((c) => c === "get --json t9critic").length).toBe(3);
		for (const i of [1, 2, 3]) {
			fs.rmSync(path.join(stateDir, `get-t9critic-${i}.json`), { force: true });
		}
		fs.rmSync(path.join(stateDir, "write-on-get-t9critic-3.txt"), { force: true });
		fs.rmSync(path.join(stateDir, "get-t9critic-count.txt"), { force: true });

		// (c) send 대기 중 백그라운드 3초(테스트 설정 1초) 폴링이 blocked 감지 -> DIALOG critic <kind> msglen=<n> 및 rc 5, msg 원문 미출력
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "ls-critic.json"), { force: true });
		seedSpawnedCritic();
		const blockedSecret = "Confirm edit sk-secret111222? 550e8400-e29b-41d4-a716-446655440000";
		fs.writeFileSync(
			path.join(stateDir, "blocked-during-send.json"),
			JSON.stringify({
				address: "t9critic",
				state: "live",
				reported: true,
				status: { state: "blocked", kind: "permission", msg: blockedSecret },
			}),
			"utf8",
		);
		const blkRes = spawnSync("/bin/bash", [CORE_CRITIC_SEND_SH, briefPath], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv({ HC_STUB_SCENARIO: "send_sleep_blocked" }),
		});
		expect(blkRes.status).toBe(5);
		expect(blkRes.stderr).toContain(`DIALOG critic permission msglen=${blockedSecret.length}`);
		expect(blkRes.stderr).not.toContain("sk-secret111222");
		expect(blkRes.stderr).not.toContain("550e8400-e29b-41d4-a716-446655440000");

		// (d) --no-wait: --wait 없이 send 후 started=true 확인까지만 하고 rc 0
		fs.rmSync(hcCallsLog, { force: true });
		seedSpawnedCritic();
		fs.writeFileSync(
			path.join(stateDir, "send-result.json"),
			JSON.stringify({
				turn: 1,
				started: true,
				status: "idle",
				wait: null,
			}),
			"utf8",
		);
		const noWaitRes = spawnSync("/bin/bash", [CORE_CRITIC_SEND_SH, "--no-wait", briefPath], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv(),
		});
		expect(noWaitRes.status).toBe(0);
		expect(noWaitRes.stdout).toContain("전송 수락(started) 확인");
		expect(readHcCalls().filter((c) => c.startsWith("send "))).toEqual([
			"send --json --if idle t9critic <BRIEF>",
		]);

		// (e) F3: --no-wait에 send_sleep_blocked fixture 적용 -> 백그라운드 send 중 blocked 감지하여 send 1회, DIALOG rc 5, 금지 호출 0회
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "get-t9critic-count.txt"), { force: true });
		seedSpawnedCritic();
		const noWaitBlkRes = spawnSync(
			"/bin/bash",
			[CORE_CRITIC_SEND_SH, "--no-wait", briefPath],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ HC_STUB_SCENARIO: "send_sleep_blocked" }),
			},
		);
		expect(noWaitBlkRes.status).toBe(5);
		expect(noWaitBlkRes.stderr).toContain(
			`DIALOG critic permission msglen=${blockedSecret.length}`,
		);
		const noWaitBlkCalls = readHcCalls();
		expect(noWaitBlkCalls.filter((c) => c.startsWith("send ")).length).toBe(1);
		expect(
			noWaitBlkCalls.some(
				(c) =>
					c.startsWith("read ") ||
					c.startsWith("attach ") ||
					c.startsWith("keys ") ||
					c.startsWith("kill ") ||
					c.startsWith("rm "),
			),
		).toBe(false);

		// (f) F2: send 대기 중 working 지속 -> 유한 시간 안에 로컬 백그라운드 정리 후 rc 2 (원격 kill·재전송 0회)
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "get-t9critic-count.txt"), { force: true });
		seedSpawnedCritic();
		fs.writeFileSync(
			path.join(stateDir, "working-during-send.json"),
			JSON.stringify({
				address: "t9critic",
				state: "live",
				reported: true,
				status: { state: "working", kind: null },
			}),
			"utf8",
		);
		const tStart = Date.now();
		const bgTimeoutRes = spawnSync(
			"/bin/bash",
			[CORE_CRITIC_SEND_SH, "--timeout", "1500", briefPath],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({
					HC_STUB_SCENARIO: "send_sleep_working",
					GJCH_CRITIC_WATCH_INTERVAL: "1",
				}),
				timeout: 5_000,
			},
		);
		const elapsedMs = Date.now() - tStart;
		expect(bgTimeoutRes.status).toBe(2);
		expect(bgTimeoutRes.stderr).toContain("timeout·완료 미확인");
		expect(elapsedMs).toBeLessThan(4000);
		const bgTimeoutCalls = readHcCalls();
		expect(bgTimeoutCalls.filter((c) => c.startsWith("send ")).length).toBe(1);
		expect(bgTimeoutCalls.some((c) => c.startsWith("kill "))).toBe(false);

		// (g) F2: 체크인(timeout·ended=false) 뒤 hc get이 working을 지속 -> 유한 시간 안에 rc 2 (원격 kill·재전송 0회)
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "get-t9critic-count.txt"), { force: true });
		seedSpawnedCritic({ status: { state: "working", kind: null } });
		// 1회차 get(준비 확인)은 idle, 이후 체크인 뒤 get은 working 유지
		fs.writeFileSync(
			path.join(stateDir, "get-t9critic-1.json"),
			JSON.stringify({
				address: "t9critic",
				state: "live",
				reported: true,
				status: { state: "idle", kind: null },
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "send-result.json"),
			JSON.stringify({
				turn: 1,
				started: true,
				status: "working",
				wait: {
					terminal: "t9critic",
					ended: false,
					reason: "timeout",
					status: "working",
					turn: 1,
					children: [],
				},
			}),
			"utf8",
		);
		const checkinTimeoutRes = spawnSync(
			"/bin/bash",
			[CORE_CRITIC_SEND_SH, "--timeout", "1500", briefPath],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ GJCH_CRITIC_WATCH_INTERVAL: "1" }),
				timeout: 5_000,
			},
		);
		expect(checkinTimeoutRes.status).toBe(2);
		expect(checkinTimeoutRes.stderr).toContain("timeout·완료 미확인");
		const checkinTimeoutCalls = readHcCalls();
		expect(checkinTimeoutCalls.filter((c) => c.startsWith("send ")).length).toBe(1);
		expect(checkinTimeoutCalls.some((c) => c.startsWith("kill "))).toBe(false);
		fs.rmSync(path.join(stateDir, "get-t9critic-1.json"), { force: true });

		// (h) 3(d): send 감시 get 스텁이 예산 뒤까지 멈출 때 유한 시간 rc 2 종료 및 로컬 자식 종료 확인
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "get-t9critic-count.txt"), { force: true });
		fs.rmSync(path.join(stateDir, "hang-pids.txt"), { force: true });
		seedSpawnedCritic({ status: { state: "idle", kind: null } });
		// 1회차 get(준비 확인)은 즉시 통과하고, 2회차 get(send 감시 폴링)과 백그라운드 send가 각각 자식 sleep 30을 띄운 채 멈춤
		fs.writeFileSync(path.join(stateDir, "hang-get-t9critic-2.txt"), "1", "utf8");
		const hangStart = Date.now();
		const hangWatchRes = spawnSync(
			"/bin/bash",
			[CORE_CRITIC_SEND_SH, "--timeout", "1600", briefPath],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({
					HC_STUB_SCENARIO: "send_hang_with_child",
					GJCH_CRITIC_WATCH_INTERVAL: "1",
				}),
				timeout: 5_000,
			},
		);
		const hangElapsedMs = Date.now() - hangStart;
		fs.rmSync(path.join(stateDir, "hang-get-t9critic-2.txt"), { force: true });
		expect(hangWatchRes.status).toBe(2);
		expect(hangWatchRes.stderr).toContain("timeout·완료 미확인");
		expect(hangElapsedMs).toBeLessThan(4000);
		const hangCalls = readHcCalls();
		// 준비 get(1회) + 감시 get(1회) = 2회 호출 확인
		expect(hangCalls.filter((c) => c === "get --json t9critic").length).toBe(2);
		const hangPidsRaw = fs.existsSync(path.join(stateDir, "hang-pids.txt"))
			? fs.readFileSync(path.join(stateDir, "hang-pids.txt"), "utf8")
			: "";
		const hangPids = hangPidsRaw
			.split("\n")
			.map((s) => Number.parseInt(s.trim(), 10))
			.filter((n) => Number.isFinite(n) && n > 1);
		// 백그라운드 send 스텁·자식(2) + 감시 get 스텁·자식(2) 총 4개 PID가 기록되고 모두 종료되어야 함
		expect(hangPids.length).toBeGreaterThanOrEqual(4);
		for (const pid of hangPids) {
			let alive = false;
			try {
				process.kill(pid, 0);
				alive = true;
			} catch {
				alive = false;
			}
			expect(alive).toBe(false);
		}
		const pgrepRes = spawnSync("/usr/bin/pgrep", ["-f", "gjch-r3-hang-child"], {
			encoding: "utf8",
		});
		expect((pgrepRes.stdout ?? "").trim()).toBe("");

		// (i) 3(e): 마감 뒤 도착한 수락(--no-wait)이나 idle 완료(--wait)가 성공(rc 0)으로 통과하지 않고 rc 2가 되는지 단언
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "get-t9critic-count.txt"), { force: true });
		seedSpawnedCritic({ status: { state: "idle", kind: null } });
		fs.writeFileSync(
			path.join(stateDir, "send-result.json"),
			JSON.stringify({
				turn: 1,
				started: true,
				status: "idle",
				wait: null,
			}),
			"utf8",
		);
		const lateNoWaitRes = spawnSync(
			"/bin/bash",
			[CORE_CRITIC_SEND_SH, "--no-wait", "--timeout", "1500", briefPath],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ HC_STUB_SCENARIO: "send_finish_after_deadline" }),
				timeout: 5_000,
			},
		);
		expect(lateNoWaitRes.status).toBe(2);
		expect(lateNoWaitRes.stderr).toContain("timeout·완료 미확인");
		expect(lateNoWaitRes.stdout).not.toContain("전송 수락(started) 확인");
		expect(readHcCalls().filter((c) => c.startsWith("send ")).length).toBe(1);

		const lateResFile = path.join(stateDir, "critic-late-result.md");
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "get-t9critic-count.txt"), { force: true });
		seedSpawnedCritic({ status: { state: "idle", kind: null } });
		fs.writeFileSync(
			path.join(stateDir, "send-result.json"),
			JSON.stringify({
				turn: 1,
				started: true,
				status: "idle",
				wait: {
					terminal: "t9critic",
					ended: true,
					reason: "status",
					status: "idle",
					turn: 1,
					children: [],
				},
			}),
			"utf8",
		);
		fs.writeFileSync(path.join(stateDir, "write-on-send.txt"), "마감 뒤 작성된 결과\n", "utf8");
		const lateWaitRes = spawnSync(
			"/bin/bash",
			[CORE_CRITIC_SEND_SH, "--timeout", "1500", "--result", lateResFile, briefPath],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({
					HC_STUB_SCENARIO: "send_finish_after_deadline",
					TEST_RESULT_FILE: lateResFile,
				}),
				timeout: 5_000,
			},
		);
		expect(lateWaitRes.status).toBe(2);
		expect(lateWaitRes.stderr).toContain("timeout·완료 미확인");
		expect(lateWaitRes.stdout).not.toContain("완료");
		expect(readHcCalls().filter((c) => c.startsWith("send ")).length).toBe(1);

		// (j) R7-F1: send 스텁이 짧은 stdout을 flush한 뒤 장시간 멎는 fixture로 --wait·--no-wait 모두 유한 rc 2·send 1회·로컬 종료 확인
		for (const modeArgs of [[briefPath], ["--no-wait", briefPath]]) {
			fs.rmSync(hcCallsLog, { force: true });
			fs.rmSync(path.join(stateDir, "get-t9critic-count.txt"), { force: true });
			fs.rmSync(path.join(stateDir, "partial-hang-pids.txt"), { force: true });
			seedSpawnedCritic({ status: { state: "idle", kind: null } });
			fs.writeFileSync(
				path.join(stateDir, "working-during-send.json"),
				JSON.stringify({
					address: "t9critic",
					state: "live",
					reported: true,
					status: { state: "working", kind: null },
				}),
				"utf8",
			);
			const pStart = Date.now();
			const partialRes = spawnSync(
				"/bin/bash",
				[CORE_CRITIC_SEND_SH, "--timeout", "1500", ...modeArgs],
				{
					cwd: REPO_ROOT,
					encoding: "utf8",
					env: buildEnv({
						HC_STUB_SCENARIO: "send_partial_hang",
						GJCH_CRITIC_WATCH_INTERVAL: "1",
					}),
					timeout: 5_000,
				},
			);
			const pElapsed = Date.now() - pStart;
			expect(partialRes.status).toBe(2);
			expect(partialRes.stderr).toContain("timeout·완료 미확인");
			expect(pElapsed).toBeLessThan(4000);
			const pCalls = readHcCalls();
			expect(pCalls.filter((c) => c.startsWith("send ")).length).toBe(1);
			expect(pCalls.some((c) => c.startsWith("kill "))).toBe(false);
			const pPidsRaw = fs.existsSync(path.join(stateDir, "partial-hang-pids.txt"))
				? fs.readFileSync(path.join(stateDir, "partial-hang-pids.txt"), "utf8")
				: "";
			const pPids = pPidsRaw
				.split("\n")
				.map((s) => Number.parseInt(s.trim(), 10))
				.filter((n) => Number.isFinite(n) && n > 1);
			expect(pPids.length).toBeGreaterThanOrEqual(2);
			for (const pid of pPids) {
				let alive = false;
				try {
					process.kill(pid, 0);
					alive = true;
				} catch {
					alive = false;
				}
				expect(alive).toBe(false);
			}
			const pgrepPartial = spawnSync("/usr/bin/pgrep", ["-f", "gjch-r4-partial-hang"], {
				encoding: "utf8",
			});
			expect((pgrepPartial.stdout ?? "").trim()).toBe("");
		}

		// (k) R7-F2(1): send 기동 직전(자식 Python 내 subprocess 실행 직전) 예산 소진 -> send 0회, rc 2(미전송 만료)
		fs.rmSync(path.join(binDir, "python3"), { force: true });
		writeExecutable(
			path.join(binDir, "python3"),
			`#!/bin/sh
if [ -n "\${TEST_PY_DELAY_MODE:-}" ]; then
	case "\$TEST_PY_DELAY_MODE:\$*" in
		pre_send:*__SEND_PRE_EXPIRED__*)
			${JSON.stringify(REAL_PYTHON3)} -B -c 'import sys,time; rem=(int(sys.argv[1])-int(time.monotonic()*1000))/1000.0; time.sleep(max(0.0, rem+0.002))' "\$4"
			;;
		result_written:*S_ISREG*)
			sleep 1.6
			;;
	esac
fi
exec ${JSON.stringify(REAL_PYTHON3)} "$@"
`,
		);
		try {
			fs.rmSync(hcCallsLog, { force: true });
			fs.rmSync(path.join(stateDir, "get-t9critic-count.txt"), { force: true });
			seedSpawnedCritic({ status: { state: "idle", kind: null } });
			const preSendExpRes = spawnSync(
				"/bin/bash",
				[CORE_CRITIC_SEND_SH, "--timeout", "1600", briefPath],
				{
					cwd: REPO_ROOT,
					encoding: "utf8",
					env: buildEnv({ TEST_PY_DELAY_MODE: "pre_send" }),
					timeout: 5_000,
				},
			);
			expect(preSendExpRes.status).toBe(2);
			expect(preSendExpRes.stderr).toContain("미전송 만료");
			expect(readHcCalls().filter((c) => c.startsWith("send "))).toEqual([]);

			// (l) R7-F2(2): 결과 검증(result_written)이 마감을 넘기면 새 파일이 있어도 rc 2
			const r4LateVerifyFile = path.join(stateDir, "critic-r4-late-verify.md");
			fs.rmSync(hcCallsLog, { force: true });
			fs.rmSync(r4LateVerifyFile, { force: true });
			fs.rmSync(path.join(stateDir, "get-t9critic-count.txt"), { force: true });
			seedSpawnedCritic({ status: { state: "idle", kind: null } });
			fs.writeFileSync(
				path.join(stateDir, "send-result.json"),
				JSON.stringify({
					turn: 1,
					started: true,
					status: "idle",
					wait: {
						terminal: "t9critic",
						ended: true,
						reason: "status",
						status: "idle",
						turn: 1,
						children: [],
					},
				}),
				"utf8",
			);
			fs.writeFileSync(
				path.join(stateDir, "write-on-send.txt"),
				"새로 작성되었으나 검증 중 마감 초과된 결과\n",
				"utf8",
			);
			const lateVerifyRes = spawnSync(
				"/bin/bash",
				[CORE_CRITIC_SEND_SH, "--timeout", "1800", "--result", r4LateVerifyFile, briefPath],
				{
					cwd: REPO_ROOT,
					encoding: "utf8",
					env: buildEnv({
						TEST_RESULT_FILE: r4LateVerifyFile,
						TEST_PY_DELAY_MODE: "result_written",
					}),
					timeout: 5_000,
				},
			);
			expect(fs.existsSync(r4LateVerifyFile)).toBe(true);
			expect(lateVerifyRes.status).toBe(2);
			expect(lateVerifyRes.stderr).toContain("timeout·완료 미확인");
			expect(lateVerifyRes.stdout).not.toContain("완료");
			expect(readHcCalls().filter((c) => c.startsWith("send ")).length).toBe(1);
		} finally {
			fs.rmSync(path.join(binDir, "python3"), { force: true });
			fs.symlinkSync(REAL_PYTHON3, path.join(binDir, "python3"));
		}

		// (m) R7-F3: 직접 자식은 TERM에 즉시 끝나지만 같은 그룹 자손이 TERM을 무시(SIG_IGN + sleep 30)하는 fixture로 rc 2·유한 종료·자손 부재(pgrep) 확인
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "get-t9critic-count.txt"), { force: true });
		fs.rmSync(path.join(stateDir, "term-ign-pids.txt"), { force: true });
		seedSpawnedCritic({ status: { state: "idle", kind: null } });
		fs.writeFileSync(path.join(stateDir, "term-ign-get-t9critic-1.txt"), "1", "utf8");
		const termIgnStart = Date.now();
		const termIgnRes = spawnSync(
			"/bin/bash",
			[CORE_CRITIC_SEND_SH, "--timeout", "1400", briefPath],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
				timeout: 5_000,
			},
		);
		const termIgnElapsed = Date.now() - termIgnStart;
		fs.rmSync(path.join(stateDir, "term-ign-get-t9critic-1.txt"), { force: true });
		expect(termIgnRes.status).toBe(2);
		expect(termIgnElapsed).toBeLessThan(3500);
		expect(readHcCalls().filter((c) => c.startsWith("send "))).toEqual([]);
		const termIgnPidsRaw = fs.existsSync(path.join(stateDir, "term-ign-pids.txt"))
			? fs.readFileSync(path.join(stateDir, "term-ign-pids.txt"), "utf8")
			: "";
		const termIgnPids = termIgnPidsRaw
			.split("\n")
			.map((s) => Number.parseInt(s.trim(), 10))
			.filter((n) => Number.isFinite(n) && n > 1);
		expect(termIgnPids.length).toBeGreaterThanOrEqual(2);
		for (const pid of termIgnPids) {
			let alive = false;
			try {
				process.kill(pid, 0);
				alive = true;
			} catch {
				alive = false;
			}
			expect(alive).toBe(false);
		}
		const pgrepTermIgn = spawnSync("/usr/bin/pgrep", ["-f", "gjch-r4-term-ign-child"], {
			encoding: "utf8",
		});
		expect((pgrepTermIgn.stdout ?? "").trim()).toBe("");

		// (n) R10-F1: 짧은 블록을 연속 출력하는 send 스텁(20ms마다 한 줄씩 10초) fixture로
		// (a) 출력 도중에도 후속 hc get 호출(blocked 감시)이 기록되고,
		// (b) --timeout이 짧을 때 유한 시간 안 rc 2·send 1회·로컬 프로세스 부재(pgrep)를 단언
		for (const modeArgs of [[briefPath], ["--no-wait", briefPath]]) {
			fs.rmSync(hcCallsLog, { force: true });
			fs.rmSync(path.join(stateDir, "get-t9critic-count.txt"), { force: true });
			fs.rmSync(path.join(stateDir, "stream-hang-pids.txt"), { force: true });
			seedSpawnedCritic({ status: { state: "idle", kind: null } });
			fs.writeFileSync(
				path.join(stateDir, "working-during-send.json"),
				JSON.stringify({
					address: "t9critic",
					state: "live",
					reported: true,
					status: { state: "working", kind: null },
				}),
				"utf8",
			);
			const sStart = Date.now();
			const streamRes = spawnSync(
				"/bin/bash",
				[CORE_CRITIC_SEND_SH, "--timeout", "1700", ...modeArgs],
				{
					cwd: REPO_ROOT,
					encoding: "utf8",
					env: buildEnv({
						HC_STUB_SCENARIO: "send_stream_hang",
						GJCH_CRITIC_WATCH_INTERVAL: "1",
					}),
					timeout: 5_000,
				},
			);
			const sElapsed = Date.now() - sStart;
			expect(streamRes.status).toBe(2);
			expect(streamRes.stderr).toContain("timeout·완료 미확인");
			expect(sElapsed).toBeLessThan(4000);
			const sCalls = readHcCalls();
			expect(sCalls.filter((c) => c.startsWith("send ")).length).toBe(1);
			expect(sCalls.some((c) => c.startsWith("kill "))).toBe(false);
			// (a) 준비 확인 get(1회) 이후 연속 출력 도중에도 후속 hc get(blocked 감시)이 호출되었는지 단언
			const getCallsAfterSend = sCalls.slice(sCalls.findIndex((c) => c.startsWith("send ")) + 1);
			expect(getCallsAfterSend.filter((c) => c === "get --json t9critic").length).toBeGreaterThanOrEqual(1);
			// (b) 로컬 프로세스 그룹 정리 및 pgrep 부재 확인
			const sPidsRaw = fs.existsSync(path.join(stateDir, "stream-hang-pids.txt"))
				? fs.readFileSync(path.join(stateDir, "stream-hang-pids.txt"), "utf8")
				: "";
			const sPids = sPidsRaw
				.split("\n")
				.map((s) => Number.parseInt(s.trim(), 10))
				.filter((n) => Number.isFinite(n) && n > 1);
			expect(sPids.length).toBeGreaterThanOrEqual(2);
			for (const pid of sPids) {
				let alive = false;
				try {
					process.kill(pid, 0);
					alive = true;
				} catch {
					alive = false;
				}
				expect(alive).toBe(false);
			}
			const pgrepStream = spawnSync("/usr/bin/pgrep", ["-f", "gjch-r5-stream-hang"], {
				encoding: "utf8",
			});
			expect((pgrepStream.stdout ?? "").trim()).toBe("");
		}
	}, 60_000);
});
