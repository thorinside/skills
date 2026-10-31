---
name: test-quality-review
description: Review a project's tests during development to identify redundant or weak tests and explain useful distinct requirement or regression coverage. Use for test-quality reviews or classifier-assisted test triage, not automatic test deletion or unsolicited coverage expansion.
---

# Test quality review

Review the requested change or selected tests, using the existing nt_helper audit's
keep/remove/tighten criteria. Classifier labels are advisory candidates; the agent
supplies source-grounded explanations. This skill never edits target tests.

## 1. Bound the review

Read the project's local instructions and confirm repository identity, working-tree
status, requested change, and exact test selection. Preserve other agents' work.
Ask before expanding coverage beyond the requested change. Default to the tests
associated with that change, not a repository-wide audit.

For each test, identify the requirement or distinct regression it claims to protect,
its setup, observable assertions, and relevant existing coverage. A title is a claim,
not evidence. Record missing helpers or contract information as unresolved.

## 2. Inspect and classify

Read the selected tests. Apply the categorical rubric in
[`scripts/tool/test_quality_audit/questions.json`](scripts/tool/test_quality_audit/questions.json).

- **Keep:** assertions detect a distinct supported behavioral failure.
- **Tighten:** the current scenario has distinct value but weak assertions,
  unnecessary coupling, unrealistic setup, or excessive synchronization.
- **Remove candidate:** a vacuous assertion, mock self-check, superficial existence
  check, obsolete path, or equivalent *retained* coverage is demonstrated.
- **Unresolved:** necessary evidence is absent or stale; do not infer redundancy.

For redundancy, cite the retained test and show that its inputs, application path,
and assertions detect the same failure. Similar titles or overlapping lines are not
proof. Keep rare errors, race boundaries, wire contracts, accessibility and layout
geometry when they protect actual requirements. Specificity alone is not weakness.

Review against Neal's rules:

- Every new test names its requirement or distinct regression **and explains why
  existing coverage is insufficient**.
- Use simulated time only: no real-time sleeps or bounded real-time waits in tests.
- Assert supported behavior, not incidental presentation. Requirement-backed
  geometry, accessibility, and layout stability are meaningful behavior.
- Ask before adding coverage beyond the requested change. Proposing a useful new
  scenario does not make an empty existing test useful.

### Optional classifier assistance (Dart only)

For selected Dart/Flutter tests, read
[`scripts/tool/test_quality_audit/README.md`](scripts/tool/test_quality_audit/README.md)
for standalone setup and build/run/report commands. The bundled extractor and
budgeter are adapted from an **uncommitted, in-progress** nt_helper snapshot; see
[`references/PROVENANCE.md`](references/PROVENANCE.md).

Build packets without inference first; inspect the indicated body, loop bindings,
included lines and omissions. The classifier sees only the test file, indicated
test, and criteria, not production source. Supply no extra source to this pipeline.
Manual review may inspect necessary implementation/contracts; distinguish that
additional evidence from what the classifier actually saw.

Discover the live Substrate tool schemas and enabled provisioned service before
inference. The bundled adapter requires local `vllmDecision/qwen3.8-sw` and existing
HTTP MCP configuration; no paid fallback, direct classifier endpoint, or invented
credentials. If unavailable or incompatible, report the limitation and continue
manual review. Never claim inference ran when it did not.

Use bounded `--limit` batches. Treat failed calls, missing context, stale hashes,
unsupported declarations and malformed responses as unresolved. Scores are
uncalibrated, not correctness probabilities. Screening does not replace full
categorical verification or manual review. Preserve packets/results privately:
they contain source. The tool's network deadlines are operational limits, not
permission to use real-time waits in tests.

For other languages, apply the same rubric manually; the bundled parser does not
inventory them. Do not invent replacement extractors or claim exhaustive coverage.

## 3. Explain and hand back

Produce a compact table:

| Test/location | Requirement or distinct regression | Keep/tighten/remove candidate/unresolved | Evidence and reason | Equivalent retained coverage or missing evidence |
|---|---|---|---|---|

For proposed new or tightened tests, state why current coverage is insufficient and
whether the proposal is within the authorized change. Cite assertions and source
locations; do not present a categorical model label as a generated explanation.
Clearly separate classifier evidence from the agent's manual findings.

Report reviewed declarations, classified rows, unresolved items, unsupported
patterns/languages, and any source changes since extraction. Parameterized Dart
declarations are not expanded into runtime cases; custom registration wrappers are
not inventoried. A partial audit is not a suite-wide guarantee.

Completion: every selected test has a grounded judgment or an explicit evidence
gap, with paths and next actions. Do not delete or modify tests based on labels.
Any later authorized cleanup is separate work requiring retained-coverage review
and focused validation; never bulk-apply classifier verdicts.
