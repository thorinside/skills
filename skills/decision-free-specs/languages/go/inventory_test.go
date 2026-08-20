package main

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
)

func invoke(args ...string) (int, string, string) {
	var stdout, stderr bytes.Buffer
	status := run(args, &stdout, &stderr)
	return status, stdout.String(), stderr.String()
}

func writeTestFile(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}

func newModule(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "go.mod"), "module example.com/testroot\n\ngo 1.24\n")
	t.Chdir(root)
	return root
}

func TestNoArguments(t *testing.T) {
	for _, args := range [][]string{nil, {"--"}} {
		status, stdout, stderr := invoke(args...)
		if status != 1 || stdout != "" || stderr != usage {
			t.Fatalf("run(%q) = status %d, stdout %q, stderr %q", args, status, stdout, stderr)
		}
	}
}

func TestInputValidationHasNoPartialOutput(t *testing.T) {
	root := newModule(t)
	writeTestFile(t, filepath.Join(root, "valid.go"), "package sample\n")
	writeTestFile(t, filepath.Join(root, "note.txt"), "not Go\n")
	outside := filepath.Join(filepath.Dir(root), "outside.go")
	writeTestFile(t, outside, "package outside\n")

	tests := []struct {
		args []string
		err  string
	}{
		{[]string{"missing.go"}, "inventory: missing.go: file does not exist\n"},
		{[]string{"."}, "inventory: .: not a regular file\n"},
		{[]string{"note.txt"}, "inventory: note.txt: expected a .go file\n"},
		{[]string{"../outside.go"}, "inventory: ../outside.go: path is outside the invocation root\n"},
		{[]string{"valid.go", "missing.go"}, "inventory: missing.go: file does not exist\n"},
	}
	for _, test := range tests {
		status, stdout, stderr := invoke(test.args...)
		if status != 1 || stdout != "" || stderr != test.err {
			t.Errorf("run(%q) = status %d, stdout %q, stderr %q; want status 1, empty stdout, stderr %q", test.args, status, stdout, stderr, test.err)
		}
	}
}

func TestSymlinkContainmentAndCanonicalPath(t *testing.T) {
	root := newModule(t)
	writeTestFile(t, filepath.Join(root, "real.go"), "package sample\n")
	if err := os.Symlink("real.go", filepath.Join(root, "alias.go")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	status, stdout, stderr := invoke("alias.go")
	if status != 0 || stderr != "" || !strings.HasPrefix(stdout, "# Inventory: real.go\n") {
		t.Fatalf("in-root alias: status %d, stdout %q, stderr %q", status, stdout, stderr)
	}

	outsideRoot := t.TempDir()
	writeTestFile(t, filepath.Join(outsideRoot, "escape.go"), "package escape\n")
	if err := os.Symlink(filepath.Join(outsideRoot, "escape.go"), filepath.Join(root, "escape.go")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	status, stdout, stderr = invoke("escape.go")
	if status != 1 || stdout != "" || stderr != "inventory: escape.go: path is outside the invocation root\n" {
		t.Fatalf("escaping alias: status %d, stdout %q, stderr %q", status, stdout, stderr)
	}
}

func TestSyntaxErrorUsesPhysicalPosition(t *testing.T) {
	root := newModule(t)
	writeTestFile(t, filepath.Join(root, "broken.go"), "package sample\n//line fake.go:900\nfunc broken( {\n")
	status, stdout, stderr := invoke("broken.go")
	if status != 1 || stdout != "" || !strings.HasPrefix(stderr, "inventory: broken.go: parse: broken.go:3:") {
		t.Fatalf("status %d, stdout %q, stderr %q", status, stdout, stderr)
	}
	if strings.Contains(stderr, "fake.go:900") {
		t.Fatalf("diagnostic used //line remapping: %q", stderr)
	}
}

func TestPackageIdentityFailureIsLoud(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	writeTestFile(t, filepath.Join(root, "sample.go"), "package sample\n")
	status, stdout, stderr := invoke("sample.go")
	if status != 1 || stdout != "" || !strings.HasPrefix(stderr, "inventory: sample.go: package identity:") || !strings.Contains(stderr, "go list") {
		t.Fatalf("status %d, stdout %q, stderr %q", status, stdout, stderr)
	}
}

func TestSamePackageParseFailureIsLoud(t *testing.T) {
	root := newModule(t)
	writeTestFile(t, filepath.Join(root, "sample.go"), "package sample\nfunc Good() {}\n")
	writeTestFile(t, filepath.Join(root, "broken.go"), "package sample\nfunc broken( {\n")
	status, stdout, stderr := invoke("sample.go")
	if status != 1 || stdout != "" || !strings.HasPrefix(stderr, "inventory: same-package scan: broken.go: parse: broken.go:2:") {
		t.Fatalf("status %d, stdout %q, stderr %q", status, stdout, stderr)
	}
}

func TestSamePackageSkipsNonFilesAndOtherPackageBodies(t *testing.T) {
	root := newModule(t)
	writeTestFile(t, filepath.Join(root, "a_target.go"), "package sample\nfunc Good() {}\n")
	writeTestFile(t, filepath.Join(root, "z_alternate.go"), "package alternate\nfunc broken( {\n")
	if err := os.Mkdir(filepath.Join(root, "ignored.go"), 0o755); err != nil {
		t.Fatal(err)
	}
	status, stdout, stderr := invoke("a_target.go")
	if status != 0 || stderr != "" || !strings.HasPrefix(stdout, "# Inventory: a_target.go\n") {
		t.Fatalf("status %d, stdout %q, stderr %q", status, stdout, stderr)
	}
}

func TestPhysicalLineCount(t *testing.T) {
	tests := []struct {
		name, source string
		lines        int
	}{
		{"lf-final", "package sample\n\nvar A int\n", 3},
		{"lf-no-final", "package sample\n\nvar A int", 3},
		{"crlf", "package sample\r\n\r\nvar A int\r\n", 3},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := newModule(t)
			writeTestFile(t, filepath.Join(root, "sample.go"), test.source)
			status, stdout, stderr := invoke("sample.go")
			if status != 0 || stderr != "" || !strings.Contains(stdout, fmt.Sprintf("Total lines: %d\n", test.lines)) {
				t.Fatalf("status %d, stdout %q, stderr %q", status, stdout, stderr)
			}
		})
	}
}

func TestGoldenFixture(t *testing.T) {
	fixture := filepath.Join("fixtures")
	expected, err := os.ReadFile(filepath.Join(fixture, "expected.md"))
	if err != nil {
		t.Fatal(err)
	}
	t.Chdir(fixture)
	status, stdout, stderr := invoke("--", "sample.go")
	if status != 0 || stderr != "" {
		t.Fatalf("status %d, stderr %q", status, stderr)
	}
	if diff := firstDifference(string(expected), stdout); diff != "" {
		t.Fatal(diff)
	}
}

func TestMultipleFilesPreserveArgumentOrder(t *testing.T) {
	t.Chdir("fixtures")
	status, stdout, stderr := invoke("sibling.go", "sample.go")
	if status != 0 || stderr != "" {
		t.Fatalf("status %d, stderr %q", status, stderr)
	}
	first := strings.Index(stdout, "# Inventory: sibling.go")
	second := strings.Index(stdout, "# Inventory: sample.go")
	if first < 0 || second <= first || strings.Count(stdout, "\n---\n") != 2 {
		t.Fatalf("outputs not in argument order or missing separators:\n%s", stdout)
	}
}

func TestGeneratedCgoBodylessAndLineSignals(t *testing.T) {
	root := newModule(t)
	source := `// Code generated by fixture. DO NOT EDIT.
//go:build linux
// +build linux
package sample

/* C preamble */
import ` + "`C`" + `

//line ignored.go:80
/*line ignored.go:90*/
const A, B = 1, 2

var (
	Ready = true
)

//go:noescape
func Assembly()

type T int

//export bridge
func (T) bridge()
`
	writeTestFile(t, filepath.Join(root, "sample.go"), source)
	status, stdout, stderr := invoke("sample.go")
	if status != 0 || stderr != "" {
		t.Fatalf("status %d, stderr %q", status, stderr)
	}
	got := section(stdout, "## Go refactor signals", "## Same-package references")
	want := `## Go refactor signals

- L1: generated file — do not edit; regenerate from its owner
- L2: ` + "`//go:build linux`" + ` — directive; preserve its attachment and semantics
- L3: ` + "`// +build linux`" + ` — directive; preserve its attachment and semantics
- L7: ` + "`import \"C\"`" + ` — cgo boundary; preserve the immediately preceding C preamble
- L9: ` + "`//line ignored.go:80`" + ` — directive; preserve its attachment and semantics
- L9-11: const spec ` + "`A`, `B`" + ` — names share one declaration; move together
- L10: ` + "`/*line ignored.go:90*/`" + ` — directive; preserve its attachment and semantics
- L13-15: var group ` + "`Ready`" + ` — move the whole declaration together
- L14: initialized var ` + "`Ready`" + ` — package initialization order may be load-bearing
- L17: ` + "`//go:noescape`" + ` — directive; preserve its attachment and semantics
- L17-18: bodyless function ` + "`Assembly`" + ` — inspect assembly/cgo/linkname implementation before moving
- L22: ` + "`//export bridge`" + ` — directive; preserve its attachment and semantics
- L22-23: bodyless method ` + "`(T).bridge`" + ` — inspect assembly/cgo/linkname implementation before moving

`
	if got != want {
		t.Fatalf("signal section mismatch\nwant:\n%s\ngot:\n%s", want, got)
	}
}

func TestPackageRoles(t *testing.T) {
	root := newModule(t)
	writeTestFile(t, filepath.Join(root, "prod.go"), "package sample\n")
	writeTestFile(t, filepath.Join(root, "prod_test.go"), "package sample\n")
	writeTestFile(t, filepath.Join(root, "external_test.go"), "package sample_test\n")
	for file, role := range map[string]string{"prod.go": "production", "prod_test.go": "internal test", "external_test.go": "external test"} {
		status, stdout, stderr := invoke(file)
		if status != 0 || stderr != "" || !strings.Contains(stdout, "- File role: "+role+"\n") {
			t.Errorf("%s: status %d, stdout %q, stderr %q", file, status, stdout, stderr)
		}
		if role == "external test" && !strings.Contains(stdout, "(not applicable: this file's package is not the importable package selected by `go list`)") {
			t.Errorf("%s lacks not-applicable explanation", file)
		}
	}

	mixed := filepath.Join(root, "mixed")
	writeTestFile(t, filepath.Join(mixed, "a.go"), "package primary\n")
	writeTestFile(t, filepath.Join(mixed, "z.go"), "package alternate\n")
	status, stdout, stderr := invoke("mixed/z.go")
	if status != 0 || stderr != "" || !strings.Contains(stdout, "- File role: alternate package in directory\n") ||
		!strings.Contains(stdout, "(not applicable: this file's package is not the importable package selected by `go list`)") {
		t.Fatalf("alternate package: status %d, stdout %q, stderr %q", status, stdout, stderr)
	}

	nested := filepath.Join(root, "nested")
	writeTestFile(t, filepath.Join(nested, "go.mod"), "module example.net/nested-path\n\ngo 1.24\n")
	writeTestFile(t, filepath.Join(nested, "nested.go"), "package oddname\n")
	status, stdout, stderr = invoke("nested/nested.go")
	if status != 0 || stderr != "" || !strings.Contains(stdout, "- Import path: `example.net/nested-path`\n") {
		t.Fatalf("nested module: status %d, stdout %q, stderr %q", status, stdout, stderr)
	}
}

func TestBlankFunctionAndMethodNamesAreCanonical(t *testing.T) {
	root := newModule(t)
	writeTestFile(t, filepath.Join(root, "target.go"), "package sample\ntype T int\nfunc _() {}\nfunc (T) _() {}\nvar _ int\n")
	status, stdout, stderr := invoke("target.go")
	if status != 0 || stderr != "" {
		t.Fatalf("status %d, stderr %q", status, stderr)
	}
	for _, row := range []string{
		"| function | `_ (occurrence 1)` | 3-3 | no |",
		"| method | `(T)._ (occurrence 2)` | 4-4 | no |",
		"| var | `_ (occurrence 3)` | 5-5 | no |",
	} {
		if !strings.Contains(stdout, row+"\n") {
			t.Errorf("missing declaration row %q", row)
		}
	}
}

func TestSamePackageReferencesAreConservativeAndOrdered(t *testing.T) {
	root := newModule(t)
	writeTestFile(t, filepath.Join(root, "target.go"), "package sample\nvar A, B int\nfunc M() {}\nfunc init() {}\nvar _ int\n")
	writeTestFile(t, filepath.Join(root, "z.go"), "package sample\nvar _ = B\nvar _ = A\n")
	writeTestFile(t, filepath.Join(root, "a.go"), "package sample\nvar _ = M\nvar _ = A\n")
	writeTestFile(t, filepath.Join(root, "none.go"), "package sample\n")
	status, stdout, stderr := invoke("target.go")
	if status != 0 || stderr != "" {
		t.Fatalf("status %d, stderr %q", status, stderr)
	}
	got := section(stdout, "## Same-package references", "## Imported by")
	want := "## Same-package references (conservative syntax scan)\n\n- `a.go` references: `M`, `A`\n- `z.go` references: `B`, `A`\n\n"
	if got != want || strings.Contains(got, "init") || strings.Contains(got, "occurrence") {
		t.Fatalf("reference section mismatch\nwant:\n%s\ngot:\n%s", want, got)
	}
}

func TestImporterFormsAndPackageName(t *testing.T) {
	root := newModule(t)
	writeTestFile(t, filepath.Join(root, "target.go"), "package oddname\nconst A = 1\nconst B = 2\n")
	writeTestFile(t, filepath.Join(root, "a_default.go"), "package oddname\n")
	writeTestFile(t, filepath.Join(root, "users", "alias.go"), "package users\nimport x \"example.com/testroot\"\nvar _ = x.B\nvar _ = x.A\n")
	writeTestFile(t, filepath.Join(root, "users", "blank.go"), "package users\nimport _ \"example.com/testroot\"\n")
	writeTestFile(t, filepath.Join(root, "users", "default.go"), "package users\nimport \"example.com/testroot\"\nvar _ = oddname.A\n")
	writeTestFile(t, filepath.Join(root, "users", "dot.go"), "package users\nimport . \"example.com/testroot\"\nvar _ = A\n")
	writeTestFile(t, filepath.Join(root, "users", "none.go"), "package users\nimport p \"example.com/testroot\"\nvar _ = func() any { p := 1; return p }\n")
	status, stdout, stderr := invoke("target.go")
	if status != 0 || stderr != "" {
		t.Fatalf("status %d, stderr %q", status, stderr)
	}
	for _, line := range []string{
		"- `users/alias.go` imports as `x`; selectors: `B`, `A`",
		"- `users/blank.go`: side-effect import; package initialization is load-bearing",
		"- `users/default.go` imports as `oddname`; selectors: `A`",
		"- `users/dot.go`: dot import; all exported names potentially load-bearing",
		"- `users/none.go` imports as `p`; selectors: (none found)",
	} {
		if !strings.Contains(stdout, line+"\n") {
			t.Errorf("missing consumer line %q", line)
		}
	}
}

func TestGitUntrackedAndNonGitDiscovery(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable")
	}
	root := newModule(t)
	writeTestFile(t, filepath.Join(root, "target.go"), "package sample\nconst A = 1\n")
	writeTestFile(t, filepath.Join(root, "tracked", "tracked.go"), "package tracked\nimport x \"example.com/testroot\"\nvar _ = x.A\n")
	writeTestFile(t, filepath.Join(root, "untracked", "untracked.go"), "package untracked\nimport x \"example.com/testroot\"\nvar _ = x.A\n")
	writeTestFile(t, filepath.Join(root, "ignored", "ignored.go"), "package ignored\nimport x \"example.com/testroot\"\nvar _ = x.A\n")
	writeTestFile(t, filepath.Join(root, ".gitignore"), "ignored/\n")
	for _, args := range [][]string{{"init", "-q"}, {"add", "go.mod", "target.go", "tracked/ tracked.go"}} {
		if args[0] == "add" {
			args = []string{"add", "go.mod", "target.go", "tracked/tracked.go", ".gitignore"}
		}
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
	}
	status, gitOutput, stderr := invoke("target.go")
	if status != 0 || stderr != "" {
		t.Fatalf("git run: status %d, stderr %q", status, stderr)
	}
	if !strings.Contains(gitOutput, "tracked/tracked.go") || !strings.Contains(gitOutput, "untracked/untracked.go") || strings.Contains(gitOutput, "ignored/ignored.go") {
		t.Fatalf("unexpected git discovery:\n%s", gitOutput)
	}
	if err := os.RemoveAll(filepath.Join(root, ".git")); err != nil {
		t.Fatal(err)
	}
	status, walkOutput, stderr := invoke("target.go")
	if status != 0 || stderr != "" || !strings.Contains(walkOutput, "ignored/ignored.go") {
		t.Fatalf("filesystem run: status %d, stderr %q, output:\n%s", status, stderr, walkOutput)
	}
}

func TestImporterPreambleFailureIsLoud(t *testing.T) {
	root := newModule(t)
	writeTestFile(t, filepath.Join(root, "target.go"), "package sample\n")
	writeTestFile(t, filepath.Join(root, "nested", "broken.go"), "package nested\nimport (\n")
	status, stdout, stderr := invoke("target.go")
	if status != 1 || stdout != "" || !strings.HasPrefix(stderr, "inventory: importer scan: nested/broken.go: parse: nested/broken.go:2:") {
		t.Fatalf("status %d, stdout %q, stderr %q", status, stdout, stderr)
	}
}

func TestIntentionalMalformedFixtureCannotHideTargetImport(t *testing.T) {
	root := newModule(t)
	writeTestFile(t, filepath.Join(root, "target.go"), "package sample\n")
	writeTestFile(t, filepath.Join(root, "nested", "irrelevant.go"), "package broken\n// ERROR intentional parser fixture\nimport \"other.example/package\",\n")
	status, _, stderr := invoke("target.go")
	if status != 0 || stderr != "" {
		t.Fatalf("irrelevant intentional fixture: status %d, stderr %q", status, stderr)
	}

	writeTestFile(t, filepath.Join(root, "nested", "relevant.go"), "package broken\n// ERROR intentional parser fixture\nimport \"example.com/testroot\",\n")
	status, stdout, stderr := invoke("target.go")
	if status != 1 || stdout != "" || !strings.HasPrefix(stderr, "inventory: importer scan: nested/relevant.go: parse:") {
		t.Fatalf("relevant intentional fixture: status %d, stdout %q, stderr %q", status, stdout, stderr)
	}

	if err := os.Remove(filepath.Join(root, "nested", "relevant.go")); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(root, "nested", "unterminated.go"), "package broken\n// ERROR intentional parser fixture\nimport \"example.com/testroot\n")
	status, stdout, stderr = invoke("target.go")
	if status != 1 || stdout != "" || !strings.HasPrefix(stderr, "inventory: importer scan: nested/unterminated.go: parse:") {
		t.Fatalf("unterminated target import fixture: status %d, stdout %q, stderr %q", status, stdout, stderr)
	}

	if err := os.Remove(filepath.Join(root, "nested", "unterminated.go")); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(root, "nested", "escaped.go"), "package broken\n// ERROR intentional parser fixture\nimport \"example.com/test\\x72oot\",\n")
	status, stdout, stderr = invoke("target.go")
	if status != 1 || stdout != "" || !strings.HasPrefix(stderr, "inventory: importer scan: nested/escaped.go: parse:") {
		t.Fatalf("escaped target import fixture: status %d, stdout %q, stderr %q", status, stdout, stderr)
	}

	if err := os.Remove(filepath.Join(root, "nested", "escaped.go")); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(root, "nested", "escaped_unterminated.go"), "package broken\n// ERROR intentional parser fixture\nimport \"example.com/test\\x72oot\n")
	status, stdout, stderr = invoke("target.go")
	if status != 1 || stdout != "" || !strings.HasPrefix(stderr, "inventory: importer scan: nested/escaped_unterminated.go: parse:") {
		t.Fatalf("unterminated escaped target import fixture: status %d, stdout %q, stderr %q", status, stdout, stderr)
	}
}

func TestDeterministicAndReadOnly(t *testing.T) {
	fixture := "fixtures"
	before := hashTree(t, fixture)
	t.Chdir(fixture)
	status1, stdout1, stderr1 := invoke("sample.go")
	status2, stdout2, stderr2 := invoke("sample.go")
	if status1 != 0 || status2 != 0 || stderr1 != "" || stderr2 != "" || stdout1 != stdout2 {
		t.Fatalf("runs differ: statuses %d/%d, stderr %q/%q", status1, status2, stderr1, stderr2)
	}
	t.Chdir("..")
	after := hashTree(t, fixture)
	if fmt.Sprint(before) != fmt.Sprint(after) {
		t.Fatalf("fixture changed\nbefore: %v\nafter: %v", before, after)
	}
}

func TestGOROOTCompilerCorpus(t *testing.T) {
	output, err := exec.Command("go", "env", "GOROOT").Output()
	if err != nil {
		t.Fatal(err)
	}
	goroot := strings.TrimSpace(string(output))
	sourceRoot := filepath.Join(goroot, "src")
	files := []string{"cmd/compile/internal/ssagen/ssa.go", "cmd/compile/internal/ssa/likelyadjust.go"}
	for _, file := range files {
		if _, err := os.Stat(filepath.Join(sourceRoot, file)); err != nil {
			t.Skipf("compiler corpus unavailable: %v", err)
		}
	}
	t.Chdir(sourceRoot)
	status, stdout1, stderr := invoke(files...)
	if status != 0 || stderr != "" {
		t.Fatalf("corpus run: status %d, stderr %q", status, stderr)
	}
	status, stdout2, stderr := invoke(files...)
	if status != 0 || stderr != "" || stdout1 != stdout2 {
		t.Fatalf("corpus is not deterministic: status %d, stderr %q", status, stderr)
	}
	for _, file := range files {
		if !strings.Contains(stdout1, "# Inventory: "+file+"\n") {
			t.Errorf("missing header for %s", file)
		}
		assertDeclarationOracle(t, filepath.Join(sourceRoot, file), stdout1, file)
	}
	if !strings.Contains(stdout1, "`cmd/compile/internal/ssagen/ssa.go` imports as `ssa`") {
		t.Error("known ssagen importer missing")
	}
	if !strings.Contains(stdout1, "`cmd/compile/internal/ssa/compile.go` references: `String`, `likelyadjust`") {
		t.Error("known same-package references missing")
	}
}

func firstDifference(want, got string) string {
	if want == got {
		return ""
	}
	wantLines, gotLines := strings.Split(want, "\n"), strings.Split(got, "\n")
	for i := 0; i < len(wantLines) && i < len(gotLines); i++ {
		if wantLines[i] != gotLines[i] {
			return fmt.Sprintf("golden differs at line %d\nwant: %q\n got: %q", i+1, wantLines[i], gotLines[i])
		}
	}
	return fmt.Sprintf("golden length differs: want %d bytes, got %d", len(want), len(got))
}

func section(output, start, end string) string {
	startIndex := strings.Index(output, start)
	if startIndex < 0 {
		return ""
	}
	endIndex := strings.Index(output[startIndex:], end)
	if endIndex < 0 {
		return output[startIndex:]
	}
	return output[startIndex : startIndex+endIndex]
}

func hashTree(t *testing.T, root string) []string {
	t.Helper()
	var hashes []string
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		contents, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		hashes = append(hashes, fmt.Sprintf("%s:%x", filepath.ToSlash(rel), sha256.Sum256(contents)))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(hashes)
	return hashes
}

// assertDeclarationOracle independently enumerates every AST declaration tuple
// and compares it with the rendered table, catching omissions and bad spans at
// compiler-corpus scale without calling a production collector.
func assertDeclarationOracle(t *testing.T, path, output, header string) {
	t.Helper()
	set := token.NewFileSet()
	parsed, err := parser.ParseFile(set, path, nil, parser.ParseComments|parser.SkipObjectResolution|parser.AllErrors)
	if err != nil {
		t.Fatal(err)
	}
	blank, initCount := 0, 0
	canonical := func(name string) string {
		if name == "_" {
			blank++
			return fmt.Sprintf("_ (occurrence %d)", blank)
		}
		return name
	}
	span := func(doc *ast.CommentGroup, start, end token.Pos) (int, int) {
		if doc != nil {
			start = doc.Pos()
		}
		return set.PositionFor(start, false).Line, set.PositionFor(end, false).Line
	}
	var want []string
	add := func(kind, name string, exported bool, start, end int) {
		export := "no"
		if exported {
			export = "yes"
		}
		want = append(want, fmt.Sprintf("| %s | `%s` | %d-%d | %s |", kind, name, start, end, export))
	}
	for _, node := range parsed.Decls {
		switch decl := node.(type) {
		case *ast.GenDecl:
			if decl.Tok != token.CONST && decl.Tok != token.VAR && decl.Tok != token.TYPE {
				continue
			}
			start, end := span(decl.Doc, decl.Pos(), decl.End())
			for _, rawSpec := range decl.Specs {
				switch spec := rawSpec.(type) {
				case *ast.ValueSpec:
					for _, name := range spec.Names {
						add(strings.ToLower(decl.Tok.String()), canonical(name.Name), name.IsExported(), start, end)
					}
				case *ast.TypeSpec:
					kind := "type"
					if spec.Assign.IsValid() {
						kind = "type alias"
					}
					add(kind, canonical(spec.Name.Name), spec.Name.IsExported(), start, end)
				}
			}
		case *ast.FuncDecl:
			start, end := span(decl.Doc, decl.Pos(), decl.End())
			baseName := decl.Name.Name
			kind, name := "function", canonical(baseName)
			if decl.Recv != nil {
				kind = "method"
				var receiver bytes.Buffer
				if err := printer.Fprint(&receiver, set, decl.Recv.List[0].Type); err != nil {
					t.Fatal(err)
				}
				name = "(" + receiver.String() + ")." + name
			} else if baseName == "init" {
				initCount++
				name = fmt.Sprintf("init (occurrence %d)", initCount)
			}
			add(kind, name, decl.Name.IsExported(), start, end)
		}
	}
	inventoryStart := strings.Index(output, "# Inventory: "+header+"\n")
	if inventoryStart < 0 {
		t.Fatalf("missing inventory %s", header)
	}
	inventoryEnd := strings.Index(output[inventoryStart:], "\n---\n")
	block := output[inventoryStart : inventoryStart+inventoryEnd]
	table := section(block, "| Kind | Name | Lines | Exported |", "## Go refactor signals")
	var got []string
	for _, line := range strings.Split(table, "\n") {
		if strings.HasPrefix(line, "| ") && !strings.HasPrefix(line, "| Kind ") {
			got = append(got, line)
		}
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("%s declaration tuples differ\ngot %d: %v\nwant %d: %v", header, len(got), got, len(want), want)
	}
}

func TestMain(m *testing.M) {
	// Tests use t.Chdir and therefore intentionally run serially. Keep runtime
	// referenced so vet also checks this file under all supported platforms.
	_ = runtime.GOOS
	os.Exit(m.Run())
}
