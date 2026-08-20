// Command inventory prints a refactor-oriented inventory of Go source files.
//
// Run it from the target repository root:
//
//	go run /path/to/inventory.go -- file.go [...]
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/scanner"
	"go/token"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const usage = "usage: inventory.go -- <file.go> [...]   (run from the target repo root)\n"

type packageIdentity struct {
	Dir        string
	ImportPath string
	Name       string
}

type sourceFile struct {
	argument string
	path     string
	absolute string
	source   []byte
	set      *token.FileSet
	ast      *ast.File
	identity packageIdentity
	role     string
}

type declaration struct {
	kind       string
	name       string
	baseName   string
	start, end int
	exported   bool
}

type signal struct {
	start, end int
	category   int
	order      int
	text       string
}

type consumer struct {
	path      string
	qualifier string
	selectors []string
	form      string
}

type fileInventory struct {
	file         *sourceFile
	lines        int
	imports      []string
	declarations []declaration
	signals      []signal
	references   []reference
	consumers    []consumer
}

type reference struct {
	path  string
	names []string
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) > 0 && args[0] == "--" {
		args = args[1:]
	}
	if len(args) == 0 {
		_, _ = io.WriteString(stderr, usage)
		return 1
	}

	root, err := physicalRoot()
	if err != nil {
		fmt.Fprintf(stderr, "inventory: invocation root: %v\n", err)
		return 1
	}

	identities := make(map[string]packageIdentity)
	files := make([]*sourceFile, 0, len(args))
	for _, argument := range args {
		file, err := preflight(argument, root, identities)
		if err != nil {
			fmt.Fprintf(stderr, "inventory: %s: %v\n", displayArgument(argument), err)
			return 1
		}
		files = append(files, file)
	}

	inventories := make([]fileInventory, 0, len(files))
	for _, file := range files {
		inv, err := collectFile(file)
		if err != nil {
			fmt.Fprintf(stderr, "inventory: %s: %v\n", file.path, err)
			return 1
		}
		refs, err := collectSamePackage(root, file, inv.declarations)
		if err != nil {
			fmt.Fprintf(stderr, "inventory: same-package scan: %v\n", err)
			return 1
		}
		inv.references = refs
		inventories = append(inventories, inv)
	}

	var candidates []string
	needsConsumers := false
	for _, inv := range inventories {
		if inv.file.role != "external test" && inv.file.role != "alternate package in directory" {
			needsConsumers = true
			break
		}
	}
	if needsConsumers {
		candidates, err = discoverGoFiles(root)
		if err != nil {
			fmt.Fprintf(stderr, "inventory: importer scan: %v\n", err)
			return 1
		}
	}
	for i := range inventories {
		file := inventories[i].file
		if file.role == "external test" || file.role == "alternate package in directory" {
			continue
		}
		consumers, err := collectConsumers(root, file, candidates)
		if err != nil {
			fmt.Fprintf(stderr, "inventory: importer scan: %v\n", err)
			return 1
		}
		inventories[i].consumers = consumers
	}

	var output bytes.Buffer
	for i := range inventories {
		render(&output, &inventories[i])
	}
	_, _ = stdout.Write(output.Bytes())
	return 0
}

func physicalRoot() (string, error) {
	root, err := os.Getwd()
	if err != nil {
		return "", err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	return filepath.Abs(root)
}

func displayArgument(path string) string {
	return filepath.ToSlash(filepath.Clean(path))
}

func containedPath(root, path string) (string, error) {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("path is outside the invocation root")
	}
	return filepath.ToSlash(rel), nil
}

func preflight(argument, root string, identities map[string]packageIdentity) (*sourceFile, error) {
	cleaned := filepath.Clean(argument)
	candidate := cleaned
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(root, candidate)
	}
	physical, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, errors.New("file does not exist")
		}
		return nil, fmt.Errorf("read: %w", err)
	}
	physical, err = filepath.Abs(physical)
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}
	rel, err := containedPath(root, physical)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(physical)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, errors.New("file does not exist")
		}
		return nil, fmt.Errorf("read: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("not a regular file")
	}
	if filepath.Ext(physical) != ".go" {
		return nil, errors.New("expected a .go file")
	}
	source, err := os.ReadFile(physical)
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}
	set := token.NewFileSet()
	parsed, err := parser.ParseFile(set, rel, source, parser.ParseComments|parser.SkipObjectResolution|parser.AllErrors)
	if err != nil {
		return nil, fmt.Errorf("parse: %s", physicalParseError(err, set, parsed))
	}

	dir := filepath.Dir(physical)
	identity, ok := identities[dir]
	if !ok {
		identity, err = resolvePackage(dir)
		if err != nil {
			return nil, fmt.Errorf("package identity: %w", err)
		}
		identities[dir] = identity
	}
	role := fileRole(filepath.Base(physical), parsed.Name.Name, identity.Name)
	return &sourceFile{
		argument: argument, path: rel, absolute: physical, source: source,
		set: set, ast: parsed, identity: identity, role: role,
	}, nil
}

func resolvePackage(dir string) (packageIdentity, error) {
	cmd := exec.Command("go", "list", "-e", "-json", "-mod=readonly", ".")
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	var metadata struct {
		Dir        string
		ImportPath string
		Name       string
	}
	decodeErr := json.Unmarshal(stdout.Bytes(), &metadata)
	if decodeErr != nil {
		if runErr != nil {
			detail := strings.TrimSpace(stderr.String())
			if detail == "" {
				detail = runErr.Error()
			}
			return packageIdentity{}, fmt.Errorf("go list -e -json -mod=readonly .: %s", detail)
		}
		return packageIdentity{}, fmt.Errorf("decode go list -e -json -mod=readonly .: %w", decodeErr)
	}
	if metadata.Dir == "" || metadata.ImportPath == "" || metadata.Name == "" {
		detail := strings.TrimSpace(stderr.String())
		if detail != "" {
			return packageIdentity{}, fmt.Errorf("go list -e -json -mod=readonly . returned incomplete Dir, ImportPath, or Name metadata: %s", detail)
		}
		return packageIdentity{}, errors.New("go list -e -json -mod=readonly . returned incomplete Dir, ImportPath, or Name metadata")
	}
	physicalDir, err := filepath.EvalSymlinks(metadata.Dir)
	if err != nil {
		return packageIdentity{}, fmt.Errorf("evaluate go list Dir %q: %w", metadata.Dir, err)
	}
	targetDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return packageIdentity{}, fmt.Errorf("evaluate target directory: %w", err)
	}
	if physicalDir, err = filepath.Abs(physicalDir); err != nil {
		return packageIdentity{}, fmt.Errorf("normalize go list Dir: %w", err)
	}
	if targetDir, err = filepath.Abs(targetDir); err != nil {
		return packageIdentity{}, fmt.Errorf("normalize target directory: %w", err)
	}
	if physicalDir != targetDir {
		return packageIdentity{}, fmt.Errorf("go list returned Dir %q, expected %q", metadata.Dir, dir)
	}
	return packageIdentity{Dir: physicalDir, ImportPath: metadata.ImportPath, Name: metadata.Name}, nil
}

func fileRole(filename, packageName, listedName string) string {
	isTest := strings.HasSuffix(filename, "_test.go")
	if isTest && packageName == listedName+"_test" {
		return "external test"
	}
	if packageName != listedName {
		return "alternate package in directory"
	}
	if isTest {
		return "internal test"
	}
	return "production"
}

func collectFile(file *sourceFile) (fileInventory, error) {
	inv := fileInventory{file: file, lines: physicalLineCount(file.source)}
	for _, node := range file.ast.Decls {
		decl, ok := node.(*ast.GenDecl)
		if !ok || decl.Tok != token.IMPORT {
			continue
		}
		start := file.set.PositionFor(decl.Pos(), false).Offset
		end := file.set.PositionFor(decl.End(), false).Offset
		inv.imports = append(inv.imports, strings.Join(strings.Fields(string(file.source[start:end])), " "))
	}

	blankOccurrence := 0
	initOccurrence := 0
	signalOrder := 0
	canonical := func(name string) string {
		if name == "_" {
			blankOccurrence++
			return fmt.Sprintf("_ (occurrence %d)", blankOccurrence)
		}
		return name
	}

	for _, node := range file.ast.Decls {
		switch decl := node.(type) {
		case *ast.GenDecl:
			if decl.Tok != token.CONST && decl.Tok != token.VAR && decl.Tok != token.TYPE {
				continue
			}
			start, end := nodeSpan(file, decl.Doc, decl.Pos(), decl.End())
			allNames := make([]string, 0)
			for _, rawSpec := range decl.Specs {
				switch spec := rawSpec.(type) {
				case *ast.ValueSpec:
					specNames := make([]string, 0, len(spec.Names))
					for _, name := range spec.Names {
						shown := canonical(name.Name)
						specNames = append(specNames, shown)
						allNames = append(allNames, shown)
						inv.declarations = append(inv.declarations, declaration{
							kind: strings.ToLower(decl.Tok.String()), name: shown, baseName: name.Name,
							start: start, end: end, exported: name.IsExported(),
						})
					}
					if !decl.Lparen.IsValid() && len(specNames) > 1 {
						signalOrder++
						inv.signals = append(inv.signals, signal{start: start, end: end, category: 4, order: signalOrder,
							text: fmt.Sprintf("%s spec %s — names share one declaration; move together", strings.ToLower(decl.Tok.String()), codeList(specNames))})
					}
					if decl.Tok == token.VAR && len(spec.Values) > 0 {
						varStart, varEnd := nodeSpan(file, spec.Doc, spec.Pos(), spec.End())
						signalOrder++
						inv.signals = append(inv.signals, signal{start: varStart, end: varEnd, category: 5, order: signalOrder,
							text: fmt.Sprintf("initialized var %s — package initialization order may be load-bearing", codeList(specNames))})
					}
				case *ast.TypeSpec:
					shown := canonical(spec.Name.Name)
					allNames = append(allNames, shown)
					kind := "type"
					if spec.Assign.IsValid() {
						kind = "type alias"
					}
					inv.declarations = append(inv.declarations, declaration{
						kind: kind, name: shown, baseName: spec.Name.Name,
						start: start, end: end, exported: spec.Name.IsExported(),
					})
				}
			}
			if decl.Lparen.IsValid() {
				signalOrder++
				inv.signals = append(inv.signals, signal{start: start, end: end, category: 3, order: signalOrder,
					text: fmt.Sprintf("%s group %s — move the whole declaration together", strings.ToLower(decl.Tok.String()), codeList(allNames))})
			}
		case *ast.FuncDecl:
			start, end := nodeSpan(file, decl.Doc, decl.Pos(), decl.End())
			kind := "function"
			baseName := decl.Name.Name
			name := canonical(baseName)
			if decl.Recv != nil {
				kind = "method"
				name = fmt.Sprintf("(%s).%s", printNode(file.set, decl.Recv.List[0].Type), name)
			}
			if decl.Recv == nil && decl.Name.Name == "init" {
				initOccurrence++
				name = fmt.Sprintf("init (occurrence %d)", initOccurrence)
				signalOrder++
				inv.signals = append(inv.signals, signal{start: start, end: end, category: 5, order: signalOrder,
					text: fmt.Sprintf("%s — package initialization order is load-bearing", inlineCode(name, false))})
			}
			inv.declarations = append(inv.declarations, declaration{
				kind: kind, name: name, baseName: baseName, start: start, end: end, exported: decl.Name.IsExported(),
			})
			if decl.Body == nil {
				signalOrder++
				inv.signals = append(inv.signals, signal{start: start, end: end, category: 7, order: signalOrder,
					text: fmt.Sprintf("bodyless %s %s — inspect assembly/cgo/linkname implementation before moving", kind, inlineCode(name, false))})
			}
		}
	}

	generatedPattern := regexp.MustCompile(`^// Code generated .* DO NOT EDIT\.$`)
	if ast.IsGenerated(file.ast) {
		found := false
		for _, group := range file.ast.Comments {
			for _, comment := range group.List {
				if generatedPattern.MatchString(comment.Text) {
					line := file.set.PositionFor(comment.Pos(), false).Line
					inv.signals = append(inv.signals, signal{start: line, end: line, category: 1,
						text: "generated file — do not edit; regenerate from its owner"})
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		if !found {
			return fileInventory{}, errors.New("generated marker location not found")
		}
	}
	for _, group := range file.ast.Comments {
		for _, comment := range group.List {
			text := strings.TrimSpace(comment.Text)
			if !isDirective(text) {
				continue
			}
			start, end := positionLines(file, comment.Pos(), comment.End())
			signalOrder++
			inv.signals = append(inv.signals, signal{start: start, end: end, category: 2, order: signalOrder,
				text: fmt.Sprintf("%s — directive; preserve its attachment and semantics", inlineCode(text, false))})
		}
	}
	for _, spec := range file.ast.Imports {
		path, err := strconv.Unquote(spec.Path.Value)
		if err != nil || path != "C" {
			continue
		}
		start, end := positionLines(file, spec.Pos(), spec.End())
		signalOrder++
		inv.signals = append(inv.signals, signal{start: start, end: end, category: 6, order: signalOrder,
			text: inlineCode(`import "C"`, false) + " — cgo boundary; preserve the immediately preceding C preamble"})
	}
	sort.SliceStable(inv.signals, func(i, j int) bool {
		if inv.signals[i].start != inv.signals[j].start {
			return inv.signals[i].start < inv.signals[j].start
		}
		if inv.signals[i].category != inv.signals[j].category {
			return inv.signals[i].category < inv.signals[j].category
		}
		return inv.signals[i].order < inv.signals[j].order
	})
	return inv, nil
}

func physicalParseError(err error, set *token.FileSet, parsed *ast.File) string {
	list, ok := err.(scanner.ErrorList)
	if !ok || len(list) == 0 {
		return err.Error()
	}
	var tokenFile *token.File
	if parsed != nil {
		tokenFile = set.File(parsed.Pos())
	}
	if tokenFile == nil {
		set.Iterate(func(file *token.File) bool {
			tokenFile = file
			return false
		})
	}
	if tokenFile == nil {
		return err.Error()
	}
	first := list[0]
	offset := first.Pos.Offset
	if offset < 0 {
		offset = 0
	}
	if offset > tokenFile.Size() {
		offset = tokenFile.Size()
	}
	position := tokenFile.PositionFor(tokenFile.Pos(offset), false)
	message := fmt.Sprintf("%s: %s", position, first.Msg)
	if len(list) > 1 {
		message += fmt.Sprintf(" (and %d more errors)", len(list)-1)
	}
	return message
}

func safelyIrrelevantMalformedFixture(source []byte, targetImportPath string) bool {
	if len(bytes.TrimSpace(source)) == 0 {
		return true
	}
	if bytes.Contains(source, []byte(targetImportPath)) {
		return false
	}

	set := token.NewFileSet()
	file := set.AddFile("", -1, len(source))
	var lexical scanner.Scanner
	lexical.Init(file, source, nil, scanner.ScanComments)
	intentionalError := false
	hasPackageOrImport := false
	for {
		_, item, literal := lexical.Scan()
		switch item {
		case token.PACKAGE, token.IMPORT:
			hasPackageOrImport = true
		case token.COMMENT:
			trimmed := strings.TrimSpace(literal)
			if strings.HasPrefix(trimmed, "/* ERROR ") || strings.HasPrefix(trimmed, "// ERROR ") {
				intentionalError = true
			}
		case token.STRING:
			value, err := strconv.Unquote(literal)
			if err != nil || value == targetImportPath {
				return false
			}
		case token.EOF:
			// Go's source tree also has .go paths that model non-source files.
			// With no package/import token they cannot consume any package.
			// Negative parser fixtures are irrelevant only when the target import
			// path is absent, so no importer evidence can be hidden.
			return !hasPackageOrImport || intentionalError
		}
	}
}

func physicalLineCount(source []byte) int {
	if len(source) == 0 {
		return 0
	}
	lines := bytes.Count(source, []byte{'\n'})
	if source[len(source)-1] != '\n' {
		lines++
	}
	return lines
}

func nodeSpan(file *sourceFile, doc *ast.CommentGroup, start, end token.Pos) (int, int) {
	if doc != nil {
		start = doc.Pos()
	}
	return positionLines(file, start, end)
}

func positionLines(file *sourceFile, start, end token.Pos) (int, int) {
	return file.set.PositionFor(start, false).Line, file.set.PositionFor(end, false).Line
}

func printNode(set *token.FileSet, node any) string {
	var output bytes.Buffer
	_ = printer.Fprint(&output, set, node)
	return output.String()
}

func isDirective(text string) bool {
	return strings.HasPrefix(text, "//go:") || strings.HasPrefix(text, "// +build") ||
		strings.HasPrefix(text, "//line ") || strings.HasPrefix(text, "/*line ") ||
		strings.HasPrefix(text, "//export ")
}

func collectSamePackage(root string, target *sourceFile, declarations []declaration) ([]reference, error) {
	wanted := make(map[string]struct{})
	for _, decl := range declarations {
		if decl.baseName != "init" && decl.baseName != "_" {
			wanted[decl.baseName] = struct{}{}
		}
	}
	entries, err := os.ReadDir(filepath.Dir(target.absolute))
	if err != nil {
		return nil, fmt.Errorf("%s: read: %w", target.path, err)
	}
	type candidate struct{ path, absolute string }
	var candidates []candidate
	seen := make(map[string]bool)
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".go" {
			continue
		}
		absolute, err := filepath.EvalSymlinks(filepath.Join(filepath.Dir(target.absolute), entry.Name()))
		if err != nil {
			return nil, fmt.Errorf("%s: read: %w", filepath.ToSlash(filepath.Join(filepath.Dir(target.path), entry.Name())), err)
		}
		absolute, err = filepath.Abs(absolute)
		if err != nil {
			return nil, fmt.Errorf("%s: read: %w", entry.Name(), err)
		}
		path, err := containedPath(root, absolute)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", filepath.ToSlash(filepath.Join(filepath.Dir(target.path), entry.Name())), err)
		}
		if absolute == target.absolute || seen[absolute] {
			continue
		}
		seen[absolute] = true
		candidates = append(candidates, candidate{path: path, absolute: absolute})
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].path < candidates[j].path })

	var references []reference
	for _, candidate := range candidates {
		info, err := os.Stat(candidate.absolute)
		if err != nil {
			return nil, fmt.Errorf("%s: read: %w", candidate.path, err)
		}
		if !info.Mode().IsRegular() {
			continue
		}
		source, err := os.ReadFile(candidate.absolute)
		if err != nil {
			return nil, fmt.Errorf("%s: read: %w", candidate.path, err)
		}
		clauseSet := token.NewFileSet()
		clause, err := parser.ParseFile(clauseSet, candidate.path, source, parser.PackageClauseOnly|parser.SkipObjectResolution)
		if err != nil {
			return nil, fmt.Errorf("%s: parse: %s", candidate.path, physicalParseError(err, clauseSet, clause))
		}
		if clause.Name.Name != target.ast.Name.Name {
			continue
		}
		set := token.NewFileSet()
		parsed, err := parser.ParseFile(set, candidate.path, source, parser.SkipObjectResolution|parser.AllErrors)
		if err != nil {
			return nil, fmt.Errorf("%s: parse: %s", candidate.path, physicalParseError(err, set, parsed))
		}
		var names []string
		found := make(map[string]bool)
		ast.Inspect(parsed, func(node ast.Node) bool {
			ident, ok := node.(*ast.Ident)
			if !ok || found[ident.Name] {
				return true
			}
			if _, ok := wanted[ident.Name]; ok {
				found[ident.Name] = true
				names = append(names, ident.Name)
			}
			return true
		})
		if len(names) > 0 {
			references = append(references, reference{path: candidate.path, names: names})
		}
	}
	return references, nil
}

func discoverGoFiles(root string) ([]string, error) {
	cmd := exec.Command("git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.go")
	cmd.Dir = root
	output, err := cmd.Output()
	if err == nil {
		var paths []string
		for _, raw := range bytes.Split(output, []byte{0}) {
			if len(raw) > 0 {
				paths = append(paths, filepath.ToSlash(filepath.Clean(string(raw))))
			}
		}
		sort.Strings(paths)
		return paths, nil
	}
	probe := exec.Command("git", "rev-parse", "--is-inside-work-tree")
	probe.Dir = root
	if probe.Run() == nil {
		return nil, fmt.Errorf("git ls-files: %w", err)
	}

	var paths []string
	skip := map[string]bool{".git": true, ".hg": true, ".svn": true, ".cache": true, "node_modules": true}
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path != root && entry.IsDir() && skip[entry.Name()] {
			return filepath.SkipDir
		}
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".go" {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		paths = append(paths, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	return paths, nil
}

func collectConsumers(root string, target *sourceFile, candidates []string) ([]consumer, error) {
	var consumers []consumer
	seenPhysical := make(map[string]bool)
	for _, candidate := range candidates {
		joined := filepath.Join(root, filepath.FromSlash(candidate))
		physical, err := filepath.EvalSymlinks(joined)
		if err != nil {
			return nil, fmt.Errorf("%s: read: %w", candidate, err)
		}
		physical, err = filepath.Abs(physical)
		if err != nil {
			return nil, fmt.Errorf("%s: read: %w", candidate, err)
		}
		canonical, err := containedPath(root, physical)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", candidate, err)
		}
		if seenPhysical[physical] {
			continue
		}
		seenPhysical[physical] = true
		info, err := os.Stat(physical)
		if err != nil {
			return nil, fmt.Errorf("%s: read: %w", canonical, err)
		}
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("%s: read: not a regular file", canonical)
		}
		source, err := os.ReadFile(physical)
		if err != nil {
			return nil, fmt.Errorf("%s: read: %w", canonical, err)
		}
		set := token.NewFileSet()
		preamble, err := parser.ParseFile(set, canonical, source, parser.ImportsOnly|parser.SkipObjectResolution)
		if err != nil {
			if safelyIrrelevantMalformedFixture(source, target.identity.ImportPath) {
				continue
			}
			return nil, fmt.Errorf("%s: parse: %s", canonical, physicalParseError(err, set, preamble))
		}
		var matches []*ast.ImportSpec
		for _, spec := range preamble.Imports {
			path, unquoteErr := strconv.Unquote(spec.Path.Value)
			if unquoteErr == nil && path == target.identity.ImportPath {
				matches = append(matches, spec)
			}
		}
		if len(matches) == 0 || physical == target.absolute {
			continue
		}
		fullSet := token.NewFileSet()
		parsed, err := parser.ParseFile(fullSet, canonical, source, parser.SkipObjectResolution|parser.AllErrors)
		if err != nil {
			return nil, fmt.Errorf("%s: parse: %s", canonical, physicalParseError(err, fullSet, parsed))
		}
		for _, spec := range matches {
			qualifier := target.ast.Name.Name
			if spec.Name != nil {
				qualifier = spec.Name.Name
			}
			hit := consumer{path: canonical, qualifier: qualifier}
			switch qualifier {
			case "_":
				hit.form = "side-effect"
			case ".":
				hit.form = "dot"
			default:
				seen := make(map[string]bool)
				ast.Inspect(parsed, func(node ast.Node) bool {
					selector, ok := node.(*ast.SelectorExpr)
					if !ok {
						return true
					}
					ident, ok := selector.X.(*ast.Ident)
					if ok && ident.Name == qualifier && !seen[selector.Sel.Name] {
						seen[selector.Sel.Name] = true
						hit.selectors = append(hit.selectors, selector.Sel.Name)
					}
					return true
				})
			}
			consumers = append(consumers, hit)
		}
	}
	sort.SliceStable(consumers, func(i, j int) bool { return consumers[i].path < consumers[j].path })
	return consumers, nil
}

func inlineCode(value string, table bool) string {
	if table {
		value = strings.ReplaceAll(value, "|", `\|`)
	}
	maxRun := 0
	for i := 0; i < len(value); {
		if value[i] != '`' {
			i++
			continue
		}
		j := i
		for j < len(value) && value[j] == '`' {
			j++
		}
		if j-i > maxRun {
			maxRun = j - i
		}
		i = j
	}
	delimiter := strings.Repeat("`", maxRun+1)
	return delimiter + value + delimiter
}

func codeList(names []string) string {
	values := make([]string, len(names))
	for i, name := range names {
		values[i] = inlineCode(name, false)
	}
	return strings.Join(values, ", ")
}

func lineRange(start, end int) string {
	if start == end {
		return fmt.Sprintf("L%d", start)
	}
	return fmt.Sprintf("L%d-%d", start, end)
}

func render(output *bytes.Buffer, inv *fileInventory) {
	fmt.Fprintf(output, "# Inventory: %s\n\n", inv.file.path)
	fmt.Fprintf(output, "Total lines: %d\n\n", inv.lines)
	output.WriteString("## Package\n\n")
	fmt.Fprintf(output, "- Name: %s\n", inlineCode(inv.file.ast.Name.Name, false))
	fmt.Fprintf(output, "- Import path: %s\n", inlineCode(inv.file.identity.ImportPath, false))
	fmt.Fprintf(output, "- File role: %s\n\n", inv.file.role)
	output.WriteString("## Imports\n\n")
	if len(inv.imports) == 0 {
		fmt.Fprintln(output, "(none)")
	} else {
		for _, declaration := range inv.imports {
			fmt.Fprintf(output, "- %s\n", inlineCode(declaration, false))
		}
	}
	output.WriteString("\n## Top-level declarations (in order)\n\n")
	fmt.Fprintln(output, "| Kind | Name | Lines | Exported |")
	fmt.Fprintln(output, "|---|---|---|---|")
	if len(inv.declarations) == 0 {
		fmt.Fprintln(output, "(none)")
	} else {
		for _, declaration := range inv.declarations {
			exported := "no"
			if declaration.exported {
				exported = "yes"
			}
			fmt.Fprintf(output, "| %s | %s | %d-%d | %s |\n", declaration.kind,
				inlineCode(declaration.name, true), declaration.start, declaration.end, exported)
		}
	}
	output.WriteString("\n## Go refactor signals\n\n")
	if len(inv.signals) == 0 {
		fmt.Fprintln(output, "(none)")
	} else {
		for _, signal := range inv.signals {
			fmt.Fprintf(output, "- %s: %s\n", lineRange(signal.start, signal.end), signal.text)
		}
	}
	output.WriteString("\n## Same-package references (conservative syntax scan)\n\n")
	if len(inv.references) == 0 {
		fmt.Fprintln(output, "(none)")
	} else {
		for _, reference := range inv.references {
			fmt.Fprintf(output, "- %s references: %s\n", inlineCode(reference.path, false), codeList(reference.names))
		}
	}
	output.WriteString("\n## Imported by (load-bearing exports — keep compatible)\n\n")
	if inv.file.role == "external test" || inv.file.role == "alternate package in directory" {
		fmt.Fprintln(output, "(not applicable: this file's package is not the importable package selected by `go list`)")
	} else if len(inv.consumers) == 0 {
		fmt.Fprintln(output, "(none)")
	} else {
		for _, consumer := range inv.consumers {
			switch consumer.form {
			case "side-effect":
				fmt.Fprintf(output, "- %s: side-effect import; package initialization is load-bearing\n", inlineCode(consumer.path, false))
			case "dot":
				fmt.Fprintf(output, "- %s: dot import; all exported names potentially load-bearing\n", inlineCode(consumer.path, false))
			default:
				selectors := "(none found)"
				if len(consumer.selectors) > 0 {
					selectors = codeList(consumer.selectors)
				}
				fmt.Fprintf(output, "- %s imports as %s; selectors: %s\n", inlineCode(consumer.path, false),
					inlineCode(consumer.qualifier, false), selectors)
			}
		}
	}
	fmt.Fprintln(output, "\n---")
}
