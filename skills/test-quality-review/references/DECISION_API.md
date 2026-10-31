# System-one decision API workflow

A system-one decision API is any available tool or service that chooses categories
against supplied criteria. Use its native interface through whatever callable
connection the agent has. This skill specifies evidence and reporting, not a
provider, model, transport or service registration format.

## Select and build

The optional helper needs Python 3.10+, independently of the language under review.
It uses only the standard library; installed `tiktoken` improves token estimates.
Run it from the target project using its absolute installed path. `--project`
can select a different target explicitly. Nothing is installed in the target.

Identify complete tests with source inspection or the project's existing tools.
Create a project-local selection JSON array, using inclusive, 1-based line ranges:

```json
[
  {
    "file": "path/to/test-file",
    "title": "the selected test's name",
    "startLine": 80,
    "endLine": 96,
    "loopBindings": []
  }
]
```

Include enclosing parameter bindings as source strings when relevant. The helper
preserves those ranges exactly; it does not parse syntax, prove completeness or
expand runtime cases. Inspect the body and enclosing setup before using it.

```sh
SKILL=/absolute/path/to/skills/test-quality-review
python3 -B "$SKILL/scripts/review.py" build \
  --selection .test-quality-review/selection.json \
  --decision-api "$DECISION_API_ID"
```

`DECISION_API_ID` is a stable, non-secret identifier for the selected callable
API/configuration. Include endpoint/model identity when needed to distinguish
configurations; use a fresh output directory if it changes. Omit it for offline
packet inspection. The default is one file and disposition only. Broader selection
requires `--allow-multiple-files`. Optional `--explain` uses all four rubric
questions; build that requested second pass in a separate `--out` directory.

Outputs default to `.test-quality-review` inside the target. The helper rejects
foreign-root manifests, source/output overlap and artifact/cache symlinks,
including dangling links and links into source. Writes use private staging files
and atomic replacement. Keep this directory private and project-specific.

## Decide and record

Inspect `manifest.json`: each row contains the exact `request`, test ID,
`requestHash`, source hash, included lines, omissions and blocked status. The API
sees only the test file, selected target and question criteria. Blocked rows stay
unresolved. If required setup is missing, use manual review or report the gap.

Inspect the available API's native schema and map the packet to it. Use the
caller's authorized API/configuration; respect its limits and source-processing
permissions. Work in bounded batches, resuming valid saved decisions rather than
repeating them. Allow for cold loading when applicable; operational deadlines are
not test-time waits. Do not invent endpoint details or substitute a different API.

Normalize the returned choice into this local interchange format, preserving its
meaning rather than asking the API to support a particular wire schema:

```json
{"disposition": "keep"}
```

For a requested full-question pass, also include categorical `protection` and
`weakness` from `scripts/questions.json`, plus boolean `contextAdequate`. An API
may answer these in one call or separate decisions. Optional `scores` contains
all three disposition probabilities when supplied by the API; omit it when not
available. Preserve raw replies privately and distinguish API output from the
agent's own assessment. A failed call is unresolved, not a fabricated decision.

Save the normalized JSON response locally, then bind it to the packet it answered:

```sh
python3 -B "$SKILL/scripts/review.py" record \
  --id "$TEST_ID" --request-hash "$REQUEST_HASH" \
  --decision-api "$DECISION_API_ID" \
  --response .test-quality-review/decision.json

python3 -B "$SKILL/scripts/review.py" report
```

The recorder validates categories, optional scores, API identity, request hash and
current source. Reports contain categorical outcomes and candidate body snapshots;
the invoking agent supplies the source-grounded explanation and retained-coverage
comparison. Missing, stale or malformed replies remain unresolved. Full-question
contradictions such as remove/no weakness are flagged. Reports accept embedded,
unbraced and overlapping ranges because they do not construct source edits.

## Budget and validation

`--max-tokens` defaults to 32768, including criteria, with 2048 tokens reserved for
native framing/output. Installed `tiktoken` uses the larger cl100k_base/o200k_base
estimate; neither is the selected API's exact tokenizer. Otherwise UTF-8 byte
counting supplies a conservative estimate. Native API limits remain authoritative.
Oversized file context is shortened at line boundaries with explicit omissions;
the selected body remains complete or the row is blocked.

Run the helper's own regressions from `scripts/`:

```sh
python3 -B -m unittest discover -p 'test_*.py'
```

These use disposable repositories and injected decisions, not live APIs or waits.
