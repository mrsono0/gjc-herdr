import { afterEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = fs.realpathSync(path.resolve(import.meta.dir, ".."));
const LAYOUT_WATCH_PY = path.join(REPO_ROOT, "scripts", "layout-watch.py");

const STRIPPED_ENV_KEYS = [
	"GJCH_LAYOUT_WATCH",
	"GJCH_LAYOUT_WATCH_DIR",
	"GJCH_LAYOUT_WATCH_CMD",
	"GJCH_EXTERNAL_LEAD",
	"HERDR_ENV",
	"HERDR_PANE_ID",
	"HERDR_WORKSPACE_ID",
	"HERDR_SOCKET_PATH",
	"CLAUDE_PROJECT_DIR",
	"GJCH_TEAM_ROLE",
	"GJCH_LEAD_LOCK",
	"GJCH_LEAD_NAME",
	"GJCH_MATE_NAME",
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

function canConnectUnixSocket(): boolean {
	const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "gjc-lw-probe-"));
	const probeSock = path.join(fs.realpathSync(probeDir), "probe.sock");
	let server: ReturnType<typeof Bun.listen> | null = null;
	try {
		server = Bun.listen({
			unix: probeSock,
			socket: {
				data() {},
			},
		});
		const res = spawnSync(
			REAL_PYTHON3,
			[
				"-c",
				"import socket, sys; s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.settimeout(1.0); s.connect(sys.argv[1]); s.close()",
				probeSock,
			],
			{
				encoding: "utf8",
				timeout: 2_000,
			},
		);
		return res.status === 0;
	} catch {
		return false;
	} finally {
		try {
			server?.stop(true);
		} catch {
			// ignore
		}
		fs.rmSync(probeDir, { recursive: true, force: true });
	}
}

const UNIX_SOCKET_CONNECT_SUPPORTED = canConnectUnixSocket();
const socketTest = test.skipIf(!UNIX_SOCKET_CONNECT_SUPPORTED);

const LEAD_PANE = "wT:p1";
const MATE_PANE = "wT:p2";
const CRITIC_PANE = "wT:p3";
const SIDEBAR_PANE = "wT:p9";
const TEAM_TAB = "wT:t1";
const TEAM_WS = "wT";

function makeLayoutResponse(
	panes: Array<{
		pane_id: string;
		rect: { x: number; y: number; width: number; height: number };
		focused?: boolean;
	}>,
	tabId = TEAM_TAB,
	workspaceId = TEAM_WS,
): string {
	return JSON.stringify({
		result: {
			layout: {
				tab_id: tabId,
				workspace_id: workspaceId,
				area: { x: 0, y: 0, width: 185, height: 48 },
				panes: panes.map((p) => ({
					pane_id: p.pane_id,
					rect: p.rect,
					focused: p.focused ?? false,
				})),
				splits: [],
			},
		},
	});
}

// 사이드바가 쌓은 실측 모양: 왼쪽 153칸에 팀장(12)·팀원(12)·검토(24)가 세로로 쌓이고 오른쪽에 사이드바 32×48
const STACKED_LAYOUT = makeLayoutResponse([
	{ pane_id: LEAD_PANE, rect: { x: 0, y: 0, width: 153, height: 12 } },
	{ pane_id: MATE_PANE, rect: { x: 0, y: 12, width: 153, height: 12 } },
	{ pane_id: CRITIC_PANE, rect: { x: 0, y: 24, width: 153, height: 24 } },
	{ pane_id: SIDEBAR_PANE, rect: { x: 153, y: 0, width: 32, height: 48 } },
]);

// 목표 배치 (사이드바 없음)
const TARGET_LAYOUT = makeLayoutResponse([
	{ pane_id: LEAD_PANE, rect: { x: 0, y: 0, width: 185, height: 29 } },
	{ pane_id: MATE_PANE, rect: { x: 0, y: 29, width: 92, height: 19 } },
	{ pane_id: CRITIC_PANE, rect: { x: 92, y: 29, width: 93, height: 19 } },
]);

// 목표 배치 + 오른쪽 사이드바 pane (사이드바 열린 채 복구된 모양)
const TARGET_WITH_SIDEBAR_LAYOUT = makeLayoutResponse([
	{ pane_id: LEAD_PANE, rect: { x: 0, y: 0, width: 153, height: 29 } },
	{ pane_id: MATE_PANE, rect: { x: 0, y: 29, width: 76, height: 19 } },
	{ pane_id: CRITIC_PANE, rect: { x: 76, y: 29, width: 77, height: 19 } },
	{ pane_id: SIDEBAR_PANE, rect: { x: 153, y: 0, width: 32, height: 48 } },
]);

// 2-pane 목표 배치 (검토가 없거나 다른 탭일 때)
const TARGET_2PANE_LAYOUT = makeLayoutResponse([
	{ pane_id: LEAD_PANE, rect: { x: 0, y: 0, width: 153, height: 29 } },
	{ pane_id: MATE_PANE, rect: { x: 0, y: 29, width: 153, height: 19 } },
	{ pane_id: SIDEBAR_PANE, rect: { x: 153, y: 0, width: 32, height: 48 } },
]);

// 2-pane 어긋난 배치 (검토가 없거나 다른 탭이고 팀장·팀원이 좌우로 나뉜 경우)
const OFF_2PANE_LAYOUT = makeLayoutResponse([
	{ pane_id: LEAD_PANE, rect: { x: 0, y: 0, width: 76, height: 48 } },
	{ pane_id: MATE_PANE, rect: { x: 76, y: 0, width: 77, height: 48 } },
]);

// 팀원이 다른 탭에 있어 팀장 탭 layout에 없는 모양
const MATE_OTHER_TAB_LAYOUT = makeLayoutResponse([
	{ pane_id: LEAD_PANE, rect: { x: 0, y: 0, width: 153, height: 24 } },
	{ pane_id: CRITIC_PANE, rect: { x: 0, y: 24, width: 153, height: 24 } },
]);

type PaneGetMode = "ok" | "not_found" | "transient_error";

interface Harness {
	tmpDir: string;
	watchDir: string;
	sockPath: string;
	herdrLogPath: string;
	notifyLogPath: string;
	repairLogPath: string;
	layoutFixturePath: string;
	fixedLayoutFixturePath: string;
	paneGetModePath: string;
	mateAgentFixturePath: string;
	criticAgentFixturePath: string;
	buildEnv: (overrides?: Record<string, string>) => NodeJS.ProcessEnv;
	readHerdrCalls: () => string[];
	readNotifyCalls: () => string[];
	readRepairCount: () => number;
	readWatchLog: () => string;
	readWatchState: () => {
		status: string;
		tab: string;
		at: number;
		last_rc?: number | null;
		panes?: Record<string, { pane: string | null; tab: string | null }>;
		workspace_tabs?: string[];
	} | null;
	setLayoutFixture: (jsonStr: string) => void;
	setFixedLayoutFixture: (jsonStr: string) => void;
	setPaneGetMode: (mode: PaneGetMode) => void;
	setPaneGetFail: (fail: boolean) => void;
	setCriticNotFound: (notFound: boolean) => void;
	cleanup: () => void;
}

function createHarness(options?: {
	repairFixesLayout?: boolean;
	repairExitCode?: number;
	repairSleepSec?: number;
	repairChildPidFile?: string;
	repairMoveMateToTab?: string;
	repairSelfSignal?: string;
}): Harness {
	const rawTmp = fs.mkdtempSync(path.join(os.tmpdir(), "gjc-lw-"));
	const tmpDir = fs.realpathSync(rawTmp);
	const binDir = path.join(tmpDir, "bin");
	const watchDir = path.join(tmpDir, "watch");
	const homeDir = path.join(tmpDir, "home");
	const sockPath = path.join(tmpDir, "herdr.sock");

	const herdrLogPath = path.join(tmpDir, "herdr-calls.log");
	const notifyLogPath = path.join(tmpDir, "notify-calls.log");
	const repairLogPath = path.join(tmpDir, "repair-calls.log");
	const layoutFixturePath = path.join(tmpDir, "layout.json");
	const fixedLayoutFixturePath = path.join(tmpDir, "layout-fixed.json");
	const paneGetFixturePath = path.join(tmpDir, "pane-get.json");
	const matePaneGetFixturePath = path.join(tmpDir, "pane-get-mate.json");
	const criticPaneGetFixturePath = path.join(tmpDir, "pane-get-critic.json");
	const tabListFixturePath = path.join(tmpDir, "tab-list.json");
	const paneGetModePath = path.join(tmpDir, "pane-get.mode");
	const mateAgentFixturePath = path.join(tmpDir, "agent-mate.json");
	const criticAgentFixturePath = path.join(tmpDir, "agent-critic.json");
	const criticAgentExitPath = path.join(tmpDir, "agent-critic.rc");
	const repairScriptPath = path.join(tmpDir, "fake-repair.sh");

	fs.mkdirSync(binDir, { recursive: true });
	fs.mkdirSync(watchDir, { recursive: true });
	fs.mkdirSync(homeDir, { recursive: true });

	fs.symlinkSync(REAL_PYTHON3, path.join(binDir, "python3"));

	fs.writeFileSync(layoutFixturePath, TARGET_WITH_SIDEBAR_LAYOUT, "utf8");
	fs.writeFileSync(fixedLayoutFixturePath, TARGET_WITH_SIDEBAR_LAYOUT, "utf8");
	fs.writeFileSync(
		paneGetFixturePath,
		JSON.stringify({
			result: {
				pane: {
					pane_id: LEAD_PANE,
					tab_id: TEAM_TAB,
					workspace_id: TEAM_WS,
					cwd: REPO_ROOT,
				},
			},
		}),
		"utf8",
	);
	fs.writeFileSync(
		matePaneGetFixturePath,
		JSON.stringify({
			result: {
				pane: {
					pane_id: MATE_PANE,
					tab_id: TEAM_TAB,
					workspace_id: TEAM_WS,
					cwd: REPO_ROOT,
				},
			},
		}),
		"utf8",
	);
	fs.writeFileSync(
		criticPaneGetFixturePath,
		JSON.stringify({
			result: {
				pane: {
					pane_id: CRITIC_PANE,
					tab_id: TEAM_TAB,
					workspace_id: TEAM_WS,
					cwd: REPO_ROOT,
				},
			},
		}),
		"utf8",
	);
	fs.writeFileSync(
		tabListFixturePath,
		JSON.stringify({
			result: {
				tabs: [{ tab_id: TEAM_TAB, workspace_id: TEAM_WS }],
			},
		}),
		"utf8",
	);
	fs.writeFileSync(paneGetModePath, "ok", "utf8");
	fs.writeFileSync(
		mateAgentFixturePath,
		JSON.stringify({
			result: {
				agent: {
					name: "gjc-herdr-mate",
					pane_id: MATE_PANE,
					agent_status: "idle",
				},
			},
		}),
		"utf8",
	);
	const defaultCriticJson = JSON.stringify({
		result: {
			agent: {
				name: "gjc-herdr-critic",
				pane_id: CRITIC_PANE,
				agent_status: "idle",
			},
		},
	});
	fs.writeFileSync(criticAgentFixturePath, defaultCriticJson, "utf8");
	fs.writeFileSync(criticAgentExitPath, "0", "utf8");

	const fakeHerdr = `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(herdrLogPath)}
case "$1 $2" in
	"pane get")
		mode=$(cat ${JSON.stringify(paneGetModePath)} 2>/dev/null || echo ok)
		if [ "$mode" = "not_found" ]; then
			printf '{"error":{"code":"pane_not_found","message":"pane not found"},"id":"cli:pane:get"}\\n' >&2
			exit 1
		fi
		if [ "$mode" = "transient_error" ]; then
			exit 1
		fi
		target="\${3:-}"
		if [ "$target" = "${MATE_PANE}" ]; then
			cat ${JSON.stringify(matePaneGetFixturePath)}
			printf '\\n'
			exit 0
		fi
		if [ "$target" = "${CRITIC_PANE}" ]; then
			cat ${JSON.stringify(criticPaneGetFixturePath)}
			printf '\\n'
			exit 0
		fi
		cat ${JSON.stringify(paneGetFixturePath)}
		printf '\\n'
		exit 0
		;;
	"tab list")
		cat ${JSON.stringify(tabListFixturePath)}
		printf '\\n'
		exit 0
		;;
	"agent get")
		target="\${3:-}"
		if [ "$target" = "gjc-herdr-mate" ]; then
			cat ${JSON.stringify(mateAgentFixturePath)}
			printf '\\n'
			exit 0
		fi
		if [ "$target" = "gjc-herdr-critic" ]; then
			rc=$(cat ${JSON.stringify(criticAgentExitPath)} 2>/dev/null || echo 0)
			cat ${JSON.stringify(criticAgentFixturePath)}
			printf '\\n'
			exit "$rc"
		fi
		printf '{"error":{"code":"agent_not_found","message":"not found"}}\\n'
		exit 1
		;;
	"pane layout")
		cat ${JSON.stringify(layoutFixturePath)}
		printf '\\n'
		exit 0
		;;
	"notification show")
		printf '%s\\n' "$*" >> ${JSON.stringify(notifyLogPath)}
		printf '{"ok":true}\\n'
		exit 0
		;;
esac
printf '{"ok":true}\\n'
exit 0
`;
	fs.writeFileSync(path.join(binDir, "herdr"), fakeHerdr, "utf8");
	fs.chmodSync(path.join(binDir, "herdr"), 0o755);

	const fixOnRepair = options?.repairFixesLayout ? "1" : "0";
	const repairExitCode = options?.repairExitCode ?? 0;
	const repairSleepSec = options?.repairSleepSec ?? 0;
	const repairChildPidFile = options?.repairChildPidFile
		? path.resolve(tmpDir, options.repairChildPidFile)
		: "";
	const repairMoveMateToTab = options?.repairMoveMateToTab ?? "";
	const repairSelfSignal = options?.repairSelfSignal ?? "";
	const moveMateBlock = repairMoveMateToTab
		? `printf '%s\\n' '${JSON.stringify({
				result: {
					pane: {
						pane_id: MATE_PANE,
						tab_id: repairMoveMateToTab,
						workspace_id: TEAM_WS,
						cwd: REPO_ROOT,
					},
				},
			})}' > ${JSON.stringify(matePaneGetFixturePath)}
printf '%s\\n' '${JSON.stringify({
				result: {
					tabs: [
						{ tab_id: TEAM_TAB, workspace_id: TEAM_WS },
						{ tab_id: repairMoveMateToTab, workspace_id: TEAM_WS },
					],
				},
			})}' > ${JSON.stringify(tabListFixturePath)}
`
		: "";
	const sleepBlock =
		repairSleepSec > 0
			? repairChildPidFile
				? `sleep ${repairSleepSec} &\nchild_pid=$!\nprintf '%s\\n' "$child_pid" > ${JSON.stringify(repairChildPidFile)}\nwait "$child_pid"\n`
				: `exec sleep ${repairSleepSec}\n`
			: "";
	const exitStmt = repairSelfSignal
		? `kill -${repairSelfSignal} $$`
		: `exit ${repairExitCode}`;
	const fakeRepair = `#!/bin/sh
printf 'repair\\n' >> ${JSON.stringify(repairLogPath)}
printf 'layout: lead ${LEAD_PANE} on top (60%%), mate ${MATE_PANE} | critic ${CRITIC_PANE} below\\n'
printf '↳ gjc-herdr-mate 옵션 판정 불가: (작업 중 — 다시 점검)\\n' >&2
${moveMateBlock}${sleepBlock}if [ "${fixOnRepair}" = "1" ]; then
	cp ${JSON.stringify(fixedLayoutFixturePath)} ${JSON.stringify(layoutFixturePath)}
fi
${exitStmt}
`;
	fs.writeFileSync(repairScriptPath, fakeRepair, "utf8");
	fs.chmodSync(repairScriptPath, 0o755);

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
			HOME: homeDir,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_NOSYSTEM: "1",
			PYTHONNOUSERSITE: "1",
			HERDR_ENV: "1",
			HERDR_PANE_ID: LEAD_PANE,
			HERDR_SOCKET_PATH: sockPath,
			GJCH_LAYOUT_WATCH_DIR: watchDir,
			GJCH_LAYOUT_WATCH_CMD: `/bin/sh ${repairScriptPath}`,
			...overrides,
		};
	}

	function readLines(filePath: string): string[] {
		if (!fs.existsSync(filePath)) return [];
		return fs
			.readFileSync(filePath, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean);
	}

	return {
		tmpDir,
		watchDir,
		sockPath,
		herdrLogPath,
		notifyLogPath,
		repairLogPath,
		layoutFixturePath,
		fixedLayoutFixturePath,
		paneGetModePath,
		mateAgentFixturePath,
		criticAgentFixturePath,
		buildEnv,
		readHerdrCalls: () => readLines(herdrLogPath),
		readNotifyCalls: () => readLines(notifyLogPath),
		readRepairCount: () => readLines(repairLogPath).length,
		readWatchLog: () => {
			const p = path.join(watchDir, "layout-watch.log");
			return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
		},
		readWatchState: () => {
			const p = path.join(watchDir, "layout-watch.state");
			if (!fs.existsSync(p)) return null;
			return JSON.parse(fs.readFileSync(p, "utf8"));
		},
		setLayoutFixture: (jsonStr: string) => {
			fs.writeFileSync(layoutFixturePath, jsonStr, "utf8");
		},
		setFixedLayoutFixture: (jsonStr: string) => {
			fs.writeFileSync(fixedLayoutFixturePath, jsonStr, "utf8");
		},
		setPaneGetMode: (mode: PaneGetMode) => {
			fs.writeFileSync(paneGetModePath, mode, "utf8");
		},
		setPaneGetFail: (fail: boolean) => {
			fs.writeFileSync(paneGetModePath, fail ? "not_found" : "ok", "utf8");
		},
		setCriticNotFound: (notFound: boolean) => {
			if (notFound) {
				fs.writeFileSync(
					criticAgentFixturePath,
					JSON.stringify({
						error: { code: "agent_not_found", message: "not found" },
					}),
					"utf8",
				);
				fs.writeFileSync(criticAgentExitPath, "1", "utf8");
			} else {
				fs.writeFileSync(criticAgentFixturePath, defaultCriticJson, "utf8");
				fs.writeFileSync(criticAgentExitPath, "0", "utf8");
			}
		},
		cleanup: () => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		},
	};
}

function runWatchSync(
	harness: Harness,
	args: string[],
	envOverrides?: Record<string, string>,
): { status: number | null; stdout: string; stderr: string } {
	const res = spawnSync(REAL_PYTHON3, [LAYOUT_WATCH_PY, ...args], {
		cwd: REPO_ROOT,
		env: harness.buildEnv(envOverrides),
		encoding: "utf8",
		timeout: 10_000,
	});
	return {
		status: res.status,
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
	};
}

interface WatchAsyncResult {
	status: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
}

function runWatchAsync(
	harness: Harness,
	args: string[],
	envOverrides?: Record<string, string>,
): {
	proc: ReturnType<typeof spawn>;
	done: Promise<WatchAsyncResult>;
} {
	const proc = spawn(REAL_PYTHON3, [LAYOUT_WATCH_PY, ...args], {
		cwd: REPO_ROOT,
		env: harness.buildEnv(envOverrides),
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	proc.stdout?.on("data", (chunk) => {
		stdout += chunk.toString("utf8");
	});
	proc.stderr?.on("data", (chunk) => {
		stderr += chunk.toString("utf8");
	});
	const done = new Promise<WatchAsyncResult>((resolve) => {
		proc.on("close", (code, signal) => {
			resolve({ status: code, signal, stdout, stderr });
		});
	});
	return { proc, done };
}

async function waitFor(
	predicate: () => boolean,
	timeoutMs = 8_000,
	intervalMs = 50,
): Promise<boolean> {
	const deadline = performance.now() + timeoutMs;
	while (performance.now() < deadline) {
		if (predicate()) {
			return true;
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return predicate();
}

async function stopWatch(
	proc: ReturnType<typeof spawn>,
	done: Promise<WatchAsyncResult>,
): Promise<WatchAsyncResult> {
	if (proc.exitCode === null && proc.signalCode === null) {
		try {
			proc.kill("SIGTERM");
		} catch {
			// ignore
		}
	}
	return await done;
}

describe("scripts/layout-watch.py (#55)", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		while (cleanups.length > 0) {
			const fn = cleanups.pop();
			try {
				fn?.();
			} catch {
				// ignore cleanup errors
			}
		}
	});

	test("1. --once 쌓인 배치(실측 모양) → 복구 1회, 로그에 off", () => {
		const h = createHarness({ repairFixesLayout: true });
		cleanups.push(h.cleanup);
		h.setLayoutFixture(STACKED_LAYOUT);

		const res = runWatchSync(h, ["--once"]);
		expect(res.status).toBe(0);
		expect(res.stdout).toBe("");
		expect(h.readRepairCount()).toBe(1);

		const log = h.readWatchLog();
		expect(log).toContain("check trigger=start status=off tab=wT:t1 detail=3-pane");
		expect(log).toContain("옵션 판정 불가");
		expect(log).toContain("relayout rc=0");
		expect(h.readWatchState()?.status).toBe("ok");
		expect(h.readWatchState()?.last_rc).toBe(0);
	});

	test("2. --once 목표 배치 → 복구 0회", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);
		h.setLayoutFixture(TARGET_LAYOUT);

		const res = runWatchSync(h, ["--once"]);
		expect(res.status).toBe(0);
		expect(res.stdout).toBe("");
		expect(h.readRepairCount()).toBe(0);
		expect(h.readWatchLog()).toContain(
			"check trigger=start status=ok tab=wT:t1 detail=3-pane",
		);
	});

	test("3. --once 목표 배치 + 오른쪽 사이드바 pane(사이드바 열린 채 복구된 모양) → ok, 복구 0회", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);
		h.setLayoutFixture(TARGET_WITH_SIDEBAR_LAYOUT);

		const res = runWatchSync(h, ["--once"]);
		expect(res.status).toBe(0);
		expect(res.stdout).toBe("");
		expect(h.readRepairCount()).toBe(0);
		expect(h.readWatchLog()).toContain(
			"check trigger=start status=ok tab=wT:t1 detail=3-pane",
		);
	});

	test("4. --once 검토가 다른 탭 → skip, 복구 0회", () => {
		const h = createHarness({ repairFixesLayout: true });
		cleanups.push(h.cleanup);

		// 검토 agent는 존재하지만(wT:p3) 팀장 탭 layout에 없으면 2-pane으로 판정하지 않고 skip
		h.setLayoutFixture(TARGET_2PANE_LAYOUT);
		const resTarget = runWatchSync(h, ["--once"]);
		expect(resTarget.status).toBe(0);
		expect(h.readRepairCount()).toBe(0);
		expect(h.readWatchLog()).toContain(
			"check trigger=start status=skip tab=wT:t1 detail=critic_not_in_tab",
		);

		// 팀장·팀원이 좌우로 어긋난 모양이어도 검토가 다른 탭이면 복구 시도를 소비하지 않고 skip
		h.setLayoutFixture(OFF_2PANE_LAYOUT);
		const resOff = runWatchSync(h, ["--once"]);
		expect(resOff.status).toBe(0);
		expect(h.readRepairCount()).toBe(0);
		expect(h.readWatchLog()).toContain(
			"check trigger=start status=skip tab=wT:t1 detail=critic_not_in_tab",
		);
	});

	test("4b. --once 검토 agent 없음(agent_not_found) → 2-pane 판정", () => {
		const h = createHarness({ repairFixesLayout: true });
		cleanups.push(h.cleanup);
		h.setCriticNotFound(true);
		h.setFixedLayoutFixture(TARGET_2PANE_LAYOUT);

		// 검토 agent가 없고 2-pane 목표 배치면 ok, 복구 0회
		h.setLayoutFixture(TARGET_2PANE_LAYOUT);
		const resOk = runWatchSync(h, ["--once"]);
		expect(resOk.status).toBe(0);
		expect(h.readRepairCount()).toBe(0);
		expect(h.readWatchLog()).toContain(
			"check trigger=start status=ok tab=wT:t1 detail=2-pane",
		);

		// 검토 agent가 없고 2-pane 어긋난 배치면 off (detail=2-pane), 복구 1회
		h.setLayoutFixture(OFF_2PANE_LAYOUT);
		const resOff = runWatchSync(h, ["--once"]);
		expect(resOff.status).toBe(0);
		expect(h.readRepairCount()).toBe(1);
		expect(h.readWatchLog()).toContain(
			"check trigger=start status=off tab=wT:t1 detail=2-pane",
		);
		expect(h.readWatchState()?.status).toBe("ok");
	});

	test("5. --once 팀원이 다른 탭 → skip, 복구 0회", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);
		h.setLayoutFixture(MATE_OTHER_TAB_LAYOUT);

		const res = runWatchSync(h, ["--once"]);
		expect(res.status).toBe(0);
		expect(h.readRepairCount()).toBe(0);
		expect(h.readWatchLog()).toContain(
			"check trigger=start status=skip tab=wT:t1 detail=mate_not_in_tab",
		);
	});

	test(
		"6. 상한: 복구 명령이 배치를 고치지 못하는 경우 --limit 2로 이벤트를 여러 번 일으키면 복구 2회, notification show 1회, state limit",
		async () => {
			const h = createHarness({ repairFixesLayout: false, repairExitCode: 1 });
			cleanups.push(h.cleanup);
			h.setLayoutFixture(STACKED_LAYOUT);

			const sockRef: { current: { write: (chunk: string) => unknown } | null } =
				{ current: null };
			const ev = `${JSON.stringify({
				event: "layout_updated",
				data: {
					type: "layout_updated",
					workspace_id: TEAM_WS,
					tab_id: TEAM_TAB,
				},
			})}\n`;
			const server = Bun.listen({
				unix: h.sockPath,
				socket: {
					data(sock, data) {
						const lines = data.toString("utf8").split("\n").filter(Boolean);
						for (const line of lines) {
							const msg = JSON.parse(line);
							if (msg.method === "events.subscribe") {
								sockRef.current = sock;
								sock.write(
									`${JSON.stringify({ id: msg.id, result: { type: "subscription_started" } })}\n`,
								);
								sock.write(ev);
							}
						}
					},
				},
			});
			cleanups.push(() => server.stop(true));

			const { proc, done } = runWatchAsync(h, [
				"--quiet",
				"0.1",
				"--limit",
				"2",
				"--window",
				"600",
				"--max-run",
				"10",
			]);

			const reachedLimit = await waitFor(
				() =>
					h.readWatchState()?.status === "limit" &&
					h.readNotifyCalls().length >= 1 &&
					h.readWatchLog().includes("limit reached"),
			);
			expect(reachedLimit).toBe(true);

			// 상한 도달 후 추가 이벤트가 와도 추가 복구·중복 알림이 발생하지 않는지 확인
			if (sockRef.current) {
				sockRef.current.write(ev);
				await waitFor(
					() => h.readWatchLog().split("limit reached").length - 1 >= 2,
					3_000,
				);
			}

			const res = await stopWatch(proc, done);
			const log = h.readWatchLog();
			expect(res.status === 0 || res.signal === "SIGTERM").toBe(true);
			expect(res.stdout).toBe("");
			expect(h.readRepairCount()).toBe(2);

			const notifies = h.readNotifyCalls();
			expect(notifies.length).toBe(1);
			expect(notifies[0]).toContain("notification show GJCH 팀 배치 자동 복구 중단");
			expect(notifies[0]).toContain(
				"wT:t1 배치가 600초 안에 2회 풀려 자동 복구를 멈춤. scripts/team-up.sh --layout으로 확인",
			);

			const state = h.readWatchState();
			expect(state?.status).toBe("limit");
			expect(state?.tab).toBe(TEAM_TAB);
			expect(state?.last_rc).toBe(1);
			expect(log).toContain("limit reached");
		},
		15_000,
	);

	socketTest(
		"7a. 소켓: 구독 요청 줄 확인, 쌓인 배치 + layout_updated 이벤트 → --quiet 0.2 뒤 복구 1회, events=3",
		async () => {
			const h = createHarness({ repairFixesLayout: true });
			cleanups.push(h.cleanup);
			h.setLayoutFixture(TARGET_WITH_SIDEBAR_LAYOUT);

			const receivedSubs: Array<{
				method?: string;
				params?: { subscriptions?: Array<{ type: string }> };
			}> = [];
			let eventSentAt = 0;
			const sockRef: { current: { write: (chunk: string) => unknown } | null } =
				{ current: null };
			const server = Bun.listen({
				unix: h.sockPath,
				socket: {
					data(sock, data) {
						const lines = data.toString("utf8").split("\n").filter(Boolean);
						for (const line of lines) {
							const msg = JSON.parse(line);
							if (msg.method === "events.subscribe") {
								receivedSubs.push(msg);
								sockRef.current = sock;
								sock.write(
									`${JSON.stringify({ id: msg.id, result: { type: "subscription_started" } })}\n`,
								);
							}
						}
					},
				},
			});
			cleanups.push(() => server.stop(true));

			const { proc, done } = runWatchAsync(h, [
				"--quiet",
				"0.2",
				"--max-run",
				"10",
			]);

			const subChecked = await waitFor(() =>
				/check trigger=(?:subscribed|reconnect) status=ok/.test(
					h.readWatchLog(),
				),
			);
			expect(subChecked).toBe(true);

			// 구독 직후 판정(subscribed)이 끝난 뒤 사이드바가 열려 쌓인 배치로 바뀌고 이벤트 3줄이 도착하는 상황
			h.setLayoutFixture(STACKED_LAYOUT);
			eventSentAt = performance.now();
			for (let i = 0; i < 3; i++) {
				sockRef.current?.write(
					`${JSON.stringify({
						event: "layout_updated",
						data: {
							type: "layout_updated",
							layout: JSON.parse(STACKED_LAYOUT).result.layout,
						},
					})}\n`,
				);
			}

			const repairedAndOk = await waitFor(
				() => h.readWatchState()?.status === "ok" && h.readRepairCount() === 1,
			);
			expect(repairedAndOk).toBe(true);

			const res = await stopWatch(proc, done);
			const log = h.readWatchLog();
			expect(log).not.toContain("Operation not permitted");
			expect(res.status === 0 || res.signal === "SIGTERM").toBe(true);
			expect(receivedSubs.length).toBeGreaterThanOrEqual(1);
			expect(receivedSubs[0]?.method).toBe("events.subscribe");
			const subs = (receivedSubs[0]?.params?.subscriptions ?? []).map(
				(s) => s.type,
			);
			expect(subs).toEqual([
				"layout.updated",
				"pane.moved",
				"pane.created",
				"pane.closed",
				"tab.created",
				"tab.closed",
				"workspace.closed",
			]);
			expect(eventSentAt).toBeGreaterThan(0);
			expect(h.readRepairCount()).toBe(1);
			expect(log).toContain(
				"check trigger=event status=off tab=wT:t1 detail=3-pane",
			);
			expect(log).toContain("events=3");
			expect(log).toMatch(
				/check trigger=event status=off tab=wT:t1 detail=3-pane events=3 waited=\d+\.\d+s/,
			);
			expect(h.readWatchState()?.status).toBe("ok");
			expect(h.readWatchState()?.last_rc).toBe(0);
		},
		15_000,
	);

	socketTest(
		"7b. 소켓: 관련 없는 작업공간 이벤트만 → 복구 0회",
		async () => {
			const h = createHarness({ repairFixesLayout: true });
			cleanups.push(h.cleanup);
			h.setLayoutFixture(TARGET_WITH_SIDEBAR_LAYOUT);

			const sockRef: { current: { write: (chunk: string) => unknown } | null } =
				{ current: null };
			const server = Bun.listen({
				unix: h.sockPath,
				socket: {
					data(sock, data) {
						const lines = data.toString("utf8").split("\n").filter(Boolean);
						for (const line of lines) {
							const msg = JSON.parse(line);
							if (msg.method === "events.subscribe") {
								sockRef.current = sock;
								sock.write(
									`${JSON.stringify({ id: msg.id, result: { type: "subscription_started" } })}\n`,
								);
							}
						}
					},
				},
			});
			cleanups.push(() => server.stop(true));

			const { proc, done } = runWatchAsync(h, [
				"--quiet",
				"0.15",
				"--max-run",
				"10",
			]);

			const subChecked = await waitFor(() =>
				/check trigger=(?:subscribed|reconnect) status=ok/.test(
					h.readWatchLog(),
				),
			);
			expect(subChecked).toBe(true);

			// 구독 직후 판정이 끝난 뒤 fixture를 쌓인 배치로 바꾸더라도 다른 작업공간(wOther) 이벤트만 오면 판정·복구하지 않음
			h.setLayoutFixture(STACKED_LAYOUT);
			sockRef.current?.write(
				`${JSON.stringify({
					event: "pane_moved",
					data: {
						type: "pane_moved",
						workspace_id: "wOther",
						pane_id: "wOther:p2",
						tab_id: "wOther:t1",
					},
				})}\n`,
			);

			await new Promise((r) => setTimeout(r, 400));
			const res = await stopWatch(proc, done);
			const log = h.readWatchLog();
			expect(log).not.toContain("Operation not permitted");
			expect(res.status === 0 || res.signal === "SIGTERM").toBe(true);
			expect(h.readRepairCount()).toBe(0);
			expect(log).not.toContain("trigger=event");
		},
		15_000,
	);

	socketTest(
		"8. 재연결: 첫 연결을 subscription_started 뒤 바로 끊으면 두 번째 연결에서 재구독하고 직후 판정한다 (--backoff-min 0.1)",
		async () => {
			const h = createHarness({ repairFixesLayout: true });
			cleanups.push(h.cleanup);
			h.setLayoutFixture(TARGET_WITH_SIDEBAR_LAYOUT);

			let subscribeCount = 0;
			const server = Bun.listen({
				unix: h.sockPath,
				socket: {
					data(sock, data) {
						const lines = data.toString("utf8").split("\n").filter(Boolean);
						for (const line of lines) {
							const msg = JSON.parse(line);
							if (msg.method === "events.subscribe") {
								subscribeCount += 1;
								if (subscribeCount === 2) {
									// 연결이 끊긴 사이 배치가 쌓인 모양으로 바뀐 상황
									h.setLayoutFixture(STACKED_LAYOUT);
								}
								sock.write(
									`${JSON.stringify({ id: msg.id, result: { type: "subscription_started" } })}\n`,
								);
								if (subscribeCount === 1) {
									sock.end();
								}
							}
						}
					},
				},
			});
			cleanups.push(() => server.stop(true));

			const { proc, done } = runWatchAsync(h, [
				"--backoff-min",
				"0.1",
				"--quiet",
				"0.2",
				"--max-run",
				"10",
			]);

			const reconnectedAndRepaired = await waitFor(
				() =>
					h.readWatchState()?.status === "ok" &&
					h.readRepairCount() === 1 &&
					h.readWatchLog().includes("subscribed id=gjch-layout-watch-2 attempt=2"),
			);
			expect(reconnectedAndRepaired).toBe(true);

			const res = await stopWatch(proc, done);
			const log = h.readWatchLog();
			expect(log).not.toContain("Operation not permitted");
			expect(res.status === 0 || res.signal === "SIGTERM").toBe(true);
			expect(subscribeCount).toBeGreaterThanOrEqual(2);
			expect(h.readRepairCount()).toBe(1);
			expect(log).toContain("subscribed id=gjch-layout-watch-2 attempt=2");
			const offLines = log
				.split("\n")
				.filter((line) => /check trigger=\S+ status=off\b/.test(line));
			expect(offLines.length).toBe(1);
			expect(offLines[0]).toMatch(
				/check trigger=(?:subscribed|reconnect) status=off tab=wT:t1 detail=3-pane/,
			);
		},
		15_000,
	);

	test("9. 외부 팀장 env → rc 0, 안내 문구, herdr 호출 0회", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);

		const res = runWatchSync(h, [], {
			GJCH_EXTERNAL_LEAD: "1",
			HERDR_ENV: "",
			HERDR_PANE_ID: "",
		});
		expect(res.status).toBe(0);
		expect(res.stdout).toBe("");
		expect(res.stderr).toContain(
			"layout-watch: external lead tab (mate | critic) is not restacked by the sidebar; nothing to watch",
		);
		expect(h.readHerdrCalls().length).toBe(0);
	});

	test(
		"10. 잠금: 같은 GJCH_LAYOUT_WATCH_DIR로 두 번째 실행 → already running, rc 0",
		async () => {
			const h = createHarness();
			cleanups.push(h.cleanup);

			const first = runWatchAsync(h, ["--max-run", "10"]);
			const lockFile = path.join(h.watchDir, "layout-watch.lock");
			const locked = await waitFor(
				() =>
					fs.existsSync(lockFile) && h.readWatchLog().includes("start lead="),
			);
			expect(locked).toBe(true);

			const second = runWatchSync(h, ["--once"]);
			expect(second.status).toBe(0);
			expect(second.stdout).toBe("");
			expect(second.stderr).toContain("layout-watch: already running");

			const firstRes = await stopWatch(first.proc, first.done);
			expect(firstRes.status === 0 || firstRes.signal === "SIGTERM").toBe(true);
		},
		15_000,
	);

	test("11. 팀장 pane 없어짐(pane get이 pane_not_found 반환) → 감시 종료 rc 0", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);
		h.setPaneGetMode("not_found");

		const res = runWatchSync(h, ["--max-run", "2.0"]);
		expect(res.status).toBe(0);
		expect(res.stdout).toBe("");
		expect(h.readRepairCount()).toBe(0);
		const log = h.readWatchLog();
		expect(log).toContain("check trigger=start status=gone tab=- detail=pane_not_found");
		expect(log).toContain("exit reason=gone rc=0");
	});

	test("12. GJCH_LAYOUT_WATCH=0 → rc 0, herdr 호출 0회", () => {
		const h = createHarness();
		cleanups.push(h.cleanup);

		const res = runWatchSync(h, ["--once"], {
			GJCH_LAYOUT_WATCH: "0",
		});
		expect(res.status).toBe(0);
		expect(res.stdout).toBe("");
		expect(res.stderr).toBe("");
		expect(h.readHerdrCalls().length).toBe(0);
	});

	socketTest(
		"13. 팀장 작업공간 닫힘(workspace_closed 이벤트 + pane_not_found) → --quiet 기다리지 않고 즉시 exit reason=gone, rc 0",
		async () => {
			const h = createHarness();
			cleanups.push(h.cleanup);
			h.setLayoutFixture(TARGET_WITH_SIDEBAR_LAYOUT);

			let closedSentAt = 0;
			const sockRef: { current: { write: (chunk: string) => unknown } | null } =
				{ current: null };
			const server = Bun.listen({
				unix: h.sockPath,
				socket: {
					data(sock, data) {
						const lines = data.toString("utf8").split("\n").filter(Boolean);
						for (const line of lines) {
							const msg = JSON.parse(line);
							if (msg.method === "events.subscribe") {
								sockRef.current = sock;
								sock.write(
									`${JSON.stringify({ id: msg.id, result: { type: "subscription_started" } })}\n`,
								);
								// 다른 작업공간 workspace_closed는 무시해야 함
								sock.write(
									`${JSON.stringify({
										data: { workspace_id: "wOther" },
										event: "workspace_closed",
									})}\n`,
								);
							}
						}
					},
				},
			});
			cleanups.push(() => server.stop(true));

			const { done } = runWatchAsync(h, [
				"--quiet",
				"2.5",
				"--liveness",
				"60",
				"--max-run",
				"10",
			]);

			const subChecked = await waitFor(() =>
				/check trigger=(?:subscribed|reconnect) status=ok/.test(
					h.readWatchLog(),
				),
			);
			expect(subChecked).toBe(true);

			h.setPaneGetMode("not_found");
			closedSentAt = performance.now();
			sockRef.current?.write(
				`${JSON.stringify({
					data: { workspace_id: TEAM_WS },
					event: "workspace_closed",
				})}\n`,
			);

			const res = await done;
			const elapsedAfterClose =
				closedSentAt > 0 ? performance.now() - closedSentAt : 9999;
			const log = h.readWatchLog();
			expect(log).not.toContain("Operation not permitted");
			expect(res.status).toBe(0);
			expect(closedSentAt).toBeGreaterThan(0);
			// --quiet 2.5초보다 훨씬 빨리 종료되어야 함
			expect(elapsedAfterClose).toBeLessThan(2000);
			expect(log).toContain(
				"check trigger=event status=gone tab=- detail=pane_not_found events=1",
			);
			expect(log).toContain("exit reason=gone rc=0");
		},
		15_000,
	);

	test(
		"14. 대비책(--liveness): 이벤트 없이 pane get이 pane_not_found로 바뀌면 --liveness 0.3 안에 exit reason=gone (판정 check 없이 생존 확인만)",
		async () => {
			const h = createHarness();
			cleanups.push(h.cleanup);
			h.setLayoutFixture(TARGET_WITH_SIDEBAR_LAYOUT);

			const { done } = runWatchAsync(h, [
				"--liveness",
				"0.3",
				"--quiet",
				"5.0",
				"--backoff-min",
				"5.0",
				"--max-run",
				"10",
			]);

			// 초기 start 판정 로그가 찍힐 때까지 대기
			const started = await waitFor(() =>
				h.readWatchLog().includes("check trigger=start status=ok"),
			);
			expect(started).toBe(true);

			const failAt = performance.now();
			h.setPaneGetMode("not_found");

			const res = await done;
			const elapsedMs = performance.now() - failAt;
			const log = h.readWatchLog();

			expect(res.status).toBe(0);
			// --liveness 0.3초 주기로 감지해 --max-run 10초보다 훨씬 빨리 종료
			expect(elapsedMs).toBeLessThan(3000);
			expect(log).toContain("exit reason=gone rc=0");
			// liveness는 판정(check)이 아니라 생존 확인만 하므로 start 이후 추가 check 줄이 없어야 함
			const checkLines = log
				.split("\n")
				.filter((line) => line.includes("check trigger="));
			expect(checkLines.length).toBe(1);
		},
		15_000,
	);

	test(
		"15. 복구 명령이 배치를 고치고 rc 1을 내는 경우 → 다음 판정이 ok이면 state ok, last_rc 1",
		async () => {
			// 15a. --once 모드
			{
				const h = createHarness({ repairFixesLayout: true, repairExitCode: 1 });
				cleanups.push(h.cleanup);
				h.setLayoutFixture(STACKED_LAYOUT);

				const res = runWatchSync(h, ["--once"]);
				expect(res.status).toBe(0);
				expect(h.readRepairCount()).toBe(1);
				expect(h.readWatchLog()).toContain("relayout rc=1");
				const state = h.readWatchState();
				expect(state?.status).toBe("ok");
				expect(state?.tab).toBe(TEAM_TAB);
				expect(state?.last_rc).toBe(1);
			}

			// 15b. watch 모드 (복구 뒤 다음 판정이 ok일 때 state 기록)
			{
				const h = createHarness({ repairFixesLayout: true, repairExitCode: 1 });
				cleanups.push(h.cleanup);
				h.setLayoutFixture(STACKED_LAYOUT);

				const { proc, done } = runWatchAsync(h, [
					"--quiet",
					"0.1",
					"--backoff-min",
					"5.0",
					"--max-run",
					"10",
				]);

				const okWritten = await waitFor(
					() => h.readWatchState()?.status === "ok" && h.readRepairCount() === 1,
				);
				expect(okWritten).toBe(true);

				const res = await stopWatch(proc, done);
				expect(res.status === 0 || res.signal === "SIGTERM").toBe(true);
				expect(h.readRepairCount()).toBe(1);
				const log = h.readWatchLog();
				expect(log).toContain("relayout rc=1");
				expect(log).toMatch(
					/check trigger=(?:event|subscribed|reconnect) status=ok tab=wT:t1 detail=3-pane/,
				);
				const state = h.readWatchState();
				expect(state?.status).toBe("ok");
				expect(state?.tab).toBe(TEAM_TAB);
				expect(state?.last_rc).toBe(1);
			}
		},
		15_000,
	);

	socketTest(
		"16. 첫 구독 직후 판정(trigger=subscribed): 시작 판정 뒤 구독 완료 직전에 쌓인 배치로 바뀌면 이벤트 없이도 복구 1회",
		async () => {
			const h = createHarness({ repairFixesLayout: true });
			cleanups.push(h.cleanup);
			h.setLayoutFixture(TARGET_WITH_SIDEBAR_LAYOUT);

			const server = Bun.listen({
				unix: h.sockPath,
				socket: {
					data(sock, data) {
						const lines = data.toString("utf8").split("\n").filter(Boolean);
						for (const line of lines) {
							const msg = JSON.parse(line);
							if (msg.method === "events.subscribe") {
								// 시작 판정(start)과 첫 구독 완료 사이에 배치가 쌓인 상황 (소켓 이벤트 없음)
								h.setLayoutFixture(STACKED_LAYOUT);
								sock.write(
									`${JSON.stringify({ id: msg.id, result: { type: "subscription_started" } })}\n`,
								);
							}
						}
					},
				},
			});
			cleanups.push(() => server.stop(true));

			const { proc, done } = runWatchAsync(h, [
				"--quiet",
				"0.2",
				"--max-run",
				"10",
			]);

			const repairedAndOk = await waitFor(
				() => h.readWatchState()?.status === "ok" && h.readRepairCount() === 1,
			);
			expect(repairedAndOk).toBe(true);

			const res = await stopWatch(proc, done);
			const log = h.readWatchLog();
			expect(log).not.toContain("Operation not permitted");
			expect(res.status === 0 || res.signal === "SIGTERM").toBe(true);
			expect(log).toContain("check trigger=start status=ok tab=wT:t1 detail=3-pane");
			const offLines = log
				.split("\n")
				.filter((line) => /check trigger=\S+ status=off\b/.test(line));
			expect(offLines.length).toBe(1);
			expect(offLines[0]).toMatch(
				/check trigger=(?:subscribed|reconnect) status=off tab=wT:t1 detail=3-pane/,
			);
			expect(h.readRepairCount()).toBe(1);
			expect(h.readWatchState()?.status).toBe("ok");
		},
		15_000,
	);

	test(
		"17. 일시적인 pane get 실패(빈 응답/오류) 뒤 회복 → exit reason=gone으로 끝나지 않고 감시를 계속한다",
		async () => {
			const h = createHarness({ repairFixesLayout: true });
			cleanups.push(h.cleanup);
			h.setLayoutFixture(STACKED_LAYOUT);
			// 시작 시점부터 일시적인 pane get 실패(pane_not_found가 아닌 빈 응답 rc 1)
			h.setPaneGetMode("transient_error");

			const { proc, done } = runWatchAsync(h, [
				"--liveness",
				"0.2",
				"--retry",
				"0.25",
				"--quiet",
				"0.1",
				"--backoff-min",
				"5.0",
				"--max-run",
				"10",
			]);

			// start 판정이 unknown으로 기록될 때까지 대기
			const startUnknown = await waitFor(() =>
				h
					.readWatchLog()
					.includes(
						"check trigger=start status=unknown tab=- detail=pane_lookup_failed",
					),
			);
			expect(startUnknown).toBe(true);

			// liveness 주기가 최소 1회 이상 지나도 transient_error로는 종료되지 않아야 함
			await new Promise((r) => setTimeout(r, 350));
			expect(h.readWatchLog()).not.toContain("exit reason=gone");

			// 이후 pane get이 정상 회복되면 감시가 살아 있다가 retry로 복구·상태 기록까지 완료됨
			h.setPaneGetMode("ok");
			const recovered = await waitFor(
				() => h.readWatchState()?.status === "ok" && h.readRepairCount() === 1,
			);
			expect(recovered).toBe(true);

			const res = await stopWatch(proc, done);
			const log = h.readWatchLog();
			expect(res.status === 0 || res.signal === "SIGTERM").toBe(true);
			expect(log).not.toContain("exit reason=gone");
		},
		15_000,
	);

	socketTest(
		"18. 소켓: 쌓인 배치 이벤트 → quiet 뒤 판정 때 pane get 일시 실패(unknown) → 회복 → --retry 0.3 뒤 재판정(trigger=retry)에서 off → 복구 1회 → 최종 ok",
		async () => {
			const h = createHarness({ repairFixesLayout: true });
			cleanups.push(h.cleanup);
			h.setLayoutFixture(TARGET_WITH_SIDEBAR_LAYOUT);

			const sockRef: { current: { write: (chunk: string) => unknown } | null } =
				{ current: null };
			const server = Bun.listen({
				unix: h.sockPath,
				socket: {
					data(sock, data) {
						const lines = data.toString("utf8").split("\n").filter(Boolean);
						for (const line of lines) {
							const msg = JSON.parse(line);
							if (msg.method === "events.subscribe") {
								sockRef.current = sock;
								sock.write(
									`${JSON.stringify({ id: msg.id, result: { type: "subscription_started" } })}\n`,
								);
							}
						}
					},
				},
			});
			cleanups.push(() => server.stop(true));

			const { proc, done } = runWatchAsync(h, [
				"--quiet",
				"0.15",
				"--retry",
				"0.3",
				"--max-run",
				"10",
			]);

			const subChecked = await waitFor(() =>
				/check trigger=(?:subscribed|reconnect) status=ok/.test(
					h.readWatchLog(),
				),
			);
			expect(subChecked).toBe(true);

			// 쌓인 배치로 바뀌고 이벤트 1회가 오지만, quiet 뒤 판정 시점에 pane get이 일시 실패(unknown)
			h.setLayoutFixture(STACKED_LAYOUT);
			h.setPaneGetMode("transient_error");
			sockRef.current?.write(
				`${JSON.stringify({
					event: "layout_updated",
					data: {
						type: "layout_updated",
						workspace_id: TEAM_WS,
						tab_id: TEAM_TAB,
					},
				})}\n`,
			);

			// event 판정이 unknown으로 기록될 때까지 대기
			const eventUnknown = await waitFor(() =>
				h
					.readWatchLog()
					.includes(
						"check trigger=event status=unknown tab=- detail=pane_lookup_failed",
					),
			);
			expect(eventUnknown).toBe(true);

			// 추가 소켓 이벤트 없이 pane get만 회복 → --retry 0.3 뒤 trigger=retry로 off 감지·복구 1회·최종 ok
			h.setPaneGetMode("ok");

			const recovered = await waitFor(
				() => h.readWatchState()?.status === "ok" && h.readRepairCount() === 1,
			);
			expect(recovered).toBe(true);

			const res = await stopWatch(proc, done);
			const log = h.readWatchLog();
			expect(log).not.toContain("Operation not permitted");
			expect(res.status === 0 || res.signal === "SIGTERM").toBe(true);
			expect(log).toContain(
				"check trigger=retry status=off tab=wT:t1 detail=3-pane",
			);
			expect(h.readRepairCount()).toBe(1);
			expect(h.readWatchState()?.status).toBe("ok");
		},
		15_000,
	);

	test(
		"19. 연속 조회 불가(--unavailable-grace 0.6) → exit reason=unavailable 및 잠금 해제, 짧은 실패 뒤 회복하면 감시 지속",
		async () => {
			// 19a. 계속 조회 불가 → 유한 시간 안에 exit reason=unavailable → 같은 디렉터리로 재실행 시 잠금 획득
			{
				const h = createHarness({ repairFixesLayout: true });
				cleanups.push(h.cleanup);
				h.setPaneGetMode("transient_error");

				const t0 = performance.now();
				const { done } = runWatchAsync(h, [
					"--unavailable-grace",
					"0.6",
					"--retry",
					"0.25",
					"--backoff-min",
					"5.0",
					"--max-run",
					"10",
				]);
				const res = await done;
				const elapsedMs = performance.now() - t0;
				const log = h.readWatchLog();

				expect(res.status).toBe(0);
				expect(elapsedMs).toBeLessThan(5000);
				expect(log).toContain("exit reason=unavailable rc=0");
				expect(log).not.toContain("exit reason=gone");

				// 잠금이 풀려 같은 GJCH_LAYOUT_WATCH_DIR로 다시 실행하면 already running이 아님
				h.setPaneGetMode("ok");
				const second = runWatchSync(h, ["--once"]);
				expect(second.status).toBe(0);
				expect(second.stderr).not.toContain("already running");
				expect(h.readWatchLog()).toContain("exit reason=once rc=0");
			}

			// 19b. 유예 시간보다 짧은 실패 뒤 회복하면 종료하지 않고 retry로 복구·감시 지속
			{
				const h = createHarness({ repairFixesLayout: true });
				cleanups.push(h.cleanup);
				h.setLayoutFixture(STACKED_LAYOUT);
				h.setPaneGetMode("transient_error");

				const { proc, done } = runWatchAsync(h, [
					"--unavailable-grace",
					"2.5",
					"--retry",
					"0.25",
					"--quiet",
					"0.15",
					"--backoff-min",
					"5.0",
					"--max-run",
					"10",
				]);

				const startUnknown = await waitFor(() =>
					h
						.readWatchLog()
						.includes(
							"check trigger=start status=unknown tab=- detail=pane_lookup_failed",
						),
				);
				expect(startUnknown).toBe(true);

				// 유예 시간 전에 회복
				h.setPaneGetMode("ok");

				const recovered = await waitFor(
					() => h.readWatchState()?.status === "ok" && h.readRepairCount() === 1,
				);
				expect(recovered).toBe(true);

				const res = await stopWatch(proc, done);
				const log = h.readWatchLog();
				expect(res.status === 0 || res.signal === "SIGTERM").toBe(true);
				expect(log).not.toContain("exit reason=unavailable");
				expect(log).not.toContain("exit reason=gone");
				expect(log).toContain(
					"check trigger=retry status=off tab=wT:t1 detail=3-pane",
				);
				expect(h.readRepairCount()).toBe(1);
				expect(h.readWatchState()?.status).toBe("ok");
			}
		},
		15_000,
	);

	test(
		"20. 복구 명령 시간 제한(--relayout-timeout 0.5): 프로세스 그룹 전체를 종료하고 재시도 없이 남은 pane 위치를 상태 파일에 기록한 뒤 rc=2로 종료한다",
		async () => {
			const h = createHarness({
				repairFixesLayout: false,
				repairSleepSec: 30,
				repairChildPidFile: "repair-child.pid",
				repairMoveMateToTab: "wT:t9",
			});
			cleanups.push(h.cleanup);
			h.setLayoutFixture(STACKED_LAYOUT);

			const t0 = performance.now();
			const { done } = runWatchAsync(h, [
				"--relayout-timeout",
				"0.5",
				"--quiet",
				"0.2",
				"--limit",
				"2",
				"--backoff-min",
				"5.0",
				"--max-run",
				"10",
			]);
			const res = await done;
			const elapsedMs = performance.now() - t0;
			const log = h.readWatchLog();

			expect(res.status).toBe(2);
			expect(elapsedMs).toBeLessThan(6000);
			expect(log).toContain("relayout timeout after 0.5s");
			expect(log).toContain("relayout timeout: group terminated");
			expect(log).toContain(
				"relayout timeout panes lead=wT:p1@wT:t1 mate=wT:p2@wT:t9 critic=wT:p3@wT:t1 tabs=wT:t1,wT:t9",
			);
			expect(log).toContain("exit reason=relayout_timeout rc=2");

			// 손자 프로세스(sleep 30)까지 정리되었는지 확인
			const childPidFile = path.join(h.tmpDir, "repair-child.pid");
			expect(fs.existsSync(childPidFile)).toBe(true);
			const childPid = Number.parseInt(
				fs.readFileSync(childPidFile, "utf8").trim(),
				10,
			);
			expect(Number.isFinite(childPid)).toBe(true);
			expect(() => process.kill(childPid, 0)).toThrow();

			// 재시도 및 알림 없음 (복구 시도 1회뿐)
			expect(h.readRepairCount()).toBe(1);
			expect(h.readNotifyCalls().length).toBe(0);

			// 상태 파일에 남은 pane 위치와 workspace_tabs 기록 확인
			const state = h.readWatchState();
			expect(state?.status).toBe("relayout_timeout");
			expect(state?.tab).toBe(TEAM_TAB);
			expect(state?.last_rc).toBeNull();
			expect(state?.panes?.lead).toEqual({ pane: LEAD_PANE, tab: TEAM_TAB });
			expect(state?.panes?.mate).toEqual({ pane: MATE_PANE, tab: "wT:t9" });
			expect(state?.panes?.critic).toEqual({
				pane: CRITIC_PANE,
				tab: TEAM_TAB,
			});
			expect(state?.workspace_tabs).toContain("wT:t9");
		},
		15_000,
	);

	test("21. 옵션 범위 검증: --retry 0, --relayout-timeout -1, --unavailable-grace nan은 rc 2로 즉시 실패하고 감시 시작 로그가 남지 않는다", () => {
		const invalidCases: string[][] = [
			["--retry", "0"],
			["--relayout-timeout", "-1"],
			["--unavailable-grace", "nan"],
		];
		for (const args of invalidCases) {
			const h = createHarness();
			cleanups.push(h.cleanup);
			const res = runWatchSync(h, args);
			expect(res.status).toBe(2);
			expect(h.readWatchLog()).toBe("");
			expect(h.readHerdrCalls().length).toBe(0);
		}
	});

	test(
		"22. 복구 명령이 SIGHUP(kill -HUP $$)으로 종료돼 returncode -1이 나오면 relayout_timeout으로 오인하지 않고 일반 실패(rc=-1)로 처리한다",
		async () => {
			const h = createHarness({
				repairFixesLayout: false,
				repairSelfSignal: "HUP",
			});
			cleanups.push(h.cleanup);
			h.setLayoutFixture(STACKED_LAYOUT);

			const { proc, done } = runWatchAsync(h, [
				"--quiet",
				"0.1",
				"--limit",
				"1",
				"--backoff-min",
				"5.0",
				"--max-run",
				"10",
			]);

			const limitReached = await waitFor(
				() =>
					h.readWatchState()?.status === "limit" &&
					h.readWatchLog().includes("limit reached"),
			);
			expect(limitReached).toBe(true);

			const res = await stopWatch(proc, done);
			const log = h.readWatchLog();
			const state = h.readWatchState();

			expect(res.status === 0 || res.signal === "SIGTERM").toBe(true);
			expect(res.status).not.toBe(2);
			expect(log).toContain("relayout rc=-1");
			expect(log).not.toContain("exit reason=relayout_timeout");
			expect(state?.status).toBe("limit");
			expect(state?.status).not.toBe("relayout_timeout");
			expect(state?.last_rc).toBe(-1);
		},
		15_000,
	);
});
