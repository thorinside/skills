# Inventory: sample.go

Total lines: 69

## Package

- Name: `toolkit`
- Import path: `example.com/inventoryfixture`
- File role: production

## Imports

- `import ( "embed" "fmt" )`

## Top-level declarations (in order)

| Kind | Name | Lines | Exported |
|---|---|---|---|
| const | `Public` | 10-14 | yes |
| const | `private` | 10-14 | no |
| const | `_ (occurrence 1)` | 10-14 | no |
| const | `First` | 16-16 | yes |
| const | `Second` | 16-16 | yes |
| var | `Plain` | 18-18 | yes |
| var | `Initialized` | 20-20 | yes |
| var | `Left` | 22-22 | yes |
| var | `Right` | 22-22 | yes |
| var | `Asset` | 24-26 | yes |
| type | `State` | 28-29 | yes |
| type alias | `oldState` | 31-31 | no |
| type | `Box` | 33-35 | yes |
| type alias | `Boxes` | 37-37 | yes |
| type | `Pair` | 39-42 | yes |
| function | `Exported` | 44-47 | yes |
| function | `helper` | 49-49 | no |
| function | `init (occurrence 1)` | 51-53 | no |
| function | `init (occurrence 2)` | 55-57 | no |
| method | `(*Box[T]).Get` | 59-61 | yes |
| method | `(Pair[A, B]).Swap` | 63-65 | yes |
| const | `Δelta` | 67-67 | yes |
| var | `_ (occurrence 2)` | 69-69 | no |

## Go refactor signals

- L2: `//go:generate stringer -type State` — directive; preserve its attachment and semantics
- L10-14: const group `Public`, `private`, `_ (occurrence 1)` — move the whole declaration together
- L16: const spec `First`, `Second` — names share one declaration; move together
- L20: initialized var `Initialized` — package initialization order may be load-bearing
- L22: var spec `Left`, `Right` — names share one declaration; move together
- L22: initialized var `Left`, `Right` — package initialization order may be load-bearing
- L25: `//go:embed asset.txt` — directive; preserve its attachment and semantics
- L51-53: `init (occurrence 1)` — package initialization order is load-bearing
- L55-57: `init (occurrence 2)` — package initialization order is load-bearing

## Same-package references (conservative syntax scan)

- `sample_test.go` references: `Exported`, `helper`, `Asset`
- `sibling.go` references: `helper`, `Exported`, `Box`, `State`, `Plain`

## Imported by (load-bearing exports — keep compatible)

- `consumers/alias/alias.go` imports as `tk`; selectors: `Box`, `Public`
- `consumers/default/default.go` imports as `toolkit`; selectors: `Exported`, `State`, `Public`
- `consumers/dot/dot.go`: dot import; all exported names potentially load-bearing
- `consumers/sideeffect/sideeffect.go`: side-effect import; package initialization is load-bearing
- `sample_external_test.go` imports as `toolkit`; selectors: `Exported`, `Box`

---
