# gjc-herdr — Claude Code 시작 안내

GJC용 Herdr 연동 플러그인 저장소이며, Herdr 안에서 Claude Code(팀장)와 GJC(팀원)가 함께 개발하는 환경이 `.claude/settings.json` hook으로 자동 구성된다.

- 새 컴퓨터에서 막 clone했거나 환경이 의심되면 먼저 `scripts/check-env.sh`를 실행하고 [docs/dev-environment.md](docs/dev-environment.md)의 절차를 따른다(읽기 전용 점검 → FAIL만 해결 → 판정은 실제 출력으로).
- 설치·사용법은 [README.md](README.md). 개발 검증은 `npm run check`, `npm test`, `bun scripts/build.ts`.
- 사용자 승인 없이 commit·push·tag·전역 설치·사용자 설정(`~/.config/herdr/config.toml`, credentials, PATH) 변경, 소유하지 않은 pane 종료를 하지 않는다. GJC·Herdr 본체는 수정하지 않는다.
