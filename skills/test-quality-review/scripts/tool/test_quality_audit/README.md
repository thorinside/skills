# Dart classifier adapter (review-only)

Extracts `test`, `testWidgets`, and
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

# Default first pass: one test file, disposition only; no classifier contact.
dart --packages="$SKILL/scripts/.dart_tool/package_config.json" \
  "$SKILL/scripts/tool/test_quality_audit.dart" build \
  --file test/example_test.dart --out .dart_tool/quality-review \
  --verdict-only --model "$CLASSIFIER_MODEL"

# Optional bounded inference, using caller-authorized MCP configuration.
dart --packages="$SKILL/scripts/.dart_tool/package_config.json" \
  "$SKILL/scripts/tool/test_quality_audit.dart" run \
  --out .dart_tool/quality-review \
  --mcp-config /absolute/path/to/mcp.json \
  --server "$MCP_SERVER" --service "$CLASSIFIER_SERVICE" \
  --provider "$CLASSIFIER_PROVIDER" --model "$CLASSIFIER_MODEL" --limit 5 --dry-run

# Regenerate reports from saved results without inference.
dart --packages="$SKILL/scripts/.dart_tool/package_config.json" \
  "$SKILL/scripts/tool/test_quality_audit.dart" report \
  --out .dart_tool/quality-review
```

Install the skill once in the agent's global skill location; it need not be copied
into any reviewed repository. The target is `--project /path/to/repository` or the
**caller's current directory** when omitted, never the installation directory.
Relative `--file`, `--out` and `--mcp-config` paths resolve from that target;
dependencies and prompts resolve from the absolute skill path. `--out` defaults
to `.dart_tool/test-quality-audit` inside the target and must remain within it,
including after symlink resolution. Each repository owns its configuration,
outputs, caches and review state. A manifest bound to another canonical repository
path is rejected even if copied in; use a fresh output directory. Installation
`.dart_tool` contains only Dart dependencies/build tooling, never review state.
Keep config files repository-specific (or pass an authorized absolute config
explicitly); there is no automatic discovery of installation-local configuration. Repeat `--file` for exact files under
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
selected model's exact tokenizer. Without uv it uses Python and, if tiktoken is unavailable,
a conservative UTF-8 byte estimate. Initial uv/tiktoken resolution may require
network access. Provider limits remain authoritative.

Oversized file text is shortened at line boundaries; the complete indicated target
and loop bindings remain separate. Included lines and omissions are explicit. If
the target plus criteria cannot fit, the row is blocked rather than truncated.
`--max-bytes` is the upstream pre-budget byte guard; token budgeting recomputes the
blocked state, so do not treat it as an independent final request-size guarantee.

## Optional compatible MCP classifier

`run` requires explicit `--mcp-config`, `--server`, `--service`, `--provider` and
`--model`; none default to a particular installation or infrastructure. Set the
shell variables in the example to caller-authorized values. This adapter retains
one existing wire contract, rather than inventing integrations: `get_tool(name)`
exposes `get_service` and `create_classification`; `get_service(name: SERVICE)`
returns `success` and `data` with `enabled`, `serviceType: classifier`, and
`classifierConfig.provider/model`; `create_classification(service: SERVICE,
request: ..., timeoutMs: ...)` returns `success` and `data.provider/model/answers`.
Inspect the live schemas and confirm compatibility before running. Service and
response identities must match the selected provider/model. Changing service,
provider or model invalidates prior classifier cache entries. No fallback is used.
An incompatible service is a reported limitation; manual review remains available.
Offline builds may omit `--model`; before inference, build with the selected
`--model` (or pass `--file` and `--model` to `run`). Resuming with a different model
requires rebuilding so requests are budgeted and hashed for that model.

`--mcp-config` reads the selected entry under `mcpServers`, with an HTTP(S) `url`.
Optional header values expand `${ENV_VARIABLE}`. Configuration and credentials
are not copied into artifacts; selected service/provider/model identities are.

Default concurrency is 1 (maximum 8). The first call gets 120 seconds for cold
loading and subsequent calls 30 seconds; `--cold-timeout`/`--timeout` override
these operational deadlines. The transport adds 10 seconds. Three consecutive
service failures stop new work; already in-flight calls may finish. Failed rows
can retry on a later invocation; no in-run polling/retry loop. Valid inadequate-
context replies are cached rather than repeatedly classified.

The default development workflow is a single-file first pass: build/run with
`--verdict-only` to classify keep/tighten/removal candidates. Give concise grounded
reasons manually; do not require the explanatory questions in this pass. The CLI
retains its existing full-question mode when `--verdict-only` is omitted.

Optional second pass, only when requested: use the existing four-question review
(disposition, protection, weakness, contextAdequate) for flagged tightening/removal
recommendations. For screened removals, use `run --verify-removals` on the same
output directory **without `--file`**; original replies are archived in
`screen-results/`. This flag selects removals only, not tighten rows. For flagged
tighten tests, build/run the original `--file` with existing `--name` filters in a
separate target-local output directory, omitting `--verdict-only`; inspect the
selection because filters are title substrings. This preserves the initial pass.
Use protection/weakness labels and source evidence to explain why the test was
flagged and what to tighten or compare before considering removal. Labels are not
generated explanations. Both passes are advisory and require manual review;
the second pass is never a prerequisite for the initial classification.

## Reports and limitations

Outputs: `manifest.json`, `results/*.json`, `report.md`, `report.json`,
`proposed-removals.json`, and optionally `screen-results/`. Reports contain raw
choice, effective verdict, protection, weakness, uncalibrated scores, status and
contradiction flags. Insufficient context, stale source/request hashes, missing or
malformed replies and mismatched configured classifier identities remain unresolved. The model does
not generate reasons; the invoking agent must explain findings from source.

The retained upstream proposal planner can reject embedded/unbraced or overlapping
remove candidates even in report-only mode. Inspect saved rows manually if that
happens; it does not establish a successful report or authorize editing.
Classifier precision/calibration are unestablished; verify integration separately.

Keep artifacts private and use the project's approved artifact location. Do not
store them in this installed skill. Local validation for this package (not the
reviewed project's suite):

```sh
(cd "$SKILL/scripts" && dart analyze && dart test test/tool/test_quality_audit_test.dart)
(cd "$SKILL/scripts/tool/test_quality_audit" && python3 -B -m unittest test_budget.py)
python3 -B "$SKILL/scripts/test/portability_check.py"
```

The tests are ported upstream coverage; time/deadline checks use injected callbacks
and completers, not sleeps or bounded real-time waits.
