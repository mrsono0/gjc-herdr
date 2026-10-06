# gjc-herdr

GJC의 native 상태·세션/resume 처리를 유지하면서 Herdr sidebar에 **모델 ID와 세션 이름**을 표시하는 설치형 플러그인이다. GJC·Herdr 본체를 수정하지 않으며 별도 launcher나 서비스를 설치하지 않는다.

배포 정책: **npm registry에는 발행하지 않는다.** 이 Git 저장소에서 직접 설치한다. 실행 파일 `dist/extension.js`는 저장소에 포함되어 있어 설치 시 build가 필요 없다.

## 설치 (한 줄)

```sh
gjc plugin install "gjc-herdr@git+https://github.com/mrsono0/gjc-herdr.git#v0.1.3"
```

- `gjc-herdr@` 접두사와 `#v0.1.3` tag를 그대로 쓴다. 접두사 없이 URL만 주면 GJC는 다른 설치 형식(bundle)으로 분류해 실패한다.
- `--user`·`--scope`·`--project`를 붙이지 않는다.
- 설치는 실행한 사용자의 `~/.gjc/plugins/` registry만 변경한다. Bun이 Git에서 가져오며 npm registry를 사용하지 않는다.
- `#main`은 개발용이다. 사용자 설치는 tag로 고정한다.

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
2. **기존 설치 확인**: `gjc plugin list --json`의 `npm` 배열에 `gjc-herdr`가 있으면 재설치하지 말고 `~/.gjc/plugins/package.json`의 `dependencies["gjc-herdr"]`를 확인한다. 이미 `git+https://github.com/mrsono0/gjc-herdr.git#v0.1.3`이면 설치 단계를 건너뛴다. 다른 source(로컬 tarball 등)면 `gjc plugin uninstall gjc-herdr` 후 위 한 줄로 설치한다.
3. **설치**: 위 한 줄 명령. 성공 판정은 `gjc plugin list --json`에 `gjc-herdr` 0.1.3 `enabled: true`, 그리고 `~/.gjc/plugins/node_modules/gjc-herdr/dist/extension.js`가 존재하는 것이다.
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
- 독립 source·증가 seq·전용 키를 사용하며 native lifecycle report/release를 호출하지 않는다. 정상 종료는 자기 키만 clear하고, crash/SIGKILL의 즉시 정리는 보장하지 않는다.

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
| Git 설치 | 격리 HOME과 실제 사용자 환경 모두: 위 한 줄 명령으로 설치·실제 로드·token 발행·`/rename` 갱신·정상 종료 clear·제거 후 native-only 실행(plugin token 없음)·재설치 확인. 두 환경 모두 설치된 `dist/extension.js`가 commit된 파일과 동일(sha256) |
| metadata | 모델 변경, `/rename` 갱신, native·다른 source의 키 보존, 오래된 seq 거부 확인 |
| 실제 sidebar | 사용자 설정에서 native 행을 보존하고 두 custom 행 추가. 사용자 제공 화면으로 최종 표시 확인 |
| provider | 기존 `cliproxyapi/glm-5.3`과 사용자 기본 모델 `cliproxyapi/gpt-6.1-sol` 각각 인증·실제 추론 1회 성공 |
| 개발 검증 | typecheck·Bun 1.4.2 고정 build(동일 입력에서 동일 sha256)·단위 테스트 5개 |

화면 검증은 최종 screenshot 기준이며 모든 UI 전환의 자동 녹화가 아니다. Provider 검증은 위 경로 2개에 한정하며 모든 provider·OAuth 계정이나 다른 runtime 환경의 성공을 보장하지 않는다. Native reporter 대체·권한 위임, 플러그인 주도 fixed-file cold resume, cwd/context 통계, pane layout 제어는 제공하지 않는다.

## 개발

```sh
git clone https://github.com/mrsono0/gjc-herdr.git
cd gjc-herdr
npm ci --ignore-scripts --no-audit --no-fund
bun scripts/build.ts   # dist/extension.js 재생성 (source 변경 시 반드시 commit)
npm run check
npm test               # mock 기반 단위 테스트; 실제 Herdr E2E가 아님
```

`dist/extension.js`는 Git에서 설치될 때 그대로 사용되므로 source와 함께 commit한다. Bun은 의존성 설치 시 build script를 실행하지 않는다. 번들 바이트는 Bun 버전에 따라 달라지므로 build는 `package.json`의 `engines.bun`(1.4.2)으로 고정되며, 다른 버전이면 `scripts/build.ts`가 중단한다. `npm run build`/`bun run build`는 상위 디렉터리의 `node_modules/.bin/bun`을 먼저 잡을 수 있으므로 `bun scripts/build.ts`로 직접 실행한다. 릴리스는 `package.json` version과 같은 tag(`v0.1.3`)로 고정한다. 라이선스는 MIT(`LICENSE`)다. 로컬 검증 기록·screenshot·workflow 원장·credentials·환경 의존 통합 검증 도구는 공개하지 않는다.
