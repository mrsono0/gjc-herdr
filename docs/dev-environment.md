# 개발 환경: Herdr + 팀장(Claude Code) + 구현(GJC) + 선택 검토(Codex)

이 저장소는 한 Herdr workspace에서 **팀장(Claude Code)** 이 **구현 팀원(GJC)** 과 **선택 검토·조사 팀원(Codex)** 에게 역할을 나눠 `gjc-herdr`을 개발하도록 구성되어 있다. 구현과 독립 검토를 같은 에이전트의 같은 회차에 맡기지 않는다. 새 컴퓨터에서 `git clone`한 뒤 AI(Claude Code 등)가 이 문서를 읽고 스스로 점검·구축할 수 있게 쓴 문서다. 각 단계의 **실제 출력으로 판정**하고, 확인하지 못한 항목을 성공으로 적지 않는다.

## 1. 구성 요약

| 역할 | 에이전트 | 이름·label | 하는 일 | 하지 않는 일 |
|---|---|---|---|---|
| 팀장 | Claude Code | agent `gjc-herdr-lead`, pane label `GJCH 팀장 · Claude` | 사용자와 대화, 작업 분해·배정, 결과 검증, 승인이 필요한 외부 작업(commit/push/설치) 요청 | 사용자 승인 대체 |
| 구현 팀원 | GJC | agent `gjc-herdr-mate`, pane label·세션 이름 `GJCH 팀원 · GJC` | 배정된 파일 구현, 실제 GJC 런타임 관측 | 같은 회차의 독립 검토 역할 겸임, 승인 없는 commit/push |
| 검토·조사 팀원(선택) | Codex | agent `gjc-herdr-critic`, pane label `GJCH 검토·조사 · Codex` | 독립 검토·조사·근거 확인, 작업 폴더에 결과 파일 작성 | 저장소 쓰기·커밋·적용, 팀장 검증 대체, 사용자 승인 |

작업공간 label은 `GJCH · gjc-herdr`이다. `scripts/team-up.sh`의 환경변수는 다음과 같다.

| 환경변수 | 기본값·용도 |
|---|---|
| `GJCH_LEAD_NAME` | `gjc-herdr-lead` |
| `GJCH_MATE_NAME` | `gjc-herdr-mate` |
| `GJCH_CRITIC_NAME` | `gjc-herdr-critic` |
| `GJCH_TEAM_CODEX` | `1`; `0`이면 Codex 자동 구성을 끈다 |
| `GJCH_CODEX_MODEL` | `gpt-6.1-sol` |
| `GJCH_CODEX_WORKDIR` | 저장소 형제 폴더 `<저장소 폴더명>-codex-work`(예: `../gjc-herdr-codex-work`) |
| `GJCH_RETRIES` | `30`; GJC 이름·준비 상태 등을 2초 간격으로 재확인 |

**Codex는 사용자 지시로 `--yolo`를 사용하며 샌드박스가 없다.** 저장소 쓰기·commit 금지는 지시서 규칙으로 지킨다. 외부 작업 폴더는 결과 파일 위치와 실수 방지 목적이지 권한 차단이 아니다. 생성 전에 `os.path.realpath`로 미존재 경로·`..`·기존 조상의 심볼릭 링크를 해석해 저장소 자체·저장소 안·저장소를 품는 상위 폴더를 거부한다. 사전 판정에 통과한 정규화 경로만 `mkdir -p`로 생성하고, 이후 `cd`/`pwd -P`로 물리 경로를 다시 판정해, 그사이 경로가 바뀌었으면 Codex를 띄우지 않는다(생성 자체를 막지는 못한다. 판정과 생성 사이에 다른 프로세스가 조상 폴더를 바꾸는 경쟁은 이 오설정 방지 장치의 보장 범위 밖이다). 사전 거부된 경로에는 디렉터리를 만들지 않는다. Codex가 없으면 WARN과 함께 생략하며, 기존 `gjc-herdr-critic` pane은 다시 시작하거나 변경하지 않는다.

## 2. 자동 구성이 일어나는 방식

1. 사용자가 **Herdr pane 안에서 이 프로젝트 폴더에 들어가 `claude`를 실행**한다.
2. `.claude/settings.json`의 SessionStart(`startup|clear`) hook이 `scripts/team-up.sh --hook`을 호출한다. stdin을 EOF까지 읽는 전체 한도는 2초이며, 최상위 JSON이 객체이고 `source`가 정확히 `clear`일 때만 기본 모드를 백그라운드로 실행해 팀장 이름·pane label과, 비었거나 폴더명 기본값인 작업공간 label만 복구한다. 팀원·검토 pane이 없어도 만들지 않는다. 그 외에는 `--spawn`을 백그라운드로 실행한다. stdin이 터미널이면 읽지 않으며, 읽기 한도 초과·읽기 오류·JSON 파싱 실패·필드 없음일 때도 기존 `--spawn` 동작을 유지한다.
3. `startup`의 `team-up.sh --spawn`이 다음을 순서대로 수행한다. 각 단계는 조건이 맞을 때만 실행되고 아무것도 덮어쓰지 않는다.
   - 가드: Herdr 안(`HERDR_ENV=1`)·`herdr`/`python3` 존재·이 pane의 실제 cwd가 프로젝트 안·`GJCH_TEAM_ROLE` 미설정일 때만 진행한다. 아니면 조용히 종료한다.
   - 이 pane의 agent 이름을 `gjc-herdr-lead`로 확보(이미 다른 pane이 쓰면 건드리지 않음)하고 pane label과, 폴더명 기본값인 작업공간 label을 바꾼다. Claude 감지 지연 때문에 최대 약 60초 재시도한다.
   - 팀원 pane이 없으면 `pane split --no-focus`로 만들고(재시작 후 남은 빈 셸 pane은 재사용) `gjc`를 실행해 `gjc-herdr-mate`로 이름을 붙인다.
   - GJC가 idle이고 `gjc_herdr_session_id` token이 발행되면 `/rename GJCH 팀원 · GJC`를 입력해 세션 이름을 맞춘다. 준비가 안 되면 수동 안내만 출력한다.
   - 선택 Codex 단계: `GJCH_TEAM_CODEX=0`·`codex` 없음·기존 critic 이름 점유 시 생략한다. 그 외에는 별도 작업 폴더의 같은 workspace 빈 셸 pane을 재사용하거나, 같은 workspace의 팀원 오른쪽(팀원이 없으면 현재 pane 아래)에 no-focus로 만들고 `herdr agent start ... -- --no-daemon --yolo -m <모델> -C <작업 폴더>`로 시작한다. 공유 daemon 환경에서 실행된 훅이 세션 ID를 다른 pane으로 보고할 수 있어 `--no-daemon`으로 해당 pane의 환경을 사용한다. GJC 단계 실패 시에도 Codex 단계는 별도로 시도하며, 실패한 단계가 있으면 종료 코드는 비0이다.
4. 사용자의 focus·다른 pane·설정은 바꾸지 않는다.

수동 실행: `scripts/team-up.sh`(이름·label만), `scripts/team-up.sh --spawn`(구현·선택 검토 팀원 포함). `GJCH_TEAM_CODEX=0 scripts/team-up.sh --spawn`이면 GJC만 구성한다. `herdr agent start`는 pane이 빈 셸 프롬프트 상태여야 하며, 성공은 예상 agent가 감지되고 입력 준비가 됐다는 뜻이다.

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
   | `gjc` 없음 | GJC 본체는 이 저장소가 설치하지 않는다. README "필요한 프로그램" 표의 링크를 사용자에게 안내해 설치를 요청한다 |
   | `herdr` 없음 / Herdr pane 밖 | README "필요한 프로그램" 표대로 Herdr를 설치하고 **Herdr 안의 pane에서** Claude Code를 실행하도록 안내한다(팀 구성·token 표시는 Herdr 안에서만 동작) |
   | `codex` 없음 | 선택 검토 팀원이다. README의 Codex 설치 안내를 따르거나 `GJCH_TEAM_CODEX=0`으로 끈다 |
   | `bun` 없음 또는 버전 불일치 | GJC plugin 설치에 필요. build는 `package.json`의 `engines.bun`(1.4.2) 고정 |
   | `node_modules` 없음 | `npm ci --ignore-scripts --no-audit --no-fund` (개발·테스트 시) |
   | `team-up.sh` 실행 권한 없음 | `chmod +x scripts/team-up.sh scripts/check-env.sh` |
   | `gjc-herdr` 플러그인 미설치 | README "설치 (한 줄)"과 "AI 에이전트 설치 지침"을 따른다 |
   | sidebar 설정 없음 | README "Sidebar 설정". `~/.config/herdr/config.toml`은 **사용자 설정이므로 사용자 승인 후** 기존 행을 보존한 채 추가만 한다 |

2. **개발 도구 확인(선택)**: `npm run check`, `npm test` (mock 단위 테스트), `bun scripts/build.ts`(source 변경 시에만, dist와 함께 commit).
3. **팀 자동 구성 확인**: 사용자가 Herdr pane에서 이 폴더로 `claude`를 새로 시작하게 한 뒤 `herdr agent list`로 확인한다. `gjc-herdr-lead`(Claude)와 `gjc-herdr-mate`(GJC), Codex를 켰고 설치돼 있으면 `gjc-herdr-critic`도 확인한다. 구성 예정인 agent가 보이지 않으면 `scripts/team-up.sh --spawn`을 수동 실행하고 stderr 안내를 읽는다. Codex의 작업 폴더와 label도 실제 응답으로 확인한다. **hook은 Claude 재시작 시 자동 실행되는지 새 컴퓨터에서 처음 한 번 실제로 확인한다.**
4. **보고**: 점검·플러그인·team-up·표시를 각각 실제 출력으로 구분해 보고한다.

금지: GJC·Herdr 본체 수정, 사용자 credentials·PATH·권한·다른 플러그인 변경, 소유하지 않은 pane 종료, 승인 없는 commit·push·tag·전역 설치.

## 4. 팀장 ↔ 구현 팀원·검토 팀원 대화 방법

GJC는 Herdr가 *감지*한 agent가 아니라 상태 *보고*만 있어, `herdr agent prompt gjc-herdr-mate`는 `agent_not_ready`로 거절된다. 방향별 채널은 다르다.

- **팀장 → 팀원 (Claude → GJC):** 팀원의 session ID를 읽어 공식 SDK로 보낸다.
  ```sh
  herdr agent get gjc-herdr-mate     # tokens.gjc_herdr_session_id 확인
  gjc sdk session send <session_id> --text "<요청>" --wait --timeout-ms 120000
  ```
  답은 반환된 `content.text`다. 팀원이 working이면 입력이 진행 중인 turn에 합쳐지므로 짧은 후속만 보낸다. timeout처럼 전송 확실성이 불명하면 재전송 전에 `herdr agent read gjc-herdr-mate`로 먼저 확인한다. 읽기 전용 관찰은 `gjc sdk session tail <session_id> --json`.
  `endpoint_stale` 등으로 SDK 전송이 실패하면 재전송하지 않고 응답의 `operationRef`와 상태를 보존한다. `GJC_SDK_BROKER_AUTOSTART=0 gjc sdk session list --attach-only --scope all`로 기존 broker만 조회해(broker를 새로 띄우거나 재기동하지 않는다) 팀원의 `tokens.gjc_herdr_session_id`와 같은 ID가 있는지 확인한다. SDK endpoint 파일이나 listen 포트가 있어도 세션 등록을 뜻하지 않는다. `broker_unavailable` 등 조회 실패는 등록 누락으로 판정하지 않는다.
  조회가 성공한 전체 목록에 그 ID가 없을 때만 인계할 내용을 파일로 남기고 **사용자 승인 후** 팀원 GJC를 `/exit`로 정상 종료한 뒤 `scripts/team-up.sh --spawn`으로 재시작한다. 재시작하면 팀원의 대화 맥락이 사라진다. 회복은 새 세션 ID의 목록 등록과 무해한 SDK 전송 1회·답변으로 확인한다. 그동안 급한 전달은 기존 수동 입력 규칙대로 팀원 pane의 idle·비포커스·빈 입력란을 확인한 뒤 pane 입력을 쓴다. 자동 fallback·자동 재시작은 하지 않는다.
- **팀원 → 팀장 (GJC → Claude):** GJC의 `/herdr-call` 또는 `herdr_agent_call` 도구로 대상 `gjc-herdr-lead`를 호출해 답을 받는다(이 플러그인의 기능). 입력 보호를 거치지 않는 bash의 `herdr agent prompt`·`herdr pane send-text`/`send-keys` 직접 호출은 하지 않는다. 팀장이 working이면 `agent_not_ready`로 거절될 수 있으며, 그러면 같은 pane에 입력을 밀어 넣지 말고 결과를 파일로 남기고 다음 기회에 알린다.
- **팀장 → 검토 (Claude → Codex):** 자체 완결 지시서 파일을 스크립트로 보낸다. 같은 workspace의 소유 Codex가 idle/done·비포커스일 때만 시작하며, 저장소 스냅숏 → 빈 입력란 확인 → 필요 시 `/new`·새 화면 준비 확인 → pane ID로 전송·working 수락 확인 → 전송 뒤 이름 확인·필요 시 재등록 → 고정 pane의 완료 대기 → 저장소 비교를 수행한다.
  ```sh
  scripts/critic-send.sh <지시서 파일>                    # 기본 30분
  scripts/critic-send.sh --timeout 3600000 <지시서 파일>   # 대기 한도 1시간
  scripts/critic-send.sh --no-wait <지시서 파일>           # 수락까지 확인하고 반환
  scripts/critic-send.sh --compare <출력된 스냅숏 파일>    # 완료 확인 뒤 나중 비교
  ```
  화면은 `--source visible --format ansi`로 읽으며, 마지막 0번째 칸 `›` 뒤의 정확한 placeholder 문구가 **전부 흐림(dim)**일 때만 빈 입력란으로 인정한다. 같은 문구를 직접 친 draft·일부만 흐린 문구·흐림 정보가 없는 화면은 거부한다. SGR은 `src/input.ts`와 같이 `0`·`22`가 흐림을 해제하고 `2`가 흐림을 설정하며, RGB·팔레트 색상 인자 및 콜론 형식 안의 숫자를 흐림 코드로 오인하지 않는다. 잘린 SGR·해석할 수 없는 색상 인자·다른 escape도 거부하며, ANSI 없는 텍스트 판정으로 되돌리지 않는다.
  이름·작업 폴더는 `team-up.sh`와 같은 `GJCH_CRITIC_NAME`·`GJCH_CODEX_WORKDIR`를 사용한다. 뒤가 비었거나 공백뿐인 줄도 포함해 줄 맨 앞(0번째 칸)의 `›`만 입력란 후보로 확인한다. 공백·탭으로 들여쓴 `›`는 여러 줄 draft의 내용일 수 있어 후보로 보지 않는다. 마지막 후보가 정확한 빈 placeholder(`Ask Codex to do anything`)가 아니면 거부하며 draft를 자동 삭제하지 않는다. `›`만 있는 줄은 빈 입력란으로 간주하지 않는다. 마지막 입력란 뒤에는 빈 줄 외에 상태 줄 1개와 그 뒤의 알려진 안내 줄(`← for agents · ? for shortcuts` 또는 `? for shortcuts`) 0~1개만 허용한다(두 형식 모두 안내 줄 생략·알려진 접두부의 말줄임은 허용). 안내 줄 뒤 공백으로 구분된 `⚠ <숫자> warning(s) · f2 to view` 또는 경고 표시만 있는 줄도 허용하며, 경고의 알려진 접두부가 잘린 꼴도 허용한다. 마지막 후보 뒤에 이어지는 비어 있지 않은 입력 줄·본문·두 번째 상태 줄·임의 꼬리말은 계속 거부한다. 이 상태 줄에서 `Context 100% left`와 완전히 보이는 누적 입력 `0 in`을 확인하면 `/new` 없이 보낸다(출력 카운터도 완전히 보이면 `0 out`이어야 한다). 출력 tail은 완전한 카운터·숫자 카운터의 잘림·구분자의 말줄임만 허용하고 `unrecognized…` 같은 임의 문구는 거부한다. 헤더·잘린 출력 카운터나 scrollback의 과거 문자열은 새 화면 근거로 쓰지 않는다. 판정 불가 시 pane이 확인 크기 56×10보다 작으면 현재 W×H와 확대 안내를 남긴다. 그 이상이면 상태 줄·안내 줄 형식을 판정할 수 없다고 안내하고 마지막 화면 6줄을 함께 출력한다. 모델 이름에 따라 필요한 폭이 달라질 수 있다. 기존 대화에서는 send-text 뒤 입력란에 `/new`가 보일 때까지 1초 간격·최대 5초 관측하고, 보이면 Enter를 한 번만 보낸다. 보이지 않으면 코드 2로 끝내며 Enter·지시서는 보내지 않는다. `/new` 뒤 새 화면과 revision/상태 seq 변경·idle/done·`interactive_ready`를 함께 판정하고, 관측 반환 뒤 준비 한도 30초·전체 한도를 넘었으면 지시서를 보내지 않는다. `/new`·Enter 뒤 1초 간격 두 관측에서 미제출 글이 남으면 코드 2로 끝내며 지시서·Enter를 재전송하거나 글을 삭제하지 않는다. `--timeout`은 1–86400000ms(24시간), 입력 최대 9자리이며 선행 0은 허용한다. bash 3.2의 `SECONDS`(1초 해상도)로 측정하며 초 단위로 올림한다. 완료 대기에서는 한도를 넘겨 반환된 done/idle도 완료 관측으로 받아 비교하며, 아직 미완료인 채 한도를 넘으면 코드 2로 끝낸다. 하위 herdr 명령이 반환하지 않으면 스크립트 한도로 끊지 못한다. 필요하면 Ctrl-C(130) 뒤 안내를 따른다. 스냅숏은 저장소 밖 `/tmp`에 남긴다. 종료 코드 1은 조건 거부·확인 실패(지시서 전송 전 준비 timeout 포함), 2는 `/new`·지시서 전송 불확실·미제출 또는 완료 대기 timeout, 3은 저장소 변화다. SIGINT/SIGTERM으로 끝날 때도 전송 시도 뒤 안내를 남긴다(130/143). `--compare`는 다른 옵션과 함께 쓰지 않는다. 전송 시도 뒤 중단하거나 `--no-wait`로 반환하면 재전송하지 말고 공개 상태·완료를 확인한 뒤 출력된 `--compare` 명령을 쓴다. focus/occupant 확인과 입력은 원자적이지 않으며, 화면 형식이 달라지면 안전하게 거부한다.
  스크립트를 못 쓸 때만 수동으로 **소유 pane·idle/done·비포커스·빈 입력란 확인 → 기존 대화이면 `/new`·새 입력란 준비 관측 → `herdr agent prompt <pane-id> "<지시서>" --wait --timeout <ms>` → 전송 뒤 이름 확인** 순서를 따른다. `interactive_ready`나 고정 sleep만으로는 준비를 판단하지 않는다. 이름이 풀렸으면 다른 pane이 점유하지 않았음을 확인하고 `herdr agent rename <pane-id> gjc-herdr-critic`으로 다시 붙인다. 완료 대기는 이름이 풀려도 고정 pane·terminal·workspace·cwd로 계속하며, 다른 이름으로 바뀌면 중단한다. 수동 경로의 저장소 전후 비교도 생략하지 않는다.
  지시서에 결과를 **작업 폴더의 지정 파일**로 쓰고 경로를 회신하도록 적는다. pane 출력은 접혀 보일 수 있고 working 중에는 read가 불가하므로, 완료·idle/done을 확인한 뒤 그 파일을 읽어 본문을 받는다. Codex → 팀장 직접 호출은 기대하지 않는다(샌드박스는 없지만 직접 호출 경로는 미확인이다). timeout이면 자동 재전송·`/new` 입력을 하지 말고 공개 상태와 결과 파일의 완료 여부부터 확인한다.
- 슬래시 명령(`/rename` 등)은 SDK 텍스트로 실행되지 않는다. 필요하면 사용자 승인 후 대상 pane의 idle·비포커스·빈 입력란을 먼저 확인하고 `herdr pane send-text <pane-id> "/명령"` + `herdr pane send-keys <pane-id> enter`를 쓴다. `pane` 명령은 agent 이름이 아니라 pane ID만 받으므로 `herdr agent get <이름>`으로 pane ID를 얻는다.
- 큰 근거·로그는 채팅에 붙이지 말고 파일 경로와 sha256으로 공유한다.

## 5. 협업 규칙(요약)

- 사용자 지시는 팀장이 받는다. 팀원이 직접 받으면 팀장에게 요약해 알리고, 범위 확대는 팀장 확인 후 한다.
- 배정에는 목적 한 줄, 맡길 결과, 쓰기 허용 파일(최대 3–5개), 금지 사항, 회신 방식, 배경(상대에게 대화 이력이 없다고 가정)을 적는다. 같은 파일을 동시에 쓰지 않는다.
- 팀원은 관측 사실 / source 근거 / 가설 / 미확인을 구분해 보고하고, 팀장은 직접 확인한 사실만 사용자에게 보고한다.
- 검토 요청은 빈 새 대화에서 시작한다. 이미 빈 새 화면이면 그대로 보내고, 기존 대화이면 idle/done·빈 입력란을 확인한 뒤 **`/new`**를 한다. 이전 회차·팀장 설명에 끌려가지 않도록 독립성을 유지하기 위한 규칙이다. 진행 중이거나 승인·질문 UI가 있으면 새 대화를 강제로 시작하지 않는다.
- 검토 지시서는 대화 이력이 없어도 수행 가능한 자체 완결 문서다. 2회차라면 1회차 지적 목록·근거 파일 경로·sha256을 새 지시서에 싣는다.
- 구현(GJC)과 검토(Codex)를 같은 회차에 섞지 않는다. Codex는 검토 결과 파일만 작업 폴더에 작성하며 저장소 쓰기·commit·적용은 금지한다. **`--yolo`는 사용자 지시이고 샌드박스가 없으므로 이 금지는 지시서 규칙으로 지킨다.** 검토 결과가 팀장 검증이나 사용자 승인을 대신하지 않는다.
- Codex는 Herdr로 다른 pane에 입력하거나 다른 agent의 승인·질문 대화상자에 응답하지 않는다. GJC 팀원의 다른 에이전트 전송은 플러그인 명령·도구로만 한다. 각 역할의 이 규칙도 배정 지시서에 적는다.
- 팀장은 Codex 작업 전후 저장소 상태를 비교한다(`critic-send.sh` 정상 완료 시 자동 수행, 중단·`--no-wait` 뒤에는 완료 확인 후 `--compare`). HEAD의 commit·symbolic target(detached 여부 포함)·ref·stash·index·작업 트리(추적·untracked 파일 내용 포함)의 변화는 보지만 gitignore된 untracked 경로의 쓰기는 보이지 않는다. 변화가 있으면 확인하며, 동시 팀장 작업도 가능하므로 Codex 위반으로 단정하지 않는다. 작업 중 바뀌었다가 원복된 내용도 전후 비교만으로는 알 수 없다.
- 확인된 요구 없이 기능·테스트·추상화를 늘리지 않는다(최소 구현).
- 다른 프로젝트의 agent·workspace(다른 workspace의 이름이 다른 agent)는 팀원이 아니므로 호출·입력하지 않는다.
- 이 저장소의 루트 `AGENTS.md`는 작성자의 로컬 비공개 파일이라 clone에는 없다. 팀원에게는 팀장이 첫 배정 메시지에 위 규칙의 필요한 부분을 직접 전달한다.

## 6. 자주 있는 문제

| 증상 | 원인·조치 |
|---|---|
| 팀원 pane이 안 생김 | hook이 가드에서 종료됨(Herdr 밖, cwd가 프로젝트 밖, `GJCH_TEAM_ROLE` 설정, `herdr`/`python3` 없음). `scripts/check-env.sh`와 `scripts/team-up.sh --spawn` 출력 확인 |
| Codex pane이 안 생김 | `codex` 없음 또는 `GJCH_TEAM_CODEX=0`이면 선택 단계 생략. 기존 critic이 있으면 새 pane을 만들지 않음. 저장소 자체·내부·상위 작업 폴더는 거부하므로 `GJCH_CODEX_WORKDIR`의 실제 경로와 stderr를 확인 |
| `/clear` 뒤 팀장 이름(`gjc-herdr-lead`)이 사라짐 | 셸에서 실행한 Claude에 붙인 이름은 `/clear`로 세션 ID가 바뀌면 Herdr가 지운다. 이제 `clear` SessionStart hook이 팀장 이름·label만 다시 붙이며, 팀원·검토 pane은 새로 만들지 않는다. 복구되지 않으면 `scripts/team-up.sh`를 수동 실행해 이름·label을 되찾는다 |
| agent 이름이 이미 사용 중 | 다른 pane이 점유 중이라 label을 건드리지 않음(의도된 동작). 이름은 pane 종료·교체 시 사라짐 |
| sidebar에 모델·세션이 안 보임 | 플러그인 설치됨 ≠ 로드됨 ≠ 표시됨. 실행 중이던 GJC를 재시작하고 `herdr pane get <pane-id>`의 token을 확인, 이후 README "Sidebar 설정" |
| `agent_not_ready` | 대상이 감지되지 않았거나 working/blocked. GJC 대상은 위 SDK 경로를 쓴다 |
| `gjc sdk session send`의 `endpoint_stale` | 재전송하지 않고 `operationRef`·상태를 보존한다. `GJC_SDK_BROKER_AUTOSTART=0 gjc sdk session list --attach-only --scope all`에서 팀원 token의 세션 ID 등록을 확인한다(endpoint 파일·포트 존재 ≠ 등록, 조회 실패 ≠ 누락). 성공한 목록에 없으면 §4대로 인계 파일을 남기고 사용자 승인 후 정상 종료·`scripts/team-up.sh --spawn` 재시작, 새 ID 등록·무해한 SDK 왕복 1회로 회복 확인. 이슈 #8에서는 실행 중 `gjc` 교체 뒤 세션 등록 누락을 관측했고 재시작 후 회복했으나, 등록 누락의 최초 원인은 미확정이다 |

더 자세한 사용법은 [README](../README.md)를 참조한다.
