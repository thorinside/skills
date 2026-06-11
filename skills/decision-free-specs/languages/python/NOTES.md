# Python language notes

## Running the inventory

```bash
python3 <this-skill>/languages/python/inventory.py <file.py> [...] > /tmp/inventory.md
```

Stdlib `ast` — a real parse, same fidelity class as the TypeScript plug-in.
Validated against the included fixture and a CPython stdlib module; before the
first production use on a new codebase, hand-check one real file against the
output.

## Moving a symbol

Cut the full declaration (with decorators and the docstring), paste unchanged, add
imports the symbol needs in the new module, import it back in the old module if
anything there still uses it. If the old module has `__all__`, keep the name listed
and re-export: `from .newmodule import name` — that is the compatibility re-export
(consumers and `from x import *` keep working).

**Recovery rule (mechanical):** run the repo's type checker (`mypy`/`pyright`) or,
minimally, `python3 -c "import <package.module>"` for both old and new modules.
`NameError`/`ImportError` names the missing import — add it. Never restructure.

## Traps

- **Circular imports** — the Python-specific killer. Moving a symbol can create a
  cycle that only fails at import time, not in any linter. Plans must order moves
  so the model module never imports from the view/handler module (one-directional,
  same rule as the TS programs). If a cycle is unavoidable, the plan must say
  "import inside the function body" explicitly — the executor must not invent it.
- **Decorator registration by location**: `@app.route`, `@click.command`,
  `@pytest.fixture`, plugin registries — the decorator runs where the module is
  imported. Moving the function moves the registration; the old module may need to
  import the new one for side effects. The inventory lists decorators per symbol;
  any registration-style decorator must be called out in the spec.
- **Dynamic access**: `getattr(module, name)`, `globals()[name]`,
  `importlib.import_module(f"...")` — grep-invisible. The inventory flags these;
  never rename/move a symbol consumed dynamically without specifying the string
  update too.
- **Pickle / serialization paths**: pickled objects store `module.Class` paths.
  If the repo pickles (celery, caches), moved classes need a compatibility import
  at the old path permanently, not temporarily.
- **`__init__.py` re-export conventions**: if the package exposes its API via
  `__init__.py`, that file is the compatibility surface — update it in the same
  step as the move.
- **Relative vs absolute imports**: copy whichever style the file already uses.

## Typical verification gates (adapt to the repo's conventions doc)

```bash
<format-fix>          # e.g. ruff format / black
<lint>                # e.g. ruff check
<typecheck>           # e.g. mypy <package> or pyright
<tests>               # pytest <co-located test file> — test imports are the
                      # compatibility surface, same as TS
```

If the repo has no type checker, the import smoke (`python3 -c "import …"`) for
every touched module is the minimum gate — Python will not tell you otherwise
until runtime.
