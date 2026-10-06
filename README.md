# gjc-herdr

GJC의 native 상태·세션/resume 처리를 유지하면서 Herdr sidebar에 **모델 ID와 세션 이름**을 표시하고, 한 Herdr pane의 GJC에서 **다른 pane의 GJC로 프롬프트를 전달**하는 설치형 플러그인이다. GJC·Herdr 본체를 수정하지 않으며 별도 launcher나 서비스를 설치하지 않는다.

배포 정책: **npm registry에는 발행하지 않는다.** 이 Git 저장소에서 직접 설치한다. 실행 파일 `dist/extension.js`는 저장소에 포함되어 있어 설치 시 build가 필요 없다.

## 설치 (한 줄)

```sh
gjc plugin install "gjc-herdr@git+https://github.com/mrsono0/gjc-herdr.git"
```

- tag 없이 설치하면 `main`의 최신 release가 설치된다. `main`에는 build된 `dist/extension.js`가 포함된 release 상태만 push한다.
- `gjc-herdr@` 접두사를 그대로 쓴다. 접두사 없이 URL만 주면 GJC는 다른 설치 형식(bundle)으로 분류해 실패한다.
- `--user`·`--scope`·`--project`를 붙이지 않는다.
- 설치는 실행한 사용자의 `~/.gjc/plugins/` registry만 변경한다. Bun이 Git에서 가져오며 npm registry를 사용하지 않는다.
- 특정 버전으로 고정하려면 tag를 붙인다: `gjc plugin install "gjc-herdr@git+https://github.com/mrsono0/gjc-herdr.git#v0.2.0"`.

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
   herdr --version    # 0.9.3에서 검증
   bun --version      # GJC plugin 설치에 필요
   git --version
   echo "$HERDR_ENV $HERDR_PANE_ID"   # Herdr pane 안에서 실행 중인지 (1 과 pane id가 보여야 표시 대상)
   ```
   Herdr 밖에서 실행한 GJC에는 아무것도 표시되지 않는다(정상).
2. **기존 설치 확인**: `gjc plugin list --json`의 `npm` 배열에 `gjc-herdr`가 있으면 `~/.gjc/plugins/package.json`의 `dependencies["gjc-herdr"]`와 설치된 version을 확인한다. 최신 release가 이미 설치되어 있으면 설치 단계를 건너뛴다. 이전 버전이거나 다른 source(tag 고정·로컬 tarball 등)면 `gjc plugin uninstall gjc-herdr` 후 위 한 줄로 설치한다.
3. **설치**: 위 한 줄 명령. 성공 판정은 `gjc plugin list --json`에 `gjc-herdr`가 `enabled: true`이고 version이 저장소 `main`의 `package.json` version과 같으며, `~/.gjc/plugins/node_modules/gjc-herdr/dist/extension.js`가 존재하는 것이다.
4. **Sidebar 설정**: 아래 "Sidebar 설정" 절대로 `~/.config/herdr/config.toml`에 두 행만 추가한다. 기존 행은 지우지 않는다. 파일이 없거나 `[ui.sidebar.agents]`가 없으면 그 섹션만 새로 만든다.
5. **표시 확인** (설치됨 ≠ 로드됨 ≠ 표시됨):
   - 플러그인이 로드되기 전 실행 중이던 GJC는 종료 후 **새로 시작**한다.
   - Herdr pane 안에서 `gjc`를 새로 시작한 뒤 다른 터미널에서 `herdr pane get <pane-id>`를 실행해 `tokens.gjc_herdr_model`이 보이면 로드·발행 성공이다. `/rename 이름` 후 최대 20초 안에 `tokens.gjc_herdr_session`이 갱신된다.
   - sidebar에 모델 행·세션 이름 행이 보이면 표시 성공이다. 세션 이름은 sidebar 폭에 따라 잘려 보일 수 있다.
6. **보고**: 설치·설정·표시 각각을 실제 출력으로 구분해 보고한다. 확인하지 못한 항목을 성공으로 적지 않는다.

금지: GJC/Herdr 본체·credentials·다른 플러그인·사용자 모델 설정 변경, `plugin link`로 대체, 설치 실패를 build/소스 수정으로 우회.

## Sidebar 설정

기본 sidebar는 custom token을 자동 표시하지 않는다. `~/.config/herdr/config.toml`의 `[ui.sidebar.agents]`에 `$gjc_herdr_model`·`$gjc_herdr_session` 행을 추가한다. 플러그인은 이 파일을 건드리지 않는다. 아래는 실제 검증한 설정 형태다(앞의 두 행은 예시이며 기존 행을 그대로 두고 마지막 두 행만 추가한다).

```toml
[ui.sidebar.agents]
rows = [
  ["state_icon", "machine", "workspace", "tab"],
  ["agent"],
  ["$gjc_herdr_model"],
  ["$gjc_herdr_session"],
]
```

## 동작

- `gjc_herdr_model`: 현재 공개 context의 `provider/model-id`.
- `gjc_herdr_session`: 현재 세션 이름. GJC의 `/rename <이름>`으로 변경한다.
- 수락된 값은 `herdr pane get <pane-id>`의 `tokens`에서 확인한다.
- Startup·session switch·agent 시작/종료 및 20초 주기로 갱신하며 TTL은 60초다.
- 값이 없으면 자기 키를 제거한다. 표시 값은 제어 문자를 정리하고 80 Unicode 문자로 제한한다.
- 공개 SDK pane admission과 main/depth-0 조건을 적용한다. Sub/nested·무Herdr·invalid pane에는 발행하지 않는다.
- `gjc_herdr_session_id`: 현재 GJC session ID. 프롬프트 전달 대상 식별용이며 정규화·길이 제한 없이 그대로 발행한다(sidebar 행 추가 불필요).
- 독립 source·증가 seq·전용 키를 사용하며 native lifecycle report/release를 호출하지 않는다. 정상 종료는 자기 세 키만 clear하고, crash/SIGKILL의 즉시 정리는 보장하지 않는다.

## 프롬프트 전달

이 플러그인이 로드된 GJC(보내는 쪽)에서 다른 Herdr pane의 GJC(받는 쪽)로 프롬프트를 보낸다. 전달은 GJC 공식 `gjc sdk session send`를 사용하므로 받는 쪽 입력창을 건드리지 않고, 받는 쪽이 작업 중이면 GJC가 진행 중인 turn에 이어 처리한다.

```text
/herdr-send wC:p2 테스트를 실행하고 결과를 요약해 주세요.
/herdr-send --wait reviewer 이 변경을 검토해 주세요.
/herdr-send --raw wC:p3 ls
```

- 형식: `/herdr-send [--wait|--raw] <pane-id 또는 Herdr agent 이름> <text>`. 대상 뒤 구분 공백 한 글자 다음의 내용은 따옴표·줄바꿈·`--`로 시작하는 단어까지 그대로 전달된다.
- 모델이 쓰는 도구 `herdr_send`도 같은 기능이다: `{ pane, text, wait?, raw? }`.
- 기본: 받는 쪽이 프롬프트를 **수락**하면 operationRef와 함께 성공을 표시한다. 수락은 완료가 아니다.
- `--wait`: 받는 쪽 turn이 끝날 때까지(최대 30초) 기다려 완료/실패를 표시한다. 시간이 넘으면 "이미 수락됐을 수 있음"으로 보고하며 다시 보내지 않는다.
- `--raw`: SDK 대신 Herdr `pane send-text` + `send-keys enter`로 그 pane에 직접 입력한다. GJC가 아닌 pane(shell 등)에도 입력되며, 입력 중인 내용이 있으면 섞일 수 있다. 완료 신호가 없고 `--wait`와 함께 쓸 수 없다.
- 대상 식별: 받는 쪽 pane의 `gjc_herdr_session_id` token을 먼저 사용한다. token이 없으면(이 플러그인이 없는 GJC 등) 그 pane의 foreground PID를 보내는 쪽 저장소 범위의 `gjc sdk session list`와 맞춰 본다. agent 이름은 `herdr agent get <name>`의 pane으로 바꾼다.
- 자기 자신(같은 session, raw는 같은 pane)으로는 보내지 않는다. 대상이 GJC가 아니거나 찾지 못하면 아무것도 보내지 않고 오류를 표시한다.

전제와 한계:

- `gjc`가 보내는 쪽 GJC 프로세스의 `PATH`에 있어야 한다. 없으면 `gjc CLI not found on PATH`.
- 같은 컴퓨터·같은 사용자·같은 Herdr server만 대상이다. token이 없는 받는 쪽은 보내는 쪽과 같은 저장소에서 실행 중일 때만 찾는다(전역 검색 없음).
- 재시도·중복 방지·승인 대기(blocked) 감지·여러 대상 동시 전달은 없다. 오류·timeout 후 자동 재전송이나 raw 전환을 하지 않는다.
- Herdr의 `herdr agent prompt`는 사용하지 않는다. Herdr 0.9.3은 알려진 agent 종류만 받으며 `gjc`는 해당되지 않는다([herdrdev/herdr#4732](https://github.com/herdrdev/herdr/issues/4732)).

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
| 환경 | macOS arm64, Herdr 0.9.3. Git 설치는 GJC 0.18.7(격리 HOME과 실제 사용자 환경)에서 검증. 이전 MVP 검증은 GJC 0.18.6 격리 환경 |
| Git 설치 (v0.1.2·v0.1.3) | 격리 HOME과 실제 사용자 환경 모두: 당시 tag(`#v0.1.2`, 사용자 환경은 `#v0.1.3`까지)의 한 줄 명령으로 설치·실제 로드·token 발행·`/rename` 갱신·정상 종료 clear·제거 후 native-only 실행(plugin token 없음)·재설치 확인. 두 환경 모두 설치된 `dist/extension.js`가 commit된 파일과 동일(sha256) |
| metadata | 모델 변경, `/rename` 갱신, native·다른 source의 키 보존, 오래된 seq 거부 확인 |
| 실제 sidebar | 사용자 설정에서 native 행을 보존하고 두 custom 행 추가. 사용자 제공 화면으로 최종 표시 확인 |
| provider | 기존 `cliproxyapi/glm-5.3`과 사용자 기본 모델 `cliproxyapi/gpt-6.1-sol` 각각 인증·실제 추론 1회 성공 |
| 프롬프트 전달 (0.2.0) | GJC 0.18.7·Herdr 0.9.3, 격리 plugin registry에 설치한 로컬 build로 두 pane 실제 확인: `/herdr-send`(수락)·`--wait`+agent 이름(완료)·모델의 `herdr_send` 도구 호출·`--raw` 각각 받는 쪽 실제 응답, GJC가 종료된 shell pane 대상은 무전송 오류, 세 token 발행·정상 종료 clear. 작업 중 대상의 추가 프롬프트 처리와 다른 cwd에서의 session ID 지정 전달은 공식 CLI로 확인. 실제 사용자 환경의 `#v0.2.0` Git 설치본(같은 dist sha256)으로는 로드·session ID token·자기 전송 거절·입력 오류 처리·정상 종료 clear까지 확인했고, 두 pane 실제 전달은 다시 하지 않음 |
| 최신 설치·업데이트 | 격리 registry에서 tag 없는 명령이 `main`(= `v0.2.0` commit)을 설치함을 확인. 이전 commit에 고정된 설치는 같은 명령 재실행·`--force`로 바뀌지 않고, 제거 후 설치하면 최신으로 바뀜을 확인(다른 plugin 유지) |
| marketplace 설치 (미지원) | GJC 0.18.7에서 실험됨: `.claude-plugin/marketplace.json` catalog로 `marketplace add`·`discover`·`install`·`uninstall`은 동작하지만, marketplace 설치는 `plugins/cache/plugins/…` 복사본으로만 존재하고 session의 extension loader는 `plugins/package.json` + `plugins/node_modules`만 읽어서 `gjc.extensions`가 로드되지 않음(같은 격리 root에서 git 설치 대조군은 token 발행). catalog는 되돌림(22d8076). 근거 `.local/verification/marketplace-20261006/`
| 개발 검증 | typecheck·Bun 1.4.2 고정 build·단위 테스트 15개(metadata 5, 전달 10) |

화면 검증은 최종 screenshot 기준이며 모든 UI 전환의 자동 녹화가 아니다. Provider 검증은 위 경로 2개에 한정하며 모든 provider·OAuth 계정이나 다른 runtime 환경의 성공을 보장하지 않는다. Native reporter 대체·권한 위임, 플러그인 주도 fixed-file cold resume, cwd/context 통계, pane layout 제어는 제공하지 않는다. `이름@마켓플레이스` 형태의 marketplace 설치도 지원하지 않는다(위 표 참고).

## 개발

```sh
git clone https://github.com/mrsono0/gjc-herdr.git
cd gjc-herdr
npm ci --ignore-scripts --no-audit --no-fund
bun scripts/build.ts   # dist/extension.js 재생성 (source 변경 시 반드시 commit)
npm run check
npm test               # mock 기반 단위 테스트; 실제 Herdr E2E가 아님
```

`dist/extension.js`는 Git에서 설치될 때 그대로 사용되므로 source와 함께 commit한다. Bun은 의존성 설치 시 build script를 실행하지 않는다. 번들 바이트는 Bun 버전에 따라 달라지므로 build는 `package.json`의 `engines.bun`(1.4.2)으로 고정되며, 다른 버전이면 `scripts/build.ts`가 중단한다. `npm run build`/`bun run build`는 상위 디렉터리의 `node_modules/.bin/bun`을 먼저 잡을 수 있으므로 `bun scripts/build.ts`로 직접 실행한다. tag 없는 설치가 `main`을 가져오므로 `main`에는 source·`dist`·version이 일치하는 release commit만 push하고, 미완성 작업은 별도 branch에서 한다. 각 release는 `package.json` version과 같은 tag(예: `v0.2.0`)도 함께 push한다. 라이선스는 MIT(`LICENSE`)다. 로컬 검증 기록·screenshot·workflow 원장·credentials·환경 의존 통합 검증 도구는 공개하지 않는다.
