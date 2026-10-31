---
name: test-quality-review
description: Review a project's tests in any language to identify redundant or weak tests and explain useful distinct requirement or regression coverage. Use for test-quality reviews or decision-API-assisted test triage.
---

# Test quality review

Review selected tests using keep/remove/tighten criteria. The agent supplies
source-grounded explanations; system-one decisions are supplementary evidence.

## 1. Bound the review

Resolve the target from the caller's explicit project path or working directory,
not this skill's installation. Read project-local instructions and confirm the
repository, working-tree status, requested change and exact selection. Preserve
other agents' work. Default to one caller-selected test file; broader review is
opt-in. Ask before expanding coverage beyond the requested change.

Use the project's existing discovery tools or inspect the file to identify tests,
fixtures, hooks, helpers and parameterized cases. No language or framework is
assumed. Select complete test bodies and retain enclosing parameter bindings.
When discovery is incomplete, state the gap rather than claiming an exhaustive
inventory. A title is a claim, not evidence.

## 2. Inspect and classify

For each test, identify its requirement or distinct regression, setup, observable
assertions and relevant existing coverage. First pass: give a concise grounded
reason and one disposition, using the rubric in
[`scripts/questions.json`](scripts/questions.json):

- **Keep:** assertions detect a distinct supported behavioral failure.
- **Tighten:** the current scenario has distinct value but weak assertions,
  unnecessary coupling, unrealistic setup or excessive synchronization.
- **Remove candidate:** a vacuous assertion, mock self-check, superficial existence
  check, obsolete path or equivalent retained coverage is demonstrated.
- **Unresolved:** necessary evidence is absent or stale.

For redundancy, cite the retained test and show that its inputs, application path
and assertions detect the same failure. Similar titles and overlapping lines are
not proof. Preserve meaningful rare errors, races, wire contracts, accessibility
and layout geometry; specificity alone is not weakness. Inspect implementation or
contracts when needed, and identify missing helpers or evidence explicitly.

Apply these four testing rules:

- Every new test names its requirement or distinct regression and explains why
  existing coverage is insufficient.
- Use simulated time only: no real-time sleeps or bounded real-time waits in tests.
- Assert supported behavior, not incidental presentation. Requirement-backed
  geometry, accessibility and layout stability are meaningful behavior.
- Ask before adding coverage beyond the requested change. A useful replacement
  scenario does not establish that the existing test has value.

### Optional system-one assistance

Use any available **system-one decision API**: a callable service or tool that
makes categorical decisions against supplied criteria. Its provider, model,
transport and native request schema are not prescribed by this skill. Inspect
its actual contract and use caller-authorized settings; if unavailable, continue
manual review and state that limitation.

Read [the decision API workflow](references/DECISION_API.md) for optional packet
and reporting helpers. They accept explicit source ranges from any text test
file, preserving the complete selected body, with no target-language dependency.

Send only the selected test file, indicated test and criteria. Distinguish any
additional manual source review from what the API saw. Inspect packets before
calling it. Keep source-containing artifacts private inside the target project;
use fresh state for a new selection or decision API identity.

The default first pass asks only for disposition. Only when requested, follow
flagged candidates with the full protection/weakness/context questions in a
separate output directory, preserving the initial pass. A decision label is not
a source-grounded explanation. Failed calls, missing context, stale hashes and
malformed responses remain unresolved. Scores are uncalibrated, not correctness
probabilities.

## 3. Explain and hand back

Produce a compact table:

| Test/location | Requirement or distinct regression | Keep/tighten/remove candidate/unresolved | Evidence and reason | Equivalent retained coverage or missing evidence |
|---|---|---|---|---|

Cite assertions and source locations. Clearly separate decision API evidence from
manual findings. For proposed new or tightened tests, explain why current coverage
is insufficient and whether the proposal fits the authorized change.

Report reviewed tests/source ranges, classified rows, unresolved items, discovery
or parameterization gaps, and source changes since selection. Completion means
every selected test has a grounded judgment or explicit evidence gap, with paths
and next actions. Hand back findings; any later cleanup is separate authorized
work requiring retained-coverage review and focused validation.
