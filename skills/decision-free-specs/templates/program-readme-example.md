> **Worked example** from the substrate repo's UI refactor program (the first
> production run of this workflow). Adapt repo-specific parts: paths, verification
> commands, import tables, executor prompt repo root.

# UI View Refactor Program

> To extend this program (new targets, new spec folders), use the
> `decision-free-specs` skill (`.claude/skills/decision-free-specs/`). Its
> inventory script replaces the expensive file-reading step:
> `node .claude/skills/decision-free-specs/scripts/inventory.mjs <files…>`

Decision-free refactor specs for the remaining UI views, modeled on the completed
ServicesView refactor (commit `b830740`, see `packages/ui/src/components/services/`).
Each view folder contains a `spec.md` (target architecture — already decided) and a
`plan.md` (ordered mechanical steps). The executing model makes **zero architectural
decisions**: every file path, symbol move, prop interface, and commit message is
specified. Where something unexpected appears, the plans give a mechanical recovery
rule instead of asking for judgment.

## Target model: Qwen3.6-27B

Chosen over Gemma 4 31B. Rationale, from the model documentation:

- Qwen3.6's headline capability is **agentic coding** — repository-level editing with
  bash + file-edit tools is what the series is optimized and evaluated for (SWE-bench
  with an agent scaffold). This program is exactly that workload.
- 262K native context — far more than any step here needs (each step's working set is
  kept under ~16K tokens by design; do not feed the whole repo).
- Gemma 4 31B is a strong generalist (256K context, native system role, optional
  `<|think|>` reasoning) but its documentation emphasizes general reasoning and vision;
  Qwen's emphasizes precisely this task shape.
- Note: there is no open-weight "Qwen3.6 28B"; the dense model in that class is
  **Qwen3.6-27B**. Use the instruct variant.

### Runtime settings (llama.cpp)

- Temperature **0.2**, top_p 0.9 for these steps. (Qwen's own agentic evals use
  1.0/0.95, but every step here is mechanical code movement — determinism beats
  creativity. If the model stalls or loops, raise temperature to 0.6, never above.)
- Context: 32K is sufficient per step. Do not paste files the step doesn't name.
- One step per conversation. Start each step with a fresh context.

### Prompt template (per step)

```text
SYSTEM:
You are a code-refactoring executor working in the target repository.
You follow written plans exactly. You never redesign, rename, reorder, or
"improve" anything. You move code verbatim. When a plan and your instinct
disagree, the plan wins. When verification fails, you follow the plan's
recovery rule; if still failing after two attempts, you run
`git checkout -- packages/ui/src` and report FAILED with the error text.

USER:
Repository root: <REPO_ROOT>
Read these two files completely before doing anything:
  specs/conventions.md
  specs/<VIEW-FOLDER>/plan.md
That plan has <M> steps. Execute STEP <N> of <M>, alone. Do not start any
other step, and do not touch code that a different step names. Completing
this step does NOT complete the plan unless <N> = <M>.
When done, run the verification commands from conventions.md, then commit
with the exact message given in the step. Report: PASS or FAILED + output.
```

## Execution order

Easiest first — early wins validate the workflow before the hard ones. Within a view,
steps must run in order. Across views, the only hard dependency is marked.

| # | Folder | Size today | Difficulty | Depends on |
|---|--------|-----------|------------|------------|
| 1 | `memory-view/` | 305 lines | easy | — |
| 2 | `sessions-view/` | 337 lines | easy | — |
| 3 | `workflows-view/` | 373 lines | easy | — |
| 4 | `jobs-view/` | 597 lines | medium | — (creates shared `harness.ts`) |
| 5 | `tasks-view/` | 405 lines | easy | **jobs-view step 1** (uses `harness.ts`) |
| 6 | `triggers-view/` | 618 lines | medium | — (creates shared `Toggle.tsx`) |
| 7 | `schedules-view/` | 783 lines | medium | **triggers-view step 1** (uses `Toggle.tsx`) |
| 8 | `knowledge-graph-view/` | 691 lines | medium | — |
| 9 | `skills-view/` | 849 lines | hard | — |
| 10 | `artifacts-view/` | 883 lines | hard | — |

## Views deliberately left alone (decision already made — do not refactor)

- `RunnersView.tsx` (175 lines) — already at target size, single concern.
- `KnowledgeServiceView.tsx` (218 lines) — already small; its two pure helpers move
  as part of `knowledge-graph-view/` only if named there, otherwise stay.
- `ChatView.tsx` / `ChatDrawer.tsx` — recently rewritten; out of scope.
- `ServicesView` — done (the reference implementation).

## Architecture patterns used (decided per view, recorded in each spec.md)

- **Model extraction** (every view): pure types/constants/helpers → `model.ts`.
  Zero-risk verbatim moves.
- **Leaf component extraction** (most views): nested function components → own files.
- **Strategy registry** (only `schedules-view`): schedules branch on
  `targetType: "service" | "workflow"` — a two-entry descriptor table, same shape as
  `services/descriptors/`. No other view has enough variance to justify a registry;
  the specs say so explicitly so the executor does not invent one.

## What done looks like

All steps of a view committed, `npm run build -w packages/ui` prints `✓ built`,
`npm run lint` reports only the 3 pre-existing ChatView warnings, and the view file
itself contains only: state, API calls, filtering/sorting wiring, and JSX composition
of the extracted parts.

## Completion audit (run by the planning model, not the executor)

The plans' exact commit messages are the completion manifest. "All tasks done"
is verified, never reported:

```bash
grep -A2 "Commit message" specs/*/plan.md   # expected — one commit each
git log --format=%s <baseline>..HEAD        # actual
```

Every expected message must appear exactly once. A missing message is a skipped
step; two steps' work under one message means the squashed step's verification
gates never ran — re-run them by hand. Finish with one program-level pass of the
full verification suite, including any test files near refactored code that the
per-step gates didn't name.
