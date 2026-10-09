# herdr 업스트림 등록 결과 — GJC 감지 매니페스트 요청

- **게시물:** [Agent detection manifest for Gajae Code (gjc) — PR-ready rules + captured snapshots](https://github.com/herdrdev/herdr/discussions/5005)
- **위치:** herdrdev/herdr Discussions → Ideas (#5005)
- **상태:** open (댓글 0개, 응답 대기 중)
- **작성 계정:** mrsono0 · **작성 시각:** 2026-10-06T14:13:23Z (= 2026-10-06 23:13:23 KST)
- **증거 gist(공개):** https://gist.github.com/mrsono0/4fe862d129684fa8ba915a53229cb4c9
- **언어:** 영어 (herdr 저장소 규격)

## 게시 검증 (게시 직후 API 재조회)

- 본문 5093자, gist 링크 포함, 매니페스트 TOML 인라인 포함 — 모두 확인
- 원본 응답 보관: `disc-5005.json` (이 파일과 같은 폴더)

## 게시된 본문 (원문 그대로)

---

Hi herdr maintainers,

I'd like to contribute a detection manifest for **Gajae Code** (`gjc`,
https://github.com/Yeachan-Heo/gajae-code) so panes running it become *detected*
agents and can participate in agent-to-agent prompting (`agent prompt`,
`agent send_keys`, `agent explain`).

## Context

gjc 0.18.7 already ships native pane reporting on your documented custom-integration
API (`pane report-agent --source custom:gjc --agent gjc --state idle|working|blocked`,
plus pane-title metadata and `release-agent` on exit — gjc `src/utils/herdr-pane.ts`).
That makes gjc panes show up with accurate lifecycle state in the sidebar and
`agent wait` today.

What it can't get by reporting is the detected-label path: `agent explain` answers
`agent_explain_unavailable: does not have a detected agent label`, and `agent prompt`
refuses reported labels — the same wall documented in #4732. A bundled detection
manifest is the supported per-kind route, so here it is.

## What I'm offering

- A draft `gjc.toml` (below) authored from real `--source detection` snapshots of
  gjc 0.18.7 on macOS, herdr 0.9.3.
- The captured snapshots (idle / working / per-tool activity rows / ask-tool dialog /
  post-dismiss idle) as test fixtures — happy to format them for
  `src/detect/manifest/tests.rs`.
- argv0 is `gjc`; suggested aliases: `gajae-code`, `gajae code`.
- Upstream code touchpoints I identified for the enum/manifest wiring (from kimi as
  reference): `Agent` variant + label/alias tables in `src/detect/mod.rs`,
  `BUNDLED_MANIFESTS` in `src/detect/manifest.rs`, `src/detect/manifests/gjc.toml`,
  catalog `distribution/agent-detection/{index.toml,gjc.toml}`, sound/config name
  lists. No herdr-side integration hook is needed — gjc reports natively in-process.
- Resume: gjc exposes `gjc --resume=<session-id>`; gjc does not yet report
  `agent_session_id`, so resume wiring can be a follow-up.

## Draft manifest

```toml
id = "gjc"
version = "2026.10.06.1"
min_engine_version = 1
updated_at = "2026-10-06T00:00:00Z"
aliases = ["gajae-code", "gajae code"]

[[rules]]
id = "ask_question_dialog"
state = "blocked"
priority = 980
region = "whole_recent"
visible_blocker = true
line_regex = ['^\s*↑/↓\s+select\s+enter\s+esc\b']
any = [
  { line_regex = ['^\s*│❯\s*\S'] },
  { contains = ["Other (type your own)"] },
]

[[rules]]
id = "activity_spinner"
state = "working"
priority = 970
region = "bottom_non_empty_lines(8)"
visible_working = true
line_regex = ['^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+\S.*⟦esc⟧\s*$']

[[rules]]
id = "busy_prompt_box"
state = "working"
priority = 950
region = "prompt_box_body"
visible_working = true
contains = ["↩: Steer"]

[[rules]]
id = "idle_prompt_box"
state = "idle"
priority = 900
region = "prompt_box_body"
visible_idle = true
line_regex = ['^[│\s]*>\s*Type your message']
not = [
  { contains = ["↩: Steer"] },
]
```

## Screen evidence (gjc 0.18.7)

| State | Invariant markers observed |
|---|---|
| idle | input box row `│ > Type your message... ⌥Q: Queue (busy) · ⇧⇥: Thinking · ⌃L: Model · ⌃R: History` |
| working | activity row ` ⠧ Working… ⟦esc⟧`; per-tool rows ` ⠹ Listing current directory ⟦esc⟧`; input box gains `↩: Steer` |
| blocked (ask tool) | option rows `│❯ 예` / `│  Other (type your own)`; footer ` ↑/↓ select  enter  esc  PgUp/PgDn/Ctrl+u/d: question · Wheel: transcript` |
| title | OSC title `GJC: <session-or-turn-title>` (identity only; no state spinner in the title) |

Validation performed offline against 64 detection snapshots: 57 idle / 6 working /
1 blocked classified with zero expected-state misclassifications, including the
esc-dismiss edge case (dialog disappears from the detection snapshot; no lingering
footer false-positive). Tool rows use model-generated English descriptions, so the
working rule anchors on the braille spinner + `⟦esc⟧` affordance rather than label text.

## Notes / open questions for review

- gjc's native reporter stays the state authority (it knows gates precisely);
  these rules are the detection label plus a screen fallback. Happy to adjust
  priorities/regions to whatever the maintainers prefer for reporter-equipped agents.
- The ask footer uses multi-space separators (`select  enter  esc`); I anchored with
  `\s+` to stay robust to single-spacing changes.
- `min_engine_version` left at 1 following kimi; bump if engine-3 features are wanted.
- This is the per-kind complement to #4732; a general fix there would also serve
  gjc and other reporter-equipped agents.

Sanitized snapshot set (one file per state, SHA-256 manifest included): https://gist.github.com/mrsono0/4fe862d129684fa8ba915a53229cb4c9
(untrimmed originals available on request).
**Sanitization disclosure (curated evidence):** attachment snapshots are bottom-region trims
of `--source detection` reads (the regions the draft rules actually evaluate). MCP tool-panel
and MCP-load-warning lines from the capturing environment were removed, and the model
identifier in the status bar was masked as `MODEL`. Raw untrimmed snapshots are retained by
the contributor; SHA-256 hashes of the exact attachment files are in `SHASUM256.txt`.


---

## gist 첨부 파일 (SHA-256)

```
5b58adc5560843505b99b2cf64db7b601371a4da56cde8c528a3d4661ef1123f  gjc-blocked-ask-dialog.txt
9096bbbce0044bada3878f4a484875e64f70b43f21a37a053bf5c6691cbec23f  gjc-idle-after-dismiss.txt
8d0e1c43d5b82eb80bff13a8631638253ece089fd9a5016daa7cfafd5d1c0ede  gjc-idle-detection.txt
69f0d1091c9c761b1b7c7fcb6dd8615c924b6dddad0441d171b6b95568dcc766  gjc-working-generic.txt
d107f06a84bd1c4ac311d317f05b4a241dc461ba26867ec334732a3dfd010bdc  gjc-working-toolrow.txt
```

파일: `gjc.toml`, `gjc-idle-detection.txt`, `gjc-working-generic.txt`,
`gjc-working-toolrow.txt`, `gjc-blocked-ask-dialog.txt`, `gjc-idle-after-dismiss.txt`,
`SHASUM256.txt` — 하단 영역 트림·MCP 패널/경고행 제거·모델명 `MODEL` 마스킹 적용.

## 관련 업스트림 활동 (같은 날)

- Yeachan-Heo/gajae-code#6412: 사용자 요청으로 close 처리(22:29 KST) — GitHub는 이슈 삭제 미지원
- 본 요청(#5005)은 [herdrdev/herdr#4732](https://github.com/herdrdev/herdr/issues/4732)
  (reported 라벨의 `agent prompt` 거부)의 종류별 보완 경로로 명시됨 — 해당 이슈는 타인 작성, 참조만

## 이후 절차

- maintainer 응답 대기. "PR로 제출" 요청 시 fork+branch 준비, 룰 조정 요청 시 원본 스냅샷
  (`.local/verification/gjc-detection-20261006/` 원본 폴링 파일)으로 대응
- 추가 게시·댓글·PR은 별도 사용자 승인 전 실행하지 않음
- 원장 기록: AGENTS.md 후속 기록(23:13 KST) 참조

## 이 등록의 목적 (2026-10-07 사용자 확정 — AGENTS.md "목표 고정" 절과 동일 내용)

메인 에이전트(Claude Code·Codex·Antigravity·GJC 등 무엇이든)가 다른 에이전트를 **호출하고 답변을 돌려받는 범용 구조**에 GJC가 양방향으로 참여하는 것이 이번 업그레이드 작업의 목적이다. 두 결손이 곧 작업 항목:

| 방향 | 현재 | 해법 | 이 문서의 등록과의 관계 |
|---|---|---|---|
| 아무 에이전트 → GJC | 불가 (감지 게이트, #4732와 동일) | herdr 감지 등록 | **이 등록 요청(#5005)이 이 결손을 여는 조치** |
| GJC → 다른 에이전트 | 불가 (스킬 미설치뿐) | GJC에 herdr 공식 skill 설치 | 등록과 무관 — 우리가 개발할 몫 |

GJC SDK(`turn.prompt`/`turn.result`) 채널은 이 범용 목표의 대체가 아닌 보조(고신뢰 GJC↔GJC 전용). 등록된 제품 상호 간 호출·회수는 이미 herdr가 제공한다.
