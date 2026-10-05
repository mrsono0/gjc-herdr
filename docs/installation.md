# gjc-herdr 설치와 지원 범위

`gjc-herdr`는 기존 GJC native 상태·세션/resume 처리를 유지하면서 Herdr에 모델 ID와 세션 이름을 표시용 metadata로 보고하는 native extension이다. 새 launcher나 별도 서비스는 설치하지 않는다.

## 지원 및 검증 범위

- GJC 0.18.6, Herdr 0.9.3, macOS arm64의 격리 환경에서 실제 설치·로드·metadata 적용·이름 변경·정상 종료·제거·native-only 재실행을 검증했다.
- 공개 SDK의 pane admission 및 main/depth-0 context를 함께 적용한다. 공개 helper에 변조하지 않은 env snapshot을 전달하며, native owner token을 직접 읽거나 PID를 권한으로 주입하지 않는다.
- typecheck, 제품 build와 집중 단위 테스트 5개가 통과했다. 단위 테스트는 Herdr 실행 파일이나 실제 pane 없이 공개 API 경계를 mock하여 실행한다.
- 실제 사용자 sidebar 설정과 화면 표시는 아직 검증하지 않았다. 지원 버전 외의 runtime 성공, provider 인증·추론 성공 또는 최종 production 승인까지 주장하지 않는다.
- 공개 Git 저장소와 npm 발행은 별개다. npm에는 발행하지 않았으며 라이선스는 현재 `UNLICENSED`다.

## 소스에서 build 및 설치

개발 환경에는 Node/npm과 Bun이 필요하다. 제품은 기존 GJC runtime 안에서 실행하며 별도 Node 서비스를 요구하지 않는다.

```sh
git clone https://github.com/mrsono0/gjc-herdr.git
cd gjc-herdr
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run check
npm test
```

`dist/extension.js`는 build 결과이며 Git에 포함하지 않는다. 공개 SDK의 `utils/herdr-pane` helper를 제품 bundle에 포함해 GJC의 relocated extension loader에서 외부 SDK subpath import가 실패하는 문제를 피한다. 이 명령은 플러그인만 build하며 GJC 본체를 수정하거나 build하지 않는다.

아래 명령은 실행한 사용자의 plugin registry를 변경한다. 먼저 검증용 격리 환경에서 사용한다.

```sh
gjc plugin install "gjc-herdr@file:$(pwd)"
gjc plugin list --json
gjc
```

`package.json.gjc.extensions`의 `dist/extension.js`가 로드된다. plain local path는 별도 GJC bundle 설치 경로로 분류되므로 native npm extension에 `--user`나 `--scope`를 덧붙이지 않는다. `plugin link`만으로는 registry의 package dependencies가 채워지지 않아 discovery 성공을 보장하지 않는다.

## metadata와 화면 표시

- `gjc_herdr_model`: 공개 context의 실제 `provider/model-id`.
- `gjc_herdr_session`: 공개 session name. 이름 변경은 GJC의 `/rename <이름>`을 사용한다.
- 값이 없으면 해당 플러그인 키를 제거한다. 제어 문자를 정리하고 80 Unicode 문자로 제한한다.
- sub/nested·무Herdr·invalid pane에는 발행하지 않는다.
- startup·session switch·agent 시작/종료 때 갱신하고 모델과 이름 변경 및 TTL 유지용으로 20초마다 현재 공개 값을 읽는다. TTL은 60초다.
- 독립 source/증가 seq와 두 전용 키를 사용하며 native lifecycle report/release를 호출하지 않는다. 정상 shutdown은 자기 키만 clear한다. crash/SIGKILL의 즉시 cleanup은 보장하지 않는다.

수락된 값은 `herdr pane get <pane-id>`의 `tokens`로 확인한다. 기본 sidebar가 임의 custom token을 자동으로 표시하지는 않는다. 표시하려면 기존 Herdr 설정을 검토하고 사용자가 직접 다음과 같은 공개 custom-token 행을 추가한다. 플러그인은 사용자 설정을 자동 변경하지 않는다.

```toml
[ui.sidebar.agents.rows_by_agent]
gjc = [["state_icon", "agent"], ["$gjc_herdr_model"], ["$gjc_herdr_session"]]
```

이 예시는 renderer의 공개 token 계약에 근거하며 실제 사용자 화면 표시 검증을 대신하지 않는다. native reporter takeover, plugin 주도 fixed-file cold resume, cwd/context 통계 또는 pane layout 제어는 제공하지 않는다.

## 제거

로드된 GJC를 정상 종료한 뒤 제거하고 새 GJC로 확인한다.

```sh
gjc plugin uninstall gjc-herdr
gjc
```

로드된 프로세스에서 disable/uninstall할 때 즉시 callback이 실행된다고 보장하지 않는다. 정상 종료·재시작이 기본 적용 경계다.

## 공개 파일 범위

공개 저장소에는 제품 source, package 및 lockfile, TypeScript 설정, 집중 단위 테스트, 설치 안내와 `.gitignore`만 포함한다. 생성된 bundle, dependencies, 로컬 runtime·credentials·검증 기록·workflow 원장·백업과 환경에 종속된 통합 검증 도구는 포함하지 않는다. 따라서 로컬 통합 검증 도구는 이 저장소의 실행 가능한 test command로 제공하지 않는다.
