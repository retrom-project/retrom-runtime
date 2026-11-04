package host

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestCallRejectsUnknownCommandsAndNonObjectInput(t *testing.T) {
	service, err := New("")
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct{ command, input, code string }{
		{"assemble-resource", `{}`, "RUNTIME_COMMAND_INVALID"},
		{"prepare", `[]`, "RUNTIME_REQUEST_INVALID"},
		{"prepare", ``, "RUNTIME_REQUEST_INVALID"},
		{"prepare", `{"files":3}`, "RUNTIME_REQUEST_INVALID"},
	} {
		_, err := service.Call(context.Background(), item.command, []byte(item.input))
		var failure *Error
		if !errors.As(err, &failure) || failure.Code != item.code {
			t.Errorf("%s %s: %v, want %s", item.command, item.input, err, item.code)
		}
	}
}

func TestCallReportsCancellation(t *testing.T) {
	service, err := New("")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = service.Call(ctx, "storage-layout", []byte(`{}`))
	var failure *Error
	if !errors.As(err, &failure) || failure.Code != "RUNTIME_CANCELLED" {
		t.Fatalf("cancelled call: %v", err)
	}
}

func TestCallContainsHandlerPanics(t *testing.T) {
	panicking := func(*Service, context.Context, json.RawMessage) (any, error) {
		var values []int
		return values[1], nil
	}
	commands["test-panic"] = panicking
	defer delete(commands, "test-panic")
	service, err := New("")
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Call(context.Background(), "test-panic", []byte(`{}`))
	var failure *Error
	if !errors.As(err, &failure) || failure.Code != "RUNTIME_REQUEST_FAILED" {
		t.Fatalf("panic must fail only the request: %v", err)
	}
}

func TestDeadlines(t *testing.T) {
	if Deadline("normalize-content").Hours() != 1 || Deadline("detect-scummvm").Minutes() != 1 ||
		Deadline("prepare").Seconds() != 30 {
		t.Fatal("command deadlines changed")
	}
}
