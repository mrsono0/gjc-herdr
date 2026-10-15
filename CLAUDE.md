# gjc-herdr — Claude Code 시작 안내

GJC용 Herdr 연동 플러그인 저장소이며, Herdr 안에서 Claude Code(팀장)와 agy(구현 팀원), 선택 Codex(검토 팀원)가 함께 개발하는 환경이 `.claude/settings.json` hook으로 자동 구성된다.

- **사용자가 "환경 설정해줘", "안내대로 설정해줘", "세팅해줘" 등을 말하면** 이 저장소의 환경 구축 요청이다: `scripts/check-env.sh`를 실행하고 [docs/dev-environment.md](docs/dev-environment.md) 3절 절차를 따른다(읽기 전용 점검 → FAIL·WARN만 해결 → 판정은 실제 출력으로). 사용자 설정 파일을 바꾸는 단계는 승인을 받고 진행한다. 새로 clone했거나 환경이 의심될 때도 같다.
- 설치·사용법은 [README.md](README.md). 개발 검증은 `npm run check`, `npm test`, `bun scripts/build.ts`.
- 사용자 승인 없이 commit·push·tag·전역 설치·사용자 설정(`~/.config/herdr/config.toml`, credentials, PATH) 변경, 소유하지 않은 pane 종료를 하지 않는다. GJC·Herdr 본체는 수정하지 않는다.
- **플러그인 작업 요청(기능·버그·보강)은 GitHub 이슈로 관리한다**: 작업 전에 `gh issue create`로 등록(배경·원인·범위·범위 밖), 브랜치 이름은 짧게 `i<이슈번호>`(예: `i14`)로 만들고 커밋 메시지에 `(#<번호>)`를 붙이고(Codex 상태 줄에 브랜치 이름이 붙어 critic pane 폭을 차지한다), 배포(release commit·tag push)까지 끝나면 결과를 코멘트하고 `gh issue close`한다. 사용자가 작업 범위와 배포를 승인한 요청에 한해 이슈 등록·commit·push·tag를 진행한다.
- **작업 시작 전 팀장 잠금과 역할을 확인한다**: SessionStart hook이 출력한 `GJCH:` 역할 줄을 따르고, 플러그인 작업 전 `scripts/team-lead.sh status`로 역할을 확인한다. `mine`(또는 잠금 없음이고 herdr 안 팀장)일 때만 팀장으로 배정하며, 다른 세션이 살아 있으면 팀원에게 아무것도 입력하지 않고 사용자에게 알린다. herdr 밖(데스크톱 Code 탭) 팀장은 [docs/dev-environment.md](docs/dev-environment.md) §2.1(이관은 §2.2)을 따른다.
- **작업 시작 전 팀원(agy)부터 확인한다**: 플러그인 작업 요청을 받으면 먼저 `herdr agent list`로 `gjc-herdr-mate`(agy)가 살아 있는지 본다. 종료돼 있으면 `scripts/team-up.sh --spawn`으로 복구한 뒤 시작하고, 혼자 진행하지 않는다. 팀장(Claude)은 분해·배정·검증을, 구현 팀원(agy `gjc-herdr-mate`)은 구현을, 검토·조사 팀원(Codex `gjc-herdr-critic`, 선택)은 독립 검토·조사를 맡는다. GJC는 상시 팀원이 아니며, 플러그인 실사용 관측(로드·token 표시·`/herdr-send`·`/herdr-call` 실동작)이 필요할 때만 팀장이 임시 탭에 띄워 확인하고 닫는다([docs/dev-environment.md](docs/dev-environment.md) §4). Codex에는 요청마다 `/new` 뒤 자체 완결 지시서를 보낸다([docs/dev-environment.md](docs/dev-environment.md) §4·§5). 팀원 없이 진행해야 했다면 그 사유와 범위를 사용자에게 먼저 알린다.
