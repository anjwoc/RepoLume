package runner

import (
	"context"
	"testing"
)

func TestRegistryIncludesRequiredCLIAgents(t *testing.T) {
	registry := NewRegistry("", "", "")

	for _, name := range []string{"antigravity", "agy", "codex", "claude"} {
		runner, err := registry.Get(name)
		if err != nil {
			t.Fatalf("required agent %q is missing: %v", name, err)
		}
		if runner == nil {
			t.Fatalf("required agent %q resolved to nil", name)
		}
	}
}

func TestAntigravityCommandUsesPromptArgumentAndNormalizedModel(t *testing.T) {
	runner := NewAntigravityRunner()
	cmd := runner.buildCmd(context.Background(), RunRequest{
		Prompt: "Return OK",
		Model:  "agy-gemini-3.5-flash-medium",
	})
	want := []string{
		"agy",
		"--dangerously-skip-permissions",
		"--prompt",
		"Return OK",
		"--model",
		"Gemini 3.5 Flash (Medium)",
	}
	if len(cmd.Args) != len(want) {
		t.Fatalf("unexpected args: %#v", cmd.Args)
	}
	for index := range want {
		if cmd.Args[index] != want[index] {
			t.Fatalf("arg %d = %q, want %q", index, cmd.Args[index], want[index])
		}
	}
}

func TestAgyAliasResolvesToAntigravity(t *testing.T) {
	registry := NewRegistry("", "", "")

	runner, err := registry.Get("agy")
	if err != nil {
		t.Fatal(err)
	}
	if runner.Name() != "antigravity" {
		t.Fatalf("agy resolved to %q", runner.Name())
	}
	if runner.DefaultModel() != "agy-gemini-3.5-flash-high" {
		t.Fatalf("unexpected antigravity default model %q", runner.DefaultModel())
	}
}

func TestCodexCommandUsesIsolatedSupportedDefaults(t *testing.T) {
	runner := NewCodexRunner("", "")
	args := runner.buildArgs(RunRequest{Prompt: "Return OK"})

	if runner.DefaultModel() != "gpt-5.4-mini" {
		t.Fatalf("unexpected codex default model %q", runner.DefaultModel())
	}
	want := []string{
		"exec",
		"--ignore-user-config",
		"--ignore-rules",
		"--disable", "plugins",
		"--disable", "multi_agent",
		"--disable", "apps",
		"--disable", "hooks",
		"--ephemeral",
		"--skip-git-repo-check",
		"--model", "gpt-5.4-mini",
		"--dangerously-bypass-approvals-and-sandbox",
		"-",
	}
	if len(args) != len(want) {
		t.Fatalf("unexpected args: %#v", args)
	}
	for index := range want {
		if args[index] != want[index] {
			t.Fatalf("arg %d = %q, want %q", index, args[index], want[index])
		}
	}
}
