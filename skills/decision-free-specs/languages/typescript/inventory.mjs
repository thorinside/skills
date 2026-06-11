#!/usr/bin/env node
// Symbol-level inventory of TS/TSX files, for writing decision-free refactor specs.
// Usage (from the TARGET repo's root):
//   node <path-to-skill>/languages/typescript/inventory.mjs <file.tsx> [...]
// Output: markdown to stdout.
//
// Replaces the expensive "agent reads the file and lists symbols" planning step:
// everything a spec's symbol map needs (names, kinds, line ranges, export status,
// component detection, hooks, API calls, dynamic classNames, importers) comes from
// the AST. Uses the TARGET repo's own `typescript` package — no dependencies here.

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

let ts;
try {
	ts = createRequire(path.join(process.cwd(), "package.json"))("typescript");
} catch {
	console.error(
		"Could not resolve 'typescript' from the current directory.\n" +
			"Run this script from the root of the repo you are inventorying\n" +
			"(it must have typescript installed, e.g. `npm i -D typescript`).",
	);
	process.exit(1);
}

const files = process.argv.slice(2);
if (files.length === 0) {
	console.error("usage: node inventory.mjs <file.tsx> [...]   (run from the target repo root)");
	process.exit(1);
}

function listSourceFiles() {
	try {
		return execSync('git ls-files "*.ts" "*.tsx"', { encoding: "utf8" }).split("\n").filter(Boolean);
	} catch {
		const out = [];
		const walk = (dir) => {
			for (const entry of readdirSync(dir)) {
				if (entry === "node_modules" || entry.startsWith(".")) continue;
				const p = path.join(dir, entry);
				if (statSync(p).isDirectory()) walk(p);
				else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
			}
		};
		walk(".");
		return out;
	}
}

function lineOf(sf, pos) {
	return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function isExported(node) {
	return (ts.getModifiers?.(node) ?? node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function containsJsx(node) {
	let found = false;
	const visit = (n) => {
		if (found) return;
		if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
			found = true;
			return;
		}
		ts.forEachChild(n, visit);
	};
	visit(node);
	return found;
}

function hookCalls(node) {
	const hooks = [];
	const visit = (n) => {
		if (ts.isVariableDeclaration(n) && n.initializer && ts.isCallExpression(n.initializer)) {
			const callee = n.initializer.expression.getText();
			if (/^(useState|useRef|useMemo|useCallback|useSyncExternalStore)$/.test(callee)) {
				hooks.push(`${callee}: ${n.name.getText()}`);
			}
		}
		ts.forEachChild(n, visit);
	};
	visit(node);
	return hooks;
}

function describeDeclaration(sf, stmt) {
	const rows = [];
	const span = (node) => `${lineOf(sf, node.getStart(sf))}-${lineOf(sf, node.getEnd())}`;
	if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) {
		rows.push({ kind: "type", name: stmt.name.text, lines: span(stmt), exported: isExported(stmt), node: stmt });
	} else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
		const component = /^[A-Z]/.test(stmt.name.text) && containsJsx(stmt);
		rows.push({
			kind: component ? "component" : "function",
			name: stmt.name.text,
			lines: span(stmt),
			exported: isExported(stmt),
			node: stmt,
		});
	} else if (ts.isVariableStatement(stmt)) {
		for (const decl of stmt.declarationList.declarations) {
			const name = decl.name.getText();
			const init = decl.initializer;
			const arrow = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
			const component = arrow && /^[A-Z]/.test(name) && containsJsx(init);
			rows.push({
				kind: component ? "component" : arrow ? "function" : "const",
				name,
				lines: span(stmt),
				exported: isExported(stmt),
				node: stmt,
			});
		}
	} else if (ts.isClassDeclaration(stmt) && stmt.name) {
		rows.push({ kind: "class", name: stmt.name.text, lines: span(stmt), exported: isExported(stmt), node: stmt });
	}
	return rows;
}

function grepWithLines(sf, text, regex) {
	const out = [];
	for (const match of text.matchAll(regex)) {
		out.push({ line: lineOf(sf, match.index), text: match[0].slice(0, 120) });
	}
	return out;
}

function importersOf(targetFile, allFiles) {
	const base = path.basename(targetFile).replace(/\.(ts|tsx)$/, "");
	const hits = [];
	for (const f of allFiles) {
		if (path.resolve(f) === path.resolve(targetFile)) continue;
		const text = readFileSync(f, "utf8");
		const re = new RegExp(`import\\s+(type\\s+)?\\{([^}]*)\\}\\s+from\\s+"[^"]*/${base}"`, "g");
		for (const m of text.matchAll(re)) {
			hits.push({ file: f, names: m[2].replace(/\s+/g, " ").trim() });
		}
		if (new RegExp(`from\\s+"[^"]*/${base}"`).test(text) && !hits.some((h) => h.file === f)) {
			hits.push({ file: f, names: "(default or side-effect import)" });
		}
	}
	return hits;
}

const allSrcFiles = listSourceFiles();

for (const file of files) {
	const text = readFileSync(file, "utf8");
	const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const lineCount = text.split("\n").length;

	console.log(`# Inventory: ${file}\n`);
	console.log(`Total lines: ${lineCount}\n`);

	console.log("## Imports\n");
	for (const stmt of sf.statements) {
		if (ts.isImportDeclaration(stmt)) console.log(`- \`${stmt.getText(sf).replace(/\s+/g, " ")}\``);
	}

	console.log("\n## Top-level declarations (in order)\n");
	console.log("| Kind | Name | Lines | Exported |");
	console.log("|---|---|---|---|");
	const declarations = [];
	for (const stmt of sf.statements) {
		for (const row of describeDeclaration(sf, stmt)) {
			declarations.push(row);
			console.log(`| ${row.kind} | \`${row.name}\` | ${row.lines} | ${row.exported ? "yes" : "no"} |`);
		}
	}

	for (const row of declarations) {
		if (row.kind !== "component") continue;
		const hooks = hookCalls(row.node);
		if (hooks.length) {
			console.log(`\n### Hooks in \`${row.name}\`\n`);
			for (const h of hooks) console.log(`- ${h}`);
		}
	}

	const apiCalls = grepWithLines(sf, text, /\bclient\.(GET|POST|PATCH|PUT|DELETE)\(\s*"([^"]+)"/g);
	console.log("\n## API calls\n");
	if (apiCalls.length === 0) console.log("(none)");
	for (const c of apiCalls) console.log(`- L${c.line}: \`${c.text}\``);

	const sse = grepWithLines(sf, text, /new EventSource\([^)]*\)/g);
	if (sse.length) {
		console.log("\n## EventSource\n");
		for (const c of sse) console.log(`- L${c.line}: \`${c.text}\``);
	}

	const dynClass = grepWithLines(sf, text, /className=\{`[^`]*\$\{[^`]*`\}/g);
	console.log("\n## Dynamic classNames (grep-invisible — never delete their CSS)\n");
	if (dynClass.length === 0) console.log("(none)");
	for (const c of dynClass) console.log(`- L${c.line}: \`${c.text}\``);

	const importers = importersOf(file, allSrcFiles);
	console.log("\n## Imported by (load-bearing exports — keep compatible)\n");
	if (importers.length === 0) console.log("(no other source file imports this module)");
	for (const i of importers) console.log(`- \`${i.file}\` imports: ${i.names}`);

	console.log("\n---\n");
}
