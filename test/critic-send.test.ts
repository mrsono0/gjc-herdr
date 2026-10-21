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

interface RunCriticSendOptions {
	focused: boolean;
	screen: string;
	agentStatus?: string;
	interactiveReady?: boolean;
	prePromptWorkingOnce?: boolean;
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
			},
		},
	});
}

function runCriticSend(options: RunCriticSendOptions): {
	status: number | null;
	stdout: string;
	stderr: string;
	calls: string[];
} {
	const tmpDir = fs.mkdtempSync("/tmp/gjch-t-critic-send-");
	try {
		const logPath = path.join(tmpDir, "herdr-calls.log");
		const screenPath = path.join(tmpDir, "screen.ansi");
		const newTypedScreenPath = path.join(tmpDir, "screen-new-typed.ansi");
		const freshScreenPath = path.join(tmpDir, "screen-fresh.ansi");
		const agentInitialPath = path.join(tmpDir, "agent-initial.json");
		const agentWorkingPath = path.join(tmpDir, "agent-working.json");
		const agentReadyPath = path.join(tmpDir, "agent-ready.json");
		const enterSentPath = path.join(tmpDir, "enter-sent");
		const postEnterGetsPath = path.join(tmpDir, "post-enter-gets");
		const prePromptWorkingUsedPath = path.join(tmpDir, "pre-prompt-working-used");
		const briefPath = path.join(tmpDir, "brief.md");
		const lockPath = path.join(tmpDir, "lead.json");
		const herdrBin = path.join(tmpDir, "herdr");

		const workspaceId = "w-test";
		const leadPaneId = "w-test:p-lead";
		const criticPaneId = "w-test:p-critic";
		const criticName = "gjc-herdr-critic";

		fs.writeFileSync(screenPath, options.screen, "utf8");
		fs.writeFileSync(newTypedScreenPath, NEW_TYPED_SCREEN, "utf8");
		fs.writeFileSync(freshScreenPath, FRESH_SCREEN, "utf8");
		fs.writeFileSync(briefPath, "# 검토 지시서\n내용 확인\n", "utf8");

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

case "$1 $2" in
	"agent get")
		target="\${3:-}"
		if [ "$target" != "$CRITIC_NAME" ] && [ "$target" != "$CRITIC_PANE" ]; then
			printf 'unexpected agent get target: %s\\n' "$target" >&2
			exit 1
		fi
		if [ -f "$ENTER_SENT" ]; then
			if [ "$target" = "$CRITIC_PANE" ]; then
				count=0
				[ -f "$POST_GETS" ] && count="$(cat "$POST_GETS")"
				count=$((count + 1))
				printf '%s' "$count" > "$POST_GETS"
				if [ "$count" -eq 1 ]; then
					cat "$AGENT_WORK"
				else
					cat "$AGENT_READY"
				fi
				exit 0
			fi
			if [ "$PRE_WORK_ONCE" = "1" ] && [ ! -f "$PRE_WORK_USED" ]; then
				: > "$PRE_WORK_USED"
				cat "$AGENT_WORK"
				exit 0
			fi
			cat "$AGENT_READY"
			exit 0
		fi
		cat "$AGENT_INIT"
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
esac
printf 'unexpected herdr command: %s\\n' "$*" >&2
exit 1
`;
		fs.writeFileSync(herdrBin, fakeHerdrScript, "utf8");
		fs.chmodSync(herdrBin, 0o755);

		if (REAL_PYTHON3) {
			fs.symlinkSync(REAL_PYTHON3, path.join(tmpDir, "python3"));
		}

		const proc = spawnSync("/bin/bash", [CRITIC_SEND_SH, "--no-wait", briefPath], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${tmpDir}:${process.env.PATH ?? ""}`,
				PYTHONNOUSERSITE: "1",
				HERDR_ENV: "1",
				HERDR_WORKSPACE_ID: workspaceId,
				HERDR_PANE_ID: leadPaneId,
				GJCH_LEAD_LOCK: lockPath,
				GJCH_CRITIC_NAME: criticName,
				CLAUDE_CODE_SESSION_ID: "",
				CLAUDE_CODE_MESSAGING_SOCKET: "",
			},
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
});
