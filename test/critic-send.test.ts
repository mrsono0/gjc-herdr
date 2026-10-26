import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = fs.realpathSync(path.resolve(import.meta.dir, ".."));
const CRITIC_SEND_SH = path.join(REPO_ROOT, "scripts", "critic-send.sh");
const REAL_PYTHON3 = (() => {
	for (const candidate of ["/opt/homebrew/bin/python3", "/usr/bin/python3"]) {
		if (fs.existsSync(candidate)) {
			try {
				return fs.realpathSync(candidate);
			} catch {
				return candidate;
			}
		}
	}
	return "";
})();

// .local/agy/46-codex-screen.ansi 하단 입력란·상태 줄·안내 줄(42–46행) 원문 및 파생 fixture
const EXISTING_EMPTY_SCREEN = [
	"\x1b[0m\x1b[48;2;30;68;78m                                                                                          \x1b[0m",
	"\x1b[0m\x1b[1m\x1b[48;2;30;68;78m›\x1b[0m\x1b[48;2;30;68;78m \x1b[0m\x1b[2m\x1b[48;2;30;68;78mAsk Codex to do anything\x1b[0m\x1b[48;2;30;68;78m                                                                \x1b[0m",
	"\x1b[0m\x1b[48;2;30;68;78m                                                                                          \x1b[0m",
	"  \x1b[0m\x1b[38;2;242;181;144mContext 94% left\x1b[0m\x1b[38;2;124;145;148m · \x1b[0m\x1b[38;2;242;181;144m259K in\x1b[0m\x1b[38;2;124;145;148m · \x1b[0m\x1b[38;2;242;181;144m2.01K out\x1b[0m",
	"  \x1b[0m\x1b[1m\x1b[38;2;131;148;150m?\x1b[0m\x1b[38;2;124;145;148m for shortcuts\x1b[0m",
].join("\n");

const NEW_TYPED_SCREEN = [
	"\x1b[0m\x1b[48;2;30;68;78m                                                                                          \x1b[0m",
	"\x1b[0m\x1b[1m\x1b[48;2;30;68;78m›\x1b[0m\x1b[48;2;30;68;78m /new                                                                                     \x1b[0m",
	"\x1b[0m\x1b[48;2;30;68;78m                                                                                          \x1b[0m",
	"  \x1b[0m\x1b[38;2;242;181;144mContext 94% left\x1b[0m\x1b[38;2;124;145;148m · \x1b[0m\x1b[38;2;242;181;144m259K in\x1b[0m\x1b[38;2;124;145;148m · \x1b[0m\x1b[38;2;242;181;144m2.01K out\x1b[0m",
	"  \x1b[0m\x1b[1m\x1b[38;2;131;148;150m?\x1b[0m\x1b[38;2;124;145;148m for shortcuts\x1b[0m",
].join("\n");

const FRESH_SCREEN = [
	"\x1b[0m\x1b[48;2;30;68;78m                                                                                          \x1b[0m",
	"\x1b[0m\x1b[1m\x1b[48;2;30;68;78m›\x1b[0m\x1b[48;2;30;68;78m \x1b[0m\x1b[2m\x1b[48;2;30;68;78mAsk Codex to do anything\x1b[0m\x1b[48;2;30;68;78m                                                                \x1b[0m",
	"\x1b[0m\x1b[48;2;30;68;78m                                                                                          \x1b[0m",
	"  \x1b[0m\x1b[38;2;242;181;144mContext 100% left\x1b[0m\x1b[38;2;124;145;148m · \x1b[0m\x1b[38;2;242;181;144m0 in\x1b[0m\x1b[38;2;124;145;148m · \x1b[0m\x1b[38;2;242;181;144m0 out\x1b[0m",
	"  \x1b[0m\x1b[1m\x1b[38;2;131;148;150m?\x1b[0m\x1b[38;2;124;145;148m for shortcuts\x1b[0m",
].join("\n");

const DRAFT_SCREEN = [
	"\x1b[0m\x1b[48;2;30;68;78m                                                                                          \x1b[0m",
	"\x1b[0m\x1b[1m\x1b[48;2;30;68;78m›\x1b[0m\x1b[48;2;30;68;78m \x1b[0m\x1b[48;2;30;68;78mdraft in progress\x1b[0m\x1b[48;2;30;68;78m                                                                       \x1b[0m",
	"\x1b[0m\x1b[48;2;30;68;78m                                                                                          \x1b[0m",
	"  \x1b[0m\x1b[38;2;242;181;144mContext 100% left\x1b[0m\x1b[38;2;124;145;148m · \x1b[0m\x1b[38;2;242;181;144m0 in\x1b[0m\x1b[38;2;124;145;148m · \x1b[0m\x1b[38;2;242;181;144m0 out\x1b[0m",
	"  \x1b[0m\x1b[1m\x1b[38;2;131;148;150m?\x1b[0m\x1b[38;2;124;145;148m for shortcuts\x1b[0m",
].join("\n");

const UNPARSEABLE_SCREEN = [
	"\x1b[0m\x1b[48;2;30;68;78m                                                                                          \x1b[0m",
	"\x1b[0m\x1b[1m\x1b[48;2;30;68;78m›\x1b[0m\x1b[48;2;30;68;78m \x1b[0m\x1b[2m\x1b[48;2;30;68;78mAsk Codex to do anything\x1b[0m\x1b[48;2;30;68;78m                                                                \x1b[0m",
	"\x1b[0m\x1b[48;2;30;68;78m                                                                                          \x1b[0m",
	"  \x1b[0m\x1b[38;2;242;181;144munrecognized status line\x1b[0m",
	"  \x1b[0m\x1b[1m\x1b[38;2;131;148;150m?\x1b[0m\x1b[38;2;124;145;148m for shortcuts\x1b[0m",
].join("\n");

const SCREEN_CODEX_TRUST = `  Folder access
  /Users/test-secret-owner/private-project-path

  Trust this folder? Codex can read, edit, and run files here, subject to your
  permission settings. ...

› 1. Trust and continue
  2. Back to Agent Command Center

  enter continue · esc back
`;

interface RunCriticSendOptions {
	focused: boolean;
	screen: string;
	agentStatus?: string;
	interactiveReady?: boolean;
	prePromptWorkingOnce?: boolean;
	noWait?: boolean;
	resultMode?: "none" | "written" | "unwritten";
	agentSession?: { kind: string; value: string; source?: string };
	reportSessionFail?: boolean;
	externalMode?: boolean;
	waitWorkingPolls?: number;
	keepWorkingAfterPrompt?: boolean;
	postPromptDialogScreen?: string;
	dialogIntervalSec?: number | string;
	timeoutMs?: number;
}

function makeAgentJson(params: {
	workspaceId: string;
	criticPaneId: string;
	criticName: string;
	focused: boolean;
	agentStatus: string;
	interactiveReady: boolean;
	revision: number;
	stateChangeSeq: number;
	agentSession?: { kind: string; value: string; source?: string };
}): string {
	return JSON.stringify({
		result: {
			agent: {
				workspace_id: params.workspaceId,
				pane_id: params.criticPaneId,
				terminal_id: "term-critic-1",
				agent: "codex",
				name: params.criticName,
				cwd: REPO_ROOT,
				foreground_cwd: REPO_ROOT,
				focused: params.focused,
				agent_status: params.agentStatus,
				interactive_ready: params.interactiveReady,
				revision: params.revision,
				state_change_seq: params.stateChangeSeq,
				...(params.agentSession ? { agent_session: params.agentSession } : {}),
			},
		},
	});
}

function runCriticSend(options: RunCriticSendOptions): {
	status: number | null;
	stdout: string;
	stderr: string;
	calls: string[];
	reportArgvCalls: string[][];
	readStatuses: string[];
} {
	const tmpDir = fs.mkdtempSync("/tmp/gjch-t-critic-send-");
	try {
		const logPath = path.join(tmpDir, "herdr-calls.log");
		const reportArgvPath = path.join(tmpDir, "report-argv.jsonl");
		const lastStatusPath = path.join(tmpDir, "last-agent-status");
		const readStatusesPath = path.join(tmpDir, "read-statuses.log");
		const screenPath = path.join(tmpDir, "screen.ansi");
		const newTypedScreenPath = path.join(tmpDir, "screen-new-typed.ansi");
		const freshScreenPath = path.join(tmpDir, "screen-fresh.ansi");
		const agentInitialPath = path.join(tmpDir, "agent-initial.json");
		const agentWorkingPath = path.join(tmpDir, "agent-working.json");
		const agentReadyPath = path.join(tmpDir, "agent-ready.json");
		const enterSentPath = path.join(tmpDir, "enter-sent");
		const postEnterGetsPath = path.join(tmpDir, "post-enter-gets");
		const prePromptWorkingUsedPath = path.join(tmpDir, "pre-prompt-working-used");
		const promptSentPath = path.join(tmpDir, "prompt-sent");
		const postPromptGetsPath = path.join(tmpDir, "post-prompt-gets");
		const postPromptDialogPath = path.join(tmpDir, "screen-post-prompt-dialog.ansi");
		const briefPath = path.join(tmpDir, "brief.md");
		const resultPath = path.join(tmpDir, "critic-result.md");
		const procCriticPath = path.join(tmpDir, "proc-critic.json");
		const lockPath = path.join(tmpDir, "lead.json");
		const sockPath = path.join(tmpDir, "lead.sock");
		const herdrBin = path.join(tmpDir, "herdr");
		const lsofBin = path.join(tmpDir, "lsof");

		const workspaceId = "w-test";
		const leadPaneId = "w-test:p-lead";
		const criticPaneId = "w-test:p-critic";
		const criticName = "gjc-herdr-critic";
		const codexStatusLine =
			'tui.status_line=["context-remaining","total-input-tokens","total-output-tokens"]';

		fs.writeFileSync(screenPath, options.screen, "utf8");
		fs.writeFileSync(newTypedScreenPath, NEW_TYPED_SCREEN, "utf8");
		fs.writeFileSync(freshScreenPath, FRESH_SCREEN, "utf8");
		if (options.postPromptDialogScreen !== undefined) {
			fs.writeFileSync(postPromptDialogPath, options.postPromptDialogScreen, "utf8");
		}
		fs.writeFileSync(briefPath, "# 검토 지시서\n내용 확인\n", "utf8");
		fs.writeFileSync(
			procCriticPath,
			JSON.stringify({
				id: "req-1",
				result: {
					type: "pane_process_info",
					process_info: {
						pane_id: criticPaneId,
						shell_pid: 1000,
						foreground_process_group_id: 2000,
						foreground_processes: [
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
									codexStatusLine,
									"-c",
									"project_doc_max_bytes=65536",
								],
							},
						],
					},
				},
			}),
			"utf8",
		);

		fs.writeFileSync(
			agentInitialPath,
			makeAgentJson({
				workspaceId,
				criticPaneId,
				criticName,
				focused: options.focused,
				agentStatus: options.agentStatus ?? "idle",
				interactiveReady: options.interactiveReady ?? true,
				revision: 1,
				stateChangeSeq: 1,
				agentSession: options.agentSession,
			}),
			"utf8",
		);
		fs.writeFileSync(
			agentWorkingPath,
			makeAgentJson({
				workspaceId,
				criticPaneId,
				criticName,
				focused: options.focused,
				agentStatus: "working",
				interactiveReady: false,
				revision: 2,
				stateChangeSeq: 2,
				agentSession: options.agentSession,
			}),
			"utf8",
		);
		fs.writeFileSync(
			agentReadyPath,
			makeAgentJson({
				workspaceId,
				criticPaneId,
				criticName,
				focused: options.focused,
				agentStatus: "idle",
				interactiveReady: true,
				revision: 3,
				stateChangeSeq: 3,
				agentSession: options.agentSession,
			}),
			"utf8",
		);

		const fakeHerdrScript = `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}
CRITIC_PANE=${JSON.stringify(criticPaneId)}
CRITIC_NAME=${JSON.stringify(criticName)}
SCREEN_PATH=${JSON.stringify(screenPath)}
NEW_TYPED_PATH=${JSON.stringify(newTypedScreenPath)}
FRESH_PATH=${JSON.stringify(freshScreenPath)}
AGENT_INIT=${JSON.stringify(agentInitialPath)}
AGENT_WORK=${JSON.stringify(agentWorkingPath)}
AGENT_READY=${JSON.stringify(agentReadyPath)}
ENTER_SENT=${JSON.stringify(enterSentPath)}
POST_GETS=${JSON.stringify(postEnterGetsPath)}
PRE_WORK_ONCE=${JSON.stringify(options.prePromptWorkingOnce ? "1" : "0")}
PRE_WORK_USED=${JSON.stringify(prePromptWorkingUsedPath)}
PROMPT_SENT=${JSON.stringify(promptSentPath)}
POST_PROMPT_GETS=${JSON.stringify(postPromptGetsPath)}
POST_DIALOG_PATH=${JSON.stringify(postPromptDialogPath)}
WAIT_WORK_POLLS=${JSON.stringify(String(options.waitWorkingPolls ?? 0))}
KEEP_WORKING=${JSON.stringify(options.keepWorkingAfterPrompt ? "1" : "0")}
LAST_STATUS=${JSON.stringify(lastStatusPath)}
READ_STATUSES=${JSON.stringify(readStatusesPath)}
PROC_CRITIC=${JSON.stringify(procCriticPath)}
RESULT_PATH=${JSON.stringify(resultPath)}
RESULT_MODE=${JSON.stringify(options.resultMode ?? "none")}
REPORT_FAIL=${JSON.stringify(options.reportSessionFail ? "1" : "0")}

case "$1 $2" in
	"agent get")
		target="\${3:-}"
		if [ "$target" = "gjc-herdr-mate" ]; then
			printf '{"error":{"code":"agent_not_found","message":"not found"}}\\n' >&2
			exit 1
		fi
		if [ "$target" != "$CRITIC_NAME" ] && [ "$target" != "$CRITIC_PANE" ]; then
			printf 'unexpected agent get target: %s\\n' "$target" >&2
			exit 1
		fi
		if [ -f "$PROMPT_SENT" ]; then
			if [ "$KEEP_WORKING" = "1" ]; then
				printf 'working' > "$LAST_STATUS"
				cat "$AGENT_WORK"
				exit 0
			fi
			if [ "$WAIT_WORK_POLLS" -gt 0 ]; then
				pcount=0
				[ -f "$POST_PROMPT_GETS" ] && pcount="$(cat "$POST_PROMPT_GETS")"
				pcount=$((pcount + 1))
				printf '%s' "$pcount" > "$POST_PROMPT_GETS"
				if [ "$pcount" -le "$WAIT_WORK_POLLS" ]; then
					printf 'working' > "$LAST_STATUS"
					cat "$AGENT_WORK"
					exit 0
				fi
			fi
			printf 'idle' > "$LAST_STATUS"
			cat "$AGENT_READY"
			exit 0
		fi
		if [ -f "$ENTER_SENT" ]; then
			if [ "$target" = "$CRITIC_PANE" ]; then
				count=0
				[ -f "$POST_GETS" ] && count="$(cat "$POST_GETS")"
				count=$((count + 1))
				printf '%s' "$count" > "$POST_GETS"
				if [ "$count" -eq 1 ]; then
					printf 'working' > "$LAST_STATUS"
					cat "$AGENT_WORK"
				else
					printf 'idle' > "$LAST_STATUS"
					cat "$AGENT_READY"
				fi
				exit 0
			fi
			if [ "$PRE_WORK_ONCE" = "1" ] && [ ! -f "$PRE_WORK_USED" ]; then
				: > "$PRE_WORK_USED"
				printf 'working' > "$LAST_STATUS"
				cat "$AGENT_WORK"
				exit 0
			fi
			printf 'idle' > "$LAST_STATUS"
			cat "$AGENT_READY"
			exit 0
		fi
		printf 'idle' > "$LAST_STATUS"
		cat "$AGENT_INIT"
		exit 0
		;;
	"pane get")
		pane="\${3:-}"
		printf '{"result":{"pane":{"pane_id":"%s","workspace_id":"w-test","tab_id":"w-test:t1","cwd":%s,"foreground_cwd":%s,"agent_status":"idle"}}}\\n' "$pane" ${JSON.stringify(JSON.stringify(REPO_ROOT))} ${JSON.stringify(JSON.stringify(REPO_ROOT))}
		exit 0
		;;
	"workspace get")
		ws_id="\${3:-w-test}"
		printf '{"result":{"workspace":{"workspace_id":"%s","label":"GJCH · gjc-herdr"}}}\\n' "$ws_id"
		exit 0
		;;
	"pane read")
		if [ "\${3:-}" != "$CRITIC_PANE" ]; then
			printf 'unexpected pane read target: %s\\n' "\${3:-}" >&2
			exit 1
		fi
		cat "$SCREEN_PATH"
		exit 0
		;;
	"agent read")
		if [ "\${3:-}" != "$CRITIC_NAME" ]; then
			printf 'unexpected agent read target: %s\\n' "\${3:-}" >&2
			exit 1
		fi
		st="unknown"
		[ -f "$LAST_STATUS" ] && st="$(cat "$LAST_STATUS")"
		printf '%s\\n' "$st" >> "$READ_STATUSES"
		if [ -f "$PROMPT_SENT" ] && [ -f "$POST_DIALOG_PATH" ]; then
			cat "$POST_DIALOG_PATH"
			exit 0
		fi
		cat "$SCREEN_PATH"
		exit 0
		;;
	"pane layout")
		printf '{"result":{"layout":{"panes":[{"pane_id":"%s","rect":{"width":90,"height":30}}]}}}' "$CRITIC_PANE"
		exit 0
		;;
	"pane send-text")
		if [ "\${3:-}" != "$CRITIC_PANE" ] || [ "\${4:-}" != "/new" ]; then
			printf 'unexpected pane send-text args: %s\\n' "$*" >&2
			exit 1
		fi
		cp "$NEW_TYPED_PATH" "$SCREEN_PATH"
		printf '{"ok":true}'
		exit 0
		;;
	"pane send-keys")
		if [ "\${3:-}" != "$CRITIC_PANE" ] || [ "\${4:-}" != "enter" ]; then
			printf 'unexpected pane send-keys args: %s\\n' "$*" >&2
			exit 1
		fi
		cp "$FRESH_PATH" "$SCREEN_PATH"
		: > "$ENTER_SENT"
		printf '{"ok":true}'
		exit 0
		;;
	"agent prompt")
		if [ "\${3:-}" != "$CRITIC_PANE" ] || [ -z "\${4:-}" ]; then
			printf 'unexpected agent prompt args: %s\\n' "$*" >&2
			exit 1
		fi
		: > "$PROMPT_SENT"
		if [ "$RESULT_MODE" = "written" ]; then
			printf '# 검토 결과\\n완료\\n' > "$RESULT_PATH"
		fi
		printf '{"ok":true}'
		exit 0
		;;
	"agent rename")
		if [ "\${3:-}" != "$CRITIC_PANE" ] || [ "\${4:-}" != "$CRITIC_NAME" ]; then
			printf 'unexpected agent rename args: %s\\n' "$*" >&2
			exit 1
		fi
		printf '{"ok":true}'
		exit 0
		;;
	"pane process-info")
		cat "$PROC_CRITIC"
		exit 0
		;;
	"pane report-agent-session")
		python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@" >> ${JSON.stringify(reportArgvPath)}
		if [ "$REPORT_FAIL" = "1" ]; then
			printf 'report-agent-session error: SENTINEL_CRITIC_REPORT_ERR\\n' >&2
			exit 1
		fi
		exit 0
		;;
esac
printf 'unexpected herdr command: %s\\n' "$*" >&2
exit 1
`;
		fs.writeFileSync(herdrBin, fakeHerdrScript, "utf8");
		fs.chmodSync(herdrBin, 0o755);
		fs.writeFileSync(lsofBin, "#!/bin/sh\nprintf '42424\\n'\nexit 0\n", "utf8");
		fs.chmodSync(lsofBin, 0o755);

		if (REAL_PYTHON3) {
			fs.symlinkSync(REAL_PYTHON3, path.join(tmpDir, "python3"));
		}

		if (options.externalMode && REAL_PYTHON3) {
			spawnSync(
				REAL_PYTHON3,
				[
					"-c",
					"import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1]); s.close()",
					sockPath,
				],
				{ encoding: "utf8", timeout: 5_000 },
			);
		}

		const cliArgs: string[] = [];
		if (options.timeoutMs !== undefined) {
			cliArgs.push("--timeout", String(options.timeoutMs));
		}
		if (options.noWait ?? true) {
			cliArgs.push("--no-wait");
		} else if (options.resultMode && options.resultMode !== "none") {
			cliArgs.push("--result", resultPath);
		}
		cliArgs.push(briefPath);

		const runEnv: NodeJS.ProcessEnv = {
			...process.env,
			PATH: `${tmpDir}:${process.env.PATH ?? ""}`,
			PYTHONDONTWRITEBYTECODE: "1",
			PYTHONNOUSERSITE: "1",
			CLAUDE_PROJECT_DIR: REPO_ROOT,
			GJCH_LEAD_LOCK: lockPath,
			GJCH_CRITIC_NAME: criticName,
			...(options.dialogIntervalSec !== undefined
				? { GJCH_CRITIC_DIALOG_INTERVAL: String(options.dialogIntervalSec) }
				: {}),
		};
		if (options.externalMode) {
			delete runEnv.HERDR_ENV;
			delete runEnv.HERDR_WORKSPACE_ID;
			delete runEnv.HERDR_PANE_ID;
			runEnv.GJCH_EXTERNAL_LEAD = "1";
			runEnv.CLAUDE_CODE_SESSION_ID = "ext-critic-send-sess-1";
			runEnv.CLAUDE_CODE_MESSAGING_SOCKET = sockPath;
		} else {
			delete runEnv.GJCH_EXTERNAL_LEAD;
			runEnv.HERDR_ENV = "1";
			runEnv.HERDR_WORKSPACE_ID = workspaceId;
			runEnv.HERDR_PANE_ID = leadPaneId;
			runEnv.CLAUDE_CODE_SESSION_ID = "";
			runEnv.CLAUDE_CODE_MESSAGING_SOCKET = "";
		}

		const proc = spawnSync("/bin/bash", [CRITIC_SEND_SH, ...cliArgs], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: runEnv,
		});

		const calls = fs.existsSync(logPath)
			? fs
					.readFileSync(logPath, "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
			: [];
		const reportArgvCalls = fs.existsSync(reportArgvPath)
			? fs
					.readFileSync(reportArgvPath, "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line) as string[])
			: [];
		const readStatuses = fs.existsSync(readStatusesPath)
			? fs
					.readFileSync(readStatusesPath, "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
			: [];

		return {
			status: proc.status,
			stdout: proc.stdout ?? "",
			stderr: proc.stderr ?? "",
			calls,
			reportArgvCalls,
			readStatuses,
		};
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

function findLastReadIndex(calls: string[]): number {
	let idx = -1;
	for (let i = 0; i < calls.length; i++) {
		if (calls[i]!.startsWith("pane read ")) {
			idx = i;
		}
	}
	return idx;
}

describe("scripts/critic-send.sh focus & input box checks (#46)", () => {
	test(
		"1. focused=True, idle, interactive_ready=True, 새 대화 화면이면 전송이 성공하고 agent prompt가 1번 호출된다",
		() => {
			const res = runCriticSend({
				focused: true,
				screen: FRESH_SCREEN,
			});
			expect(res.status).toBe(0);
			const promptCalls = res.calls.filter((line) => line.startsWith("agent prompt "));
			expect(promptCalls).toHaveLength(1);
		},
		60_000,
	);

	test(
		"2. focused=True, draft 화면이면 거부하고 agent prompt·pane send-text를 호출하지 않는다",
		() => {
			const res = runCriticSend({
				focused: true,
				screen: DRAFT_SCREEN,
			});
			expect(res.status).not.toBe(0);
			expect(res.stderr).toContain("입력란에 draft가 있거나 흐린 placeholder를 확인할 수 없습니다.");
			const readCalls = res.calls.filter((line) => line.startsWith("pane read "));
			const promptCalls = res.calls.filter((line) => line.startsWith("agent prompt "));
			const sendTextCalls = res.calls.filter((line) => line.startsWith("pane send-text "));
			expect(readCalls.length).toBeGreaterThanOrEqual(1);
			expect(promptCalls).toHaveLength(0);
			expect(sendTextCalls).toHaveLength(0);
		},
		60_000,
	);

	test(
		"3. focused=True, 판정 불가 화면이면 거부하고 agent prompt를 호출하지 않는다",
		() => {
			const res = runCriticSend({
				focused: true,
				screen: UNPARSEABLE_SCREEN,
			});
			expect(res.status).not.toBe(0);
			expect(res.stderr).toContain("상태 줄·안내 줄 형식을 판정할 수 없습니다");
			const readCalls = res.calls.filter((line) => line.startsWith("pane read "));
			const promptCalls = res.calls.filter((line) => line.startsWith("agent prompt "));
			expect(readCalls.length).toBeGreaterThanOrEqual(1);
			expect(promptCalls).toHaveLength(0);
		},
		60_000,
	);

	test(
		"4. focused=False, 새 대화 화면이면 전송이 성공한다 (회귀)",
		() => {
			const res = runCriticSend({
				focused: false,
				screen: FRESH_SCREEN,
			});
			expect(res.status).toBe(0);
			const promptCalls = res.calls.filter((line) => line.startsWith("agent prompt "));
			expect(promptCalls).toHaveLength(1);
		},
		60_000,
	);

	test(
		"5. focused=True, 기존 빈 대화 화면이면 /new·Enter·새 대화 준비(working 거쳐 fresh 3회) 후 agent prompt가 1번 호출된다",
		() => {
			const res = runCriticSend({
				focused: true,
				screen: EXISTING_EMPTY_SCREEN,
			});
			expect(res.status).toBe(0);
			const sendTextCalls = res.calls.filter((line) => line.startsWith("pane send-text "));
			const sendKeysCalls = res.calls.filter((line) => line.startsWith("pane send-keys "));
			const promptCalls = res.calls.filter((line) => line.startsWith("agent prompt "));
			expect(sendTextCalls).toEqual(["pane send-text w-test:p-critic /new"]);
			expect(sendKeysCalls).toEqual(["pane send-keys w-test:p-critic enter"]);
			expect(promptCalls).toHaveLength(1);

			const enterIndex = res.calls.findIndex((line) => line === "pane send-keys w-test:p-critic enter");
			const promptIndex = res.calls.findIndex((line) => line.startsWith("agent prompt "));
			const lastReadIndex = findLastReadIndex(res.calls);
			expect(enterIndex).toBeGreaterThan(0);
			expect(lastReadIndex).toBeGreaterThan(enterIndex);
			expect(promptIndex).toBeGreaterThan(lastReadIndex);
		},
		60_000,
	);

	test(
		"6. focused=True, /new 준비 직후 전송 직전 재확인에서 working이 나타나면 재대기 후 agent prompt가 1번 호출된다",
		() => {
			const res = runCriticSend({
				focused: true,
				screen: EXISTING_EMPTY_SCREEN,
				prePromptWorkingOnce: true,
			});
			expect(res.status).toBe(0);
			expect(res.stdout).toContain("/new 뒤 Codex 상태=working. 새 입력란 준비를 다시 기다립니다.");
			const sendTextCalls = res.calls.filter((line) => line.startsWith("pane send-text "));
			const sendKeysCalls = res.calls.filter((line) => line.startsWith("pane send-keys "));
			const promptCalls = res.calls.filter((line) => line.startsWith("agent prompt "));
			expect(sendTextCalls).toEqual(["pane send-text w-test:p-critic /new"]);
			expect(sendKeysCalls).toEqual(["pane send-keys w-test:p-critic enter"]);
			expect(promptCalls).toHaveLength(1);

			const enterIndex = res.calls.findIndex((line) => line === "pane send-keys w-test:p-critic enter");
			const promptIndex = res.calls.findIndex((line) => line.startsWith("agent prompt "));
			const lastReadIndex = findLastReadIndex(res.calls);
			expect(enterIndex).toBeGreaterThan(0);
			expect(lastReadIndex).toBeGreaterThan(enterIndex);
			expect(promptIndex).toBeGreaterThan(lastReadIndex);
		},
		60_000,
	);

	test(
		"7. #71 완료 대기 뒤 끝나기 직전(rc 0·4 경로 모두, 외부 모드·결과 파일 미지정 포함) Codex 재개 명령을 다시 보고하고(JSON 배열 argv 경계 검증), 보고가 실패해도 critic-send의 rc는 바뀌지 않는다",
		() => {
			const fullSid = "critic-new-sess-99887766-full-secret";
			const expectedReportArgv = [
				"pane",
				"report-agent-session",
				"--source",
				"gjch-team",
				"--agent",
				"codex",
				"w-test:p-critic",
				"--",
				"codex",
				"resume",
				fullSid,
				"--no-daemon",
				"--yolo",
				"-m",
				"gpt-6.1-sol",
				"-C",
				REPO_ROOT,
				"--disable",
				"worktrees",
				"-c",
				'tui.status_line=["context-remaining","total-input-tokens","total-output-tokens"]',
				"-c",
				"project_doc_max_bytes=65536",
			];

			// (a) 완료·결과 파일 확인(rc 0): stderr에 reported 한 줄, JSON 배열 argv 경계까지 검증(P3), 전체 id 미노출
			const okRes = runCriticSend({
				focused: false,
				screen: FRESH_SCREEN,
				noWait: false,
				resultMode: "written",
				agentSession: {
					kind: "id",
					value: fullSid,
					source: "herdr:codex",
				},
			});
			expect(okRes.status).toBe(0);
			expect(okRes.stderr.trim()).toBe("gjc-herdr-critic reported critic-n");
			expect(okRes.stdout).not.toContain(fullSid);
			expect(okRes.stderr).not.toContain(fullSid);
			expect(okRes.reportArgvCalls).toEqual([expectedReportArgv]);

			// (a-2) 외부 팀장 모드(GJCH_EXTERNAL_LEAD=1 전달) + 결과 파일 미지정 경로(rc 0, P2)
			const extNoResultRes = runCriticSend({
				focused: false,
				screen: FRESH_SCREEN,
				noWait: false,
				resultMode: "none",
				externalMode: true,
				agentSession: {
					kind: "id",
					value: fullSid,
					source: "herdr:codex",
				},
			});
			expect(extNoResultRes.status).toBe(0);
			expect(extNoResultRes.stderr.trim()).toBe(
				"gjc-herdr-critic reported critic-n",
			);
			expect(extNoResultRes.stdout).not.toContain(fullSid);
			expect(extNoResultRes.stderr).not.toContain(fullSid);
			expect(extNoResultRes.reportArgvCalls).toEqual([expectedReportArgv]);

			// (b) 완료됐으나 결과 파일 미작성(rc 4): 끝나기 직전 Codex 재보고 수행 후 rc 4 유지
			const rc4Res = runCriticSend({
				focused: false,
				screen: FRESH_SCREEN,
				noWait: false,
				resultMode: "unwritten",
				agentSession: {
					kind: "id",
					value: fullSid,
					source: "herdr:codex",
				},
			});
			expect(rc4Res.status).toBe(4);
			expect(rc4Res.stderr).toContain("gjc-herdr-critic reported critic-n");
			expect(rc4Res.stdout).not.toContain(fullSid);
			expect(rc4Res.stderr).not.toContain(fullSid);
			expect(rc4Res.reportArgvCalls).toEqual([expectedReportArgv]);

			// (c) 보고 실패 시에도 critic-send의 rc(0 및 4)는 바뀌지 않고 stderr에 fail 한 줄만 남김
			const failRc0Res = runCriticSend({
				focused: false,
				screen: FRESH_SCREEN,
				noWait: false,
				resultMode: "written",
				agentSession: {
					kind: "id",
					value: fullSid,
					source: "herdr:codex",
				},
				reportSessionFail: true,
			});
			expect(failRc0Res.status).toBe(0);
			expect(failRc0Res.stderr.trim()).toBe("gjc-herdr-critic fail 1");
			expect(failRc0Res.stderr).not.toContain("SENTINEL_CRITIC_REPORT_ERR");

			const failRc4Res = runCriticSend({
				focused: false,
				screen: FRESH_SCREEN,
				noWait: false,
				resultMode: "unwritten",
				agentSession: {
					kind: "id",
					value: fullSid,
					source: "herdr:codex",
				},
				reportSessionFail: true,
			});
			expect(failRc4Res.status).toBe(4);
			expect(failRc4Res.stderr).toContain("gjc-herdr-critic fail 1");
			expect(failRc4Res.stderr).not.toContain("SENTINEL_CRITIC_REPORT_ERR");
		},
		60_000,
	);

	test(
		"8. #79 완료 대기 중 확인창 감지: (e) 작업 중 확인창 → rc 5·보고 0회, (f) idle인데 확인창 → rc 5(rc 4 아님)·보고 0회, (g) 확인창 없는 정상 흐름은 기존 기대값 그대로",
		() => {
			const fullSid = "critic-dialog-sess-11223344-full-secret";

			// (e) 작업 중(working) 확인창 감지: 끝까지 working을 유지(idle로 바꾸지 않음)하여 working 주기 검사만으로 rc 5·보고 0회가 되는지 확인
			const workingDialogRes = runCriticSend({
				focused: false,
				screen: FRESH_SCREEN,
				noWait: false,
				resultMode: "unwritten",
				keepWorkingAfterPrompt: true,
				timeoutMs: 10000,
				postPromptDialogScreen: SCREEN_CODEX_TRUST,
				dialogIntervalSec: 1,
				agentSession: {
					kind: "id",
					value: fullSid,
					source: "herdr:codex",
				},
			});
			expect(workingDialogRes.status).toBe(5);
			expect(workingDialogRes.stderr).toContain(
				"DIALOG gjc-herdr-critic w-test:p-critic codex-trust Trust this folder? (1. Trust and continue / 2. Back to Agent Command Center)",
			);
			expect(workingDialogRes.stderr).toContain(
				"확인창 감지. 대화상자에 응답하지 않습니다.",
			);
			expect(workingDialogRes.reportArgvCalls).toHaveLength(0);
			expect(workingDialogRes.calls).toContain(
				"agent read gjc-herdr-critic --source visible",
			);
			expect(workingDialogRes.readStatuses).toEqual(["working"]);

			// (f) idle인데 확인창 감지 -> 결과 파일 없음(rc 4)이 아니라 rc 5, 보고 0회
			const idleDialogRes = runCriticSend({
				focused: false,
				screen: FRESH_SCREEN,
				noWait: false,
				resultMode: "unwritten",
				postPromptDialogScreen: SCREEN_CODEX_TRUST,
				dialogIntervalSec: 1,
				agentSession: {
					kind: "id",
					value: fullSid,
					source: "herdr:codex",
				},
			});
			expect(idleDialogRes.status).toBe(5);
			expect(idleDialogRes.stderr).toContain(
				"DIALOG gjc-herdr-critic w-test:p-critic codex-trust Trust this folder? (1. Trust and continue / 2. Back to Agent Command Center)",
			);
			expect(idleDialogRes.stderr).toContain(
				"확인창 감지. 대화상자에 응답하지 않습니다.",
			);
			expect(idleDialogRes.reportArgvCalls).toHaveLength(0);
			expect(idleDialogRes.readStatuses).toEqual(["idle"]);

			// (g) 확인창 없는 정상 흐름 및 범위 밖 간격(0, 3601, 아주 긴 수 -> 기본값 15) -> 기존 기대값(rc 0, reported 1회) 그대로
			for (const intervalVal of [1, "0", "3601", "9999999999999999999999999"]) {
				const normalRes = runCriticSend({
					focused: false,
					screen: FRESH_SCREEN,
					noWait: false,
					resultMode: "written",
					waitWorkingPolls: 4,
					dialogIntervalSec: intervalVal,
					agentSession: {
						kind: "id",
						value: fullSid,
						source: "herdr:codex",
					},
				});
				expect(normalRes.status).toBe(0);
				expect(normalRes.stderr.trim()).toBe("gjc-herdr-critic reported critic-d");
				expect(normalRes.reportArgvCalls).toHaveLength(1);
			}

			// 범위 밖 간격(아주 긴 수)일 때 기본값(15초)으로 폴백되어, 1초 working 구간에서는 agent read를 부르지 않고 idle 직전에만 1회 부름
			const fallbackIntervalRes = runCriticSend({
				focused: false,
				screen: FRESH_SCREEN,
				noWait: false,
				resultMode: "written",
				waitWorkingPolls: 4,
				dialogIntervalSec: "9999999999999999999999999",
				agentSession: {
					kind: "id",
					value: fullSid,
					source: "herdr:codex",
				},
			});
			expect(fallbackIntervalRes.status).toBe(0);
			expect(fallbackIntervalRes.readStatuses).toEqual(["idle"]);
		},
		60_000,
	);
});
