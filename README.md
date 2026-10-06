# gjc-herdr

GJC의 native 상태·세션/resume 처리를 유지하면서 Herdr sidebar에 **모델 ID와 세션 이름**을 표시하는 설치형 플러그인이다. GJC·Herdr 본체를 수정하지 않으며 별도 launcher나 서비스를 설치하지 않는다.

## 검증 범위

| 항목 | 확인 결과 |
|---|---|
| 환경 | macOS arm64, GJC 0.18.6 격리 환경 및 0.18.7 사용자 환경, Herdr 0.9.3, 플러그인 0.1.0 |
| 설치·수명주기 | 실제 설치·로드·정상 종료 시 자기 metadata 정리·제거 후 native-only 실행·재설치·재로드 확인 |
| metadata | 모델 변경, `/rename` 갱신, native·다른 source의 키 보존, 오래된 seq 거부 확인 |
| 실제 sidebar | 사용자 설정에서 native 행을 보존하고 두 custom 행 추가. 사용자 제공 화면으로 최종 표시 확인 |
| provider | 기존 `cliproxyapi/glm-5.3`의 인증·실제 추론 1회 성공. 정확한 `GJC_HERDR_PROVIDER_OK` 응답과 exit 0 확인 |
| 개발 검증 | typecheck·build·단위 테스트 5개·패키징 및 실제 설치 E2E 완료 |

화면 검증은 최종 screenshot 기준이며 모든 UI 전환의 자동 녹화가 아니다. 세션 이름은 sidebar 폭에 따라 잘릴 수 있고, 전체 값은 pane header와 metadata에서 확인했다. Provider 검증은 위 경로 1개에 한정하며 모든 provider·OAuth 계정이나 다른 runtime 환경의 성공을 보장하지 않는다.

## 설치

Node/npm과 Bun이 필요하다. 아래 명령은 플러그인만 build하며 GJC 본체를 build하지 않는다.

```sh
git clone https://github.com/mrsono0/gjc-herdr.git
cd gjc-herdr
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run check
npm test
npm pack --ignore-scripts
```

다음 명령은 실행한 사용자의 GJC plugin registry를 변경한다. 검증용 격리 환경에서 먼저 확인한다.

```sh
gjc plugin install "gjc-herdr@file:$(pwd)/gjc-herdr-0.1.0.tgz"
gjc plugin list --json
gjc
```

디렉터리 `file:` 설치에서 Bun copy `ENOENT`를 관측했으므로 **이름을 명시한 native npm tarball 설치**를 사용한다. Plain local path는 별도 GJC bundle 경로로 분류되며 이 설치에 `--user`·`--scope`를 덧붙이지 않는다. `plugin link`만으로는 discovery 성공을 보장하지 않는다.

## Sidebar 설정과 동작

기본 sidebar는 custom token을 자동 표시하지 않는다. 기존 Herdr 설정의 native 행을 보존하면서 다음 두 행을 추가한다. 플러그인 자체는 사용자 설정을 변경하지 않는다.

```toml
[ui.sidebar.agents.rows_by_agent]
gjc = [["state_icon", "agent"], ["$gjc_herdr_model"], ["$gjc_herdr_session"]]
```

위 native 행은 예시다. 기존 행 구성이 다르면 그대로 유지하고 `$gjc_herdr_model`·`$gjc_herdr_session` 행만 추가한다.

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

## 배포와 제한

- GitHub에 소스를 공개했지만 npm에는 발행하지 않았다. 현재 라이선스는 `UNLICENSED`다.
- Native reporter 대체·권한 위임, 플러그인 주도 fixed-file cold resume, cwd/context 통계, pane layout 제어는 제공하지 않는다.
- 공개 저장소에는 제품 source·package/lockfile·TypeScript 설정·단위 테스트·이 README를 포함한다. `dist/extension.js`는 build 결과로 Git에는 없으며 설치 tarball에 포함된다.
- 로컬 검증 기록·screenshot·workflow 원장·백업·credentials·환경 의존 통합 검증 도구는 공개하거나 패키징하지 않는다. `npm test`는 mock 기반 단위 테스트이며 실제 Herdr E2E를 다시 실행하는 명령이 아니다.
