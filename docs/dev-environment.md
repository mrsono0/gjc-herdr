# 개발 환경: Herdr + 팀장(Claude Code) + 구현(agy) + 선택 검토(Codex)

이 저장소는 한 Herdr workspace에서 **팀장(Claude Code)** 이 **구현 팀원(agy)** 과 **선택 검토·조사 팀원(Codex)** 에게 역할을 나눠 `gjc-herdr`을 개발하도록 구성되어 있다. GJC는 상시 팀원이 아니며, 플러그인 실사용 관측이 필요할 때만 팀장이 임시 탭에 띄운다. 구현과 독립 검토를 같은 에이전트의 같은 회차에 맡기지 않는다. 새 컴퓨터에서 `git clone`한 뒤 AI(Claude Code 등)가 이 문서를 읽고 스스로 점검·구축할 수 있게 쓴 문서다. 각 단계의 **실제 출력으로 판정**하고, 확인하지 못한 항목을 성공으로 적지 않는다.

## 1. 구성 요약

| 역할 | 에이전트 | 이름·label | 하는 일 | 하지 않는 일 |
|---|---|---|---|---|
| 팀장 | Claude Code | agent `gjc-herdr-lead`, pane label `GJCH 팀장 · Claude` | 사용자와 대화, 작업 분해·배정, 결과 검증, 승인이 필요한 외부 작업(commit/push/설치) 요청 | 사용자 승인 대체 |
| 구현 팀원 | agy (Antigravity CLI) | agent `gjc-herdr-mate`, pane label `GJCH 팀원 · agy` | 배정된 파일 구현·집중 검증, 결과 파일과 근거 보고 | 같은 회차의 독립 검토 역할 겸임, 승인 없는 commit/push/설치, 범위 밖 탐색 |
| 검토·조사 팀원(선택) | Codex | agent `gjc-herdr-critic`, pane label `GJCH 검토·조사 · Codex` | 독립 검토·조사·근거 확인, 지시서가 지정한 결과 파일 작성 | 팀장 허락 없는 파일 수정, 커밋·적용, 팀장 검증 대체, 사용자 승인 |
| 런타임 관측(임시) | GJC | 필요 시 팀장이 임시 탭에 실행 | 플러그인 로드, token 표시, `/herdr-send`·`/herdr-call` 실동작 관측 후 종료 | 상시 팀원 점유 |

작업공간 label은 `GJCH · gjc-herdr`이다. `scripts/team-up.sh`의 환경변수는 다음과 같다.

| 환경변수 | 기본값·용도 |
|---|---|
| `GJCH_LEAD_NAME` | `gjc-herdr-lead` |
| `GJCH_MATE_NAME` | `gjc-herdr-mate` |
| `GJCH_CRITIC_NAME` | `gjc-herdr-critic` |
| `GJCH_TEAM_CODEX` | `1`; `0`이면 Codex 자동 구성을 끈다 |
| `GJCH_MATE_MODEL` | `gemini-4-argon-high`. 팀원을 `herdr agent start ... --kind agy ... -- --model <값> --mode accept-edits --sandbox`로 실행한다. 영문자·숫자·`._-`만 허용 |
| `GJCH_CODEX_MODEL` | `gpt-6.1-sol` |
| `GJCH_RETRIES` | `30`; 팀장 이름 확보 등을 2초 간격으로 재확인 |

**Codex는 사용자 지시로 `--yolo`를 사용하며 샌드박스가 없다.** Codex는 저장소 루트에서 실행되며, **제1원칙은 "파일 수정이 필요하면 먼저 팀장 허락을 받는다"**이다(루트 `AGENTS.md`와 매 지시서에 적는다). 검토·조사 결과 파일은 지시서가 지정한 gitignore 경로(예: `.local/critic/`)에만 쓰며, 이 지정이 팀장의 허락이다. commit·적용은 하지 않는다. Codex가 없으면 WARN과 함께 생략하며, 기존 `gjc-herdr-critic` pane은 다시 시작하거나 변경하지 않는다.

## 2. 자동 구성이 일어나는 방식

1. 사용자가 **Herdr pane 안에서 이 프로젝트 폴더에 들어가 `claude`를 실행**한다.
2. `.claude/settings.json`의 SessionStart(`startup|clear`) hook이 `scripts/team-up.sh --hook`을 호출한다. stdin을 EOF까지 읽는 전체 한도는 2초이며, 최상위 JSON이 객체이고 `source`가 정확히 `clear`일 때만 기본 모드를 백그라운드로 실행해 팀장 이름·pane label과, 비었거나 폴더명 기본값인 작업공간 label만 복구한다. 팀원·검토 pane이 없어도 만들지 않는다. 그 외에는 `--spawn`을 백그라운드로 실행한다. stdin이 터미널이면 읽지 않으며, 읽기 한도 초과·읽기 오류·JSON 파싱 실패·필드 없음일 때도 기존 `--spawn` 동작을 유지한다.
3. `startup`의 `team-up.sh --spawn`이 다음을 순서대로 수행한다. 각 단계는 조건이 맞을 때만 실행되고 아무것도 덮어쓰지 않는다.
   - 가드: Herdr 안(`HERDR_ENV=1`)·`herdr`/`python3` 존재·이 pane의 실제 cwd가 프로젝트 안·`GJCH_TEAM_ROLE` 미설정일 때만 진행한다. 아니면 조용히 종료한다.
   - 이 pane의 agent 이름을 `gjc-herdr-lead`로 확보(이미 다른 pane이 쓰면 건드리지 않음)하고 pane label과, 폴더명 기본값인 작업공간 label을 바꾼다. Claude 감지 지연 때문에 최대 약 60초 재시도한다.
   - 팀원 pane이 없으면 `pane split --no-focus`로 만들고(재시작 후 남은 새 label(`GJCH 팀원 · agy`)의 빈 셸 pane은 재사용하며, 기동 단계에서는 그 위치를 유지한다. 팀장과 같은 탭의 재사용 pane은 마지막 배치 보정 대상이고, 다른 탭의 재사용 pane은 보정에서 건너뛴다. 옛 `GJCH 팀원 · GJC` label의 빈 셸은 임시 관측 pane 등과 섞이지 않도록 자동 재사용하지 않는다) `herdr agent start gjc-herdr-mate --kind agy --pane <pane> --timeout 60000 -- --model <GJCH_MATE_MODEL> --mode accept-edits --sandbox`로 실행한다. `agy`가 없으면 안내하고 비0으로 끝낸다. 구현(agy, Gemini 4 Argon)과 검토(Codex, GPT)를 다른 모델로 두어 검토 독립성을 높이고 한 제공자 과부하에 함께 멈추지 않게 한다.
   - 새 pane의 위치는 아래 **배치 공식 기준**을 따른다. 포커스가 아니라 팀장 pane(`HERDR_PANE_ID`) 기준이다. 검토가 같은 탭에 있으면 검토를 반으로 나눌 새 pane을 만들고 검토를 임시 탭 경유 `pane move --no-focus`로 그 오른쪽에 되돌린 뒤 팀원 시작 전에 비율을 맞춘다. 없으면 팀장 아래를 나눠 팀장을 60%로 둔다. 검토를 같은 탭에 되돌리지 못하면 팀원은 그대로 시작하되 종료 코드를 비0으로 두고 그 pane·tab ID와 수동 복귀 필요를 알린다(다른 탭의 pane은 마지막 배치 보정·`--layout` 모두 옮기지 않는다).
   - `herdr agent start`가 JSON `error.code == "agent_not_ready"`로 실패하고 해당 pane의 `agent_status`가 `blocked`이면(처음 저장소를 열 때의 폴더 신뢰 창이나 다른 질문 UI 등), 스크립트는 자동 응답하지 않으며(사용자 결정 사항) 원래 오류(`code`·`message`)와 함께 불확실성을 남긴 안내(`agy가 시작 중 멈췄습니다(..., status=blocked, ...). 폴더 신뢰 창이나 다른 질문일 수 있으니 그 pane에서 사용자가 확인한 뒤 scripts/team-up.sh --spawn을 다시 실행하세요.`)를 출력하고 비0으로 끝낸다. pane 상태가 `working`이거나 상태 조회 실패·다른 기동 오류이면 신뢰 창으로 단정하지 않고 원래 오류와 함께 일반 실패로 끝낸다. 첫 기동이 `blocked`에서 멈춰도 이름 `gjc-herdr-mate`는 이미 붙으므로, 재실행 시 `existing` 분기에서도 `herdr agent get`의 `agent_status`·`interactive_ready`를 확인해 여전히 `blocked`이거나 준비되지 않았으면(조회 실패 포함) 비0으로 끝내고, 사용자가 응답해 `idle`/`done`·`interactive_ready=true`(또는 `working`)가 되면 새 pane을 만들거나 재시작하지 않고 배치 보정으로 넘어간다.
   - 선택 Codex 단계: `GJCH_TEAM_CODEX=0`·`codex` 없음·기존 critic 이름 점유 시 생략한다. 그 외에는 저장소 루트 cwd·검토 label인 같은 workspace 빈 셸 pane을 재사용하거나, 팀장과 같은 탭의 팀원 오른쪽(반반, 팀원이 없거나 다른 탭이면 팀장 아래 팀장 60%)에 no-focus로 만들고(팀원 오른쪽에 만든 경우 Codex 시작 전에 비율을 맞춘다) `herdr agent start ... -- --no-daemon --yolo -m <모델> -C <저장소 루트> --disable worktrees`로 시작한다(`/new` worktree 메뉴 없음, §4). 공유 daemon 환경에서 실행된 훅이 세션 ID를 다른 pane으로 보고할 수 있어 `--no-daemon`으로 해당 pane의 환경을 사용한다. 팀원(agy) 단계 실패 시에도 Codex 단계는 별도로 시도하며, 실패한 단계가 있으면 종료 코드는 비0이다.
   - 마지막 배치 보정: 팀원·검토 단계가 끝난 뒤 팀장과 같은 탭에 있는 기존 pane·재사용 pane까지 아래 배치 공식 기준으로 맞춘다(수동 `--layout`과 같은 로직). 다른 탭의 pane은 옮기지 않는다.
4. 사용자의 focus·다른 pane·설정은 바꾸지 않는다.

**배치 공식 기준**(CF 팀과 같은 기준. 다른 문서는 이 절을 따른다):

- 모양: 팀장 위(높이 60%), 그 아래 왼쪽 agy 팀원 | 오른쪽 Codex 검토(반반). 검토가 없거나 팀장과 다른 탭에 있으면 팀장 60% / 팀원 아래만 맞춘다. 선택 Codex가 꺼져 있으면(`GJCH_TEAM_CODEX=0`, `codex` 없음) 팀 구성 보정은 기존 검토 agent도 빼고 같은 2-pane으로만 맞추되, 그 검토가 팀장과 같은 탭에 남아 있으면 팀원을 흔들지 않도록 아무것도 옮기지 않고 건너뛴다. 수동 `--layout`은 존재하는 검토를 항상 포함한다.
- Sidebar 등 다른 pane은 건드리지 않는다. 단, 임시 탭 경유 이동 때 그 임시 탭에 자동 생성된 agent 없는 Sidebar는 탭 닫기로 함께 정리한다.
- 적용 시점: 팀 구성·복구(`--spawn`, 그것을 부르는 시작 훅) 끝 + 수동 `--layout`. `/clear` 훅 경로는 이름·label 복구만 하며 배치를 건드리지 않는다.
- 방법: 모양(`pane layout`의 rect)이 맞으면 `pane resize`로 비율만 맞추고, 다르면 팀원·검토를 차례로 임시 탭에 뺐다가 `pane move --no-focus`로 되돌린다(같은 탭 안 `pane move`는 `same_tab`으로 무시되고, `pane swap`은 focus를 옮기므로 쓰지 않는다). 임시 탭에서 즉시 되돌리면 원래 탭에 agent 없는 pane이 하나 더 생기는 경쟁이 관측됐다(새 탭에 Sidebar를 비동기로 만드는 사용자 플러그인이 원인으로 추정). 그래서 임시 탭의 pane 수가 늘어 안정될 때까지 기다렸다가 되돌린다. 상한은 목록 조회를 포함해 이동마다 2.5초다(실측 생성 지연 최대 약 1초의 약 2배, Python 시작 등 프로세스 비용 제외). Sidebar가 없는 환경은 이동마다 이 상한만큼 기다린다(팀원·검토를 모두 옮기면 약 5초). 대기 중 목록 조회가 실패해도 pane은 되돌리지만 배치 실패(비0)로 끝난다. 되돌린 뒤 원래 탭에 새로 관측된 agent 없는 pane이 있으면 출처(플러그인·사용자)를 가리지 않고 닫지 않으며, 그 ID를 안내하고 배치 실패(비0)로 끝난다. 그 목록을 읽지 못해도 실패다. 플러그인이 상한보다 늦으면 그 pane이 원래 탭에 남을 수 있고, 이 검사보다 늦게 생기는 pane은 감지하지 못한다. 이미 목표 배치면 아무것도 바꾸지 않는다. 끝에 split 비율을 다시 읽어 0.6/0.5에서 0.01 안인지 확인한다. 사용자 focus는 바뀌지 않는다.
- 조건: 팀장 이름이 이 pane 소유, 팀원(그리고 포함하는 검토)이 팀장과 같은 탭, cwd가 저장소 안. 팀 구성 때는 조건이 안 맞으면 아무것도 옮기지 않고 stderr에 이유(`team layout skipped: ...`)만 남기며 실패가 아니다(다른 탭으로 뺀 pane은 사용자가 일부러 뺀 것으로 본다). 수동 `--layout`은 같은 경우(검토가 다른 탭인 경우 포함) 오류로 끝난다. 건너뜀은 정상 응답으로 확인된 불일치(agent `agent_not_found`, 다른 탭, 저장소 밖 cwd, 팀장 이름이 다른 pane)에만 쓴다. `agent get`·`pane get`·`pane layout` 조회나 JSON 파싱이 실패하면 두 모드 모두 아무것도 옮기지 않고 실패(`team layout failed: ...`, 비0)로 끝난다(예: 검토 pane의 tab을 읽지 못하면 다른 탭으로 보고 빼지 않는다).
- 빈틈없는 영역: 모양이 달라 옮겨야 할 때는 먼저 팀장·팀원(·포함하는 검토)이 한 분할 영역을 빈틈없이 채우는지 본다(`pane layout`에서 세 pane rect의 경계 상자가 split 하나의 rect와 같고, 그 안에 다른 pane이 없으며, 면적 합이 상자와 같음). 사이에 Sidebar나 사용자 pane이 끼어 있으면 옮기는 중에 그 pane이 커지거나 밀려나므로, 아무것도 옮기지 않고 두 모드 모두 실패(비0)로 끝난다. 다른 탭으로 뺀 pane과 달리 같은 탭 안의 끼어듦은 보정 실패로 본다. 이미 목표 모양이면 비율만 맞추므로 해당하지 않는다.
- 실패: 배치 실패는 agent 기동을 막지 않는다. 기동이 끝난 뒤 종료 코드만 비0으로 두고(기동 실패 코드가 우선) `--layout` 재실행 안내를 남긴다. 새 팀원을 만들 때 검토를 옮기는 배치 단계에서 실패가 있었으면 마지막 보정이 모양을 고쳐도 비0이다(실패를 숨기지 않는 쪽을 택함). 이동 실패의 사유(이동 불가·새 pane 관측·검사 불능)는 stderr 안내로만 구분한다. Codex 단계가 실패하면 agent 없는 검토 pane을 밀어내지 않도록 보정을 건너뛴다. 임시 탭에 agent pane이 남으면 닫지 않고 tab ID를 안내한다. 이 안내와 비0 종료 코드는 `--spawn`·`--layout`을 직접 실행할 때만 보인다. SessionStart hook은 `--spawn`을 백그라운드로 띄우고 출력을 버리므로, hook 경로의 배치 실패는 `herdr pane layout`으로 확인하거나 `--layout`을 직접 실행해 본다.

수동 실행: `scripts/team-up.sh`(이름·label만), `scripts/team-up.sh --spawn`(구현·선택 검토 팀원 포함, 끝에 배치 보정). `GJCH_TEAM_CODEX=0 scripts/team-up.sh --spawn`이면 agy 팀원만 구성한다. `scripts/team-up.sh --layout`(팀장 pane에서 실행)은 기본 동작 뒤 팀장·팀원·검토 pane을 위 배치 공식 기준으로 재배치한다. `--spawn` 끝의 배치 보정과 같은 로직이며, 조건이 안 맞으면 건너뛰지 않고 아무것도 옮기지 않은 채 오류(비0)로 끝난다. resize 실패·비율 미도달이면 성공 메시지 없이 비0이다. `herdr agent start`는 pane이 빈 셸 프롬프트 상태여야 하며, 성공은 예상 agent가 감지되고 입력 준비가 됐다는 뜻이다.

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
   | `herdr` 없음 / Herdr pane 밖 | README "필요한 프로그램" 표대로 Herdr를 설치하고 **Herdr 안의 pane에서** Claude Code를 실행하도록 안내한다(팀 구성·token 표시는 Herdr 안에서만 동작) |
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
- **팀장 → 검토 (Claude → Codex):** 자체 완결 지시서 파일을 스크립트로 보낸다. 같은 workspace의 저장소 루트에서 실행 중인 소유 Codex가 idle/done·비포커스일 때만 시작하며, 빈 입력란 확인 → 필요 시 `/new`·새 화면 준비 확인 → pane ID로 전송·working 수락 확인 → 전송 뒤 이름 확인·필요 시 재등록 → 고정 pane의 완료 대기를 수행한다.
  ```sh
  scripts/critic-send.sh <지시서 파일>                    # 기본 30분
  scripts/critic-send.sh --timeout 3600000 <지시서 파일>   # 대기 한도 1시간
  scripts/critic-send.sh --no-wait <지시서 파일>           # 수락까지 확인하고 반환
  scripts/critic-send.sh --result .local/critic/<이슈>-r<회차>.md <지시서 파일>  # 결과 파일로 완료 판정(권장)
  ```
  화면은 `--source visible --format ansi`로 읽으며, 마지막 0번째 칸 `›` 뒤의 정확한 placeholder 문구가 **전부 흐림(dim)**일 때만 빈 입력란으로 인정한다. 같은 문구를 직접 친 draft·일부만 흐린 문구·흐림 정보가 없는 화면은 거부한다. SGR은 `src/input.ts`와 같이 `0`·`22`가 흐림을 해제하고 `2`가 흐림을 설정하며, RGB·팔레트 색상 인자 및 콜론 형식 안의 숫자를 흐림 코드로 오인하지 않는다. 잘린 SGR·해석할 수 없는 색상 인자·다른 escape도 거부하며, ANSI 없는 텍스트 판정으로 되돌리지 않는다.
  이름은 `team-up.sh`와 같은 `GJCH_CRITIC_NAME`을 사용하고, 대상의 cwd가 저장소 루트인지 확인한다. 뒤가 비었거나 공백뿐인 줄도 포함해 줄 맨 앞(0번째 칸)의 `›`만 입력란 후보로 확인한다. 공백·탭으로 들여쓴 `›`는 여러 줄 draft의 내용일 수 있어 후보로 보지 않는다. 마지막 후보가 정확한 빈 placeholder(`Ask Codex to do anything`)가 아니면 거부하며 draft를 자동 삭제하지 않는다. `›`만 있는 줄은 빈 입력란으로 간주하지 않는다. 마지막 입력란 뒤에는 빈 줄 외에 상태 줄 1개와 그 뒤의 알려진 안내 줄(`← for agents · ? for shortcuts` 또는 `? for shortcuts`) 0~1개만 허용한다(두 형식 모두 안내 줄 생략·알려진 접두부의 말줄임은 허용). 안내 줄 뒤 공백으로 구분된 `⚠ <숫자> warning(s) · f2 to view` 또는 경고 표시만 있는 줄도 허용하며, 경고의 알려진 접두부가 잘린 꼴도 허용한다. 마지막 후보 뒤에 이어지는 비어 있지 않은 입력 줄·본문·두 번째 상태 줄·임의 꼬리말은 계속 거부한다. 이 상태 줄에서 `Context 100% left`와 완전히 보이는 누적 입력 `0 in`을 확인하면 `/new` 없이 보낸다(출력 카운터도 완전히 보이면 `0 out`이어야 한다). 누적 입력 카운터는 숫자 뒤 공백까지 보이면 그 숫자를 완전한 값으로 보므로 `0 i…`·`0 in…`도 새 대화 근거가 되고, 구분자나 숫자 중간에서 잘리면(`0…`, `240K…` 등) 형식으로는 받되 입력이 0인지 알 수 없으므로 새 대화로 보지 않고 `/new`를 보낸다. 56칸 배치에서 `GPT-6.1-Sol default` 모델의 상태 줄이 `0 i…`까지 보이려면 브랜치 이름이 3자 이하여야 한다(`i27`에서 딱 `0 i…`까지 관측). 출력 tail은 완전한 카운터·숫자 카운터의 잘림·구분자의 말줄임만 허용하고 `unrecognized…` 같은 임의 문구는 거부한다. 헤더·잘린 출력 카운터나 scrollback의 과거 문자열은 새 화면 근거로 쓰지 않는다. 판정 불가 시 pane이 확인 크기 56×10보다 작으면 현재 W×H와 확대 안내를 남긴다. 그 이상이면 상태 줄·안내 줄 형식을 판정할 수 없다고 안내하고 마지막 화면 6줄을 함께 출력한다. 모델 이름과, 저장소에서 실행하면 상태 줄에 붙는 브랜치 이름에 따라 필요한 폭이 달라진다(긴 브랜치 `issue-13-critic-repo-root`에서는 82칸이 필요했다). 그래서 브랜치 이름은 `i<이슈번호>`처럼 짧게 만든다(`i14`에서 62칸으로 전송 확인). Codex는 브랜치를 바꿔도 다음 대화 전까지 이전 브랜치 이름을 그대로 표시한다. 기존 대화에서는 send-text 뒤 입력란에 `/new`가 보일 때까지 1초 간격·최대 5초 관측하고, 보이면 Enter를 한 번만 보낸다. 보이지 않으면 코드 2로 끝내며 Enter·지시서는 보내지 않는다. git 저장소에서는 Codex가 `/new` 뒤 "Where should the new conversation run?" 메뉴를 띄운다. 화면 최하단 블록이 이 메뉴일 때(마지막 줄이 `enter select · esc back`이고, 그 위 질문 줄과의 사이에 0번째 칸 `›` 선택 줄이 하나)만 메뉴로 보며, 선택 표시가 `› 1. Use current Git worktree`에 있을 때만 Enter를 한 번 보낸다. 위에 남은 옛 메뉴 글자나 같은 문구의 draft는 메뉴로 보지 않는다. 다른 항목이 선택돼 있거나 Enter 뒤 1초 간격 세 관측 동안 메뉴가 남으면 코드 2로 끝내며 Esc·재입력·지시서 전송은 하지 않는다. `/new` 뒤 새 화면과 revision/상태 seq 변경·idle/done·`interactive_ready`를 함께 판정하고, 관측 반환 뒤 준비 한도 30초·전체 한도를 넘었으면 지시서를 보내지 않는다. Codex는 `/new` 뒤 새 빈 화면(idle)을 보인 다음 약 0.5초 뒤 잠깐(약 1초) working이 됐다가 done으로 돌아오므로, 새 빈 화면·idle/done·같은 상태 seq를 1초 간격 세 번 연속 관측해야 준비로 본다(worktree 메뉴 관측·Enter가 끼면 처음부터 다시 센다). 그 뒤 전송 직전 확인에서 대상·이름·비포커스는 맞고 상태가 working이면 거부하지 않고 같은 준비 한도 안에서 다시 기다린다(worktree 메뉴 선택 Enter 전도 같다). working이면 `interactive_ready` 값과 무관하게 기다리고, working이 아닌데 idle/done·`interactive_ready`가 아니거나(blocked·unknown 포함) 포커스·다른 대상이면 그 관측에서 바로 거부한다. 준비 대기 중에는 `interactive_ready`가 참이 되기 전까지 준비로 세지 않는다. 준비 대기 중 입력란의 글은 위처럼 1초 간격 두 관측에서 남으면 중단하고, 전송 직전 확인에서 빈 새 입력란이 아니면 바로 중단한다. 세 번 연속 관측은 이미 시작된 working을 거르는 것이며(대기 구간은 약 2초), 그 뒤에 시작되는 working을 막지는 못한다. 마지막 확인과 지시서 prompt 사이도 원자적이지 않다. `team-up.sh`가 띄우는 Codex는 `--disable worktrees`(= `-c features.worktrees=false`, 이 프로세스에만 적용)로 시작해 `/new`의 worktree 메뉴가 뜨지 않는다(managed worktree 생성·목록 도구도 꺼짐). 메뉴 처리는 이 인자 없이 떠 있는 기존 Codex를 위해 남긴다. `/new`·Enter 뒤 1초 간격 두 관측에서 미제출 글이 남으면 코드 2로 끝내며 지시서·Enter를 재전송하거나 글을 삭제하지 않는다. `--timeout`은 1–86400000ms(24시간), 입력 최대 9자리이며 선행 0은 허용한다. bash 3.2의 `SECONDS`(1초 해상도)로 측정하며 초 단위로 올림한다. 완료 대기에서는 한도를 넘겨 반환된 done/idle도 완료로 받으며, 아직 미완료인 채 한도를 넘으면 코드 2로 끝낸다. 하위 herdr 명령이 반환하지 않으면 스크립트 한도로 끊지 못한다. 필요하면 Ctrl-C(130) 뒤 안내를 따른다. 종료 코드 1은 조건 거부·확인 실패(지시서 전송 전 준비 timeout 포함), 2는 `/new`·지시서 전송 불확실·미제출 또는 완료 대기 timeout, 4는 `--result`를 줬는데 Codex가 idle/done으로 돌아온 뒤에도 결과 파일이 전송 전보다 새로 쓰이지 않은 경우다(예: 모델 용량 초과로 실행 실패). 4이면 Codex 화면 마지막 8줄을 함께 출력하며, 그 회차는 끝났으므로 원인을 확인한 뒤 같은 지시서를 다시 보낼 수 있다. idle/done은 Codex의 실행 실패와 정상 완료를 구별하지 못하므로 `--result`를 늘 붙인다. 결과 파일은 경로 자체가 비어 있지 않은 일반 파일이어야 하며 심볼릭 링크는 인정하지 않는다. 상대 경로는 저장소 루트 기준이고 `--no-wait`와 함께 쓰지 않는다. SIGINT/SIGTERM으로 끝날 때도 전송 시도 뒤 안내를 남긴다(130/143). 전송 시도 뒤 중단하거나 `--no-wait`로 반환하면 재전송하지 말고 공개 상태와 결과 파일로 완료를 확인한다. focus/occupant 확인과 입력은 원자적이지 않으며, 화면 형식이 달라지면 안전하게 거부한다.
  스크립트를 못 쓸 때만 수동으로 **소유 pane·idle/done·비포커스·빈 입력란 확인 → 기존 대화이면 `/new`·새 입력란 준비 관측 → `herdr agent prompt <pane-id> "<지시서>" --wait --timeout <ms>` → 전송 뒤 이름 확인** 순서를 따른다. `interactive_ready`나 고정 sleep만으로는 준비를 판단하지 않는다. 이름이 풀렸으면 다른 pane이 점유하지 않았음을 확인하고 `herdr agent rename <pane-id> gjc-herdr-critic`으로 다시 붙인다. 완료 대기는 이름이 풀려도 고정 pane·terminal·workspace·cwd로 계속하며, 다른 이름으로 바뀌면 중단한다.
  지시서 첫머리에 제1원칙(파일 수정이 필요하면 먼저 팀장 허락)을 적고, 결과는 **지정한 gitignore 경로의 파일**(예: `.local/critic/<이슈>-r<회차>.md`)로 쓰고 경로를 회신하도록 적는다. pane 출력은 접혀 보일 수 있고 working 중에는 read가 불가하므로, 완료·idle/done을 확인한 뒤 그 파일을 읽어 본문을 받는다. Codex → 팀장 직접 호출은 기대하지 않는다(샌드박스는 없지만 직접 호출 경로는 미확인이다). timeout이면 자동 재전송·`/new` 입력을 하지 말고 공개 상태와 결과 파일의 완료 여부부터 확인한다.
- 큰 근거·로그는 채팅에 붙이지 말고 파일 경로와 sha256으로 공유한다.

### GJC 관측 절차 (필요할 때만 임시 실행)

GJC는 상시 팀원이 아니며, 플러그인 로드·token 표시·`/herdr-send`·`/herdr-call` 실동작 관측이 필요할 때만 팀장이 임시 탭을 만들어 띄우고 관측한 뒤 닫는다.

1. **기동:** 팀장이 임시 탭(또는 임시 pane)을 `--no-focus`로 만들고 `gjc --mpreset opus5-codex56-pro`를 실행한다.
2. **메시지 채널 (GJC 관측을 띄웠을 때 한정):**
   - **팀장 → GJC 관측 세션:** GJC는 Herdr 감지 agent가 아니라 상태 보고만 있어 `herdr agent prompt`가 `agent_not_ready`로 거절된다. `herdr pane get <pane-id>`에서 `tokens.gjc_herdr_session_id`를 확인해 `gjc sdk session send <session_id> --text "<요청>" --wait --timeout-ms 120000`으로 보낸다(읽기 전용 관찰은 `gjc sdk session tail <session_id> --json`). `endpoint_stale` 등으로 실패하면 재전송하지 않고 `GJC_SDK_BROKER_AUTOSTART=0 gjc sdk session list --attach-only --scope all`로 기존 broker에 해당 세션 ID가 등록돼 있는지 확인하며, 목록에 없으면 정상 종료(`/exit`) 후 다시 띄운다.
   - **GJC 관측 세션 → 팀장 등 감지 에이전트:** 이 플러그인의 `/herdr-call` 또는 `herdr_agent_call`(대상 `gjc-herdr-lead` 등)을 써서 호출·회수한다. 입력 보호를 거치지 않는 bash의 `herdr agent prompt`·`herdr pane send-text`/`send-keys` 직접 호출은 하지 않는다.
   - **슬래시 명령:** `/rename` 등은 SDK 텍스트로 실행되지 않는다. 필요하면 사용자 승인 후 대상 pane의 idle·비포커스·빈 입력란을 먼저 확인하고 `herdr pane send-text <pane-id> "/명령"` + `herdr pane send-keys <pane-id> enter`를 쓴다(`pane` 명령은 pane ID만 받는다).
3. **종료·정리:** 관측과 근거 수집이 끝나면 임시 GJC를 `/exit`로 정상 종료하고 팀장이 만든 임시 탭을 닫는다.

## 5. 협업 규칙(요약)

- 사용자 지시는 팀장이 받는다. 팀원이 직접 받으면 팀장에게 요약해 알리고, 범위 확대는 팀장 확인 후 한다.
- 배정에는 목적 한 줄, 맡길 결과, 쓰기 허용 파일(최대 3–5개), 범위 밖 읽기 금지, 금지 사항, 회신 방식, 배경(상대에게 대화 이력이 없다고 가정)을 적는다. 같은 파일을 동시에 쓰지 않는다.
- 팀원은 관측 사실 / source 근거 / 가설 / 미확인을 구분해 보고하고, 팀장은 직접 확인한 사실만 사용자에게 보고한다.
- **agy 운용 조건**(`AGENTS.md` 참조): 빈 답·결과 파일 없음은 실패로 본다. 완료는 Herdr 상태(`done`)가 아니라 결과 파일과 화면 하단 `task(s)` 표시로 판단한다. 자기 검증은 팀장이나 검토가 다시 실행해 확인한다. agy가 보고한 해시(sha256)·파일 경로·검증 출력은 그대로 옮겨 쓰지 않고, 팀장이 직접 계산·대조·재실행해 확인한다. Codex 검토 자료(`.local/critic/` 아래 지시서·diff·사본·결과)는 agy의 쓰기 허용 목록에 넣지 않으며, agy는 그곳에 쓰지 않는다. 환경 문제가 생기면 탐색하지 말고 멈추고 묻는다. commit·push·설치를 금지한다. `.gjc/RULES.md`는 자동으로 실리지 않으니 필요한 규칙은 지시서에 넣는다. 실행 옵션을 `--mode accept-edits --sandbox`로 두는 이유는 공통 설정이 `proceed-in-sandbox`라서, sandbox 안의 셸·편집은 무확인이고 sandbox 밖 실행만 확인하기 때문이다. sandbox 안에서는 홈 설정 파일을 읽는 `git`·`gh`가 실패하므로(`~/.gitconfig`·`~/.config/gh` 접근 거부) diff·이슈 확인은 팀장이 하고, 필요한 배경은 지시서에 싣는다. 폴더 신뢰 창은 사용자가 답한다. 명령·편집 확인창은 팀장이 명령 원문을 확인한 뒤 "이번만"(1번)으로만 답한다. 대화 한정·영구 저장(`settings.json`) 선택지는 사용자 승인으로만 쓴다. 확인창의 명령이 잘려 보이면 `herdr pane zoom <agy pane>`으로 키우고, 확인창에서 `ctrl+g`(Full Command 보기)로 전문을 읽은 뒤 `esc`로 확인창에 돌아오고, `herdr pane zoom`으로 원래 크기로 되돌린다. 전문을 다 읽을 수 없으면 확인창의 취소 선택지(4번 "No, cancel")를 고르고 짧은 명령이나 편집 도구로 나눠서 다시 하게 한다(이 절차는 CF 팀 관측에서 가져왔고 이 저장소에서 독립 재현하지 않았다). 이 위임은 배정 범위 안의 작업에만 적용되며 commit·설치·사용자 설정 변경 등 기존 승인 경계를 넓히지 않고, 폴더 신뢰·그 밖의 질문 UI는 사용자에게 확인한다. `~/.gemini/antigravity-cli/settings.json`은 이 머신의 모든 `agy`가 함께 쓰는 사용자 설정이므로 이 저장소 작업에서 바꾸지 않는다.
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
| 팀장·팀원·검토가 세로로 쌓이는 등 배치가 어긋남 | 팀 구성(`--spawn`·시작 훅)은 끝에 §2 배치 공식 기준으로 보정하지만, 팀원이 다른 탭인 등 조건이 안 맞으면 `team layout skipped: ...`만 남기고 옮기지 않는다. 팀장 pane에서 `scripts/team-up.sh --layout`을 실행한다. "nothing moved"면 이유(다른 탭·cwd·이름 없음)를 고친 뒤 다시 실행한다. "could not move ... back from temporary tab"이면 안내된 임시 탭의 pane을 수동으로 되돌린다 |
| agent 이름이 이미 사용 중 | 다른 pane이 점유 중이라 label을 건드리지 않음(의도된 동작). 이름은 pane 종료·교체 시 사라짐 |
| sidebar에 모델·세션이 안 보임 | 플러그인 설치됨 ≠ 로드됨 ≠ 표시됨. 실행 중이던 GJC를 재시작하고 `herdr pane get <pane-id>`의 token을 확인, 이후 README "Sidebar 설정" |
| `agent_not_ready` | 대상이 감지되지 않았거나 working/blocked. `team-up.sh --spawn`의 `agy` 기동에서는 `error.code == "agent_not_ready"`이고 해당 pane의 `agent_status`가 `blocked`일 때만 폴더 신뢰 창·질문 확인 안내를 내며, `working`·조회 실패 등은 일반 실패로 끝난다. 임시 GJC 관측 세션 대상은 위 §4 "GJC 관측 절차"의 SDK 경로를 쓴다 |
| 임시 GJC 관측 세션에 대한 `gjc sdk session send`의 `endpoint_stale` | 재전송하지 않고 `operationRef`·상태를 보존한다. `GJC_SDK_BROKER_AUTOSTART=0 gjc sdk session list --attach-only --scope all`에서 해당 GJC token의 세션 ID 등록을 확인한다(endpoint 파일·포트 존재 ≠ 등록, 조회 실패 ≠ 누락). 성공한 목록에 없으면 정상 종료(`/exit`) 후 다시 띄우고 새 ID 등록·무해한 SDK 왕복 1회로 회복을 확인한다 |

더 자세한 사용법은 [README](../README.md)를 참조한다.
