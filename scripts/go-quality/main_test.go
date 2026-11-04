// Package quality pins the Go host's lint policy and source structure to the Retrom backend's requirements.
package quality

import (
	"bufio"
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"
)

const (
	productionLimit = 1000
	testLimit       = 1200
)

var root = filepath.Join("..", "..")

func TestGoLintPolicy(t *testing.T) {
	contents, err := os.ReadFile(filepath.Join(root, ".golangci.yml"))
	if err != nil {
		t.Fatal(err)
	}
	var configuration struct {
		Linters struct {
			Default    string                    `yaml:"default"`
			Enable     []string                  `yaml:"enable"`
			Settings   map[string]map[string]any `yaml:"settings"`
			Exclusions map[string]any            `yaml:"exclusions"`
		} `yaml:"linters"`
		Run struct {
			Tests *bool `yaml:"tests"`
		} `yaml:"run"`
	}
	if err = yaml.Unmarshal(contents, &configuration); err != nil {
		t.Fatal(err)
	}
	wanted := []string{
		"asasalint", "bodyclose", "canonicalheader", "contextcheck", "copyloopvar", "depguard", "dogsled",
		"dupl", "err113", "errcheck", "errorlint", "exhaustive", "fatcontext", "forbidigo", "funlen",
		"gochecknoinits", "gocognit", "gocritic", "gocyclo", "govet", "ineffassign", "interfacebloat", "lll",
		"makezero", "misspell", "nakedret", "nestif", "nilerr", "nilnil", "noctx", "nolintlint",
		"nonamedreturns", "prealloc", "predeclared", "revive", "rowserrcheck", "sqlclosecheck", "staticcheck",
		"unconvert", "unparam", "unused", "whitespace", "wrapcheck",
	}
	for _, required := range wanted {
		found := false
		for _, enabled := range configuration.Linters.Enable {
			found = found || enabled == required
		}
		if !found {
			t.Errorf("required Go linter removed: %s", required)
		}
	}
	limits := map[string]map[string]any{
		"dupl": {"threshold": 120}, "funlen": {"lines": 150, "statements": 100},
		"gocognit": {"min-complexity": 25}, "gocyclo": {"min-complexity": 15},
		"interfacebloat": {"max": 10}, "lll": {"line-length": 120}, "nestif": {"min-complexity": 4},
		"errcheck":   {"check-type-assertions": true},
		"nolintlint": {"allow-unused": false, "require-explanation": true, "require-specific": true},
	}
	for linter, settings := range limits {
		for key, maximum := range settings {
			if actual := configuration.Linters.Settings[linter][key]; !reflect.DeepEqual(actual, maximum) {
				t.Errorf("%s.%s=%v expected %v", linter, key, actual, maximum)
			}
		}
	}
	wantedExclusions := map[string]any{
		"generated": "strict", "warn-unused": true,
		"rules": []any{map[string]any{
			"path": `_test\.go`, "linters": []any{"dupl", "err113", "lll", "wrapcheck"},
		}},
	}
	tests := configuration.Run.Tests == nil || *configuration.Run.Tests
	if configuration.Linters.Default != "none" || !tests ||
		!reflect.DeepEqual(configuration.Linters.Exclusions, wantedExclusions) {
		t.Error("lint must include tests and retain the reviewed exclusion scope")
	}
}

var suppression = regexp.MustCompile(`//\s*nolint`)

// TestGoStructure applies the backend source-size limits and admits no lint suppression.
func TestGoStructure(t *testing.T) {
	count := 0
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			switch entry.Name() {
			case "node_modules", ".git", "dist", "testdata", ".cache", ".artifacts":
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		count++
		checkSource(t, path)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if count == 0 {
		t.Fatal("no Go sources found")
	}
}

func checkSource(t *testing.T, path string) {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	limit := productionLimit
	if strings.HasSuffix(path, "_test.go") {
		limit = testLimit
	}
	lines := bytes.Count(contents, []byte("\n"))
	if len(contents) > 0 && !bytes.HasSuffix(contents, []byte("\n")) {
		lines++
	}
	if lines > limit {
		t.Errorf("%s: %d lines exceeds %d", path, lines, limit)
	}
	scanner := bufio.NewScanner(bytes.NewReader(contents))
	scanner.Buffer(make([]byte, 0, 64*1024), len(contents)+1)
	for number := 1; scanner.Scan(); number++ {
		if suppression.MatchString(scanner.Text()) {
			t.Errorf("%s:%d: lint suppression is not allowed", path, number)
		}
	}
}
