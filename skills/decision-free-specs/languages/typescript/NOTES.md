# TypeScript / TSX language notes

## Running the inventory

```bash
node <this-skill>/languages/typescript/inventory.mjs <file.tsx> [...] > /tmp/inventory.md
```

Run from the target repo's root; it resolves `typescript` from the target repo and
scans importers via `git ls-files "*.ts" "*.tsx"`. Components are detected by JSX
nodes in the AST (not naming heuristics); hooks, `client.*` API calls, EventSource
usage, and dynamic classNames are reported per file.

## Moving a symbol

Cut the full declaration (with any JSDoc directly above), paste unchanged, prefix
`export ` if the symbol map says exported, add the import in the source file, and
move any imports the symbol needs. The compiler lists exactly what you missed.

## Extracting a JSX block into a component

Plans specify: a start marker line, the matching closing brace/paren, the new
component name + file, and a **props table**. Drop the outer `{condition && (...)}`
wrapper — the condition stays at the call site.

**Recovery rule (mechanical, not a judgment):** if `tsc` reports
`Cannot find name 'X'` inside the new file, `X` is a variable the props table
missed. Add it to the props with the type tsc expects and pass it from the caller.
Never restructure to avoid it.

## Traps

- **Dynamic identifiers**: class names built in template literals
  (`badge-${status}`, `scope-${scope}`) are invisible to grep. Never delete
  "unused-looking" CSS or rename a variant value without checking the inventory's
  dynamic-classNames section.
- **Already-exported symbols**: if "Imported by" lists consumers (especially
  `*.test.ts`), the plan must add a compatibility re-export from the original
  module path, and the consumer's test run becomes a verification gate.
- **Type-only vs value imports**: keep `import type` as the original had it;
  formatters (Biome) will sort/normalize — run the repo's format-fix before
  verifying.
- **Barrel files / index re-exports**: if the repo uses them, moved symbols may
  need the barrel updated too; the importer scan reveals this.

## Typical verification gates (adapt to the repo's conventions doc)

```bash
<format-fix>                 # e.g. npm run lint:fix (Biome) — normalize first
<typecheck-or-build>         # e.g. npx tsc --noEmit -p <tsconfig> or the build script
<co-located tests if any>    # e.g. npx vitest run <View>.test.ts
```

A TS step is done only when the typecheck/build is clean — "it looks moved" is not
done.
