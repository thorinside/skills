# Dart classifier adapter (review-only)

Adapted from nt_helper's in-progress audit. Extracts `test`, `testWidgets`, and
`blocTest` AST declarations without executing tests, preserves complete targets,
budgets requests, resumes hash-bound responses, and writes categorical reports.
No target source is modified. `--apply-removals` is rejected, including through
`writeReport`. `proposed-removals.json` is an evidence archive, not an approval.

## Setup and invocation

Requires Dart >=3.11 <4, Python 3, and packages resolved in this skill's `scripts/`
directory. Flutter is not required. This package does not change the reviewed
project's dependencies. Set `SKILL` to the absolute installed skill directory:

```sh
SKILL=/absolute/path/to/skills/test-quality-review
(cd "$SKILL/scripts" && dart pub get)
cd /absolute/path/to/project

# Build and inspect packets without contacting Substrate.
dart --packages="$SKILL/scripts/.dart_tool/package_config.json" \
  "$SKILL/scripts/tool/test_quality_audit.dart" build \
  --file test/example_test.dart --out .dart_tool/quality-review

# Optional bounded local inference, using existing authorized MCP configuration.
dart --packages="$SKILL/scripts/.dart_tool/package_config.json" \
  "$SKILL/scripts/tool/test_quality_audit.dart" run \
  --out .dart_tool/quality-review \
  --mcp-config /absolute/path/to/mcp.json --limit 5 --dry-run

# Regenerate reports from saved results without inference.
dart --packages="$SKILL/scripts/.dart_tool/package_config.json" \
  "$SKILL/scripts/tool/test_quality_audit.dart" report \
  --out .dart_tool/quality-review
```

The **current directory is the reviewed repository**; dependencies and prompts
resolve from the absolute skill path. Repeat `--file` for exact files under
`test/**/*_test.dart`; repeat `--name` for title-substring filters (OR). There is no
implicit whole-suite selection. `run` can build first when supplied `--file`, or
resume an existing manifest without it. Use a separate output directory for a new
selection; inspect source/hash warnings after changes.

## Packets, context and limits

Only the test file, selected target and criteria are sent; production imports are
not expanded. Original files remain in `manifest.json`. AST ranges, group titles
and enclosing loop bindings identify the target. Parameterized registrations are
not expanded, and custom wrappers are unsupported. Missing external test helpers
can make a row unresolved; inspect actual packets rather than guessing.

`--max-tokens` defaults to 32768 and cannot exceed it. The complete request,
including criteria, reserves 2048 tokens for native framing/output. With `uv`, the
budgeter uses tiktoken's larger cl100k_base/o200k_base estimate; these are not the
exact Qwen tokenizer. Without uv it uses Python and, if tiktoken is unavailable,
a conservative UTF-8 byte estimate. Initial uv/tiktoken resolution may require
network access. Provider limits remain authoritative.

Oversized file text is shortened at line boundaries; the complete indicated target
and loop bindings remain separate. Included lines and omissions are explicit. If
the target plus criteria cannot fit, the row is blocked rather than truncated.
`--max-bytes` is the upstream pre-budget byte guard; token budgeting recomputes the
blocked state, so do not treat it as an independent final request-size guarantee.

## Substrate integration

Before `run`, inspect live `get_service`, `get_tool` and `create_classification`
schemas through Substrate and confirm compatibility. The current adapter uses
`get_service(name: classifier)` and `create_classification(service: classifier,
request: ..., timeoutMs: ...)`. It requires enabled local `vllmDecision/qwen3.8-sw`
and validates response provider/model. No paid fallback or direct model endpoint.
Service drift is an integration limitation, not permission to change shared config.

`--mcp-config` reads an existing HTTP MCP JSON entry named `substrate` under
`mcpServers`; `--server` changes the entry name. Optional header values expand
`${ENV_VARIABLE}`. Configuration and credentials are not copied into artifacts.

Default concurrency is 1 (maximum 8). The first call gets 120 seconds for cold
loading and subsequent calls 30 seconds; `--cold-timeout`/`--timeout` override
these operational deadlines. The transport adds 10 seconds. Three consecutive
service failures stop new work; already in-flight calls may finish. Failed rows
can retry on a later invocation; no in-run polling/retry loop. Valid inadequate-
context replies are cached rather than repeatedly classified.

For screening, add `--verdict-only` to a build/run selection, then use
`run --verify-removals` on the same output directory **without `--file`** to expand
screened remove rows into the four-question review. Original replies are archived
in `screen-results/`. Keep/tighten screens still require manual review. Screening
and full categorical results are both advisory.

## Reports and limitations

Outputs: `manifest.json`, `results/*.json`, `report.md`, `report.json`,
`proposed-removals.json`, and optionally `screen-results/`. Reports contain raw
choice, effective verdict, protection, weakness, uncalibrated scores, status and
contradiction flags. Insufficient context, stale source/request hashes, missing or
malformed replies and unexpected model/provider remain unresolved. The model does
not generate reasons; the invoking agent must explain findings from source.

The retained upstream proposal planner can reject embedded/unbraced or overlapping
remove candidates even in report-only mode. Inspect saved rows manually if that
happens; it does not establish a successful report or authorize editing. Upstream
is unfinished, classifier precision/calibration are unestablished, and no live
inference was exercised while packaging this skill.

Keep artifacts private and use the project's approved artifact location. Do not
store them in this installed skill. Local validation for this package (not the
reviewed project's suite):

```sh
(cd "$SKILL/scripts" && dart analyze && dart test test/tool/test_quality_audit_test.dart)
(cd "$SKILL/scripts/tool/test_quality_audit" && python3 -B -m unittest test_budget.py)
```

The tests are ported upstream coverage; time/deadline checks use injected callbacks
and completers, not sleeps or bounded real-time waits.
