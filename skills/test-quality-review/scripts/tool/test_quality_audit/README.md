# Test quality audit

Send **only the test file, the indicated test, and the criteria** to Substrate's
registered local `classifier` (`vllmDecision`, `qwen3.8-sw`). No production-source
expansion, generated reasons, paid inference, commits, pushes, or merges.
Dry run is the default.

```sh
dart run tool/test_quality_audit.dart run \
  --file test/util/parameter_write_debouncer_test.dart \
  --mcp-config "$HOME/.pi/agent/mcp.json" \
  --out .dart_tool/debouncer-quality \
  --dry-run
```

Repeat `--file` or `--name` to select exact test files or title substrings (OR).
There is no implicit repository-wide run. `--limit N` caps new classifier calls;
unclassified rows remain unresolved. Repeating the command resumes cached,
hash-matched results, including valid context-inadequate answers. Failed calls
can retry on the next invocation; there is no in-run retry/polling loop.

## 32K context ceiling

`--max-tokens` defaults to **32768** and cannot exceed it. Budgeting counts the
**entire request, including all criteria**, leaving 2048 tokens of native prompt
and output headroom. With `uv` installed, `budget.py` uses the larger of tiktoken's
cl100k_base/o200k_base estimates; these are **not the exact Qwen tokenizer**.
Without uv it uses Python, falling back to a conservative UTF-8 byte upper bound
if tiktoken is unavailable. Provider context/resource limits remain authoritative;
rejected calls are unresolved rather than silently accepted or retried forever.

Oversized files are chopped at a line boundary. The indicated test's complete
AST-extracted source, original range, title and enclosing loop bindings are kept
separately, even if that test is outside the included file prefix. Included lines
and omissions are explicit in every packet. If the indicated test plus criteria
alone exceed the budget, the row is blocked; its body is never silently cut.
Complete original test files remain archived in `manifest.json`.

Shared test-file text precedes the varying target, allowing prefix reuse where
the provider supports it. `--concurrency` bounds warm requests (default 1, maximum
8); the first actual call is serial and gets **120 seconds** for model loading.
Subsequent calls get **30 seconds**. Override with `--cold-timeout` and `--timeout`.
The MCP transport allows ten additional seconds to receive the bounded reply.

## Screening a full suite

Use `--verdict-only` for a first pass asking only keep/remove/tighten. These
rows are marked `screenOnly` and cannot authorize source deletion. Then run the
same output directory with `--verify-removals` to request all four categories
for screened remove candidates. The original screen replies are archived under
`screen-results/`; valid richer replies already present are reused. Neither
phase generates written reasons. Keep/tighten samples still need source review.

Warm concurrency is bounded, and three consecutive service/transport failures
stop a batch (allowing already in-flight calls to finish). Failed calls remain
unresolved. For long audits, use bounded `--limit` batches with fresh MCP
connections rather than turning a lost socket into thousands of bogus verdicts.

## Labels and review

Four questions produce categories, not written explanations:

- **Disposition:** `keep`, `remove`, `tighten`.
- **Protection:** documented regression, edge case, error handling, contract,
  accessibility/layout, smoke-only, unclear.
- **Weakness:** none, implementation coupling, vacuous assertion, proven
  redundant coverage, unrealistic setup, excessive synchronization, missing
  assertions, insufficient context.
- **Context adequate:** boolean score, based on the supplied test file—not a
  demand for production code or historical issue links.

Reports expose the model's raw choice and the effective verdict. Insufficient
context, malformed/failed calls, stale requests/source, or an unexpected model
or provider are **unresolved**, never applicable removals. A `remove` verdict
paired with `weakness: none` is separately flagged as contradictory and blocks
bulk application until source review; the raw model choice remains visible.
Scores are raw,
**uncalibrated** outputs, not measured correctness probabilities. Specific wire
bytes, call ordering, rare errors, races, accessibility and geometry can protect
real contracts; specificity alone does not justify deletion.

Dart analyzer ASTs identify `test`, `testWidgets`, and `blocTest` declarations
without running tests. Parameterized declarations cover all enclosing variants;
variants are not expanded. Custom registration wrappers are not inventoried.
Chopped setup or external test helpers can require manual review. A full audit
report must distinguish extracted declarations, classified rows, and unresolved
or unsupported coverage; it is not automatically an exhaustive runtime inventory.

## Build, inspect, apply

```sh
# Build/budget packets without inference.
dart run tool/test_quality_audit.dart build \
  --file test/util/parameter_write_debouncer_test.dart \
  --out .dart_tool/debouncer-quality

# Regenerate a dry-run report from saved responses.
dart run tool/test_quality_audit.dart report --out .dart_tool/debouncer-quality

# Explicitly apply effective remove verdicts.
dart run tool/test_quality_audit.dart report \
  --out .dart_tool/debouncer-quality --apply-removals
```

`--dry-run` and `--apply-removals` are mutually exclusive. Apply preserves deleted
bodies in `proposed-removals.json` before writing source. Only
`test/**/*_test.dart` can be targets; hashes and ranges must still match.
Unbraced/embedded registrations and overlapping edits are refused. If every
supported test in a file is removed, the empty test file is deleted; review that
whole-file deletion for shared helpers/custom wrappers. Other verdicts are not
rewritten. Review `git diff`, format affected files, run relevant tests and
`flutter analyze --no-pub`; unused test scaffolding may need focused cleanup.

`--mcp-config` selects an existing HTTP MCP JSON entry named `substrate` (override
with `--server`). Its URL and optional headers contact only the Substrate control
plane; `${ENV_VARIABLE}` header values are expanded. Credentials/configuration
are not stored in audit artifacts. The tool verifies the provisioned local
provider/model before inference; it does not contact classifier endpoints directly.

Outputs under `--out`: `manifest.json`, `results/*.json`, `report.md`,
`report.json`, and `proposed-removals.json`. The default `.dart_tool/` location is
gitignored. These artifacts contain repository source; keep them private.
