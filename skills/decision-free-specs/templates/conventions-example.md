> **Worked example** from the substrate repo's UI refactor program (the first
> production run of this workflow). Adapt repo-specific parts: paths, verification
> commands, import tables, executor prompt repo root.

# Conventions for all UI refactor steps

Read this once per step. Every plan assumes these rules; plans only state what
differs from them.

## Golden rules

1. **Move code verbatim.** Cut the named symbol (its full declaration, including any
   JSDoc comment directly above it) from the source file and paste it unchanged into
   the target file. Do not rename, reorder parameters, change quotes, rewrap lines,
   or "clean up" anything.
2. **Touch only the files the step names.** Never edit `index.css`, `App.tsx`,
   `openapi.yaml`, or anything under `services/` unless the step says so.
3. **Do not change behavior.** Same JSX structure, same classNames, same strings,
   same API calls. If a change feels like an improvement, it is out of scope.
4. **Indentation is tabs**, matching the existing files. `npm run lint:fix` will
   normalize formatting — run it before verifying.
5. **One step, one commit**, with the exact commit message the step provides, plus
   this trailer line:
   `Co-Authored-By: Qwen3.6-27B (plan: Claude Fable 5) <noreply@anthropic.com>`

## How to move a symbol

1. In the target file, add the pasted declaration and prefix `export ` if the plan's
   symbol table marks it exported (almost all are).
2. In the source file, delete the original declaration.
3. In the source file, add the import from the new module (see import paths below).
4. Move any imports the symbol needs (e.g. a moved function using `formatRelative`
   means the target file imports `formatRelative` from `"../../util"`). The compiler
   will tell you exactly which ones you missed.

## Import paths

From `packages/ui/src/components/<view>/<file>.tsx` (one level deeper than today):

| Need | Import path |
|---|---|
| API schema types | `import type { components } from "../../api/schema";` |
| Client type | `import type { Client } from "../../api/client";` |
| util helpers | `from "../../util"` |
| Drawer / IdCell / SortableHeader / TraceView / ArtifactContentView | `from "../Drawer"` etc. (one `..`) |
| Sibling files in the same view folder | `from "./model"` etc. |

From the view file itself (`packages/ui/src/components/XView.tsx`), new modules are
`from "./<view>/model"` etc.

## How to extract a JSX block into a component

Plans specify: the start marker (a unique line in the view file), the end of the
block (its matching closing brace/paren), the new component name + file, and the
**props table**. Procedure:

1. Create the new file with a function component whose props are exactly the props
   table. Paste the JSX block as its return value (drop the outer `{condition && (...)}`
   wrapper — the condition stays in the view file).
2. In the view, replace the block with `<NewComponent ...props />` passing the values
   named in the props table, keeping the same surrounding condition.
3. **Recovery rule:** if `tsc` reports `Cannot find name 'X'` inside the new file,
   `X` is a variable the block referenced that the props table missed. Add `X` to the
   props with the type tsc expects, and pass it from the view. This is mechanical —
   do not restructure to avoid it. (Handlers keep their names: a view function
   `remove` becomes prop `onRemove` only if the props table says so; otherwise pass
   it under the same name.)

## Verification (every step, in this order)

```bash
cd <REPO_ROOT>
npm run lint:fix        # auto-format; should end "Found 3 warnings." or fewer messages
npm run build -w packages/ui   # MUST print "✓ built". Any TS error = step not done.
git add -A && git status --short   # only files the step names may appear
```

If the view you are editing has a co-located test file
(`packages/ui/src/components/<View>.test.ts` — currently true for ArtifactsView),
ALSO run:

```bash
npx vitest run packages/ui/src/components/<View>.test.ts   # MUST report all passed
```

Expected lint state: exactly 3 pre-existing warnings, all in `ChatView.tsx`
(`suppressions/unused`). Any new warning or error in another file means you changed
something you shouldn't have.

## Failure handling

- First failure: read the compiler error, apply the recovery rule above or fix the
  missing import. Re-verify.
- Second failure on the same step: run `git checkout -- packages/ui/src` (this resets
  all source edits), report `FAILED` with the full error text, and stop. A human (or
  a larger model) will adjust the plan. Never improvise around a failing step.

## What "exported" means in symbol tables

All symbols moved to `model.ts`-style files are exported unless the table says
`(local)`. Symbols that were module-local in the view keep working because the view
now imports them.
