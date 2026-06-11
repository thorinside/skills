# Inventory: sample.py

Total lines: 49

## Imports

- `import json`
- `import os`
- `from dataclasses import dataclass`
- `from functools import lru_cache`

## Top-level declarations (in order)

| Kind | Name | Lines | Exported |
|---|---|---|---|
| const | `__all__` | 8-8 | no |
| const | `PAGE_SIZE` | 10-10 | yes |
| const | `_CACHE_DIR` | 11-11 | no |
| type | `WidgetId` | 13-13 | yes |
| class | `WidgetError` | 16-17 | yes |
| class | `Widget` | 21-30 | yes |
| class | `_Internal` | 33-35 | no |
| function | `load_widget` | 39-41 | yes |
| function | `_resolve` | 44-45 | no |
| function | `_refresh` | 48-49 | no |

## `__all__`

`['PAGE_SIZE', 'Widget', 'load_widget', 'WidgetError']` — exported means listed here.

### Methods in `Widget`

- area
- _validate

### Decorators on `Widget`

- `@dataclass` (may register the symbol by module path — see NOTES.md)

### Methods in `_Internal`

- helper

### Decorators on `load_widget`

- `@lru_cache(maxsize=128)` (may register the symbol by module path — see NOTES.md)

## Dynamic symbol access (grep-invisible — verify before moving)

- L45: `getattr(json, name)`

## Imported by (load-bearing exports — keep compatible)

(no other source file imports this module)

---

