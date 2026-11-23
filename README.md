# gjc-herdr

herdr-core(`hc`) 터미널 안의 GJC에서 **다른 `hc` 터미널로 프롬프트를 보내고**(`/herdr-send`·`herdr_send`), **다른 로컬 에이전트를 호출해 결과 파일로 답변을 받으며**(`/herdr-call`·`herdr_agent_call`), **파일 우편함**(`herdr_mail_send`·우편 받기)을 쓰는 설치형 플러그인이다. GJC·`hc` 본체를 수정하지 않으며 별도 launcher나 서비스를 설치하지 않는다.

v0.7.0부터 `herdr-core`(`hc`) 전용이다. 옛 `herdr server` 경로(sidebar 메타데이터 token·`herdr` CLI·GJC SDK 전달·화면 읽기 회수)가 필요하면 `v0.6.1` tag를 설치한다.

배포 정책: **npm registry에는 발행하지 않는다.** 이 Git 저장소에서 직접 설치한다. 실행 파일 `dist/extension.js`는 저장소에 포함되어 있어 설치 시 build가 필요 없다.

## 새 컴퓨터 빠른 시작 (Herdr + Claude Code 팀장 + agy 팀원 + 선택 Codex 검토)

Herdr 안에서 Claude Code(팀장)가 agy(구현 팀원)와 선택 Codex(독립 검토·조사 팀원)에 역할을 나눠 개발하는 환경을 구성할 수 있다. GJC는 이 플러그인의 설치·관측 대상이며, 실사용 관측이 필요할 때 팀장이 임시 탭에 띄운다. AI가 읽고 따를 수 있게 준비되어 있다. Codex 자동 구성은 `GJCH_TEAM_CODEX=0`으로 끌 수 있다. Codex는 **`--yolo`(승인·샌드박스 없음)** 로 저장소 루트에서 실행되므로, "파일 수정이 필요하면 먼저 팀장 허락을 받는다"는 제1원칙을 규칙 파일·지시서로 지킨다.

**사람이 할 일**

1. 아래 "필요한 프로그램"을 설치한다.
2. 저장소를 clone하고 **Herdr pane 안에서** 그 폴더로 들어가 Claude Code를 실행한다.
   ```sh
   git clone https://github.com/mrsono0/gjc-herdr.git
   cd gjc-herdr
   claude
   ```
3. Claude에게 **"안내대로 환경 설정해줘"** 라고 말한다. 루트 `CLAUDE.md`가 자동으로 읽혀, Claude가 `scripts/check-env.sh`(읽기 전용 점검)를 실행하고 부족한 항목만 [docs/dev-environment.md](docs/dev-environment.md) 절차대로 해결한다. `gjc-herdr` 플러그인 설치와 `~/.config/herdr/config.toml` 같은 사용자 설정 변경은 승인을 요청한다.
4. 설정이 끝나면 Claude를 한 번 재시작한다. `.claude/settings.json`의 SessionStart(`startup|clear`) hook이 `scripts/team-up.sh --hook`을 실행한다. `startup`에서는 팀장(`gjc-herdr-lead`) pane 이름을 정하고 팀원 agy(`gjc-herdr-mate`, pane label `GJCH 팀원 · agy`) pane을 만든다(`agy`가 폴더 신뢰 창이나 다른 질문으로 시작 중 멈춰 `blocked` 안내가 나오면 사용자가 그 pane에서 확인·응답한 뒤 `scripts/team-up.sh --spawn`을 다시 실행한다). `codex`가 있고 끄지 않았으면 저장소 루트에서 실행되는 선택 검토 Codex(agent `gjc-herdr-critic`, pane label `GJCH 검토·조사 · Codex`)도 구성한다. `/clear` 뒤에는 팀장 이름·pane label과, 비었거나 폴더명 기본값인 작업공간 label만 복구하며, 팀원·검토 pane이 없어도 새로 만들지 않는다. `herdr agent list`로 구성 예정인 agent가 보이는지 확인한다. 배치 공식 기준은 팀장 위(높이 60%), 아래 왼쪽 팀원 agy | 오른쪽 검토 Codex(반반)이고, 검토가 없거나 꺼져 있거나 다른 탭이면 팀장 60% / 팀원 아래다(꺼 둔 검토가 같은 탭에 남아 있으면 팀 구성 보정은 옮기지 않고 건너뛴다). Sidebar 등 다른 pane은 건드리지 않는다(단, 임시 탭 경유 이동 때 그 임시 탭에 자동 생성된 agent 없는 Sidebar는 탭 닫기로 함께 정리한다). 적용 시점은 팀 구성·복구(`--spawn`, 그것을 부르는 `startup` 훅) 끝과 수동 `scripts/team-up.sh --layout`이며 `/clear` 훅은 배치를 건드리지 않는다. 팀 구성 때는 팀원이 팀장과 다른 탭에 있는 등 조건이 안 맞는 것이 확인되면 옮기지 않고 이유만 남기고(재사용한 빈 셸 pane도 팀장 탭에 있을 때만 보정 대상), Herdr 조회가 실패하면 옮기지 않고 실패로 끝내며, 배치 실패는 agent 기동을 막지 않고 종료 코드와 `--layout` 안내만 남긴다. 자세한 기준·조건은 [docs/dev-environment.md](docs/dev-environment.md) §2 "배치 공식 기준".

**필요한 프로그램**

| 프로그램 | 용도 | 설치 | 확인 |
|---|---|---|---|
| `herdr-core` (`hc`) | 플러그인 실행 환경(필수) — `/herdr-send`·`/herdr-call`은 `hc` 터미널 안 GJC에서만 등록. 팀 Core 모드(`GJCH_CORE=1`)의 바탕 | herdr-core 설치 안내 참조 | `hc --version` |
| [Herdr](https://herdr.dev) | 팀 개발 환경(기본 모드)의 agent pane 관리자 (0.9.3에서 검증) | `brew install herdr` 또는 `curl -fsSL https://herdr.dev/install.sh \| sh` | `herdr --version` |
| [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) | 팀장 (2.1.295에서 사용) | `brew install --cask claude-code@latest` 또는 공식 문서의 설치 방법 | `claude --version` |
| Antigravity CLI (`agy`) | 구현 팀원 (`gjc-herdr-mate`, `--mode accept-edits --sandbox`) | Antigravity CLI 설치 안내 참조 | `agy --version` |
| [GJC (Gajae Code)](https://github.com/Yeachan-Heo/gajae-code) | 이 플러그인의 설치·관측 대상 (0.18.8에서 사용, 설치 검증은 0.18.7) | 해당 저장소의 [설치 문서](https://github.com/Yeachan-Heo/gajae-code/blob/main/docs/install.md)에서 태그된 설치 스크립트를 내려받아 실행 | `gjc --version` |
| [Codex CLI](https://github.com/openai/codex) (선택) | 독립 검토·조사 팀원. `GJCH_TEAM_CODEX=0`으로 끌 수 있음 | 공식 설치 안내 또는 `npm install -g @openai/codex` | `codex --version` |
| [Bun](https://bun.sh) 1.4.3 | GJC가 Git 플러그인을 설치할 때 필요, build는 1.4.3 고정 | `curl -fsSL https://bun.sh/install \| bash` (특정 버전은 Bun 문서 참조) | `bun --version` |
| git, python3 | clone, `team-up.sh`의 JSON 처리 | macOS는 보통 기본 포함 또는 `brew install git python` | `git --version`, `python3 --version` |
| `gjc-herdr` 플러그인 | `hc` 프롬프트 전달(`/herdr-send`), 에이전트 호출(`/herdr-call`), 파일 우편함 | 아래 "설치 (한 줄)" | `gjc plugin list --json` |
| Node.js/npm (개발 시에만) | `npm ci`, 단위 테스트, typecheck | `brew install node` | `npm --version` |

Herdr 밖에서 실행하면 기본 모드에서는 팀 자동 구성이 동작하지 않는다(정상). 플러그인의 전달·호출은 Herdr가 아니라 `hc` 터미널 안에서만 쓸 수 있다(v0.7.0부터). Herdr 밖(데스크톱 앱 Code 탭 등)에서 팀장을 맡는 외부 팀장 모드와 팀장 이관 절차는 [docs/dev-environment.md](docs/dev-environment.md) §2.1–§2.2를 참조한다. 설치 상태는 언제든 `scripts/check-env.sh`로 다시 점검할 수 있다. 자세한 구성·대화 방법·문제 해결은 [docs/dev-environment.md](docs/dev-environment.md).

**Core(`herdr-core`, `hc`) 변형**

이 절은 팀 개발 환경을 Core에서 운용하는 방법이며, 플러그인 자체는 팀 개발 모드와 상관없이 `hc` 터미널에서 동작한다. Herdr 서버 대신 `herdr-core`(`hc`) 데몬에서 팀장(`gjch-lead`)·구현 팀원(`gjch-mate`)·검토 팀원(`gjch-critic`)을 운용할 때는 `GJCH_CORE=1`(외부 팀장 `GJCH_EXTERNAL_LEAD=1` 함께 사용) 스위치를 켠다.

```sh
hc --version && hc server status --json
GJCH_CORE=1 GJCH_EXTERNAL_LEAD=1 scripts/check-env.sh
GJCH_CORE=1 GJCH_EXTERNAL_LEAD=1 scripts/team-up.sh --up
```

- `--up` 직후 끝의 `--check` 요약이 종료 코드 `2`(`unknown`)로 나오고 그 이유가 초기 준비 지연(`reported=false`·foreground 미관측)으로 확인되면, 잠시 뒤 `GJCH_CORE=1 GJCH_EXTERNAL_LEAD=1 scripts/team-up.sh --check`를 다시 실행해 `0`(`ok`)을 확인한다.
- 팀장 기동 명령, 잠금 인계, 팀원 정리(`--down`) 및 Herdr로의 되돌리기 절차는 [docs/dev-environment.md](docs/dev-environment.md) §2.4를 참조한다.

## 설치 (한 줄)

```sh
gjc plugin install "gjc-herdr@git+https://github.com/mrsono0/gjc-herdr.git"
```

- tag 없이 설치하면 `main`의 최신 release가 설치된다. `main`에는 build된 `dist/extension.js`가 포함된 release 상태만 push한다.
- `gjc-herdr@` 접두사를 그대로 쓴다. 접두사 없이 URL만 주면 GJC는 다른 설치 형식(bundle)으로 분류해 실패한다.
- `--user`·`--scope`·`--project`를 붙이지 않는다.
- 설치는 실행한 사용자의 `~/.gjc/plugins/` registry만 변경한다. Bun이 Git에서 가져오며 npm registry를 사용하지 않는다.
- 특정 버전으로 고정하려면 tag를 붙인다(예: 옛 `herdr server` 경로가 필요할 때 `#v0.6.1` 설치): `gjc plugin install "gjc-herdr@git+https://github.com/mrsono0/gjc-herdr.git#v0.6.1"`.

### 최신 버전으로 업데이트

설치 시점의 commit이 lock에 고정되므로 같은 설치 명령을 다시 실행하거나 `--force`를 붙여도 새 버전으로 바뀌지 않는다. `gjc plugin upgrade`는 marketplace plugin 전용이다. 제거 후 다시 설치한다.
`bun update gjc-herdr`를 `~/.gjc/plugins/`에서 실행해도 같은 commit 고정을 푼다(검증됨). 이 방법은 GJC가 관리하는 registry directory를 직접 다루므로, 위의 제거 후 설치가 기본 방법이다.

```sh
gjc plugin uninstall gjc-herdr
gjc plugin install "gjc-herdr@git+https://github.com/mrsono0/gjc-herdr.git"
```

실행 중이던 GJC는 재시작해야 새 버전을 로드한다.

## AI 에이전트 설치 지침

사용자가 이 저장소 주소만 주었을 때 다음 순서로 진행하고, 각 단계의 실제 출력으로 판정한다.

1. **사전 확인**
   ```sh
   gjc --version      # Git 설치는 0.18.7에서 검증 (플러그인 동작은 0.18.6에서도 검증)
   hc --version       # herdr-core CLI 확인
   bun --version      # GJC plugin 설치에 필요
   git --version
   echo "$HC_TERMINAL_ID"   # hc 터미널 안에서 실행 중인지 (값이 있어야 /herdr-send·/herdr-call 등록)
   ```
   `hc` 터미널 밖(`HC_TERMINAL_ID` 없음)에서 실행한 GJC에는 `/herdr-send`·`/herdr-call`과 `herdr_send`·`herdr_agent_call`이 등록되지 않고 파일 우편함만 등록된다(정상).
2. **기존 설치 확인**: `gjc plugin list --json`의 `npm` 배열에 `gjc-herdr`가 있으면 `~/.gjc/plugins/package.json`의 `dependencies["gjc-herdr"]`와 설치된 version을 확인한다. 최신 release가 이미 설치되어 있으면 설치 단계를 건너뛴다. 이전 버전이거나 다른 source(tag 고정·로컬 tarball 등)면 `gjc plugin uninstall gjc-herdr` 후 위 한 줄로 설치한다.
3. **설치**: 위 한 줄 명령. 성공 판정은 `gjc plugin list --json`에 `gjc-herdr`가 `enabled: true`이고 version이 저장소 `main`의 `package.json` version과 같으며, `~/.gjc/plugins/node_modules/gjc-herdr/dist/extension.js`가 존재하는 것이다.
4. **로드 확인** (설치됨 ≠ 로드됨):
   - 플러그인이 로드되기 전 실행 중이던 GJC는 종료 후 **새로 시작**한다.
   - `hc` 터미널 안에서 `gjc`를 새로 시작했을 때 `/herdr-send`·`/herdr-call` 명령이 보이면 로드·등록됨을 확인한 것이다.
   - `hc` 터미널 밖이면 우편 도구(`herdr_mail_send`)만 등록되는 것이 정상이다.
5. **보고**: 설치와 로드 확인을 실제 출력으로 구분해 보고한다. 확인하지 못한 항목을 성공으로 적지 않는다.

금지: GJC/Herdr 본체·credentials·다른 플러그인·사용자 모델 설정 변경, `plugin link`로 대체, 설치 실패를 build/소스 수정으로 우회.

## 동작

플러그인은 시작 시 환경변수를 보고 아래 순서로 기능을 등록한다.

- `GJC_HERDR_DISABLE`이 정확히 `1`이면 아무것도 등록하지 않고 종료한다(아래 절).
- `HC_TERMINAL_ID`(앞뒤 공백 제거)가 비어 있지 않을 때만 `/herdr-send`·`/herdr-call` 명령과 `herdr_send`·`herdr_agent_call` 도구를 등록한다. `hc` 실행 파일은 `GJC_HERDR_HC_BIN`으로 지정할 수 있다(기본 `hc`).
- `HC_TERMINAL_ID`가 없으면 위 전달·호출 명령과 도구를 등록하지 않는다(주소 형식 검사는 진입부가 아니라 실행 시점에 `hc` 경로가 수행한다).
- 파일 우편함 도구(`herdr_mail_send`)와 우편 받기는 `HC_TERMINAL_ID` 유무와 무관하게 항상 등록한다(우편 받기 활성화 조건은 아래 "파일 우편함 보내기·받기" 절).
- v0.7.0에서는 Herdr 메타데이터 token 보고와 그것을 위한 타이머·세션 이벤트 훅을 등록하지 않으며(우편 받기는 켜면 자기 타이머·훅을 씀), `GJC_HERDR_BACKEND`·`HERDR_ENV`·`HERDR_PANE_ID`를 읽지 않는다.

### 끄기 (`GJC_HERDR_DISABLE`, v0.6.1)

플러그인을 쓰지 않는 호출에서는 환경변수 `GJC_HERDR_DISABLE=1`로 끌 수 있다.

```sh
GJC_HERDR_DISABLE=1 gjc -p "요청"
```

- `GJC_HERDR_DISABLE`이 정확히 `1`일 때만 꺼진다(`true`·` 1`·빈 값 등 다른 값은 기존과 같이 동작한다).
- 꺼지면 명령(`/herdr-send`·`/herdr-call`), 도구(`herdr_send`·`herdr_agent_call`·`herdr_mail_send`), 이벤트 훅, 타이머를 하나도 등록하지 않는다(우편 보내기 도구와 우편 받기도 함께 꺼진다).
- GJC 프로세스를 시작하기 전에 설정해야 하며, 이미 실행 중인 세션에는 적용되지 않는다.
- 하위 에이전트에 도구가 보이는 문제는 이 스위치로 다루지 않는다.

## 프롬프트 전달

`herdr-core`(`hc`) 터미널 안의 GJC에서 다른 `hc` 터미널로 프롬프트를 보낸다. 사전 조회(`hc get --json`)로 대상 상태를 확인한 뒤 `hc send --json`을 단 1회 호출해 **텍스트만 전달**하며, 화면 읽기(`hc read`/`attach`)나 별도 Enter 키 전송(`hc keys`), `--force`는 사용하지 않는다.

### 사용법

```text
/herdr-send t2 테스트를 실행하고 결과를 요약해 주세요.
/herdr-send --wait reviewer 이 변경을 검토해 주세요.
/herdr-send machine/t2 상태를 확인해 주세요.
```

- 형식: `/herdr-send [--wait] <terminal> <text>`. 대상 뒤 구분 공백 한 글자 다음의 내용은 따옴표·줄바꿈·`--`로 시작하는 단어까지 그대로 전달된다.
- 모델이 쓰는 도구 `herdr_send`도 같은 기능이다: `{ pane, text, wait? }` (`raw?` 인자도 호환상 받지만 효과는 없다).
- `--raw`: v0.7.0에서 `--raw`는 효과가 없다(명령·도구 모두 받아들이지만 일반 전달과 같은 `hc send` 경로를 실행하며, `--raw --wait`도 `--wait`와 같다).
- **호출자 조건과 self 거부:** 보내는 쪽 프로세스에 유효한 `hc` 터미널 주소 형식의 `HC_TERMINAL_ID`가 없으면 입력 0회 `not_sent`(`hc caller unknown`)로 거부한다. 자기 자신(주소 일치 또는 이름으로 해석된 주소 일치)으로의 전송도 입력 0회 `not_sent`로 거부한다.
- **대상 해석과 원격 주소:** 대상은 로컬 주소(`t2`), 원격 주소(`machine/t2`), 또는 `hc ls --json`에서 정확히 1건으로 해석되는 터미널 이름이다(연결 끊긴 호스트는 이름 검색 대상이 아니며, 0건·2건 이상은 입력 0회 `not_sent`). 원격 주소 허용은 텍스트 전달에 한하며, 원격 `machine/t1`은 로컬 호출자 `t1`과 구별된다.
- **사전 조회와 `idle`/`done` 규칙·비원자 한계:** 대상 해석과 self 검사 뒤 남은 예산(총 60초, 조회 최대 3초) 안에서 `hc get --json <주소>`를 1회 실행한다.
  - `state === "live" && reported === true`이고 `status.state === "idle"`이면 `hc send --json --if idle [--wait --timeout <초>]`로 1회 보낸다.
  - 같은 조건에서 `status.state === "done"`이면 `--if` 없이 `hc send --json [--wait --timeout <초>]`로 1회 보낸다. Core의 `hc send --if`가 `done`을 받지 않으므로 **원자적이지 않다**: 조회 뒤 대상이 작업을 시작했으면 글이 진행 중 턴에 들어갈 수 있다. `done` 대상 전송 결과(`sent`·`uncertain`) 글에는 이 안내를 짧게 덧붙인다(`idle` 경로와 `not_sent` 결과에는 붙이지 않는다).
  - 그 밖의 상태(`finished`·`reported !== true`·`working`·`blocked`·`error`·알 수 없는 상태)나 `hc get` 실패·예산 부족이면 `hc send` 0회 `not_sent`로 거부한다.
  - `idle`·`done`은 빈 입력란이나 사람 부재의 증거가 아니며 플러그인은 무인(unattended) 전제나 사람 draft 보호를 검증·보장하지 않는다.
- **`-`로 시작하는 글과 `/`로 시작하는 글:**
  - `-`로 시작하는 글은 CLI 옵션 오인을 막기 위해 전송 전 `not_sent`(`text starting with '-' unsupported on hc`)로 거부하며 `--`를 끼워 넣지 않는다.
  - `/`로 시작하는 글(미확인 한계): `-`로 시작하는 글만 거부하고 `/`로 시작하는 글은 별도 처리 없이 그대로 `hc send`로 보낸다. 받는 쪽에서 슬래시 명령으로 동작한다고 보장하지 않는다. `hc` 0.1.20에서 보고된 에이전트끼리 `hc send`로 보낸 `/` 시작 글이 감싸져 일반 글로 들어갔다는 다른 사용 환경의 관측이 있으며, 이 저장소에서는 확인하지 않았다(미실측). 슬래시 명령이 필요하면 이 경로에 기대지 않는다.
- **`--wait`의 뜻(`status: "sent"`와 완료 확인의 차이) 및 재전송 금지:**
  - `--wait` 없이 보내면 `hc send`가 턴 번호를 반환했을 때 `ok: true, status: "sent"`로 텍스트 전달만 확인하며 완료를 기다리지 않는다. `--wait`를 붙이면 남은 예산(총 60초) 안에서 `hc send --wait`로 턴 완료까지 기다리고, 전달(`status: "sent"`)과 대기 결과(`waited`)를 분리해 보고한다.
  - (1) **상위 `SendResult` 손상 또는 전송 단계 불확실 실패:** `hc send`가 종료 코드 `0`이라도 JSON이 아니거나 상위 `SendResult` 필드 타입(`turn` 음이 아닌 안전 정수, `started` 불리언/null/생략, `status` 문자열/null/생략)이 유효하지 않으면 전달 여부를 알 수 없는 `ok: false, status: "uncertain"`으로 분류한다(`unavailable`·`cancelled`·`needs_target`·미인식 오류 봉투·프로세스 timeout/abort도 같음). 반면 `hc send` 실패 중 입력 전 거부가 확인된 7종(`status_mismatch`, `blocked`, `finished`, `not_found`, `machine_unknown`, `invalid_params`, `config`)만 `status: "not_sent"`이다.
  - (2) **정상 제출 확인 뒤 중첩 `wait` 파싱 실패:** `hc send`가 종료 코드 `0`이고 상위 `SendResult` 필드 타입(`turn`·`started`·`status`)이 모두 유효하면 텍스트 제출이 확인된 `mode: "hc", status: "sent"`가 된다(`--wait` 없이 보냈을 때 중첩 `wait`가 없거나 유효하면 `ok: true, status: "sent"`이며 턴 완료 대기는 하지 않음). 이 상태에서 중첩 `wait` 객체 파싱만 실패한 경우(`!waitValid`)에는 텍스트는 이미 제출됐으므로 `status: "uncertain"`이 아니라 `ok: false, status: "sent"`로 보고한다.
  - (3) **`--wait` 시 `wait` 결과 부재(`null`/`undefined`)와 `started: false`:** `--wait`(및 `--raw --wait`)를 요청했는데 중첩 `wait` 결과가 없을 때만 `started === false`(`start was not observed; no wait result; completion unconfirmed`)와 일반 `wait` 누락을 별도 완료 미확인(`ok: false, status: "sent"`) 분기로 나눈다.
  - (4) **유효한 `WaitResult` 상관 판정:** 유효한 `WaitResult`가 있으면 상위 `started` 값과 무관하게 `waited: { reason, status, ended, turn }`을 담고 대상 터미널 일치(`terminal === addr`)·`ended`·`reason`·`status`·`turn` 상관으로 판정한다. 같은 대상에서 `ended === true && reason === "status" && (status === "idle" || status === "done") && turn >= send.turn + 1`일 때만 `ok: true, status: "sent"`이고, `terminal` 불일치·`reason`이 `timeout`/`message`/`not_started`/`exit`·`status`가 `blocked`/`error`·완료 응답에서 `turn < send.turn + 1`·그 밖의 미완료 상태는 모두 `ok: false, status: "sent"`이다. `status: "sent"`와 `status: "uncertain"`은 어떤 경우에도 **재전송하지 않는다**.

**주의: 셸 직접 전송은 플러그인 보호를 우회한다.** 셸(bash 도구 등)에서 `hc send`를 직접 부르면 플러그인의 사전 조회(`hc get`의 `live`·`reported`·`idle`/`done` 확인), 자기 터미널 거부, `-` 시작 글 거부 같은 보호를 거치지 않아 작업 중이거나 `blocked` 상태인 대상에 그대로 들어갈 수 있다. GJC가 다른 터미널에 보낼 때는 플러그인 명령·도구만 쓰고, 이 규칙을 팀 규칙 파일(`AGENTS.md` 등)에도 적는다. 사람이나 스크립트가 CLI를 직접 써야 하면 전송 전에 대상 상태를 직접 확인한다. 이 저장소의 `scripts/critic-send.sh`가 확인 후 보내는 예시다.

## 다른 에이전트 호출 (`/herdr-call`)

같은 로컬 호스트의 다른 `hc` 터미널 에이전트에게 프롬프트를 보내고, 대상 에이전트가 작성한 **결과 파일**에서 답변 본문을 회수한다. 화면 읽기(`hc read`/`attach`)나 원격 키 입력(`hc keys`), `--force`, 재시도는 사용하지 않는다.

```text
/herdr-call --result-file /abs/path/to/answer.md t2 이 변경을 검토하고 문제점을 알려줘.
```

- 형식: `/herdr-call --result-file <abs-path> <terminal> <text>`. 대상 뒤 구분 공백 한 글자 다음 내용은 그대로 전달된다. 모델이 쓰는 도구 `herdr_agent_call`도 같은 기능이다: `{ target, text, result_file }`. 명령 형식의 `--result-file` 값은 공백으로 구분하므로 공백이 들어간 경로는 도구 인자 `result_file`을 쓴다(결과 파일 없이 실행하면 실행 시점에 `invalid_request`로 거부된다).
- **호출자 조건·self 거부·로컬 터미널 전용:** 유효한 터미널 주소 형식의 `HC_TERMINAL_ID`가 없으면 입력 0회 `not_sent`(`invalid_request`, `hc caller unknown`)로 거부하고, 자기 자신(주소 또는 이름 해석 결과) 호출도 입력 0회 `not_sent`(`self_target`)로 거부한다. 같은 로컬 파일시스템에서 결과 파일을 직접 열어 검증·회수해야 하므로 원격 대상(`machine/t2` 또는 원격 주소로 해석되는 이름)은 입력 0회 `not_sent`(`invalid_request`, `remote result file recovery unsupported`)로 거부한다.
- **결과 파일 규칙(필수):**
  - 화면 읽기를 전혀 하지 않으므로 `--result-file <절대 경로>`(도구 `result_file`)가 **필수**다. 비어 있지 않은 **절대 경로**(앞뒤 공백·NUL·CR·LF 없음)만 허용하며, **호출마다 새 경로**를 써야 한다.
  - 최초 요청 검증 시점과 사전 조회 뒤 실제 `hc send` 직전 재검사 시점에 해당 경로에 무엇이든(일반 파일·심볼릭 링크·디렉터리 등) 이미 있으면 입력 0회 `not_sent`(`invalid_request`, `result file check failed: already exists`)로 거부한다.
  - 프롬프트 뒤에 지정 경로로 새 파일을 작성하라는 지시문을 붙여 1회 전송한다(대상 에이전트가 그 경로에 쓸 수 있어야 한다. 예: sandbox 안의 agy는 저장소 내부 경로만 가능).
  - 정상 settle 뒤 `open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)`으로 열어 **같은 파일 handle**에서 판정·읽기·닫기(`finally`)를 수행한다. 회수 **판정 순서**는 (1) handle 열기(`ENOENT`면 `result_file_missing`, 심볼릭 링크 `ELOOP` 등 열기 실패면 `result_file_invalid`) → (2) 같은 handle의 `stat()` 검사(일반 파일 `isFile()` 아님, 하드 링크 `nlink !== 1`, 원본 바이트 크기 `0 < size <= 1 MiB` 범위 밖이면 `result_file_invalid`) → (3) 같은 handle에서 최대 `1 MiB + 1`바이트까지 읽기(읽은 바이트가 `0` 이하이거나 `1 MiB`를 넘으면 `result_file_invalid`) → (4) `TextDecoder("utf-8", { fatal: true })` 엄격한 UTF-8 디코딩(잘못된 UTF-8이면 `result_file_invalid`)이다.
  - 모두 통과하면 디코딩된 문자열을 `answer`로 하여 `answered`(`resultFile` 포함, `markerVerified: false`, 화면 `capture` 없음)를 반환한다. 한계: 대상 에이전트가 읽을 수 있는 다른 파일의 내용을 복사하는 것까지는 막지 못하며, `O_NOFOLLOW`는 경로의 마지막 요소만 보호하므로 신뢰된 전용 폴더(예: 저장소 `.local/`)를 쓰도록 권한다.
- **동시 호출 제한과 사전 조회(`idle`/`done` 규칙·비원자 한계):**
  - 같은 대상(정규 주소 기준)에 대한 동시 호출은 이 플러그인 인스턴스 안에서 1개만 허용하고 나머지는 입력 0회 `not_sent`(`target_busy`)로 거부한다.
  - 사전 `hc get --json`에서 `state === "live" && reported === true`일 때만 전송한다. `status.state === "idle"`이면 `hc send --json --if idle --wait --timeout <초>`로 1회, `status.state === "done"`이면 `--if` 없이 `hc send --json --wait --timeout <초>`로 1회 보낸다. `done` 경로는 **원자적이지 않으며**(조회 뒤 대상이 작업을 시작했으면 진행 중 턴에 들어갈 수 있음), 전송 결과(`delivery !== "not_sent"`) 글에 이 안내를 덧붙인다(`idle` 경로와 `not_sent` 결과에는 붙이지 않는다).
  - 그 밖의 상태는 모두 입력 0회 `status: "not_sent"`, `delivery: "not_sent"`로 거부한다(`state === "finished"` → `terminal_finished`, `reported !== true` → `not_reported`, `status.state === "working"` → `agent_busy`, `status.state === "blocked"` → `agent_blocked`, `error` 포함 그 밖의 상태 → `agent_state_unknown`). 무인(unattended) 전제는 검증하지 않는다.
- **`-`와 `/`로 시작하는 글:** `-`로 시작하는 글은 전송 전 `not_sent`(`invalid_request`, `text starting with '-' unsupported on hc`)로 거부한다. `/`로 시작하는 글은 그 뒤에 결과 파일 지시문을 붙여 별도 처리 없이 그대로 `hc send`로 보내며, 받는 쪽에서 슬래시 명령으로 동작한다고 보장하지 않는다(미실측 한계, 위 "프롬프트 전달" 절 참조).
- **예산(총 60초·파일 회수 여유 5초)과 비대칭 취소:** 총 호출 예산은 60초 고정이며, 파일 회수 여유(5초)를 뺀 대기 예산 안에서 `hc send --wait`를 1회 실행한다. 로컬 대기 중단·timeout은 이쪽 기다림만 끝내며, 대상 에이전트는 계속 실행되고 플러그인은 중단·승인·재시도 키 입력을 **0회** 보낸다.
- **제출 확인(`delivery: "submitted"`)과 완료·답변 회수(`status: "answered"`)의 차이 및 재전송 금지:**
  - **후속 `hc wait` 조건:** 반환된 `WaitResult`가 같은 대상(`terminal === addr` 및 단조 `turn`)이고 `ended === false`, `reason === "timeout"` 또는 `"message"`, `status === null` 또는 `"working"`이며 대기 예산이 남아 있을 때만 **재전송 없이** `hc wait --json <주소> --timeout <초>`로 완료 대기를 이어간다(대상·`turn` 확인과 `not_started`·`exit`·`blocked`·`error`의 개별 처리를 거친 나머지 `ended === false` 응답에서 `reason`이 `timeout`/`message`가 아니거나 `status`가 `null`/`working`이 아니면 재대기하지 않고 `status: "uncertain", delivery: "submitted", error.code: "protocol"`로 종료한다).
  - (1) **상위 `SendResult` 손상 또는 전송 단계 불확실 실패:** `hc send` 단계에서 입력 전 거부가 확인된 7종만 `status: "not_sent", delivery: "not_sent"`이고, `unavailable`·`cancelled`·`needs_target`·미인식 오류·프로세스 timeout/abort와, 종료 코드 `0`이라도 상위 `SendResult` 필드 타입(`turn` 음이 아닌 안전 정수, `started` 불리언/null/생략, `status` 문자열/null/생략)이 손상된 경우는 모두 `status: "uncertain", delivery: "unknown"`(`error.code: "protocol_error"` 등)이다.
  - (2) **정상 제출 확인 뒤 중첩 `wait` 손상:** `hc send`가 종료 코드 `0`이고 상위 `SendResult` 필드 타입이 모두 유효하면 `delivery: "submitted"`가 확정된다. 이 상태에서 `send.turn < preflight.turn`이거나 중첩 `wait` 파싱이 실패한 경우(`!waitValid`, 또는 후속 `hc wait`의 `WaitResult` 파싱 실패)에는 `delivery: "unknown"`이 아니라 `status: "uncertain", delivery: "submitted", error.code: "protocol"`로 보고한다.
  - (3) **`wait` 결과 부재(`null`/`undefined`)와 `started: false`:** 유효한 제출 뒤 중첩 `wait`가 없을 때(`null`/`undefined`)만 `started === false`를 별도 분기(`status: "stalled", delivery: "submitted", error.code: "stalled"`)로 처리하고, 그 밖의 `wait` 누락은 `status: "uncertain", delivery: "submitted", error.code: "protocol"`로 처리한다.
  - (4) **유효한 `WaitResult` 상관 판정:** 유효한 `WaitResult`가 있으면 상위 `started` 값과 무관하게 대상 일치·`ended`·`reason`·`status`·`turn` 상관으로 판정한다(모두 `delivery: "submitted"`): `reason === "not_started"` → `status: "stalled", error.code: "stalled"`; `reason === "exit"`(`ended === true`) → `status: "response_unverified", error.code: "terminal_finished"`(`ended !== true`이면 `status: "uncertain", error.code: "protocol"`); 제출 뒤 `status === "blocked"` → `status: "response_unverified", error.code: "agent_blocked"`; 제출 뒤 `status === "error"` → `status: "response_unverified", error.code: "agent_error"`; 완료 응답(`ended === true`)에서 `terminal` 불일치·`reason !== "status"`·`status`가 `idle`/`done` 아님·`turn < send.turn + 1`(`turn` 미진행) → `status: "uncertain", error.code: "protocol"`; 대기 예산 소진 → `status: "uncertain", error.code: "timeout"`. 정상 settle(`ended === true && reason === "status" && (status === "idle" || status === "done") && turn >= send.turn + 1`) 뒤 결과 파일 검증이 통과하면 `ok: true, status: "answered", delivery: "submitted"`를 반환하고, 결과 파일 미생성(`result_file_missing`)·무효(`result_file_invalid`)는 `status: "response_unverified"`, 파일 I/O 시간 초과는 `status: "uncertain", error.code: "timeout"`, 파일 읽기 abort는 `status: "read_failed", error.code: "aborted"`를 반환한다. `delivery: "submitted"`와 `delivery: "unknown"`은 어떤 경우에도 **재전송하지 않는다**.

## 파일 우편함 보내기·받기

`herdr_mail_send` 도구(`{ to, subject, body, reply_to? }`)는 `<git 최상위>/.gjc-herdr/mailbox/<to>/<id>.md`에 우편 파일을 배타적 하드 링크(`link`)로 공개하고 `{ ok, id, path, warnings? }`를 반환한다(다른 pane 입력이나 토스트는 없음). 대화형 주 세션(`hasUI && kind === "main" && taskDepth === 0`)에서만 사용할 수 있으며, `gjc -p`·독립 비대화형 SDK 세션·하위 에이전트 세션에서는 물려받은 `GJC_HERDR_MAILBOX`로 `from`이 잘못 찍히는 것을 막기 위해 `non_interactive_session`으로 거절된다(기존 대화형 세션에 SDK로 요청을 보내는 경우는 그 대화형 세션이 기준이라 거절되지 않으며, 팀장 스크립트 `scripts/mail-send.sh`는 GJC 도구가 아니라 `--from`으로 발신 이름을 받으므로 해당 없음).

- 발신자 이름(`from`)과 수신 우편함 이름은 환경변수 `GJC_HERDR_MAILBOX`(`^[a-z][a-z0-9-]{0,31}$`)에서 읽는다. `GJC_HERDR_MAILBOX`가 설정되지 않으면 우편 받기는 비활성 상태(리스너·감시자·타이머 미등록)로 남고, 형식에 어긋나면 에러 안내를 1회 남긴 뒤 우편 받기를 비활성화한다.
- 플러그인은 `.gitignore`를 수정하지 않는다. 사용하는 저장소의 `.gitignore`에 `/.gjc-herdr/`를 직접 추가해야 하며, 우편함 경로가 Git에서 무시되지 않거나 추적 파일이 있으면 보내기·받기를 거절한다.
- **GJC 우편 받기**: `GJC_HERDR_MAILBOX`가 유효한 주 세션(`kind === "main" && taskDepth === 0`)이 시작되면 `<우편함>/.consumer.lock`을 배타 생성해 단독 소비자로 동작하고(`session_shutdown` 때 정리, 이미 잠금이 있으면 자동 삭제하지 않고 `pid`·프로세스 상태와 수동 조치 안내를 표시), 이전 비정상 종료로 `<id>.attempt`만 남은 항목은 시작 시 `uncertain`(`crash_recovery`) ack로 정리한다. 남은 잠금은 이전 GJC가 끝났는지 확인한 뒤 `.consumer.lock`만 지우고 다시 시작한다. 메시지·ack·attempt는 지우지 않는다. 받기는 UI가 있는 대화형 GJC에서만 동작한다. print(`gjc -p`)·SDK 같은 비대화형 세션에서는 꺼진다. 자식으로 띄우는 `gjc -p`에는 `env -u GJC_HERDR_MAILBOX`를 권한다. 변수를 물려받으면 보내는 이름(`from`)이 부모 것으로 찍힌다.
- 새 우편(`<id>.md`)은 세션이 유휴(`ctx.isIdle()`)일 때만 `<id>.attempt` 원장을 먼저 기록한 뒤 `api.sendMessage`(`customType: "herdr-mail"`, `deliverAs: "followUp"`, `triggerTurn: true`)로 주입한다. 주입 본문은 고정 헤더·비권한 데이터 경고·최대 8 KiB(UTF-8 코드포인트 경계) 미리보기와 원본 상대 경로(`전문: .gjc-herdr/mailbox/<to>/<id>.md`)로 구성된다.
- 주입된 커스텀 메시지 반영(1단계)과 그 뒤 정상 어시스턴트 응답 완료(2단계)가 같은 세션 세대에서 관측되면 `<id>.ack`(`state: received`, `via: observed`)를 배타 생성하고, 문법·크기 위반 우편은 `rejected`, 미관측 종료 2회·세션 전환 등은 `uncertain` ack로 기록한다. `received`는 읽음·이해·업무 완료의 증거가 아니다.
- **팀장 우편 스크립트(Claude Code 등)**:
  - `scripts/mail-watch.sh <받는이> [--timeout <초>]`: 읽기 전용으로 `<루트>/<받는이>/<ULID>.md`를 살핀다(기본 `--timeout 1800`, `--timeout 0`은 1회만 확인, 첫 경계 검사 성공 직후 stderr에 `mail-watch: root=<우편함 루트> recipient=<이름> timeout=<초>`를 1회 표시). 대기(pending) 우편이 있으면 절대 경로를 ULID 오름차순으로 줄마다 출력하고 종료 코드 `0`, 시간 한도에 닿으면 빈 출력과 종료 코드 `2`, 경계·링크·비정상 ack·읽기 오류는 stderr 진단과 종료 코드 `1`로 끝난다.
  - `scripts/mail-ack.sh <받는이> <id> received|rejected [사유]`: 원본을 검증한 뒤 `via: manual`로 `<id>.ack`를 기록한다(`received`는 사유 금지·원본 유효성 및 `body_sha256` 검증, `rejected`는 1–200바이트 사유 필수, 기존 `uncertain`은 `rename`으로 교체). 성공 시 ack 경로를 출력하고 종료 코드 `0`, 거절·오류는 종료 코드 `1`이다. `mail-ack.sh`는 한 번에 하나씩(단일 팀장 세션, 직렬 호출) 실행한다. 동시에 같은 id로 실행하면 나중 결과가 앞 결과를 덮어쓸 수 있다(`uncertain` 교체 구간).
  - `scripts/mail-send.sh <받는이> --subject <제목> [--from <이름>] [--reply-to <ULID>] [--body-file <경로> | -]`: 발신 이름(`--from` 우선, 없으면 `GJC_HERDR_MAILBOX`)과 본문(`--body-file`, stdin `-`, 생략 시 빈 본문)을 검증한 뒤 `<루트>/<받는이>/<id>.md`에 배타적으로 공개한다. 성공 시 메시지 절대 경로를 출력하고 종료 코드 `0`, 인자·경계·형식·공개 오류는 stderr 진단(`mail-send error [<코드>]: <사유>`)과 종료 코드 `1`이다. 제목이 `-`이거나 옵션 이름과 같으면 `--subject=<제목>`으로 붙여 쓴다.

## 제거

플러그인이 로드된 GJC를 정상 종료한 뒤 제거하고 새 GJC로 확인한다.

```sh
gjc plugin uninstall gjc-herdr
gjc
```

실행 중 disable/uninstall의 즉시 callback은 보장하지 않는다. 정상 종료·재시작이 적용 경계다.

## 검증 범위

| 항목 | 확인 결과 |
|---|---|
| v0.7.0 (Core/`hc` 전용, #100·#101) | 단위 시험(모의) 기준(`herdr server` 경로 제거, `HC_TERMINAL_ID` 조건 등록, 보내기·호출 `done` 대상 허용). 설치 판 GJC에서의 로드와 Core(`hc`) 안 실제 호출은 release 전 확인 예정 |
| **v0.6.x 이전(`herdr server`) 기준** | 아래 행들은 `herdr server` 경로가 포함돼 있던 옛 판 기준 실측·검증 기록이다 |
| 환경 | macOS arm64, Herdr 0.9.3. Git 설치는 GJC 0.18.7(격리 HOME과 실제 사용자 환경)에서 검증. 이전 MVP 검증은 GJC 0.18.6 격리 환경 |
| Git 설치 (v0.1.2·v0.1.3) | 격리 HOME과 실제 사용자 환경 모두: 당시 tag(`#v0.1.2`, 사용자 환경은 `#v0.1.3`까지)의 한 줄 명령으로 설치·실제 로드·token 발행·`/rename` 갱신·정상 종료 clear·제거 후 native-only 실행(plugin token 없음)·재설치 확인. 두 환경 모두 설치된 `dist/extension.js`가 commit된 파일과 동일(sha256) |
| metadata | 모델 변경, `/rename` 갱신, native·다른 source의 키 보존, 오래된 seq 거부 확인 |
| 실제 sidebar | 사용자 설정에서 native 행을 보존하고 두 custom 행 추가. 사용자 제공 화면으로 최종 표시 확인 |
| provider | 기존 provider 경로 두 개 각각 인증·실제 추론 1회 성공 |
| 프롬프트 전달 (0.2.0) | GJC 0.18.7·Herdr 0.9.3, 격리 plugin registry에 설치한 로컬 build로 두 pane 실제 확인: `/herdr-send`(수락)·`--wait`+agent 이름(완료)·모델의 `herdr_send` 도구 호출·`--raw` 각각 받는 쪽 실제 응답, GJC가 종료된 shell pane 대상은 무전송 오류, 세 token 발행·정상 종료 clear. 작업 중 대상의 추가 프롬프트 처리와 다른 cwd에서의 session ID 지정 전달은 공식 CLI로 확인. 실제 사용자 환경의 `#v0.2.0` Git 설치본(같은 dist sha256)으로는 로드·session ID token·자기 전송 거절·입력 오류 처리·정상 종료 clear까지 확인했고, 두 pane 실제 전달은 다시 하지 않음 |
| 최신 설치·업데이트 | 격리 registry에서 tag 없는 명령이 `main`(= `v0.2.0` commit)을 설치함을 확인. 이전 commit에 고정된 설치는 같은 명령 재실행·`--force`로 바뀌지 않고, 제거 후 설치하면 최신으로 바뀜을 확인(다른 plugin 유지) |
| marketplace 설치 (미지원) | GJC 0.18.7에서 실험됨: `.claude-plugin/marketplace.json` catalog로 `marketplace add`·`discover`·`install`·`uninstall`은 동작하지만, marketplace 설치는 `plugins/cache/plugins/…` 복사본으로만 존재하고 session의 extension loader는 `plugins/package.json` + `plugins/node_modules`만 읽어서 `gjc.extensions`가 로드되지 않음(같은 격리 root에서 git 설치 대조군은 token 발행). catalog는 되돌림(22d8076). 근거 `.local/verification/marketplace-20261006/`
| 감지 agent 호출 (0.3.0) | GJC 0.18.7·Herdr 0.9.3, 로컬 build로 실제 감지 Claude Code(v2.1.292) 대상 실증: 도구·명령 두 경로 모두 표식 답변 본문 회수(`answered`), reported-only·미존재 대상 `not_sent`(입력 0회), 사전 `blocked` 무전송, 장문 과제 `timeout`→원격 계속 실행, 파일 fallback 실측 — 문서화된 **호출자 2단 절차**(제품 코드 아님): 경로만 답변받아 회수한 뒤 호출자가 파일을 구간별로 읽어 1–170행 누락 없이 확인. stalled·전송 후 blocked는 실측 미재현(단위 매핑만). 감지 제품 1종(Claude Code) 실측. 근거 `.local/`(비공개) |
| Core(`hc`) 스크립트·플러그인 `hc` 백엔드 | 모의(stub) 단위·경계 테스트로 Core 팀 운영 스크립트(`core-team.sh`, `core-mate-watch.sh`, `core-dialog-check.py`, `core-critic-send.sh`)와 플러그인 `hc` 백엔드(`src/hc.ts`, `send.ts`, `call.ts`, `extension.ts`) 검증. 로컬 `hc` 1회 정상 경로에서 팀원 기동(`--up` 직후 준비 미확인 rc `2` → 후속 `--check` `ok`)·`check-env` Core 분기·`dialog --once`·`agy` 1회 과제 완료(과제 뒤 `done`)·`done` 상태 대상 다음 배정(**로컬 1회 관찰**(2026-11-12): 응답 `started=true`·다음 `turn`, 새 과제 완료)·탑주 기동 팀장 잠금 인계(**로컬 1회 관찰**(2026-11-12): 옛 팀장 `release` 뒤 탑주 `hc run` 기동, 새 팀장의 SessionStart 잠금 보유 안내(팀장 보고)와 그 뒤 `mine`·팀원 기동·`--check` rc `0` 확인. hook `claim` 순간의 별도 로그는 없음)·`Codex` 교체 기동 후 검토 회수·`--down` 정리를 관측. **실제 `hc` 터미널 안 GJC 실사용(플러그인 로드·`/herdr-send`·`/herdr-call` 라이브 실행), 실제 `blocked` 발생, 재부팅 뒤 수명, 원격 호스트 동거 운용은 미검증(미실측)** |
| 개발 검증 | typecheck·Bun 1.4.3 고정 build·단위 테스트(Herdr 및 Core/`hc` 모의 테스트 포함) |

화면 검증은 최종 screenshot 기준이며 모든 UI 전환의 자동 녹화가 아니다. Provider 검증은 위 경로 2개에 한정하며 모든 provider·OAuth 계정이나 다른 runtime 환경의 성공을 보장하지 않는다. Native reporter 대체·권한 위임, 플러그인 주도 fixed-file cold resume, cwd/context 통계, pane layout 제어는 제공하지 않는다. `이름@마켓플레이스` 형태의 marketplace 설치도 지원하지 않는다(위 표 참고).

## 개발

> Herdr + 팀장(Claude Code) + 팀원(agy) 개발 환경과 새 컴퓨터에서의 AI 자동 구축 절차는 [docs/dev-environment.md](docs/dev-environment.md), 환경 점검은 `scripts/check-env.sh`.

```sh
git clone https://github.com/mrsono0/gjc-herdr.git
cd gjc-herdr
npm ci --ignore-scripts --no-audit --no-fund
bun scripts/build.ts   # dist/extension.js 재생성 (source 변경 시 반드시 commit)
npm run check
npm test               # mock 기반 단위 테스트; 실제 Herdr/hc E2E가 아님
```

Core(`hc`) 관련 모의 테스트는 `test/hc.test.ts`(플러그인 `hc` 어댑터·백엔드 선택), `test/core-team.test.ts`, `test/core-mate-watch.test.ts`, `test/core-dialog-check.test.ts`, `test/core-critic-send.test.ts` 및 `test/send.test.ts`·`test/call.test.ts`·`test/metadata.test.ts`의 `hc` 경계 테스트에 있다.

`dist/extension.js`는 Git에서 설치될 때 그대로 사용되므로 source와 함께 commit한다. Bun은 의존성 설치 시 build script를 실행하지 않는다. 번들 바이트는 Bun 버전에 따라 달라지므로 build는 `package.json`의 `engines.bun`(1.4.3)으로 고정되며, 다른 버전이면 `scripts/build.ts`가 중단한다. `npm run build`/`bun run build`는 상위 디렉터리의 `node_modules/.bin/bun`을 먼저 잡을 수 있으므로 `bun scripts/build.ts`로 직접 실행한다. tag 없는 설치가 `main`을 가져오므로 `main`에는 source·`dist`·version이 일치하는 release commit만 push하고, 미완성 작업은 별도 branch에서 한다. 각 release는 `package.json` version과 같은 tag(예: `v0.2.0`)도 함께 push한다. 라이선스는 MIT(`LICENSE`)다. 로컬 검증 기록·screenshot·workflow 원장·credentials·환경 의존 통합 검증 도구는 공개하지 않는다.
