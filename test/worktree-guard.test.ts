import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = fs.realpathSync(path.resolve(import.meta.dir, ".."));
const SPAWN_TIMEOUT_MS = 20_000;

const STRIPPED_ENV_KEYS = [
	"GJCH_EXTERNAL_LEAD",
	"HERDR_ENV",
	"HERDR_PANE_ID",
	"HERDR_WORKSPACE_ID",
	"CLAUDE_PROJECT_DIR",
	"GJCH_TEAM_ROLE",
	"GJCH_LEAD_LOCK",
	"GJCH_CRITIC_NAME",
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
const REAL_PYTHON3 = resolveRealBinary("python3", [
	"/opt/homebrew/bin/python3",
	"/usr/bin/python3",
]);

function copyScriptsAndPackageJson(targetRoot: string): void {
	const srcScripts = path.join(REPO_ROOT, "scripts");
	const dstScripts = path.join(targetRoot, "scripts");
	fs.mkdirSync(dstScripts, { recursive: true });
	for (const entry of fs.readdirSync(srcScripts)) {
		const srcFile = path.join(srcScripts, entry);
		const dstFile = path.join(dstScripts, entry);
		if (fs.statSync(srcFile).isFile()) {
			fs.copyFileSync(srcFile, dstFile);
		}
	}
	fs.copyFileSync(
		path.join(REPO_ROOT, "package.json"),
		path.join(targetRoot, "package.json"),
	);
}

function writeExecutable(filePath: string, content: string): void {
	fs.writeFileSync(filePath, content, "utf8");
	fs.chmodSync(filePath, 0o755);
}

describe("worktree guard (#43)", () => {
	let tmpDir = "";
	let mainRepo = "";
	let linkedWt = "";
	let desktopWt = "";
	let nonGitPlainDir = "";
	let binDir = "";
	let noGitBinDir = "";
	let tmpHome = "";
	let tmpHerdrConfig = "";
	let herdrLog = "";
	let cliLog = "";
	let lockPath = "";
	let briefPath = "";

	function buildEnv(
		overrides?: Record<string, string>,
		customPath?: string,
	): NodeJS.ProcessEnv {
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
			PATH: customPath ?? `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
			HOME: tmpHome,
			HERDR_CONFIG: tmpHerdrConfig,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_NOSYSTEM: "1",
			PYTHONNOUSERSITE: "1",
			GJCH_LEAD_LOCK: lockPath,
			...overrides,
		};
	}

	function readLogLines(filePath: string): string[] {
		return fs.existsSync(filePath)
			? fs
					.readFileSync(filePath, "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
			: [];
	}

	function herdrCalls(): string[] {
		return readLogLines(herdrLog);
	}

	beforeAll(() => {
		const rawTmp = fs.mkdtempSync("/tmp/gjch-t-wt-guard-");
		tmpDir = fs.realpathSync(rawTmp);
		mainRepo = path.join(tmpDir, "main-repo");
		linkedWt = path.join(tmpDir, "wt");
		desktopWt = path.join(tmpDir, "non-git", ".claude", "worktrees", "session-1");
		nonGitPlainDir = path.join(tmpDir, "non-git-plain");
		binDir = path.join(tmpDir, "bin");
		noGitBinDir = path.join(tmpDir, "bin-no-git");
		tmpHome = path.join(tmpDir, "home");
		tmpHerdrConfig = path.join(tmpHome, ".config", "herdr", "config.toml");
		herdrLog = path.join(tmpDir, "herdr-calls.log");
		cliLog = path.join(tmpDir, "cli-calls.log");
		lockPath = path.join(tmpDir, "lead.json");
		briefPath = path.join(tmpDir, "brief.md");

		fs.mkdirSync(mainRepo, { recursive: true });
		fs.mkdirSync(desktopWt, { recursive: true });
		fs.mkdirSync(nonGitPlainDir, { recursive: true });
		fs.mkdirSync(binDir, { recursive: true });
		fs.mkdirSync(noGitBinDir, { recursive: true });
		fs.mkdirSync(path.dirname(tmpHerdrConfig), { recursive: true });
		fs.writeFileSync(tmpHerdrConfig, "# isolated test config (gjc_herdr_model)\n", "utf8");
		fs.writeFileSync(briefPath, "# 검토 지시서\n테스트 본문\n", "utf8");

		// Symlink only git and python3 into binDir; noGitBinDir has python3 and dirname (no git)
		fs.symlinkSync(REAL_GIT, path.join(binDir, "git"));
		fs.symlinkSync(REAL_PYTHON3, path.join(binDir, "python3"));
		fs.symlinkSync(REAL_PYTHON3, path.join(noGitBinDir, "python3"));
		fs.symlinkSync("/usr/bin/dirname", path.join(noGitBinDir, "dirname"));

		// Deterministic stubs for herdr, gjc, agy, codex, bun
		writeExecutable(
			path.join(binDir, "herdr"),
			`#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(herdrLog)}
printf 'herdr %s\\n' "$*" >> ${JSON.stringify(cliLog)}
if [ "\${1:-}" = "--version" ]; then
	printf '0.9.3-stub\\n'
	exit 0
fi
printf '{"ok":true}\\n'
`,
		);
		writeExecutable(
			path.join(binDir, "gjc"),
			`#!/bin/sh
printf 'gjc %s\\n' "$*" >> ${JSON.stringify(cliLog)}
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
			path.join(binDir, "agy"),
			`#!/bin/sh
printf 'agy %s\\n' "$*" >> ${JSON.stringify(cliLog)}
printf '1.0.0-stub\\n'
`,
		);
		writeExecutable(
			path.join(binDir, "codex"),
			`#!/bin/sh
printf 'codex %s\\n' "$*" >> ${JSON.stringify(cliLog)}
printf '0.1.0-stub\\n'
`,
		);
		writeExecutable(
			path.join(binDir, "bun"),
			`#!/bin/sh
printf 'bun %s\\n' "$*" >> ${JSON.stringify(cliLog)}
printf '1.4.3\\n'
`,
		);

		copyScriptsAndPackageJson(mainRepo);
		copyScriptsAndPackageJson(desktopWt);
		copyScriptsAndPackageJson(nonGitPlainDir);

		const gitEnv = buildEnv();
		const runGit = (cwd: string, args: string[]) => {
			const res = spawnSync("git", args, {
				cwd,
				encoding: "utf8",
				env: gitEnv,
				timeout: SPAWN_TIMEOUT_MS,
			});
			expect(res.status).toBe(0);
		};

		runGit(mainRepo, ["init"]);
		runGit(mainRepo, ["add", "scripts", "package.json"]);
		runGit(mainRepo, [
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@example.invalid",
			"commit",
			"-m",
			"init",
		]);
		runGit(mainRepo, ["worktree", "add", "-b", "wt-branch", linkedWt]);
	});

	beforeEach(() => {
		fs.rmSync(herdrLog, { force: true });
		fs.rmSync(cliLog, { force: true });
		fs.rmSync(lockPath, { force: true });
		fs.rmSync(`${lockPath}.mutex`, { force: true });
	});

	afterAll(() => {
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test(
		"1. worktree의 team-lead.sh status → rc 1, stderr에 사유, 임시 잠금 파일 미생성",
		() => {
			const res = spawnSync(
				"/bin/bash",
				[path.join(linkedWt, "scripts", "team-lead.sh"), "status"],
				{
					cwd: linkedWt,
					encoding: "utf8",
					env: buildEnv(),
					timeout: SPAWN_TIMEOUT_MS,
				},
			);
			expect(res.status).toBe(1);
			expect(res.stderr).toContain(`연결 worktree(${linkedWt})에서 실행 중입니다.`);
			expect(fs.existsSync(lockPath)).toBe(false);
			expect(fs.existsSync(`${lockPath}.mutex`)).toBe(false);
		},
		30_000,
	);

	test(
		"2. 메인 트리의 team-lead.sh status → rc 0, none",
		() => {
			const res = spawnSync(
				"/bin/bash",
				[path.join(mainRepo, "scripts", "team-lead.sh"), "status"],
				{
					cwd: mainRepo,
					encoding: "utf8",
					env: buildEnv(),
					timeout: SPAWN_TIMEOUT_MS,
				},
			);
			expect(res.status).toBe(0);
			expect(res.stdout.trim()).toBe("none");
		},
		30_000,
	);

	test(
		"3. worktree의 team-up.sh --hook → rc 0, stdout에 GJCH: 사유 줄, herdr 호출 0회, 잠금 파일 미생성",
		() => {
			const res = spawnSync(
				"/bin/bash",
				[path.join(linkedWt, "scripts", "team-up.sh"), "--hook"],
				{
					cwd: linkedWt,
					encoding: "utf8",
					env: buildEnv({
						GJCH_EXTERNAL_LEAD: "1",
						CLAUDE_PROJECT_DIR: linkedWt,
					}),
					timeout: SPAWN_TIMEOUT_MS,
				},
			);
			expect(res.status).toBe(0);
			expect(res.stdout.trim()).toContain("GJCH:");
			expect(res.stdout.trim()).toContain(`연결 worktree(${linkedWt})`);
			expect(herdrCalls()).toEqual([]);
			expect(fs.existsSync(lockPath)).toBe(false);
			expect(fs.existsSync(`${lockPath}.mutex`)).toBe(false);
		},
		30_000,
	);

	test(
		"4. worktree의 team-up.sh --spawn 및 --layout → rc 1, stderr에 사유, herdr 호출 0회",
		() => {
			for (const flag of ["--spawn", "--layout"]) {
				const res = spawnSync(
					"/bin/bash",
					[path.join(linkedWt, "scripts", "team-up.sh"), flag],
					{
						cwd: linkedWt,
						encoding: "utf8",
						env: buildEnv({
							GJCH_EXTERNAL_LEAD: "1",
							CLAUDE_PROJECT_DIR: linkedWt,
						}),
						timeout: SPAWN_TIMEOUT_MS,
					},
				);
				expect(res.status).toBe(1);
				expect(res.stderr).toContain(`연결 worktree(${linkedWt})에서 실행 중입니다.`);
				expect(herdrCalls()).toEqual([]);
				expect(fs.existsSync(lockPath)).toBe(false);
			}
		},
		30_000,
	);

	test(
		"5. worktree의 critic-send.sh <지시서> → rc 1, 사유, herdr 호출 0회",
		() => {
			const res = spawnSync(
				"/bin/bash",
				[path.join(linkedWt, "scripts", "critic-send.sh"), briefPath],
				{
					cwd: linkedWt,
					encoding: "utf8",
					env: buildEnv({
						HERDR_ENV: "1",
						HERDR_WORKSPACE_ID: "w-test",
						HERDR_PANE_ID: "w-test:p-lead",
						GJCH_EXTERNAL_LEAD: "1",
					}),
					timeout: SPAWN_TIMEOUT_MS,
				},
			);
			expect(res.status).toBe(1);
			expect(res.stderr).toContain(`연결 worktree(${linkedWt})에서 실행 중입니다.`);
			expect(herdrCalls()).toEqual([]);
			expect(fs.existsSync(lockPath)).toBe(false);
		},
		30_000,
	);

	test(
		"6. check-env.sh: worktree는 FAIL, 메인 트리는 OK 메인 작업 트리, 비저장소는 WARN 판정 불가 및 가짜 CLI·격리 설정만 사용",
		() => {
			const env = buildEnv();
			expect(env.HOME).toBe(tmpHome);
			expect(env.HERDR_CONFIG).toBe(tmpHerdrConfig);
			expect(env.PATH).toBe(`${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`);

			const wtCheckEnv = spawnSync(
				"/bin/bash",
				[path.join(linkedWt, "scripts", "check-env.sh")],
				{
					cwd: linkedWt,
					encoding: "utf8",
					env,
					timeout: SPAWN_TIMEOUT_MS,
				},
			);
			expect(wtCheckEnv.stdout).toMatch(/FAIL\s+.*연결 worktree/);
			expect(wtCheckEnv.stdout).not.toMatch(/OK\s+메인 작업 트리/);

			fs.rmSync(cliLog, { force: true });
			const mainCheckEnv = spawnSync(
				"/bin/bash",
				[path.join(mainRepo, "scripts", "check-env.sh")],
				{
					cwd: mainRepo,
					encoding: "utf8",
					env,
					timeout: SPAWN_TIMEOUT_MS,
				},
			);
			expect(mainCheckEnv.stdout).not.toMatch(/FAIL\s+.*연결 worktree/);
			expect(mainCheckEnv.stdout).toMatch(/OK\s+메인 작업 트리/);
			expect(mainCheckEnv.stdout).toContain(`codex: ${path.join(binDir, "codex")}`);
			expect(mainCheckEnv.stdout).toContain("OK    Herdr sidebar에 gjc_herdr_model 설정 있음");

			// Verify only stub CLIs in binDir were invoked
			const logged = readLogLines(cliLog);
			expect(logged).toContain("bun --version");
			expect(logged).toContain("gjc --version");
			expect(logged).toContain("gjc plugin list --json");
			expect(logged).toContain("agy --version");
			expect(logged).toContain("herdr --version");

			// Non-git directory reports WARN 판정 불가 and never OK 메인 작업 트리
			const unknownCheckEnv = spawnSync(
				"/bin/bash",
				[path.join(nonGitPlainDir, "scripts", "check-env.sh")],
				{
					cwd: nonGitPlainDir,
					encoding: "utf8",
					env,
					timeout: SPAWN_TIMEOUT_MS,
				},
			);
			expect(unknownCheckEnv.stdout).toMatch(/WARN\s+작업 트리 판정 불가/);
			expect(unknownCheckEnv.stdout).not.toMatch(/OK\s+메인 작업 트리/);
		},
		60_000,
	);

	test(
		"7. git 없이도 판정: PATH에 git이 없는 상태에서 /.claude/worktrees/ 경로의 team-lead.sh status → rc 1",
		() => {
			const noGitEnv = buildEnv(undefined, `${noGitBinDir}:/bin:/sbin`);
			const whichGit = spawnSync("/bin/bash", ["-c", "command -v git"], {
				cwd: desktopWt,
				encoding: "utf8",
				env: noGitEnv,
				timeout: SPAWN_TIMEOUT_MS,
			});
			expect(whichGit.status).not.toBe(0);

			const res = spawnSync(
				"/bin/bash",
				[path.join(desktopWt, "scripts", "team-lead.sh"), "status"],
				{
					cwd: desktopWt,
					encoding: "utf8",
					env: noGitEnv,
					timeout: SPAWN_TIMEOUT_MS,
				},
			);
			expect(res.status).toBe(1);
			expect(res.stderr).toContain(`연결 worktree(${desktopWt})에서 실행 중입니다.`);
			expect(fs.existsSync(lockPath)).toBe(false);
		},
		30_000,
	);
});
