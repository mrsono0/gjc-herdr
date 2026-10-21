import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = fs.realpathSync(path.resolve(import.meta.dir, ".."));
const TEAM_UP_SH = path.join(REPO_ROOT, "scripts", "team-up.sh");
const SPAWN_TIMEOUT_MS = 40_000;

const CODEX_STATUS_LINE =
	'tui.status_line=["context-remaining","total-input-tokens","total-output-tokens"]';

const STRIPPED_ENV_KEYS = [
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
	"GJCH_HOOK_ARGV_TIMEOUT",
	"GJCH_CHECK_TIMEOUT",
	"CLAUDE_CODE_SESSION_ID",
	"CLAUDE_CODE_MESSAGING_SOCKET",
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_COMMON_DIR",
	"GIT_INDEX_FILE",
	"GIT_CONFIG_COUNT",
	"GIT_CONFIG_PARAMETERS",
	"GIT_CEILING_DIRECTORIES",
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

const REAL_DIRNAME = resolveRealBinary("dirname", ["/usr/bin/dirname", "/bin/dirname"]);
const REAL_GIT = resolveRealBinary("git", ["/opt/homebrew/bin/git", "/usr/bin/git"]);
const REAL_PYTHON3 = resolveRealBinary("python3", [
	"/opt/homebrew/bin/python3",
	"/usr/bin/python3",
]);

function writeExecutable(filePath: string, content: string): void {
	fs.writeFileSync(filePath, content, "utf8");
	fs.chmodSync(filePath, 0o755);
}

function makeProcessInfoJson(
	processes: Array<Record<string, unknown>>,
	includeSentinelNode = true,
): string {
	const fg = [...processes];
	if (includeSentinelNode) {
		fg.push({
			pid: 9001,
			name: "node",
			argv0: "node",
			cwd: REPO_ROOT,
			argv: [
				"node",
				"/Users/test/.npm/context7-mcp/index.js",
				"--api-key",
				"SENTINEL_CHILD_API_KEY_777",
			],
			cmdline:
				"node /Users/test/.npm/context7-mcp/index.js --api-key SENTINEL_CHILD_API_KEY_777",
		});
	}
	return JSON.stringify({
		id: "req-1",
		result: {
			type: "pane_process_info",
			process_info: {
				pane_id: "w1:p2",
				shell_pid: 1000,
				foreground_process_group_id: 2000,
				foreground_processes: fg,
			},
		},
	});
}

describe("team-up.sh --check / --lock / --up (#68)", () => {
	let tmpDir = "";
	let sockDir = "";
	let mySockPath = "";
	let otherLiveSockPath = "";
	let staleSockPath = "";
	let binDir = "";
	let noHerdrBinDir = "";
	let noPythonBinDir = "";
	let tmpHome = "";
	let tmpHerdrConfig = "";
	let herdrLog = "";
	let lsofLog = "";
	let gitStatusLog = "";
	let lockPath = "";
	let stateDir = "";

	function writeDefaultMateAgent(
		cwd = REPO_ROOT,
		status = "idle",
		interactiveReady = true,
	): void {
		fs.writeFileSync(
			path.join(stateDir, "agent-mate.json"),
			JSON.stringify({
				result: {
					agent: {
						pane_id: "w1:p2",
						workspace_id: "w1",
						agent: "agy",
						name: "gjc-herdr-mate",
						cwd,
						foreground_cwd: cwd,
						agent_status: status,
						interactive_ready: interactiveReady,
					},
				},
			}),
			"utf8",
		);
	}

	function writeDefaultCriticAgent(
		cwd = REPO_ROOT,
		status = "idle",
		interactiveReady = true,
	): void {
		fs.writeFileSync(
			path.join(stateDir, "agent-critic.json"),
			JSON.stringify({
				result: {
					agent: {
						pane_id: "w1:p3",
						workspace_id: "w1",
						agent: "codex",
						name: "gjc-herdr-critic",
						cwd,
						foreground_cwd: cwd,
						agent_status: status,
						interactive_ready: interactiveReady,
					},
				},
			}),
			"utf8",
		);
	}

	function writeValidMateProc(): void {
		fs.writeFileSync(
			path.join(stateDir, "proc-mate.json"),
			makeProcessInfoJson([
				{
					pid: 3001,
					name: "agy",
					argv0: "agy",
					cwd: REPO_ROOT,
					argv: [
						"agy",
						"--model",
						"gemini-4-argon-high",
						"--mode",
						"accept-edits",
						"--sandbox",
					],
				},
			]),
			"utf8",
		);
	}

	function writeValidCriticProc(): void {
		fs.writeFileSync(
			path.join(stateDir, "proc-critic.json"),
			makeProcessInfoJson([
				{
					pid: 3002,
					name: "codex",
					argv0: "codex",
					cwd: REPO_ROOT,
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
					],
				},
			]),
			"utf8",
		);
	}

	function buildEnv(overrides?: Record<string, string>): NodeJS.ProcessEnv {
		const env: NodeJS.ProcessEnv = { ...process.env };
		for (const key of STRIPPED_ENV_KEYS) {
			delete env[key];
		}
		for (const key of Object.keys(env)) {
			if (/^GIT_CONFIG_(KEY|VALUE)_/.test(key)) {
				delete env[key];
			}
		}
		return {
			...env,
			PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
			HOME: tmpHome,
			HERDR_CONFIG: tmpHerdrConfig,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_NOSYSTEM: "1",
			PYTHONNOUSERSITE: "1",
			GJCH_LEAD_LOCK: lockPath,
			...overrides,
		};
	}

	function runTeamUp(
		args: string[],
		envOverrides?: Record<string, string>,
		cwd = REPO_ROOT,
	): { status: number | null; stdout: string; stderr: string } {
		const res = spawnSync("/bin/bash", [TEAM_UP_SH, ...args], {
			cwd,
			encoding: "utf8",
			env: buildEnv(envOverrides),
			timeout: SPAWN_TIMEOUT_MS,
		});
		return {
			status: res.status,
			stdout: res.stdout ?? "",
			stderr: res.stderr ?? "",
		};
	}

	function readHerdrCalls(): string[] {
		return fs.existsSync(herdrLog)
			? fs
					.readFileSync(herdrLog, "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
			: [];
	}

	function readAndClearHerdrCalls(): string[] {
		const calls = readHerdrCalls();
		fs.rmSync(herdrLog, { force: true });
		return calls;
	}

	function readAndClearGitStatusCalls(): string[] {
		const calls = fs.existsSync(gitStatusLog)
			? fs
					.readFileSync(gitStatusLog, "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
			: [];
		fs.rmSync(gitStatusLog, { force: true });
		return calls;
	}

	function assertReadOnlyHerdrCalls(calls: string[]): void {
		expect(calls.length).toBeGreaterThan(0);
		for (const call of calls) {
			const isReadOnly =
				call.startsWith("agent get ") ||
				call.startsWith("agent read ") ||
				call.startsWith("pane get ") ||
				call.startsWith("pane process-info ");
			expect(isReadOnly).toBe(true);
		}
	}

	function assertAllowedUpHerdrCalls(calls: string[]): void {
		expect(calls.length).toBeGreaterThan(0);
		const forbiddenSubstrings = [
			"agent start",
			"pane split",
			"send-keys",
			"send-text",
			"agent prompt",
			"pane move",
			"tab create",
			"tab close",
			"/quit",
			"kill",
		];
		for (const call of calls) {
			for (const forbidden of forbiddenSubstrings) {
				expect(call).not.toContain(forbidden);
			}
			const isAllowed =
				call.startsWith("agent get ") ||
				call.startsWith("agent read ") ||
				call.startsWith("pane get ") ||
				call.startsWith("pane layout ") ||
				call.startsWith("pane process-info ") ||
				call.startsWith("pane resize ") ||
				call.startsWith("agent rename ") ||
				call.startsWith("pane rename ") ||
				call.startsWith("workspace get ") ||
				call.startsWith("workspace rename ");
			expect(isAllowed).toBe(true);
		}
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
  "claimed_at": "2026-10-20T00:00:00+00:00",
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
		const rawTmp = fs.mkdtempSync(path.join(os.tmpdir(), "gjc-herdr-team-up-check-"));
		tmpDir = fs.realpathSync(rawTmp);
		sockDir = fs.mkdtempSync(path.join("/tmp", "gjch-c-"));
		mySockPath = path.join(sockDir, "my.sock");
		otherLiveSockPath = path.join(sockDir, "other-live.sock");
		staleSockPath = path.join(sockDir, "stale.sock");
		binDir = path.join(tmpDir, "bin");
		noHerdrBinDir = path.join(tmpDir, "bin-no-herdr");
		noPythonBinDir = path.join(tmpDir, "bin-no-python");
		tmpHome = path.join(tmpDir, "home");
		tmpHerdrConfig = path.join(tmpHome, ".config", "herdr", "config.toml");
		herdrLog = path.join(tmpDir, "herdr-calls.log");
		lsofLog = path.join(tmpDir, "lsof-calls.log");
		gitStatusLog = path.join(tmpDir, "git-status-calls.log");
		lockPath = path.join(tmpDir, "lead.json");
		stateDir = path.join(tmpDir, "state");

		fs.mkdirSync(binDir, { recursive: true });
		fs.mkdirSync(noHerdrBinDir, { recursive: true });
		fs.mkdirSync(noPythonBinDir, { recursive: true });
		fs.mkdirSync(stateDir, { recursive: true });
		fs.mkdirSync(path.dirname(tmpHerdrConfig), { recursive: true });
		fs.writeFileSync(tmpHerdrConfig, "# isolated test config\n", "utf8");

		for (const sp of [mySockPath, otherLiveSockPath, staleSockPath]) {
			const sockBind = spawnSync(
				REAL_PYTHON3,
				[
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

		const fakeWtGitDir = path.join(tmpDir, "fake-wt-git-dir");
		fs.mkdirSync(fakeWtGitDir, { recursive: true });
		const gitWrapper = `#!/bin/sh
if [ -f ${JSON.stringify(path.join(stateDir, "linked-worktree"))} ]; then
	for arg in "$@"; do
		if [ "$arg" = "--git-dir" ]; then
			printf '%s\\n' ${JSON.stringify(fakeWtGitDir)}
			exit 0
		fi
		if [ "$arg" = "--git-common-dir" ]; then
			printf '%s\\n' ${JSON.stringify(path.join(REPO_ROOT, ".git"))}
			exit 0
		fi
	done
fi
is_status_git=0
has_no_opt_locks=0
has_no_fsmonitor=0
for arg in "$@"; do
	case "$arg" in
		--abbrev-ref|--short|--porcelain)
			is_status_git=1
			;;
		--no-optional-locks)
			has_no_opt_locks=1
			;;
		core.fsmonitor=false)
			has_no_fsmonitor=1
			;;
	esac
done
if [ "$is_status_git" = 1 ]; then
	printf '%s\\n' "$*" >> ${JSON.stringify(gitStatusLog)}
	if [ "$has_no_opt_locks" != 1 ] || [ "$has_no_fsmonitor" != 1 ]; then
		printf 'missing readonly git flags: %s\\n' "$*" >&2
		exit 98
	fi
fi
if [ -f ${JSON.stringify(path.join(stateDir, "git-status-fail"))} ]; then
	if [ "$is_status_git" = 1 ]; then
		exit 1
	fi
fi
if [ -f ${JSON.stringify(path.join(stateDir, "git-status-mock"))} ]; then
	for arg in "$@"; do
		if [ "$arg" = "--abbrev-ref" ]; then
			printf 'i68\\n'
			exit 0
		fi
		if [ "$arg" = "--short" ]; then
			printf '1a2b3c4\\n'
			exit 0
		fi
		if [ "$arg" = "--porcelain" ]; then
			cat ${JSON.stringify(path.join(stateDir, "git-status-mock"))}
			exit 0
		fi
	done
fi
exec ${JSON.stringify(REAL_GIT)} "$@"
`;
		writeExecutable(path.join(binDir, "git"), gitWrapper);
		fs.symlinkSync(REAL_PYTHON3, path.join(binDir, "python3"));

		writeExecutable(path.join(noHerdrBinDir, "git"), gitWrapper);
		fs.symlinkSync(REAL_PYTHON3, path.join(noHerdrBinDir, "python3"));
		fs.symlinkSync(REAL_DIRNAME, path.join(noHerdrBinDir, "dirname"));

		writeExecutable(path.join(noPythonBinDir, "git"), gitWrapper);
		fs.symlinkSync(REAL_DIRNAME, path.join(noPythonBinDir, "dirname"));

		writeExecutable(
			path.join(binDir, "lsof"),
			`#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(lsofLog)}
if [ -f ${JSON.stringify(path.join(stateDir, "lsof-slow"))} ]; then
	sleep 5
fi
target="\${2:-}"
if [ "$target" = ${JSON.stringify(staleSockPath)} ]; then
	exit 1
fi
printf '42424\\n'
exit 0
`,
		);
		writeExecutable(
			path.join(binDir, "agy"),
			"#!/bin/sh\nprintf '1.0.0-stub\\n'\n",
		);
		writeExecutable(
			path.join(binDir, "codex"),
			"#!/bin/sh\nprintf '0.1.0-stub\\n'\n",
		);

		const herdrScript = `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(herdrLog)}
cmd="\${1:-}"
sub="\${2:-}"
if [ "$cmd" = "--version" ]; then
	printf '0.9.5-stub\\n'
	exit 0
fi
if [ "$cmd" = "agent" ] && [ "$sub" = "get" ]; then
	name="\${3:-}"
	if [ "$name" = "gjc-herdr-lead" ]; then
		cat ${JSON.stringify(path.join(stateDir, "agent-lead.json"))}
		exit 0
	fi
	if [ "$name" = "gjc-herdr-mate" ]; then
		if [ -f ${JSON.stringify(path.join(stateDir, "agent-mate-absent"))} ]; then
			printf '{"error":{"code":"agent_not_found","message":"not found"}}\\n' >&2
			exit 1
		fi
		cat ${JSON.stringify(path.join(stateDir, "agent-mate.json"))}
		exit 0
	fi
	if [ "$name" = "gjc-herdr-critic" ]; then
		if [ -f ${JSON.stringify(path.join(stateDir, "agent-critic-absent"))} ]; then
			printf '{"error":{"code":"agent_not_found","message":"not found"}}\\n' >&2
			exit 1
		fi
		cat ${JSON.stringify(path.join(stateDir, "agent-critic.json"))}
		exit 0
	fi
	printf '{"error":{"code":"agent_not_found","message":"not found"}}\\n' >&2
	exit 1
fi
if [ "$cmd" = "pane" ] && [ "$sub" = "get" ]; then
	pane="\${3:-}"
	if [ "$pane" = "w1:p1" ] && [ -f ${JSON.stringify(path.join(stateDir, "lead-pane-outside"))} ]; then
		printf '{"result":{"pane":{"pane_id":"%s","workspace_id":"w1","tab_id":"w1:t1","cwd":"/tmp","foreground_cwd":"/tmp","agent_status":"idle"}}}\\n' "$pane"
		exit 0
	fi
	if [ -f ${JSON.stringify(path.join(stateDir, "pane-no-status"))} ]; then
		printf '{"result":{"pane":{"pane_id":"%s","workspace_id":"w1","tab_id":"w1:t1","cwd":%s,"foreground_cwd":%s}}}\\n' "$pane" ${JSON.stringify(JSON.stringify(REPO_ROOT))} ${JSON.stringify(JSON.stringify(REPO_ROOT))}
		exit 0
	fi
	printf '{"result":{"pane":{"pane_id":"%s","workspace_id":"w1","tab_id":"w1:t1","cwd":%s,"foreground_cwd":%s,"agent_status":"idle"}}}\\n' "$pane" ${JSON.stringify(JSON.stringify(REPO_ROOT))} ${JSON.stringify(JSON.stringify(REPO_ROOT))}
	exit 0
fi
if [ "$cmd" = "pane" ] && [ "$sub" = "layout" ]; then
	if [ ! -f ${JSON.stringify(path.join(stateDir, "allow-up-mode"))} ]; then
		printf 'unexpected pane layout in read-only check mode: %s\\n' "$*" >&2
		exit 99
	fi
	cat ${JSON.stringify(path.join(stateDir, "layout.json"))}
	exit 0
fi
if [ "$cmd" = "pane" ] && [ "$sub" = "process-info" ]; then
	pane="\${4:-}"
	if [ "$pane" = "w1:p2" ]; then
		if [ -f ${JSON.stringify(path.join(stateDir, "proc-mate-slow"))} ]; then
			sleep 5
		fi
		if [ -f ${JSON.stringify(path.join(stateDir, "proc-mate-fail"))} ]; then
			printf 'process-info error: SENTINEL_STDERR_SECRET\\n' >&2
			exit 1
		fi
		cat ${JSON.stringify(path.join(stateDir, "proc-mate.json"))}
		exit 0
	fi
	if [ "$pane" = "w1:p3" ]; then
		if [ -f ${JSON.stringify(path.join(stateDir, "proc-critic-fail"))} ]; then
			printf 'process-info error: SENTINEL_STDERR_SECRET\\n' >&2
			exit 1
		fi
		cat ${JSON.stringify(path.join(stateDir, "proc-critic.json"))}
		exit 0
	fi
	exit 1
fi
if [ "$cmd" = "agent" ] && [ "$sub" = "read" ]; then
	name="\${3:-}"
	case " $* " in
		*" --source recent-unwrapped "*)
			if [ "$name" = "gjc-herdr-mate" ] && grep -q '"agent_status":"working"' ${JSON.stringify(path.join(stateDir, "agent-mate.json"))} 2>/dev/null; then
				printf '{"error":{"code":"agent_not_idle","message":"Target agent is working"}}\\n'
				exit 1
			fi
			if [ "$name" = "gjc-herdr-critic" ] && grep -q '"agent_status":"working"' ${JSON.stringify(path.join(stateDir, "agent-critic.json"))} 2>/dev/null; then
				printf '{"error":{"code":"agent_not_idle","message":"Target agent is working"}}\\n'
				exit 1
			fi
			;;
	esac
	if [ "$name" = "gjc-herdr-mate" ]; then
		if [ -f ${JSON.stringify(path.join(stateDir, "read-mate-slow"))} ]; then
			sleep 2
		fi
		if [ -f ${JSON.stringify(path.join(stateDir, "read-mate-fail"))} ]; then
			printf 'agent read error\\n' >&2
			exit 1
		fi
		if [ -f ${JSON.stringify(path.join(stateDir, "screen-mate.txt"))} ]; then
			cat ${JSON.stringify(path.join(stateDir, "screen-mate.txt"))}
		else
			printf 'normal\\n>\\n'
		fi
		exit 0
	fi
	if [ "$name" = "gjc-herdr-critic" ]; then
		if [ -f ${JSON.stringify(path.join(stateDir, "read-critic-fail"))} ]; then
			printf 'agent read error\\n' >&2
			exit 1
		fi
		if [ -f ${JSON.stringify(path.join(stateDir, "screen-critic.txt"))} ]; then
			cat ${JSON.stringify(path.join(stateDir, "screen-critic.txt"))}
		else
			printf '› Ask Codex to do anything\\n'
		fi
		exit 0
	fi
	exit 1
fi
printf 'unexpected or mutating herdr command: %s\\n' "$*" >&2
exit 99
`;
		writeExecutable(path.join(binDir, "herdr"), herdrScript);
		writeExecutable(path.join(noPythonBinDir, "herdr"), herdrScript);

		fs.writeFileSync(
			path.join(stateDir, "agent-lead.json"),
			JSON.stringify({
				result: {
					agent: {
						pane_id: "w1:p1",
						workspace_id: "w1",
						agent: "claude",
						name: "gjc-herdr-lead",
						cwd: REPO_ROOT,
						foreground_cwd: REPO_ROOT,
						agent_status: "idle",
						interactive_ready: true,
					},
				},
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "layout.json"),
			JSON.stringify({
				result: {
					layout: {
						panes: [
							{
								pane_id: "w1:p1",
								rect: { x: 0, y: 0, width: 120, height: 24 },
							},
							{
								pane_id: "w1:p2",
								rect: { x: 0, y: 24, width: 60, height: 16 },
							},
							{
								pane_id: "w1:p3",
								rect: { x: 60, y: 24, width: 60, height: 16 },
							},
						],
						splits: [
							{
								direction: "down",
								rect: { x: 0, y: 0, width: 120, height: 40 },
								ratio: 0.6,
							},
							{
								direction: "right",
								rect: { x: 0, y: 24, width: 120, height: 16 },
								ratio: 0.5,
							},
						],
					},
				},
			}),
			"utf8",
		);
	});

	beforeEach(() => {
		fs.rmSync(herdrLog, { force: true });
		fs.rmSync(lsofLog, { force: true });
		fs.rmSync(gitStatusLog, { force: true });
		fs.rmSync(lockPath, { force: true });
		fs.rmSync(`${lockPath}.mutex`, { force: true });
		fs.rmSync(path.join(stateDir, "proc-mate-fail"), { force: true });
		fs.rmSync(path.join(stateDir, "proc-critic-fail"), { force: true });
		fs.rmSync(path.join(stateDir, "proc-mate-slow"), { force: true });
		fs.rmSync(path.join(stateDir, "lsof-slow"), { force: true });
		fs.rmSync(path.join(stateDir, "agent-mate-absent"), { force: true });
		fs.rmSync(path.join(stateDir, "agent-critic-absent"), { force: true });
		fs.rmSync(path.join(stateDir, "allow-up-mode"), { force: true });
		fs.rmSync(path.join(stateDir, "linked-worktree"), { force: true });
		fs.rmSync(path.join(stateDir, "lead-pane-outside"), { force: true });
		fs.rmSync(path.join(stateDir, "git-status-fail"), { force: true });
		fs.rmSync(path.join(stateDir, "git-status-mock"), { force: true });
		fs.rmSync(path.join(stateDir, "pane-no-status"), { force: true });
		fs.rmSync(path.join(stateDir, "read-mate-fail"), { force: true });
		fs.rmSync(path.join(stateDir, "read-mate-slow"), { force: true });
		fs.rmSync(path.join(stateDir, "read-critic-fail"), { force: true });
		fs.rmSync(path.join(stateDir, "screen-mate.txt"), { force: true });
		fs.rmSync(path.join(stateDir, "screen-critic.txt"), { force: true });
		writeDefaultMateAgent(REPO_ROOT, "idle", true);
		writeDefaultCriticAgent(REPO_ROOT, "idle", true);
		writeValidMateProc();
		writeValidCriticProc();
	});

	afterAll(() => {
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
		if (sockDir) {
			fs.rmSync(sockDir, { recursive: true, force: true });
		}
	});

	test("1. --check 가드 6종(모드 미설정·GJCH_TEAM_ROLE·경로 밖/해석 실패·worktree·herdr 없음·python3 없음) → 모두 stderr 한 줄 + rc 2, 모두 ok면 rc 0", () => {
		const baseExtEnv = {
			GJCH_EXTERNAL_LEAD: "1",
			CLAUDE_PROJECT_DIR: REPO_ROOT,
		};

		// (a) Herdr 안도 외부 팀장도 아님 → rc 2
		const noEnvRes = runTeamUp(["--check"]);
		expect(noEnvRes.status).toBe(2);
		expect(noEnvRes.stdout).toBe("");
		expect(noEnvRes.stderr.trim().split("\n").length).toBe(1);
		expect(readAndClearHerdrCalls()).toEqual([]);

		// (b) GJCH_TEAM_ROLE 설정됨 → --check는 rc 2, 기본 모드는 rc 0
		const roleCheckRes = runTeamUp(["--check"], {
			...baseExtEnv,
			GJCH_TEAM_ROLE: "mate",
		});
		expect(roleCheckRes.status).toBe(2);
		expect(roleCheckRes.stdout).toBe("");
		expect(roleCheckRes.stderr.trim().split("\n").length).toBe(1);
		expect(readAndClearHerdrCalls()).toEqual([]);

		const roleDefaultRes = runTeamUp([], {
			...baseExtEnv,
			GJCH_TEAM_ROLE: "mate",
		});
		expect(roleDefaultRes.status).toBe(0);
		expect(readAndClearHerdrCalls()).toEqual([]);

		// (c) 프로젝트 경로 밖(/tmp) 및 해석 실패(존재하지 않는 경로) → rc 2
		const outsideDirRes = runTeamUp(["--check"], {
			...baseExtEnv,
			CLAUDE_PROJECT_DIR: "/tmp",
		});
		expect(outsideDirRes.status).toBe(2);
		expect(outsideDirRes.stdout).toBe("");
		expect(outsideDirRes.stderr.trim().split("\n").length).toBe(1);
		expect(readAndClearHerdrCalls()).toEqual([]);

		const missingDirRes = runTeamUp(["--check"], {
			...baseExtEnv,
			CLAUDE_PROJECT_DIR: path.join(tmpDir, "nonexistent-project-dir"),
		});
		expect(missingDirRes.status).toBe(2);
		expect(missingDirRes.stdout).toBe("");
		expect(missingDirRes.stderr.trim().split("\n").length).toBe(1);
		expect(readAndClearHerdrCalls()).toEqual([]);

		// (d) 연결 worktree (git-dir != git-common-dir) → --check는 rc 2, --spawn은 rc 1
		fs.writeFileSync(path.join(stateDir, "linked-worktree"), "1", "utf8");
		const wtCheckRes = runTeamUp(["--check"], baseExtEnv);
		expect(wtCheckRes.status).toBe(2);
		expect(wtCheckRes.stdout).toBe("");
		expect(wtCheckRes.stderr.trim().split("\n").length).toBe(1);
		expect(readAndClearHerdrCalls()).toEqual([]);

		const wtSpawnRes = runTeamUp(["--spawn"], baseExtEnv);
		expect(wtSpawnRes.status).toBe(1);
		expect(readAndClearHerdrCalls()).toEqual([]);
		fs.rmSync(path.join(stateDir, "linked-worktree"), { force: true });

		// (e) herdr 없음 → rc 2
		const noHerdrRes = runTeamUp(["--check"], {
			...baseExtEnv,
			PATH: `${noHerdrBinDir}:/bin`,
		});
		expect(noHerdrRes.status).toBe(2);
		expect(noHerdrRes.stdout).toBe("");
		expect(noHerdrRes.stderr.trim().split("\n").length).toBe(1);
		expect(readAndClearHerdrCalls()).toEqual([]);

		// (f) python3 없음 → rc 2
		const noPythonRes = runTeamUp(["--check"], {
			...baseExtEnv,
			PATH: `${noPythonBinDir}:/bin`,
		});
		expect(noPythonRes.status).toBe(2);
		expect(noPythonRes.stdout).toBe("");
		expect(noPythonRes.stderr.trim().split("\n").length).toBe(1);
		expect(readAndClearHerdrCalls()).toEqual([]);

		// (g) 모두 ok면 rc 0 및 읽기 전용 호출만 기록
		const okRes = runTeamUp(["--check"], {
			...baseExtEnv,
			CLAUDE_CODE_SESSION_ID: "my-session-id-111",
			CLAUDE_CODE_MESSAGING_SOCKET: mySockPath,
		});
		expect(okRes.status).toBe(0);
		expect(okRes.stderr).toBe("");
		expect(okRes.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 ok",
			"gjc-herdr-critic w1:p3 ok",
			"lock none",
		]);
		expect(fs.existsSync(lockPath)).toBe(false);
		expect(fs.existsSync(`${lockPath}.mutex`)).toBe(false);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());
	}, 60_000);

	test("2. --check: mismatch 하나·unknown 혼합·팀원 없음·cwd 다름 → rc 1, 실제 argv 비밀값 미출력 및 호출 기록 검증", () => {
		const extEnv = {
			GJCH_EXTERNAL_LEAD: "1",
			CLAUDE_PROJECT_DIR: REPO_ROOT,
		};

		// (a) mate: --sandbox 누락 + --model 값 다름(비밀 문자열 포함), critic: ok
		fs.writeFileSync(
			path.join(stateDir, "proc-mate.json"),
			makeProcessInfoJson([
				{
					pid: 3010,
					name: "agy",
					argv0: "agy",
					cwd: REPO_ROOT,
					argv: [
						"agy",
						"--model",
						"SECRET_ACTUAL_MODEL_TOKEN_999",
						"--mode",
						"accept-edits",
						"--conversation",
						"SECRET_CONV_ID_888",
					],
				},
			]),
			"utf8",
		);

		const mismatchRes = runTeamUp(["--check"], extEnv);
		expect(mismatchRes.status).toBe(1);
		expect(mismatchRes.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 mismatch 실제=다름:--model,없음:--sandbox 기대=--model gemini-4-argon-high,--sandbox",
			"gjc-herdr-critic w1:p3 ok",
			"lock none",
		]);
		expect(mismatchRes.stdout).not.toContain("SECRET_ACTUAL_MODEL_TOKEN_999");
		expect(mismatchRes.stdout).not.toContain("SECRET_CONV_ID_888");
		expect(mismatchRes.stdout).not.toContain("SENTINEL_CHILD_API_KEY_777");
		expect(mismatchRes.stderr).toBe("");
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());

		// (b) mismatch + unknown 섞여 있어도 rc 1
		fs.writeFileSync(path.join(stateDir, "proc-critic-fail"), "1", "utf8");
		const mixedRes = runTeamUp(["--check"], extEnv);
		expect(mixedRes.status).toBe(1);
		expect(mixedRes.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 mismatch 실제=다름:--model,없음:--sandbox 기대=--model gemini-4-argon-high,--sandbox",
			"gjc-herdr-critic w1:p3 unknown process-info 실패",
			"lock none",
		]);
		expect(mixedRes.stdout).not.toContain("SENTINEL_STDERR_SECRET");
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());
		fs.rmSync(path.join(stateDir, "proc-critic-fail"), { force: true });

		// (c) 팀원 없음 (agent_not_found) → rc 1
		writeValidMateProc();
		fs.writeFileSync(path.join(stateDir, "agent-mate-absent"), "1", "utf8");
		const absentRes = runTeamUp(["--check"], extEnv);
		expect(absentRes.status).toBe(1);
		expect(absentRes.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate - mismatch 실제=없음 기대=실행 중",
			"gjc-herdr-critic w1:p3 ok",
			"lock none",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());
		fs.rmSync(path.join(stateDir, "agent-mate-absent"), { force: true });

		// (d) cwd 다름 (critic이 /tmp에서 실행 중) → rc 1, 실제=cwd:다름
		writeDefaultCriticAgent("/tmp", "idle", true);
		const cwdDiffRes = runTeamUp(["--check"], extEnv);
		expect(cwdDiffRes.status).toBe(1);
		expect(cwdDiffRes.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 ok",
			`gjc-herdr-critic w1:p3 mismatch 실제=cwd:다름 기대=cwd:${REPO_ROOT}`,
			"lock none",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());
	}, 60_000);

	test("3. --check: unknown만 있으면 rc 2, lock unknown(팀원 ok면 rc 2, mismatch면 rc 1), get_lock_line 마감 처리 결정적 검증, Codex 꺼짐, blocked 접미사", () => {
		const extEnv = {
			GJCH_EXTERNAL_LEAD: "1",
			CLAUDE_PROJECT_DIR: REPO_ROOT,
		};

		// (a) unknown만 있음 (process-info 실패) → rc 2
		fs.writeFileSync(path.join(stateDir, "proc-mate-fail"), "1", "utf8");
		const unknownRes = runTeamUp(["--check"], extEnv);
		expect(unknownRes.status).toBe(2);
		expect(unknownRes.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 unknown process-info 실패",
			"gjc-herdr-critic w1:p3 ok",
			"lock none",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());
		fs.rmSync(path.join(stateDir, "proc-mate-fail"), { force: true });

		// (b) lock unknown: 손상된 잠금 파일 → 팀원이 모두 ok면 rc 2, 팀원에 mismatch가 있으면 rc 1
		writeValidMateProc();
		fs.writeFileSync(lockPath, "{corrupted lock json\n", "utf8");
		const lockUnknownOkMembers = runTeamUp(["--check"], extEnv);
		expect(lockUnknownOkMembers.status).toBe(2);
		expect(lockUnknownOkMembers.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 ok",
			"gjc-herdr-critic w1:p3 ok",
			"lock unknown",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());

		fs.writeFileSync(path.join(stateDir, "agent-mate-absent"), "1", "utf8");
		const lockUnknownMismatchMember = runTeamUp(["--check"], extEnv);
		expect(lockUnknownMismatchMember.status).toBe(1);
		expect(lockUnknownMismatchMember.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate - mismatch 실제=없음 기대=실행 중",
			"gjc-herdr-critic w1:p3 ok",
			"lock unknown",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());
		fs.rmSync(path.join(stateDir, "agent-mate-absent"), { force: true });
		fs.rmSync(lockPath, { force: true });

		// (c) get_lock_line 마감 처리 결정적 검증 (python3 단위 검증, 캐시 미생성)
		//     - 남은 시간이 0 이하면 Popen 호출 0회 + 'lock unknown'
		//     - 남은 시간이 양수(예: 0.125초)면 communicate timeout이 그 남은 시간과 정확히 일치(0.5초 하한 없음)
		const pyLockDeadlineTest = spawnSync(
			REAL_PYTHON3,
			[
				"-B",
				"-c",
				`import importlib.util, json, sys
sys.dont_write_bytecode = True
repo_root = sys.argv[1]
spec = importlib.util.spec_from_file_location("hook_argv_check", repo_root + "/scripts/hook-argv-check.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

popen_calls = []
comm_timeouts = []

class FakeProc:
    def __init__(self):
        self.pid = 99999
        self.returncode = 0
    def communicate(self, timeout=None):
        comm_timeouts.append(timeout)
        return ("mine external sess-1\\n", "")
    def kill(self):
        pass

def fake_popen(*args, **kwargs):
    popen_calls.append((args, kwargs))
    return FakeProc()

mod.subprocess.Popen = fake_popen

# Case 1: rem <= 0 (0.0 and -0.25) -> Popen 0 calls, returns 'lock unknown'
mod.time.monotonic = lambda: 100.0
r_zero = mod.get_lock_line(repo_root, 100.0)
mod.time.monotonic = lambda: 100.25
r_neg = mod.get_lock_line(repo_root, 100.0)
zero_popen_count = len(popen_calls)

# Case 2: rem > 0 (0.125, smaller than old 0.5 floor) -> communicate timeout == 0.125
mod.time.monotonic = lambda: 200.0
r_pos = mod.get_lock_line(repo_root, 200.125)
pos_popen_count = len(popen_calls)

print(json.dumps({
    "r_zero": r_zero,
    "r_neg": r_neg,
    "zero_popen_count": zero_popen_count,
    "r_pos": r_pos,
    "pos_popen_count": pos_popen_count,
    "comm_timeouts": comm_timeouts,
}))
`,
				REPO_ROOT,
			],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ PYTHONDONTWRITEBYTECODE: "1" }),
				timeout: 10_000,
			},
		);
		expect(pyLockDeadlineTest.status).toBe(0);
		expect(pyLockDeadlineTest.stderr).toBe("");
		const deadlineResult = JSON.parse(pyLockDeadlineTest.stdout.trim()) as {
			r_zero: string;
			r_neg: string;
			zero_popen_count: number;
			r_pos: string;
			pos_popen_count: number;
			comm_timeouts: number[];
		};
		expect(deadlineResult.r_zero).toBe("lock unknown");
		expect(deadlineResult.r_neg).toBe("lock unknown");
		expect(deadlineResult.zero_popen_count).toBe(0);
		expect(deadlineResult.r_pos).toBe("lock mine");
		expect(deadlineResult.pos_popen_count).toBe(1);
		expect(deadlineResult.comm_timeouts.length).toBe(1);
		expect(Math.abs(deadlineResult.comm_timeouts[0] - 0.125)).toBeLessThan(1e-9);
		expect(fs.existsSync(path.join(REPO_ROOT, "scripts", "__pycache__"))).toBe(false);

		// (d) Codex 꺼짐 (GJCH_TEAM_CODEX=0) → 팀원 줄 하나 + lock 줄
		const codexOffRes = runTeamUp(["--check"], {
			...extEnv,
			GJCH_TEAM_CODEX: "0",
		});
		expect(codexOffRes.status).toBe(0);
		expect(codexOffRes.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 ok",
			"lock none",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());

		// (e) 상태가 blocked이고 화면 읽기가 성공하면 (dialog=question), 화면 읽기 실패(종류 없음)면 ' (blocked)' 접미사
		writeDefaultMateAgent(REPO_ROOT, "blocked", false);
		writeDefaultCriticAgent(REPO_ROOT, "blocked", false);
		fs.writeFileSync(path.join(stateDir, "proc-critic-fail"), "1", "utf8");
		const blockedRes = runTeamUp(["--check"], extEnv);
		expect(blockedRes.status).toBe(2);
		expect(blockedRes.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 ok (dialog=question)",
			"gjc-herdr-critic w1:p3 unknown process-info 실패 (dialog=question)",
			"lock none",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());

		fs.writeFileSync(path.join(stateDir, "read-mate-fail"), "1", "utf8");
		fs.writeFileSync(path.join(stateDir, "read-critic-fail"), "1", "utf8");
		const blockedReadFailRes = runTeamUp(["--check"], extEnv);
		expect(blockedReadFailRes.status).toBe(2);
		expect(blockedReadFailRes.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 ok (blocked)",
			"gjc-herdr-critic w1:p3 unknown process-info 실패 (blocked)",
			"lock none",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());
		fs.rmSync(path.join(stateDir, "read-mate-fail"), { force: true });
		fs.rmSync(path.join(stateDir, "read-mate-slow"), { force: true });
		fs.rmSync(path.join(stateDir, "read-critic-fail"), { force: true });
	}, 60_000);

	test("4. --check: lock 줄 네 가지(none, mine, other live, stale) + 잠금 파일 무변경 + Herdr 안(inside) 모드 대표 1건", () => {
		const extEnv = {
			GJCH_EXTERNAL_LEAD: "1",
			CLAUDE_PROJECT_DIR: REPO_ROOT,
			CLAUDE_CODE_SESSION_ID: "my-sess-secret-12345",
			CLAUDE_CODE_MESSAGING_SOCKET: mySockPath,
		};

		// (1) none
		const noneRes = runTeamUp(["--check"], extEnv);
		expect(noneRes.status).toBe(0);
		expect(noneRes.stdout.trim().split("\n").pop()).toBe("lock none");
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());

		// (2) mine (잠금 파일 전후 내용 비교, 세션 ID 미노출)
		writeLockRecord({
			sessionId: "my-sess-secret-12345",
			socketPath: mySockPath,
		});
		const beforeMineBytes = fs.readFileSync(lockPath, "utf8");
		const mineRes = runTeamUp(["--check"], extEnv);
		const afterMineBytes = fs.readFileSync(lockPath, "utf8");
		expect(mineRes.status).toBe(0);
		expect(mineRes.stdout.trim().split("\n").pop()).toBe("lock mine");
		expect(mineRes.stdout).not.toContain("my-sess-secret-12345");
		expect(afterMineBytes).toBe(beforeMineBytes);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());

		// (3) other live (세션 ID 미노출, 잠금 파일 무변경)
		writeLockRecord({
			sessionId: "other-sess-secret-67890",
			socketPath: otherLiveSockPath,
		});
		const beforeOtherBytes = fs.readFileSync(lockPath, "utf8");
		const otherRes = runTeamUp(["--check"], extEnv);
		const afterOtherBytes = fs.readFileSync(lockPath, "utf8");
		expect(otherRes.status).toBe(0);
		expect(otherRes.stdout.trim().split("\n").pop()).toBe("lock other live");
		expect(otherRes.stdout).not.toContain("other-sess-secret-67890");
		expect(afterOtherBytes).toBe(beforeOtherBytes);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());

		// (4) stale (세션 ID 미노출, 잠금 파일 무변경)
		writeLockRecord({
			sessionId: "stale-sess-secret-00000",
			socketPath: staleSockPath,
		});
		const beforeStaleBytes = fs.readFileSync(lockPath, "utf8");
		const staleRes = runTeamUp(["--check"], extEnv);
		const afterStaleBytes = fs.readFileSync(lockPath, "utf8");
		expect(staleRes.status).toBe(0);
		expect(staleRes.stdout.trim().split("\n").pop()).toBe("lock stale");
		expect(staleRes.stdout).not.toContain("stale-sess-secret-00000");
		expect(afterStaleBytes).toBe(beforeStaleBytes);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());

		// (5) Herdr 안(inside) 모드 대표 1건
		fs.rmSync(lockPath, { force: true });
		const insideRes = runTeamUp(["--check"], {
			HERDR_ENV: "1",
			HERDR_WORKSPACE_ID: "w1",
			HERDR_PANE_ID: "w1:p1",
			CLAUDE_PROJECT_DIR: REPO_ROOT,
		});
		expect(insideRes.status).toBe(0);
		expect(insideRes.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 ok",
			"gjc-herdr-critic w1:p3 ok",
			"lock none",
		]);
		expect(fs.existsSync(lockPath)).toBe(false);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());
	}, 60_000);

	test("5. --lock: status|claim|release, --force 거부(rc 2), 잘못된 인자 거부(rc 2), herdr 미호출 검증", () => {
		const lockEnv = {
			CLAUDE_CODE_SESSION_ID: "lock-test-sess-1",
			CLAUDE_CODE_MESSAGING_SOCKET: mySockPath,
		};

		// status: none
		const stNone = runTeamUp(["--lock", "status"], lockEnv);
		expect(stNone.status).toBe(0);
		expect(stNone.stdout.trim()).toBe("none");
		expect(readAndClearHerdrCalls()).toEqual([]);

		// claim → rc 0, status → mine (세션 ID 미포함)
		const claimRes = runTeamUp(["--lock", "claim"], lockEnv);
		expect(claimRes.status).toBe(0);
		expect(claimRes.stdout.trim()).toBe("claimed external lock-test-sess-1");
		expect(readAndClearHerdrCalls()).toEqual([]);

		const stMine = runTeamUp(["--lock", "status"], lockEnv);
		expect(stMine.status).toBe(0);
		expect(stMine.stdout.trim()).toBe("mine");
		expect(stMine.stdout).not.toContain("lock-test-sess-1");
		expect(readAndClearHerdrCalls()).toEqual([]);

		// release → rc 0, status → none
		const relRes = runTeamUp(["--lock", "release"], lockEnv);
		expect(relRes.status).toBe(0);
		expect(fs.existsSync(lockPath)).toBe(false);
		expect(readAndClearHerdrCalls()).toEqual([]);

		// other live일 때 status → other live, claim/release → rc 3
		writeLockRecord({
			sessionId: "other-live-holder-999",
			socketPath: otherLiveSockPath,
		});
		const stOther = runTeamUp(["--lock", "status"], lockEnv);
		expect(stOther.status).toBe(0);
		expect(stOther.stdout.trim()).toBe("other live");
		expect(stOther.stdout).not.toContain("other-live-holder-999");
		expect(readAndClearHerdrCalls()).toEqual([]);

		const claimHeld = runTeamUp(["--lock", "claim"], lockEnv);
		expect(claimHeld.status).toBe(3);
		expect(readAndClearHerdrCalls()).toEqual([]);

		const relHeld = runTeamUp(["--lock", "release"], lockEnv);
		expect(relHeld.status).toBe(3);
		expect(readAndClearHerdrCalls()).toEqual([]);

		// --lock release --force → rc 2, 안내 문구 포함, 잠금 파일 유지
		const forceRes = runTeamUp(["--lock", "release", "--force"], lockEnv);
		expect(forceRes.status).toBe(2);
		expect(forceRes.stderr).toContain("scripts/team-lead.sh release --force");
		expect(fs.existsSync(lockPath)).toBe(true);
		expect(readAndClearHerdrCalls()).toEqual([]);

		// stale일 때 status → stale
		writeLockRecord({
			sessionId: "stale-holder-888",
			socketPath: staleSockPath,
		});
		const stStale = runTeamUp(["--lock", "status"], lockEnv);
		expect(stStale.status).toBe(0);
		expect(stStale.stdout.trim()).toBe("stale");
		expect(stStale.stdout).not.toContain("stale-holder-888");
		expect(readAndClearHerdrCalls()).toEqual([]);

		// 잘못된 인자 → rc 2
		for (const badArgs of [
			["--lock"],
			["--lock", "unknown"],
			["--lock", "status", "extra"],
		]) {
			const badRes = runTeamUp(badArgs, lockEnv);
			expect(badRes.status).toBe(2);
			expect(badRes.stderr.trim().length).toBeGreaterThan(0);
			expect(readAndClearHerdrCalls()).toEqual([]);
		}
	}, 60_000);

	test("6. --up: 정상(rc 0), 불일치(rc 1·재시작 0회), 판정 불가만(rc 2), 외부 조기 실패(critic cwd 저장소 밖 → 끝 요약 출력 후 rc 1)", () => {
		fs.writeFileSync(path.join(stateDir, "allow-up-mode"), "1", "utf8");
		const extEnv = {
			GJCH_EXTERNAL_LEAD: "1",
			CLAUDE_PROJECT_DIR: REPO_ROOT,
			CLAUDE_CODE_SESSION_ID: "up-lead-sess-1",
			CLAUDE_CODE_MESSAGING_SOCKET: mySockPath,
		};

		// (a) 모두 정상 실행 중 → 새로 띄우지 않고 끝에 check 요약 출력 + rc 0
		const upOk = runTeamUp(["--up"], extEnv);
		expect(upOk.status).toBe(0);
		expect(upOk.stderr).toBe("");
		const upOkLines = upOk.stdout.trim().split("\n");
		expect(upOkLines.slice(-3)).toEqual([
			"gjc-herdr-mate w1:p2 ok",
			"gjc-herdr-critic w1:p3 ok",
			"lock mine",
		]);
		assertAllowedUpHerdrCalls(readAndClearHerdrCalls());

		// (b) 팀원 argv 불일치 → 재시작 0회, 끝에 mismatch 요약 출력 + rc 1
		fs.writeFileSync(
			path.join(stateDir, "proc-mate.json"),
			makeProcessInfoJson([
				{
					pid: 3050,
					name: "agy",
					argv0: "agy",
					cwd: REPO_ROOT,
					argv: ["agy", "--conversation", "SECRET_RECOVER_CONV_ID"],
				},
			]),
			"utf8",
		);

		const upMismatch = runTeamUp(["--up"], extEnv);
		expect(upMismatch.status).toBe(1);
		const upMismatchLines = upMismatch.stdout.trim().split("\n");
		expect(upMismatchLines.slice(-3)).toEqual([
			"gjc-herdr-mate w1:p2 mismatch 실제=없음:--model,없음:--mode,없음:--sandbox 기대=--model gemini-4-argon-high,--mode accept-edits,--sandbox",
			"gjc-herdr-critic w1:p3 ok",
			"lock mine",
		]);
		expect(upMismatch.stdout).not.toContain("SECRET_RECOVER_CONV_ID");
		expect(upMismatch.stderr).not.toContain("SECRET_RECOVER_CONV_ID");
		assertAllowedUpHerdrCalls(readAndClearHerdrCalls());

		// (c) 기동·배치는 정상이고 팀원 옵션 판정 불가(unknown)만 있을 때 → 끝 요약의 rc 2 반환 (--spawn은 기존대로 rc 1)
		writeValidMateProc();
		fs.writeFileSync(path.join(stateDir, "proc-mate-fail"), "1", "utf8");
		const upUnknownOnly = runTeamUp(["--up"], extEnv);
		expect(upUnknownOnly.status).toBe(2);
		const upUnknownLines = upUnknownOnly.stdout.trim().split("\n");
		expect(upUnknownLines.slice(-3)).toEqual([
			"gjc-herdr-mate w1:p2 unknown process-info 실패",
			"gjc-herdr-critic w1:p3 ok",
			"lock mine",
		]);
		expect(upUnknownOnly.stderr).toContain("↳ gjc-herdr-mate 옵션 판정 불가: process-info 실패");
		assertAllowedUpHerdrCalls(readAndClearHerdrCalls());

		const spawnUnknownOnly = runTeamUp(["--spawn"], extEnv);
		expect(spawnUnknownOnly.status).toBe(1);
		assertAllowedUpHerdrCalls(readAndClearHerdrCalls());
		fs.rmSync(path.join(stateDir, "proc-mate-fail"), { force: true });

		// (d) 외부 모드 조기 실패(critic cwd가 저장소 밖 /tmp):
		//     --up은 끝 요약(팀원 줄 + lock 줄)을 stdout에 내고 원래 조기 실패 rc 1로 종료,
		//     --spawn은 요약 없이 기존대로 rc 1 종료
		const realTmp = fs.realpathSync("/tmp");
		writeDefaultCriticAgent("/tmp", "idle", true);
		const upEarlyFail = runTeamUp(["--up"], extEnv);
		expect(upEarlyFail.status).toBe(1);
		expect(upEarlyFail.stderr).toContain(
			`agent 'gjc-herdr-critic' (w1:p3) cwd (${realTmp}) is not ${REPO_ROOT}`,
		);
		expect(upEarlyFail.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 ok",
			`gjc-herdr-critic w1:p3 mismatch 실제=cwd:다름 기대=cwd:${REPO_ROOT}`,
			"lock mine",
		]);
		assertAllowedUpHerdrCalls(readAndClearHerdrCalls());

		const spawnEarlyFail = runTeamUp(["--spawn"], extEnv);
		expect(spawnEarlyFail.status).toBe(1);
		expect(spawnEarlyFail.stdout).toBe("");
		expect(spawnEarlyFail.stderr).toContain(
			`agent 'gjc-herdr-critic' (w1:p3) cwd (${realTmp}) is not ${REPO_ROOT}`,
		);
		assertAllowedUpHerdrCalls(readAndClearHerdrCalls());

		// (e) Herdr 안(inside) 모드 조기 종료(팀장 pane w1:p1 cwd가 저장소 밖 /tmp):
		//     --up은 요약 1회 출력 + rc 0(rename 등 변경 호출 없음),
		//     --spawn은 요약 없이 기존대로 rc 0
		writeDefaultCriticAgent(REPO_ROOT, "idle", true);
		fs.writeFileSync(path.join(stateDir, "lead-pane-outside"), "1", "utf8");
		const insideEnv = {
			HERDR_ENV: "1",
			HERDR_WORKSPACE_ID: "w1",
			HERDR_PANE_ID: "w1:p1",
			CLAUDE_PROJECT_DIR: REPO_ROOT,
			CLAUDE_CODE_SESSION_ID: "up-lead-sess-1",
			CLAUDE_CODE_MESSAGING_SOCKET: mySockPath,
		};

		const insideUpOutside = runTeamUp(["--up"], insideEnv);
		expect(insideUpOutside.status).toBe(0);
		expect(insideUpOutside.stderr.trim()).toBe(
			`pane w1:p1 is not in ${REPO_ROOT}; nothing changed`,
		);
		expect(insideUpOutside.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 ok",
			"gjc-herdr-critic w1:p3 ok",
			"lock mine",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());

		const insideSpawnOutside = runTeamUp(["--spawn"], insideEnv);
		expect(insideSpawnOutside.status).toBe(0);
		expect(insideSpawnOutside.stdout).toBe("");
		expect(insideSpawnOutside.stderr.trim()).toBe(
			`pane w1:p1 is not in ${REPO_ROOT}; nothing changed`,
		);
		expect(readAndClearHerdrCalls()).toEqual(["pane get w1:p1"]);
	}, 60_000);

	test("7. --status: 모두 ok(rc 0·7개 머리말), mismatch(×·rc 1·비밀 미노출), Codex 꺼짐, blocked, 세션 id 없음(모름), git 실패(저장소: 모름), 무변경 검증", () => {
		// 가드 실패 시 stderr 한 줄 + rc 2
		const guardFail = runTeamUp(["--status"], {
			HERDR_ENV: undefined,
			HERDR_PANE_ID: undefined,
			GJCH_EXTERNAL_LEAD: undefined,
			CLAUDE_PROJECT_DIR: REPO_ROOT,
		});
		expect(guardFail.status).toBe(2);
		expect(guardFail.stdout).toBe("");
		expect(guardFail.stderr.trim().split("\n").length).toBe(1);
		expect(readAndClearHerdrCalls()).toEqual([]);

		// (a) 모두 ok → rc 0, 7개 줄 머리말 모두 출력, 잠금 파일 무변경, 읽기 전용 herdr 호출만
		fs.writeFileSync(path.join(stateDir, "git-status-mock"), "", "utf8");
		writeLockRecord({
			kind: "external",
			sessionId: "status-lead-session-9999",
			socketPath: mySockPath,
		});
		const beforeSnap = fs.readFileSync(lockPath, "utf8");
		const okEnv = {
			GJCH_EXTERNAL_LEAD: "1",
			CLAUDE_PROJECT_DIR: REPO_ROOT,
			CLAUDE_CODE_SESSION_ID: "status-lead-session-9999",
			CLAUDE_CODE_MESSAGING_SOCKET: mySockPath,
		};
		const okRes = runTeamUp(["--status"], okEnv);
		expect(okRes.status).toBe(0);
		expect(okRes.stderr).toBe("");
		const okLines = okRes.stdout.trim().split("\n");
		expect(okLines).toEqual([
			"- 팀장 세션: 이 세션(id 앞 8자 status-l), 팀장 모드 herdr 밖(외부 팀장), 잠금 mine",
			"- 팀원: gjc-herdr-mate w1:p2 agy 옵션 일치 ○ resume 해당 없음 확인창 없음 상태 idle",
			"- 팀원: gjc-herdr-critic w1:p3 codex 옵션 일치 ○ resume 해당 없음 확인창 없음 상태 idle",
			"- 저장소: i68 @1a2b3c4, 작업 트리 깨끗",
			"- 팀장 감시: 모름(팀장이 채움)",
			"- 띄운 것·바꾼 것: 없음(--status는 읽기 전용)",
			"- 진행 중이던 일·잃은 것: 모름(팀장이 채움)",
			"- 미확인: 없음",
		]);
		expect(okRes.stdout).not.toContain("status-lead-session-9999");
		expect(fs.readFileSync(lockPath, "utf8")).toBe(beforeSnap);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());
		const okGitCalls = readAndClearGitStatusCalls();
		expect(okGitCalls).toEqual([
			`--no-optional-locks -c core.fsmonitor=false -C ${REPO_ROOT} rev-parse --abbrev-ref HEAD`,
			`--no-optional-locks -c core.fsmonitor=false -C ${REPO_ROOT} rev-parse --short HEAD`,
			`--no-optional-locks -c core.fsmonitor=false -C ${REPO_ROOT} status --porcelain`,
		]);
		for (const gc of okGitCalls) {
			expect(gc).toContain("--no-optional-locks");
			expect(gc).toContain("core.fsmonitor=false");
		}

		// 가짜 git이 --no-optional-locks 또는 core.fsmonitor=false가 빠지면 거부(rc 98)하는지 확인 +
		// get_git_status_line 공유 deadline 처리 결정적 검증
		const missingOptLockRes = spawnSync(
			path.join(binDir, "git"),
			["-c", "core.fsmonitor=false", "-C", REPO_ROOT, "status", "--porcelain"],
			{ encoding: "utf8", timeout: 5_000 },
		);
		expect(missingOptLockRes.status).toBe(98);
		const missingFsMonitorRes = spawnSync(
			path.join(binDir, "git"),
			["--no-optional-locks", "-C", REPO_ROOT, "status", "--porcelain"],
			{ encoding: "utf8", timeout: 5_000 },
		);
		expect(missingFsMonitorRes.status).toBe(98);
		readAndClearGitStatusCalls();

		const pyGitDeadlineTest = spawnSync(
			REAL_PYTHON3,
			[
				"-B",
				"-c",
				`import importlib.util, json, sys
sys.dont_write_bytecode = True
repo_root = sys.argv[1]
spec = importlib.util.spec_from_file_location("hook_argv_check", repo_root + "/scripts/hook-argv-check.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

cmds = []
timeouts = []
outputs = ["i68\\n", "1a2b3c4\\n", " M a.txt\\n"]

class FakeGitProc:
    def __init__(self, cmd):
        self.pid = 88888
        if "--no-optional-locks" not in cmd or "core.fsmonitor=false" not in cmd:
            self.returncode = 98
            self._out = ""
        else:
            self.returncode = 0
            idx = len(cmds) - 1
            self._out = outputs[idx] if idx < len(outputs) else ""
    def communicate(self, timeout=None):
        timeouts.append(timeout)
        return (self._out, "")
    def kill(self):
        pass

def fake_popen(cmd, *args, **kwargs):
    cmds.append(list(cmd))
    return FakeGitProc(list(cmd))

mod.subprocess.Popen = fake_popen

# Case 1: expired deadline -> 0 Popen calls, ('- 저장소: 모름', False)
mod.time.monotonic = lambda: 50.0
expired_line, expired_ok = mod.get_git_status_line(repo_root, 50.0)
expired_count = len(cmds)

# Case 2: shared deadline (rem = 0.25) -> 3 Popen calls, all with --no-optional-locks and core.fsmonitor=false
mod.time.monotonic = lambda: 60.0
valid_line, valid_ok = mod.get_git_status_line(repo_root, 60.25)

print(json.dumps({
    "expired_line": expired_line,
    "expired_ok": expired_ok,
    "expired_count": expired_count,
    "valid_line": valid_line,
    "valid_ok": valid_ok,
    "cmds": cmds,
    "timeouts": timeouts,
}))
`,
				REPO_ROOT,
			],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv({ PYTHONDONTWRITEBYTECODE: "1" }),
				timeout: 10_000,
			},
		);
		expect(pyGitDeadlineTest.status).toBe(0);
		const gitDlRes = JSON.parse(pyGitDeadlineTest.stdout.trim()) as {
			expired_line: string;
			expired_ok: boolean;
			expired_count: number;
			valid_line: string;
			valid_ok: boolean;
			cmds: string[][];
			timeouts: number[];
		};
		expect(gitDlRes.expired_line).toBe("- 저장소: 모름");
		expect(gitDlRes.expired_ok).toBe(false);
		expect(gitDlRes.expired_count).toBe(0);
		expect(gitDlRes.valid_line).toBe("- 저장소: i68 @1a2b3c4, 작업 트리 미커밋 1");
		expect(gitDlRes.valid_ok).toBe(true);
		expect(gitDlRes.cmds.length).toBe(3);
		for (const cmdArr of gitDlRes.cmds) {
			expect(cmdArr).toContain("--no-optional-locks");
			expect(cmdArr).toContain("core.fsmonitor=false");
		}
		expect(gitDlRes.timeouts.length).toBe(3);
		for (const t of gitDlRes.timeouts) {
			expect(Math.abs(t - 0.25)).toBeLessThan(1e-9);
		}
		expect(fs.existsSync(path.join(REPO_ROOT, "scripts", "__pycache__"))).toBe(false);

		// (b) mismatch → ×(실제=…) + rc 1, 비밀 표식 문자열 미노출 (미커밋 n 표기도 함께 확인)
		fs.writeFileSync(
			path.join(stateDir, "git-status-mock"),
			" M scripts/team-up.sh\n?? .local/agy/68-result-r4.md\n",
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "proc-mate.json"),
			makeProcessInfoJson([
				{
					pid: 3010,
					name: "agy",
					argv0: "agy",
					cwd: REPO_ROOT,
					argv: [
						"agy",
						"--model",
						"SECRET_ACTUAL_MODEL_TOKEN_999",
						"--conversation",
						"SECRET_CONV_ID_888",
					],
				},
			]),
			"utf8",
		);
		const mismatchRes = runTeamUp(["--status"], okEnv);
		expect(mismatchRes.status).toBe(1);
		expect(mismatchRes.stderr).toBe("");
		expect(mismatchRes.stdout.trim().split("\n")).toEqual([
			"- 팀장 세션: 이 세션(id 앞 8자 status-l), 팀장 모드 herdr 밖(외부 팀장), 잠금 mine",
			"- 팀원: gjc-herdr-mate w1:p2 agy 옵션 일치 ×(실제=다름:--model,없음:--mode,없음:--sandbox) resume 해당 없음 확인창 없음 상태 idle",
			"- 팀원: gjc-herdr-critic w1:p3 codex 옵션 일치 ○ resume 해당 없음 확인창 없음 상태 idle",
			"- 저장소: i68 @1a2b3c4, 작업 트리 미커밋 2",
			"- 팀장 감시: 모름(팀장이 채움)",
			"- 띄운 것·바꾼 것: 없음(--status는 읽기 전용)",
			"- 진행 중이던 일·잃은 것: 모름(팀장이 채움)",
			"- 미확인: 없음",
		]);
		expect(mismatchRes.stdout).not.toContain("SECRET_ACTUAL_MODEL_TOKEN_999");
		expect(mismatchRes.stdout).not.toContain("SECRET_CONV_ID_888");
		expect(mismatchRes.stdout).not.toContain("SENTINEL_CHILD_API_KEY_777");
		expect(fs.readFileSync(lockPath, "utf8")).toBe(beforeSnap);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());

		// (c) Codex 꺼짐 + blocked + 세션 id 환경변수 없음(모름) + git 실패(저장소: 모름)
		writeValidMateProc();
		writeDefaultMateAgent(REPO_ROOT, "blocked", false);
		fs.rmSync(path.join(stateDir, "git-status-mock"), { force: true });
		fs.writeFileSync(path.join(stateDir, "git-status-fail"), "1", "utf8");
		writeLockRecord({
			kind: "herdr",
			sessionId: "other-secret-lock-sid-9999",
			socketPath: otherLiveSockPath,
		});
		const otherSnap = fs.readFileSync(lockPath, "utf8");
		const combinedRes = runTeamUp(["--status"], {
			GJCH_EXTERNAL_LEAD: "1",
			GJCH_TEAM_CODEX: "0",
			CLAUDE_PROJECT_DIR: REPO_ROOT,
			CLAUDE_CODE_SESSION_ID: undefined,
			CLAUDE_CODE_MESSAGING_SOCKET: mySockPath,
		});
		expect(combinedRes.status).toBe(0);
		expect(combinedRes.stderr).toBe("");
		expect(combinedRes.stdout.trim().split("\n")).toEqual([
			"- 팀장 세션: 이 세션(id 앞 8자 모름), 팀장 모드 herdr 밖(외부 팀장), 잠금 other live",
			"- 팀원: gjc-herdr-mate w1:p2 agy 옵션 일치 ○ resume 해당 없음 확인창 question 상태 blocked",
			"- 저장소: 모름",
			"- 팀장 감시: 모름(팀장이 채움)",
			"- 띄운 것·바꾼 것: 없음(--status는 읽기 전용)",
			"- 진행 중이던 일·잃은 것: 모름(팀장이 채움)",
			"- 미확인: 팀장 세션 id 모름, 저장소 모름",
		]);
		expect(combinedRes.stdout).not.toContain("other-secret-lock-sid");
		expect(combinedRes.stdout).not.toContain("gjc-herdr-critic");
		expect(fs.readFileSync(lockPath, "utf8")).toBe(otherSnap);
		expect(readAndClearHerdrCalls()).toEqual([
			"agent get gjc-herdr-mate",
			"pane process-info --pane w1:p2",
			"agent read gjc-herdr-mate --source visible",
		]);
		readAndClearGitStatusCalls();

		// (d) agent 조회와 pane 보충 모두에서 상태를 얻지 못한 경우:
		//     --status는 '상태 없음' + 미확인 줄에 '<이름> 상태 모름'을 더하고(합성 idle 금지),
		//     --check는 기존 판정(합성 idle → ok)을 유지한다
		fs.rmSync(path.join(stateDir, "git-status-fail"), { force: true });
		fs.writeFileSync(path.join(stateDir, "git-status-mock"), "", "utf8");
		fs.writeFileSync(path.join(stateDir, "pane-no-status"), "1", "utf8");
		writeDefaultMateAgent(REPO_ROOT, "", true);
		writeLockRecord({
			kind: "external",
			sessionId: "status-lead-session-9999",
			socketPath: mySockPath,
		});
		const noStatusEnv = {
			...okEnv,
			GJCH_TEAM_CODEX: "0",
		};
		const statusNoAgentStatus = runTeamUp(["--status"], noStatusEnv);
		expect(statusNoAgentStatus.status).toBe(0);
		expect(statusNoAgentStatus.stderr).toBe("");
		expect(statusNoAgentStatus.stdout.trim().split("\n")).toEqual([
			"- 팀장 세션: 이 세션(id 앞 8자 status-l), 팀장 모드 herdr 밖(외부 팀장), 잠금 mine",
			"- 팀원: gjc-herdr-mate w1:p2 agy 옵션 일치 ○ resume 해당 없음 확인창 없음 상태 없음",
			"- 저장소: i68 @1a2b3c4, 작업 트리 깨끗",
			"- 팀장 감시: 모름(팀장이 채움)",
			"- 띄운 것·바꾼 것: 없음(--status는 읽기 전용)",
			"- 진행 중이던 일·잃은 것: 모름(팀장이 채움)",
			"- 미확인: gjc-herdr-mate 상태 모름",
		]);
		expect(readAndClearHerdrCalls()).toEqual([
			"agent get gjc-herdr-mate",
			"pane get w1:p2",
			"pane process-info --pane w1:p2",
			"agent read gjc-herdr-mate --source visible",
		]);
		readAndClearGitStatusCalls();

		const checkNoAgentStatus = runTeamUp(["--check"], noStatusEnv);
		expect(checkNoAgentStatus.status).toBe(0);
		expect(checkNoAgentStatus.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 ok",
			"lock mine",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());
	}, 60_000);

	test("8. (#60 3·4회차) --check (dialog=agy-command), --status 확인창 codex-trust(상태 idle), 화면 읽기 실패·지연 시 모름·미확인 기록 및 옵션/lock/rc 불변(P2)", () => {
		fs.writeFileSync(path.join(stateDir, "git-status-mock"), "", "utf8");
		writeLockRecord({
			kind: "external",
			sessionId: "dialog-lead-session-6000",
			socketPath: mySockPath,
		});
		const env60 = {
			GJCH_EXTERNAL_LEAD: "1",
			CLAUDE_PROJECT_DIR: REPO_ROOT,
			CLAUDE_CODE_SESSION_ID: "dialog-lead-session-6000",
			CLAUDE_CODE_MESSAGING_SOCKET: mySockPath,
		};

		const agyCommandScreen = `Requesting permission for:
   echo hello

Run this command?
> 1. Yes, run command
  4. No, cancel

  ↑/↓ Navigate · tab Amend · enter Confirm
`;
		const codexTrustIdleScreen = `  Folder access
  /Users/test-secret/project

  Trust this folder? Codex can read, edit, and run files here.

› 1. Trust and continue
  2. Back to Agent Command Center

  enter continue · esc back
`;

		// (1) mate는 blocked + agy-command 화면, critic은 idle + codex-trust 화면
		writeDefaultMateAgent(REPO_ROOT, "blocked", false);
		writeDefaultCriticAgent(REPO_ROOT, "idle", true);
		fs.writeFileSync(path.join(stateDir, "screen-mate.txt"), agyCommandScreen, "utf8");
		fs.writeFileSync(path.join(stateDir, "screen-critic.txt"), codexTrustIdleScreen, "utf8");

		const checkDialogRes = runTeamUp(["--check"], env60);
		// 확인창은 rc에 넣지 않으므로 모두 옵션·cwd 일치 시 rc 0
		expect(checkDialogRes.status).toBe(0);
		expect(checkDialogRes.stderr).toBe("");
		expect(checkDialogRes.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 ok (dialog=agy-command)",
			"gjc-herdr-critic w1:p3 ok (dialog=codex-trust)",
			"lock mine",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());

		const statusDialogRes = runTeamUp(["--status"], env60);
		expect(statusDialogRes.status).toBe(0);
		expect(statusDialogRes.stderr).toBe("");
		expect(statusDialogRes.stdout.trim().split("\n")).toEqual([
			"- 팀장 세션: 이 세션(id 앞 8자 dialog-l), 팀장 모드 herdr 밖(외부 팀장), 잠금 mine",
			"- 팀원: gjc-herdr-mate w1:p2 agy 옵션 일치 ○ resume 해당 없음 확인창 agy-command 상태 blocked",
			"- 팀원: gjc-herdr-critic w1:p3 codex 옵션 일치 ○ resume 해당 없음 확인창 codex-trust 상태 idle",
			"- 저장소: i68 @1a2b3c4, 작업 트리 깨끗",
			"- 팀장 감시: 모름(팀장이 채움)",
			"- 띄운 것·바꾼 것: 없음(--status는 읽기 전용)",
			"- 진행 중이던 일·잃은 것: 모름(팀장이 채움)",
			"- 미확인: 없음",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());
		readAndClearGitStatusCalls();

		// (2) 화면 읽기 실패 시: --status는 '확인창 모름' + 미확인 줄에 '<이름> 확인창 모름',
		//     --check는 blocked면 ' (blocked)', idle이면 접미사 없음 (rc는 바꾸지 않음)
		fs.writeFileSync(path.join(stateDir, "read-mate-fail"), "1", "utf8");
		fs.writeFileSync(path.join(stateDir, "read-critic-fail"), "1", "utf8");

		const statusReadFailRes = runTeamUp(["--status"], env60);
		expect(statusReadFailRes.status).toBe(0);
		expect(statusReadFailRes.stderr).toBe("");
		expect(statusReadFailRes.stdout.trim().split("\n")).toEqual([
			"- 팀장 세션: 이 세션(id 앞 8자 dialog-l), 팀장 모드 herdr 밖(외부 팀장), 잠금 mine",
			"- 팀원: gjc-herdr-mate w1:p2 agy 옵션 일치 ○ resume 해당 없음 확인창 모름 상태 blocked",
			"- 팀원: gjc-herdr-critic w1:p3 codex 옵션 일치 ○ resume 해당 없음 확인창 모름 상태 idle",
			"- 저장소: i68 @1a2b3c4, 작업 트리 깨끗",
			"- 팀장 감시: 모름(팀장이 채움)",
			"- 띄운 것·바꾼 것: 없음(--status는 읽기 전용)",
			"- 진행 중이던 일·잃은 것: 모름(팀장이 채움)",
			"- 미확인: gjc-herdr-mate 확인창 모름, gjc-herdr-critic 확인창 모름",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());
		readAndClearGitStatusCalls();

		const checkReadFailRes = runTeamUp(["--check"], env60);
		expect(checkReadFailRes.status).toBe(0);
		expect(checkReadFailRes.stderr).toBe("");
		expect(checkReadFailRes.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 ok (blocked)",
			"gjc-herdr-critic w1:p3 ok",
			"lock mine",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());

		// (3) P2: 팀원 1의 agent read가 느려도(GJCH_CHECK_TIMEOUT 소진) 이미 먼저 마친 팀원 2의 옵션 점검·잠금·git 결과와 rc 0은 바뀌지 않고 확인창만 모름 처리
		fs.rmSync(path.join(stateDir, "read-mate-fail"), { force: true });
		fs.rmSync(path.join(stateDir, "read-critic-fail"), { force: true });
		fs.writeFileSync(path.join(stateDir, "read-mate-slow"), "1", "utf8");

		const slowReadEnv = {
			...env60,
			GJCH_CHECK_TIMEOUT: "1",
		};
		const checkSlowReadRes = runTeamUp(["--check"], slowReadEnv);
		expect(checkSlowReadRes.status).toBe(0);
		expect(checkSlowReadRes.stderr).toBe("");
		expect(checkSlowReadRes.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 ok (blocked)",
			"gjc-herdr-critic w1:p3 ok",
			"lock mine",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());

		const statusSlowReadRes = runTeamUp(["--status"], slowReadEnv);
		expect(statusSlowReadRes.status).toBe(0);
		expect(statusSlowReadRes.stderr).toBe("");
		expect(statusSlowReadRes.stdout.trim().split("\n")).toEqual([
			"- 팀장 세션: 이 세션(id 앞 8자 dialog-l), 팀장 모드 herdr 밖(외부 팀장), 잠금 mine",
			"- 팀원: gjc-herdr-mate w1:p2 agy 옵션 일치 ○ resume 해당 없음 확인창 모름 상태 blocked",
			"- 팀원: gjc-herdr-critic w1:p3 codex 옵션 일치 ○ resume 해당 없음 확인창 모름 상태 idle",
			"- 저장소: i68 @1a2b3c4, 작업 트리 깨끗",
			"- 팀장 감시: 모름(팀장이 채움)",
			"- 띄운 것·바꾼 것: 없음(--status는 읽기 전용)",
			"- 진행 중이던 일·잃은 것: 모름(팀장이 채움)",
			"- 미확인: gjc-herdr-mate 확인창 모름, gjc-herdr-critic 확인창 모름",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());
		readAndClearGitStatusCalls();

		// (4) 5회차 항목 3: agent read가 rc 0이어도 화면이 비었거나 공백뿐이면 관측 실패('확인창 모름' + 미확인 줄 기록)로 처리
		fs.rmSync(path.join(stateDir, "read-mate-slow"), { force: true });
		fs.writeFileSync(path.join(stateDir, "screen-mate.txt"), "   \n\t\n", "utf8");
		fs.writeFileSync(path.join(stateDir, "screen-critic.txt"), "", "utf8");

		const statusEmptyScreenRes = runTeamUp(["--status"], env60);
		expect(statusEmptyScreenRes.status).toBe(0);
		expect(statusEmptyScreenRes.stderr).toBe("");
		expect(statusEmptyScreenRes.stdout.trim().split("\n")).toEqual([
			"- 팀장 세션: 이 세션(id 앞 8자 dialog-l), 팀장 모드 herdr 밖(외부 팀장), 잠금 mine",
			"- 팀원: gjc-herdr-mate w1:p2 agy 옵션 일치 ○ resume 해당 없음 확인창 모름 상태 blocked",
			"- 팀원: gjc-herdr-critic w1:p3 codex 옵션 일치 ○ resume 해당 없음 확인창 모름 상태 idle",
			"- 저장소: i68 @1a2b3c4, 작업 트리 깨끗",
			"- 팀장 감시: 모름(팀장이 채움)",
			"- 띄운 것·바꾼 것: 없음(--status는 읽기 전용)",
			"- 진행 중이던 일·잃은 것: 모름(팀장이 채움)",
			"- 미확인: gjc-herdr-mate 확인창 모름, gjc-herdr-critic 확인창 모름",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());
		readAndClearGitStatusCalls();

		const checkEmptyScreenRes = runTeamUp(["--check"], env60);
		expect(checkEmptyScreenRes.status).toBe(0);
		expect(checkEmptyScreenRes.stderr).toBe("");
		expect(checkEmptyScreenRes.stdout.trim().split("\n")).toEqual([
			"gjc-herdr-mate w1:p2 ok (blocked)",
			"gjc-herdr-critic w1:p3 ok",
			"lock mine",
		]);
		assertReadOnlyHerdrCalls(readAndClearHerdrCalls());
	}, 60_000);
});
