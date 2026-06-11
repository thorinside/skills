#!/usr/bin/env python3
"""Symbol-level inventory of Dart/Flutter files, for writing decision-free refactor specs.

Usage (from the TARGET repo's root):
    python3 <path-to-skill>/languages/dart/inventory.py <file.dart> [...]

Output: markdown to stdout, per the contract in languages/README.md.

Implementation note: depth-0 structural scanner (brace tracking + declaration
regexes), not a real Dart parser — dependency-free beats requiring a
package:analyzer tool build. Accurate for `dart format`-ed code; `dart analyze`
remains the ground truth and every plan's verification gate. Limits in NOTES.md.
"""

import re
import subprocess
import sys
from pathlib import Path

CLASS_RE = re.compile(
    r"^(?:abstract\s+|base\s+|final\s+|sealed\s+|interface\s+|mixin\s+)*class\s+(\w+)"
    r"(?:<[^>{]*>)?(?:\s+extends\s+([\w.]+(?:<[^>{]*>)?))?(?:\s+with\s+[\w<>, ]+)?(?:\s+implements\s+[\w<>, ]+)?\s*\{?"
)
MIXIN_RE = re.compile(r"^(?:base\s+)?mixin\s+(\w+)")
ENUM_RE = re.compile(r"^enum\s+(\w+)")
EXT_RE = re.compile(r"^extension\s+(\w+)?")
TYPEDEF_RE = re.compile(r"^typedef\s+(\w+)")
FN_RE = re.compile(r"^(?:Future<[^>]*>|Stream<[^>]*>|void|[A-Za-z_][\w<>, ?]*)\s+(\w+)\s*(?:<[^>]*>)?\s*\(")
VAR_RE = re.compile(r"^(?:const\s+|final\s+|var\s+|late\s+)+(?:[A-Za-z_][\w<>, ?]*\s+)?(\w+)\s*=")


def list_source_files():
    try:
        out = subprocess.run(
            ["git", "ls-files", "*.dart"], capture_output=True, text=True, check=True
        ).stdout
        return [line for line in out.splitlines() if line]
    except Exception:
        return [str(p) for p in Path(".").rglob("*.dart") if ".dart_tool" not in p.parts]


def widget_kind(extends_clause):
    if not extends_clause:
        return None
    base = extends_clause.strip()
    if base.startswith("StatelessWidget"):
        return "widget (stateless)"
    if base.startswith("StatefulWidget"):
        return "widget (stateful)"
    if base.startswith("State<"):
        return "state"
    if base.startswith(("ConsumerWidget", "ConsumerStatefulWidget", "HookWidget")):
        return f"widget ({base.split('<')[0]})"
    return None


def strip_comments(line, in_block):
    out = []
    i = 0
    in_str = None
    while i < len(line):
        two = line[i : i + 2]
        if in_block:
            if two == "*/":
                in_block = False
                i += 2
                continue
            i += 1
            continue
        if in_str:
            if line[i] == "\\":
                i += 2
                continue
            if line[i] == in_str:
                in_str = None
            i += 1
            continue
        if two == "//":
            break
        if two == "/*":
            in_block = True
            i += 2
            continue
        if line[i] in ("'", '"'):
            in_str = line[i]
            i += 1
            continue
        out.append(line[i])
        i += 1
    return "".join(out), in_block


def classify(stripped):
    m = CLASS_RE.match(stripped)
    if m:
        return widget_kind(m.group(2)) or "class", m.group(1)
    for regex, kind in ((MIXIN_RE, "mixin"), (ENUM_RE, "enum"), (TYPEDEF_RE, "type")):
        m = regex.match(stripped)
        if m:
            return kind, m.group(1)
    m = EXT_RE.match(stripped)
    if m:
        return "extension", m.group(1) or "(unnamed)"
    m = FN_RE.match(stripped)
    if m and m.group(1) not in ("if", "for", "while", "switch", "return"):
        return "function", m.group(1)
    m = VAR_RE.match(stripped)
    if m:
        return "const", m.group(1)
    return None, None


def scan(lines):
    items = []
    depth = 0
    in_block = False
    current = None
    for idx, raw in enumerate(lines, 1):
        code, in_block = strip_comments(raw, in_block)
        stripped = code.strip()
        if depth == 0 and stripped and not stripped.startswith(("import ", "export ", "part ", "library ", "@", "//")):
            kind, name = classify(stripped)
            if kind:
                current = {"start": idx, "kind": kind, "name": name, "methods": []}
                opens, closes = code.count("{"), code.count("}")
                if (opens == 0 and stripped.endswith(";")) or (opens > 0 and opens == closes):
                    current["end"] = idx
                    items.append(current)
                    current = None
        elif depth == 1 and current and current["kind"] not in ("function", "const"):
            fm = re.match(
                r"^(?:@override\s+)?(?:static\s+)?(?:Future<[^>]*>|Stream<[^>]*>|void|[A-Za-z_][\w<>, ?]*)\s+(\w+)\s*\(",
                stripped,
            )
            if fm and fm.group(1) not in ("if", "for", "while", "switch", "return"):
                current["methods"].append(fm.group(1))
        depth += code.count("{") - code.count("}")
        if depth == 0 and current and "end" not in current and ("}" in code or stripped.endswith(";")):
            current["end"] = idx
            items.append(current)
            current = None
    if current and "end" not in current:
        current["end"] = len(lines)
        items.append(current)
    return items


def importers_of(target_file, all_files):
    fname = Path(target_file).name
    hits = []
    pat = re.compile(rf"""^\s*(import|export|part)\s+['"][^'"]*{re.escape(fname)}['"]""", re.M)
    for f in all_files:
        if Path(f).resolve() == Path(target_file).resolve():
            continue
        try:
            text = Path(f).read_text(encoding="utf-8")
        except Exception:
            continue
        kinds = sorted({m.group(1) for m in pat.finditer(text)})
        if kinds:
            hits.append((f, ", ".join(kinds)))
    return hits


def main():
    files = sys.argv[1:]
    if not files:
        print("usage: inventory.py <file.dart> [...]   (run from the target repo root)", file=sys.stderr)
        sys.exit(1)
    all_files = list_source_files()

    for file in files:
        text = Path(file).read_text(encoding="utf-8")
        lines = text.splitlines()
        items = scan(lines)

        print(f"# Inventory: {file}\n")
        print(f"Total lines: {len(lines)}\n")

        print("## Imports / library directives\n")
        for line in lines:
            s = line.strip()
            if s.startswith(("import ", "export ", "part ", "library ")):
                print(f"- `{s}`")

        print("\n## Top-level declarations (in order)\n")
        print("| Kind | Name | Lines | Exported |")
        print("|---|---|---|---|")
        for it in items:
            exported = "no" if it["name"].startswith("_") else "yes"
            print(f"| {it['kind']} | `{it['name']}` | {it['start']}-{it['end']} | {exported} |")

        for it in items:
            if it["methods"]:
                print(f"\n### Methods in `{it['name']}` ({it['kind']})\n")
                for m in it["methods"]:
                    print(f"- {m}")

        gen = [s for s in ("part ", ".g.dart", ".freezed.dart") if s in text]
        if gen:
            print("\n## Codegen / part signals (moving symbols across these is a trap)\n")
            for line in lines:
                s = line.strip()
                if s.startswith("part") or ".g.dart" in s or ".freezed.dart" in s:
                    print(f"- `{s}`")

        importers = importers_of(file, all_files)
        print("\n## Imported by (load-bearing exports — keep compatible)\n")
        if not importers:
            print("(no other source file imports this file)")
        for f, kinds in importers:
            print(f"- `{f}` ({kinds})")

        print("\n---\n")


if __name__ == "__main__":
    main()
