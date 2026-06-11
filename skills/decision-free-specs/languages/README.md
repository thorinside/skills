# Language plug-ins

The decision-free-specs workflow is language-agnostic; everything language-specific
lives here, one directory per language. Each language provides:

1. **An inventory script** that satisfies the output contract below.
2. **`NOTES.md`** — language-specific planning knowledge: extraction procedures,
   compiler-driven recovery rules, traps, typical verification commands.

| Language | Status | Inventory script | Notes |
|---|---|---|---|
| TypeScript / TSX | ✅ available | `typescript/inventory.mjs` (TS compiler AST) | `typescript/NOTES.md` |
| Python | ✅ available | `python/inventory.py` (stdlib `ast`) | `python/NOTES.md` |
| Rust | ✅ available | `rust/inventory.py` (depth-0 scanner; `cargo check` is ground truth) | `rust/NOTES.md` |
| Flutter / Dart | ✅ available | `dart/inventory.py` (depth-0 scanner; `dart analyze` is ground truth) | `dart/NOTES.md` |

Each language directory includes `fixtures/` (a sample file with a known inventory
plus `expected.md`). To re-validate after changing a script:
`cd <lang>/fixtures && python3 ../inventory.py sample.<ext> | diff - expected.md`
(TypeScript: run `node ../inventory.mjs` from a repo with typescript installed.)

## Inventory output contract

An inventory script takes file paths as arguments, runs **from the target repo's
root**, uses **no dependencies beyond what the target repo already has** (or the
language's stdlib), and prints markdown to stdout with these sections per file:

```markdown
# Inventory: <path>

Total lines: <n>

## Imports
- one bullet per import statement, verbatim (collapsed whitespace)

## Top-level declarations (in order)
| Kind | Name | Lines | Exported |
(kinds: type, const, function, class, component/widget — whatever the language's
units are; "Exported" means visible outside the file/module)

## <language-specific signal sections>
(e.g. hooks per component, API call sites, dynamic string-built identifiers —
anything a refactor plan must know that a grep would miss)

## Imported by (load-bearing exports — keep compatible)
- `<file>` imports: <names>
(every other file in the repo that imports this module, with the imported names —
this is what catches test files and cross-module consumers)
```

The two sections that have caught real bugs and are non-negotiable: the exhaustive
**declarations table** (the spec's symbol map is derived from it) and **Imported by**
(compatibility re-exports are derived from it).

## Adding a language

1. Create `<lang>/inventory.<ext>` meeting the contract. Validate it the way the
   TypeScript one was validated: run it on a file you have hand-inventoried and
   diff the symbol tables. Write it against a real refactor target, not
   speculatively.
2. Write `<lang>/NOTES.md`: how to move a symbol in this language, the
   compiler/linter-driven recovery rule (what command surfaces missed references,
   and the mechanical fix), language traps (dynamic identifiers, re-export
   patterns, macro-generated symbols), and typical per-step verification commands.
3. Add the row to the table above and bump the plugin version.
