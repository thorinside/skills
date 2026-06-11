---
name: decision-free-specs
description: Write decision-free refactor specs/plans that a local small model (e.g. Qwen3.6-27B) can execute mechanically. Use when asked to plan a refactor for small-model execution, "make specs for X", or to set up/extend a specs/ program in a repo. Runs a deterministic AST inventory script instead of spending tokens reading files.
---

# Decision-free refactor specs

Produce `specs/<target>/spec.md` + `plan.md` pairs that a ~27B local model executes
with **zero architectural decisions**. The expensive part of planning — knowing
exactly what is in each file — is a script, not a reading job. The planning model
(you) spends tokens only on judgment: pattern choice, props tables, trap-spotting.

## Step 0 — program bootstrap (first use in a repo only)

If the repo has no `specs/README.md` + `specs/conventions.md`, create them from
`templates/program-readme-example.md` and `templates/conventions-example.md` in this
skill, adapting: the verification commands (build/lint/test invocations for THIS
repo), the import-path table, and the executor prompt template's repo root. The
program README owns the executor contract (prompt template, sampling settings,
one-step-per-session rule, failure protocol) — per-spec folders never restate it.

## Step 1 — inventory by script (do NOT read the files first)

From the target repo's root:

```bash
node <this-skill>/scripts/inventory.mjs <file.tsx> [...] > /tmp/inventory.md
```

Per file it emits: imports, every top-level declaration (kind/name/lines/exported,
React components detected via JSX nodes in the AST), hooks per component, `client.*`
API calls, EventSource usage, dynamic classNames (the grep-invisible `badge-${x}`
trap), and — critically — **which other files import the module and what names they
import** (load-bearing exports that need compatibility re-exports; in the first run
of this workflow, this is how a test file importing three helpers was caught).

Only read source directly for the specific JSX blocks you intend to extract into
components (to write accurate props tables) — never for symbol discovery.

## Step 2 — decide the architecture (this is YOUR job, record every decision)

Pattern menu, in order of preference:

1. **Model extraction** (always): pure types/constants/helpers → `<target>/model.ts`.
2. **Leaf component moves**: nested function components → own files. Verbatim.
3. **JSX block extraction** (drawers/panels): only with a full props table; a
   tsc-driven recovery rule ("add the prop tsc names, with the type it reports")
   covers misses mechanically.
4. **Strategy registry**: ONLY for ≥2-way *behavioral* variance (different fields,
   different validation, different request bodies). Badge colors and labels are NOT
   behavioral variance.
5. **Shared extraction**: if the inventory shows the same symbol duplicated across
   files, dedupe it in the FIRST plan that runs and mark the dependency in the
   program table.

Record negative decisions explicitly in spec.md ("No Strategy registry — X is the
only variance; do not create one", "drawers stay inline by decision"). An unrecorded
non-decision is a decision the executor will make badly.

## Step 3 — write the documents

Per target folder:

- **spec.md**: source file + size, pattern + why, target file tree, **exhaustive
  symbol map table** (symbol → destination → exported), props tables for any JSX
  extraction, dependency notes (exact import paths), acceptance criteria. If the
  inventory's "Imported by" section is non-empty for moved exports, specify a
  compatibility re-export and name the importer.
- **plan.md**: prerequisites (cross-plan dependencies by name + step), numbered
  steps each small enough for one fresh-context session, exact commit message per
  step. Steps only state what differs from the repo's `specs/conventions.md`.

Hard rules learned in production:

- Order steps: pure moves first, component moves second, JSX extraction last —
  every step independently committable, repo green between steps.
- Anchor on **symbol names**, never line numbers (they drift).
- Every "if X then ask/choose" in a draft plan is a bug. Replace it with either a
  decision made now, or a mechanical rule ("copy version A and report the
  difference — do not reconcile").
- Verification gates per step come from the repo's conventions (format → typecheck/
  build → any co-located tests). If the target has a co-located test file, name it
  in the plan — its imports are exactly the compatibility surface.

## Step 4 — update the program and commit

1. Add rows to the program README's table (size, difficulty, dependencies).
2. Spot-check load-bearing claims the specs rely on (duplicated symbols, importer
   lists) — the script reports them, but confirm anything a plan's correctness
   hinges on.
3. Commit per the repo's conventions.

## Executor settings (defaults; the program README is authoritative per repo)

Target class: local ~27B instruct model (Qwen3.6-27B preferred for agentic-coding
strength). Temperature 0.2, top_p 0.9 — mechanical edits want determinism. One step
per fresh-context session. Two failures on a step → reset the working tree, report
FAILED with the error, stop. Never improvise around a failing step.
