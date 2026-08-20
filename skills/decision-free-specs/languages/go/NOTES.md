# Go language notes

## Running the inventory

Run the tool from the target repository root. The `--` separator is required by
`go run` so target `.go` files are not treated as source files for the inventory
program:

```bash
go run <this-skill>/languages/go/inventory.go -- <file.go> [...] > /tmp/inventory.md
```

The inventory uses Go's standard-library AST and package metadata. Its
same-package reference list is a conservative syntax scan: local shadowing may
over-report references, so the compiler and tests are ground truth. The importer
selector scan can likewise over-report selectors through a locally shadowed import
qualifier and cannot attribute calls through imported receiver types. Importer
discovery fails on malformed import preambles. The only exception is an
empty/simulated non-source fixture with no lexical `package` or `import` token, or
a Go negative-parser fixture carrying an official `// ERROR ` / `/* ERROR ` marker
when exact byte and unquoted-string-token checks prove that the target import path
is absent; a malformed file that contains the target path always fails loudly.

## Moving to another file in the same package

- Preserve the package clause, declaration, documentation, directives, and grouped
  declaration verbatim. Move an entire grouped declaration together.
- Imports are file-scoped: add required imports to the destination and remove
  imports made unused in the source.
- Preserve, or explicitly redesign in the plan, build constraints and
  `GOOS`/`GOARCH` filename suffixes.
- Check initialized package variables and `init` ordering; their order may be
  load-bearing.
- No compatibility shim is required because package identity is unchanged.

## Moving to a new package

Treat a package move as architecture, not a mechanical file split:

- Prevent import cycles before specifying the move.
- Never capitalize an inaccessible dependency as an improvised fix.
- Preserve eligibility under Go's `internal/` import rules.
- A method's receiver base type must be defined in the same package. Move the
  defined type and all required methods together, or keep the method in place.
- Check both internal tests (`package p`) and external tests (`package p_test`).

Specify old-package compatibility for every moved symbol:

| Symbol | Old-package compatibility |
|---|---|
| Defined type | `type Old = newpkg.Type` preserves identity; methods remain with the defined type. |
| Type alias | Re-alias it; generic aliases require Go 1.24 language mode. |
| Constant | Use `const Old = newpkg.Value`. |
| Function | Write an exact-signature forwarding function; verify behavior and any stack/runtime identity-sensitive code. |
| Generic function | Forward with identical type parameters and constraints. |
| Sentinel error | `var ErrX = newpkg.ErrX` may preserve equality; prove it with tests. |
| Mutable variable | There is no safe ordinary alias: assignment creates distinct storage and copy semantics. Stop for an explicit design. |
| `init` | Cannot be forwarded. |
| Bodyless/assembly/cgo/linkname declaration | Keep coupled; do not wrap blindly. |

## Manual traps

The inventory does not claim to resolve these automatically. Inspect and specify
them explicitly:

- import cycles and `internal/` boundaries;
- initialization ordering across files and packages;
- build-tag variants and platform-specific filename variants;
- generated files and ownership by `go generate`;
- cgo preambles, assembly/bodyless declarations, embed paths, and linkname
  coupling;
- reflection via `MethodByName`/`FieldByName`, plugin lookup, gob registration,
  serialization, and reflected package identity;
- package import-path compatibility and consumers outside the repository.

## Mechanical recovery rule

Run affected-package tests first, then repository tests. Apply only missing/unused
import or qualification fixes already specified by the plan. Stop and report a
spec defect for an import cycle, inaccessible cross-package name, non-local
receiver, mutable-variable alias, build-context gap, initialization change, or
foreign/generated coupling. Do not improvise by exporting, duplicating, or
wrapping state.

## Typical verification gates

```bash
gofmt -w <touched-go-files>
go test <affected-package-patterns>
go test ./...
go vet ./...
```

Add the repository's existing linters and every required `GOOS`, `GOARCH`, and
`-tags` command. For a package move, tests must prove any promised sentinel-error
equality, forwarding behavior, and compatibility surface.

## Leftover-declaration check

Every move plan must state the exact moved-symbol count and verify that count at
the destination. Then regenerate the source inventory and assert that every moved
canonical inventory name is absent:

```bash
go run <skill>/languages/go/inventory.go -- <source.go> > /tmp/source.inventory.md
# Only after the inventory command succeeds:
! grep -F '| `<canonical inventory name>` |' /tmp/source.inventory.md
```

Run the assertion once per moved canonical name. An inventory failure is a failed
check, not evidence that the declaration is gone. The destination count and source
absence must both match the plan before the move step is complete.
