# Rust language notes

## Running the inventory

```bash
python3 <this-skill>/languages/rust/inventory.py <file.rs> [...] > /tmp/inventory.md
```

This is a depth-0 structural scanner (brace tracking), not a real parser — chosen
so it needs no toolchain build. It is reliable on `rustfmt`-ed code. Known limits:
items generated *by* macros are invisible; pathological string literals containing
unbalanced braces can skew spans. `cargo check` is the ground truth; validated
against the included fixture — hand-check one real file on first production use.

## Moving a symbol

Cut the item with its attributes (`#[derive…]`, `#[cfg…]`, doc comments), paste
unchanged into the new module, add `use` imports it needs. At the old location add
the idiomatic compatibility shim: `pub use crate::new_module::Item;` — callers and
`use` paths keep working. Register new files with `mod new_module;` in the parent
(the inventory's "mod declaration — module registration site" line shows where).

**Recovery rule (mechanical):** `cargo check`. `E0432`/`E0425`/`E0412` name exactly
the unresolved import/value/type — add the `use` line it suggests (cargo usually
prints the correct one). Two failures → reset, report, stop.

## Traps

- **`#[cfg(...)]` items**: the same name may be defined twice under different
  features. The inventory flags cfg attributes; a plan moving a cfg-gated item must
  move ALL cfg variants together and state the feature names.
- **`#[macro_export]` macros** export at the *crate root*, not the module path.
  Moving one changes nothing for consumers — but moving a non-exported
  `macro_rules!` breaks textual-order visibility within the crate; keep
  `macro_use`/ordering identical or re-export with `pub use`.
- **Trait method resolution**: calling `x.method()` requires the trait in scope.
  Moving a trait means consumers' `use` lines must be updated — the importer scan
  lists them; the plan must enumerate each.
- **Orphan rule**: an `impl Trait for Type` can only move to a module in the same
  crate; never plan to move impls across crates.
- **Visibility levels**: `pub(crate)` / `pub(super)` change meaning when the item
  moves deeper or shallower in the module tree. The plan must state the exact
  visibility to write at the destination — do not let the executor guess.
- **`mod.rs` vs `name.rs` layout**: copy whichever convention the crate already
  uses; mixing them is a review smell.

## Typical verification gates

```bash
cargo fmt
cargo check            # MUST be clean — this is "✓ built"
cargo clippy -- -D warnings   # if the repo gates on clippy
cargo test <module>    # co-located tests; their `use` lines are the
                       # compatibility surface
```

## Leftover-declaration check (per moved symbol)

After a move step, each moved symbol must have NO remaining declaration in the
source file:

```bash
grep -nE "^\s*(pub(\([a-z:]+\))?\s+)?(async\s+)?(fn|struct|enum|trait|type|const|static|mod|impl)\s+<SYMBOL>\b" <SOURCE_FILE>
```

Empty output for every symbol = pass (`use` lines won't match). Plans should
state the symbol count so the executor can tally the new module against it.
