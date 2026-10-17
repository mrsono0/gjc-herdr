#!/usr/bin/env python3
"""Herdr pane process-info JSON에서 팀원(agy·codex)의 foreground argv를 기대 시작 옵션과 비교한다(#42).

단위 묶기 규칙의 전제:
- 기대 옵션에는 위치 인자가 없고, 옵션 값은 '-'로 시작하지 않는다.
- '--model=x' 같은 '=' 결합형은 지원하지 않으며 분리형('--model x')만 비교한다(결합형은 '없음'으로 판정).
- foreground_processes에서 대상 kind가 아닌 다른 프로세스(node MCP 자식 등)의 argv·cmdline은
  비밀값(API 키 등)이 들어 있을 수 있으므로 읽지도 출력하지도 않는다.
- 불일치 시 실제 argv 값은 절대 출력하지 않으며 기대 값만 표시한다.
"""

import json
import sys
from typing import List, Optional, Tuple

Unit = Tuple[str, Optional[str]]


def group_argv_units(tokens: List[str]) -> List[Unit]:
	"""argv[1:] 토큰 목록을 (깃발, 값 또는 None) 단위 목록으로 묶는다.

	전제: 기대 옵션에는 위치 인자가 없고, 옵션 값은 '-'로 시작하지 않는다.
	- '-'로 시작하는 단어 다음 단어가 '-'로 시작하지 않으면 (깃발, 값) 한 쌍으로 묶는다.
	- 그렇지 않으면 단독 깃발 (깃발, None)이다('--model=x' 같은 '=' 결합형은 분리하지 않아 기대 분리형 옵션과 일치하지 않으며 '없음'으로 판정).
	- 위치 인자(예: 'resume', '<id>')는 무시한다.
	"""
	units: List[Unit] = []
	i = 0
	n = len(tokens)
	while i < n:
		word = tokens[i]
		if word.startswith("-"):
			if i + 1 < n and not tokens[i + 1].startswith("-"):
				units.append((word, tokens[i + 1]))
				i += 2
			else:
				units.append((word, None))
				i += 1
		else:
			i += 1
	return units


def parse_expected_units(raw_args: List[str]) -> List[Unit]:
	"""인자로 받은 기대 단위 목록("<깃발> <값>" 문자열 또는 분리된 토큰)을 Unit 목록으로 변환한다.

	전제: 기대 옵션에는 위치 인자가 없고, 옵션 값은 '-'로 시작하지 않는다.
	"""
	expanded: List[str] = []
	for item in raw_args:
		if item.startswith("-") and " " in item:
			flag, val = item.split(" ", 1)
			expanded.append(flag)
			expanded.append(val)
		else:
			expanded.append(item)
	return group_argv_units(expanded)


def format_unknown(name: str, reason: str, status: str) -> str:
	suffix = "" if status in ("idle", "done") else " (작업 중 — 다시 점검)"
	return f"↳ {name} 옵션 판정 불가: {reason}{suffix}"


def parse_cli(argv: List[str]) -> Tuple[bool, str, str, str, str, List[Unit]]:
	process_info_failed = False
	status: Optional[str] = None
	idx = 0
	n = len(argv)
	while idx < n:
		arg = argv[idx]
		if arg == "--process-info-failed":
			process_info_failed = True
			idx += 1
		elif arg == "--status" and idx + 1 < n:
			status = argv[idx + 1]
			idx += 2
		elif arg.startswith("--status="):
			status = arg.split("=", 1)[1]
			idx += 1
		else:
			break

	if idx + 3 > n:
		sys.exit(2)

	kind = argv[idx]
	name = argv[idx + 1]
	recovery = argv[idx + 2]
	idx += 3

	while idx < n:
		if argv[idx] == "--":
			idx += 1
			break
		if argv[idx] == "--process-info-failed":
			process_info_failed = True
			idx += 1
		elif argv[idx] == "--status" and idx + 1 < n:
			status = argv[idx + 1]
			idx += 2
		elif argv[idx].startswith("--status="):
			status = argv[idx].split("=", 1)[1]
			idx += 1
		elif not argv[idx].startswith("-") and status is None:
			status = argv[idx]
			idx += 1
		else:
			break

	expected_units = parse_expected_units(argv[idx:])
	return (
		process_info_failed,
		status if status is not None else "idle",
		kind,
		name,
		recovery,
		expected_units,
	)


def basename_of(raw_name: str) -> str:
	stripped = raw_name.rstrip("/")
	if "/" in stripped:
		return stripped.rsplit("/", 1)[-1]
	return stripped


def main() -> int:
	process_info_failed, status, kind, name, recovery, expected_units = parse_cli(
		sys.argv[1:]
	)

	if process_info_failed:
		print(format_unknown(name, "process-info 실패", status))
		return 1

	raw_stdin = sys.stdin.read()
	try:
		doc = json.loads(raw_stdin)
	except Exception:
		print(format_unknown(name, "JSON 오류", status))
		return 1

	if not isinstance(doc, dict):
		print(format_unknown(name, "JSON 오류", status))
		return 1

	result_obj = doc.get("result")
	if not isinstance(result_obj, dict):
		print(format_unknown(name, "JSON 오류", status))
		return 1

	proc_info = result_obj.get("process_info")
	if not isinstance(proc_info, dict):
		print(format_unknown(name, "JSON 오류", status))
		return 1

	fg_procs = proc_info.get("foreground_processes")
	if not isinstance(fg_procs, list):
		print(format_unknown(name, "JSON 오류", status))
		return 1

	matched_procs = []
	for entry in fg_procs:
		if not isinstance(entry, dict):
			print(format_unknown(name, "JSON 오류", status))
			return 1
		proc_name = entry.get("name")
		if isinstance(proc_name, str) and proc_name and basename_of(proc_name) == kind:
			matched_procs.append(entry)

	if len(matched_procs) == 0:
		print(format_unknown(name, "agent 프로세스 0개", status))
		return 1
	if len(matched_procs) >= 2:
		print(format_unknown(name, "agent 프로세스 2개 이상", status))
		return 1

	target_proc = matched_procs[0]
	raw_argv = target_proc.get("argv")
	if (
		not isinstance(raw_argv, list)
		or len(raw_argv) == 0
		or any(not isinstance(tok, str) for tok in raw_argv)
	):
		print(format_unknown(name, "argv 없음", status))
		return 1

	actual_units = group_argv_units(raw_argv[1:])

	missing: List[str] = []
	different: List[str] = []

	for exp_flag, exp_val in expected_units:
		same_flag_vals = [val for (flag, val) in actual_units if flag == exp_flag]
		if not same_flag_vals:
			if exp_val is None:
				missing.append(exp_flag)
			else:
				missing.append(f"{exp_flag} {exp_val}")
		elif exp_val is not None and exp_val not in same_flag_vals:
			different.append(f"{exp_flag}(기대 {exp_val})")

	if not missing and not different:
		return 0

	parts: List[str] = []
	if missing:
		parts.append("없음 " + ", ".join(missing))
	if different:
		parts.append("다름 " + ", ".join(different))

	detail = "; ".join(parts)
	print(f"↳ {name} 옵션 불일치: {detail} (복구: {recovery})")
	return 1


if __name__ == "__main__":
	sys.exit(main())
