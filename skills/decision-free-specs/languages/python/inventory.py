#!/usr/bin/env python3
"""Symbol-level inventory of Python files, for writing decision-free refactor specs.

Usage (from the TARGET repo's root):
    python3 <path-to-skill>/languages/python/inventory.py <file.py> [...]

Output: markdown to stdout, per the contract in languages/README.md.
Stdlib only (ast); no dependencies.
"""

import ast
import re
import subprocess
import sys
from pathlib import Path


def list_source_files():
    try:
        out = subprocess.run(
            ["git", "ls-files", "*.py"], capture_output=True, text=True, check=True
        ).stdout
        return [line for line in out.splitlines() if line]
    except Exception:
        return [str(p) for p in Path(".").rglob("*.py") if "node_modules" not in p.parts and not any(part.startswith(".") for part in p.parts)]


def exported_name(name, dunder_all):
    if dunder_all is not None:
        return name in dunder_all
    return not name.startswith("_")


def read_dunder_all(tree):
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "__all__":
                    try:
                        return [elt.value for elt in node.value.elts if isinstance(elt, ast.Constant)]
                    except AttributeError:
                        return None
    return None


def decorators_of(node):
    return [ast.unparse(d) for d in getattr(node, "decorator_list", [])]


def describe(tree, dunder_all):
    rows = []
    for node in tree.body:
        span = f"{node.lineno}-{node.end_lineno}"
        if isinstance(node, ast.ClassDef):
            rows.append(("class", node.name, span, exported_name(node.name, dunder_all), node))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            rows.append(("function", node.name, span, exported_name(node.name, dunder_all), node))
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    rows.append(("const", target.id, span, exported_name(target.id, dunder_all), node))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            rows.append(("const", node.target.id, span, exported_name(node.target.id, dunder_all), node))
        elif hasattr(ast, "TypeAlias") and isinstance(node, ast.TypeAlias):
            rows.append(("type", ast.unparse(node.name), span, True, node))
    return rows


def dynamic_access(tree):
    """Flag dynamic symbol access — the grep-invisible trap in Python."""
    hits = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ("getattr", "globals", "vars", "__import__"):
            hits.append((node.lineno, ast.unparse(node)[:120]))
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "import_module":
            hits.append((node.lineno, ast.unparse(node)[:120]))
    return hits


def importers_of(target_file, all_files):
    stem = Path(target_file).stem
    if stem == "__init__":
        stem = Path(target_file).parent.name
    hits = []
    from_re = re.compile(rf"^\s*from\s+[\w.]*\b{re.escape(stem)}\b\s+import\s+(.+)$", re.M)
    import_re = re.compile(rf"^\s*import\s+[\w.]*\b{re.escape(stem)}\b", re.M)
    for f in all_files:
        if Path(f).resolve() == Path(target_file).resolve():
            continue
        try:
            text = Path(f).read_text(encoding="utf-8")
        except Exception:
            continue
        for m in from_re.finditer(text):
            hits.append((f, m.group(1).strip()[:100]))
        if import_re.search(text) and not any(h[0] == f for h in hits):
            hits.append((f, "(module import)"))
    return hits


def main():
    files = sys.argv[1:]
    if not files:
        print("usage: inventory.py <file.py> [...]   (run from the target repo root)", file=sys.stderr)
        sys.exit(1)
    all_files = list_source_files()

    for file in files:
        text = Path(file).read_text(encoding="utf-8")
        tree = ast.parse(text, filename=file)
        dunder_all = read_dunder_all(tree)

        print(f"# Inventory: {file}\n")
        print(f"Total lines: {len(text.splitlines())}\n")

        print("## Imports\n")
        for node in tree.body:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                print(f"- `{ast.unparse(node)}`")

        print("\n## Top-level declarations (in order)\n")
        print("| Kind | Name | Lines | Exported |")
        print("|---|---|---|---|")
        rows = describe(tree, dunder_all)
        for kind, name, span, exported, _node in rows:
            print(f"| {kind} | `{name}` | {span} | {'yes' if exported else 'no'} |")

        if dunder_all is not None:
            print(f"\n## `__all__`\n\n`{dunder_all}` — exported means listed here.")

        for kind, name, _span, _exported, node in rows:
            if kind == "class":
                methods = [n.name for n in node.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
                if methods:
                    print(f"\n### Methods in `{name}`\n")
                    for m in methods:
                        print(f"- {m}")
            decs = decorators_of(node) if kind in ("class", "function") else []
            if decs:
                print(f"\n### Decorators on `{name}`\n")
                for d in decs:
                    print(f"- `@{d}` (may register the symbol by module path — see NOTES.md)")

        dyn = dynamic_access(tree)
        print("\n## Dynamic symbol access (grep-invisible — verify before moving)\n")
        if not dyn:
            print("(none)")
        for line, snippet in dyn:
            print(f"- L{line}: `{snippet}`")

        importers = importers_of(file, all_files)
        print("\n## Imported by (load-bearing exports — keep compatible)\n")
        if not importers:
            print("(no other source file imports this module)")
        for f, names in importers:
            print(f"- `{f}` imports: {names}")

        print("\n---\n")


if __name__ == "__main__":
    main()
