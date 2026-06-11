# Dart / Flutter language notes

## Running the inventory

```bash
python3 <this-skill>/languages/dart/inventory.py <file.dart> [...] > /tmp/inventory.md
```

Depth-0 structural scanner (brace tracking), reliable on `dart format`-ed code.
It classifies widgets (stateless/stateful/State/Consumer/Hook) from `extends`
clauses and flags `part`/codegen signals. `dart analyze` is the ground truth;
validated against the included fixture — hand-check one real file on first
production use.

## Moving a symbol

Cut the declaration (with annotations and doc comments), paste unchanged, fix
imports. Compatibility re-export at the old path: `export 'new_file.dart' show
Name;` — existing `import` lines keep working. If the package has a barrel file
(`lib/<package>.dart` exporting the API), update it in the same step.

**Recovery rule (mechanical):** `dart analyze` (or `flutter analyze`). "Undefined
name 'X'" / "URI doesn't exist" names exactly the missing import — add it. Two
failures → reset, report, stop.

## Traps

- **`part` / `part of` files are one library.** Symbols in part files share
  privacy and may not be split apart independently — a part file cannot be moved
  without restructuring the whole library. The inventory flags part directives;
  any plan touching a library with parts must treat the library, not the file, as
  the unit.
- **Privacy is per-library, not per-class**: `_name` symbols are visible across
  the whole file (and its parts). Moving a public class that uses file-private
  helpers means those helpers move too, or get promoted — the spec must list them
  explicitly (the inventory's declarations table shows the `_` names).
- **Stateful pairs move together**: a `StatefulWidget` and its `State<...>` class
  are one unit. The inventory labels both; plans must always move them in the
  same step.
- **Generated files** (`*.g.dart`, `*.freezed.dart`): never edit by hand. Moving
  an annotated class means re-running codegen
  (`dart run build_runner build --delete-conflicting-outputs`) is part of the
  step's procedure, and the generated file moves by regeneration, not by edit.
- **String-built routes/keys**: `Navigator.pushNamed(context, '/detail')`,
  `ValueKey('$prefix-$id')` — grep finds the literals but not constructed ones;
  treat route tables like the TS dynamic-className trap.
- **`const` constructors**: changing file location never breaks constness, but
  "improving" a constructor during a move can — verbatim rule covers this; do not
  add or remove `const`.

## Typical verification gates

```bash
dart format .
dart analyze           # MUST be clean — this is "✓ built"
dart run build_runner build --delete-conflicting-outputs   # only if codegen files were involved
flutter test <co-located test>   # test imports are the compatibility surface
```
