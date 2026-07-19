package stream

import (
	"os/exec"
	"strings"
	"testing"
)

func TestPipeCmdReturnsExitErrorAndStderr(t *testing.T) {
	outputs, err := PipeCmd(exec.Command("sh", "-c", "echo failure >&2; exit 7"))
	if err != nil {
		t.Fatal(err)
	}
	var processError error
	for output := range outputs {
		if output.Error != nil {
			processError = output.Error
		}
	}
	if processError == nil || !strings.Contains(processError.Error(), "failure") {
		t.Fatalf("missing stderr-backed process error: %v", processError)
	}
}

func TestPipeCmdStreamsStdoutWhileDrainingStderr(t *testing.T) {
	outputs, err := PipeCmd(exec.Command("sh", "-c", "echo visible; echo warning >&2"))
	if err != nil {
		t.Fatal(err)
	}
	var text strings.Builder
	for output := range outputs {
		if output.Error != nil {
			t.Fatal(output.Error)
		}
		text.WriteString(output.Text)
	}
	if text.String() != "visible\n" {
		t.Fatalf("unexpected stdout %q", text.String())
	}
}
