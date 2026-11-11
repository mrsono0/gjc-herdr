import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = fs.realpathSync(path.resolve(import.meta.dir, ".."));
const TEAM_UP_SH = path.join(REPO_ROOT, "scripts", "team-up.sh");
const TEAM_ARGS_SH = path.join(REPO_ROOT, "scripts", "team-args.sh");
const CORE_TEAM_SH = path.join(REPO_ROOT, "scripts", "core-team.sh");

const EXPECTED_AGY_STDOUT = [
	"--model gemini-4-argon-high",
	"--mode accept-edits",
	"--sandbox",
	"",
].join("\n");

const EXPECTED_CODEX_STDOUT = [
	"--no-daemon",
	"--yolo",
	"-m gpt-6.1-sol",
	`-C ${REPO_ROOT}`,
	"--disable worktrees",
	'-c tui.status_line=["context-remaining","total-input-tokens","total-output-tokens"]',
	"-c project_doc_max_bytes=65536",
	"",
].join("\n");

const STRIPPED_KEYS = [
	"GJCH_CORE",
	"GJCH_LEAD_NAME",
	"GJCH_DEPUTY_NAME",
	"GJCH_MATE_NAME",
	"GJCH_CRITIC_NAME",
	"GJCH_MATE_MODEL",
	"GJCH_CODEX_MODEL",
	"GJCH_CODEX_DOC_MAX_BYTES",
	"GJCH_WS_LABEL",
	"GJCH_RETRIES",
] as const;

function cleanEnv(overrides?: Record<string, string | undefined>): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	for (const k of STRIPPED_KEYS) {
		delete env[k];
	}
	return {
		...env,
		...overrides,
	};
}

describe("team-args.sh 분리 전후 동치 검증 (#86 2a)", () => {
	let tmpDir = "";

	beforeAll(() => {
		const raw = fs.mkdtempSync("/tmp/gjch-t-core-team-");
		tmpDir = fs.realpathSync(raw);
	});

	afterAll(() => {
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("1. team-up.sh --print-expected-units agy/codex 출력이 분리 전 고정 문자열과 완전히 동일함", () => {
		const agyRes = spawnSync("/bin/bash", [TEAM_UP_SH, "--print-expected-units", "agy"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: cleanEnv(),
		});
		expect(agyRes.status).toBe(0);
		expect(agyRes.stdout).toBe(EXPECTED_AGY_STDOUT);
		expect(agyRes.stderr).toBe("");

		const codexRes = spawnSync(
			"/bin/bash",
			[TEAM_UP_SH, "--print-expected-units", "codex"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: cleanEnv(),
			},
		);
		expect(codexRes.status).toBe(0);
		expect(codexRes.stdout).toBe(EXPECTED_CODEX_STDOUT);
		expect(codexRes.stderr).toBe("");
	});

	test("2. GJCH_CORE=1 상태에서도 team-up.sh와 core-team.sh의 --print-expected-units 출력이 동일함", () => {
		const upAgy = spawnSync("/bin/bash", [TEAM_UP_SH, "--print-expected-units", "agy"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: cleanEnv({ GJCH_CORE: "1" }),
		});
		expect(upAgy.status).toBe(0);
		expect(upAgy.stdout).toBe(EXPECTED_AGY_STDOUT);

		const coreAgy = spawnSync(
			"/bin/bash",
			[CORE_TEAM_SH, "--print-expected-units", "agy"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: cleanEnv({ GJCH_CORE: "1" }),
			},
		);
		expect(coreAgy.status).toBe(0);
		expect(coreAgy.stdout).toBe(EXPECTED_AGY_STDOUT);

		const coreCodex = spawnSync(
			"/bin/bash",
			[CORE_TEAM_SH, "--print-expected-units", "codex"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: cleanEnv({ GJCH_CORE: "1" }),
			},
		);
		expect(coreCodex.status).toBe(0);
		expect(coreCodex.stdout).toBe(EXPECTED_CODEX_STDOUT);
	});

	test("3. 환경변수 오버라이드 및 GJCH_CODEX_DOC_MAX_BYTES 유효성 폴백 동작 유지", () => {
		const customRes = spawnSync(
			"/bin/bash",
			[TEAM_UP_SH, "--print-expected-units", "codex"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: cleanEnv({
					GJCH_CODEX_MODEL: "gpt-custom-model",
					GJCH_CODEX_DOC_MAX_BYTES: "131072",
				}),
			},
		);
		expect(customRes.status).toBe(0);
		expect(customRes.stdout).toContain("-m gpt-custom-model\n");
		expect(customRes.stdout).toContain("-c project_doc_max_bytes=131072\n");

		const invalidBytesRes = spawnSync(
			"/bin/bash",
			[TEAM_UP_SH, "--print-expected-units", "codex"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: cleanEnv({
					GJCH_CODEX_DOC_MAX_BYTES: "0123",
				}),
			},
		);
		expect(invalidBytesRes.status).toBe(0);
		expect(invalidBytesRes.stdout).toContain("-c project_doc_max_bytes=65536\n");
	});

	test("4. team-args.sh는 정의 전용이며 source 시 부수효과(출력·종료)가 없고 알 수 없는 인자는 rc 1", () => {
		const srcRes = spawnSync(
			"/bin/bash",
			[
				"-c",
				`. ${JSON.stringify(TEAM_ARGS_SH)} && printf '%s|%s|%s\\n' "$LEAD_NAME" "$MATE_NAME" "$CRITIC_NAME"`,
			],
			{
				cwd: tmpDir,
				encoding: "utf8",
				env: cleanEnv(),
			},
		);
		expect(srcRes.status).toBe(0);
		expect(srcRes.stdout).toBe("gjc-herdr-lead|gjc-herdr-mate|gjc-herdr-critic\n");
		expect(srcRes.stderr).toBe("");

		const badRes = spawnSync(
			"/bin/bash",
			[TEAM_UP_SH, "--print-expected-units", "invalid-kind"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
				env: cleanEnv(),
			},
		);
		expect(badRes.status).toBe(1);
	});
});
