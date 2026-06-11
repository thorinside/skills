# Inventory: sample.rs

Total lines: 62

## Imports

- `use std::collections::HashMap;`
- `use std::fmt;`

## Top-level declarations (in order)

| Kind | Name | Lines | Exported |
|---|---|---|---|
| const | `PAGE_SIZE` | 6-6 | yes |
| static | `CACHE_DIR` | 7-7 | no |
| type | `WidgetId` | 9-9 | yes |
| struct | `Widget` | 12-15 | yes |
| enum | `WidgetError` | 18-21 | yes |
| trait | `Sizable` | 23-28 | yes |
| impl | `impl Sizable for Widget` | 30-34 | no |
| impl | `impl fmt::Display for Widget` | 36-40 | no |
| fn | `load_widget` | 43-45 | yes |
| fn | `build_cache` | 47-49 | no |
| macro_rules | `widget_of` | 52-56 | no |
| mod | `helpers` | 58-62 | pub(crate) |

### Attributes on `Widget`

- `#[derive(Debug, Clone)]`

### Attributes on `WidgetError`

- `#[derive(Debug)]`

### Methods in `Sizable` (trait)

- area
- label

### Methods in `impl Sizable for Widget` (impl)

- area

### Methods in `impl fmt::Display for Widget` (impl)

- fmt

### Attributes on `load_widget`

- `#[cfg(feature = "fast")]` — cfg-gated: may exist only under some features

### Attributes on `widget_of`

- `#[macro_export]`

### Methods in `helpers` (mod)

- normalize

## Imported by (load-bearing exports — keep compatible)

(no other source file references this module)

---

