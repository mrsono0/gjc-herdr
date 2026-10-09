# 개발 환경: Herdr + 팀장(Claude Code) + 팀원(GJC)

이 저장소는 한 Herdr workspace에서 **팀장(Claude Code)** 과 **팀원(GJC)** 이 서로 호출하며 `gjc-herdr`을 개발하도록 구성되어 있다. 새 컴퓨터에서 `git clone`한 뒤 AI(Claude Code 등)가 이 문서를 읽고 스스로 점검·구축할 수 있게 쓴 문서다. 이 문서는 AI 에이전트가 따를 지침이므로 각 단계의 **실제 출력으로 판정**하고, 확인하지 못한 항목을 성공으로 적지 않는다.

## 1. 구성 요약

| 역할 | 에이전트 | 이름·label | 하는 일 |
|---|---|---|---|
| 팀장 | Claude Code | agent `gjc-herdr-lead`, pane label `GJCH 팀장 · Claude` | 사용자와 대화, 작업 분해·배정, 결과 검증, 승인이 필요한 외부 작업(commit/push/설치) 요청 |
| 팀원 | GJC | agent `gjc-herdr-mate`, pane label·세션 이름 `GJCH 팀원 · GJC` | 배정된 파일 구현·검토, 실제 GJC 런타임 관측 |

작업공간 label은 `GJCH · gjc-herdr`이다. 이름은 `scripts/team-up.sh`가 환경변수 `GJCH_LEAD_NAME`/`GJCH_MATE_NAME`으로 바꿀 수 있다.

## 2. 자동 구성이 일어나는 방식

1. 사용자가 **Herdr pane 안에서 이 프로젝트 폴더에 들어가 `claude`를 실행**한다.
2. `.claude/settings.json`의 SessionStart(`startup`) hook이 `scripts/team-up.sh --hook`을 호출한다(백그라운드, 즉시 반환).
3. `team-up.sh --spawn`이 다음을 순서대로 수행한다. 각 단계는 조건이 맞을 때만 실행되고 아무것도 덮어쓰지 않는다.
   - 가드: Herdr 안(`HERDR_ENV=1`)·`herdr`/`python3` 존재·이 pane의 실제 cwd가 프로젝트 안·`GJCH_TEAM_ROLE` 미설정일 때만 진행한다. 아니면 조용히 종료한다.
   - 이 pane의 agent 이름을 `gjc-herdr-lead`로 확보(이미 다른 pane이 쓰면 건드리지 않음)하고 pane label과, 폴더명 기본값인 작업공간 label을 바꾼다. Claude 감지 지연 때문에 최대 약 60초 재시도한다.
   - 팀원 pane이 없으면 `pane split --no-focus`로 만들고(재시작 후 남은 빈 셸 pane은 재사용) `gjc`를 실행해 `gjc-herdr-mate`로 이름을 붙인다.
   - GJC가 idle이고 `gjc_herdr_session_id` token이 발행되면 `/rename GJCH 팀원 · GJC`를 입력해 세션 이름을 맞춘다. 준비가 안 되면 수동 안내만 출력한다.
4. 사용자의 focus·다른 pane·설정은 바꾸지 않는다.

수동 실행: `scripts/team-up.sh`(이름·label만), `scripts/team-up.sh --spawn`(팀원 포함).

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
   | `gjc` 없음 | GJC 본체는 이 저장소가 설치하지 않는다. 사용자에게 설치를 요청한다 |
   | `herdr` 없음 / Herdr pane 밖 | Herdr를 설치하고 **Herdr 안의 pane에서** Claude Code를 실행하도록 안내한다(팀 구성·token 표시는 Herdr 안에서만 동작) |
   | `bun` 없음 또는 버전 불일치 | GJC plugin 설치에 필요. build는 `package.json`의 `engines.bun`(1.4.2) 고정 |
   | `node_modules` 없음 | `npm ci --ignore-scripts --no-audit --no-fund` (개발·테스트 시) |
   | `team-up.sh` 실행 권한 없음 | `chmod +x scripts/team-up.sh scripts/check-env.sh` |
   | `gjc-herdr` 플러그인 미설치 | README "설치 (한 줄)"과 "AI 에이전트 설치 지침"을 따른다 |
   | sidebar 설정 없음 | README "Sidebar 설정". `~/.config/herdr/config.toml`은 **사용자 설정이므로 사용자 승인 후** 기존 행을 보존한 채 추가만 한다 |

2. **개발 도구 확인(선택)**: `npm run check`, `npm test` (mock 단위 테스트), `bun scripts/build.ts`(source 변경 시에만, dist와 함께 commit).
3. **팀 자동 구성 확인**: 사용자가 Herdr pane에서 이 폴더로 `claude`를 새로 시작하게 한 뒤 `herdr agent list`로 확인한다. `gjc-herdr-lead`(Claude)와 `gjc-herdr-mate`(GJC)가 보이면 성공이다. 보이지 않으면 `scripts/team-up.sh --spawn`을 수동 실행하고 stderr 안내를 읽는다. **hook은 Claude 재시작 시 자동 실행되는지 새 컴퓨터에서 처음 한 번 실제로 확인한다.**
4. **보고**: 점검·플러그인·team-up·표시를 각각 실제 출력으로 구분해 보고한다.

금지: GJC·Herdr 본체 수정, 사용자 credentials·PATH·권한·다른 플러그인 변경, 소유하지 않은 pane 종료, 승인 없는 commit·push·tag·전역 설치.

## 4. 팀장 ↔ 팀원 대화 방법

GJC는 Herdr가 *감지*한 agent가 아니라 상태 *보고*만 있어, `herdr agent prompt gjc-herdr-mate`는 `agent_not_ready`로 거절된다. 방향별 채널은 다르다.

- **팀장 → 팀원 (Claude → GJC):** 팀원의 session ID를 읽어 공식 SDK로 보낸다.
  ```sh
  herdr agent get gjc-herdr-mate     # tokens.gjc_herdr_session_id 확인
  gjc sdk session send <session_id> --text "<요청>" --wait --timeout-ms 120000
  ```
  답은 반환된 `content.text`다. 팀원이 working이면 입력이 진행 중인 turn에 합쳐지므로 짧은 후속만 보낸다. timeout처럼 전송 확실성이 불명하면 재전송 전에 `herdr agent read gjc-herdr-mate`로 먼저 확인한다. 읽기 전용 관찰은 `gjc sdk session tail <session_id> --json`.
- **팀원 → 팀장 (GJC → Claude):** GJC의 `/herdr-call` 또는 `herdr_agent_call` 도구로 대상 `gjc-herdr-lead`를 호출해 답을 받는다(이 플러그인의 기능). 팀장이 working이면 `agent_not_ready`로 거절될 수 있으며, 그러면 같은 pane에 입력을 밀어 넣지 말고 결과를 파일로 남기고 다음 기회에 알린다.
- 슬래시 명령(`/rename` 등)은 SDK 텍스트로 실행되지 않는다. 필요하면 사용자 승인 후 `herdr pane send-text <pane-id> "/명령"` + `herdr pane send-keys <pane-id> enter`를 입력창이 빈 idle 상태에서만 쓴다. `pane` 명령은 agent 이름이 아니라 pane ID만 받으므로 `herdr agent get <이름>`으로 pane ID를 얻는다.
- 큰 근거·로그는 채팅에 붙이지 말고 파일 경로와 sha256으로 공유한다.

## 5. 협업 규칙(요약)

- 사용자 지시는 팀장이 받는다. 팀원이 직접 받으면 팀장에게 요약해 알리고, 범위 확대는 팀장 확인 후 한다.
- 배정에는 목적 한 줄, 맡길 결과, 쓰기 허용 파일(최대 3–5개), 금지 사항, 회신 방식, 배경(상대에게 대화 이력이 없다고 가정)을 적는다. 같은 파일을 동시에 쓰지 않는다.
- 팀원은 관측 사실 / source 근거 / 가설 / 미확인을 구분해 보고하고, 팀장은 직접 확인한 사실만 사용자에게 보고한다.
- 확인된 요구 없이 기능·테스트·추상화를 늘리지 않는다(최소 구현).
- 다른 프로젝트의 agent·workspace(다른 workspace의 이름이 다른 agent)는 팀원이 아니므로 호출·입력하지 않는다.
- 이 저장소의 루트 `AGENTS.md`는 작성자의 로컬 비공개 파일이라 clone에는 없다. 팀원에게는 팀장이 첫 배정 메시지에 위 규칙의 필요한 부분을 직접 전달한다.

## 6. 자주 있는 문제

| 증상 | 원인·조치 |
|---|---|
| 팀원 pane이 안 생김 | hook이 가드에서 종료됨(Herdr 밖, cwd가 프로젝트 밖, `GJCH_TEAM_ROLE` 설정, `herdr`/`python3` 없음). `scripts/check-env.sh`와 `scripts/team-up.sh --spawn` 출력 확인 |
| agent 이름이 이미 사용 중 | 다른 pane이 점유 중이라 label을 건드리지 않음(의도된 동작). 이름은 pane 종료·교체 시 사라짐 |
| sidebar에 모델·세션이 안 보임 | 플러그인 설치됨 ≠ 로드됨 ≠ 표시됨. 실행 중이던 GJC를 재시작하고 `herdr pane get <pane-id>`의 token을 확인, 이후 README "Sidebar 설정" |
| `agent_not_ready` | 대상이 감지되지 않았거나 working/blocked. GJC 대상은 위 SDK 경로를 쓴다 |

더 자세한 사용법은 [README](../README.md)를 참조한다.
