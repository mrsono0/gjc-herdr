import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = fs.realpathSync(path.resolve(import.meta.dir, ".."));
const CHECKER_PY = path.join(REPO_ROOT, "scripts", "agent-argv-check.py");
const TEAM_UP_SH = path.join(REPO_ROOT, "scripts", "team-up.sh");
const CHECK_ENV_SH = path.join(REPO_ROOT, "scripts", "check-env.sh");
const SPAWN_TIMEOUT_MS = 40_000;

const CODEX_STATUS_LINE =
	'tui.status_line=["context-remaining","total-input-tokens","total-output-tokens"]';
const RECOVERY_INSIDE =
	"idle·빈 입력란 확인 → /quit → scripts/team-up.sh --spawn";
const RECOVERY_EXTERNAL =
	"idle·빈 입력란 확인 → /quit → GJCH_EXTERNAL_LEAD=1 scripts/team-up.sh --spawn";

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
	"GJCH_TEAM_CODEX",
	"GJCH_WS_LABEL",
	"GJCH_FROM_HOOK",
	"GJCH_HOOK_ARGV_TIMEOUT",
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

const AGY_EXPECTED_UNITS = [
	"--model gemini-4-argon-high",
	"--mode accept-edits",
	"--sandbox",
];

const CODEX_EXPECTED_UNITS = [
	"--no-daemon",
	"--yolo",
	"-m gpt-6.1-sol",
	`-C ${REPO_ROOT}`,
	"--disable worktrees",
	`-c ${CODEX_STATUS_LINE}`,
];

function makeProcessInfoJson(
	processes: Array<Record<string, unknown>>,
	includeSentinelNode = true,
	typeValue = "pane_process_info",
): string {
	const fg = [...processes];
	if (includeSentinelNode) {
		fg.push(
			{
				pid: 9001,
				name: "node",
				argv0: "node",
				cwd: REPO_ROOT,
				argv: [
					"node",
					"/Users/test/.npm/context7-mcp/index.js",
					"--api-key",
					"SENTINEL_API_KEY_123",
				],
				cmdline:
					"node /Users/test/.npm/context7-mcp/index.js --api-key SENTINEL_API_KEY_123",
			},
			{
				pid: 9002,
				name: "node",
				argv0: "node",
				cwd: REPO_ROOT,
			},
		);
	}
	return JSON.stringify({
		id: "req-1",
		result: {
			type: typeValue,
			process_info: {
				pane_id: "w1:p2",
				shell_pid: 1000,
				foreground_process_group_id: 2000,
				foreground_processes: fg,
			},
		},
	});
}

function runChecker(params: {
	stdin?: string;
	kind: "agy" | "codex";
	name: string;
	recovery?: string;
	status?: string;
	processInfoFailed?: boolean;
	expectedUnits?: string[];
}): { status: number | null; stdout: string; stderr: string } {
	const args: string[] = [CHECKER_PY];
	if (params.processInfoFailed) {
		args.push("--process-info-failed");
	}
	if (params.status !== undefined) {
		args.push("--status", params.status);
	}
	args.push(
		params.kind,
		params.name,
		params.recovery ?? RECOVERY_INSIDE,
		"--",
		...(params.expectedUnits ??
			(params.kind === "agy" ? AGY_EXPECTED_UNITS : CODEX_EXPECTED_UNITS)),
	);
	const res = spawnSync(REAL_PYTHON3, args, {
		input: params.stdin ?? "",
		encoding: "utf8",
		timeout: SPAWN_TIMEOUT_MS,
	});
	return {
		status: res.status,
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
	};
}

describe("agent argv check (#42)", () => {
	let tmpDir = "";
	let sockDir = "";
	let sockPath = "";
	let binDir = "";
	let tmpHome = "";
	let tmpHerdrConfig = "";
	let herdrLog = "";
	let lockPath = "";
	let stateDir = "";

	function writeDefaultMateAgent(status = "idle", interactiveReady = true): void {
		fs.writeFileSync(
			path.join(stateDir, "agent-mate.json"),
			JSON.stringify({
				result: {
					agent: {
						pane_id: "w1:p2",
						workspace_id: "w1",
						agent: "agy",
						name: "gjc-herdr-mate",
						cwd: REPO_ROOT,
						foreground_cwd: REPO_ROOT,
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

	function waitForHookBgSpawn(): void {
		const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
		const donePath = path.join(stateDir, "hook-bg-done");
		const deadline = Date.now() + 25_000;
		while (Date.now() < deadline) {
			if (fs.existsSync(donePath)) {
				fs.rmSync(donePath, { force: true });
				return;
			}
			Atomics.wait(sleepBuf, 0, 0, 50);
		}
		throw new Error("Timed out waiting for background hook --spawn to finish");
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

	function readHerdrCalls(): string[] {
		return fs.existsSync(herdrLog)
			? fs
					.readFileSync(herdrLog, "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
			: [];
	}

	beforeAll(() => {
		const rawTmp = fs.mkdtempSync(path.join(os.tmpdir(), "gjc-herdr-argv-check-"));
		tmpDir = fs.realpathSync(rawTmp);
		sockDir = fs.mkdtempSync(path.join("/tmp", "gjch-s-"));
		sockPath = path.join(sockDir, "s.sock");
		binDir = path.join(tmpDir, "bin");
		tmpHome = path.join(tmpDir, "home");
		tmpHerdrConfig = path.join(tmpHome, ".config", "herdr", "config.toml");
		herdrLog = path.join(tmpDir, "herdr-calls.log");
		lockPath = path.join(tmpDir, "lead.json");
		stateDir = path.join(tmpDir, "state");

		fs.mkdirSync(binDir, { recursive: true });
		fs.mkdirSync(stateDir, { recursive: true });
		fs.mkdirSync(path.dirname(tmpHerdrConfig), { recursive: true });
		fs.writeFileSync(tmpHerdrConfig, "# isolated test config (gjc_herdr_model)\n", "utf8");

		const sockBind = spawnSync(
			REAL_PYTHON3,
			[
				"-c",
				"import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1]); s.close()",
				sockPath,
			],
			{ encoding: "utf8", timeout: 5_000 },
		);
		if (sockBind.status !== 0) {
			throw new Error(`Failed to create test unix socket: ${sockBind.stderr}`);
		}

		fs.symlinkSync(REAL_GIT, path.join(binDir, "git"));
		fs.symlinkSync(REAL_PYTHON3, path.join(binDir, "python3"));

		writeExecutable(
			path.join(binDir, "nohup"),
			`#!/bin/sh
${JSON.stringify(REAL_NOHUP)} "$@"
rc=$?
printf '1' > ${JSON.stringify(path.join(stateDir, "hook-bg-done"))}
exit $rc
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
		writeExecutable(
			path.join(binDir, "bun"),
			"#!/bin/sh\nprintf '1.4.3\\n'\n",
		);
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
printf '%s\\n' "$*" >> ${JSON.stringify(herdrLog)}
cmd="\${1:-}"
sub="\${2:-}"
if [ "$cmd" = "--version" ]; then
	printf '0.9.3-stub\\n'
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
		cat ${JSON.stringify(path.join(stateDir, "agent-critic.json"))}
		exit 0
	fi
	printf '{"error":{"code":"agent_not_found","message":"not found"}}\\n' >&2
	exit 1
fi
if [ "$cmd" = "agent" ] && [ "$sub" = "rename" ]; then
	printf '{"result":{"ok":true}}\\n'
	exit 0
fi
if [ "$cmd" = "workspace" ] && [ "$sub" = "get" ]; then
	printf '{"result":{"workspace":{"workspace_id":"w1","label":"GJCH · gjc-herdr"}}}\\n'
	exit 0
fi
if [ "$cmd" = "workspace" ] && [ "$sub" = "rename" ]; then
	printf '{"result":{"ok":true}}\\n'
	exit 0
fi
if [ "$cmd" = "pane" ] && [ "$sub" = "rename" ]; then
	printf '{"result":{"ok":true}}\\n'
	exit 0
fi
if [ "$cmd" = "pane" ] && [ "$sub" = "get" ]; then
	pane="\${3:-}"
	if [ "$pane" = "w1:p1" ] && [ -f ${JSON.stringify(path.join(stateDir, "lead-pane-outside"))} ]; then
		printf '{"result":{"pane":{"pane_id":"%s","workspace_id":"w1","tab_id":"w1:t1","cwd":"/tmp","foreground_cwd":"/tmp","agent_status":"idle"}}}\\n' "$pane"
		exit 0
	fi
	printf '{"result":{"pane":{"pane_id":"%s","workspace_id":"w1","tab_id":"w1:t1","cwd":%s,"foreground_cwd":%s,"agent_status":"idle"}}}\\n' "$pane" ${JSON.stringify(JSON.stringify(REPO_ROOT))} ${JSON.stringify(JSON.stringify(REPO_ROOT))}
	exit 0
fi
if [ "$cmd" = "pane" ] && [ "$sub" = "layout" ]; then
	cat ${JSON.stringify(path.join(stateDir, "layout.json"))}
	exit 0
fi
if [ "$cmd" = "pane" ] && [ "$sub" = "process-info" ]; then
	pane="\${4:-}"
	if [ "$pane" = "w1:p2" ]; then
		if [ -f ${JSON.stringify(path.join(stateDir, "proc-mate-slow"))} ] && [ "\${GJCH_FROM_HOOK:-}" != "1" ]; then
			sleep 10
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
printf '{"result":{"ok":true}}\\n'
`,
		);

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
		writeDefaultMateAgent("idle", true);
		writeDefaultCriticAgent(REPO_ROOT, "idle", true);
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
		fs.rmSync(lockPath, { force: true });
		fs.rmSync(`${lockPath}.mutex`, { force: true });
		fs.rmSync(path.join(stateDir, "proc-mate-fail"), { force: true });
		fs.rmSync(path.join(stateDir, "proc-critic-fail"), { force: true });
		fs.rmSync(path.join(stateDir, "proc-mate-slow"), { force: true });
		fs.rmSync(path.join(stateDir, "agent-mate-absent"), { force: true });
		fs.rmSync(path.join(stateDir, "lead-pane-outside"), { force: true });
		fs.rmSync(path.join(stateDir, "hook-bg-done"), { force: true });
		writeDefaultMateAgent("idle", true);
		writeDefaultCriticAgent(REPO_ROOT, "idle", true);
	});

	afterAll(() => {
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
		if (sockDir) {
			fs.rmSync(sockDir, { recursive: true, force: true });
		}
	});

	test("1. 정상 agy·Codex(현재 시작 인자 그대로) → rc 0, 출력 없음", () => {
		const agyRes = runChecker({
			kind: "agy",
			name: "gjc-herdr-mate",
			stdin: makeProcessInfoJson([
				{
					pid: 3001,
					name: "/opt/homebrew/bin/agy",
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
		});
		expect(agyRes.status).toBe(0);
		expect(agyRes.stdout).toBe("");
		expect(agyRes.stderr).toBe("");

		const codexRes = runChecker({
			kind: "codex",
			name: "gjc-herdr-critic",
			stdin: makeProcessInfoJson(
				[
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
						],
					},
				],
				true,
				"any_other_type_value",
			),
		});
		expect(codexRes.status).toBe(0);
		expect(codexRes.stdout).toBe("");
		expect(codexRes.stderr).toBe("");
	});

	test("2. 복구 형태 agy --conversation <id> → 없음 세 단위, 실제 id·자식 프로세스 비밀 미노출", () => {
		const res = runChecker({
			kind: "agy",
			name: "gjc-herdr-mate",
			stdin: makeProcessInfoJson([
				{
					pid: 3010,
					name: "agy",
					argv0: "agy",
					cwd: REPO_ROOT,
					argv: ["agy", "--conversation", "conv-secret-id-98765"],
				},
			]),
		});
		expect(res.status).toBe(1);
		expect(res.stdout.trim()).toBe(
			`↳ gjc-herdr-mate 옵션 불일치: 없음 --model gemini-4-argon-high, --mode accept-edits, --sandbox (복구: ${RECOVERY_INSIDE})`,
		);
		expect(res.stdout).not.toContain("conv-secret-id-98765");
		expect(res.stdout).not.toContain("SENTINEL_API_KEY_123");
		expect(res.stderr).toBe("");
	});

	test("3. 복구 형태 codex resume <id> → 없음 여섯 단위, 실제 id·자식 프로세스 비밀 미노출", () => {
		const res = runChecker({
			kind: "codex",
			name: "gjc-herdr-critic",
			recovery: RECOVERY_EXTERNAL,
			stdin: makeProcessInfoJson([
				{
					pid: 3020,
					name: "codex",
					argv0: "codex",
					cwd: REPO_ROOT,
					argv: ["codex", "resume", "019a0000-secret-session-id"],
				},
			]),
		});
		expect(res.status).toBe(1);
		expect(res.stdout.trim()).toBe(
			`↳ gjc-herdr-critic 옵션 불일치: 없음 --no-daemon, --yolo, -m gpt-6.1-sol, -C ${REPO_ROOT}, --disable worktrees, -c ${CODEX_STATUS_LINE} (복구: ${RECOVERY_EXTERNAL})`,
		);
		expect(res.stdout).not.toContain("019a0000-secret-session-id");
		expect(res.stdout).not.toContain("SENTINEL_API_KEY_123");
		expect(res.stderr).toBe("");
	});

	test("4. 값 다름(--model 다른 값), 없음+다름 혼합, '=' 결합형 미지원('없음') → 실제 값 미출력", () => {
		const diffOnly = runChecker({
			kind: "agy",
			name: "gjc-herdr-mate",
			stdin: makeProcessInfoJson([
				{
					pid: 3030,
					name: "agy",
					argv0: "agy",
					cwd: REPO_ROOT,
					argv: [
						"agy",
						"--model",
						"ACTUAL_SECRET_MODEL_VALUE",
						"--mode",
						"accept-edits",
						"--sandbox",
					],
				},
			]),
		});
		expect(diffOnly.status).toBe(1);
		expect(diffOnly.stdout.trim()).toBe(
			`↳ gjc-herdr-mate 옵션 불일치: 다름 --model(기대 gemini-4-argon-high) (복구: ${RECOVERY_INSIDE})`,
		);
		expect(diffOnly.stdout).not.toContain("ACTUAL_SECRET_MODEL_VALUE");
		expect(diffOnly.stdout).not.toContain("SENTINEL_API_KEY_123");

		const missingAndDiff = runChecker({
			kind: "agy",
			name: "gjc-herdr-mate",
			stdin: makeProcessInfoJson([
				{
					pid: 3031,
					name: "agy",
					argv0: "agy",
					cwd: REPO_ROOT,
					argv: [
						"agy",
						"--model",
						"ACTUAL_SECRET_MODEL_VALUE",
						"--mode",
						"ACTUAL_SECRET_MODE_VALUE",
					],
				},
			]),
		});
		expect(missingAndDiff.status).toBe(1);
		expect(missingAndDiff.stdout.trim()).toBe(
			`↳ gjc-herdr-mate 옵션 불일치: 없음 --sandbox; 다름 --model(기대 gemini-4-argon-high), --mode(기대 accept-edits) (복구: ${RECOVERY_INSIDE})`,
		);
		expect(missingAndDiff.stdout).not.toContain("ACTUAL_SECRET_MODEL_VALUE");
		expect(missingAndDiff.stdout).not.toContain("ACTUAL_SECRET_MODE_VALUE");

		const equalsCombined = runChecker({
			kind: "agy",
			name: "gjc-herdr-mate",
			stdin: makeProcessInfoJson([
				{
					pid: 3032,
					name: "agy",
					argv0: "agy",
					cwd: REPO_ROOT,
					argv: [
						"agy",
						"--model=gemini-4-argon-high",
						"--mode",
						"accept-edits",
						"--sandbox",
					],
				},
			]),
		});
		expect(equalsCombined.status).toBe(1);
		expect(equalsCombined.stdout.trim()).toBe(
			`↳ gjc-herdr-mate 옵션 불일치: 없음 --model gemini-4-argon-high (복구: ${RECOVERY_INSIDE})`,
		);
	});

	test("5. -c 반복·순서 바뀜·추가 옵션은 일치로 판정", () => {
		const res = runChecker({
			kind: "codex",
			name: "gjc-herdr-critic",
			stdin: makeProcessInfoJson([
				{
					pid: 3040,
					name: "codex",
					argv0: "codex",
					cwd: REPO_ROOT,
					argv: [
						"codex",
						"resume",
						"019a-extra-pos",
						"-c",
						'model_reasoning_effort="high"',
						"--disable",
						"worktrees",
						"-C",
						REPO_ROOT,
						"-c",
						CODEX_STATUS_LINE,
						"-c",
						'another_key="SECRET_CFG"',
						"-m",
						"gpt-6.1-sol",
						"--yolo",
						"--no-daemon",
						"--extra-flag",
					],
				},
			]),
		});
		expect(res.status).toBe(0);
		expect(res.stdout).toBe("");
	});

	test("6. 판정 불가(대상 0개, 2개 이상, argv 없음, JSON 오류, process-info 실패) 및 작업 중 접미사·비밀 보호", () => {
		const zeroProc = runChecker({
			kind: "agy",
			name: "gjc-herdr-mate",
			status: "idle",
			stdin: makeProcessInfoJson([
				{ pid: 100, name: "-zsh", argv: ["-zsh"] },
			]),
		});
		expect(zeroProc.status).toBe(1);
		expect(zeroProc.stdout.trim()).toBe(
			"↳ gjc-herdr-mate 옵션 판정 불가: agent 프로세스 0개",
		);
		expect(zeroProc.stdout).not.toContain("SENTINEL_API_KEY_123");

		const twoProcWorking = runChecker({
			kind: "agy",
			name: "gjc-herdr-mate",
			status: "working",
			stdin: makeProcessInfoJson([
				{ pid: 101, name: "agy", argv: ["agy", "--sandbox"] },
				{ pid: 102, name: "/usr/local/bin/agy", argv: ["agy", "--sandbox"] },
			]),
		});
		expect(twoProcWorking.status).toBe(1);
		expect(twoProcWorking.stdout.trim()).toBe(
			"↳ gjc-herdr-mate 옵션 판정 불가: agent 프로세스 2개 이상 (작업 중 — 다시 점검)",
		);
		expect(twoProcWorking.stdout).not.toContain("SENTINEL_API_KEY_123");

		const noArgv = runChecker({
			kind: "agy",
			name: "gjc-herdr-mate",
			status: "done",
			stdin: makeProcessInfoJson([
				{
					pid: 103,
					name: "agy",
					cmdline: "agy --secret-cmdline SENTINEL_CMDLINE_999",
				},
			]),
		});
		expect(noArgv.status).toBe(1);
		expect(noArgv.stdout.trim()).toBe(
			"↳ gjc-herdr-mate 옵션 판정 불가: argv 없음",
		);
		expect(noArgv.stdout).not.toContain("SENTINEL_CMDLINE_999");
		expect(noArgv.stdout).not.toContain("SENTINEL_API_KEY_123");

		const badJson = runChecker({
			kind: "codex",
			name: "gjc-herdr-critic",
			status: "working",
			stdin: "{broken json SENTINEL_RAW_JSON_777",
		});
		expect(badJson.status).toBe(1);
		expect(badJson.stdout.trim()).toBe(
			"↳ gjc-herdr-critic 옵션 판정 불가: JSON 오류 (작업 중 — 다시 점검)",
		);
		expect(badJson.stdout).not.toContain("SENTINEL_RAW_JSON_777");

		const legacyFlatJson = runChecker({
			kind: "agy",
			name: "gjc-herdr-mate",
			status: "idle",
			stdin: JSON.stringify({
				id: "req-legacy",
				result: {
					pane_id: "w1:p2",
					shell_pid: 1000,
					foreground_process_group_id: 2000,
					foreground_processes: [
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
					],
				},
			}),
		});
		expect(legacyFlatJson.status).toBe(1);
		expect(legacyFlatJson.stdout.trim()).toBe(
			"↳ gjc-herdr-mate 옵션 판정 불가: JSON 오류",
		);

		const procFailed = runChecker({
			kind: "agy",
			name: "gjc-herdr-mate",
			status: "blocked",
			processInfoFailed: true,
		});
		expect(procFailed.status).toBe(1);
		expect(procFailed.stdout.trim()).toBe(
			"↳ gjc-herdr-mate 옵션 판정 불가: process-info 실패 (작업 중 — 다시 점검)",
		);
	});

	test("7. 기대 단위 스냅샷: team-up.sh --print-expected-units가 고정 기대 단위와 정확히 일치", () => {
		const agySnap = spawnSync(
			"/bin/bash",
			[TEAM_UP_SH, "--print-expected-units", "agy"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
				timeout: SPAWN_TIMEOUT_MS,
			},
		);
		expect(agySnap.status).toBe(0);
		expect(agySnap.stdout.trim().split("\n")).toEqual(AGY_EXPECTED_UNITS);

		const codexSnap = spawnSync(
			"/bin/bash",
			[TEAM_UP_SH, "--print-expected-units", "codex"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: buildEnv(),
				timeout: SPAWN_TIMEOUT_MS,
			},
		);
		expect(codexSnap.status).toBe(0);
		expect(codexSnap.stdout.trim().split("\n")).toEqual(CODEX_EXPECTED_UNITS);
	});

	test("8. team-up.sh 통합(--spawn, --layout) 및 check-env.sh: 복구 형태 argv·process-info 실패 stderr 비밀 폐기·자동 재시작 0회", () => {
		fs.writeFileSync(
			path.join(stateDir, "proc-mate.json"),
			makeProcessInfoJson([
				{
					pid: 4001,
					name: "agy",
					argv0: "agy",
					cwd: REPO_ROOT,
					argv: ["agy", "--conversation", "conv-recover-1"],
				},
			]),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "proc-critic.json"),
			makeProcessInfoJson([
				{
					pid: 4002,
					name: "codex",
					argv0: "codex",
					cwd: REPO_ROOT,
					argv: ["codex", "resume", "sess-recover-1"],
				},
			]),
			"utf8",
		);

		const envInside = buildEnv({
			HERDR_ENV: "1",
			HERDR_WORKSPACE_ID: "w1",
			HERDR_PANE_ID: "w1:p1",
			CLAUDE_PROJECT_DIR: REPO_ROOT,
		});

		const spawnRes = spawnSync("/bin/bash", [TEAM_UP_SH, "--spawn"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: envInside,
			timeout: SPAWN_TIMEOUT_MS,
		});
		expect(spawnRes.status).toBe(1);
		expect(spawnRes.stdout).toContain("mate already exists at w1:p2; nothing spawned");
		expect(spawnRes.stdout).toContain("critic already exists at w1:p3; nothing spawned");
		expect(spawnRes.stdout).toContain("layout: lead w1:p1 on top (60%)");
		expect(spawnRes.stderr).toContain(
			`↳ gjc-herdr-mate 옵션 불일치: 없음 --model gemini-4-argon-high, --mode accept-edits, --sandbox (복구: ${RECOVERY_INSIDE})`,
		);
		expect(spawnRes.stderr).toContain(
			`↳ gjc-herdr-critic 옵션 불일치: 없음 --no-daemon, --yolo, -m gpt-6.1-sol, -C ${REPO_ROOT}, --disable worktrees, -c ${CODEX_STATUS_LINE} (복구: ${RECOVERY_INSIDE})`,
		);
		expect(spawnRes.stderr).not.toContain("SENTINEL_API_KEY_123");

		const calls = readHerdrCalls();
		expect(calls.some((c) => c.includes("send-keys"))).toBe(false);
		expect(calls.some((c) => c.includes("send-text"))).toBe(false);
		expect(calls.some((c) => c.includes("agent start"))).toBe(false);

		const layoutRes = spawnSync("/bin/bash", [TEAM_UP_SH, "--layout"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: envInside,
			timeout: SPAWN_TIMEOUT_MS,
		});
		expect(layoutRes.status).toBe(1);
		expect(layoutRes.stderr).toContain("↳ gjc-herdr-mate 옵션 불일치:");
		expect(layoutRes.stderr).toContain("↳ gjc-herdr-critic 옵션 불일치:");

		const hookSpawnRes = spawnSync("/bin/bash", [TEAM_UP_SH, "--spawn"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: { ...envInside, GJCH_FROM_HOOK: "1" },
			timeout: SPAWN_TIMEOUT_MS,
		});
		expect(hookSpawnRes.status).toBe(0);
		expect(hookSpawnRes.stdout).toContain(
			`GJCH: ↳ gjc-herdr-mate 옵션 불일치: 없음 --model gemini-4-argon-high, --mode accept-edits, --sandbox (복구: ${RECOVERY_INSIDE})`,
		);
		expect(hookSpawnRes.stdout).toContain(
			`GJCH: ↳ gjc-herdr-critic 옵션 불일치: 없음 --no-daemon, --yolo, -m gpt-6.1-sol, -C ${REPO_ROOT}, --disable worktrees, -c ${CODEX_STATUS_LINE} (복구: ${RECOVERY_INSIDE})`,
		);
		expect(hookSpawnRes.stderr).toBe("");

		const checkEnvMismatch = spawnSync("/bin/bash", [CHECK_ENV_SH], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: envInside,
			timeout: SPAWN_TIMEOUT_MS,
		});
		expect(checkEnvMismatch.status).toBe(1);
		expect(checkEnvMismatch.stdout).toContain(
			"FAIL  ↳ gjc-herdr-mate 옵션 불일치:",
		);
		expect(checkEnvMismatch.stdout).toContain(
			"FAIL  ↳ gjc-herdr-critic 옵션 불일치:",
		);
		expect(checkEnvMismatch.stdout).not.toContain("SENTINEL_API_KEY_123");

		// process-info 실패 분기(proc-mate-fail·proc-critic-fail): stderr sentinel 미노출 확인
		fs.writeFileSync(path.join(stateDir, "proc-mate-fail"), "1", "utf8");
		fs.writeFileSync(path.join(stateDir, "proc-critic-fail"), "1", "utf8");

		const spawnFailRes = spawnSync("/bin/bash", [TEAM_UP_SH, "--spawn"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: envInside,
			timeout: SPAWN_TIMEOUT_MS,
		});
		expect(spawnFailRes.status).toBe(1);
		expect(spawnFailRes.stderr).toContain(
			"↳ gjc-herdr-mate 옵션 판정 불가: process-info 실패",
		);
		expect(spawnFailRes.stderr).toContain(
			"↳ gjc-herdr-critic 옵션 판정 불가: process-info 실패",
		);
		expect(spawnFailRes.stdout).not.toContain("SENTINEL_STDERR_SECRET");
		expect(spawnFailRes.stderr).not.toContain("SENTINEL_STDERR_SECRET");

		const checkEnvFailRes = spawnSync("/bin/bash", [CHECK_ENV_SH], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: envInside,
			timeout: SPAWN_TIMEOUT_MS,
		});
		expect(checkEnvFailRes.status).toBe(1);
		expect(checkEnvFailRes.stdout).toContain(
			"FAIL  ↳ gjc-herdr-mate 옵션 판정 불가: process-info 실패",
		);
		expect(checkEnvFailRes.stdout).toContain(
			"FAIL  ↳ gjc-herdr-critic 옵션 판정 불가: process-info 실패",
		);
		expect(checkEnvFailRes.stdout).not.toContain("SENTINEL_STDERR_SECRET");
		expect(checkEnvFailRes.stderr).not.toContain("SENTINEL_STDERR_SECRET");

		fs.rmSync(path.join(stateDir, "proc-mate-fail"), { force: true });
		fs.rmSync(path.join(stateDir, "proc-critic-fail"), { force: true });

		// Now switch both to valid start argv and verify rc 0
		fs.writeFileSync(
			path.join(stateDir, "proc-mate.json"),
			makeProcessInfoJson([
				{
					pid: 4001,
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
		fs.writeFileSync(
			path.join(stateDir, "proc-critic.json"),
			makeProcessInfoJson([
				{
					pid: 4002,
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
					],
				},
			]),
			"utf8",
		);

		const spawnOk = spawnSync("/bin/bash", [TEAM_UP_SH, "--spawn"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: envInside,
			timeout: SPAWN_TIMEOUT_MS,
		});
		expect(spawnOk.status).toBe(0);
		expect(spawnOk.stderr).toBe("");

		const checkEnvOk = spawnSync("/bin/bash", [CHECK_ENV_SH], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: envInside,
			timeout: SPAWN_TIMEOUT_MS,
		});
		expect(checkEnvOk.status).toBe(0);
		expect(checkEnvOk.stdout).toContain("OK    gjc-herdr-mate (w1:p2) 시작 옵션 일치");
		expect(checkEnvOk.stdout).toContain("OK    gjc-herdr-critic (w1:p3) 시작 옵션 일치");
	}, 150_000);

	test("9. 실제 --hook(외부 팀장), 느린 process-info 3초 기한 초과, blocked·process-info 실패·agent_not_found·cwd 불일치 점검", () => {
		fs.writeFileSync(
			path.join(stateDir, "proc-mate.json"),
			makeProcessInfoJson([
				{
					pid: 4001,
					name: "agy",
					argv0: "agy",
					cwd: REPO_ROOT,
					argv: ["agy", "--conversation", "conv-recover-1"],
				},
			]),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "proc-critic.json"),
			makeProcessInfoJson([
				{
					pid: 4002,
					name: "codex",
					argv0: "codex",
					cwd: REPO_ROOT,
					argv: ["codex", "resume", "sess-recover-1"],
				},
			]),
			"utf8",
		);

		const envExternal = buildEnv({
			GJCH_EXTERNAL_LEAD: "1",
			CLAUDE_PROJECT_DIR: REPO_ROOT,
			CLAUDE_CODE_SESSION_ID: "ext-lead-sess-1",
			CLAUDE_CODE_MESSAGING_SOCKET: sockPath,
		});

		const envInside = buildEnv({
			HERDR_ENV: "1",
			HERDR_WORKSPACE_ID: "w1",
			HERDR_PANE_ID: "w1:p1",
			CLAUDE_PROJECT_DIR: REPO_ROOT,
		});

		// (1) 실제 --hook (외부 팀장, startup)
		const hookRes = spawnSync("/bin/bash", [TEAM_UP_SH, "--hook"], {
			cwd: REPO_ROOT,
			input: '{"source":"startup"}',
			encoding: "utf8",
			env: { ...envExternal, GJCH_HOOK_ARGV_TIMEOUT: "15" },
			timeout: SPAWN_TIMEOUT_MS,
		});
		waitForHookBgSpawn();
		expect(hookRes.status).toBe(0);
		expect(hookRes.stdout).toContain(
			`GJCH: ↳ gjc-herdr-mate 옵션 불일치: 없음 --model gemini-4-argon-high, --mode accept-edits, --sandbox (복구: ${RECOVERY_EXTERNAL})`,
		);
		expect(hookRes.stdout).toContain(
			`GJCH: ↳ gjc-herdr-critic 옵션 불일치: 없음 --no-daemon, --yolo, -m gpt-6.1-sol, -C ${REPO_ROOT}, --disable worktrees, -c ${CODEX_STATUS_LINE} (복구: ${RECOVERY_EXTERNAL})`,
		);
		expect(hookRes.stderr).toBe("");

		// (2) 느린 가짜 herdr(process-info 10초 sleep) → 기본 3초 기한 + 여유 안에 rc 0 및 시간 초과 문구
		fs.writeFileSync(path.join(stateDir, "proc-mate-slow"), "1", "utf8");
		const t0 = Date.now();
		const slowHookRes = spawnSync("/bin/bash", [TEAM_UP_SH, "--hook"], {
			cwd: REPO_ROOT,
			input: '{"source":"startup"}',
			encoding: "utf8",
			env: envExternal,
			timeout: 9_000,
		});
		const elapsedMs = Date.now() - t0;
		waitForHookBgSpawn();
		fs.rmSync(path.join(stateDir, "proc-mate-slow"), { force: true });
		expect(slowHookRes.status).toBe(0);
		expect(elapsedMs).toBeGreaterThanOrEqual(2_500);
		expect(elapsedMs).toBeLessThan(8_500);
		expect(slowHookRes.stdout).toContain(
			"GJCH: ↳ 팀원 옵션 점검 시간 초과 — scripts/check-env.sh로 다시 점검",
		);
		expect(slowHookRes.stdout).not.toContain("gjc-herdr-critic 옵션 불일치");

		// (3) blocked 상태 fixture: --spawn 및 --hook에서 process-info 호출 및 비교 결과 출력
		writeDefaultMateAgent("blocked", false);
		fs.rmSync(herdrLog, { force: true });

		const blockedSpawnRes = spawnSync("/bin/bash", [TEAM_UP_SH, "--spawn"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: envInside,
			timeout: SPAWN_TIMEOUT_MS,
		});
		expect(blockedSpawnRes.status).toBe(1);
		expect(blockedSpawnRes.stderr).toContain(
			"agy가 시작 중 멈췄습니다(w1:p2, status=blocked).",
		);
		expect(blockedSpawnRes.stderr).toContain(
			`↳ gjc-herdr-mate 옵션 불일치: 없음 --model gemini-4-argon-high, --mode accept-edits, --sandbox (복구: ${RECOVERY_INSIDE})`,
		);
		const blockedSpawnCalls = readHerdrCalls();
		expect(
			blockedSpawnCalls.some((c) => c.includes("pane process-info --pane w1:p2")),
		).toBe(true);
		expect(blockedSpawnCalls.some((c) => c.includes("send-keys"))).toBe(false);
		expect(blockedSpawnCalls.some((c) => c.includes("send-text"))).toBe(false);
		expect(blockedSpawnCalls.some((c) => c.includes("agent start"))).toBe(false);

		fs.rmSync(herdrLog, { force: true });

		const blockedHookRes = spawnSync("/bin/bash", [TEAM_UP_SH, "--hook"], {
			cwd: REPO_ROOT,
			input: '{"source":"startup"}',
			encoding: "utf8",
			env: { ...envExternal, GJCH_HOOK_ARGV_TIMEOUT: "15" },
			timeout: SPAWN_TIMEOUT_MS,
		});
		waitForHookBgSpawn();
		expect(blockedHookRes.status).toBe(0);
		expect(blockedHookRes.stdout).toContain(
			`GJCH: ↳ gjc-herdr-mate 옵션 불일치: 없음 --model gemini-4-argon-high, --mode accept-edits, --sandbox (복구: ${RECOVERY_EXTERNAL})`,
		);
		const blockedHookCalls = readHerdrCalls();
		expect(
			blockedHookCalls.some((c) => c.includes("pane process-info --pane w1:p2")),
		).toBe(true);

		// (4) --hook에서 process-info 실패(stderr 비밀 폐기), agent_not_found·cwd 불일치 조용히 건너뜀
		writeDefaultMateAgent("idle", true);
		fs.writeFileSync(path.join(stateDir, "proc-mate-fail"), "1", "utf8");

		const failHookRes = spawnSync("/bin/bash", [TEAM_UP_SH, "--hook"], {
			cwd: REPO_ROOT,
			input: '{"source":"startup"}',
			encoding: "utf8",
			env: { ...envExternal, GJCH_HOOK_ARGV_TIMEOUT: "15" },
			timeout: SPAWN_TIMEOUT_MS,
		});
		waitForHookBgSpawn();
		fs.rmSync(path.join(stateDir, "proc-mate-fail"), { force: true });
		expect(failHookRes.status).toBe(0);
		expect(failHookRes.stdout).toContain(
			"GJCH: ↳ gjc-herdr-mate 옵션 판정 불가: process-info 실패",
		);
		expect(failHookRes.stdout).toContain("GJCH: ↳ gjc-herdr-critic 옵션 불일치:");
		expect(failHookRes.stdout).not.toContain("SENTINEL_STDERR_SECRET");
		expect(failHookRes.stderr).toBe("");

		fs.writeFileSync(path.join(stateDir, "agent-mate-absent"), "1", "utf8");
		writeDefaultCriticAgent("/tmp", "idle", true);

		const skipHookRes = spawnSync("/bin/bash", [TEAM_UP_SH, "--hook"], {
			cwd: REPO_ROOT,
			input: '{"source":"startup"}',
			encoding: "utf8",
			env: { ...envExternal, GJCH_HOOK_ARGV_TIMEOUT: "15" },
			timeout: SPAWN_TIMEOUT_MS,
		});
		waitForHookBgSpawn();
		expect(skipHookRes.status).toBe(0);
		expect(skipHookRes.stdout).toContain("GJCH: 이 세션이 외부 팀장입니다");
		expect(skipHookRes.stdout).not.toContain("↳");
		expect(skipHookRes.stderr).toBe("");

		// (5) external --hook에서 mate agent get이 {"result":[1]} (비-dict result)를 돌려줄 때:
		//     mate만 건너뛰고 critic 불일치 줄은 출력, stderr 빈 값, rc 0
		fs.rmSync(path.join(stateDir, "agent-mate-absent"), { force: true });
		fs.writeFileSync(path.join(stateDir, "agent-mate.json"), '{"result":[1]}\n', "utf8");
		writeDefaultCriticAgent(REPO_ROOT, "idle", true);

		const badMateExtHookRes = spawnSync("/bin/bash", [TEAM_UP_SH, "--hook"], {
			cwd: REPO_ROOT,
			input: '{"source":"startup"}',
			encoding: "utf8",
			env: { ...envExternal, GJCH_HOOK_ARGV_TIMEOUT: "15" },
			timeout: SPAWN_TIMEOUT_MS,
		});
		waitForHookBgSpawn();
		expect(badMateExtHookRes.status).toBe(0);
		expect(badMateExtHookRes.stdout).not.toContain("gjc-herdr-mate");
		expect(badMateExtHookRes.stdout).toContain(
			`GJCH: ↳ gjc-herdr-critic 옵션 불일치: 없음 --no-daemon, --yolo, -m gpt-6.1-sol, -C ${REPO_ROOT}, --disable worktrees, -c ${CODEX_STATUS_LINE} (복구: ${RECOVERY_EXTERNAL})`,
		);
		expect(badMateExtHookRes.stderr).toBe("");
	}, 150_000);

	test("10. 실제 --hook(Herdr 안 팀장 inside): 팀원·검토 불일치 두 줄 출력, GJCH_MATE_MODEL 정본 배열 연동, 팀장 pane cwd 저장소 밖이면 무출력, 비정상 agent get 건너뜀", () => {
		fs.writeFileSync(
			path.join(stateDir, "proc-mate.json"),
			makeProcessInfoJson([
				{
					pid: 4001,
					name: "agy",
					argv0: "agy",
					cwd: REPO_ROOT,
					argv: ["agy", "--conversation", "conv-recover-inside-1"],
				},
			]),
			"utf8",
		);
		fs.writeFileSync(
			path.join(stateDir, "proc-critic.json"),
			makeProcessInfoJson([
				{
					pid: 4002,
					name: "codex",
					argv0: "codex",
					cwd: REPO_ROOT,
					argv: ["codex", "resume", "sess-recover-inside-1"],
				},
			]),
			"utf8",
		);

		const envInside = buildEnv({
			HERDR_ENV: "1",
			HERDR_WORKSPACE_ID: "w1",
			HERDR_PANE_ID: "w1:p1",
			CLAUDE_PROJECT_DIR: REPO_ROOT,
		});

		// (1) inside --hook 정상 경로 + GJCH_MATE_MODEL 정본 배열(MATE_START_ARGS) 연동 검증
		const insideHookRes = spawnSync("/bin/bash", [TEAM_UP_SH, "--hook"], {
			cwd: REPO_ROOT,
			input: '{"source":"startup"}',
			encoding: "utf8",
			env: {
				...envInside,
				GJCH_HOOK_ARGV_TIMEOUT: "15",
				GJCH_MATE_MODEL: "gemini-custom-hook-model",
			},
			timeout: SPAWN_TIMEOUT_MS,
		});
		waitForHookBgSpawn();
		expect(insideHookRes.status).toBe(0);
		expect(insideHookRes.stdout).toContain(
			"이 세션이 팀장입니다(herdr pane w1:p1",
		);
		expect(insideHookRes.stdout).toContain(
			`GJCH: ↳ gjc-herdr-mate 옵션 불일치: 없음 --model gemini-custom-hook-model, --mode accept-edits, --sandbox (복구: ${RECOVERY_INSIDE})`,
		);
		expect(insideHookRes.stdout).toContain(
			`GJCH: ↳ gjc-herdr-critic 옵션 불일치: 없음 --no-daemon, --yolo, -m gpt-6.1-sol, -C ${REPO_ROOT}, --disable worktrees, -c ${CODEX_STATUS_LINE} (복구: ${RECOVERY_INSIDE})`,
		);
		expect(insideHookRes.stderr).toBe("");

		// (2) inside 팀장 pane(w1:p1) cwd가 저장소 밖(/tmp)이면 아무런 점검 줄도 출력하지 않음
		fs.writeFileSync(path.join(stateDir, "lead-pane-outside"), "1", "utf8");
		fs.rmSync(herdrLog, { force: true });

		const outsideHookRes = spawnSync("/bin/bash", [TEAM_UP_SH, "--hook"], {
			cwd: REPO_ROOT,
			input: '{"source":"startup"}',
			encoding: "utf8",
			env: { ...envInside, GJCH_HOOK_ARGV_TIMEOUT: "15" },
			timeout: SPAWN_TIMEOUT_MS,
		});
		waitForHookBgSpawn();
		expect(outsideHookRes.status).toBe(0);
		expect(outsideHookRes.stdout).toContain(
			"이 세션이 팀장입니다(herdr pane w1:p1",
		);
		expect(outsideHookRes.stdout).not.toContain("↳");
		expect(outsideHookRes.stderr).toBe("");
		const outsideCalls = readHerdrCalls();
		expect(outsideCalls.some((c) => c.includes("pane process-info"))).toBe(false);

		// (3) inside --hook에서 mate agent get이 {"result":[1]} (비-dict result)를 돌려줄 때:
		//     mate만 건너뛰고 critic 불일치 줄은 출력, stderr 빈 값, rc 0
		fs.rmSync(path.join(stateDir, "lead-pane-outside"), { force: true });
		fs.writeFileSync(path.join(stateDir, "agent-mate.json"), '{"result":[1]}\n', "utf8");
		writeDefaultCriticAgent(REPO_ROOT, "idle", true);

		const badMateInsideHookRes = spawnSync("/bin/bash", [TEAM_UP_SH, "--hook"], {
			cwd: REPO_ROOT,
			input: '{"source":"startup"}',
			encoding: "utf8",
			env: { ...envInside, GJCH_HOOK_ARGV_TIMEOUT: "15" },
			timeout: SPAWN_TIMEOUT_MS,
		});
		waitForHookBgSpawn();
		expect(badMateInsideHookRes.status).toBe(0);
		expect(badMateInsideHookRes.stdout).not.toContain("gjc-herdr-mate");
		expect(badMateInsideHookRes.stdout).toContain(
			`GJCH: ↳ gjc-herdr-critic 옵션 불일치: 없음 --no-daemon, --yolo, -m gpt-6.1-sol, -C ${REPO_ROOT}, --disable worktrees, -c ${CODEX_STATUS_LINE} (복구: ${RECOVERY_INSIDE})`,
		);
		expect(badMateInsideHookRes.stderr).toBe("");

		// (4) hook-argv-check.py 인자 개수 불일치 시 조용히 rc 0 종료
		const badArgcRes = spawnSync(
			REAL_PYTHON3,
			[
				path.join(REPO_ROOT, "scripts", "hook-argv-check.py"),
				"3",
				"inside",
				REPO_ROOT,
				"w1:p1",
				"gjc-herdr-mate",
				"gjc-herdr-critic",
				"1",
				"5",
				"--model",
				"only-two-args",
			],
			{ encoding: "utf8", timeout: 5_000 },
		);
		expect(badArgcRes.status).toBe(0);
		expect(badArgcRes.stdout).toBe("");
		expect(badArgcRes.stderr).toBe("");
	}, 120_000);
});
