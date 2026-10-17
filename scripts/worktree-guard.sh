# gjc-herdr 연결 worktree(linked worktree) 판정 보조(source 전용, bash 3.2).
# gjch_worktree_state <root>
#   stdout에 다음 중 하나를 출력하고 0을 반환한다:
#     linked  — 연결 worktree(/.claude/worktrees/ 경로 포함 또는 git-dir != git-common-dir)
#     main    — git으로 확인된 일반 작업 트리(--is-inside-work-tree=true, --is-bare-repository=false, git-dir == git-common-dir)
#     unknown — git 없음, 비저장소, bare, rev-parse 실패, 디렉터리 접근 실패
# gjch_worktree_reason <root>
#   gjch_worktree_state가 linked이면 사유 한 줄을 stdout에 출력하고 0을 반환한다.
#   main 또는 unknown이면 아무것도 출력하지 않고 1을 반환한다.
gjch_worktree_state() {
	local root="${1:-}" real_root git_dir common_dir real_git_dir real_common_dir inside_wt is_bare
	if [ -z "$root" ]; then
		printf 'unknown\n'
		return 0
	fi
	real_root="$(cd "$root" 2>/dev/null && pwd -P)" || {
		printf 'unknown\n'
		return 0
	}
	case "$real_root/" in
		*/.claude/worktrees/*)
			printf 'linked\n'
			return 0
			;;
	esac
	if ! command -v git >/dev/null 2>&1; then
		printf 'unknown\n'
		return 0
	fi
	git_dir="$(git -C "$real_root" rev-parse --git-dir 2>/dev/null)" || {
		printf 'unknown\n'
		return 0
	}
	common_dir="$(git -C "$real_root" rev-parse --git-common-dir 2>/dev/null)" || {
		printf 'unknown\n'
		return 0
	}
	if [ -z "$git_dir" ] || [ -z "$common_dir" ]; then
		printf 'unknown\n'
		return 0
	fi
	real_git_dir="$(cd "$real_root" 2>/dev/null && cd "$git_dir" 2>/dev/null && pwd -P)" || {
		printf 'unknown\n'
		return 0
	}
	real_common_dir="$(cd "$real_root" 2>/dev/null && cd "$common_dir" 2>/dev/null && pwd -P)" || {
		printf 'unknown\n'
		return 0
	}
	if [ "$real_git_dir" != "$real_common_dir" ]; then
		printf 'linked\n'
		return 0
	fi
	inside_wt="$(git -C "$real_root" rev-parse --is-inside-work-tree 2>/dev/null)" || {
		printf 'unknown\n'
		return 0
	}
	is_bare="$(git -C "$real_root" rev-parse --is-bare-repository 2>/dev/null)" || {
		printf 'unknown\n'
		return 0
	}
	if [ "$inside_wt" = "true" ] && [ "$is_bare" = "false" ]; then
		printf 'main\n'
		return 0
	fi
	printf 'unknown\n'
	return 0
}

gjch_worktree_reason() {
	local root="${1:-}" real_root state
	[ -n "$root" ] || return 1
	real_root="$(cd "$root" 2>/dev/null && pwd -P)" || real_root="$root"
	state="$(gjch_worktree_state "$root")"
	if [ "$state" = "linked" ]; then
		printf '연결 worktree(%s)에서 실행 중입니다. 데스크톱 세션의 worktree 옵션을 끄고 저장소 폴더에서 새 세션을 엽니다.\n' "$real_root"
		return 0
	fi
	return 1
}
