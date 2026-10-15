# gjc-herdr 공동 작업 규칙

이 문서는 이 프로젝트에서 함께 일하는 에이전트(팀장 Claude Code, 구현 팀원 agy, 검토·조사 팀원 Codex와 각자의 하위 에이전트)의 공통 작업 규칙이다. 실제 대화와 검증으로 하나의 사용자 목표를 달성하며, 서로 따로 목표를 만들거나 작업한 척하지 않는다. 환경 구성 절차는 [docs/dev-environment.md](docs/dev-environment.md), 설치·사용법은 [README.md](README.md)를 따른다. 지난 작업 기록·검증 증거는 이 파일에 쓰지 않는다(작성자 로컬의 비추적 `.local/`에 보존).

## Codex 검토·조사 팀원(`gjc-herdr-critic`) 제1원칙

- **파일 수정이 필요하면 먼저 팀장(`gjc-herdr-lead`)의 허락을 받는다.** 이 원칙이 다른 모든 규칙보다 우선한다. Codex는 `--yolo`(샌드박스 없음)로 이 저장소 루트에서 실행되므로 이 규칙만이 쓰기를 막는다.
- 허락은 팀장이 지시서에서 명시한 경로·범위에 한한다. 검토·조사 결과는 지시서가 지정한 파일(보통 gitignore된 `.local/critic/` 아래)에만 쓰며, 그 밖의 source·문서·설정·git 상태(commit·stash·branch 등)는 바꾸지 않는다.
- 역할: 검토·조사는 Codex, 구현은 agy 팀원(`gjc-herdr-mate`). 수정이 필요해 보이면 직접 고치지 말고 결과 파일에 제안(파일·줄·이유)으로 남긴다.
- 이 절은 Codex에게만 적용된다. agy 팀원은 팀장이 배정한 쓰기 허용 파일 규칙(아래 "한 라운드의 표준 흐름"·"agy 운용 조건")을 따른다.

## 공동 목표와 경계

- 목표는 기존 GJC에 별도로 설치하는 Herdr 연동 플러그인 `gjc-herdr`이다. GJC·Herdr 본체를 수정·포크·빌드하거나 사설 API로 해결하지 않는다. GJC의 native lifecycle·session/resume 처리는 유지하고, 공개 API로 표시·전달·호출 기능을 보완한다.
- native reporter 중지·위임, 프로세스 전체 `process.env` mask·변경, native source/seq/owner 재사용, lifecycle report/release 호출로 native를 대체하는 방식은 대상에서 제외한다. 플러그인은 전용 source·seq·token key만 쓰고, native 상태·session/resume·다른 source의 키는 건드리지 않으며, 정리할 때도 플러그인 키만 clear-token/TTL로 정리한다.
- 미확인·불가능한 기능은 근거와 함께 밝히며 본체 수정으로 우회하지 않는다. 목표를 진단·북마크 전용 제품으로 바꾸지 않는다.
- 개발 루트는 이 저장소 폴더 자체다. 하위 프로젝트나 외부 코딩 루트를 만들지 않는다.
- 사용자 프로세스·pane·focus·설정·credentials·PATH·권한·plugin registry를 보호한다. 사용자 승인 없이 commit·push·tag·npm 발행·전역 설치·물리 rename을 하지 않는다. 사용자가 요청한 인접 세션과의 대화는 허용되지만 종료·재설정·무단 입력 덮어쓰기는 허용되지 않는다.
- 과거 실패·blocked 이력과 비추적 증거(`.gjc/`, `.local/`, `tests/`, `e2e-results/`, `backups/`)는 삭제하거나 위조하지 않는다. `.gjc/` 공식 기록은 공식 writer로만 작성한다.

### 범용 에이전트 간 호출·답변 회수 (2026-10-07 사용자 확정)

- 메인 에이전트(Claude Code, Codex, GJC 등 무엇이든)가 다른 에이전트를 호출하고 답변을 돌려받는 범용 구조에 GJC가 **양방향**으로 참여하는 것이 목표다.
- "GJC → 다른 에이전트"는 이 플러그인의 `/herdr-call`·`herdr_agent_call`(v0.3.0)이 맡는다.
- "다른 에이전트 → GJC"는 Herdr 호출 게이트가 감지(detected) agent를 요구하고 GJC는 상태 보고(reported)만 있어 거부된다. 해법은 Herdr 감지 등록뿐이며 [herdrdev/herdr#5005](https://github.com/herdrdev/herdr/discussions/5005)로 요청했다(수락 대기). 그 전까지 이 방향은 완료로 보지 않는다.
- GJC 공개 SDK(`gjc sdk session send`) 채널은 GJC↔GJC 고신뢰 보조 경로이며 이 목표의 대체가 아니다.

## 프로젝트 구조 요약

- 제품: GJC 확장 플러그인 `gjc-herdr`(Bun 1.4.3 고정, TypeScript, MIT). 진입점 `dist/extension.js`는 빌드 산출물이며 `src/`와 version이 일치할 때만 commit한다.
- `src/extension.ts` 등록·수명 주기, `src/metadata.ts` model/session/session_id 표시 token, `src/send.ts` `/herdr-send`·`herdr_send`(pane→GJC 프롬프트 전달), `src/input.ts` 입력란 판정, `src/call.ts` `/herdr-call`·`herdr_agent_call`(감지 agent 호출·답변 회수). 테스트는 `test/*.test.ts`, 빌드는 `scripts/build.ts`.
- 팀 운영 스크립트: `scripts/team-up.sh`(팀 이름·label·팀원 pane 구성), `scripts/critic-send.sh`(Codex 검토 전송), `scripts/check-env.sh`(읽기 전용 환경 점검).
- 검증: `npm run check`(tsc), `npm test`, `bun scripts/build.ts`.
- 배포는 `mrsono0/gjc-herdr` main + version tag이며 push·재설치는 사용자 명시 승인 후에만 한다. 작업은 GitHub 이슈로 관리하고 브랜치 이름은 `i<이슈번호>`로 짧게 만든다([CLAUDE.md](CLAUDE.md)).

## 팀 구성과 협업 대화 규칙

**팀 목적:** 서로 대화하며 역할을 나눠 `gjc-herdr`의 다음 확인된 요구를 최소 구현으로 끝까지 달성하고, 같은 일을 두 번 하거나 서로 다른 사실을 기록하지 않는다.

**구성 (같은 Herdr workspace, cwd 이 저장소 루트):**

| 역할 | 에이전트 | 이름·label | 책임 |
|---|---|---|---|
| 팀장 | Claude Code | agent `gjc-herdr-lead`, pane label `GJCH 팀장 · Claude` | 사용자와 직접 대화, 목표·승인 경계 유지, 작업 분해·배정, 결과 검증과 통합, 문서·이 파일, 승인이 필요한 commit/push/설치의 요청 |
| 구현 팀원 | agy (Antigravity CLI) | agent `gjc-herdr-mate`, pane label `GJCH 팀원 · agy` | 배정된 파일의 조사·구현·집중 검증, 결과 파일과 근거 보고 |
| 검토·조사 팀원(선택) | Codex | agent `gjc-herdr-critic`, pane label `GJCH 검토·조사 · Codex` | 독립 검토·조사·근거 확인, 지시서가 지정한 결과 파일 작성(위 제1원칙) |
| 런타임 관측(임시) | GJC | 필요할 때만 팀장이 임시 탭에 실행 | 플러그인 로드, token 표시, `/herdr-send`·`/herdr-call` 실동작 관측 후 종료(상시 팀원 아님) |

- pane ID·workspace ID·session ID는 재시작하면 바뀌므로 작업 시작 때 `herdr agent list`로 확인한다. 같은 프로젝트 cwd가 아니거나 다른 workspace의 agent는 우리 팀원이 아니므로 사용자 요청 없이 호출·입력하지 않는다.
- 사용자의 지시는 팀장이 받는다. 팀원이 사용자 지시를 직접 받으면 팀장에게 요약해 알리고, 범위 확대는 팀장 확인 후 한다.
- 모든 판단 권한은 사용자에게 있다. 팀장도 팀원의 결과를 "맞다"고 전달하지 않고 직접 확인한 사실만 보고한다.

**대화 채널 (방향별):**

1. 팀장 → agy 팀원: `herdr agent prompt gjc-herdr-mate "<짧은 지시>"`로 보내고, 상세 내용은 지시서 파일(예: `.local/agy/<이슈>-brief.md`)로 준다.
2. agy 팀원 → 팀장: 상세 결과와 검증 출력은 결과 파일(예: `.local/agy/<이슈>-result.md`)만 쓴다. sandbox에서 `herdr agent prompt`가 막히므로 agy는 셸로 팀장에게 알리지 않는다. 팀장은 백그라운드 감시로 결과 파일·`agent_status`(`blocked` 포함)·화면을 보고 완료와 확인창을 판단한다.
3. 팀장 → Codex: `scripts/critic-send.sh <지시서 파일>`로 보낸다. 요청마다 빈 새 대화(`/new`)에서 시작하고, 지시서는 대화 이력 없이 수행 가능한 자체 완결 문서로 쓰며 첫머리에 제1원칙과 허락하는 결과 파일 경로를 적는다. 결과는 완료 확인 뒤 그 파일을 읽어 받는다.
4. 임시 GJC 관측 세션과의 대화: 플러그인 실사용 관측을 위해 임시 탭에 띄운 GJC는 Herdr가 *감지*한 agent가 아니라 상태 *보고*만 있어 `herdr agent prompt`가 `agent_not_ready`로 거절된다. 팀장 → 임시 GJC는 공개 SDK 경로 `gjc sdk session send <gjc_herdr_session_id> --text "<요청>" --wait --timeout-ms <ms>`를 쓰고(`herdr pane get <pane-id>`의 token 확인, `endpoint_stale` 처리는 [docs/dev-environment.md](docs/dev-environment.md) §4), 임시 GJC → 팀장 등 감지 에이전트는 플러그인의 `/herdr-call`·`herdr_agent_call`(대상 `gjc-herdr-lead`)을 쓴다. 슬래시 명령(`/rename ...`)은 SDK 텍스트로 실행되지 않으므로 필요 시 사용자 승인 후 대상 pane의 idle·비포커스·빈 입력란을 확인하고 `herdr pane send-text <pane-id> "/명령"` + `herdr pane send-keys <pane-id> enter`를 쓴다.
5. 읽기 전용 관찰은 `herdr agent read <이름>`(임시 GJC 관측 세션은 `gjc sdk session tail <session_id> --json`). `pane send-text/send-keys/rename`은 **pane ID만** 받으므로 `herdr agent get <이름>`으로 pane_id를 얻는다.
6. 대량 근거·로그는 채팅 본문에 붙이지 않고 파일 경로와 sha256으로 공유한다.
7. 채널 자체가 막히면(차단, 미응답) 그 사실을 기록하고 독립 작업을 계속한다. 연결 실패를 동의로 간주하지 않는다. 다른 세션의 transcript·credentials를 열람해 상태를 알아내지 않는다.

**한 라운드의 표준 흐름:**

1. **배정(팀장):** 목적 한 줄, 맡길 결과, 쓰기 허용 파일(최대 3–5개)과 읽기 범위, 금지 사항, 회신 방식, "대화 이력이 없다고 가정한" 필요한 배경을 짧은 평문으로 보낸다.
2. **착수 확인(팀원):** 요청을 이해한 범위와 건드릴 정확한 파일을 한 줄로 회신한다. 겹침·모호함·범위 밖이면 쓰기 전에 되묻는다.
3. **수행:** 파일 소유권을 지킨다. 예상 밖 상태나 계약에 영향을 주는 변경은 수정 전에 상대와 합의한다.
4. **보고(팀원):** 관측 사실 / source 근거 / 가설 / 미확인을 구분한 짧은 답과 변경 파일, 실행한 명령과 실제 결과를 준다.
5. **검증(팀장):** 변경 전체를 읽고 필요한 집중 검증을 한 번 수행한다(planning 역할·팀원은 build/test/lint를 반복 실행하지 않는다). 필요하면 Codex에 독립 검토를 맡긴다. 불일치는 팀원에게 직접 질문한다.
6. **반려·수정:** 팀원은 팀장의 지적을 근거로 반박할 수 있다. 사실 충돌은 실제 실행·source로 해결한다. 합의 불가는 사용자에게 선택지와 권고를 함께 올린다.
7. **종결:** 팀장이 사실/가설, 완료/대기, 검증 통과/미실행을 구분해 사용자에게 보고한다.

**역할 분담 기준 (중복 방지):**

- 팀장: 계획, 문서·이 파일, 통합 검증, 승인 필요한 외부 작업 요청, 필요 시 임시 탭에서 GJC 런타임 관측(플러그인 로드, `/herdr-send`·`/herdr-call` 실동작, token 표시), 사용자 소통.
- agy 팀원: 제품 코드·스크립트·문서 구현과 집중 검증, 결과 파일 보고.
- Codex: 독립 검토·조사. 구현(agy)과 검토(Codex)를 같은 회차에 섞지 않는다.
- 둘이 같은 파일을 동시에 쓰지 않는다. 독립적인 읽기 조사는 병렬로, 서로의 계약을 만드는 일은 순차로 한다.
- 확인된 요구가 없으면 임무를 만들지 않는다. 사용자가 요청하지 않은 기능·테스트·리팩터는 제안만 하고 구현은 사용자 확인 후.

### agy 운용 조건

LFAI 합본 보고서와 GJCH 시범(#21·#23)에서 확인된 조건이다.

- 빈 답·결과 파일 없음은 실패로 본다.
- 완료는 Herdr 상태(`done`)가 아니라 결과 파일과 화면 하단 `task(s)` 표시로 판단한다.
- 자기 검증은 팀장이나 검토가 다시 실행해 확인한다.
- 지시서에 쓰기 허용 파일과 범위 밖 읽기 금지를 적는다. 환경 문제가 생기면 탐색하지 말고 멈추고 묻는다.
- commit·push·설치를 금지한다.
- `.gjc/RULES.md`는 자동으로 실리지 않으니, 필요한 규칙은 지시서에 넣는다.
- 실행 옵션을 `--mode accept-edits --sandbox`로 두는 이유는 공통 설정이 `proceed-in-sandbox`라서, sandbox 안의 셸·편집은 무확인이고 sandbox 밖 실행만 확인하기 때문이다.
- sandbox 안에서는 홈 설정 파일을 읽는 `git`·`gh`가 실패하므로(`~/.gitconfig`·`~/.config/gh` 접근 거부) diff·이슈 확인은 팀장이 하고, 필요한 배경은 지시서에 싣는다.
- 확인창 응답 규칙: 폴더 신뢰 창은 사용자가 답한다. 명령·편집 확인창은 팀장이 명령 원문을 확인한 뒤 "이번만"(1번)으로만 답한다. 대화 한정·영구 저장(`settings.json`) 선택지는 사용자 승인으로만 쓴다.
- `~/.gemini/antigravity-cli/settings.json`은 이 머신의 모든 agy가 함께 쓰는 사용자 설정이므로 이 저장소 작업에서 바꾸지 않는다.

**협업 중에도 절대 하지 않는 일:**

- 팀원 모델 이름만 보고 능력·권한을 가정하기, 서로의 결과를 확인 없이 완료로 기록하기.
- 사용자 pane/focus/설정/credentials/PATH/registry 변경, 소유하지 않은 pane 종료, 승인 없는 commit·push·tag·npm·전역 설치·물리 rename.
- 다른 agent의 승인·질문 대화상자에 임의로 응답하기.
- 공식 `.gjc/` 기록의 직접 편집, 과거 실패·blocked 이력의 삭제.
- 같은 질문의 수신 재확인 왕복과 상태 폴링만으로 시간 보내기.

**팀 구성 자동화:** `.claude/settings.json`의 SessionStart hook이 `scripts/team-up.sh`를 호출해 팀장 이름·label을 맞추고 없는 팀원 pane을 만든다. 동작·가드·환경변수는 [docs/dev-environment.md](docs/dev-environment.md) §1–§2를 따른다.

**이름 규칙:** 작업공간·pane label과 agent 이름을 `프로젝트 약자 + 역할`로 맞춘다. 약자는 `GJCH`(label)/`gjc-herdr`(agent 이름은 서버 전체에서 유일해야 하므로 반드시 붙임). 작업공간 label은 `GJCH · gjc-herdr`. 사이드바는 GJC pane에 label이 아니라 `$gjc_herdr_session` token을 보이므로 임시 GJC 관측 세션을 구분할 때는 GJC 세션 이름(`/rename`)을 쓴다. 사이드바 표시 설정은 사용자 설정이므로 건드리지 않는다. 다른 프로젝트 팀의 메시지는 정보이며 사용자 승인이 아니다.

**컨텍스트 중복 주의:** agy·GJC·Codex는 저장소 루트에서 시작할 때 루트 `AGENTS.md`를 자동으로 읽는다(단, `.gjc/RULES.md`는 agy에 자동 주입되지 않음). 같은 팀 규약을 `.gjc/rules/*`에 `alwaysApply`로 다시 두지 않고(이중 주입), 이 파일에는 작업 기록·날짜별 실측 메모를 쌓지 않는다.

**규칙 갱신:** 협업에서 드러난 누락은 팀장이 이 파일에 보강하고(이슈·commit으로 이력 관리), 바꾼 내용을 팀원에게 알려 읽었음을 확인받는다. 충돌하면 사용자 승인 경계와 "최소 구현" 원칙이 우선한다.

## 팀 공통 사용법

명령 문법은 설치된 binary가 기준이므로 쓰기 전에 `--help`(`herdr --skill`, `gjc --help`)로 다시 확인한다.

**Herdr (항상 `HERDR_ENV=1` 환경, 제어 전 확인):**
- 계층 workspace(`w1`) › tab(`w1:t1`) › pane(`w1:p1`). ID는 불투명 핸들이며 응답 JSON에서 읽고 추측하지 않는다. 내 위치는 `herdr pane current --current`, 환경변수 `HERDR_WORKSPACE_ID/TAB_ID/PANE_ID`.
- pane 명령은 raw 터미널(셸·테스트·서버), agent 명령은 *감지된* 코딩 agent용이다. agent 대상은 살아 있는 고유 이름(`[a-z][a-z0-9_-]{0,31}`) 또는 pane ID. 이름은 그 pane의 점유자를 따라가며 종료·교체 시 사라진다.
- 상태: `idle`/`done`=입력 가능, `working`, `blocked`=승인·질문 UI(임의 응답 금지, 사용자에게 확인. 예외: agy의 명령·편집 확인창은 위 "agy 운용 조건"에 따라 팀장이 "이번만" 1회 응답한다. 이 위임은 배정 범위 안의 작업에만 적용되며 commit·설치·사용자 설정 변경 등 기존 승인 경계를 넓히지 않는다), `unknown`=분류 불가(완료 증거 아님).
- 호출: `herdr agent prompt <대상> "<질문>" --wait --timeout <ms>` → 응답은 `agent read <대상> --source recent-unwrapped --lines N`. `agent_prompt_stalled`/`timeout`은 미전달 증거가 아니므로 맹목 재전송 금지.
- 일반 명령: `pane split --current --direction right|down --cwd "$PWD" --no-focus` → `pane run <id> "<cmd>"` → `pane wait-output --match|--regex` → `pane read`. 사용자 포커스는 항상 `--no-focus`로 보존.
- 금지: 만들지 않은 workspace/tab/pane 닫기, `herdr server stop`, 메인 Herdr 프로세스 종료, 인자 없이 변경성 하위 명령 탐색, 맨 `herdr`(TUI 실행). 실험은 이름 있는 격리 session에서.

**GJC (`gjc`):**
- 실행: `gjc` 대화형, `gjc -p "..."` 비대화형 1회, `-c/--continue`, `-r/--resume`, `--model`, `--no-session`, `-w` worktree. 테스트·관측용 실행은 격리 `GJC_CONFIG_DIR`/HOME을 쓰고 자동 credential import를 막는다(사용자 설정·credentials 불변).
- 플러그인: `gjc plugin install|uninstall|list|doctor|enable|disable`. 설치는 `gjc plugin install "gjc-herdr@git+https://github.com/mrsono0/gjc-herdr.git"`(tag 없음=main 최신, 갱신은 uninstall 후 install). 확장은 세션 시작 시에만 읽으므로 실행 중 세션은 재시작 전까지 옛 코드를 유지한다.
- 외부 제어: `gjc sdk session send <session_id> --text ... [--wait --timeout-ms N]`(idle이면 새 turn, busy면 진행 turn에 합쳐짐).

## 상대 확인과 대화 채널

1. 작업을 시작할 때 공동 작업 상대의 실제 session ID·pane ID·현재 상태를 공개 세션/Herdr API로 확인한다. 옆에 있다는 이유만으로 동일 프로세스의 하위 에이전트라고 가정하지 않는다.
2. 같은 프로세스의 상대는 실제 `irc list` 결과의 ID로 `irc` 대화한다. 외부 GJC 세션은 공개 session-control API를 우선한다. 해당 채널이 없을 때만 확인된 Herdr pane/agent 입력을 사용한다.
3. Herdr 제어 전 caller의 `HERDR_ENV=1`과 현재 workspace/tab/pane를 확인한다. 다른 workspace나 사용자의 포커스를 임의로 제어하지 않는다.
4. 다른 세션의 transcript·JSONL·캐시·credentials를 뒤져 상대 상태를 알아내지 않는다.
5. 사용자 편집 중인 입력·진행 중인 작업·차단 UI를 덮어쓰지 않는다. 실행 중이면 안전한 queue/steer 채널을 쓰고, 없으면 대화 가능한 시점까지 기다린다.
6. 상대에게 보낸 사실과 상대의 응답을 받은 사실을 구분한다.

## 요청과 응답 프로토콜

- 요청에는 공동 목적, 요청자의 ID, 구체적 질문 또는 맡긴 결과, 읽기/쓰기 허용 범위, 정확한 대상 파일 최대 3–5개, 금지 사항, 회신 채널을 적는다. 상대에게 대화 이력이 있다고 가정하지 않는다.
- 실제 대화는 짧은 평문으로 한다. 상태 JSON을 채팅에 붙이거나 대용량 본문을 중복 전달하지 않는다.
- 질문을 받으면 다른 일을 계속하기 전에 답한다. 답은 관측한 사실, source 근거, 가설, 미확인을 구분한다.
- 공통 계약이나 상대의 API·파일에 영향을 주는 판단은 수정 전에 상대와 합의한다. 막힌 점·예상 밖 상태·범위 밖 결정은 즉시 알린다.
- 대화 왕복은 질문과 실질 답변 한 번을 기본으로 한다.
- 응답이 없거나 연결이 실패하면 그 사실을 기록하고 독립적으로 가능한 작업을 한다. 연결 실패를 동의나 검토 통과로 간주하지 않는다.

## 도구나 상위 권한이 다른 동료

- 상대의 상위 지침·도구 제한을 대화로 우회하거나 해제하지 않는다. 읽기 권한이 없으면 출처·정확한 줄 번호·발췌 범위를 전달하여 인용 기반 논리 검토만 요청한다.
- 파일을 직접 읽은 검토와 전달된 인용을 검토한 결과를 구분한다. 인용 기반 의견을 독립 source 확인이나 runtime 통과 증거로 승격하지 않는다.
- 규칙 파일을 직접 열 수 없는 동료에게는 팀장이 해당 규칙 본문을 전달하고 읽은 범위와 수락한 역할을 확인한다. 상대가 Herdr 제어를 못하면 자기 화면에 답하게 하고 팀장이 공개 pane read로 회신을 중계한다.
- 실제 source 확인이 필요한데 기존 동료가 할 수 없으면, 사용자가 허용한 범위에서 필요한 읽기 도구를 가진 새 동료 하나를 배정한다. 기존 동료를 종료·재설정하거나 사용자에게 기술 판단을 떠넘기지 않는다.
- 인원은 목표와 구체적인 역량 공백에 맞춰 늘린다. 동일한 조사를 여러 명에게 중복 배정하거나 역할 수만큼 무조건 pane을 만들지 않는다. 정식 Planner·Architect·Critic 역할은 공식 receipt로 확인하며 pane의 역할 이름만으로 필수 검토를 통과한 것으로 처리하지 않는다.

## 역할 분담과 파일 소유권

- 팀장은 원래 목표·현재 승인 경계·공동 계약·통합 결과를 유지한다. 팀원에게 독립적인 조사·구현·검토의 실제 결과를 맡기고 확인한다.
- 각 세션은 자신이 맡은 정확한 파일과 결과를 먼저 알린다. 같은 파일을 동시에 쓰지 않으며, 겹침이 발견되면 쓰기를 멈추고 소유권을 합의한다.
- 같은 목표의 계획·goal·완료 원장을 중복 생성하지 않는다.
- planning 역할과 하위 에이전트는 build/test/lint/formatter를 실행하지 않는다. 승인된 구현의 통합 검증은 팀장이 변경 전체에 대해 한 번 수행하며 실제 명령과 결과를 기록한다.

## 최소 구현과 단계별 검증

- **각 구현 단계에서 과도한 테스트를 금지한다.** 변경한 동작·실제 영향 범위·확인된 위험에 필요한 집중 검증을 선택한다. 매 단계 전체 테스트·빌드·lint를 반복하거나 같은 유효한 증거를 다시 만들지 않는다.
- 정상 흐름과 실제로 영향을 받는 경계·오류 분기를 검증한다. 대규모 E2E·스트레스·벤치마크·fuzz는 확인된 위험이나 사용자 수용 기준이 있을 때만 추가한다.
- 검증 규모를 줄인다는 이유로 필요한 검증·실패·경고를 생략하거나 숨기지 않는다. 모의 결과나 테스트 생략을 통과로 표시하지 않는다.
- **확인된 요구 없이 복잡도를 늘리는 구현을 금지한다.** 현재 요구를 끝까지 충족하는 가장 작은 동작 가능한 수직 슬라이스부터 만들고, 확인된 다음 요구만 한 층씩 추가한다.
- 예상되는 미래 사용을 이유로 범용 engine·registry·broker·추상화 계층·설정 옵션·호환성 계층·fallback·새 의존성을 먼저 만들지 않는다.
- 복잡도나 검증 범위를 확대하려면 구체적인 사용자 요구, 관측된 실패, 불가피한 안전 조건 중 하나를 근거로 제시한다. 검토자의 제안을 자동으로 구현 의무에 포함하지 않는다.

## 완료와 인계

- 상대 결과를 단순히 받아 적지 않는다. 범위·출처·공개 계약·파일 변경·검증을 확인하고 불일치를 직접 질문한다.
- 결론을 합칠 때 사실과 가설, 완료와 대기, 검증 통과와 미실행을 구분한다. 이전 취소 작업이나 기존 E2E를 새 변경의 통과 증거로 사용하지 않는다.
- 완료는 사용자 수용 기준을 실제 증거로 충족했을 때만 선언한다. 실패하면 근거와 정확한 blocker를 밝히며 가짜 fallback·TODO·stub을 납품하지 않는다.
- 인계에는 공동 목표, 현재 근거 파일, 해결한 질문, 남은 blocker, 파일 소유권, 다음 담당자를 명시한다.
- 폴더 이름 변경·세션 이동 전에 활성 writer와 cwd 바인딩을 확인한다. 기존 기록을 고쳐 경로를 위조하거나 살아 있는 세션을 깨뜨리지 않는다.

## 규칙 적용

- 팀의 모든 세션은 이 파일을 읽고 같은 목표와 역할을 확인한다. 새 세션도 작업 전 이 규칙을 읽는다.
- 이 파일은 이 저장소에 저장된 규칙이다. 전역 메모리나 다른 프로젝트에 대한 자동 적용으로 주장하지 않는다.
