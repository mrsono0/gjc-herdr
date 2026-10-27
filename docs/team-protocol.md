# gjc-herdr 팀 협업·운영 상세 규칙

이 문서는 [AGENTS.md](../AGENTS.md)의 상세 규칙 문서다. 일반 Markdown 링크만으로는 세션에 자동 주입되지 않으므로, 팀 작업·배정·검토·agent/Herdr/GJC 제어 전에 이 문서의 해당 규칙(팀 협업·도구/확인창은 전문)을 직접 읽고 따른다. 작업 기록·공유·이슈 관리는 [docs/work-records.md](work-records.md), 환경 구성은 [docs/dev-environment.md](dev-environment.md)를 따른다.

### 인터페이스 우선순위 (2026-10-17 사용자 확정)

이 플러그인을 만든 이유는, Herdr 안에서 여러 에이전트가 원활하게 소통하게 하는 것이다. 그런데 GJC는 Herdr에 감지(detected) agent로 등록되어 있지 않아 Herdr 호출 게이트가 GJC를 대상으로 받지 않는다. 플러그인은 이 제약을 공개 인터페이스로 보완한다. 그래서 기능을 만들거나 고칠 때는 다음 순서를 따른다.

1. **Herdr 표준 인터페이스가 우선이다.** 새 기능은 먼저 Herdr의 공개 CLI·소켓 API로 할 수 있는지 본다. 예: `herdr agent list/get/prompt/read/wait`, `pane read`, token, 이벤트 구독, 플러그인
2. **Herdr로 안 되는 부분만 보조한다.** GJC 공개 SDK(`gjc sdk …`)나 파일 우편함(`.gjc-herdr/mailbox`)은 Herdr 표준으로 할 수 없을 때만 쓴다. 이 경우 이슈에 "왜 Herdr 표준으로는 안 되는지"를 적는다.
3. **Herdr가 지원하게 되면 보조를 걷어낸다.** 예: [herdrdev/herdr#5005](https://github.com/herdrdev/herdr/discussions/5005)가 수락돼 GJC가 감지 agent가 되면, 보조 경로를 줄이거나 없애는 방향으로 다시 설계한다.

- 2026-10-17 현재: #5005는 열려 있고 댓글·답변이 없다. 같은 벽의 #4732, #2935도 열려 있다. `HERDR_AGENT=<agent>` 힌트는 이미 있는 manifest만 고를 수 있어서(#5311), 사용자 쪽에서 GJC 감지를 추가할 수 없다.
- 지금 기능의 위치는 다음과 같다.
  - Herdr 표준: 메타데이터 token 보고, `/herdr-send --raw`, `/herdr-call`
  - GJC 전용 보조: `/herdr-send`의 SDK 모드
  - 저장소 파일 보조: 파일 우편함. Herdr로 닿지 않는 상대(외부 팀장)와 작업 중에 넣기 위험한 보고를 위해 둔다.
- 원격 목표 환경(`docs/dev-environment.md` §0)에서도 GJC 팀원은 Herdr pane 안의 대화형 GJC로 띄우는 것을 기준으로 한다. Herdr 밖 헤드리스 GJC(`gjc sdk` 세션)는 Herdr 표준으로 다룰 수 없으므로 기준으로 삼지 않는다.

### 범용 에이전트 간 호출·답변 회수 (2026-10-07 사용자 확정)

- 메인 에이전트(Claude Code, Codex, GJC 등 무엇이든)가 다른 에이전트를 호출하고 답변을 돌려받는 범용 구조에 GJC가 **양방향**으로 참여하는 것이 목표다.
- "GJC → 다른 에이전트"는 이 플러그인의 `/herdr-call`·`herdr_agent_call`(v0.3.0)이 맡는다.
- "다른 에이전트 → GJC"는 Herdr 호출 게이트가 감지(detected) agent를 요구하고 GJC는 상태 보고(reported)만 있어 거부된다. 해법은 Herdr 감지 등록뿐이며 [herdrdev/herdr#5005](https://github.com/herdrdev/herdr/discussions/5005)로 요청했다(수락 대기). 그 전까지 이 방향은 완료로 보지 않는다.
- GJC 공개 SDK(`gjc sdk session send`) 채널은 GJC↔GJC 고신뢰 보조 경로이며 이 목표의 대체가 아니다.

## 프로젝트 구조 요약

- 제품: GJC 확장 플러그인 `gjc-herdr`(Bun 1.4.3 고정, TypeScript, MIT). 진입점 `dist/extension.js`는 빌드 산출물이며 `src/`와 version이 일치할 때만 commit한다.
- `src/extension.ts` 등록·수명 주기, `src/metadata.ts` model/session/session_id 표시 token, `src/send.ts` `/herdr-send`·`herdr_send`(pane→GJC 프롬프트 전달), `src/input.ts` 입력란 판정, `src/call.ts` `/herdr-call`·`herdr_agent_call`(감지 agent 호출·답변 회수). 테스트는 `test/*.test.ts`, 빌드는 `scripts/build.ts`.
- 팀 운영 스크립트: `scripts/team-up.sh`(팀 이름·label·팀원 pane 구성), `scripts/team-lead.sh`(팀장 잠금), `scripts/critic-send.sh`(Codex 검토 전송), `scripts/check-env.sh`(읽기 전용 환경 점검).
- 검증: `npm run check`(tsc), `npm test`, `bun scripts/build.ts`.
- 배포는 `mrsono0/gjc-herdr` main + version tag이며 push·재설치는 사용자 명시 승인 후에만 한다. 작업은 GitHub 이슈로 관리하고 브랜치 이름은 `i<이슈번호>`로 짧게 만든다([CLAUDE.md](../CLAUDE.md)).

## 팀 구성과 협업 대화 규칙

**팀 목적:** 서로 대화하며 역할을 나눠 `gjc-herdr`의 다음 확인된 요구를 최소 구현으로 끝까지 달성하고, 같은 일을 두 번 하거나 서로 다른 사실을 기록하지 않는다.

**구성 (같은 Herdr workspace, cwd 이 저장소 루트. 외부 팀장은 Herdr 밖):**

| 역할 | 에이전트 | 이름·label | 책임 |
|---|---|---|---|
| 팀장 | Claude Code | 팀장 잠금 보유자(herdr 안 `gjc-herdr-lead`, pane label `GJCH 팀장` 또는 herdr 밖 외부 팀장) | 사용자와 직접 대화, 목표·승인 경계 유지, 작업 분해·배정, 결과 검증과 통합, 문서·규칙 파일([AGENTS.md](../AGENTS.md) 및 상세 문서), 승인이 필요한 commit/push/설치의 요청 |
| 부팀장(선택, 이관 때만) | Claude Code | agent `gjc-herdr-deputy`, pane label `GJCH 부팀장 · Claude` | 관찰, 조회, 팀장 지원(세션 간 메시지). 팀원 배정과 입력, 팀 구성과 배치는 하지 않는다 |
| 구현 팀원 | agy (Antigravity CLI) | agent `gjc-herdr-mate`, pane label `GJCH 팀원 · agy` | 배정된 파일의 조사·구현·집중 검증, 결과 파일과 근거 보고 |
| 검토·조사 팀원(선택) | Codex | agent `gjc-herdr-critic`, pane label `GJCH 검토·조사 · Codex` | 독립 검토·조사·근거 확인, 지시서가 지정한 결과 파일 작성([AGENTS.md](../AGENTS.md) 제1원칙) |
| 런타임 관측(임시) | GJC | 필요할 때만 팀장이 임시 탭에 실행 | 플러그인 로드, token 표시, `/herdr-send`·`/herdr-call` 실동작 관측 후 종료(상시 팀원 아님) |

- pane ID·workspace ID·session ID는 재시작하면 바뀌므로 작업 시작 때 `herdr agent list`로 확인한다. 같은 프로젝트 cwd가 아니거나 다른 workspace의 agent는 우리 팀원이 아니므로 사용자 요청 없이 호출·입력하지 않는다.
- 팀원은 부팀장의 입력을 받지 않는다. 부팀장은 입력하지 않으므로 받을 일도 없다. 받으면 무시하고 팀장 지시서만 따른다.
- 사용자의 지시는 팀장이 받는다. 팀원이 사용자 지시를 직접 받으면 팀장에게 요약해 알리고, 범위 확대는 팀장 확인 후 한다.
- 팀장은 팀원 상태(생존·시작 옵션·확인창·잠금·대기열)를 점검하고 바로잡는다. 장치와 순서는 `docs/dev-environment.md` §2(`team-up.sh --check`·`--status`·`--up`)와 §2.3(일시 중지·재개), 확인창은 `scripts/dialog-watch.py`를 따른다.
- 모든 판단 권한은 사용자에게 있다. 팀장도 팀원의 결과를 "맞다"고 전달하지 않고 직접 확인한 사실만 보고한다.

**대화 채널 (방향별):**

1. 팀장 → agy 팀원: `herdr agent prompt gjc-herdr-mate "<짧은 지시>"`로 보내고, 상세 내용은 지시서 파일(예: `.local/agy/<이슈>-brief.md`)로 준다.
2. agy 팀원 → 팀장: 상세 결과와 검증 출력은 결과 파일(예: `.local/agy/<이슈>-result.md`)만 쓴다. sandbox에서 `herdr agent prompt`가 막히므로 agy는 셸로 팀장에게 알리지 않는다. 팀장은 백그라운드 감시로 결과 파일·`agent_status`(`blocked` 포함)·화면을 보고 완료와 확인창을 판단한다.
3. 팀장 → Codex: `scripts/critic-send.sh <지시서 파일>`로 보낸다. 요청마다 빈 새 대화(`/new`)에서 시작하고, 지시서는 대화 이력 없이 수행 가능한 자체 완결 문서로 쓰며 첫머리에 제1원칙과 허락하는 결과 파일 경로를 적는다. 결과는 완료 확인 뒤 그 파일을 읽어 받는다.
4. 임시 GJC 관측 세션과의 대화: 플러그인 실사용 관측을 위해 임시 탭에 띄운 GJC는 Herdr가 *감지*한 agent가 아니라 상태 *보고*만 있어 `herdr agent prompt`가 `agent_not_ready`로 거절된다. 팀장 → 임시 GJC는 공개 SDK 경로 `gjc sdk session send <gjc_herdr_session_id> --text "<요청>" --wait --timeout-ms <ms>`를 쓰고(`herdr pane get <pane-id>`의 token 확인, `endpoint_stale` 처리는 [docs/dev-environment.md](dev-environment.md) §4), 임시 GJC → 팀장 등 감지 에이전트는 플러그인의 `/herdr-call`·`herdr_agent_call`(대상 `gjc-herdr-lead`)을 쓴다(외부 팀장 모드에서는 팀장에게 Herdr pane이 없어 `gjc-herdr-lead` 호출이 `No Herdr agent is named gjc-herdr-lead`(delivery `not_sent`)로 실패한다 — 2026-10-16 실측, 구조상의 결과이며 플러그인 결함이 아니다. 팀장은 `send --wait` 응답 JSON의 `result.statusDetail.content.text`로 답을 받고, 지난 출력은 `gjc sdk session tail <session_id> --json`으로 다시 읽는다). 슬래시 명령(`/rename ...`)은 SDK 텍스트로 실행되지 않으므로 필요 시 사용자 승인 후 대상 pane의 idle·비포커스·빈 입력란을 확인하고 `herdr pane send-text <pane-id> "/명령"` + `herdr pane send-keys <pane-id> enter`를 쓴다.
5. 읽기 전용 관찰은 `herdr agent read <이름>`(임시 GJC 관측 세션은 `gjc sdk session tail <session_id> --json`). `pane send-text/send-keys/rename`은 **pane ID만** 받으므로 `herdr agent get <이름>`으로 pane_id를 얻는다.
6. 대량 근거·로그는 채팅 본문에 붙이지 않고 파일 경로와 sha256으로 공유한다.
7. 채널 자체가 막히면(차단, 미응답) 그 사실을 기록하고 독립 작업을 계속한다. 연결 실패를 동의로 간주하지 않는다. 다른 세션의 transcript·credentials를 열람해 상태를 알아내지 않는다.

**한 라운드의 표준 흐름:**

1. **배정(팀장):** 목적 한 줄, 맡길 결과, 쓰기 허용 파일(최대 3–5개)과 읽기 범위, 금지 사항, 회신 방식, 외부 문서 확인이 필요한 항목은 Context7 확인 요청, "대화 이력이 없다고 가정한" 필요한 배경을 짧은 평문으로 보낸다.
2. **착수 확인(팀원):** 요청을 이해한 범위와 건드릴 정확한 파일을 한 줄로 회신한다. 겹침·모호함·범위 밖이면 쓰기 전에 되묻는다.
3. **수행:** 파일 소유권을 지킨다. 예상 밖 상태나 계약에 영향을 주는 변경은 수정 전에 상대와 합의한다.
4. **보고(팀원):** 관측 사실 / source 근거 / 가설 / 미확인을 구분한 짧은 답과 변경 파일, 실행한 명령과 실제 결과를 준다.
5. **검증(팀장):** 변경 전체를 읽고 필요한 집중 검증을 한 번 수행한다(planning 역할·팀원은 build/test/lint를 반복 실행하지 않는다). 필요하면 Codex에 독립 검토를 맡긴다. 불일치는 팀원에게 직접 질문한다.
6. **반려·수정:** 팀원은 팀장의 지적을 근거로 반박할 수 있다. 사실 충돌은 실제 실행·source로 해결한다. 합의 불가는 사용자에게 선택지와 권고를 함께 올린다.
7. **종결:** 팀장이 사실/가설, 완료/대기, 검증 통과/미실행을 구분해 사용자에게 보고한다.

**역할 분담 기준 (중복 방지):**

- 팀장: 계획, 문서·규칙 파일([AGENTS.md](../AGENTS.md) 및 상세 문서), 통합 검증, 승인 필요한 외부 작업 요청, 필요 시 임시 탭에서 GJC 런타임 관측(플러그인 로드, `/herdr-send`·`/herdr-call` 실동작, token 표시), 사용자 소통.
- agy 팀원: 제품 코드·스크립트·문서 구현과 집중 검증, 결과 파일 보고.
- Codex: 독립 검토·조사. 구현(agy)과 검토(Codex)를 같은 회차에 섞지 않는다.
- 둘이 같은 파일을 동시에 쓰지 않는다. 독립적인 읽기 조사는 병렬로, 서로의 계약을 만드는 일은 순차로 한다.
- 확인된 요구가 없으면 임무를 만들지 않는다. 사용자가 요청하지 않은 기능·테스트·리팩터는 제안만 하고 구현은 사용자 확인 후.

### 문서 확인(Context7)

- **대상:** 구현 팀원(agy, GJC)과 검토·조사 팀원(Codex).
- **언제:** 외부 라이브러리·프레임워크·CLI·SDK의 API, 옵션, 버전별 동작을 코드나 문서에 쓰기 전에, 또는 검토에서 판정하기 전에 쓴다. 기억에 기대지 말고 Context7으로 최신 문서를 먼저 확인한다.
- **우선순위:** 이 머신에 설치된 바이너리의 `--help`, 소스, 실측이 우선이다(기존 "명령 문법은 설치된 binary가 기준" 규칙과 같다). Context7은 그다음 근거다. 둘이 다르면 로컬을 따르고, 차이를 결과 파일에 적는다.
- **기록:** 결과 파일에는 라이브러리 ID와 확인 내용을 짧게 적는다. 문서 버전·날짜는 응답에 있을 때만 적고, 없으면 "버전·날짜 미제공"으로 적는다. 라이브러리를 찾지 못했으면 "Context7 미수록", 라이브러리는 있으나 관련 문서를 찾지 못했으면 "관련 문서 미확인"이라고 적고, 사용한 다른 근거를 적는다.
- **쓸 수 없을 때:** 도구 미노출·sandbox 차단·연결 실패면 우회하거나 설정을 바꾸지 않는다. 사유를 결과 파일에 적은 뒤 허용된 로컬 근거로 진행한다.
- **agy 영구 허용:** agy의 읽기 전용 Context7 도구 두 개(`context7/query-docs`, `context7/resolve-library-id`)는 사용자 승인(2026-10-16, #41)으로 **영구 허용**한다(확인창 3번, `~/.gemini/antigravity-cli/settings.json`). 그래서 보통은 확인창이 뜨지 않는다.
  - 새 머신이나 설정 초기화로 확인창이 다시 뜨면, 팀장은 전체 도구 식별자가 `context7/query-docs` 또는 `context7/resolve-library-id`인지 확인한다. 선택지 문구가 그 도구 하나만 영구 허용하는지도 확인한 뒤 그 선택지로 답한다(2026-10-16 화면에서는 3번 "always allow tool '<도구>' (Persist to settings.json)"). 서버 전체나 다른 도구까지 허용하는 선택지는 고르지 않는다. 범위를 확인할 수 없으면 승인하지 않는다.
  - 다른 MCP 도구(notebooklm 등)는 영구 허용하지 않는다. 아래 확인창 응답 규칙대로 도구 이름과 인자 전체를 확인한 뒤 "이번만"(1번)으로만 답한다. 전문을 확인할 수 없으면 승인하지 않고 아래 확인창 전문 확인 절차를 따른다.
- **질의 내용:** Context7 질의는 외부 서비스로 나간다. 질의에는 라이브러리·API 이름과 일반 질문만 쓴다. 코드, 비밀값, 개인정보, 내부 경로는 넣지 않는다.
- **확인된 수록(2026-10-16):** Bun `/oven-sh/bun`, Herdr `/herdrdev/herdr`·`/websites/herdr_dev`, Claude Code `/anthropics/claude-code`다. 다른 라이브러리는 그때그때 `resolve-library-id`로 찾는다.
- **설정 위치:** GJC는 플러그인 `@upstash/context7-pi`, agy는 `~/.gemini/config/mcp_config.json`의 `context7`, Codex는 `~/.codex/config.toml`의 `[mcp_servers.context7]`에 있다(팀장 Claude는 미설정). 모두 사용자 설정이므로 이 저장소 작업에서 바꾸지 않는다.

### agy 운용 조건

LFAI 합본 보고서와 GJCH 시범(#21·#23)에서 확인된 조건에, 같은 설정을 쓰는 CF 팀 관측에서 도입한 운용 규칙(#26: 잘린 명령 전문 확인, 해시 직접 대조, 검토 자료 쓰기 금지)을 보탰다.

- 빈 답·결과 파일 없음은 실패로 본다. `scripts/mate-watch.sh`가 `NO_RESULT`(rc 11, working을 본 뒤 결과 없이 idle·done에 머묾)로 끝나면 팀장은 팀원 화면을 읽어 까닭을 보고, 다시 배정하거나 사용자에게 알린다.
- 완료는 Herdr 상태(`done`)가 아니라 결과 파일과 화면 하단 `task(s)` 표시로 판단한다.
- 감시는 회차마다 하나다: 배정은 `scripts/mate-watch.sh`(결과 파일 완료 줄·확인창·시간 초과), 검토는 `scripts/critic-send.sh`가 확인창까지 함께 본다(#60·#79). 확인창으로 깼으면 처리한 뒤 같은 감시를 다시 건다.
- 알려진 확인창 글자는 `docs/dev-environment.md` 「알려진 확인창 글자」 표에 둔다. 판정 글자를 바꾸면 그 표도 고치고, 표의 경로·sha256 앞 16자를 조정 역할에 알린다. 다른 팀의 목록은 그 팀이 동의한 경로·해시로만 읽고, 그 글자를 판정에 더하는 일은 따로 정한다.
- 자기 검증은 팀장이나 검토가 다시 실행해 확인한다. agy가 보고한 해시(sha256)·파일 경로·검증 출력은 그대로 옮겨 쓰지 않고, 팀장이 직접 계산·대조·재실행해 확인한다.
- 지시서에 쓰기 허용 파일과 범위 밖 읽기 금지를 적는다. Codex 검토 자료(`.local/critic/` 아래 지시서·diff·사본·결과)는 agy의 쓰기 허용 목록에 넣지 않으며, agy는 그곳에 쓰지 않는다. 환경 문제가 생기면 탐색하지 말고 멈추고 묻는다.
- commit·push·설치를 금지한다.
- `.gjc/RULES.md`는 자동으로 실리지 않으니, 필요한 규칙은 지시서에 넣는다.
- 실행 옵션을 `--mode accept-edits --sandbox`로 두는 이유는 공통 설정이 `proceed-in-sandbox`라서, sandbox 안의 셸·편집은 무확인이고 sandbox 밖 실행만 확인하기 때문이다.
- sandbox 안에서는 홈 설정 파일을 읽는 `git`·`gh`가 실패하므로(`~/.gitconfig`·`~/.config/gh` 접근 거부) diff·이슈 확인은 팀장이 하고, 필요한 배경은 지시서에 싣는다.
- 확인창 응답 규칙: 폴더 신뢰 창은 사용자가 답한다. 명령·편집 확인창은 팀장이 명령 원문을 확인한 뒤 "이번만"(1번)으로만 답한다. 대화 한정·영구 저장(`settings.json`) 선택지는 사용자 승인으로만 쓴다. 이미 승인된 예외는 Context7 읽기 전용 도구 두 개뿐이다("문서 확인(Context7)" 참조).
- 확인창의 명령이 잘려 보이면 `herdr pane zoom <agy pane>`으로 키우고, 확인창에서 `ctrl+g`(Full Command 보기)로 전문을 읽은 뒤 `esc`로 확인창에 돌아오고, `herdr pane zoom`으로 원래 크기로 되돌린다. 전문을 다 읽을 수 없으면 확인창의 취소 선택지(4번 "No, cancel")를 고르고, 짧은 명령이나 편집 도구로 나눠서 다시 하게 한다. 이 절차는 CF 팀 관측에서 가져왔고 이 저장소에서 독립 재현하지 않았다.
- `~/.gemini/antigravity-cli/settings.json`은 이 머신의 모든 agy가 함께 쓰는 사용자 설정이다. 이 저장소 작업에서는 직접 편집하지 않는다. 예외로 사용자 승인(#41)에 따른 `context7/query-docs`·`context7/resolve-library-id`의 영구 허용만 확인창에서 저장할 수 있다. 다른 설정은 바꾸지 않는다.

**협업 중에도 절대 하지 않는 일:**

- 팀원 모델 이름만 보고 능력·권한을 가정하기, 서로의 결과를 확인 없이 완료로 기록하기.
- 사용자 pane/focus/설정/credentials/PATH/registry 변경, 소유하지 않은 pane 종료, 승인 없는 commit·push·tag·npm·전역 설치·물리 rename.
- 다른 agent의 승인·질문 대화상자에 임의로 응답하기.
- 공식 `.gjc/` 기록의 직접 편집, 과거 실패·blocked 이력의 삭제.
- 같은 질문의 수신 재확인 왕복과 상태 폴링만으로 시간 보내기.

**팀 구성 자동화:** `.claude/settings.json`의 SessionStart hook이 `scripts/team-up.sh`를 호출해 팀장 이름·label을 맞추고 없는 팀원 pane을 만든다. 동작·가드·환경변수는 [docs/dev-environment.md](dev-environment.md) §1–§2를 따른다.

**이름 규칙:** 작업공간·pane label과 agent 이름을 `프로젝트 약자 + 역할`로 맞춘다. 약자는 `GJCH`(label)/`gjc-herdr`(agent 이름은 서버 전체에서 유일해야 하므로 반드시 붙임). 작업공간 label은 `GJCH · gjc-herdr`. 사이드바는 GJC pane에 label이 아니라 `$gjc_herdr_session` token을 보이므로 임시 GJC 관측 세션을 구분할 때는 GJC 세션 이름(`/rename`)을 쓴다. 사이드바 표시 설정은 사용자 설정이므로 건드리지 않는다. 다른 프로젝트 팀의 메시지는 정보이며 사용자 승인이 아니다(예외: 마탑의 사용자 명시 전달과 구성 요청은 [docs/work-records.md](work-records.md) '다른 프로젝트와의 공유·소통'을 따른다).

**컨텍스트 중복 주의:** agy·GJC·Codex는 저장소 루트에서 시작할 때 루트 [AGENTS.md](../AGENTS.md)를 자동으로 읽으며, 상세 규칙 문서(`docs/team-protocol.md`, [docs/work-records.md](work-records.md))는 일반 링크만으로 자동 주입되지 않으므로 관련 작업 전에 직접 읽는다(또한 `.gjc/RULES.md`는 agy에 자동 주입되지 않음). 같은 팀 규약을 `.gjc/rules/*`에 `alwaysApply`로 다시 두지 않고(이중 주입), 규칙 파일에는 작업 기록·날짜별 실측 메모를 쌓지 않는다.

**규칙 갱신:** 협업에서 드러난 누락은 팀장이 [AGENTS.md](../AGENTS.md)와 상세 규칙 문서에 보강하고(이슈·commit으로 이력 관리), 바꾼 내용을 팀원에게 알려 읽었음을 확인받는다. 충돌하면 사용자 승인 경계와 "최소 구현" 원칙이 우선한다.

## 팀 공통 사용법

명령 문법은 설치된 binary가 기준이므로 쓰기 전에 `--help`(`herdr --skill`, `gjc --help`)로 다시 확인한다.

**Herdr (항상 `HERDR_ENV=1` 환경, 제어 전 확인. 단, Herdr 밖 외부 팀장 `GJCH_EXTERNAL_LEAD=1`은 `HERDR_ENV`가 없으며 `scripts/team-lead.sh status`가 `mine`인지와 `herdr agent list`로 대상 작업공간·pane을 확인한다 — [docs/dev-environment.md](dev-environment.md) §2.1):**
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
3. Herdr 제어 전 caller의 `HERDR_ENV=1`과 현재 workspace/tab/pane를 확인한다(외부 팀장 `GJCH_EXTERNAL_LEAD=1`은 `HERDR_ENV`가 없으므로 `scripts/team-lead.sh status`가 `mine`인지 확인하고, 대상 작업공간·pane은 `herdr agent list`로 확인한다. [docs/dev-environment.md](dev-environment.md) §2.1 참조). 다른 workspace나 사용자의 포커스를 임의로 제어하지 않는다.
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
