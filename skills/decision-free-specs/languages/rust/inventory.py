#!/usr/bin/env python3
"""Symbol-level inventory of Rust files, for writing decision-free refactor specs.

Usage (from the TARGET repo's root):
    python3 <path-to-skill>/languages/rust/inventory.py <file.rs> [...]

Output: markdown to stdout, per the contract in languages/README.md.

Implementation note: this is a depth-0 structural scanner (brace tracking +
item-start regexes), not a real Rust parser — dependency-free beats requiring a
syn-based helper crate. It is accurate for conventionally formatted code; `cargo
check` remains the ground truth and every plan's verification gate. Known limits
are listed in NOTES.md.
"""

import re
import subprocess
import sys
from pathlib import Path

ITEM_RE = re.compile(
    r"^(?P<vis>pub(?:\([^)]*\))?\s+)?"
    r"(?:default\s+)?(?:unsafe\s+)?(?:async\s+)?(?:extern\s+\"[^\"]*\"\s+)?"
    r"(?P<kind>macro_rules!|(?:fn|struct|enum|trait|mod|const|static|type|union|impl|use)\b)"
    r"\s*(?P<rest>.*)$"
)
NAME_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)")


def list_source_files():
    try:
        out = subprocess.run(
            ["git", "ls-files", "*.rs"], capture_output=True, text=True, check=True
        ).stdout
        return [line for line in out.splitlines() if line]
    except Exception:
        return [str(p) for p in Path(".").rglob("*.rs") if "target" not in p.parts]


def strip_comments_keep_len(line, in_block):
    """Blank out comment/string contents so braces inside them don't count."""
    out = []
    i = 0
    in_str = False
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
            if line[i] == '"':
                in_str = False
            i += 1
            continue
        if two == "//":
            break
        if two == "/*":
            in_block = True
            i += 2
            continue
        if line[i] == '"':
            in_str = True
            i += 1
            continue
        out.append(line[i])
        i += 1
    return "".join(out), in_block


def scan(lines):
    """Yield (start_line, end_line, kind, name, vis, attrs, methods)."""
    items = []
    depth = 0
    in_block = False
    pending_attrs = []
    current = None  # open multi-line item
    for idx, raw in enumerate(lines, 1):
        code, in_block = strip_comments_keep_len(raw, in_block)
        stripped = code.strip()
        if depth == 0 and stripped.startswith("#["):
            pending_attrs.append((idx, raw.strip()))
        elif depth == 0 and stripped:
            m = ITEM_RE.match(stripped)
            if m and m.group("kind") != "use":
                kind = m.group("kind").rstrip("!")
                vis = (m.group("vis") or "").strip() or "private"
                if kind == "impl":
                    name = stripped.split("{")[0].strip().rstrip(";")
                else:
                    nm = NAME_RE.search(m.group("rest") or "")
                    name = nm.group(1) if nm else "?"
                current = {
                    "start": idx, "kind": kind, "name": name, "vis": vis,
                    "attrs": [a for _, a in pending_attrs], "methods": [],
                }
                pending_attrs = []
                # single-line item (ends with ; or balanced braces on this line)
                opens = code.count("{")
                closes = code.count("}")
                if opens == 0 and stripped.endswith(";"):
                    current["end"] = idx
                    items.append(current)
                    current = None
                elif opens > 0 and opens == closes:
                    current["end"] = idx
                    items.append(current)
                    current = None
            else:
                pending_attrs = []
        elif depth == 1 and current and current["kind"] in ("impl", "trait", "mod"):
            fm = re.match(r"^(pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)", stripped)
            if fm:
                current["methods"].append(fm.group(2))
        depth += code.count("{") - code.count("}")
        if depth == 0 and current and "end" not in current and ("}" in code or code.strip().endswith(";")):
            current["end"] = idx
            items.append(current)
            current = None
    if current and "end" not in current:
        current["end"] = len(lines)
        items.append(current)
    return items


def importers_of(target_file, all_files):
    stem = Path(target_file).stem
    if stem in ("mod", "lib", "main"):
        stem = Path(target_file).parent.name
    hits = []
    pats = [
        re.compile(rf"^\s*(pub\s+)?mod\s+{re.escape(stem)}\s*;", re.M),
        re.compile(rf"\buse\s+[\w:]*\b{re.escape(stem)}\b\s*::\s*([\w{{}},\s*]+)", re.M),
        re.compile(rf"\bcrate::[\w:]*\b{re.escape(stem)}\b"),
    ]
    for f in all_files:
        if Path(f).resolve() == Path(target_file).resolve():
            continue
        try:
            text = Path(f).read_text(encoding="utf-8")
        except Exception:
            continue
        names = []
        if pats[0].search(text):
            names.append("(mod declaration — module registration site)")
        for m in pats[1].finditer(text):
            names.append(m.group(1).strip()[:80])
        if not names and pats[2].search(text):
            names.append("(path reference)")
        if names:
            hits.append((f, "; ".join(dict.fromkeys(names))))
    return hits


def main():
    files = sys.argv[1:]
    if not files:
        print("usage: inventory.py <file.rs> [...]   (run from the target repo root)", file=sys.stderr)
        sys.exit(1)
    all_files = list_source_files()

    for file in files:
        text = Path(file).read_text(encoding="utf-8")
        lines = text.splitlines()
        items = scan(lines)

        print(f"# Inventory: {file}\n")
        print(f"Total lines: {len(lines)}\n")

        print("## Imports\n")
        for line in lines:
            if re.match(r"^\s*(pub\s+)?use\s", line):
                print(f"- `{line.strip()}`")

        print("\n## Top-level declarations (in order)\n")
        print("| Kind | Name | Lines | Exported |")
        print("|---|---|---|---|")
        for it in items:
            exported = "yes" if it["vis"].startswith("pub") and "(" not in it["vis"] else it["vis"] if it["vis"].startswith("pub") else "no"
            print(f"| {it['kind']} | `{it['name']}` | {it['start']}-{it['end']} | {exported} |")

        for it in items:
            if it["methods"]:
                print(f"\n### Methods in `{it['name']}` ({it['kind']})\n")
                for m in it["methods"]:
                    print(f"- {m}")
            interesting = [a for a in it["attrs"] if re.search(r"#\[(cfg|macro_export|derive|no_mangle)", a)]
            if interesting:
                print(f"\n### Attributes on `{it['name']}`\n")
                for a in interesting:
                    print(f"- `{a}`" + (" — cfg-gated: may exist only under some features" if "cfg" in a else ""))

        importers = importers_of(file, all_files)
        print("\n## Imported by (load-bearing exports — keep compatible)\n")
        if not importers:
            print("(no other source file references this module)")
        for f, names in importers:
            print(f"- `{f}`: {names}")

        print("\n---\n")


if __name__ == "__main__":
    main()
