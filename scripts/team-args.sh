# gjc-herdr 팀 에이전트 이름·라벨·모델·시작 인자 정의 전용(source 전용, bash 3.2).
# top-level에서 실행·exit·claim을 수행하지 않는다.
ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"

LEAD_NAME="${GJCH_LEAD_NAME:-gjc-herdr-lead}"
DEPUTY_NAME="${GJCH_DEPUTY_NAME:-gjc-herdr-deputy}"
MATE_NAME="${GJCH_MATE_NAME:-gjc-herdr-mate}"
CRITIC_NAME="${GJCH_CRITIC_NAME:-gjc-herdr-critic}"
LEAD_LABEL="GJCH 팀장"
DEPUTY_LABEL="GJCH 부팀장 · Claude"
MATE_LABEL="GJCH 팀원 · agy"
CRITIC_LABEL="GJCH 검토·조사 · Codex"
CODEX_MODEL="${GJCH_CODEX_MODEL:-gpt-6.1-sol}"
CODEX_DOC_MAX_BYTES="${GJCH_CODEX_DOC_MAX_BYTES:-65536}"
case "$CODEX_DOC_MAX_BYTES" in
	""|0*|*[!0-9]*) CODEX_DOC_MAX_BYTES=65536 ;;
esac
MATE_MODEL="${GJCH_MATE_MODEL:-gemini-4-argon-high}"
WS_LABEL="${GJCH_WS_LABEL:-GJCH · gjc-herdr}"
RETRIES="${GJCH_RETRIES:-30}"   # 2초 간격 → 최대 약 60초

CODEX_STATUS_LINE='tui.status_line=["context-remaining","total-input-tokens","total-output-tokens"]'
MATE_START_ARGS=(--model "$MATE_MODEL" --mode accept-edits --sandbox)
CRITIC_START_ARGS=(--no-daemon --yolo -m "$CODEX_MODEL" -C "$ROOT" --disable worktrees -c "$CODEX_STATUS_LINE" -c "project_doc_max_bytes=$CODEX_DOC_MAX_BYTES")

# 시작 인자 배열(argv 조각)을 기대 단위("<깃발> <값>" 또는 "<깃발>") 줄 목록으로 바꾼다(#42).
# 전제: 기대 옵션에는 위치 인자가 없고 옵션 값은 '-'로 시작하지 않는다.
format_expected_units() {
	while [ $# -gt 0 ]; do
		if [ $# -ge 2 ] && case "$2" in -*) false ;; *) true ;; esac; then
			printf '%s %s\n' "$1" "$2"
			shift 2
		else
			printf '%s\n' "$1"
			shift
		fi
	done
}
