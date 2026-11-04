package host_test

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/retrom-project/retrom-runtime/host"
)

var update = flag.Bool("update", false, "rewrite golden results from the current implementation")

// goldenCase is one recorded command. ${CASE} names the case directory and ${OUT} a fresh output root.
type goldenCase struct {
	Command string          `json:"command"`
	Input   json.RawMessage `json:"input"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *goldenError    `json:"error,omitempty"`
}

type goldenError struct {
	Code    string            `json:"code"`
	Details map[string]string `json:"details,omitempty"`
}

func TestGolden(t *testing.T) {
	service, err := host.New("")
	if err != nil {
		t.Fatal(err)
	}
	paths, err := filepath.Glob(filepath.Join("testdata", "golden", "*", "*", "case.json"))
	if err != nil || len(paths) == 0 {
		t.Fatalf("golden cases: %v", err)
	}
	sort.Strings(paths)
	for _, path := range paths {
		name := strings.TrimPrefix(filepath.Dir(path), filepath.Join("testdata", "golden")+string(filepath.Separator))
		t.Run(name, func(t *testing.T) { runGolden(t, service, path) })
	}
}

func runGolden(t *testing.T, service *host.Service, path string) {
	t.Helper()
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var item goldenCase
	if err := json.Unmarshal(encoded, &item); err != nil {
		t.Fatal(err)
	}
	directory, err := filepath.Abs(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "out")
	input := strings.NewReplacer("${CASE}", directory, "${OUT}", output).Replace(string(item.Input))
	result, callErr := service.Call(context.Background(), item.Command, []byte(input))
	actual := goldenCase{Command: item.Command, Input: item.Input}
	if callErr != nil {
		var failure *host.Error
		if !errors.As(callErr, &failure) {
			t.Fatalf("untyped failure: %v", callErr)
		}
		actual.Error = &goldenError{Code: failure.Code, Details: failure.Details}
	} else {
		actual.Result = json.RawMessage(strings.NewReplacer(output, "${OUT}", directory, "${CASE}").Replace(string(result)))
	}
	if *update {
		rewrite(t, path, &actual)
		return
	}
	if !reflect.DeepEqual(item.Error, actual.Error) {
		t.Fatalf("error = %+v, want %+v", actual.Error, item.Error)
	}
	if item.Error == nil && !sameJSON(t, item.Result, actual.Result) {
		t.Fatalf("result differs\n got: %.2000s\nwant: %.2000s", actual.Result, item.Result)
	}
}

func sameJSON(t *testing.T, left, right json.RawMessage) bool {
	t.Helper()
	var a, b any
	if err := json.Unmarshal(left, &a); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(right, &b); err != nil {
		t.Fatal(err)
	}
	return reflect.DeepEqual(a, b)
}

func rewrite(t *testing.T, path string, item *goldenCase) {
	t.Helper()
	encoded, err := json.MarshalIndent(item, "", " ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(encoded, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
}
