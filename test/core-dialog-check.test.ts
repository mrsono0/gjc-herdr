import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = fs.realpathSync(path.resolve(import.meta.dir, ".."));
const DIALOG_WATCH_PY = path.join(REPO_ROOT, "scripts", "dialog-watch.py");
const CORE_DIALOG_CHECK_PY = path.join(REPO_ROOT, "scripts", "core-dialog-check.py");

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

const REAL_PYTHON3 = resolveRealBinary("python3", [
	"/opt/homebrew/bin/python3",
	"/usr/bin/python3",
]);

function writeExecutable(filePath: string, content: string): void {
	fs.writeFileSync(filePath, content, "utf8");
	fs.chmodSync(filePath, 0o755);
}

describe("core-dialog-check.py 및 dialog-watch.py 분기 (#86 2b)", () => {
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
	role=""
	for arg in "$@"; do
		case "$arg" in
			role=*) role="\${arg#role=}" ;;
		esac
	done
	file="${stateDir}/ls-\${role}.json"
	if [ -f "$file" ]; then
		cat "$file"
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
	if [ -f "${stateDir}/get-\${addr}-\${cnt}.json" ]; then
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

	function seedRole(
		role: "mate" | "critic",
		addr: string,
		getDoc: Record<string, unknown>,
	): void {
		fs.writeFileSync(
			path.join(stateDir, `ls-${role}.json`),
			JSON.stringify({
				terminals: [{ address: addr, name: `gjch-test-86-${role}`, state: "live" }],
				hidden_finished: 0,
				machines: [],
			}),
			"utf8",
		);
		fs.writeFileSync(path.join(stateDir, `get-${addr}.json`), JSON.stringify(getDoc), "utf8");
	}

	test("1. 진입점 dialog-watch.py: GJCH_CORE 미설정 시 core-dialog-check.py 미호출, GJCH_CORE=1일 때만 execv", () => {
		const fakeRepo = path.join(tmpDir, "fake-repo");
		const fakeScripts = path.join(fakeRepo, "scripts");
		fs.mkdirSync(fakeScripts, { recursive: true });
		fs.copyFileSync(DIALOG_WATCH_PY, path.join(fakeScripts, "dialog-watch.py"));
		const marker = path.join(stateDir, "core-dialog-marker.txt");
		fs.writeFileSync(
			path.join(fakeScripts, "core-dialog-check.py"),
			`import sys
with open(${JSON.stringify(marker)}, "w", encoding="utf-8") as f:
    f.write("called:" + " ".join(sys.argv[1:]))
sys.exit(66)
`,
			"utf8",
		);

		// 스위치 off: --names ""로 기존 dialog-watch.py 본문이 rc 2 종료하며 core-dialog-check.py는 호출되지 않음
		const offRes = spawnSync(
			REAL_PYTHON3,
			[path.join(fakeScripts, "dialog-watch.py"), "--names", ""],
			{
				cwd: fakeRepo,
				encoding: "utf8",
				env: buildEnv({ GJCH_CORE: undefined }),
			},
		);
		expect(offRes.status).toBe(2);
		expect(fs.existsSync(marker)).toBe(false);

		// 스위치 on: core-dialog-check.py로 os.execv하며 인자 그대로 전달
		const onRes = spawnSync(
			REAL_PYTHON3,
			[path.join(fakeScripts, "dialog-watch.py"), "--once", "--names", "mate"],
			{
				cwd: fakeRepo,
				encoding: "utf8",
				env: buildEnv({ GJCH_CORE: "1" }),
			},
		);
		expect(onRes.status).toBe(66);
		expect(fs.existsSync(marker)).toBe(true);
		expect(fs.readFileSync(marker, "utf8").trim()).toBe("called:--once --names mate");

		// F6: 가드 실패 각 경우(GJCH_CORE!=1, GJCH_TEAM_ROLE 설정, GJCH_EXTERNAL_LEAD!=1, cwd 저장소 밖, 연결 worktree) hc 호출 0회·상태 파일 0개 및 임의 역할 거부
		const guardStateFile = path.join(stateDir, "guard-never.state");
		seedRole("mate", "t1m", {
			address: "t1m",
			state: "live",
			reported: true,
			status: { state: "blocked", kind: "permission", msg: "should not be queried" },
		});

		// (a) GJCH_CORE != 1 -> rc 2 안내, hc 0회, 상태 파일 0개
		const noCoreRes = spawnSync(
			REAL_PYTHON3,
			[CORE_DIALOG_CHECK_PY, "--once", "--state", guardStateFile],
			{ cwd: REPO_ROOT, encoding: "utf8", env: buildEnv({ GJCH_CORE: undefined }) },
		);
		expect(noCoreRes.status).toBe(2);
		expect(noCoreRes.stderr).toContain("GJCH_CORE=1에서만 실행합니다.");
		expect(readHcCalls()).toEqual([]);
		expect(fs.existsSync(guardStateFile)).toBe(false);

		// (b) GJCH_TEAM_ROLE 있음 -> 조용히 rc 0, hc 0회, 상태 파일 0개
		const roleRes = spawnSync(
			REAL_PYTHON3,
			[CORE_DIALOG_CHECK_PY, "--once", "--state", guardStateFile],
			{ cwd: REPO_ROOT, encoding: "utf8", env: buildEnv({ GJCH_TEAM_ROLE: "mate" }) },
		);
		expect(roleRes.status).toBe(0);
		expect(roleRes.stdout).toBe("");
		expect(roleRes.stderr).toBe("");
		expect(readHcCalls()).toEqual([]);
		expect(fs.existsSync(guardStateFile)).toBe(false);

		// (c) GJCH_EXTERNAL_LEAD != 1 -> 상시 모드는 rc 0, --once는 안내 rc 2, hc 0회, 상태 파일 0개
		const noExtWatchRes = spawnSync(
			REAL_PYTHON3,
			[CORE_DIALOG_CHECK_PY, "--state", guardStateFile],
			{ cwd: REPO_ROOT, encoding: "utf8", env: buildEnv({ GJCH_EXTERNAL_LEAD: undefined }) },
		);
		expect(noExtWatchRes.status).toBe(0);
		expect(readHcCalls()).toEqual([]);
		expect(fs.existsSync(guardStateFile)).toBe(false);

		const noExtOnceRes = spawnSync(
			REAL_PYTHON3,
			[CORE_DIALOG_CHECK_PY, "--once", "--state", guardStateFile],
			{ cwd: REPO_ROOT, encoding: "utf8", env: buildEnv({ GJCH_EXTERNAL_LEAD: undefined }) },
		);
		expect(noExtOnceRes.status).toBe(2);
		expect(noExtOnceRes.stderr).toContain("Core 외부 팀장");
		expect(readHcCalls()).toEqual([]);
		expect(fs.existsSync(guardStateFile)).toBe(false);

		// (d) cwd(CLAUDE_PROJECT_DIR 또는 PWD)가 ROOT 밖 -> hc 0회, 상태 파일 0개
		const outCwdRes = spawnSync(
			REAL_PYTHON3,
			[CORE_DIALOG_CHECK_PY, "--once", "--state", guardStateFile],
			{ cwd: tmpDir, encoding: "utf8", env: buildEnv() },
		);
		expect(outCwdRes.status).toBe(2);
		expect(outCwdRes.stderr).toContain("현재 경로가 저장소 밖");
		expect(readHcCalls()).toEqual([]);
		expect(fs.existsSync(guardStateFile)).toBe(false);

		const outClaudeDirRes = spawnSync(
			REAL_PYTHON3,
			[CORE_DIALOG_CHECK_PY, "--once", "--state", guardStateFile],
			{ cwd: REPO_ROOT, encoding: "utf8", env: buildEnv({ CLAUDE_PROJECT_DIR: tmpDir }) },
		);
		expect(outClaudeDirRes.status).toBe(2);
		expect(outClaudeDirRes.stderr).toContain("현재 경로가 저장소 밖");
		expect(readHcCalls()).toEqual([]);
		expect(fs.existsSync(guardStateFile)).toBe(false);

		// (e) 연결 worktree(.claude/worktrees/ 경로) -> 안내 rc 0, hc 0회, 상태 파일 0개
		const wtRoot = path.join(tmpDir, ".claude", "worktrees", "wt1");
		const wtScripts = path.join(wtRoot, "scripts");
		fs.mkdirSync(wtScripts, { recursive: true });
		fs.copyFileSync(CORE_DIALOG_CHECK_PY, path.join(wtScripts, "core-dialog-check.py"));
		fs.copyFileSync(
			path.join(REPO_ROOT, "scripts", "worktree-guard.sh"),
			path.join(wtScripts, "worktree-guard.sh"),
		);
		const wtRes = spawnSync(
			REAL_PYTHON3,
			[path.join(wtScripts, "core-dialog-check.py"), "--once", "--state", guardStateFile],
			{ cwd: wtRoot, encoding: "utf8", env: buildEnv() },
		);
		expect(wtRes.status).toBe(0);
		expect(wtRes.stderr).toContain("연결 worktree에서 실행 중");
		expect(readHcCalls()).toEqual([]);
		expect(fs.existsSync(guardStateFile)).toBe(false);

		// (f) 임의 역할(--names) 거부 -> 고정 오류(원문 미출력) rc 2, hc 0회, 상태 파일 0개
		const badRoleRes = spawnSync(
			REAL_PYTHON3,
			[
				CORE_DIALOG_CHECK_PY,
				"--once",
				"--names",
				"mate,arbitrary_role_secret_999",
				"--state",
				guardStateFile,
			],
			{ cwd: REPO_ROOT, encoding: "utf8", env: buildEnv() },
		);
		expect(badRoleRes.status).toBe(2);
		expect(badRoleRes.stderr).toContain("허용되지 않는 역할입니다");
		expect(badRoleRes.stderr).not.toContain("arbitrary_role_secret_999");
		expect(readHcCalls()).toEqual([]);
		expect(fs.existsSync(guardStateFile)).toBe(false);
	});

	test("2. --once 모드: none(rc 0) / DIALOG(rc 10) / UNKNOWN(rc 2), 상태 파일 미생성 및 msg 원문 미출력", () => {
		const stateFile = path.join(stateDir, "once.state");
		seedRole("mate", "t1m", {
			address: "t1m",
			state: "live",
			reported: true,
			status: { state: "idle", kind: null, msg: "normal idle msg" },
		});
		seedRole("critic", "t2c", {
			address: "t2c",
			state: "live",
			reported: true,
			status: { state: "working", kind: null, msg: "working msg" },
		});

		// (a) 유효한 조회 + blocked 없음 -> none (rc 0), 상태 파일 미생성
		const noneRes = spawnSync(
			REAL_PYTHON3,
			[CORE_DIALOG_CHECK_PY, "--once", "--state", stateFile],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
			},
		);
		expect(noneRes.status).toBe(0);
		expect(noneRes.stdout.trim()).toBe("none");
		expect(fs.existsSync(stateFile)).toBe(false);
		expect(fs.existsSync(path.join(REPO_ROOT, "scripts", "__pycache__"))).toBe(false);

		// (b) blocked 감지 -> DIALOG <role> <kind> msglen=<n> (rc 10), 상태 파일 미생성, msg 원문 미출력
		const secretPrompt = "Allow command sk-secret987654? 550e8400-e29b-41d4-a716-446655440000";
		seedRole("critic", "t2c", {
			address: "t2c",
			state: "live",
			reported: true,
			status: { state: "blocked", kind: "question", msg: secretPrompt },
		});
		const dlgRes = spawnSync(
			REAL_PYTHON3,
			[CORE_DIALOG_CHECK_PY, "--once", "--state", stateFile],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
			},
		);
		expect(dlgRes.status).toBe(10);
		expect(dlgRes.stdout.trim()).toBe(`DIALOG critic question msglen=${secretPrompt.length}`);
		expect(dlgRes.stdout).not.toContain("sk-secret987654");
		expect(dlgRes.stdout).not.toContain("550e8400-e29b-41d4-a716-446655440000");
		expect(fs.existsSync(stateFile)).toBe(false);

		// (c) UNKNOWN(state=finished, reported=false, 없음 등) -> UNKNOWN <role> <이유> 출력 후 rc 2(none 미출력)
		seedRole("mate", "t1m", {
			address: "t1m",
			state: "finished",
			reported: true,
			status: null,
		});
		seedRole("critic", "t2c", {
			address: "t2c",
			state: "live",
			reported: false,
			status: null,
		});
		const unkRes = spawnSync(
			REAL_PYTHON3,
			[CORE_DIALOG_CHECK_PY, "--once", "--state", stateFile],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
			},
		);
		expect(unkRes.status).toBe(2);
		expect(unkRes.stdout).toContain("UNKNOWN mate state=finished");
		expect(unkRes.stdout).toContain("UNKNOWN critic 미보고(reported=false)");
		expect(unkRes.stdout).not.toContain("none");
		expect(fs.existsSync(stateFile)).toBe(false);
		assertReadOnlyHcCalls(readHcCalls());
	});

	test("3. 상시 모드: DIALOG(rc 10), 상태 파일 (role, kind, msglen)만 기록(msg 원문·주소 없음), 중복 방지 후 timeout(rc 0), UNKNOWN 뒤 계속 감시", () => {
		const stateFile = path.join(stateDir, "watch.state");
		const secretMsg = "Do you trust folder /Users/secret/path sk-abcdef123456?";

		// 1회차 폴링: mate가 미보고(UNKNOWN) -> 상시 모드는 종료하지 않고 계속 폴링 -> 2회차 폴링: mate가 blocked -> DIALOG rc 10
		fs.writeFileSync(
			path.join(stateDir, "ls-mate.json"),
			JSON.stringify({
				terminals: [{ address: "t1m", name: "gjch-test-86-mate", state: "live" }],
				hidden_finished: 0,
				machines: [],
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "get-t1m-1.json"),
			JSON.stringify({
				address: "t1m",
				state: "live",
				reported: false,
				status: null,
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "get-t1m.json"),
			JSON.stringify({
				address: "t1m",
				state: "live",
				reported: true,
				status: { state: "blocked", kind: "permission", msg: secretMsg },
			}),
			"utf8",
		);

		const watchRes = spawnSync(
			REAL_PYTHON3,
			[
				CORE_DIALOG_CHECK_PY,
				"--names",
				"mate",
				"--interval",
				"0.05",
				"--timeout",
				"5",
				"--state",
				stateFile,
			],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
			},
		);
		expect(watchRes.status).toBe(10);
		const outLines = watchRes.stdout.trim().split("\n");
		expect(outLines).toEqual([
			"UNKNOWN mate 미보고(reported=false)",
			`DIALOG mate permission msglen=${secretMsg.length}`,
		]);

		// 상태 파일 검증: 오직 (role, kind, msglen) 세 키만 존재하고 msg 원문이나 address("t1m")는 없어야 함
		expect(fs.existsSync(stateFile)).toBe(true);
		const rawStateText = fs.readFileSync(stateFile, "utf8");
		expect(rawStateText).not.toContain(secretMsg);
		expect(rawStateText).not.toContain("sk-abcdef123456");
		expect(rawStateText).not.toContain("t1m");
		expect(rawStateText).not.toContain("my-secret-session-uuid");
		const parsedState = JSON.parse(rawStateText);
		expect(Object.keys(parsedState).sort()).toEqual(["kind", "msglen", "role"]);
		expect(parsedState).toEqual({
			role: "mate",
			kind: "permission",
			msglen: secretMsg.length,
		});

		// 같은 (role, kind, msglen) 상태가 유지된 채 다시 상시 감시를 돌리면 중복 알림을 건너뛰고 timeout(DIALOG-WATCH timeout, rc 0)으로 종료
		const dedupRes = spawnSync(
			REAL_PYTHON3,
			[
				CORE_DIALOG_CHECK_PY,
				"--names",
				"mate",
				"--interval",
				"0.05",
				"--timeout",
				"0.15",
				"--state",
				stateFile,
			],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
			},
		);
		expect(dedupRes.status).toBe(0);
		expect(dedupRes.stdout.trim()).toBe("DIALOG-WATCH timeout");
		assertReadOnlyHcCalls(readHcCalls());
	});
});
