import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = fs.realpathSync(path.resolve(import.meta.dir, ".."));
const CORE_LIB_SH = path.join(REPO_ROOT, "scripts", "core-lib.sh");
const CORE_TEAM_SH = path.join(REPO_ROOT, "scripts", "core-team.sh");
const TEAM_UP_SH = path.join(REPO_ROOT, "scripts", "team-up.sh");
const CHECK_ENV_SH = path.join(REPO_ROOT, "scripts", "check-env.sh");

const CODEX_STATUS_LINE =
	'tui.status_line=["context-remaining","total-input-tokens","total-output-tokens"]';

const STRIPPED_ENV_KEYS = [
	"GJCH_CORE",
	"GJCH_CORE_TEAM",
	"GJCH_HC_BIN",
	"GJCH_CORE_DOWN_INTERVAL",
	"GJCH_CORE_DOWN_RETRIES",
	"GJCH_EXTERNAL_LEAD",
	"HERDR_ENV",
	"HERDR_PANE_ID",
	"HERDR_WORKSPACE_ID",
	"CLAUDE_PROJECT_DIR",
	"GJCH_TEAM_ROLE",
	"GJCH_LEAD_LOCK",
	"GJCH_LEAD_NAME",
	"GJCH_DEPUTY_NAME",
	"GJCH_MATE_NAME",
	"GJCH_CRITIC_NAME",
	"GJCH_MATE_MODEL",
	"GJCH_CODEX_MODEL",
	"GJCH_CODEX_DOC_MAX_BYTES",
	"GJCH_TEAM_CODEX",
	"GJCH_WS_LABEL",
	"GJCH_FROM_HOOK",
	"GJCH_ARGV_CHECKER",
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
const REAL_NOHUP = resolveRealBinary("nohup", ["/usr/bin/nohup", "/opt/homebrew/bin/nohup"]);
const REAL_PYTHON3 = resolveRealBinary("python3", [
	"/opt/homebrew/bin/python3",
	"/usr/bin/python3",
]);

function writeExecutable(filePath: string, content: string): void {
	fs.writeFileSync(filePath, content, "utf8");
	fs.chmodSync(filePath, 0o755);
}

describe("core-lib.sh / core-team.sh / team-up.sh 분기 / check-env.sh 분기 (#86 2a)", () => {
	let tmpDir = "";
	let binDir = "";
	let stateDir = "";
	let tmpHome = "";
	let hcCallsLog = "";
	let herdrCallsLog = "";
	let lockPath = "";
	let mySockPath = "";
	let otherSockPath = "";
	let staleSockPath = "";

	function makeMateTerminal(overrides?: Record<string, unknown>): Record<string, unknown> {
		const validArgv = [
			"agy",
			"--model",
			"gemini-4-argon-high",
			"--mode",
			"accept-edits",
			"--sandbox",
		];
		return {
			address: "t1m",
			name: "gjch-test-86-mate",
			state: "live",
			reported: true,
			turn: 1,
			cwd: REPO_ROOT,
			argv: validArgv,
			labels: { team: "gjch-test-86", role: "mate" },
			status: {
				state: "idle",
				kind: null,
				msg: "SECRET_RAW_STATUS_MSG_SHOULD_NOT_LEAK",
				app: "antigravity",
			},
			foreground: {
				pid: 51001,
				name: "agy",
				argv: validArgv,
				cwd: REPO_ROOT,
			},
			...overrides,
		};
	}

	function makeCriticTerminal(overrides?: Record<string, unknown>): Record<string, unknown> {
		const validArgv = [
			"codex",
			"--no-daemon",
			"--yolo",
			"-m",
			"gpt-6.1-sol",
			"-C",
			REPO_ROOT,
			"--disable",
			"worktrees",
			"-c",
			CODEX_STATUS_LINE,
			"-c",
			"project_doc_max_bytes=65536",
		];
		return {
			address: "t2c",
			name: "gjch-test-86-critic",
			state: "live",
			reported: true,
			turn: 2,
			cwd: REPO_ROOT,
			argv: validArgv,
			labels: { team: "gjch-test-86", role: "critic" },
			status: {
				state: "idle",
				kind: null,
				msg: "CRITIC_SECRET_RAW_MSG",
				app: "codex",
			},
			foreground: {
				pid: 51002,
				name: "codex",
				argv: validArgv,
				cwd: REPO_ROOT,
			},
			...overrides,
		};
	}

	function writeLockRecord(params: {
		sessionId: string;
		socketPath: string;
		kind?: "herdr" | "external";
	}): void {
		const pyOut = spawnSync(
			REAL_PYTHON3,
			[
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
			CLAUDE_CODE_SESSION_ID: "my-secret-session-uuid-12345678",
			CLAUDE_CODE_MESSAGING_SOCKET: mySockPath,
			...overrides,
		};
	}

	function runCoreTeam(
		args: string[],
		envOverrides?: Record<string, string | undefined>,
		stdinInput?: string,
	): { status: number | null; stdout: string; stderr: string } {
		const res = spawnSync("/bin/bash", [CORE_TEAM_SH, ...args], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv(envOverrides),
			input: stdinInput,
			timeout: 15_000,
		});
		return {
			status: res.status,
			stdout: res.stdout ?? "",
			stderr: res.stderr ?? "",
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

	function readSleepCalls(): string[] {
		const sleepLog = path.join(stateDir, "sleep-calls.log");
		if (!fs.existsSync(sleepLog)) {
			return [];
		}
		return fs
			.readFileSync(sleepLog, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean);
	}

	function assertZeroMutatingHcCalls(calls: string[]): void {
		for (const c of calls) {
			expect(c.startsWith("run ")).toBe(false);
			expect(c.startsWith("kill ")).toBe(false);
			expect(c.startsWith("rm ")).toBe(false);
			expect(c.startsWith("send ")).toBe(false);
			expect(c.startsWith("keys ")).toBe(false);
			expect(c.startsWith("read ")).toBe(false);
			expect(c.startsWith("attach ")).toBe(false);
		}
	}

	beforeAll(() => {
		const rawTmp = fs.mkdtempSync("/tmp/gjch-t-core-team-");
		tmpDir = fs.realpathSync(rawTmp);
		binDir = path.join(tmpDir, "bin");
		stateDir = path.join(tmpDir, "state");
		tmpHome = path.join(tmpDir, "home");
		hcCallsLog = path.join(tmpDir, "hc-calls.log");
		herdrCallsLog = path.join(tmpDir, "herdr-calls.log");
		lockPath = path.join(tmpDir, "lead-test.json");
		mySockPath = path.join(tmpDir, "my.sock");
		otherSockPath = path.join(tmpDir, "other.sock");
		staleSockPath = path.join(tmpDir, "stale.sock");

		fs.mkdirSync(binDir, { recursive: true });
		fs.mkdirSync(stateDir, { recursive: true });
		fs.mkdirSync(tmpHome, { recursive: true });

		for (const sp of [mySockPath, otherSockPath, staleSockPath]) {
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

		writeExecutable(
			path.join(binDir, "sleep"),
			`#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(path.join(stateDir, "sleep-calls.log"))}
exit 0
`,
		);

		writeExecutable(
			path.join(binDir, "lsof"),
			`#!/bin/sh
target="\${2:-}"
if [ "$target" = ${JSON.stringify(staleSockPath)} ]; then
	exit 1
fi
printf '42424\\n'
exit 0
`,
		);

		writeExecutable(
			path.join(binDir, "nohup"),
			`#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(path.join(stateDir, "nohup-calls.log"))}
${JSON.stringify(REAL_NOHUP)} "$@"
rc=$?
printf '1' > ${JSON.stringify(path.join(stateDir, "hook-bg-done"))}
exit $rc
`,
		);

		writeExecutable(path.join(binDir, "agy"), "#!/bin/sh\nprintf '1.0.0-stub\\n'\n");
		writeExecutable(path.join(binDir, "codex"), "#!/bin/sh\nprintf '0.1.0-stub\\n'\n");
		writeExecutable(path.join(binDir, "bun"), "#!/bin/sh\nprintf '1.3.11\\n'\n");
		writeExecutable(
			path.join(binDir, "gjc"),
			`#!/bin/sh
if [ "\${1:-}" = "--version" ]; then
	printf '0.18.7-stub\\n'
	exit 0
fi
if [ "\${1:-}" = "plugin" ] && [ "\${2:-}" = "list" ]; then
	printf '{"npm":[{"name":"gjc-herdr","version":"0.5.2","enabled":true}]}\\n'
	exit 0
fi
exit 0
`,
		);
		writeExecutable(
			path.join(binDir, "herdr"),
			`#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(herdrCallsLog)}
if [ "\${1:-}" = "--version" ]; then
	printf '0.9.5-stub\\n'
	exit 0
fi
printf '{"error":{"code":"agent_not_found","message":"not found"}}\\n' >&2
exit 1
`,
		);

		// hc 스텁: HC_STUB_SCENARIO 및 stateDir 파일에 따라 고정 JSON 반환 + 모든 호출을 hcCallsLog에 기록
		// 기본 ls는 state=finished 항목을 숨기고, --all 인자가 있을 때만 finished 항목까지 포함한다(R5).
		writeExecutable(
			path.join(binDir, "hc"),
			`#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(hcCallsLog)}
sub="\${1:-}"
scenario="\${HC_STUB_SCENARIO:-default}"
if [ "$sub" = "--version" ] || [ "$sub" = "-V" ]; then
	printf 'hc 0.1.20-stub\\n'
	exit 0
fi
if [ "$sub" = "server" ] && [ "\${2:-}" = "status" ]; then
	if [ "$scenario" = "server_status_error" ]; then
		printf '{"error":{"kind":"unavailable","message":"core not running"}}\\n' >&2
		exit 5
	fi
	if [ "$scenario" = "server_status_bad_json" ]; then
		printf 'not-valid-json\\n'
		exit 0
	fi
	if [ -f "${stateDir}/server-status.json" ]; then
		cat "${stateDir}/server-status.json"
		exit 0
	fi
	printf '{"core":{"id":"core-secret-id-550e8400-e29b-41d4-a716-446655440000","name":"gjch-core-host"},"version":"0.1.20","pid":99999,"uptime_ms":120000,"holders":[],"live":2,"finished":1}\\n'
	exit 0
fi
if [ "$sub" = "ls" ]; then
	if [ "$scenario" = "ls_error" ]; then
		printf '{"error":{"kind":"unavailable","message":"core down"}}\\n' >&2
		exit 5
	fi
	if [ "$scenario" = "ls_bad_json" ]; then
		printf 'not-json\\n'
		exit 0
	fi
	if [ "$scenario" = "ls_missing_terminals" ]; then
		printf '{"hidden_finished":0}\\n'
		exit 0
	fi
	role=""
	want_all=0
	for arg in "$@"; do
		case "$arg" in
			--all) want_all=1 ;;
			role=*) role="\${arg#role=}" ;;
		esac
	done
	file="${stateDir}/ls-\${role}.json"
	if [ -f "$file" ]; then
		if [ "$want_all" = "1" ] || ! grep -q '"finished"' "$file" 2>/dev/null; then
			cat "$file"
		else
			${JSON.stringify(REAL_PYTHON3)} -B -c 'import json,sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    d = json.load(f)
if isinstance(d, dict) and isinstance(d.get("terminals"), list):
    terms = d["terminals"]
    live_terms = []
    hidden = 0
    for t in terms:
        if isinstance(t, dict) and t.get("state") == "finished":
            hidden += 1
        else:
            live_terms.append(t)
    d = dict(d)
    d["terminals"] = live_terms
    d["hidden_finished"] = hidden
print(json.dumps(d, ensure_ascii=False, separators=(",", ":")))' "$file"
		fi
		exit 0
	fi
	printf '{"terminals":[],"hidden_finished":0,"machines":[]}\\n'
	exit 0
fi
if [ "$sub" = "get" ]; then
	addr="\${3:-}"
	if [ "$addr" = "--json" ]; then
		addr="\${2:-}"
	fi
	if [ "$scenario" = "get_error" ]; then
		printf '{"error":{"kind":"not_found","message":"not_found"}}\\n' >&2
		exit 3
	fi
	file="${stateDir}/get-\${addr}.json"
	if [ -f "$file" ]; then
		cat "$file"
		exit 0
	fi
	printf '{"error":{"kind":"not_found","message":"not_found"}}\\n' >&2
	exit 3
fi
if [ "$sub" = "run" ]; then
	printf '%s\\n' "$*" >> ${JSON.stringify(path.join(stateDir, "hc-run-calls.log"))}
	if [ "$scenario" = "name_taken" ]; then
		printf '{"error":{"kind":"name_taken","message":"name already in use with secret sk-1234567890abcdef"}}\\n' >&2
		exit 1
	fi
	if [ "$scenario" = "unknown_error_kind" ]; then
		printf '{"error":{"kind":"custom_err_sk-1234567890abcdef\\n550e8400-e29b-41d4-a716-446655440000","message":"secret msg ghp_abcdef123456"}}\\n' >&2
		exit 1
	fi
	name=""
	role=""
	prev=""
	for arg in "$@"; do
		if [ "$prev" = "--name" ]; then
			name="$arg"
		fi
		case "$arg" in
			role=*) role="\${arg#role=}" ;;
		esac
		prev="$arg"
	done
	addr="t9\${role}"
	if [ -f "${stateDir}/spawned-\${role}.json" ]; then
		cp "${stateDir}/spawned-\${role}.json" "${stateDir}/get-\${addr}.json"
		printf '{"terminals":[{"address":"%s","name":"%s","state":"live"}],"hidden_finished":0,"machines":[]}\\n' "$addr" "$name" > "${stateDir}/ls-\${role}.json"
	fi
	printf '{"address":"%s","name":"%s","cwd":%s,"state":"live","turn":0,"labels":{"team":"gjch-test-86","role":"%s"},"argv":[],"created_ms":1,"screen":"exact","cols":200,"rows":120}\\n' "$addr" "$name" ${JSON.stringify(JSON.stringify(REPO_ROOT))} "$role"
	exit 0
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
printf 'unexpected hc subcommand: %s\\n' "$*" >&2
exit 99
`,
		);
	});

	beforeEach(() => {
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(herdrCallsLog, { force: true });
		fs.rmSync(lockPath, { force: true });
		fs.rmSync(`${lockPath}.mutex`, { force: true });
		fs.rmSync( stateDir, { recursive: true, force: true });
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

	function seedLiveTeam(params?: {
		mateOverrides?: Record<string, unknown>;
		criticOverrides?: Record<string, unknown>;
		includeRemoteInLs?: boolean;
	}): void {
		const mate = makeMateTerminal(params?.mateOverrides);
		const critic = makeCriticTerminal(params?.criticOverrides);
		fs.writeFileSync(path.join(stateDir, "get-t1m.json"), JSON.stringify(mate), "utf8");
		fs.writeFileSync(path.join(stateDir, "get-t2c.json"), JSON.stringify(critic), "utf8");

		const mateList: Array<Record<string, unknown>> = [
			{ address: "t1m", name: "gjch-test-86-mate", state: "live", where: "lfi / 1" },
		];
		if (params?.includeRemoteInLs) {
			mateList.push(
				{ address: "rohan/t1m", name: "gjch-test-86-mate", state: "live", where: "/srv/app" },
				{ address: "m1/t7", name: "gjch-test-86-mate", state: "live", where: "m1 / 1" },
			);
		}
		fs.writeFileSync(
			path.join(stateDir, "ls-mate.json"),
			JSON.stringify({ terminals: mateList, hidden_finished: 0, machines: [] }),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "ls-critic.json"),
			JSON.stringify({
				terminals: [
					{ address: "t2c", name: "gjch-test-86-critic", state: "live", where: "lfi / 2" },
				],
				hidden_finished: 0,
				machines: [],
			}),
			"utf8",
		);
	}

	test("1. 스위치 off(GJCH_CORE 미설정) 때 team-up.sh는 core-team.sh를 exec하지 않고, GJCH_CORE=1일 때만 exec함", () => {
		const fakeRepo = path.join(tmpDir, "fake-repo");
		const fakeScripts = path.join(fakeRepo, "scripts");
		fs.mkdirSync(fakeScripts, { recursive: true });
		fs.copyFileSync(TEAM_UP_SH, path.join(fakeScripts, "team-up.sh"));
		fs.copyFileSync(
			path.join(REPO_ROOT, "scripts", "team-args.sh"),
			path.join(fakeScripts, "team-args.sh"),
		);
		fs.copyFileSync(
			path.join(REPO_ROOT, "scripts", "worktree-guard.sh"),
			path.join(fakeScripts, "worktree-guard.sh"),
		);
		const markerFile = path.join(stateDir, "core-team-called-marker");
		writeExecutable(
			path.join(fakeScripts, "core-team.sh"),
			`#!/bin/sh
printf 'called:%s\\n' "$*" > ${JSON.stringify(markerFile)}
exit 88
`,
		);

		// GJCH_CORE 미설정: core-team.sh가 절대 호출되지 않아야 함
		const offRes = spawnSync("/bin/bash", [path.join(fakeScripts, "team-up.sh"), "--check"], {
			cwd: fakeRepo,
			encoding: "utf8",
			env: buildEnv({ GJCH_CORE: undefined, GJCH_EXTERNAL_LEAD: undefined }),
		});
		expect(offRes.status).toBe(2);
		expect(fs.existsSync(markerFile)).toBe(false);

		// GJCH_CORE=1 설정: core-team.sh를 exec하고 인자 그대로 전달해야 함
		const onRes = spawnSync(
			"/bin/bash",
			[path.join(fakeScripts, "team-up.sh"), "--check", "--extra"],
			{
				cwd: fakeRepo,
				encoding: "utf8",
				env: buildEnv({ GJCH_CORE: "1" }),
			},
		);
		expect(onRes.status).toBe(88);
		expect(fs.existsSync(markerFile)).toBe(true);
		expect(fs.readFileSync(markerFile, "utf8").trim()).toBe("called:--check --extra");
	});

	test("2. core-lib.sh: core_hc 실패 미은폐, core_json, R4 core_find(where 무시·address '/' 기준·0/1/2+/3), R1(b)·R3 core_get, core_redact", () => {
		// core_hc: 존재하지 않는 GJCH_HC_BIN 지정 시 기본 hc로 넘어가지 않고 실패
		const badBinRes = spawnSync(
			"/bin/bash",
			["-c", `. ${JSON.stringify(CORE_LIB_SH)}; core_hc ls --json`],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ GJCH_HC_BIN: path.join(tmpDir, "no-such-hc-binary") }),
			},
		);
		expect(badBinRes.status).not.toBe(0);
		expect(readHcCalls()).toEqual([]);

		// core_json: 존재하는 키 vs 없는 키/null
		const jsonRes = spawnSync(
			"/bin/bash",
			[
				"-c",
				`. ${JSON.stringify(CORE_LIB_SH)}
v1="$(core_json '{"a":{"b":true,"n":null}}' 'a.b')"
rc1=$?
v2="$(core_json '{"a":{"b":true,"n":null}}' 'a.n')"
rc2=$?
v3="$(core_json '{"a":{"b":true}}' 'a.missing')"
rc3=$?
printf '%s:%s|%s:%s|%s:%s\\n' "$v1" "$rc1" "$v2" "$rc2" "$v3" "$rc3"`,
			],
			{ cwd: REPO_ROOT, encoding: "utf8", env: buildEnv() },
		);
		expect(jsonRes.status).toBe(0);
		expect(jsonRes.stdout.trim()).toBe("true:0|:1|:1");

		// R4 core_find: where가 'lfi / 1'·빈 값·없음이어도 로컬 address('/' 없음)는 로컬로 판정하고 'm1/t7' 원격은 제외(rc 0)
		seedLiveTeam({ includeRemoteInLs: true });
		const findAndGetRes = spawnSync(
			"/bin/bash",
			[
				"-c",
				`. ${JSON.stringify(CORE_LIB_SH)}
addr="$(core_find mate)"
frc=$?
info="$(core_get "$addr")"
grc=$?
printf 'ADDR=%s FRC=%s GRC=%s\\n%s\\n' "$addr" "$frc" "$grc" "$info"`,
			],
			{ cwd: REPO_ROOT, encoding: "utf8", env: buildEnv() },
		);
		expect(findAndGetRes.status).toBe(0);
		const lines = findAndGetRes.stdout.trim().split("\n");
		expect(lines[0]).toBe("ADDR=t1m FRC=0 GRC=0");
		const parsedInfo = JSON.parse(lines[1]);
		expect(parsedInfo.state).toBe("live");
		expect(parsedInfo.status).toEqual({ state: "idle", kind: null });
		expect(parsedInfo.msglen).toBe("SECRET_RAW_STATUS_MSG_SHOULD_NOT_LEAK".length);
		expect(lines[1]).not.toContain("SECRET_RAW_STATUS_MSG_SHOULD_NOT_LEAK");

		// R4: where가 빈 문자열("") 또는 아예 없는 경우에도 로컬 address면 rc 0
		for (const whereFixture of [{ where: "" }, {}]) {
			fs.writeFileSync(
				path.join(stateDir, "ls-mate.json"),
				JSON.stringify({
					terminals: [{ address: "t1m", state: "live", ...whereFixture }],
					hidden_finished: 0,
					machines: [],
				}),
				"utf8",
			);
			const wfRes = spawnSync(
				"/bin/bash",
				["-c", `. ${JSON.stringify(CORE_LIB_SH)}; core_find mate`],
				{ cwd: REPO_ROOT, encoding: "utf8", env: buildEnv() },
			);
			expect(wfRes.status).toBe(0);
			expect(wfRes.stdout.trim()).toBe("t1m");
		}

		// R4: 원격('m1/t7')만 있을 때 -> 0개(rc 1)
		fs.writeFileSync(
			path.join(stateDir, "ls-mate.json"),
			JSON.stringify({
				terminals: [{ address: "m1/t7", state: "live", where: "lfi / 1" }],
				hidden_finished: 0,
				machines: [],
			}),
			"utf8",
		);
		const zeroRes = spawnSync(
			"/bin/bash",
			["-c", `. ${JSON.stringify(CORE_LIB_SH)}; core_find mate`],
			{ cwd: REPO_ROOT, encoding: "utf8", env: buildEnv() },
		);
		expect(zeroRes.status).toBe(1);
		expect(zeroRes.stdout).toBe("");

		// R4: 로컬 2개 이상(where: 'lfi / 1' 포함) -> rc 2
		fs.writeFileSync(
			path.join(stateDir, "ls-mate.json"),
			JSON.stringify({
				terminals: [
					{ address: "t1m", where: "lfi / 1" },
					{ address: "t2m", where: "" },
				],
				hidden_finished: 0,
				machines: [],
			}),
			"utf8",
		);
		const dupRes = spawnSync(
			"/bin/bash",
			["-c", `. ${JSON.stringify(CORE_LIB_SH)}; core_find mate`],
			{ cwd: REPO_ROOT, encoding: "utf8", env: buildEnv() },
		);
		expect(dupRes.status).toBe(2);
		expect(dupRes.stdout).toBe("");

		// R4: address 누락 또는 비문자열 -> rc 3
		for (const badTerm of [{ name: "no-addr" }, { address: 12345 }, { address: "" }]) {
			fs.writeFileSync(
				path.join(stateDir, "ls-mate.json"),
				JSON.stringify({
					terminals: [badTerm],
					hidden_finished: 0,
					machines: [],
				}),
				"utf8",
			);
			const badAddrRes = spawnSync(
				"/bin/bash",
				["-c", `. ${JSON.stringify(CORE_LIB_SH)}; core_find mate`],
				{ cwd: REPO_ROOT, encoding: "utf8", env: buildEnv() },
			);
			expect(badAddrRes.status).toBe(3);
			expect(badAddrRes.stdout).toBe("");
		}

		const errRes = spawnSync(
			"/bin/bash",
			["-c", `. ${JSON.stringify(CORE_LIB_SH)}; core_find mate`],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ HC_STUB_SCENARIO: "ls_missing_terminals" }),
			},
		);
		expect(errRes.status).toBe(3);
		expect(errRes.stdout).toBe("");

		// R1(b) & R3: core_get은 status.state·status.kind 비표준 값을 other로 정규화하고, reported 비불리언은 unknown, argv 비문자열 배열은 null로 두며, 전체 JSON 한 줄에 core_redact를 적용
		fs.writeFileSync(
			path.join(stateDir, "get-tbad.json"),
			JSON.stringify(
				makeMateTerminal({
					address: "tbad",
					reported: "false",
					argv: ["agy", 999],
					status: {
						state: "weird_state_sk-1234567890",
						kind: "weird_kind_ghp_1234567890",
						msg: "secret",
					},
					labels: {
						team: "gjch-test-86",
						role: "mate",
						note: "sid=550e8400-e29b-41d4-a716-446655440000 sk-abcdef123456",
					},
				}),
			),
			"utf8",
		);
		const badGetRes = spawnSync(
			"/bin/bash",
			["-c", `. ${JSON.stringify(CORE_LIB_SH)}; core_get tbad`],
			{ cwd: REPO_ROOT, encoding: "utf8", env: buildEnv() },
		);
		expect(badGetRes.status).toBe(0);
		expect(badGetRes.stdout).not.toContain("weird_state");
		expect(badGetRes.stdout).not.toContain("weird_kind");
		expect(badGetRes.stdout).not.toContain("sk-1234567890");
		expect(badGetRes.stdout).not.toContain("ghp_1234567890");
		expect(badGetRes.stdout).not.toContain("550e8400-e29b-41d4-a716-446655440000");
		expect(badGetRes.stdout).not.toContain("sk-abcdef123456");
		const badParsed = JSON.parse(badGetRes.stdout.trim());
		expect(badParsed.status).toEqual({ state: "other", kind: "other" });
		expect(badParsed.reported).toBe("unknown");
		expect(badParsed.argv).toBeNull();

		// core_redact: 비밀 패턴·줄바꿈·세션 ID 가림
		const redactRes = spawnSync(
			"/bin/bash",
			[
				"-c",
				`. ${JSON.stringify(CORE_LIB_SH)}; core_redact $'key sk-abcdef123456\\nghp_1234567890 AKIA1234567890AB Bearer secret.jwt.tok token=mysecret password=pw123 api_key=k999 550e8400-e29b-41d4-a716-446655440000 my-secret-session-uuid-12345678'`,
			],
			{ cwd: REPO_ROOT, encoding: "utf8", env: buildEnv() },
		);
		expect(redactRes.stdout.trim().split("\n").length).toBe(1);
		expect(redactRes.stdout).not.toContain("sk-abcdef123456");
		expect(redactRes.stdout).not.toContain("ghp_1234567890");
		expect(redactRes.stdout).not.toContain("AKIA1234567890AB");
		expect(redactRes.stdout).not.toContain("secret.jwt.tok");
		expect(redactRes.stdout).not.toContain("mysecret");
		expect(redactRes.stdout).not.toContain("pw123");
		expect(redactRes.stdout).not.toContain("k999");
		expect(redactRes.stdout).not.toContain("550e8400-e29b-41d4-a716-446655440000");
		expect(redactRes.stdout).not.toContain("my-secret-session-uuid-12345678");
	});

	test("3. core-team.sh --check: ok / mismatch(실제 argv 미출력) / 미보고 unknown / R2 __pycache__ 미생성 (변경 명령 0회)", () => {
		// (a) ok (where가 'lfi / 1'이어도 로컬 정상 판정)
		seedLiveTeam({ includeRemoteInLs: true });
		const okRes = runCoreTeam(["--check"]);
		expect(okRes.status).toBe(0);
		expect(okRes.stdout.trim().split("\n")).toEqual([
			"gjch-test-86-mate t1m ok status=idle",
			"gjch-test-86-critic t2c ok status=idle",
			"lock mine",
		]);
		assertZeroMutatingHcCalls(readHcCalls());

		// R2: PYTHONDONTWRITEBYTECODE 없이 실행해도 scripts/__pycache__가 생성되지 않아야 함
		expect(fs.existsSync(path.join(REPO_ROOT, "scripts", "__pycache__"))).toBe(false);

		// (b) mismatch: 잘못된 모델 값(SECRET_WRONG_MODEL)은 절대 출력에 노출되지 않고 기대값만 표시
		fs.rmSync(hcCallsLog, { force: true });
		seedLiveTeam({
			mateOverrides: {
				argv: ["agy", "--model", "SECRET_WRONG_MODEL", "--mode", "accept-edits"],
			},
		});
		const misRes = runCoreTeam(["--check"]);
		expect(misRes.status).toBe(1);
		expect(misRes.stdout).toContain(
			"gjch-test-86-mate t1m mismatch 실제=다름:--model,없음:--sandbox 기대=--model gemini-4-argon-high,--sandbox",
		);
		expect(misRes.stdout).not.toContain("SECRET_WRONG_MODEL");
		assertZeroMutatingHcCalls(readHcCalls());

		// (c) 미보고(reported=false)는 unknown(rc 2)
		fs.rmSync(hcCallsLog, { force: true });
		seedLiveTeam({
			mateOverrides: {
				reported: false,
				status: null,
			},
		});
		const unrepRes = runCoreTeam(["--check"]);
		expect(unrepRes.status).toBe(2);
		expect(unrepRes.stdout).toContain("gjch-test-86-mate t1m unknown 미보고(reported=false)");
		assertZeroMutatingHcCalls(readHcCalls());
	});

	test("4. R3·R7: 래퍼(옵션 일치·불일치 모두 unknown rc 2) 및 importer 실패·reported 문자열·argv 비문자열 unknown rc 2", () => {
		// (a) R7: 래퍼(foreground.name != kind) + 승인 옵션 일치 argv -> unknown(기동 옵션 차이 없음, rc 2)
		seedLiveTeam({
			mateOverrides: {
				foreground: { pid: 51001, name: "node", argv: ["node"], cwd: REPO_ROOT },
			},
		});
		const wrapSameRes = runCoreTeam(["--check"]);
		expect(wrapSameRes.status).toBe(2);
		expect(wrapSameRes.stdout).toContain(
			"gjch-test-86-mate t1m unknown foreground 판정 불가(래퍼 또는 미관측, 기동 옵션 차이 없음)",
		);
		expect(wrapSameRes.stdout).not.toContain("mismatch");
		assertZeroMutatingHcCalls(readHcCalls());

		// (b) R7: 래퍼(foreground.name != kind) + 승인 옵션 없는 argv 조합 -> mismatch(rc 1)가 아니라 unknown(기동 옵션 차이 있음, rc 2), 값 미출력
		fs.rmSync(hcCallsLog, { force: true });
		seedLiveTeam({
			mateOverrides: {
				argv: ["node", "wrapper.js", "--model", "SECRET_WRAPPER_ARG"],
				foreground: { pid: 51001, name: "node", argv: ["node", "wrapper.js"], cwd: REPO_ROOT },
			},
		});
		const wrapDiffRes = runCoreTeam(["--check"]);
		expect(wrapDiffRes.status).toBe(2);
		expect(wrapDiffRes.stdout).toContain(
			"gjch-test-86-mate t1m unknown foreground 판정 불가(래퍼 또는 미관측, 기동 옵션 차이 있음)",
		);
		expect(wrapDiffRes.stdout).not.toContain("mismatch");
		expect(wrapDiffRes.stdout).not.toContain("SECRET_WRAPPER_ARG");
		assertZeroMutatingHcCalls(readHcCalls());

		// (c) R3: reported:"false"(문자열) fixture 및 argv 비문자열 원소 fixture -> ok/rc 0으로 통과하지 않고 unknown(rc 2)
		seedLiveTeam({
			mateOverrides: {
				reported: "false",
			},
			criticOverrides: {
				argv: [
					"codex",
					"--no-daemon",
					"--yolo",
					"-m",
					"gpt-6.1-sol",
					"-C",
					REPO_ROOT,
					"--disable",
					"worktrees",
					"-c",
					CODEX_STATUS_LINE,
					"-c",
					"project_doc_max_bytes=65536",
					12345,
				],
			},
		});
		const typeInvalidRes = runCoreTeam(["--check"]);
		expect(typeInvalidRes.status).toBe(2);
		expect(typeInvalidRes.stdout).toContain("gjch-test-86-mate t1m unknown 미보고(reported=unknown)");
		expect(typeInvalidRes.stdout).toContain("gjch-test-86-critic t2c unknown argv 없음");
		expect(typeInvalidRes.stdout).not.toContain(" ok ");

		// (d) R3 & F2: 필수 역할 부재(mate mismatch) + 다른 역할 importer 실패(critic unknown) -> --check·--status 각 1회 모두 rc 2(unknown 우선), 변경 명령 0회
		seedLiveTeam();
		fs.writeFileSync(
			path.join(stateDir, "ls-mate.json"),
			JSON.stringify({ terminals: [], hidden_finished: 0, machines: [] }),
			"utf8",
		);
		fs.rmSync(hcCallsLog, { force: true });
		const missingChecker = path.join(tmpDir, "no-such-agent-argv-check.py");
		const impCheckRes = runCoreTeam(["--check"], { GJCH_ARGV_CHECKER: missingChecker });
		expect(impCheckRes.status).toBe(2);
		expect(impCheckRes.stdout).toContain("gjch-test-86-mate - mismatch 실제=없음 기대=실행 중");
		expect(impCheckRes.stdout).toContain("gjch-test-86-critic - unknown 역할 점검 실패");
		assertZeroMutatingHcCalls(readHcCalls());

		fs.rmSync(hcCallsLog, { force: true });
		const impStatusRes = runCoreTeam(["--status"], { GJCH_ARGV_CHECKER: missingChecker });
		expect(impStatusRes.status).toBe(2);
		expect(impStatusRes.stdout).toContain("옵션 일치 ×(실제=없음)");
		expect(impStatusRes.stdout).toContain(
			"- 팀원: gjch-test-86-critic - codex 옵션 일치 ?(역할 점검 실패) resume 해당 없음 확인창 모름 상태 없음",
		);
		expect(impStatusRes.stdout).toContain("gjch-test-86-critic 역할 점검 실패");
		assertZeroMutatingHcCalls(readHcCalls());
	});

	test("5. core-team.sh --up: 이미 있음(run 0회) / 새로 기동(lead 미생성) / name_taken·비표준 오류 kind 정규화(R1) / 라벨 중복 시 해당 역할 변경 0회(보조) / 잠금 other-live(run 0회)", () => {
		// (a) 이미 있음 -> hc run 0회
		seedLiveTeam();
		const existRes = runCoreTeam(["--up"]);
		expect(existRes.status).toBe(0);
		expect(existRes.stdout).toContain("gjch-test-86-mate (t1m): 이미 있음");
		expect(existRes.stdout).toContain("gjch-test-86-critic (t2c): 이미 있음");
		expect(readHcCalls().filter((c) => c.startsWith("run "))).toEqual([]);

		// (b) 0개일 때 새로 기동 -> mate·critic만 기동하고 lead는 절대 기동하지 않음
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "ls-mate.json"), { force: true });
		fs.rmSync(path.join(stateDir, "ls-critic.json"), { force: true });
		fs.writeFileSync(
			path.join(stateDir, "spawned-mate.json"),
			JSON.stringify(makeMateTerminal({ address: "t9mate" })),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "spawned-critic.json"),
			JSON.stringify(makeCriticTerminal({ address: "t9critic" })),
			"utf8",
		);
		const spawnRes = runCoreTeam(["--up"]);
		expect(spawnRes.status).toBe(0);
		expect(spawnRes.stdout).toContain("spawned gjch-test-86-mate at t9mate");
		expect(spawnRes.stdout).toContain("spawned gjch-test-86-critic at t9critic");
		const runCalls = readHcCalls().filter((c) => c.startsWith("run "));
		expect(runCalls.length).toBe(2);
		expect(runCalls.some((c) => c.includes("role=lead") || c.includes("gjch-test-86-lead"))).toBe(
			false,
		);
		expect(runCalls[0]).toContain(
			"--bg --json --no-notify --no-parent --name gjch-test-86-mate --cwd",
		);
		expect(runCalls[1]).toContain(
			"--bg --json --no-notify --no-parent --name gjch-test-86-critic --cwd",
		);

		// (c) name_taken 실패 시 kind만 출력, rc 비0, kill/rm 추측 정리 0회 + R1(c) schema 밖 오류 kind(비밀·줄바꿈·UUID 포함)는 other로 정규화
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "ls-mate.json"), { force: true });
		fs.rmSync(path.join(stateDir, "ls-critic.json"), { force: true });
		const takenRes = runCoreTeam(["--up"], {
			HC_STUB_SCENARIO: "name_taken",
			GJCH_TEAM_CODEX: "0",
		});
		expect(takenRes.status).toBe(1);
		expect(takenRes.stderr).toContain("gjch-test-86-mate 기동 실패: name_taken");
		expect(takenRes.stderr).not.toContain("sk-1234567890abcdef");
		const takenCalls = readHcCalls();
		expect(takenCalls.some((c) => c.startsWith("kill ") || c.startsWith("rm "))).toBe(false);

		fs.rmSync(hcCallsLog, { force: true });
		const unkErrRes = runCoreTeam(["--up"], {
			HC_STUB_SCENARIO: "unknown_error_kind",
			GJCH_TEAM_CODEX: "0",
		});
		expect(unkErrRes.status).toBe(1);
		expect(unkErrRes.stderr).toContain("gjch-test-86-mate 기동 실패: other");
		expect(unkErrRes.stderr).not.toContain("custom_err");
		expect(unkErrRes.stderr).not.toContain("sk-1234567890abcdef");
		expect(unkErrRes.stderr).not.toContain("ghp_abcdef123456");
		expect(unkErrRes.stderr).not.toContain("550e8400-e29b-41d4-a716-446655440000");

		// (d) 라벨 중복(2개+) 시 중복인 해당 역할(mate)에 대해 변경(run/kill/rm) 0회, critic은 이미 있으므로 전체 변경 0회, rc 1
		fs.rmSync(hcCallsLog, { force: true });
		fs.writeFileSync(
			path.join(stateDir, "ls-mate.json"),
			JSON.stringify({
				terminals: [{ address: "t1m" }, { address: "t2m" }],
				hidden_finished: 0,
				machines: [],
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "ls-critic.json"),
			JSON.stringify({
				terminals: [{ address: "t2c" }],
				hidden_finished: 0,
				machines: [],
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "get-t2c.json"),
			JSON.stringify(makeCriticTerminal()),
			"utf8",
		);
		const dupUpRes = runCoreTeam(["--up"]);
		expect(dupUpRes.status).toBe(1);
		expect(dupUpRes.stderr).toContain("duplicate_label");
		assertZeroMutatingHcCalls(readHcCalls());

		// ls 조회 실패(전체 역할) 시 전체 변경(run/kill/rm) 0회, rc 1
		fs.rmSync(hcCallsLog, { force: true });
		const lsErrUpRes = runCoreTeam(["--up"], { HC_STUB_SCENARIO: "ls_error" });
		expect(lsErrUpRes.status).toBe(1);
		expect(lsErrUpRes.stderr).toContain("ls_failed");
		assertZeroMutatingHcCalls(readHcCalls());

		// (e) 잠금 other-live일 때 -> hc run 0회, rc 1
		fs.rmSync(hcCallsLog, { force: true });
		writeLockRecord({
			sessionId: "other-session-id-99999999",
			socketPath: otherSockPath,
			kind: "external",
		});
		const otherLockRes = runCoreTeam(["--up"]);
		expect(otherLockRes.status).toBe(1);
		expect(readHcCalls()).toEqual([]);
	});

	test("6a. core-team.sh --down: live 종료 후 rm 및 R5 ls --all로 finished 잔류 재수거(kill 없이 rm 1회)", () => {
		// (a) live -> kill -> finished 확인 뒤 rm
		seedLiveTeam();
		fs.writeFileSync(
			path.join(stateDir, "finished-t1m.json"),
			JSON.stringify(makeMateTerminal({ state: "finished", status: null })),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "finished-t2c.json"),
			JSON.stringify(makeCriticTerminal({ state: "finished", status: null })),
			"utf8",
		);
		const okDown = runCoreTeam(["--down"]);
		expect(okDown.status).toBe(0);
		const okDownCalls = readHcCalls();
		expect(okDownCalls.filter((c) => c.startsWith("ls "))).toEqual([
			"ls --all --json --label team=gjch-test-86 --label role=mate",
			"ls --all --json --label team=gjch-test-86 --label role=critic",
		]);
		expect(okDownCalls.filter((c) => c.startsWith("kill "))).toEqual([
			"kill --json t1m",
			"kill --json t2c",
		]);
		expect(okDownCalls.filter((c) => c.startsWith("rm "))).toEqual([
			"rm --json t1m",
			"rm --json t2c",
		]);

		// (b) R5: 첫 --down에서 finished 미확인(rm 0회) 뒤 터미널이 finished가 되었을 때, 기본 ls(--check)는 숨기지만 두 번째 --down(ls --all)은 finished 항목을 찾아 kill 없이 rm 1회(역할별) 수행
		fs.rmSync(hcCallsLog, { force: true });
		fs.rmSync(path.join(stateDir, "sleep-calls.log"), { force: true });
		seedLiveTeam();
		const stayLiveDown = runCoreTeam(["--down"], {
			HC_STUB_SCENARIO: "kill_stay_live",
			GJCH_CORE_DOWN_INTERVAL: "2",
			GJCH_CORE_DOWN_RETRIES: "2",
		});
		expect(stayLiveDown.status).toBe(1);
		expect(stayLiveDown.stderr).toContain("finished 미확인, 잔류(rm 생략)");
		const stayCalls = readHcCalls();
		expect(stayCalls.filter((c) => c.startsWith("kill ")).length).toBe(2);
		expect(stayCalls.filter((c) => c.startsWith("rm "))).toEqual([]);
		expect(readSleepCalls()).toEqual(["2", "2"]);

		// 이제 두 터미널이 뒤늦게 finished 상태가 됨 -> 기본 ls(--check)에서는 숨겨져 '실제=없음'이나, 두 번째 --down(ls --all)에서는 찾아내 kill 없이 rm만 수행
		fs.writeFileSync(
			path.join(stateDir, "ls-mate.json"),
			JSON.stringify({
				terminals: [{ address: "t1m", name: "gjch-test-86-mate", state: "finished" }],
				hidden_finished: 0,
				machines: [],
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "ls-critic.json"),
			JSON.stringify({
				terminals: [{ address: "t2c", name: "gjch-test-86-critic", state: "finished" }],
				hidden_finished: 0,
				machines: [],
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "get-t1m.json"),
			JSON.stringify(makeMateTerminal({ state: "finished", status: null })),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "get-t2c.json"),
			JSON.stringify(makeCriticTerminal({ state: "finished", status: null })),
			"utf8",
		);
		const checkAfterFinish = runCoreTeam(["--check"]);
		expect(checkAfterFinish.status).toBe(1);
		expect(checkAfterFinish.stdout).toContain("gjch-test-86-mate - mismatch 실제=없음 기대=실행 중");

		fs.rmSync(hcCallsLog, { force: true });
		const secondDown = runCoreTeam(["--down"]);
		expect(secondDown.status).toBe(0);
		expect(secondDown.stdout).toContain("gjch-test-86-mate (t1m): 정리 완료");
		expect(secondDown.stdout).toContain("gjch-test-86-critic (t2c): 정리 완료");
		const secondDownCalls = readHcCalls();
		expect(secondDownCalls.filter((c) => c.startsWith("kill "))).toEqual([]);
		expect(secondDownCalls.filter((c) => c.startsWith("rm "))).toEqual([
			"rm --json t1m",
			"rm --json t2c",
		]);
	});

	test("6b. core-team.sh --down: 보조 interval·retries 양의 정수 폴백 및 working 때 kill·rm 0회", () => {
		// (a) 보조: GJCH_CORE_DOWN_INTERVAL(1~3600 밖 또는 소수)·GJCH_CORE_DOWN_RETRIES(1~100 밖 또는 0)는 기본 3·10으로 폴백
		seedLiveTeam();
		fs.rmSync(path.join(stateDir, "ls-critic.json"), { force: true });
		const singleRoleFallback = runCoreTeam(["--down"], {
			HC_STUB_SCENARIO: "kill_stay_live",
			GJCH_CORE_DOWN_INTERVAL: "0.02",
			GJCH_CORE_DOWN_RETRIES: "101",
		});
		expect(singleRoleFallback.status).toBe(1);
		expect(readSleepCalls()).toEqual(["3", "3", "3", "3", "3", "3", "3", "3", "3"]);

		// (b) working 때 kill 0회·rm 0회
		fs.rmSync(hcCallsLog, { force: true });
		seedLiveTeam({
			mateOverrides: { status: { state: "working", kind: null } },
			criticOverrides: { status: { state: "working", kind: null } },
		});
		const workingDown = runCoreTeam(["--down"]);
		expect(workingDown.status).toBe(1);
		expect(workingDown.stderr).toContain("작업 중, 중지 안 함");
		const workingCalls = readHcCalls();
		expect(workingCalls.filter((c) => c.startsWith("kill "))).toEqual([]);
		expect(workingCalls.filter((c) => c.startsWith("rm "))).toEqual([]);
	});

	test("7. core-team.sh --hook: source=clear / claim 실패(other-live) / 팀원 가드에서 기동 0회 / 정상 claim 시 teardown 전 백그라운드 --up 표식 단언", () => {
		const nohupLog = path.join(stateDir, "nohup-calls.log");
		const hookDoneMarker = path.join(stateDir, "hook-bg-done");

		// (a) source=clear -> 기동 0회
		const clearRes = runCoreTeam(["--hook"], undefined, '{"source":"clear"}\n');
		expect(clearRes.status).toBe(0);
		expect(clearRes.stdout).toContain("Core 외부 팀장");
		expect(fs.existsSync(nohupLog)).toBe(false);
		expect(readHcCalls()).toEqual([]);

		// (b) claim 실패(other-live, rc 3) -> 부팀장 안내만 출력하고 기동 0회, 세션 ID 미출력
		writeLockRecord({
			sessionId: "other-secret-sid-87654321",
			socketPath: otherSockPath,
			kind: "external",
		});
		const heldRes = runCoreTeam(["--hook"], undefined, '{"source":"startup"}\n');
		expect(heldRes.status).toBe(0);
		expect(heldRes.stdout).toContain("부팀장");
		expect(heldRes.stdout).not.toContain("other-secret-sid");
		expect(fs.existsSync(nohupLog)).toBe(false);
		expect(readHcCalls()).toEqual([]);

		// (c) 팀원 가드(GJCH_TEAM_ROLE=mate) -> 조용히 rc 0, 기동 0회
		const roleRes = runCoreTeam(
			["--hook"],
			{ GJCH_TEAM_ROLE: "mate" },
			'{"source":"startup"}\n',
		);
		expect(roleRes.status).toBe(0);
		expect(roleRes.stdout).toBe("");
		expect(fs.existsSync(nohupLog)).toBe(false);

		// (d) 정상 claim(rc 0) + source=startup -> 역할 줄 출력 및 teardown 전에 백그라운드 --up 완료 표식(hook-bg-done)과 hc ls 호출 존재 단언
		writeLockRecord({
			sessionId: "my-secret-session-uuid-12345678",
			socketPath: mySockPath,
			kind: "external",
		});
		seedLiveTeam();
		const okHookRes = runCoreTeam(["--hook"], undefined, '{"source":"startup"}\n');
		expect(okHookRes.status).toBe(0);
		expect(okHookRes.stdout).toContain("Core 외부 팀장");
		expect(okHookRes.stdout).not.toContain("my-secret-session-uuid");
		const deadline = Date.now() + 5_000;
		const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
		while (Date.now() < deadline && !fs.existsSync(hookDoneMarker)) {
			Atomics.wait(sleepBuf, 0, 0, 25);
		}
		expect(fs.existsSync(hookDoneMarker)).toBe(true);
		expect(fs.existsSync(nohupLog)).toBe(true);
		expect(fs.readFileSync(nohupLog, "utf8")).toContain("--up");
		expect(readHcCalls().some((c) => c.startsWith("ls "))).toBe(true);
	});

	test("8. R1 출력 보호(--layout/--report-resume/--lock/--check/--status 비밀·줄바꿈·세션ID 미노출)", () => {
		const layoutRes = runCoreTeam(["--layout"]);
		expect(layoutRes.status).toBe(2);
		expect(layoutRes.stderr).toContain("Core 미지원");

		const resumeRes = runCoreTeam(["--report-resume"]);
		expect(resumeRes.status).toBe(2);
		expect(resumeRes.stderr).toContain("Core 미지원");

		// --lock status: 세션 ID 없이 분류 낱말만 출력
		const lockRes = runCoreTeam(["--lock", "status"]);
		expect(lockRes.status).toBe(0);
		expect(lockRes.stdout.trim()).toBe("mine");
		expect(lockRes.stdout).not.toContain("my-secret-session-uuid");

		const forceRes = runCoreTeam(["--lock", "release", "--force"]);
		expect(forceRes.status).toBe(2);

		// R1: --check·--status에서 address·status.state·status.kind에 비밀 패턴·줄바꿈·세션 ID 꼴을 넣어도 새지 않고 줄바꿈이 공백으로 치환됨
		const dirtyAddr = "t1m-sk-secret999999\ninjected-550e8400-e29b-41d4-a716-446655440000";
		const dirtyMate = makeMateTerminal({
			address: dirtyAddr,
			status: {
				state: "idle\nsk-stateleak123456",
				kind: "permission\nghp_kindleak123456",
				msg: "SECRET_MSG_token=abc12345",
			},
		});
		fs.writeFileSync(path.join(stateDir, `get-${dirtyAddr}.json`), JSON.stringify(dirtyMate), "utf8");
		fs.writeFileSync(
			path.join(stateDir, "ls-mate.json"),
			JSON.stringify({
				terminals: [{ address: dirtyAddr, name: "gjch-test-86-mate", state: "live" }],
				hidden_finished: 0,
				machines: [],
			}),
			"utf8",
		);
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
			JSON.stringify(makeCriticTerminal()),
			"utf8",
		);

		const dirtyCheck = runCoreTeam(["--check"]);
		expect(dirtyCheck.status).toBe(2);
		expect(dirtyCheck.stdout.trim().split("\n").length).toBe(3);
		expect(dirtyCheck.stdout).toContain("unknown status 판정 불가");
		expect(dirtyCheck.stdout).not.toContain("sk-secret999999");
		expect(dirtyCheck.stdout).not.toContain("sk-stateleak123456");
		expect(dirtyCheck.stdout).not.toContain("ghp_kindleak123456");
		expect(dirtyCheck.stdout).not.toContain("550e8400-e29b-41d4-a716-446655440000");
		expect(dirtyCheck.stdout).not.toContain("my-secret-session-uuid");

		const dirtyStatus = runCoreTeam(["--status"]);
		expect(dirtyStatus.status).toBe(2);
		expect(dirtyStatus.stdout).toContain(
			"- 팀장 세션: Core 외부 팀장(GJCH_CORE=1, team=gjch-test-86), 잠금 mine",
		);
		expect(dirtyStatus.stdout).toContain("옵션 일치 ?(status 판정 불가)");
		expect(dirtyStatus.stdout).toContain("상태 other");
		expect(dirtyStatus.stdout).not.toContain("sk-secret999999");
		expect(dirtyStatus.stdout).not.toContain("sk-stateleak123456");
		expect(dirtyStatus.stdout).not.toContain("ghp_kindleak123456");
		expect(dirtyStatus.stdout).not.toContain("550e8400-e29b-41d4-a716-446655440000");
		expect(dirtyStatus.stdout).not.toContain("my-secret-session-uuid");
		expect(dirtyStatus.stdout).not.toContain("SECRET_MSG_token");
		// F1: 가드 출력 보호 — 역할 환경값·작업 경로에 줄바꿈과 비밀 패턴을 넣은 입력으로 --check/--status/check-env의 stdout/stderr가 한 줄·가림인지 확인
		const roleSecretCheck = runCoreTeam(["--check"], {
			GJCH_TEAM_ROLE: "mate\nsk-rolesecret123456 550e8400-e29b-41d4-a716-446655440000",
		});
		expect(roleSecretCheck.status).toBe(2);
		expect(roleSecretCheck.stderr.trim().split("\n").length).toBe(1);
		expect(roleSecretCheck.stderr).toContain("팀원 역할에서는 --check를 실행할 수 없습니다.");
		expect(roleSecretCheck.stderr).not.toContain("sk-rolesecret123456");
		expect(roleSecretCheck.stderr).not.toContain("550e8400-e29b-41d4-a716-446655440000");

		const pathSecretStatus = runCoreTeam(["--status"], {
			CLAUDE_PROJECT_DIR: "/nonexistent/sk-pathsecret123456\nghp_pathleak123456",
		});
		expect(pathSecretStatus.status).toBe(2);
		expect(pathSecretStatus.stderr.trim().split("\n").length).toBe(1);
		expect(pathSecretStatus.stderr).toContain("작업 경로 확인 실패");
		expect(pathSecretStatus.stderr).not.toContain("sk-pathsecret123456");
		expect(pathSecretStatus.stderr).not.toContain("ghp_pathleak123456");

		const outsideDirStatus = runCoreTeam(["--status"], {
			CLAUDE_PROJECT_DIR: tmpDir,
		});
		expect(outsideDirStatus.status).toBe(2);
		expect(outsideDirStatus.stderr.trim().split("\n").length).toBe(1);
		expect(outsideDirStatus.stderr).toContain("현재 경로가 저장소 밖");
		expect(outsideDirStatus.stderr).not.toContain(tmpDir);
	});

	test("9. R1(a)·R6·F1 check-env.sh Core 분기(server status 1회·3필드 출력·잠금 분류 낱말만·hc_bin/가드 가림·오류 시 FAIL)", () => {
		// R1(a) & R6: check-env.sh GJCH_CORE=1 분기:
		// - hc server status --json 정확히 1회 호출 + core.name·live·finished 세 값만 OK 줄로 출력(core.id·pid 미노출)
		// - 팀장 잠금 줄은 core_lock_class 분류 낱말(mine)만 출력(세션 ID 미노출)
		// - core.name에 비밀 패턴·줄바꿈·세션 ID가 있어도 가림 처리
		seedLiveTeam();
		fs.writeFileSync(
			path.join(stateDir, "server-status.json"),
			JSON.stringify({
				core: {
					id: "core-id-550e8400-e29b-41d4-a716-446655440000",
					name: "gjch-core-host\nsk-coresecret123456",
				},
				version: "0.1.20",
				pid: 99999,
				uptime_ms: 120000,
				holders: [],
				live: 2,
				finished: 1,
			}),
			"utf8",
		);
		fs.rmSync(hcCallsLog, { force: true });
		const envOkRes = spawnSync("/bin/bash", [CHECK_ENV_SH], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv(),
		});
		expect(envOkRes.status).toBe(0);
		expect(envOkRes.stdout).toContain("OK    hc (hc): hc 0.1.20-stub");
		expect(envOkRes.stdout).toContain(
			"OK    hc server status: core.name=gjch-core-host sk-[REDACTED] live=2 finished=1",
		);
		expect(envOkRes.stdout).not.toContain("sk-coresecret123456");
		expect(envOkRes.stdout).not.toContain("550e8400-e29b-41d4-a716-446655440000");
		expect(envOkRes.stdout).not.toContain("99999");
		expect(envOkRes.stdout).toContain("OK    팀장 잠금: mine");
		expect(envOkRes.stdout).not.toContain("my-secret-session-uuid");
		expect(envOkRes.stdout).toContain(
			"OK    Core 외부 팀장 모드(GJCH_CORE=1, GJCH_EXTERNAL_LEAD=1)",
		);
		expect(envOkRes.stdout).not.toContain("Herdr sidebar");
		expect(envOkRes.stdout).toContain("gjch-test-86-mate t1m ok status=idle");
		expect(readHcCalls().filter((c) => c === "server status --json").length).toBe(1);
		expect(fs.existsSync(herdrCallsLog)).toBe(false);

		// R6: hc server status 비JSON 및 팀원 mismatch 시 FAIL(exit 1)
		seedLiveTeam({
			mateOverrides: { argv: ["agy", "--model", "wrong-model"] },
		});
		const envFailRes = spawnSync("/bin/bash", [CHECK_ENV_SH], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv({ HC_STUB_SCENARIO: "server_status_bad_json" }),
		});
		expect(envFailRes.status).toBe(1);
		expect(envFailRes.stdout).toContain("FAIL  hc server status 확인 실패");
		expect(envFailRes.stdout).toContain("FAIL  Core 팀원 점검 불일치 (rc 1)");

		// check-env.sh: GJCH_EXTERNAL_LEAD 없음(WARN) + 팀원 unknown(rc 2 -> WARN, 전체 exit 0)
		fs.rmSync(path.join(stateDir, "server-status.json"), { force: true });
		seedLiveTeam({
			mateOverrides: { reported: false, status: null },
		});
		const envWarnRes = spawnSync("/bin/bash", [CHECK_ENV_SH], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: buildEnv({
				GJCH_EXTERNAL_LEAD: undefined,
				GJCH_HC_BIN: `${path.join(binDir, "hc")}\nsk-hcbinsecret123456`,
				GJCH_TEAM_ROLE: "mate\nsk-rolesecret123456",
			}),
		});
		expect(envWarnRes.status).toBe(1);
		expect(envWarnRes.stdout).toContain("WARN  GJCH_EXTERNAL_LEAD 없음");
		expect(envWarnRes.stdout).toContain("WARN  Core 팀원 점검 미확인 (rc 2)");
		expect(envWarnRes.stdout).not.toContain("sk-hcbinsecret123456");
		expect(envWarnRes.stdout).not.toContain("sk-rolesecret123456");
	});
});
