# 개발 환경: Herdr + 팀장(Claude Code) + 구현(agy) + 선택 검토(Codex)

이 저장소는 한 Herdr workspace에서 **팀장(Claude Code)** 이 **구현 팀원(agy)** 과 **선택 검토·조사 팀원(Codex)** 에게 역할을 나눠 `gjc-herdr`을 개발하도록 구성되어 있다(팀장은 그 workspace의 pane이거나 Herdr 밖 외부 팀장이다. §2.1 참조). GJC는 상시 팀원이 아니며, 플러그인 실사용 관측이 필요할 때만 팀장이 임시 탭에 띄운다. 구현과 독립 검토를 같은 에이전트의 같은 회차에 맡기지 않는다. 새 컴퓨터에서 `git clone`한 뒤 AI(Claude Code 등)가 이 문서를 읽고 스스로 점검·구축할 수 있게 쓴 문서다. 각 단계의 **실제 출력으로 판정**하고, 확인하지 못한 항목을 성공으로 적지 않는다.

## 0. 목표 운영 환경 (2026-10-17 사용자 확정)

지금은 데스크톱(Claude 데스크톱 앱 + 로컬 Herdr)에서 개발하지만, **최종 개발 환경은 다르다.** 기능을 설계하거나 검토할 때는 이 목표 환경을 기준으로 판단한다.

- **원격 서버:** 원격 서버에서 Herdr 서버가 돌고, GJC·agy·Codex 같은 세션은 그 Herdr의 pane 안에 떠 있다.
- **화면 없음:** 대부분의 시간에는 그 화면을 보는 Herdr TUI 클라이언트가 붙어 있지 않다. 사람은 가끔 접속해서 보거나, 아예 보지 않는다.
- **팀장도 화면 밖:** 팀장도 Herdr 화면을 늘 보지 않는다. 지금의 외부 팀장(§2.1)처럼 세션 간 메시지(`SendMessage`/`ListAgents`)나 Herdr CLI(`herdr agent …`, `herdr pane read` 등)로만 다룬다.

### 0.1 설계 기준
- **사람이 화면을 보고 있다고 가정하지 않는다.** 화면에만 뜨는 알림(토스트, 상태 줄, 잠깐 떴다 사라지는 안내)은 보고 경로로 쓰지 않는다. 결과·보고·진단은 파일, 우편함(`.gjc-herdr/mailbox`), 세션 간 메시지, 로그처럼 나중에 읽을 수 있는 곳에 남긴다.
- **팀장이 깨어나는 방법을 따로 둔다.** 팀장은 화면 변화를 보지 못한다. 그래서 백그라운드 감시(`mail-watch.sh`, 팀원 감시 루프)나 세션 간 메시지로 깨어나야 한다. 플러그인 monitor처럼 실행 환경에 따라 돌지 않을 수 있는 수단에 기대지 않는다(#38 실측).
- **확인창·질문 UI는 원격에서 내용을 확인할 수 있어야 한다.** 팀장은 기존 승인 범위 안의 agy 명령·편집 확인창에만 정해진 절차로 답한다(§5). 폴더 신뢰와 그 밖의 질문 UI는 사용자에게 알리고 응답을 기다린다. 원격에서 내용을 읽고 알리는 절차가 검증됐는지는 §0.2에 적는다.
- **"포커스"와 "UI" 판정의 뜻을 구분한다.**
  - Herdr의 `focused`는 서버 상태(작업공간마다 선택된 pane 하나와 전역 활성 작업공간 하나)이며, 화면을 보는 사람이 없어도 값이 있어 "사람이 그 pane을 보고 있다"는 뜻이 아니다(CF 팀 2026-10-17 실측: 사용자가 다른 작업공간에 있어도 pane이 `focused: true`였고, `herdr pane focus`는 전역 활성 작업공간까지 바꾸며, `herdr status client`·Herdr 스키마에는 붙은 클라이언트나 그 클라이언트가 보는 대상을 알려 주는 필드가 없다). 클라이언트가 다시 붙을 때 활성 작업공간이 바뀔 수 있다(2026-10-17 detach 실측).
  - GJC 확장의 `ctx.hasUI`는 화면을 누가 보느냐가 아니라 **GJC 프로세스의 실행 모드**로 정해진다(대화형 TUI면 true, print·SDK면 false, #44 실측. Herdr 화면이 없어도 pane 안 대화형 GJC는 true, 2026-10-17 detach 실측).
  - 둘을 "사람이 보고 있다"는 뜻으로 섞어 쓰지 않는다.
- **화면이 없으면 pane이 줄어든다(2026-10-17 detach 실측).**
  - 클라이언트가 붙지 않으면 탭 전체 크기가 120×40으로 줄고, 다시 붙이면 터미널 크기로 돌아온다.
  - 화면 판정에 폭이 필요한 pane(예: `critic-send.sh`의 Codex 상태 줄 판정은 56칸 이상)은 탭 안 비율을 몰아주거나 탭의 pane 수를 줄여 폭을 확보한다(탭 전체 120칸은 넘지 못한다).
  - `herdr pane resize`는 화면이 없어도 동작하며, 바꾼 비율은 다시 붙어도 유지된다.
  - 사용자 플러그인의 Sidebar도 탭 폭을 차지한다(기존 탭의 Sidebar는 비율대로 줄었지만, 화면이 없을 때 새로 만든 탭은 Sidebar가 32칸으로 생겨 pane 몫이 88칸이었다).
- **Herdr 서버 재시작을 사람이 보지 못한다.** 재시작 뒤 팀원 옵션 유실(§6, #42)이나 잠금 `stale` 같은 일을 팀장이 점검 명령으로 알아챌 수 있어야 한다.

### 0.2 아직 확인하지 않은 것 (원격 환경에서 실측 필요)

체크리스트는 #50에서 추적한다.

- **GJC 팀원 실행 방식(2026-10-17 결정):** Herdr pane 안에서 대화형 `gjc`로 띄우는 것을 기준으로 한다. 화면을 보는 사람만 없을 뿐이다. 이것은 `AGENTS.md` "인터페이스 우선순위"를 따른 결정이다. Herdr 밖 헤드리스 GJC(`gjc sdk` 세션)는 Herdr 표준으로 다룰 수 없고 검증하지도 않았으므로 기준으로 삼지 않는다.
  - 2026-10-17 데스크톱 임시 탭과 로컬 detach(클라이언트를 뗀 상태에서 새로 띄운 대화형 GJC는 우편 수신 잠금 생성과 `received`/`observed`, 이미 떠 있던 GJC는 받기 정상) 실측에서 대화형 GJC의 `hasUI`는 true였다. 진짜 원격(SSH) 서버에서도 같은지는 미확인이다.
  - 헤드리스 GJC는 `hasUI`가 false라 v0.5.1의 우편 받기가 꺼진다(#44).
- 클라이언트가 붙지 않은 Herdr 서버에서 pane의 `focused` 값: 2026-10-17 로컬 detach 실측에서 클라이언트가 없어도 값(작업공간마다 선택 pane, 활성 작업공간)이 남았고, 다시 붙는 순간 활성 작업공간이 바뀌었다. 진짜 원격 서버 확인만 남았다.
  - `critic-send.sh`는 더 이상 `focused`로 전송을 거절하지 않는다(#46). 화면을 관측했을 때 draft가 있거나 형식을 판정할 수 없으면 거부하지만, 확인한 뒤의 동시 입력은 막지 못한다(확인과 입력은 원자적이지 않다).
  - 플러그인의 `/herdr-send --raw`와 `/herdr-call`은 입력란을 읽을 수 없을 때만 `focused`를 보며, 그때 `focused=true`이면 거절하거나 기다릴 수 있다.
- 플러그인(`/herdr-send --raw`·`/herdr-call`)이 입력란을 읽지 못해 `focused`로 거절·대기했을 때의 복구. 지금은 사용자가 포커스를 옮기는 방식이다. 원격에서 이 절차를 어떻게 할지 정해야 한다. 승인 없이 팀장이 포커스를 바꾸지 않는다(`herdr pane focus`는 전역 활성 작업공간을 바꾼다).
- 클라이언트 없이 확인창·질문을 감지하고 사용자에게 알린 뒤, 승인된 응답을 회수하는 절차. 다음을 포함한다.
  - Codex 신뢰 창이 `idle`로 보이는 경우(§6). `blocked` 감시만으로는 놓칠 수 있다.
  - agy 폴더 신뢰 창. 지금은 사용자가 그 pane에서 답한 뒤 `team-up.sh --spawn`을 다시 실행한다.
  - 잘린 명령을 `zoom`·`ctrl+g`로 펼쳐 전문을 확인하는 절차
- agy 완료 감시(결과 파일과 화면 하단 `task(s)` 표시를 함께 확인)와 팀장 깨우기·감시 재등록이 원격 실행 환경에서도 유지되는지
- 클라이언트가 없을 때 Herdr 화면 읽기(`herdr pane read`, `agent read`)가 지금과 같은 내용을 주는지: 2026-10-17 로컬 detach 실측에서 `herdr pane read --source visible`은 같은 내용을 줬고(빈 입력란 판정·`pane send-text`·`/herdr-send --wait` 동작 확인), `herdr agent read`와 진짜 원격 서버는 미측정이다.
- 클라이언트가 없을 때의 탭 크기 120×40을 설정으로 바꿀 수 있는지, 진짜 원격(SSH, `herdr --remote`)도 같은지, 줄어든 pane에서 플러그인 입력란 판정이 그대로 되는지
- 원격에서 팀장(Claude Code)을 어디에 둘지: Herdr pane 안인지, 원격 밖 세션인지. 그리고 세션 간 메시지가 닿는지

## 1. 구성 요약

| 역할 | 에이전트 | 이름·label | 하는 일 | 하지 않는 일 |
|---|---|---|---|---|
| 팀장 | Claude Code | 팀장 잠금 보유자: agent `gjc-herdr-lead`, pane label `GJCH 팀장 · Claude`(herdr 안 pane) 또는 herdr 밖 외부 팀장 | 사용자와 대화, 작업 분해·배정, 결과 검증, 승인이 필요한 외부 작업(commit/push/설치) 요청 | 사용자 승인 대체 |
| 부팀장(선택, 이관 때만) | Claude Code | agent `gjc-herdr-deputy`, pane label `GJCH 부팀장 · Claude` | 관찰, 조회, 팀장 지원(세션 간 메시지) | 팀원 배정과 입력, 팀 구성과 배치 |
| 구현 팀원 | agy (Antigravity CLI) | agent `gjc-herdr-mate`, pane label `GJCH 팀원 · agy` | 배정된 파일 구현·집중 검증, 결과 파일과 근거 보고 | 같은 회차의 독립 검토 역할 겸임, 승인 없는 commit/push/설치, 범위 밖 탐색 |
| 검토·조사 팀원(선택) | Codex | agent `gjc-herdr-critic`, pane label `GJCH 검토·조사 · Codex` | 독립 검토·조사·근거 확인, 지시서가 지정한 결과 파일 작성 | 팀장 허락 없는 파일 수정, 커밋·적용, 팀장 검증 대체, 사용자 승인 |
| 런타임 관측(임시) | GJC | 필요 시 팀장이 임시 탭에 실행 | 플러그인 로드, token 표시, `/herdr-send`·`/herdr-call` 실동작 관측 후 종료 | 상시 팀원 점유 |

작업공간 label은 `GJCH · gjc-herdr`이다. `scripts/team-up.sh`·`scripts/team-lead.sh`·`scripts/critic-send.sh`의 환경변수는 다음과 같다.

| 환경변수 | 기본값·용도 |
|---|---|
| `GJCH_LEAD_NAME` | `gjc-herdr-lead` |
| `GJCH_DEPUTY_NAME` | `gjc-herdr-deputy`; 다른 세션이 팀장 잠금을 보유 중일 때 herdr 안 Claude에 붙이는 부팀장 이름 |
| `GJCH_MATE_NAME` | `gjc-herdr-mate` |
| `GJCH_CRITIC_NAME` | `gjc-herdr-critic` |
| `GJCH_WS_LABEL` | `GJCH · gjc-herdr`; 대상 작업공간 label |
| `GJCH_EXTERNAL_LEAD` | 미설정; `1`이면 herdr 밖(데스크톱 Code 탭 등) 외부 팀장 모드 |
| `GJCH_LEAD_LOCK` | `.local/team/lead.json`; 팀장 잠금 파일 경로 |
| `GJCH_TEAM_CODEX` | `1`; `0`이면 Codex 자동 구성을 끈다 |
| `GJCH_MATE_MODEL` | `gemini-4-argon-high`. 팀원을 `herdr agent start ... --kind agy ... -- --model <값> --mode accept-edits --sandbox`로 실행한다. 영문자·숫자·`._-`만 허용 |
| `GJCH_CODEX_MODEL` | `gpt-6.1-sol` |
| `GJCH_RETRIES` | `30`; 팀장 이름 확보 등을 2초 간격으로 재확인 |

**Codex는 사용자 지시로 `--yolo`를 사용하며 샌드박스가 없다.** Codex는 저장소 루트에서 실행되며, **제1원칙은 "파일 수정이 필요하면 먼저 팀장 허락을 받는다"**이다(루트 `AGENTS.md`와 매 지시서에 적는다). 검토·조사 결과 파일은 지시서가 지정한 gitignore 경로(예: `.local/critic/`)에만 쓰며, 이 지정이 팀장의 허락이다. commit·적용은 하지 않는다. Codex가 없으면 WARN과 함께 생략하며, 기존 `gjc-herdr-critic` pane은 다시 시작하거나 변경하지 않는다.

**팀장 잠금 (`scripts/team-lead.sh`):**

- **잠금 파일 위치:** `${GJCH_LEAD_LOCK:-.local/team/lead.json}`(동시 실행은 `<잠금 파일>.mutex`의 `fcntl.flock`으로 직렬화). `session_id`, `socket`, `socket_ino`, `socket_ctime_ns`, `kind`(`herdr`|`external`), `claimed_at`(및 `herdr`일 때 `pane_id`)을 기록한다.
- **살아 있음과 "내 잠금" 판정:** macOS는 소켓의 대기열(backlog)이 차면 `connect`가 거부되므로 다른 세션 소켓에 접속하여 판정하지 않는다. 판정 순서: (1) 잠금에 기록된 `socket` 경로가 없거나(`FileNotFoundError`/`NotADirectoryError`) 유닉스 소켓이 아니면 만료(`stale`)로 보고, 권한 오류 등 그 밖의 `stat` 조회 `OSError`는 불확실하므로 살아 있는 것(`live`)으로 본다, (2) 현재 `st_ino`나 `st_ctime_ns`가 기록과 다르면 만료(`stale`), (3) `lsof -t <socket>`(타임아웃 5초)을 실행해 rc `0`이고 PID 출력이 하나 이상 있으면 살아 있음(`live`), rc `1`이고 stdout·stderr가 모두 빈 경우(같은 사용자의 정상 조회 전제, 아무 프로세스도 소켓을 열고 있지 않음)만 만료(`stale`)로 확정하며, 그 밖(stderr에 내용이 있음, 다른 rc, `lsof` 없음 `FileNotFoundError`, 실행 실패, timeout)은 불확실하므로 보수적으로 살아 있는 것(`live`)으로 본다(다른 세션의 잠금이면 `claim`·`release`가 rc `3`으로 거절되어 잠금이 유지됨). 내 잠금(`mine`)은 현재 세션의 `CLAUDE_CODE_SESSION_ID`가 `session_id`와 같거나, `CLAUDE_CODE_MESSAGING_SOCKET`의 경로·`st_ino`·`st_ctime_ns`가 잠금 기록과 일치할 때로 판정한다(내 정체 확인용 소켓 `stat`은 어떤 오류든 정체 미확인으로 처리한다).
- **명령과 종료 코드(rc):**
  - `scripts/team-lead.sh status`: `none` | `mine <kind> <session_id>` | `other <kind> <session_id> live` | `stale <kind> <session_id>`를 출력하고 rc `0`(잠금 파일 읽기·형식 오류는 rc `1`).
  - `scripts/team-lead.sh claim`: 잠금이 없거나 만료(`stale`)되었거나 내 잠금(`mine`)이면 확보·갱신하고 `claimed <kind> <session_id>`를 출력한다(rc `0`). 다른 세션의 살아 있는 잠금이 있으면 stderr에 `held <kind> <sid8>…`를 출력하고 rc `3`으로 끝난다. 살아 있는 다른 잠금은 없으나 내 세션 정체(`CLAUDE_CODE_SESSION_ID` 또는 소켓 `stat`)를 확인할 수 없으면 잠금 파일을 쓰지 않고 rc `4`로 끝난다(오류는 rc `1`).
  - `scripts/team-lead.sh release`: 내 잠금·만료 잠금·잠금 없음이면 잠금 파일을 삭제하고 rc `0`, 다른 세션의 살아 있는 잠금이면 rc `3`, 오류는 rc `1`.
  - `scripts/team-lead.sh release --force`: 보유자와 무관하게 잠금 파일을 삭제하고 rc `0`. **`--force`는 사용자 승인으로만 쓴다.**
- **원칙:** 팀원(agy, Codex)에게 배정하거나 입력하는 모든 작업(`herdr agent prompt`, `/new`, `herdr pane send-text`/`send-keys`, `scripts/critic-send.sh`, `scripts/team-up.sh --spawn`/`--layout`)은 **잠금을 가진 팀장 세션만** 수행한다(단, Herdr 안에서 살아 있는 다른 잠금이 없고 정체 환경변수만 없는 경우(rc `4`)는 잠금 파일 없이 기존처럼 팀장으로 동작하는 호환 예외다). 작업 시작 전 `scripts/team-lead.sh status`로 역할을 확인한다.

## 2. 자동 구성이 일어나는 방식

1. 사용자가 **Herdr pane 안에서 이 프로젝트 폴더에 들어가 `claude`를 실행**한다(herdr 밖 외부 팀장은 아래 §2.1 참조).
2. `.claude/settings.json`의 SessionStart(`startup|clear`) hook이 `scripts/team-up.sh --hook`을 호출한다. stdin을 EOF까지 읽는 전체 한도는 2초이며, 먼저 동기로 `scripts/team-lead.sh claim`을 실행해 역할 한 줄(`GJCH: ...`)을 stdout(세션 맥락)에 출력한다. 잠금을 확보했거나(rc `0`) 살아 있는 다른 잠금 없이 정체 환경변수만 없는 경우(rc `4`)에는 `GJCH: 이 세션이 팀장입니다(herdr pane <id>, 팀장 잠금 보유).`(rc `4`는 정체를 알 수 없다는 문구가 붙은 팀장 줄)를 출력하고, 최상위 JSON이 객체이고 `source`가 정확히 `clear`일 때만 기본 모드를 백그라운드로 실행해 팀장 이름·pane label과, 비었거나 폴더명 기본값인 작업공간 label만 복구한다(팀원·검토 pane이 없어도 만들지 않음). 그 외에는 `--spawn`을 백그라운드로 실행한다(stdin이 터미널이면 읽지 않으며, 읽기 한도 초과·읽기 오류·JSON 파싱 실패·필드 없음일 때도 기존 `--spawn` 동작을 유지). 잠금이 다른 세션에 있으면(rc `3`) `GJCH: 팀장 잠금이 다른 세션(<kind> <sid8>)에 있어 이 세션은 부팀장(gjc-herdr-deputy)입니다. 팀원에게 배정·입력하지 말고 팀장을 지원만 합니다.`를 출력하고, 백그라운드 실행은 이 pane에 부팀장 이름(`gjc-herdr-deputy`)과 label(`GJCH 부팀장 · Claude`)만 붙이며, 팀원 구성과 배치는 하지 않는다.
3. `startup`의 `team-up.sh --spawn`이 다음을 순서대로 수행한다. 각 단계는 조건이 맞을 때만 실행되고 아무것도 덮어쓰지 않는다.
   - 가드: Herdr 안(`HERDR_ENV=1`)·`herdr`/`python3` 존재·이 pane의 실제 cwd가 프로젝트 안·`GJCH_TEAM_ROLE` 미설정일 때만 진행한다(Herdr 밖에서 `GJCH_EXTERNAL_LEAD=1`이면 §2.1 경로로 진행한다). 아니면 조용히 종료한다. 직접 실행한 `--spawn`·`--layout`에서 잠금이 다른 세션에 있으면(rc `3`) 부팀장 이름·label만 붙이고 팀원 구성·배치는 하지 않으며 rc `3`으로 종료한다(기본 모드 `scripts/team-up.sh`는 rc `3`일 때 부팀장 이름·label만 붙이고 `0`으로 끝난다).
   - 이 pane의 agent 이름을 `gjc-herdr-lead`로 확보(이미 다른 pane이 쓰면 건드리지 않음)하고 pane label과, 폴더명 기본값인 작업공간 label을 바꾼다. Claude 감지 지연 때문에 최대 약 60초 재시도한다.
   - 팀원 pane이 없으면 `pane split --no-focus`로 만들고(재시작 후 남은 새 label(`GJCH 팀원 · agy`)의 빈 셸 pane은 재사용하며, 기동 단계에서는 그 위치를 유지한다. 팀장과 같은 탭의 재사용 pane은 마지막 배치 보정 대상이고, 다른 탭의 재사용 pane은 보정에서 건너뛴다. 옛 `GJCH 팀원 · GJC` label의 빈 셸은 임시 관측 pane 등과 섞이지 않도록 자동 재사용하지 않는다) `herdr agent start gjc-herdr-mate --kind agy --pane <pane> --timeout 60000 -- --model <GJCH_MATE_MODEL> --mode accept-edits --sandbox`로 실행한다. `agy`가 없으면 안내하고 비0으로 끝낸다. 구현(agy, Gemini 4 Argon)과 검토(Codex, GPT)를 다른 모델로 두어 검토 독립성을 높이고 한 제공자 과부하에 함께 멈추지 않게 한다.
   - 새 pane의 위치는 아래 **배치 공식 기준**을 따른다. 포커스가 아니라 팀장 pane(`HERDR_PANE_ID`) 기준이다. 검토가 같은 탭에 있으면 검토를 반으로 나눌 새 pane을 만들고 검토를 임시 탭 경유 `pane move --no-focus`로 그 오른쪽에 되돌린 뒤 팀원 시작 전에 비율을 맞춘다. 없으면 팀장 아래를 나눠 팀장을 60%로 둔다. 검토를 같은 탭에 되돌리지 못하면 팀원은 그대로 시작하되 종료 코드를 비0으로 두고 그 pane·tab ID와 수동 복귀 필요를 알린다(다른 탭의 pane은 마지막 배치 보정·`--layout` 모두 옮기지 않는다).
   - `herdr agent start`가 JSON `error.code == "agent_not_ready"`로 실패하고 해당 pane의 `agent_status`가 `blocked`이면(처음 저장소를 열 때의 폴더 신뢰 창이나 다른 질문 UI 등), 스크립트는 자동 응답하지 않으며(사용자 결정 사항) 원래 오류(`code`·`message`)와 함께 불확실성을 남긴 안내(`agy가 시작 중 멈췄습니다(..., status=blocked, ...). 폴더 신뢰 창이나 다른 질문일 수 있으니 그 pane에서 사용자가 확인한 뒤 scripts/team-up.sh --spawn을 다시 실행하세요.`)를 출력하고 비0으로 끝낸다. pane 상태가 `working`이거나 상태 조회 실패·다른 기동 오류이면 신뢰 창으로 단정하지 않고 원래 오류와 함께 일반 실패로 끝낸다. 첫 기동이 `blocked`에서 멈춰도 이름 `gjc-herdr-mate`는 이미 붙으므로, 재실행 시 `existing` 분기에서도 `herdr agent get`의 `agent_status`·`interactive_ready`를 확인해 여전히 `blocked`이거나 준비되지 않았으면(조회 실패 포함) 비0으로 끝내고, 사용자가 응답해 `idle`/`done`·`interactive_ready=true`(또는 `working`)가 되면 새 pane을 만들거나 재시작하지 않고 배치 보정으로 넘어간다.
   - 선택 Codex 단계: `GJCH_TEAM_CODEX=0`·`codex` 없음·기존 critic 이름 점유 시 생략한다. 그 외에는 저장소 루트 cwd·검토 label인 같은 workspace 빈 셸 pane을 재사용하거나, 팀장과 같은 탭의 팀원 오른쪽(반반, 팀원이 없거나 다른 탭이면 팀장 아래 팀장 60%)에 no-focus로 만들고(팀원 오른쪽에 만든 경우 Codex 시작 전에 비율을 맞춘다) `herdr agent start ... -- --no-daemon --yolo -m <모델> -C <저장소 루트> --disable worktrees -c 'tui.status_line=["context-remaining","total-input-tokens","total-output-tokens"]'`로 시작한다(`/new` worktree 메뉴 없음, 56칸 검토 pane에서 상태 줄이 잘리지 않게 사용자 설정을 바꾸지 않고 이 프로세스만 덮어씀, §4). 공유 daemon 환경에서 실행된 훅이 세션 ID를 다른 pane으로 보고할 수 있어 `--no-daemon`으로 해당 pane의 환경을 사용한다. 팀원(agy) 단계 실패 시에도 Codex 단계는 별도로 시도하며, 실패한 단계가 있으면 종료 코드는 비0이다.
   - 마지막 배치 보정: 팀원·검토 단계가 끝난 뒤 팀장과 같은 탭에 있는 기존 pane·재사용 pane까지 아래 배치 공식 기준으로 맞춘다(수동 `--layout`과 같은 로직). 다른 탭의 pane은 옮기지 않는다.
4. 사용자의 focus·다른 pane·설정은 바꾸지 않는다.

**배치 공식 기준**(CF 팀과 같은 기준. 다른 문서는 이 절을 따른다):

- 모양: 팀장 위(높이 60%), 그 아래 왼쪽 agy 팀원 | 오른쪽 Codex 검토(반반). 검토가 없거나 팀장과 다른 탭에 있으면 팀장 60% / 팀원 아래만 맞춘다. 선택 Codex가 꺼져 있으면(`GJCH_TEAM_CODEX=0`, `codex` 없음) 팀 구성 보정은 기존 검토 agent도 빼고 같은 2-pane으로만 맞추되, 그 검토가 팀장과 같은 탭에 남아 있으면 팀원을 흔들지 않도록 아무것도 옮기지 않고 건너뛴다. 수동 `--layout`은 존재하는 검토를 항상 포함한다(외부 팀장 모드는 아래 §2.1 참조).
- Sidebar 등 다른 pane은 건드리지 않는다. 단, 임시 탭 경유 이동 때 그 임시 탭에 자동 생성된 agent 없는 Sidebar는 탭 닫기로 함께 정리한다.
- 적용 시점: 팀 구성·복구(`--spawn`, 그것을 부르는 시작 훅) 끝 + 수동 `--layout`. `/clear` 훅 경로는 이름·label 복구만 하며 배치를 건드리지 않는다.
- 방법: 모양(`pane layout`의 rect)이 맞으면 `pane resize`로 비율만 맞추고, 다르면 팀원·검토를 차례로 임시 탭에 뺐다가 `pane move --no-focus`로 되돌린다(같은 탭 안 `pane move`는 `same_tab`으로 무시되고, `pane swap`은 focus를 옮기므로 쓰지 않는다). 임시 탭에서 즉시 되돌리면 원래 탭에 agent 없는 pane이 하나 더 생기는 경쟁이 관측됐다(새 탭에 Sidebar를 비동기로 만드는 사용자 플러그인이 원인으로 추정). 그래서 임시 탭의 pane 수가 늘어 안정될 때까지 기다렸다가 되돌린다. 상한은 목록 조회를 포함해 이동마다 2.5초다(실측 생성 지연 최대 약 1초의 약 2배, Python 시작 등 프로세스 비용 제외). Sidebar가 없는 환경은 이동마다 이 상한만큼 기다린다(팀원·검토를 모두 옮기면 약 5초). 대기 중 목록 조회가 실패해도 pane은 되돌리지만 배치 실패(비0)로 끝난다. 되돌린 뒤 원래 탭에 새로 관측된 agent 없는 pane이 있으면 출처(플러그인·사용자)를 가리지 않고 닫지 않으며, 그 ID를 안내하고 배치 실패(비0)로 끝난다. 그 목록을 읽지 못해도 실패다. 플러그인이 상한보다 늦으면 그 pane이 원래 탭에 남을 수 있고, 이 검사보다 늦게 생기는 pane은 감지하지 못한다. 이미 목표 배치면 아무것도 바꾸지 않는다. 끝에 split 비율을 다시 읽어 0.6/0.5에서 0.01 안인지 확인한다. 사용자 focus는 바뀌지 않는다.
- 조건: 팀장 이름이 이 pane 소유, 팀원(그리고 포함하는 검토)이 팀장과 같은 탭, cwd가 저장소 안. 팀 구성 때는 조건이 안 맞으면 아무것도 옮기지 않고 stderr에 이유(`team layout skipped: ...`)만 남기며 실패가 아니다(다른 탭으로 뺀 pane은 사용자가 일부러 뺀 것으로 본다). 수동 `--layout`은 같은 경우(검토가 다른 탭인 경우 포함) 오류로 끝난다. 건너뜀은 정상 응답으로 확인된 불일치(agent `agent_not_found`, 다른 탭, 저장소 밖 cwd, 팀장 이름이 다른 pane)에만 쓴다. `agent get`·`pane get`·`pane layout` 조회나 JSON 파싱이 실패하면 두 모드 모두 아무것도 옮기지 않고 실패(`team layout failed: ...`, 비0)로 끝난다(예: 검토 pane의 tab을 읽지 못하면 다른 탭으로 보고 빼지 않는다).
- 빈틈없는 영역: 모양이 달라 옮겨야 할 때는 먼저 팀장·팀원(·포함하는 검토)이 한 분할 영역을 빈틈없이 채우는지 본다(`pane layout`에서 세 pane rect의 경계 상자가 split 하나의 rect와 같고, 그 안에 다른 pane이 없으며, 면적 합이 상자와 같음). 사이에 Sidebar나 사용자 pane이 끼어 있으면 옮기는 중에 그 pane이 커지거나 밀려나므로, 아무것도 옮기지 않고 두 모드 모두 실패(비0)로 끝난다. 다른 탭으로 뺀 pane과 달리 같은 탭 안의 끼어듦은 보정 실패로 본다. 이미 목표 모양이면 비율만 맞추므로 해당하지 않는다.
- 실패: 배치 실패는 agent 기동을 막지 않는다. 기동이 끝난 뒤 종료 코드만 비0으로 두고(기동 실패 코드가 우선) `--layout` 재실행 안내를 남긴다. 새 팀원을 만들 때 검토를 옮기는 배치 단계에서 실패가 있었으면 마지막 보정이 모양을 고쳐도 비0이다(실패를 숨기지 않는 쪽을 택함). 이동 실패의 사유(이동 불가·새 pane 관측·검사 불능)는 stderr 안내로만 구분한다. Codex 단계가 실패하면 agent 없는 검토 pane을 밀어내지 않도록 보정을 건너뛴다. 임시 탭에 agent pane이 남으면 닫지 않고 tab ID를 안내한다. 이 안내와 비0 종료 코드는 `--spawn`·`--layout`을 직접 실행할 때만 보인다. SessionStart hook은 `--spawn`을 백그라운드로 띄우고 출력을 버리므로, hook 경로의 배치 실패는 `herdr pane layout`으로 확인하거나 `--layout`을 직접 실행해 본다.

수동 실행: `scripts/team-up.sh`(이름·label만), `scripts/team-up.sh --spawn`(구현·선택 검토 팀원 포함, 끝에 배치 보정). `GJCH_TEAM_CODEX=0 scripts/team-up.sh --spawn`이면 agy 팀원만 구성한다. `scripts/team-up.sh --layout`(팀장 pane에서 실행)은 기본 동작 뒤 팀장·팀원·검토 pane을 위 배치 공식 기준으로 재배치한다. `--spawn` 끝의 배치 보정과 같은 로직이며, 조건이 안 맞으면 건너뛰지 않고 아무것도 옮기지 않은 채 오류(비0)로 끝난다. resize 실패·비율 미도달이면 성공 메시지 없이 비0이다. `herdr agent start`는 pane이 빈 셸 프롬프트 상태여야 하며, 성공은 예상 agent가 감지되고 입력 준비가 됐다는 뜻이다.

### 2.1 외부 팀장(herdr 밖, 데스크톱 Code 탭)

Claude 데스크톱 앱의 Code 탭(로컬 세션)이나 Herdr 밖 터미널의 `claude`를 팀장으로 쓰고, Herdr 작업공간에는 구현 팀원(agy)과 검토 팀원(Codex)만 두는 운영 방식이다.

1. **준비:** 데스크톱 앱 Code 탭에서 이 저장소 폴더로 새 세션을 연다. **worktree 옵션은 선택하지 않는다.** worktree 옵션은 새 세션 입력 화면의 브랜치 이름 옆에 있으며 시작할 때만 정할 수 있다. 선택하면 `<프로젝트>/.claude/worktrees/` 아래 별도 사본에서 실행되므로 쓰지 않는다(#43 이후 팀 스크립트는 연결 worktree에서 거절한다). 시작 후 `pwd; git rev-parse --show-toplevel`이 저장소 루트인지 확인한다. 데스크톱 Code 탭 로컬 세션에서는 Bash에서 `herdr`가 동작하고 `CLAUDE_CODE_SESSION_ID`와 `CLAUDE_CODE_MESSAGING_SOCKET`이 설정되어 있다.
2. **환경변수:** macOS 데스크톱 앱은 셸 프로필에서 `PATH`만 가져온다. 다른 환경변수는 데스크톱 앱 프롬프트 입력창의 환경 드롭다운 → `로컬 환경 편집` → `환경 변수`에 `GJCH_EXTERNAL_LEAD=1`을 넣어야 로컬 세션과 Bash에 전달된다(사용자 설정이므로 사용자가 직접 넣거나 승인 후 진행한다). 데스크톱 앱 밖 일반 터미널에서 Herdr 밖 `claude`로 쓸 때는 `GJCH_EXTERNAL_LEAD=1 claude`로 실행한다.
3. **자동 구성:** SessionStart hook(`scripts/team-up.sh --hook`)이 `scripts/team-lead.sh claim`으로 잠금을 확보하면 stdout에 `GJCH: 이 세션이 외부 팀장입니다(herdr 밖, 팀장 잠금 보유). 팀원 작업공간 'GJCH · gjc-herdr'을 확인·구성합니다.`를 출력하고, `clear`가 아니면 `--spawn`을 백그라운드로 실행한다. 잠금을 얻지 못하면(다른 세션이 보유 중이거나 정체 환경변수 누락) `GJCH: 팀장 잠금이 다른 세션(<kind> <sid8>)에 있어 이 세션은 팀장이 아닙니다. 팀원에게 배정·입력하지 마세요.`(정체 환경변수가 없으면 `GJCH: 세션 정체(CLAUDE_CODE_SESSION_ID·소켓)를 알 수 없어 이 세션은 외부 팀장이 아닙니다.`)를 출력하고 아무것도 하지 않는다.
4. **수동 명령:**
   - 팀원 기동·배치: `GJCH_EXTERNAL_LEAD=1 scripts/team-up.sh --spawn` 또는 `GJCH_EXTERNAL_LEAD=1 scripts/team-up.sh --layout`
   - 검토 전송: `GJCH_EXTERNAL_LEAD=1 scripts/critic-send.sh [--timeout <ms>] [--no-wait | --result <파일>] <지시서 파일>`(`critic-send.sh`는 외부 모드일 때 잠금이 `mine`인지 먼저 확인하고, label 조회 대신 검토 agent(`gjc-herdr-critic`)의 작업공간을 쓰며 팀원(`gjc-herdr-mate`)이 다른 작업공간에 있으면 전송하지 않고 rc `1`로 끝난다)
   - agy 배정: Herdr 안과 같이 `herdr agent prompt gjc-herdr-mate "<짧은 지시>"`를 쓴다. 세션 환경에 `GJCH_EXTERNAL_LEAD=1`이 이미 들어 있으면 앞의 환경변수 접두는 필요 없다.
5. **작업공간과 배치:**
   - 대상은 label `GJCH · gjc-herdr`(`GJCH_WS_LABEL`)인 작업공간이다. 기존 팀원(`gjc-herdr-mate` 또는 `gjc-herdr-critic`)이 있으면 그 작업공간을 쓴다.
   - 작업공간을 정할 때 기존 `gjc-herdr-mate`(종류 `agy`, 저장소 안 cwd)와 `gjc-herdr-critic`(종류 `codex`, 정확히 저장소 루트 cwd)의 정체와 같은 작업공간 여부를 먼저 한 번에 확인하며, 하나라도 어긋나거나 조회에 실패하면 어떤 pane도 만들거나 나누거나 옮기지 않고 즉시 중단(rc `1`)한다.
   - 기존 팀원이 없으면(`--spawn` 시) label로 작업공간을 찾거나 `--no-focus`로 새 작업공간을 만들고 label을 붙인다. 같은 label의 작업공간이 둘 이상이면 오류(`multiple workspaces found with label`)로 중단한다.
   - 배치는 한 탭 안 **왼쪽 `팀원(agy)` | 오른쪽 `검토(Codex)`(반반, 50:50)** 이다. `--layout`(및 `--spawn` 끝의 배치 보정)은 기존 pane을 임시 탭으로 옮기지 않으며, 두 pane이 같은 탭에 `팀원 | 검토` 좌우로 있을 때만 비율을 맞춘다(팀원만 있거나 Codex가 꺼져 있으면 아무것도 하지 않고 rc `0`). 단, 팀원 pane이 사라진 뒤 외부 `--spawn`이 새 팀원을 다시 만들 때는 예외로 기존 검토 pane을 반으로 나눠 새 팀원을 시작하고 검토를 임시 탭 경유로 오른쪽에 되돌려 `팀원 | 검토` 순서를 복구한다.
   - 새 작업공간과 탭에는 사용자 플러그인에 의해 Sidebar가 자동으로 생길 수 있다. Sidebar는 팀 스크립트가 쓰지 않는다. 닫을지는 사용자가 정한다(소유하지 않은 pane). 닫으면 `GJCH_EXTERNAL_LEAD=1 scripts/team-up.sh --layout`으로 비율을 다시 맞춘다.
6. **권한과 샌드박스:** 데스크톱 세션에서 `herdr` 명령마다 권한 요청이 뜨면 사용자 승인 후 허용 규칙을 추가할 수 있다. Bash 샌드박스를 쓰면 herdr 소켓(`~/.config/herdr/herdr.sock`)을 `sandbox.network.allowUnixSockets`로 허용해야 한다. 둘 다 사용자 설정이므로 사용자 승인으로만 바꾼다.
7. **한계와 세션 간 메시지:**
   - 외부 팀장은 팀원 화면을 텍스트(`herdr agent read`, `herdr pane read`)로만 읽는다.
   - `agy` 폴더 신뢰 창 같은 `blocked`에는 사용자가 Herdr에서 직접 답한다(명령·편집 확인창 위임은 §5와 동일).
   - `critic-send.sh`는 검토 pane의 `focused` 값으로 거부하지 않으며, 입력란(빈 흐린 placeholder·상태 줄·안내 줄)을 관측했을 때 draft가 있거나 형식을 판정할 수 없으면 거부한다(#46). 단, 확인한 뒤의 동시 입력은 막지 못한다(확인과 입력은 원자적이지 않다). 팀장은 사용자 포커스를 바꾸지 않는다.
   - 팀원 감시(백그라운드 루프)는 Herdr 안과 같은 명령을 쓴다.
   - 데스크톱 세션과 Herdr 안 Claude는 `SendMessage`/`ListAgents`(`/` 명령 `/list-agents`)로 서로 목록에 보이고 메시지를 주고받을 수 있다. 다른 세션의 메시지는 사용자 승인을 대신하지 않는다.

### 2.2 팀장 이관(herdr 팀장 → 외부 팀장 → 부팀장 종료)

1. 현 팀장(herdr 안)이 진행 중인 배정이 없는 것(팀원 `idle`/`done`)을 확인한다.
2. 현 팀장이 `scripts/team-lead.sh release`를 실행한다.
3. 새 팀장(외부 데스크톱 Code 탭 등)이 `scripts/team-lead.sh claim`을 실행한다(외부면 `GJCH_EXTERNAL_LEAD=1` 등 환경변수가 있어야 함). 또는 세션을 새로 시작해 SessionStart hook으로 확보한다. `scripts/team-lead.sh status`가 `mine`인지 확인한다.
4. 옛 팀장(herdr 안)이 `scripts/team-up.sh`(기본 모드)를 실행한다. 잠금이 다른 세션에 있으므로 부팀장 이름(`gjc-herdr-deputy`)과 label(`GJCH 부팀장 · Claude`)로 바뀐다. 이후 부팀장은 팀원에게 입력하지 않는다.
5. 부팀장이 있는 동안 부팀장과 팀장은 세션 간 메시지(`SendMessage`/`ListAgents`)로 소통한다.
6. 부팀장이 빠질 때는 Claude를 `/exit`로 정상 종료한다. 그 pane을 닫는 것은 사용자 승인으로 한다. 이후 외부 팀장이 `GJCH_EXTERNAL_LEAD=1 scripts/team-up.sh --layout`으로 `팀원 | 검토` 비율을 맞춘다(남은 모양이 좌우 `팀원 | 검토`와 맞지 않으면 옮기지 않고 건너뛴다).

- **되돌리기:** 외부 팀장이 `scripts/team-lead.sh release`를 실행하고, Herdr 안 Claude가 `scripts/team-up.sh`를 실행하면 잠금을 확보하고 팀장 이름(`gjc-herdr-lead`)과 label을 되찾는다.
- **만료 잠금:** 팀장 세션의 소켓이 사라지면 다음 `claim`이 자동으로 회수한다. 판정이 의심스러울 때만 사용자 승인 후 `scripts/team-lead.sh release --force`를 쓴다.

## 3. 새 컴퓨터에서 AI가 따를 환경 구축 절차

사용자가 저장소 주소(`https://github.com/mrsono0/gjc-herdr.git`)만 줬을 때 순서대로 진행한다.

1. **clone 후 점검**
   ```sh
   git clone https://github.com/mrsono0/gjc-herdr.git && cd gjc-herdr
   scripts/check-env.sh      # 읽기 전용. OK/WARN/FAIL을 항목별로 출력, FAIL이면 종료 코드 1
   ```
   FAIL을 아래 표대로 해결하고 다시 실행한다. WARN은 의미를 사용자에게 설명하고 필요한 것만 처리한다.

   | 항목 | 해결 |
   |---|---|
   | `agy` 없음 | 상시 구현 팀원(`gjc-herdr-mate`)이다. Antigravity CLI(`agy`) 설치 방법을 사용자에게 안내해 설치를 요청한다 |
   | `gjc` 없음 | GJC 본체는 이 저장소가 설치하지 않는다. 플러그인 설치·관측 대상이므로 README "필요한 프로그램" 표의 링크를 사용자에게 안내해 설치를 요청한다 |
   | `herdr` 없음 / Herdr pane 밖 | README "필요한 프로그램" 표대로 Herdr를 설치하고 **Herdr 안의 pane에서** Claude Code를 실행하도록 안내한다(팀 구성·token 표시는 Herdr가 실행 중이어야 동작). 단, `GJCH_EXTERNAL_LEAD=1`인 외부 팀장 모드(§2.1)에서는 Herdr pane 밖이 정상이며 `check-env.sh`가 `OK`로 보고한다 |
   | `codex` 없음 | 선택 검토 팀원이다. README의 Codex 설치 안내를 따르거나 `GJCH_TEAM_CODEX=0`으로 끈다 |
   | `bun` 없음 또는 버전 불일치 | GJC plugin 설치에 필요. build는 `package.json`의 `engines.bun`(1.4.3) 고정 |
   | `node_modules` 없음 | `npm ci --ignore-scripts --no-audit --no-fund` (개발·테스트 시) |
   | `team-up.sh` 실행 권한 없음 | `chmod +x scripts/team-up.sh scripts/check-env.sh` |
   | `gjc-herdr` 플러그인 미설치 | README "설치 (한 줄)"과 "AI 에이전트 설치 지침"을 따른다 |
   | sidebar 설정 없음 | README "Sidebar 설정". `~/.config/herdr/config.toml`은 **사용자 설정이므로 사용자 승인 후** 기존 행을 보존한 채 추가만 한다 |

2. **개발 도구 확인(선택)**: `npm run check`, `npm test` (mock 단위 테스트), `bun scripts/build.ts`(source 변경 시에만, dist와 함께 commit).
3. **팀 자동 구성 확인**: 사용자가 Herdr pane에서 이 폴더로 `claude`를 새로 시작하게 한 뒤 `herdr agent list`로 확인한다. `gjc-herdr-lead`(Claude)와 `gjc-herdr-mate`(agy), Codex를 켰고 설치돼 있으면 `gjc-herdr-critic`도 확인한다. 구성 예정인 agent가 보이지 않으면 `scripts/team-up.sh --spawn`을 수동 실행하고 stderr 안내를 읽는다(`agy`가 폴더 신뢰 창이나 다른 질문으로 시작 중 멈춰 `blocked` 안내가 나오면 사용자가 그 pane에서 직접 확인·응답한 뒤 `--spawn`을 다시 실행한다). 팀원·검토의 cwd(저장소 루트)와 label도 실제 응답으로 확인한다. 배치는 `herdr pane layout --pane <팀장 pane>`으로 §2의 배치 공식 기준과 맞는지 확인하고, `team layout skipped`가 남았으면 그 이유를 보고한다. **hook은 Claude 재시작 시 자동 실행되는지 새 컴퓨터에서 처음 한 번 실제로 확인한다.**
4. **보고**: 점검·플러그인·team-up·표시를 각각 실제 출력으로 구분해 보고한다.

금지: GJC·Herdr 본체 수정, 사용자 credentials·PATH·권한·다른 플러그인 변경, 소유하지 않은 pane 종료, 승인 없는 commit·push·tag·전역 설치.

## 4. 팀장 ↔ 구현 팀원·검토 팀원 대화 방법

상시 구현 팀원은 Herdr 감지 agent인 `agy`(`gjc-herdr-mate`)이며, GJC는 플러그인 실사용 관측이 필요할 때만 팀장이 임시 탭에 띄운다.

- **팀장 → 구현 팀원 (Claude → agy):** 상세 내용은 지시서 파일(예: `.local/agy/<이슈>-brief.md`)로 쓰고, 짧은 지시를 `herdr agent prompt`로 보낸다.
  ```sh
  herdr agent prompt gjc-herdr-mate ".local/agy/<이슈>-brief.md 를 읽고 진행해 줘."
  ```
  완료는 Herdr 상태(`done`)가 아니라 지정한 결과 파일과 `agy` 화면 하단 `task(s)` 표시로 판단한다. 빈 답·결과 파일 없음은 실패로 본다.
- **구현 팀원 → 팀장 (agy → Claude):** 상세 결과와 검증 출력은 결과 파일(예: `.local/agy/<이슈>-result.md`)만 쓴다. sandbox에서 `herdr agent prompt`가 막히므로 `agy`는 셸로 팀장에게 알리지 않는다. 팀장은 백그라운드 감시로 결과 파일·`agent_status`(`blocked` 포함)·화면을 보고 완료와 확인창을 판단한다.
- **팀장 → 검토 (Claude → Codex):** 자체 완결 지시서 파일을 스크립트로 보낸다. 같은 workspace의 저장소 루트에서 실행 중인 소유 Codex가 idle/done일 때만 시작하며, 빈 입력란 확인 → 필요 시 `/new`·새 화면 준비 확인 → pane ID로 전송·working 수락 확인 → 전송 뒤 이름 확인·필요 시 재등록 → 고정 pane의 완료 대기를 수행한다.
  ```sh
  scripts/critic-send.sh <지시서 파일>                    # 기본 30분
  scripts/critic-send.sh --timeout 3600000 <지시서 파일>   # 대기 한도 1시간
  scripts/critic-send.sh --no-wait <지시서 파일>           # 수락까지 확인하고 반환
  scripts/critic-send.sh --result .local/critic/<이슈>-r<회차>.md <지시서 파일>  # 결과 파일로 완료 판정(권장)
  ```
  화면은 `--source visible --format ansi`로 읽으며, 마지막 0번째 칸 `›` 뒤의 정확한 placeholder 문구가 **전부 흐림(dim)**일 때만 빈 입력란으로 인정한다. 같은 문구를 직접 친 draft·일부만 흐린 문구·흐림 정보가 없는 화면은 거부한다. SGR은 `src/input.ts`와 같이 `0`·`22`가 흐림을 해제하고 `2`가 흐림을 설정하며, RGB·팔레트 색상 인자 및 콜론 형식 안의 숫자를 흐림 코드로 오인하지 않는다. 잘린 SGR·해석할 수 없는 색상 인자·다른 escape도 거부하며, ANSI 없는 텍스트 판정으로 되돌리지 않는다.
  이름은 `team-up.sh`와 같은 `GJCH_CRITIC_NAME`을 사용하고, 대상의 cwd가 저장소 루트인지 확인한다. 뒤가 비었거나 공백뿐인 줄도 포함해 줄 맨 앞(0번째 칸)의 `›`만 입력란 후보로 확인한다. 공백·탭으로 들여쓴 `›`는 여러 줄 draft의 내용일 수 있어 후보로 보지 않는다. 마지막 후보가 정확한 빈 placeholder(`Ask Codex to do anything`)가 아니면 거부하며 draft를 자동 삭제하지 않는다. `›`만 있는 줄은 빈 입력란으로 간주하지 않는다. 마지막 입력란 뒤에는 빈 줄 외에 상태 줄 1개와 그 뒤의 알려진 안내 줄(`← for agents · ? for shortcuts` 또는 `? for shortcuts`) 0~1개만 허용한다(두 형식 모두 안내 줄 생략·알려진 접두부의 말줄임은 허용). 안내 줄 뒤 공백으로 구분된 `⚠ <숫자> warning(s) · f2 to view` 또는 경고 표시만 있는 줄도 허용하며, 경고의 알려진 접두부가 잘린 꼴도 허용한다. 마지막 후보 뒤에 이어지는 비어 있지 않은 입력 줄·본문·두 번째 상태 줄·임의 꼬리말은 계속 거부한다. 이 상태 줄(앞에 모델·브랜치 등 ` · `로 구분된 항목이 있는 형식과 앞 항목 없이 `Context`로 바로 시작하는 형식 모두 허용)에서 `Context 100% left`와 완전히 보이는 누적 입력 `0 in`을 확인하면 `/new` 없이 보낸다(출력 카운터도 완전히 보이면 `0 out`이어야 한다). 누적 입력 카운터는 숫자 뒤 공백까지 보이면 그 숫자를 완전한 값으로 보므로 `0 i…`·`0 in…`도 새 대화 근거가 되고, 구분자나 숫자 중간에서 잘리면(`0…`, `240K…` 등) 형식으로는 받되 입력이 0인지 알 수 없으므로 새 대화로 보지 않고 `/new`를 보낸다. 56칸 배치에서 `GPT-6.1-Sol default` 모델의 상태 줄이 `0 i…`까지 보이려면 브랜치 이름이 3자 이하여야 한다는 제약(`i27`에서 딱 `0 i…`까지 관측)은 `team-up.sh`가 띄운 짧은 상태 줄 Codex에는 해당하지 않고, 모델·브랜치가 포함된 사용자 설정 상태 줄로 떠 있는 Codex에만 해당한다. 출력 tail은 완전한 카운터·숫자 카운터의 잘림·구분자의 말줄임만 허용하고 `unrecognized…` 같은 임의 문구는 거부한다. 헤더·잘린 출력 카운터나 scrollback의 과거 문자열은 새 화면 근거로 쓰지 않는다. 판정 불가 시 pane이 확인 크기 56×10보다 작으면 현재 W×H와 확대 안내를 남긴다. 그 이상이면 상태 줄·안내 줄 형식을 판정할 수 없다고 안내하고 마지막 화면 6줄을 함께 출력한다. 모델 이름과, 저장소에서 실행하면 상태 줄에 붙는 브랜치 이름에 따라 필요한 폭이 달라진다(긴 브랜치 `issue-13-critic-repo-root`에서는 82칸이 필요했다). 그래서 브랜치 이름은 `i<이슈번호>`처럼 짧게 만든다(`i14`에서 62칸으로 전송 확인). Codex는 브랜치를 바꿔도 다음 대화 전까지 이전 브랜치 이름을 그대로 표시한다. 기존 대화에서는 send-text 뒤 입력란에 `/new`가 보일 때까지 1초 간격·최대 5초 관측하고, 보이면 Enter를 한 번만 보낸다. 보이지 않으면 코드 2로 끝내며 Enter·지시서는 보내지 않는다. git 저장소에서는 Codex가 `/new` 뒤 "Where should the new conversation run?" 메뉴를 띄운다. 화면 최하단 블록이 이 메뉴일 때(마지막 줄이 `enter select · esc back`이고, 그 위 질문 줄과의 사이에 0번째 칸 `›` 선택 줄이 하나)만 메뉴로 보며, 선택 표시가 `› 1. Use current Git worktree`에 있을 때만 Enter를 한 번 보낸다. 위에 남은 옛 메뉴 글자나 같은 문구의 draft는 메뉴로 보지 않는다. 다른 항목이 선택돼 있거나 Enter 뒤 1초 간격 세 관측 동안 메뉴가 남으면 코드 2로 끝내며 Esc·재입력·지시서 전송은 하지 않는다. `/new` 뒤 새 화면과 revision/상태 seq 변경·idle/done·`interactive_ready`를 함께 판정하고, 관측 반환 뒤 준비 한도 30초·전체 한도를 넘었으면 지시서를 보내지 않는다. Codex는 `/new` 뒤 새 빈 화면(idle)을 보인 다음 약 0.5초 뒤 잠깐(약 1초) working이 됐다가 done으로 돌아오므로, 새 빈 화면·idle/done·같은 상태 seq를 1초 간격 세 번 연속 관측해야 준비로 본다(worktree 메뉴 관측·Enter가 끼면 처음부터 다시 센다). 그 뒤 전송 직전 확인에서 대상·이름은 맞고 상태가 working이면 거부하지 않고 같은 준비 한도 안에서 다시 기다린다(worktree 메뉴 선택 Enter 전도 같다). working이면 `interactive_ready` 값과 무관하게 기다리고, working이 아닌데 idle/done·`interactive_ready`가 아니거나(blocked·unknown 포함) 다른 대상이면 그 관측에서 바로 거부한다. 준비 대기 중에는 `interactive_ready`가 참이 되기 전까지 준비로 세지 않는다. 준비 대기 중 입력란의 글은 위처럼 1초 간격 두 관측에서 남으면 중단하고, 전송 직전 확인에서 빈 새 입력란이 아니면 바로 중단한다. 세 번 연속 관측은 이미 시작된 working을 거르는 것이며(대기 구간은 약 2초), 그 뒤에 시작되는 working을 막지는 못한다. 마지막 확인과 지시서 prompt 사이도 원자적이지 않다. `team-up.sh`가 띄우는 Codex는 `--disable worktrees`(= `-c features.worktrees=false`)와 `-c 'tui.status_line=["context-remaining","total-input-tokens","total-output-tokens"]'`(모두 사용자 설정을 바꾸지 않고 이 프로세스에만 적용)로 시작해 `/new`의 worktree 메뉴가 뜨지 않고(managed worktree 생성·목록 도구도 꺼짐) 56칸 검토 pane에서도 상태 줄이 잘리지 않는다. 메뉴 처리와 앞 항목이 있는 상태 줄·잘림 처리는 이 인자 없이 떠 있는 기존 Codex를 위해 남긴다. `/new`·Enter 뒤 1초 간격 두 관측에서 미제출 글이 남으면 코드 2로 끝내며 지시서·Enter를 재전송하거나 글을 삭제하지 않는다. `--timeout`은 1–86400000ms(24시간), 입력 최대 9자리이며 선행 0은 허용한다. bash 3.2의 `SECONDS`(1초 해상도)로 측정하며 초 단위로 올림한다. 완료 대기에서는 한도를 넘겨 반환된 done/idle도 완료로 받으며, 아직 미완료인 채 한도를 넘으면 코드 2로 끝낸다. 하위 herdr 명령이 반환하지 않으면 스크립트 한도로 끊지 못한다. 필요하면 Ctrl-C(130) 뒤 안내를 따른다. 종료 코드 1은 조건 거부·확인 실패(지시서 전송 전 준비 timeout 포함), 2는 `/new`·지시서 전송 불확실·미제출 또는 완료 대기 timeout, 4는 `--result`를 줬는데 Codex가 idle/done으로 돌아온 뒤에도 결과 파일이 전송 전보다 새로 쓰이지 않은 경우다(예: 모델 용량 초과로 실행 실패). 4이면 Codex 화면 마지막 8줄을 함께 출력하며, 그 회차는 끝났으므로 원인을 확인한 뒤 같은 지시서를 다시 보낼 수 있다. idle/done은 Codex의 실행 실패와 정상 완료를 구별하지 못하므로 `--result`를 늘 붙인다. 결과 파일은 경로 자체가 비어 있지 않은 일반 파일이어야 하며 심볼릭 링크는 인정하지 않는다. 상대 경로는 저장소 루트 기준이고 `--no-wait`와 함께 쓰지 않는다. SIGINT/SIGTERM으로 끝날 때도 전송 시도 뒤 안내를 남긴다(130/143). 전송 시도 뒤 중단하거나 `--no-wait`로 반환하면 재전송하지 말고 공개 상태와 결과 파일로 완료를 확인한다. 대상·입력란 확인과 입력은 원자적이지 않으며, 화면 형식이 달라지면 안전하게 거부한다.
  스크립트를 못 쓸 때만 수동으로 **소유 pane·idle/done·빈 입력란 확인 → 기존 대화이면 `/new`·새 입력란 준비 관측 → `herdr agent prompt <pane-id> "<지시서>" --wait --timeout <ms>` → 전송 뒤 이름 확인** 순서를 따른다. `interactive_ready`나 고정 sleep만으로는 준비를 판단하지 않는다. 이름이 풀렸으면 다른 pane이 점유하지 않았음을 확인하고 `herdr agent rename <pane-id> gjc-herdr-critic`으로 다시 붙인다. 완료 대기는 이름이 풀려도 고정 pane·terminal·workspace·cwd로 계속하며, 다른 이름으로 바뀌면 중단한다.
  지시서 첫머리에 제1원칙(파일 수정이 필요하면 먼저 팀장 허락)을 적고, 결과는 **지정한 gitignore 경로의 파일**(예: `.local/critic/<이슈>-r<회차>.md`)로 쓰고 경로를 회신하도록 적는다. pane 출력은 접혀 보일 수 있고 working 중에는 read가 불가하므로, 완료·idle/done을 확인한 뒤 그 파일을 읽어 본문을 받는다. Codex → 팀장 직접 호출은 기대하지 않는다(샌드박스는 없지만 직접 호출 경로는 미확인이다). timeout이면 자동 재전송·`/new` 입력을 하지 말고 공개 상태와 결과 파일의 완료 여부부터 확인한다.
- 큰 근거·로그는 채팅에 붙이지 말고 파일 경로와 sha256으로 공유한다.

### GJC 관측 절차 (필요할 때만 임시 실행)

GJC는 상시 팀원이 아니며, 플러그인 로드·token 표시·`/herdr-send`·`/herdr-call` 실동작 관측이 필요할 때만 팀장이 임시 탭을 만들어 띄우고 관측한 뒤 닫는다.

1. **기동:** 팀장이 임시 탭(또는 임시 pane)을 `--no-focus`로 만들고 `gjc --mpreset opus5-codex56-pro`를 실행한다.
2. **메시지 채널 (GJC 관측을 띄웠을 때 한정):**
   - **팀장 → GJC 관측 세션:** GJC는 Herdr 감지 agent가 아니라 상태 보고만 있어 `herdr agent prompt`가 `agent_not_ready`로 거절된다. `herdr pane get <pane-id>`에서 `tokens.gjc_herdr_session_id`를 확인해 `gjc sdk session send <session_id> --text "<요청>" --wait --timeout-ms 120000`으로 보낸다(읽기 전용 관찰은 `gjc sdk session tail <session_id> --json`). `endpoint_stale` 등으로 실패하면 재전송하지 않고 `GJC_SDK_BROKER_AUTOSTART=0 gjc sdk session list --attach-only --scope all`로 기존 broker에 해당 세션 ID가 등록돼 있는지 확인하며, 목록에 없으면 정상 종료(`/exit`) 후 다시 띄운다.
   - **GJC 관측 세션 → 팀장 등 감지 에이전트:** 이 플러그인의 `/herdr-call` 또는 `herdr_agent_call`(대상 `gjc-herdr-lead` 등)을 써서 호출·회수한다(외부 팀장 모드에서는 팀장에게 Herdr pane이 없어 `gjc-herdr-lead` 호출이 `No Herdr agent is named gjc-herdr-lead`(delivery `not_sent`)로 실패한다 — 2026-10-16 실측, 구조상의 결과이며 플러그인 결함이 아니다. 팀장은 `send --wait` 응답 JSON의 `result.statusDetail.content.text`로 답을 받고, 지난 출력은 `gjc sdk session tail <session_id> --json`으로 다시 읽는다). 입력 보호를 거치지 않는 bash의 `herdr agent prompt`·`herdr pane send-text`/`send-keys` 직접 호출은 하지 않는다.
   - **슬래시 명령:** `/rename` 등은 SDK 텍스트로 실행되지 않는다. 필요하면 사용자 승인 후 대상 pane의 idle·비포커스·빈 입력란을 먼저 확인하고 `herdr pane send-text <pane-id> "/명령"` + `herdr pane send-keys <pane-id> enter`를 쓴다(`pane` 명령은 pane ID만 받는다).
3. **종료·정리:** 관측과 근거 수집이 끝나면 임시 GJC를 `/exit`로 정상 종료하고 팀장이 만든 임시 탭을 닫는다.

### 우편 받기(팀장)

- 팀장은 `scripts/mail-watch.sh <받는이>`를 Bash `run_in_background`로 띄워 대기 우편을 감시한다.
- 감시 종료 코드가 `0`이면 출력된 **모든 경로**를 읽고 `scripts/mail-ack.sh <받는이> <id> received|rejected [사유]`로 ack한 뒤 감시를 다시 띄운다. 종료 코드가 `2`(시간 한도)이면 그대로 다시 띄우고, `1`이면 stderr를 확인해 사용자에게 알리며 원인을 고치기 전에는 다시 띄우지 않는다.
- `scripts/mail-ack.sh`가 실패하면 감시를 다시 띄우지 않고 원인을 해결하거나 사용자에게 알린다. `mail-ack.sh`는 한 번에 하나씩(단일 팀장 세션, 직렬 호출) 실행한다. 동시에 같은 id로 실행하면 나중 결과가 앞 결과를 덮어쓸 수 있다(`uncertain` 교체 구간).
- 다음 세 시점에는 활성 감시와 별도로 `scripts/mail-watch.sh <받는이> --timeout 0`으로 남은 우편을 손으로 확인한다: (1) 세션 시작·재개 때, (2) 작업 단계가 끝날 때, (3) 팀원 결과 감시를 다시 띄울 때.
- 팀장이 GJC에게 우편을 보낼 때는 `scripts/mail-send.sh <받는이> --from <팀장 이름> --subject <제목> --body-file <경로>`(또는 `-`로 stdin 전달)를 쓴다.

## 5. 협업 규칙(요약)

- 사용자 지시는 팀장이 받는다. 팀원이 직접 받으면 팀장에게 요약해 알리고, 범위 확대는 팀장 확인 후 한다.
- 배정에는 목적 한 줄, 맡길 결과, 쓰기 허용 파일(최대 3–5개), 범위 밖 읽기 금지, 금지 사항, 회신 방식, 배경(상대에게 대화 이력이 없다고 가정)을 적는다. 같은 파일을 동시에 쓰지 않는다.
- 팀원은 관측 사실 / source 근거 / 가설 / 미확인을 구분해 보고하고, 팀장은 직접 확인한 사실만 사용자에게 보고한다.
- **문서 확인(Context7)**(`AGENTS.md` "문서 확인(Context7)" 참조): 구현 팀원(agy, GJC)과 검토·조사 팀원(Codex)은 외부 라이브러리·프레임워크·CLI·SDK의 API, 옵션, 버전별 동작을 쓰거나 판정하기 전에 기억에 기대지 말고 Context7으로 최신 문서를 먼저 확인한다. 로컬 바이너리의 `--help`·소스·실측이 우선이며, 둘이 다르면 로컬을 따르고 차이를 결과 파일에 적는다. 결과 파일에는 라이브러리 ID와 확인 내용을 짧게 적고, 문서 버전·날짜는 응답에 있을 때만 적으며 없으면 "버전·날짜 미제공", 라이브러리를 찾지 못했으면 "Context7 미수록", 라이브러리는 있으나 관련 문서를 찾지 못했으면 "관련 문서 미확인"이라고 적고 사용한 다른 근거를 적는다. 도구 미노출·sandbox 차단·연결 실패면 우회하거나 설정을 바꾸지 않고 사유를 결과 파일에 적은 뒤 허용된 로컬 근거로 진행하며, 각 도구의 Context7 설정은 모두 사용자 설정이므로 바꾸지 않는다. 예외로 agy의 읽기 전용 Context7 도구 두 개(`query-docs`, `resolve-library-id`)는 사용자 승인(#41)으로 영구 허용돼 확인창 없이 쓴다. 질의에는 코드·비밀값·개인정보·내부 경로를 넣지 않는다.
- **agy 운용 조건**(`AGENTS.md` 참조): 빈 답·결과 파일 없음은 실패로 본다. 완료는 Herdr 상태(`done`)가 아니라 결과 파일과 화면 하단 `task(s)` 표시로 판단한다. 자기 검증은 팀장이나 검토가 다시 실행해 확인한다. agy가 보고한 해시(sha256)·파일 경로·검증 출력은 그대로 옮겨 쓰지 않고, 팀장이 직접 계산·대조·재실행해 확인한다. Codex 검토 자료(`.local/critic/` 아래 지시서·diff·사본·결과)는 agy의 쓰기 허용 목록에 넣지 않으며, agy는 그곳에 쓰지 않는다. 환경 문제가 생기면 탐색하지 말고 멈추고 묻는다. commit·push·설치를 금지한다. `.gjc/RULES.md`는 자동으로 실리지 않으니 필요한 규칙은 지시서에 넣는다. 실행 옵션을 `--mode accept-edits --sandbox`로 두는 이유는 공통 설정이 `proceed-in-sandbox`라서, sandbox 안의 셸·편집은 무확인이고 sandbox 밖 실행만 확인하기 때문이다. sandbox 안에서는 홈 설정 파일을 읽는 `git`·`gh`가 실패하므로(`~/.gitconfig`·`~/.config/gh` 접근 거부) diff·이슈 확인은 팀장이 하고, 필요한 배경은 지시서에 싣는다. 폴더 신뢰 창은 사용자가 답한다. 명령·편집 확인창은 팀장이 명령 원문을 확인한 뒤 "이번만"(1번)으로만 답한다. 대화 한정·영구 저장(`settings.json`) 선택지는 사용자 승인으로만 쓴다. 확인창의 명령이 잘려 보이면 `herdr pane zoom <agy pane>`으로 키우고, 확인창에서 `ctrl+g`(Full Command 보기)로 전문을 읽은 뒤 `esc`로 확인창에 돌아오고, `herdr pane zoom`으로 원래 크기로 되돌린다. 전문을 다 읽을 수 없으면 확인창의 취소 선택지(4번 "No, cancel")를 고르고 짧은 명령이나 편집 도구로 나눠서 다시 하게 한다(이 절차는 CF 팀 관측에서 가져왔고 이 저장소에서 독립 재현하지 않았다). 이 위임은 배정 범위 안의 작업에만 적용되며 commit·설치·사용자 설정 변경 등 기존 승인 경계를 넓히지 않고, 폴더 신뢰·그 밖의 질문 UI는 사용자에게 확인한다. `~/.gemini/antigravity-cli/settings.json`은 이 머신의 모든 `agy`가 함께 쓰는 사용자 설정이다. 이 저장소 작업에서는 직접 편집하지 않는다. 예외로 사용자 승인(#41)에 따른 `context7/query-docs`·`context7/resolve-library-id`의 영구 허용만 확인창에서 저장할 수 있다. 다른 설정은 바꾸지 않는다.
- 검토 요청은 빈 새 대화에서 시작한다. 이미 빈 새 화면이면 그대로 보내고, 기존 대화이면 idle/done·빈 입력란을 확인한 뒤 **`/new`**를 한다. 이전 회차·팀장 설명에 끌려가지 않도록 독립성을 유지하기 위한 규칙이다. 진행 중이거나 승인·질문 UI가 있으면 새 대화를 강제로 시작하지 않는다.
- 검토 지시서는 대화 이력이 없어도 수행 가능한 자체 완결 문서다. 2회차라면 1회차 지적 목록·근거 파일 경로·sha256을 새 지시서에 싣는다.
- 구현(agy)과 검토·조사(Codex)를 같은 회차에 섞지 않는다. **Codex의 제1원칙: 파일 수정이 필요하면 먼저 팀장 허락을 받는다.** 지시서가 지정한 결과 파일 외에는 쓰지 않고, commit·적용은 하지 않는다. **`--yolo`는 사용자 지시이고 샌드박스가 없으므로 이 원칙은 규칙(`AGENTS.md`·지시서)으로 지킨다.** 검토 결과가 팀장 검증이나 사용자 승인을 대신하지 않는다.
- Codex는 Herdr로 다른 pane에 입력하거나 다른 agent의 승인·질문 대화상자에 응답하지 않는다. 임시 GJC 관측 세션의 다른 에이전트 전송은 플러그인 명령·도구로만 한다. 각 역할의 이 규칙도 배정 지시서에 적는다.
- 확인된 요구 없이 기능·테스트·추상화를 늘리지 않는다(최소 구현).
- 다른 프로젝트의 agent·workspace(다른 workspace의 이름이 다른 agent)는 팀원이 아니므로 호출·입력하지 않는다.
- 팀 공통 규칙의 정본은 git으로 추적하는 루트 `AGENTS.md`다. agy, GJC, Codex는 저장소 루트에서 이를 자동으로 읽는다. 작업 기록·검증 증거는 이 파일에 쓰지 않고 비추적 `.local/`에 둔다.

## 6. 자주 있는 문제

| 증상 | 원인·조치 |
|---|---|
| 팀원 pane이 안 생김 | hook이 가드에서 종료됨(Herdr 밖, cwd가 프로젝트 밖, `GJCH_TEAM_ROLE` 설정, `herdr`/`python3` 없음) 또는 `agy` 없음. `scripts/check-env.sh`와 `scripts/team-up.sh --spawn` 출력 확인 |
| `agy not found` / `check-env.sh`에서 `agy 없음` FAIL | 상시 구현 팀원(`gjc-herdr-mate`)용 Antigravity CLI(`agy`)가 PATH에 없다. 사용자에게 `agy` 설치를 안내한 뒤 `scripts/team-up.sh --spawn`을 다시 실행한다 |
| `agy`가 시작 중 멈춤 (`agent start`가 `agent_not_ready`이고 pane 상태가 `blocked`, 또는 기존 `gjc-herdr-mate`가 여전히 `blocked`) | 처음 저장소를 열 때의 폴더 신뢰 창이나 다른 질문 UI에서 멈춘 상태일 수 있다. 스크립트는 자동 응답하지 않으며(사용자 결정) 비0으로 끝난다. 첫 기동(`agent start`) 실패는 불확실성 안내와 원래 오류(`code`·`message`)를 함께 출력하고, 이미 이름이 붙은 기존 팀원이 `blocked`이면 현재 상태와 확인 안내만 출력한다. 그 pane에서 사용자가 직접 확인·응답한 뒤 `scripts/team-up.sh --spawn`을 다시 실행한다. 응답 뒤 `idle`/`done`·`interactive_ready=true`이거나 `working`이면 새 pane을 만들거나 재시작하지 않고 유지·통과한다. 첫 기동에서 pane 상태가 `working`이거나 상태 조회 실패·기타 기동 오류이면 신뢰 창 안내 없이 원래 오류와 함께 일반 실패로 끝난다 |
| `agy`가 작업 중 `blocked` | sandbox 밖 실행이나 편집 확인창일 수 있다. 화면을 보고 §5 "agy 운용 조건"의 응답 규칙을 따르며, 명령이 잘려 보이면 §5의 전문 확인 절차를 따른다 |
| Codex pane이 안 생김 | `codex` 없음 또는 `GJCH_TEAM_CODEX=0`이면 선택 단계 생략. 기존 critic이 있으면 새 pane을 만들지 않음. `scripts/team-up.sh --spawn`의 stderr를 확인 |
| 조회 실패(`could not look up agent ...`)로 팀원·검토를 만들지 않음 | `herdr agent get` 조회나 JSON 파싱이 실패하면 부재(`agent_not_found`)로 추정하지 않고 그 단계를 비0으로 끝낸다. `herdr agent list`로 Herdr 상태를 확인한 뒤 `scripts/team-up.sh --spawn`을 다시 실행한다 |
| Codex가 "Trust and continue" 화면에서 멈춤 | 처음 저장소 폴더에서 실행하면 Codex가 폴더 신뢰를 묻는다(Herdr 상태는 idle로 보일 수 있음). 사용자 설정(`~/.codex/config.toml`)에 기록되므로 사용자 승인 후 선택한다. 그 전에는 `critic-send.sh`가 형식 판정 불가로 거부한다 |
| `critic-send.sh`가 `/new` 직후 "대상 거부: … 상태=working" | `/new` 뒤 Codex의 일시적인 working을 준비 전에 본 옛 버전(#22 이전) 증상이다. 화면이 이미 새 빈 대화(`Context 100% left · 0 in · 0 out`)이고 idle/done이면 같은 명령을 다시 실행해도 `/new` 없이 보낸다(지시서는 아직 보내지 않은 상태). 현재 버전은 준비 한도 안에서 기다린다 |
| `critic-send.sh`가 `/new` 뒤 "새 입력란 준비 확인 timeout" | `/new` 뒤 Codex가 30초 넘게 working이었다. 실측 1회는 Codex 경고 `MCP client for codex_apps failed to start: … timed out awaiting tools/list after 30s`와 함께였다(보통 1–4초). 지시서는 보내지 않았으므로, done/idle과 새 빈 대화를 확인한 뒤 다시 실행하면 `/new` 없이 보낸다 |
| Codex `/new`가 "Where should the new conversation run?" 메뉴를 띄움 | `--disable worktrees` 없이 떠 있는 Codex다. `critic-send.sh`가 1번(현재 worktree) 선택에만 Enter를 보낸다. 없애려면 사용자 승인 후 그 Codex를 정상 종료하고 `scripts/team-up.sh --spawn`으로 다시 띄운다. `codex features disable`은 전역 영구 설정이라 쓰지 않는다 |
| `critic-send.sh`가 "대상 거부" | critic의 cwd가 저장소 루트가 아니면 거부한다(예: 이전 버전이 만든 `../gjc-herdr-codex-work`의 critic). 사용자 승인 후 그 Codex를 정상 종료하고 `scripts/team-up.sh --spawn`으로 다시 띄운다 |
| `/clear` 뒤 팀장 이름(`gjc-herdr-lead`)이 사라짐 | 셸에서 실행한 Claude에 붙인 이름은 `/clear`로 세션 ID가 바뀌면 Herdr가 지운다. 이제 `clear` SessionStart hook이 팀장 이름·label만 다시 붙이며, 팀원·검토 pane은 새로 만들지 않는다. 복구되지 않으면 `scripts/team-up.sh`를 수동 실행해 이름·label을 되찾는다 |
| 팀장·팀원·검토가 세로로 쌓이는 등 배치가 어긋남 | 팀 구성(`--spawn`·시작 훅)은 끝에 §2 배치 공식 기준으로 보정하지만, 팀원이 다른 탭인 등 조건이 안 맞으면 `team layout skipped: ...`만 남기고 옮기지 않는다. 팀장 pane에서 `scripts/team-up.sh --layout`을 실행한다. "nothing moved"면 이유(다른 탭·cwd·이름 없음)를 고친 뒤 다시 실행한다. "could not move ... back from temporary tab"이면 안내된 임시 탭의 pane을 수동으로 되돌린다. 외부 팀장은 `GJCH_EXTERNAL_LEAD=1 scripts/team-up.sh --layout`으로 왼쪽 팀원·오른쪽 검토의 비율을 50:50으로 맞춘다(두 pane이 이 순서로 나란히 있지 않으면 옮기지 않는다. §2.1 5번 참조). |
| 탭을 보거나 포커스한 뒤 Sidebar가 열리며 팀장·팀원·검토가 세로로 쌓임 | herdr-sidebar v0.15.1이 오른쪽 끝 pane이 전체 높이가 아닌 배치(팀장 위 전체 폭)를 다시 쌓고, 닫아도 되돌리지 않는다(#53, alexarthurs/herdr-sidebar#114). 팀장 pane에서 `scripts/team-up.sh --layout`을 실행하면 Sidebar가 열린 채여도 원래 배치로 복구된다(#54에서 시험). 외부 팀장의 `팀원 \| 검토` 탭은 오른쪽 끝 pane이 전체 높이라 쌓이지 않는다 |
| agent 이름이 이미 사용 중 | 다른 pane이 점유 중이라 label을 건드리지 않음(의도된 동작). 이름은 pane 종료·교체 시 사라짐 |
| sidebar에 모델·세션이 안 보임 | 플러그인 설치됨 ≠ 로드됨 ≠ 표시됨. 실행 중이던 GJC를 재시작하고 `herdr pane get <pane-id>`의 token을 확인, 이후 README "Sidebar 설정" |
| `agent_not_ready` | 대상이 감지되지 않았거나 working/blocked. `team-up.sh --spawn`의 `agy` 기동에서는 `error.code == "agent_not_ready"`이고 해당 pane의 `agent_status`가 `blocked`일 때만 폴더 신뢰 창·질문 확인 안내를 내며, `working`·조회 실패 등은 일반 실패로 끝난다. 임시 GJC 관측 세션 대상은 위 §4 "GJC 관측 절차"의 SDK 경로를 쓴다 |
| 임시 GJC 관측 세션에 대한 `gjc sdk session send`의 `endpoint_stale` | 재전송하지 않고 `operationRef`·상태를 보존한다. `GJC_SDK_BROKER_AUTOSTART=0 gjc sdk session list --attach-only --scope all`에서 해당 GJC token의 세션 ID 등록을 확인한다(endpoint 파일·포트 존재 ≠ 등록, 조회 실패 ≠ 누락). 성공한 목록에 없으면 정상 종료(`/exit`) 후 다시 띄우고 새 ID 등록·무해한 SDK 왕복 1회로 회복을 확인한다 |
| `GJCH: 팀장 잠금이 다른 세션(...)에 있어...` | 다른 살아 있는 세션이 팀장 잠금(`.local/team/lead.json`)을 보유 중이다. 이 세션은 부팀장(`gjc-herdr-deputy`)이거나 팀장이 아닌 세션이므로 팀원에게 직접 지시·입력하거나 `--spawn`·`--layout`·`critic-send.sh`를 실행하지 않는다. 팀장을 맡아야 한다면 `scripts/team-lead.sh status`로 보유 세션을 확인하고 §2.2 이관 절차를 따른다 |
| `팀장 잠금이 다른 세션에 있습니다. 팀장만 검토를 보낼 수 있습니다.` | 잠금을 가지지 않은 세션에서 `scripts/critic-send.sh`를 실행했다(전송하지 않고 rc `1`로 종료). `scripts/team-lead.sh status`가 `mine`인 팀장 세션에서 실행한다 |
| `multiple workspaces found with label` | 외부 팀장 모드에서 대상 label(`GJCH · gjc-herdr`)을 가진 Herdr 작업공간이 둘 이상이고 기존 팀원 agent로도 작업공간을 하나로 특정할 수 없다. 중복 작업공간 label을 정리하거나 하나만 남긴 뒤 다시 실행한다 |
| `잠금 파일 읽기 실패` / `잠금 파일 형식 오류` / `잠금 파일 필수 필드 오류` (rc `1`) | 팀장 잠금 파일(`.local/team/lead.json`)이 손상되었거나 필수 필드가 잘못되어 `team-up.sh`와 `critic-send.sh`가 모두 막힌다(fail-closed). 일반 `release`와 세션 재시작으로는 풀리지 않는다. 실제 팀장 세션을 확인한 뒤 **사용자 승인**을 받아 `scripts/team-lead.sh release --force`로 파일을 삭제하고, 팀장 세션에서 `scripts/team-lead.sh claim`과 `scripts/team-lead.sh status`(`mine ...`)를 확인한다 |
| GJC → agy `/herdr-call`·`--raw`가 막 띄운 agy에서 `target_typing` | `--mode accept-edits`(또는 `auto`·`plan`)로 띄운 빈 agy 입력란의 모드 안내 문구(전경색 `38;2;131;148;150`, 좁은 pane `...` 잘림 포함)가 흐림(SGR 2)이 아니라 입력된 글로 판정된 #47 증상이다. #47 이후는 이 안내 문구를 빈 입력란으로 본다. GJC의 플러그인을 #47 이후 버전으로 다시 설치하고 GJC를 재시작한다 |
| `GJCH: 이 세션은 연결 worktree(...)에서 실행 중이라 팀장으로 동작하지 않습니다.` / `연결 worktree(...)에서 실행 중입니다.` | 데스크톱 Code 탭의 worktree 옵션 등으로 `<저장소>/.claude/worktrees/<이름>` 사본이나 Git 연결 worktree에서 실행되어 `ROOT`가 원래 저장소와 어긋난 상태다(#43). 네 진입점(`team-lead.sh`·`team-up.sh`·`critic-send.sh`·`check-env.sh`)은 잠금이나 Herdr 작업공간을 건드리지 않고 거절(또는 `check-env.sh`에서 `FAIL` 표시)하며, 경로에 `/.claude/worktrees/`가 있으면 일반 저장소여도 거절한다(우편 스크립트 `mail-*.sh`는 이 검사를 하지 않으며 후속은 별도 이슈다). 데스크톱 세션의 worktree 옵션을 끄고 원래 저장소 루트 폴더에서 새 세션을 연다 |
| `↳ <이름> 옵션 불일치: ...` / `↳ <이름> 옵션 판정 불가: ...` (`team-up.sh`·`check-env.sh`) | Herdr 서버 재시작 뒤 native 세션 복구가 팀원을 시작 옵션 없이(`agy --conversation <id>`, `codex resume <id>`) 다시 띄워 `--sandbox`·모델·상태 줄 설정 등이 빠진 상태이거나, 작업 중 자식 프로세스 등으로 foreground argv를 판정할 수 없는 상태다(#42, `--model=x` 같은 `=` 결합형 옵션은 지원하지 않으며 분리형 `--model x`만 비교하므로 결합형은 `없음`으로 판정). 스크립트는 자동 `/quit`·재시작을 하지 않고 안내 후 비0(hook 문맥은 3초 공통 기한 안에서 동기 점검하며 `GJCH: ` 접두사로 stdout 안내 후 0, 기한 초과 시 `GJCH: ↳ 팀원 옵션 점검 시간 초과 — scripts/check-env.sh로 다시 점검`)으로 끝난다. 판정 불가 뒤에 `(작업 중 — 다시 점검)`이 붙으면 팀원이 `idle`/`done`이 된 뒤 `scripts/check-env.sh`나 `scripts/team-up.sh --spawn`으로 다시 점검하고, 옵션 불일치이면 해당 팀원의 `idle`·빈 입력란 확인 → 그 pane에서 `/quit`으로 정상 종료 → `scripts/team-up.sh --spawn`(외부 팀장 모드는 `GJCH_EXTERNAL_LEAD=1 scripts/team-up.sh --spawn`)으로 다시 띄운다 |

더 자세한 사용법은 [README](../README.md)를 참조한다.
