import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = fs.realpathSync(path.resolve(import.meta.dir, ".."));
const MATE_WATCH_SH = path.join(REPO_ROOT, "scripts", "mate-watch.sh");
const CORE_MATE_WATCH_SH = path.join(REPO_ROOT, "scripts", "core-mate-watch.sh");

const STRIPPED_ENV_KEYS = [
	"GJCH_CORE",
	"GJCH_CORE_TEAM",
	"GJCH_HC_BIN",
	"GJCH_EXTERNAL_LEAD",
	"HERDR_ENV",
	"HERDR_PANE_ID",
	"HERDR_WORKSPACE_ID",
	"CLAUDE_PROJECT_DIR",
	"GJCH_TEAM_ROLE",
	"GJCH_LEAD_LOCK",
	"GJCH_MATE_NAME",
	"GJCH_MATE_WATCH_INTERVAL",
	"GJCH_MATE_WATCH_STALL",
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

describe("core-mate-watch.sh 및 mate-watch.sh 분기 (#86 2b)", () => {
	let tmpDir = "";
	let binDir = "";
	let stateDir = "";
	let tmpHome = "";
	let hcCallsLog = "";

	beforeAll(() => {
		const rawTmp = fs.mkdtempSync("/tmp/gjch-t-core-2b-");
		tmpDir = fs.realpathSync(rawTmp);
		binDir = path.join(tmpDir, "bin");
		stateDir = path.join(tmpDir, "state");
		tmpHome = path.join(tmpDir, "home");
		hcCallsLog = path.join(tmpDir, "hc-calls.log");

		fs.mkdirSync(binDir, { recursive: true });
		fs.mkdirSync(stateDir, { recursive: true });
		fs.mkdirSync(tmpHome, { recursive: true });

		fs.symlinkSync(REAL_GIT, path.join(binDir, "git"));
		fs.symlinkSync(REAL_PYTHON3, path.join(binDir, "python3"));

		writeExecutable(
			path.join(binDir, "hc"),
			`#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(hcCallsLog)}
sub="\${1:-}"
scenario="\${HC_STUB_SCENARIO:-default}"
if [ "$sub" = "ls" ]; then
	if [ "$scenario" = "ls_error" ]; then
		printf '{"error":{"kind":"unavailable","message":"core down"}}\\n' >&2
		exit 5
	fi
	if [ -f "${stateDir}/ls-mate.json" ]; then
		cat "${stateDir}/ls-mate.json"
		exit 0
	fi
	printf '{"terminals":[],"hidden_finished":0,"machines":[]}\\n'
	exit 0
fi
if [ "$sub" = "get" ]; then
	addr="\${3:-}"
	cnt=0
	if [ -f "${stateDir}/get-count.txt" ]; then
		cnt="$(cat "${stateDir}/get-count.txt")"
	fi
	cnt=$((cnt + 1))
	printf '%s' "$cnt" > "${stateDir}/get-count.txt"
	if [ "$scenario" = "get_always_fail" ]; then
		printf '{"error":{"kind":"unavailable","message":"fail"}}\\n' >&2
		exit 5
	fi
	if [ -f "${stateDir}/get-fail-on-\${cnt}.txt" ]; then
		printf '%s:fail\\n' "$cnt" >> "${stateDir}/get-seq.log"
		printf '{"error":{"kind":"unavailable","message":"transient"}}\\n' >&2
		exit 5
	fi
	if [ -f "${stateDir}/get-\${addr}-\${cnt}.json" ]; then
		if [ -f "${stateDir}/write-result-on-\${cnt}.txt" ] && [ -n "\${TEST_RESULT_FILE:-}" ]; then
			cat "${stateDir}/write-result-on-\${cnt}.txt" > "\$TEST_RESULT_FILE"
		fi
		printf '%s:step\\n' "$cnt" >> "${stateDir}/get-seq.log"
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
exit 99
`,
		);
	});

	beforeEach(() => {
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(stateDir, { recursive: true, force: true });
		fs.mkdirSync(stateDir, { recursive: true });
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
			GJCH_MATE_WATCH_INTERVAL: "1",
			GJCH_MATE_WATCH_STALL: "1",
			CLAUDE_CODE_SESSION_ID: "my-secret-session-uuid-12345678",
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

	function assertReadOnlyHcCalls(calls: string[]): void {
		for (const c of calls) {
			expect(c.startsWith("ls ") || c.startsWith("get ")).toBe(true);
			expect(c.startsWith("read ")).toBe(false);
			expect(c.startsWith("attach ")).toBe(false);
			expect(c.startsWith("send ")).toBe(false);
			expect(c.startsWith("keys ")).toBe(false);
			expect(c.startsWith("run ")).toBe(false);
			expect(c.startsWith("kill ")).toBe(false);
			expect(c.startsWith("rm ")).toBe(false);
		}
	}

	function seedMateLs(addresses: string[] = ["t1m"]): void {
		fs.writeFileSync(
			path.join(stateDir, "ls-mate.json"),
			JSON.stringify({
				terminals: addresses.map((address) => ({
					address,
					name: "gjch-test-86-mate",
					state: "live",
					where: "lfi / 1",
				})),
				hidden_finished: 0,
				machines: [],
			}),
			"utf8",
		);
	}

	function makeMateGet(overrides?: Record<string, unknown>): Record<string, unknown> {
		return {
			address: "t1m",
			name: "gjch-test-86-mate",
			state: "live",
			reported: true,
			turn: 1,
			cwd: REPO_ROOT,
			argv: ["agy", "--model", "gemini-4-argon-high", "--mode", "accept-edits", "--sandbox"],
			labels: { team: "gjch-test-86", role: "mate" },
			status: {
				state: "idle",
				kind: null,
				msg: "SECRET_MATE_MSG_sk-1234567890",
			},
			...overrides,
		};
	}

	test("1. 진입점 mate-watch.sh: GJCH_CORE 미설정 시 core-mate-watch.sh 미호출, GJCH_CORE=1일 때만 exec 및 인자 전달", () => {
		const fakeRepo = path.join(tmpDir, "fake-repo");
		const fakeScripts = path.join(fakeRepo, "scripts");
		fs.mkdirSync(fakeScripts, { recursive: true });
		fs.copyFileSync(MATE_WATCH_SH, path.join(fakeScripts, "mate-watch.sh"));
		const marker = path.join(stateDir, "core-mate-watch-marker.txt");
		writeExecutable(
			path.join(fakeScripts, "core-mate-watch.sh"),
			`#!/bin/sh
printf 'called:%s\\n' "$*" > ${JSON.stringify(marker)}
exit 77
`,
		);

		// 스위치 off: 인자 부족(1개)으로 기존 mate-watch.sh 본문이 rc 2로 종료하며 core-mate-watch.sh는 호출되지 않음
		const offRes = spawnSync("/bin/bash", [path.join(fakeScripts, "mate-watch.sh"), "only-one"], {
			cwd: fakeRepo,
			encoding: "utf8",
			env: buildEnv({ GJCH_CORE: undefined }),
		});
		expect(offRes.status).toBe(2);
		expect(fs.existsSync(marker)).toBe(false);

		// 스위치 on: core-mate-watch.sh로 exec하며 인자 그대로 전달
		const onRes = spawnSync(
			"/bin/bash",
			[path.join(fakeScripts, "mate-watch.sh"), "res.md", "#86 완료", "30"],
			{
				cwd: fakeRepo,
				encoding: "utf8",
				env: buildEnv({ GJCH_CORE: "1" }),
			},
		);
		expect(onRes.status).toBe(77);
		expect(fs.existsSync(marker)).toBe(true);
		expect(fs.readFileSync(marker, "utf8").trim()).toBe("called:res.md #86 완료 30");
	});

	test("2. DONE(rc 0) 및 DIALOG(rc 10, msg 원문 미출력) 판정", () => {
		const resFile = path.join(stateDir, "result-done.md");
		seedMateLs(["t1m"]);
		fs.writeFileSync(
			path.join(stateDir, "get-t1m-1.json"),
			JSON.stringify(makeMateGet({ status: { state: "idle", kind: null, msg: "done" } })),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "write-result-on-1.txt"),
			"본문\n#86 2b 완료\n",
			"utf8",
		);

		const doneRes = spawnSync(
			"/bin/bash",
			[CORE_MATE_WATCH_SH, resFile, "#86 2b 완료", "10"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ TEST_RESULT_FILE: resFile }),
			},
		);
		expect(doneRes.status).toBe(0);
		expect(doneRes.stdout.trim()).toMatch(/^DONE \d{2}:\d{2}:\d{2}$/);
		assertReadOnlyHcCalls(readHcCalls());

		// F7: 시작 시점에 이미 결과 파일에 완료 줄이 있으면 core_find 전에 DONE 0 반환 (ls 0개 / ls 조회 실패 두 경우 모두 DONE 0)
		const preDoneFile = path.join(stateDir, "already-done.md");
		fs.writeFileSync(preDoneFile, "선행 결과\n#86 2b 완료\n", "utf8");
		fs.rmSync(hcCallsLog, { force: true });
		seedMateLs([]);
		const preDoneZeroLs = spawnSync(
			"/bin/bash",
			[CORE_MATE_WATCH_SH, preDoneFile, "#86 2b 완료", "10"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
			},
		);
		expect(preDoneZeroLs.status).toBe(0);
		expect(preDoneZeroLs.stdout.trim()).toMatch(/^DONE \d{2}:\d{2}:\d{2}$/);
		expect(readHcCalls()).toEqual([]);

		const preDoneErrLs = spawnSync(
			"/bin/bash",
			[CORE_MATE_WATCH_SH, preDoneFile, "#86 2b 완료", "10"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ HC_STUB_SCENARIO: "ls_error" }),
			},
		);
		expect(preDoneErrLs.status).toBe(0);
		expect(preDoneErrLs.stdout.trim()).toMatch(/^DONE \d{2}:\d{2}:\d{2}$/);
		expect(readHcCalls()).toEqual([]);

		// DIALOG: blocked 상태 시 DIALOG mate <kind> msglen=<n> 출력 후 rc 10, msg 원문 미출력
		seedMateLs(["t1m"]);
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "get-count.txt"), { force: true });
		fs.rmSync(path.join(stateDir, "get-t1m-1.json"), { force: true });
		fs.rmSync(path.join(stateDir, "write-result-on-1.txt"), { force: true });
		const secretMsg = "Run command sk-secret999999? 550e8400-e29b-41d4-a716-446655440000";
		fs.writeFileSync(
			path.join(stateDir, "get-t1m.json"),
			JSON.stringify(
				makeMateGet({
					status: {
						state: "blocked",
						kind: "permission",
						msg: secretMsg,
					},
				}),
			),
			"utf8",
		);
		const dialogRes = spawnSync(
			"/bin/bash",
			[CORE_MATE_WATCH_SH, path.join(stateDir, "no-result.md"), "#86 2b 완료", "10"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
			},
		);
		expect(dialogRes.status).toBe(10);
		expect(dialogRes.stdout.trim()).toBe(`DIALOG mate permission msglen=${secretMsg.length}`);
		expect(dialogRes.stdout).not.toContain("sk-secret999999");
		expect(dialogRes.stdout).not.toContain("550e8400-e29b-41d4-a716-446655440000");
		assertReadOnlyHcCalls(readHcCalls());
	});

	test("3a. NO_RESULT(rc 11, GJCH_MATE_WATCH_STALL=1 단축) 판정", () => {
		const resFile = path.join(stateDir, "missing-result.md");
		seedMateLs(["t1m"]);
		// 1회차 폴링: working -> 2·3회차 폴링: idle 유지(stall 1초 이상 경과, 완료 줄 없음) -> NO_RESULT idle (rc 11)
		fs.writeFileSync(
			path.join(stateDir, "get-t1m-1.json"),
			JSON.stringify(makeMateGet({ status: { state: "working", kind: null } })),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "get-t1m.json"),
			JSON.stringify(makeMateGet({ status: { state: "idle", kind: null } })),
			"utf8",
		);

		const noRes = spawnSync(
			"/bin/bash",
			[CORE_MATE_WATCH_SH, resFile, "#86 2b 완료", "10"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ GJCH_MATE_WATCH_INTERVAL: "1", GJCH_MATE_WATCH_STALL: "1" }),
			},
		);
		expect(noRes.status).toBe(11);
		expect(noRes.stdout.trim()).toMatch(/^NO_RESULT idle \d{2}:\d{2}:\d{2}$/);
		assertReadOnlyHcCalls(readHcCalls());
	});

	test("3b. 실제 짧은 sleep(STALL=2, INTERVAL=1)에서 재작업(working)·조회 실패 1회 시 stall 리셋 후 DONE(rc 0) 및 TIMEOUT(rc 1)", () => {
		const resFile = path.join(stateDir, "reset-result.md");
		seedMateLs(["t1m"]);
		// 리셋이 없으면 2회차(t=1s, idle 시작) 후 4회차(t=3s, 3-1=2>=STALL)에서 NO_RESULT가 발생한다.
		// (a) 1:working(t=0s) -> 2:idle(t=1s, stall_since=1) -> 3:working(t=2s, 재작업 리셋!) -> 4:idle(t=3s, stall_since=3) -> 5:done+완료줄(t=4s) -> DONE(rc 0)
		fs.writeFileSync(
			path.join(stateDir, "get-t1m-1.json"),
			JSON.stringify(makeMateGet({ status: { state: "working", kind: null } })),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "get-t1m-2.json"),
			JSON.stringify(makeMateGet({ status: { state: "idle", kind: null } })),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "get-t1m-3.json"),
			JSON.stringify(makeMateGet({ status: { state: "working", kind: null } })),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "get-t1m-4.json"),
			JSON.stringify(makeMateGet({ status: { state: "idle", kind: null } })),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "get-t1m-5.json"),
			JSON.stringify(makeMateGet({ status: { state: "done", kind: null } })),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "write-result-on-5.txt"),
			"재작업 완료\n#86 2b 완료\n",
			"utf8",
		);

		const resetDone = spawnSync(
			"/bin/bash",
			[CORE_MATE_WATCH_SH, resFile, "#86 2b 완료", "15"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({
					GJCH_MATE_WATCH_INTERVAL: "1",
					GJCH_MATE_WATCH_STALL: "2",
					TEST_RESULT_FILE: resFile,
				}),
			},
		);
		expect(resetDone.status).toBe(0);
		expect(resetDone.stdout.trim()).toMatch(/^DONE \d{2}:\d{2}:\d{2}$/);
		expect(
			fs.readFileSync(path.join(stateDir, "get-seq.log"), "utf8").trim().split("\n"),
		).toEqual(["1:step", "2:step", "3:step", "4:step", "5:step"]);
		expect(readHcCalls()).toEqual([
			"ls --json --label team=gjch-test-86 --label role=mate",
			"get --json t1m",
			"get --json t1m",
			"get --json t1m",
			"get --json t1m",
			"get --json t1m",
		]);

		// (b) 조회 실패 1회 리셋: 1:working(t=0s) -> 2:idle(t=1s, stall_since=1) -> 3:get 실패 1회(t=2s, 리셋!) -> 4:idle(t=3s, stall_since=3) -> 5:done+완료줄(t=4s) -> DONE(rc 0)
		const resFile2 = path.join(stateDir, "reset-fail-result.md");
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "get-count.txt"), { force: true });
		fs.rmSync(path.join(stateDir, "get-seq.log"), { force: true });
		fs.rmSync(path.join(stateDir, "get-t1m-3.json"), { force: true });
		fs.writeFileSync(path.join(stateDir, "get-fail-on-3.txt"), "fail-once\n", "utf8");

		const failResetDone = spawnSync(
			"/bin/bash",
			[CORE_MATE_WATCH_SH, resFile2, "#86 2b 완료", "15"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({
					GJCH_MATE_WATCH_INTERVAL: "1",
					GJCH_MATE_WATCH_STALL: "2",
					TEST_RESULT_FILE: resFile2,
				}),
			},
		);
		expect(failResetDone.status).toBe(0);
		expect(failResetDone.stdout.trim()).toMatch(/^DONE \d{2}:\d{2}:\d{2}$/);
		expect(
			fs.readFileSync(path.join(stateDir, "get-seq.log"), "utf8").trim().split("\n"),
		).toEqual(["1:step", "2:step", "3:fail", "4:step", "5:step"]);
		expect(readHcCalls()).toEqual([
			"ls --json --label team=gjch-test-86 --label role=mate",
			"get --json t1m",
			"get --json t1m",
			"get --json t1m",
			"get --json t1m",
			"get --json t1m",
		]);

		// TIMEOUT: 계속 working 상태로 1초 상한 도달 -> TIMEOUT (rc 1)
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "get-count.txt"), { force: true });
		fs.rmSync(path.join(stateDir, "get-fail-on-3.txt"), { force: true });
		for (const i of [1, 2, 3, 4, 5]) {
			fs.rmSync(path.join(stateDir, `get-t1m-${i}.json`), { force: true });
		}
		fs.rmSync(path.join(stateDir, "write-result-on-5.txt"), { force: true });
		fs.writeFileSync(
			path.join(stateDir, "get-t1m.json"),
			JSON.stringify(makeMateGet({ status: { state: "working", kind: null } })),
			"utf8",
		);
		const timeoutRes = spawnSync(
			"/bin/bash",
			[CORE_MATE_WATCH_SH, path.join(stateDir, "never.md"), "#86 2b 완료", "1"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ GJCH_MATE_WATCH_INTERVAL: "1", GJCH_MATE_WATCH_STALL: "60" }),
			},
		);
		expect(timeoutRes.status).toBe(1);
		expect(timeoutRes.stdout.trim()).toBe("TIMEOUT");
		assertReadOnlyHcCalls(readHcCalls());
	}, 15_000);

	test("4. UNKNOWN(rc 12): 없음 / 라벨 중복 / ls 실패 / state=finished / reported=false / get 5회 연속 실패", () => {
		const resFile = path.join(stateDir, "un-result.md");

		// (a) mate 없음 (ls 0개) -> UNKNOWN mate 없음 (rc 12)
		seedMateLs([]);
		const absentRes = spawnSync("/bin/bash", [CORE_MATE_WATCH_SH, resFile, "#86 완료", "5"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv(),
		});
		expect(absentRes.status).toBe(12);
		expect(absentRes.stdout.trim()).toBe("UNKNOWN mate 없음");

		// (b) 라벨 중복 (2개+) -> UNKNOWN mate 라벨 중복(2개 이상) (rc 12)
		seedMateLs(["t1m", "t2m"]);
		const dupRes = spawnSync("/bin/bash", [CORE_MATE_WATCH_SH, resFile, "#86 완료", "5"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv(),
		});
		expect(dupRes.status).toBe(12);
		expect(dupRes.stdout.trim()).toBe("UNKNOWN mate 라벨 중복(2개 이상)");

		// (c) ls 실패 -> UNKNOWN mate ls 조회 실패 (rc 12)
		const lsErrRes = spawnSync("/bin/bash", [CORE_MATE_WATCH_SH, resFile, "#86 완료", "5"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv({ HC_STUB_SCENARIO: "ls_error" }),
		});
		expect(lsErrRes.status).toBe(12);
		expect(lsErrRes.stdout.trim()).toBe("UNKNOWN mate ls 조회 실패");

		// (d) state=finished -> UNKNOWN mate state=finished (rc 12)
		seedMateLs(["t1m"]);
		fs.writeFileSync(
			path.join(stateDir, "get-t1m.json"),
			JSON.stringify(makeMateGet({ state: "finished", status: null })),
			"utf8",
		);
		const finRes = spawnSync("/bin/bash", [CORE_MATE_WATCH_SH, resFile, "#86 완료", "5"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv(),
		});
		expect(finRes.status).toBe(12);
		expect(finRes.stdout.trim()).toBe("UNKNOWN mate state=finished");

		// (e) reported=false -> UNKNOWN mate 미보고(reported=false) (rc 12)
		fs.writeFileSync(
			path.join(stateDir, "get-t1m.json"),
			JSON.stringify(makeMateGet({ reported: false, status: null })),
			"utf8",
		);
		const unrepRes = spawnSync("/bin/bash", [CORE_MATE_WATCH_SH, resFile, "#86 완료", "5"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv(),
		});
		expect(unrepRes.status).toBe(12);
		expect(unrepRes.stdout.trim()).toBe("UNKNOWN mate 미보고(reported=false)");

		// (f) get 조회 연속 실패 5회 -> UNKNOWN mate get 조회 연속 실패(5회) (rc 12)
		// 빠른 검증을 위해 sleep 스텁을 binDir에 잠시 두어 5회 폴링이 즉시 돌게 한다.
		writeExecutable(path.join(binDir, "sleep"), "#!/bin/sh\nexit 0\n");
		try {
			fs.rmSync(path.join(stateDir, "get-count.txt"), { force: true });
			const fail5Res = spawnSync(
				"/bin/bash",
				[CORE_MATE_WATCH_SH, resFile, "#86 완료", "30"],
				{
					cwd: REPO_ROOT,
					encoding: "utf8",
					env: buildEnv({ HC_STUB_SCENARIO: "get_always_fail" }),
				},
			);
			expect(fail5Res.status).toBe(12);
			expect(fail5Res.stdout.trim()).toBe("UNKNOWN mate get 조회 연속 실패(5회)");
			expect(fs.readFileSync(path.join(stateDir, "get-count.txt"), "utf8").trim()).toBe("5");
		} finally {
			fs.rmSync(path.join(binDir, "sleep"), { force: true });
		}
		assertReadOnlyHcCalls(readHcCalls());
	});
});
