#!/usr/bin/env bash
# gjc-herdr 개발·팀 환경 점검(읽기 전용). 아무것도 설치·변경하지 않는다.
# 사용: scripts/check-env.sh   → 항목별 OK/WARN/FAIL 출력, FAIL이 있으면 종료 코드 1.
# 해석과 해결 방법은 docs/dev-environment.md 참조.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
ok()   { printf 'OK    %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }

# --- 필수 도구 ---
for c in git python3; do
	command -v "$c" >/dev/null && ok "$c: $(command -v "$c")" || bad "$c 없음"
done
if command -v bun >/dev/null; then
	want="$(python3 -c 'import json;print(json.load(open("'"$ROOT"'/package.json"))["engines"]["bun"])' 2>/dev/null)"
	have="$(bun --version 2>/dev/null)"
	[ "$have" = "$want" ] && ok "bun $have" || warn "bun $have (build는 $want 고정; 다르면 scripts/build.ts가 중단) — 설치·테스트만 한다면 무방"
else
	bad "bun 없음 (GJC plugin 설치·build에 필요)"
fi
command -v gjc >/dev/null && ok "gjc $(gjc --version 2>/dev/null)" || bad "gjc 없음 (GJC 본체는 이 저장소가 설치하지 않음)"
command -v herdr >/dev/null && ok "herdr $(herdr --version 2>/dev/null)" || warn "herdr 없음 (팀 구성·표시는 Herdr pane 안에서만 동작)"

# --- Herdr pane 여부 ---
if [ "${HERDR_ENV:-}" = 1 ] && [ -n "${HERDR_PANE_ID:-}" ]; then
	ok "Herdr pane 안: $HERDR_PANE_ID (workspace ${HERDR_WORKSPACE_ID:-?})"
else
	warn "Herdr pane 밖 (team-up hook·표시 token은 동작하지 않음 — 정상일 수 있음)"
fi

# --- 저장소 파일 ---
[ -x "$ROOT/scripts/team-up.sh" ] && ok "scripts/team-up.sh 실행 가능" || bad "scripts/team-up.sh 실행 권한 없음 (chmod +x)"
grep -q 'team-up.sh --hook' "$ROOT/.claude/settings.json" 2>/dev/null \
	&& ok ".claude/settings.json SessionStart hook 있음" || bad ".claude/settings.json에 team-up hook 없음"
[ -f "$ROOT/dist/extension.js" ] && ok "dist/extension.js 있음" || bad "dist/extension.js 없음"
[ -d "$ROOT/node_modules" ] && ok "node_modules 있음" || warn "node_modules 없음 → npm ci --ignore-scripts --no-audit --no-fund (개발·테스트 시)"

# --- GJC 플러그인 설치 상태 ---
if command -v gjc >/dev/null; then
	gjc plugin list --json 2>/dev/null | python3 -c '
import sys, json
try: d = json.load(sys.stdin)
except Exception: print("WARN  gjc plugin list --json 파싱 실패"); sys.exit(0)
hit = [p for p in d.get("npm", []) if p.get("name") == "gjc-herdr"]
if not hit: print("WARN  gjc-herdr 플러그인 미설치 → README의 한 줄 설치 명령 참조")
else:
    p = hit[0]
    print("OK    gjc-herdr 플러그인 %s 설치됨 (enabled=%s)" % (p.get("version"), p.get("enabled")))
'
fi

# --- Herdr sidebar 설정(선택) ---
cfg="${HERDR_CONFIG:-$HOME/.config/herdr/config.toml}"
if [ -f "$cfg" ] && grep -q 'gjc_herdr_model' "$cfg"; then
	ok "Herdr sidebar에 gjc_herdr_model 설정 있음"
else
	warn "Herdr sidebar custom token 설정 없음 (token은 발행되지만 sidebar에는 안 보임; README 'Sidebar 설정')"
fi

exit "$fail"
