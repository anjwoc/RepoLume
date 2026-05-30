// Package runner — Codex CLI runner.
//
// Uses `codex exec "prompt"` (non-interactive subcommand).
// The user must be authenticated via `codex login` (OpenAI Codex subscription).
package runner

import (
	"context"
	"os/exec"
	"strings"

	"github.com/localwiki/agent/internal/stream"
)

// CodexRunner runs prompts via the `codex exec` subcommand (0.134.0+).
type CodexRunner struct {
	model       string // override; empty = use DefaultModel()
	sandboxPerms string // e.g. "disk-full-read-access"
}

// NewCodexRunner creates a runner, optionally overriding model and sandbox perms.
func NewCodexRunner(model, sandboxPerms string) *CodexRunner {
	return &CodexRunner{model: model, sandboxPerms: sandboxPerms}
}

func (r *CodexRunner) Name() string        { return "codex" }
func (r *CodexRunner) DefaultModel() string { return "gpt-5.5" }
func (r *CodexRunner) FlashModel() string   { return "gpt-5.5" }
func (r *CodexRunner) ProModel() string     { return "gpt-5.5" }

// Available checks whether the `codex` binary is on PATH.
func (r *CodexRunner) Available() bool {
	_, err := exec.LookPath("codex")
	return err == nil
}

// Run executes the prompt via `codex exec` and returns a streaming channel.
//
//	codex exec [-c model="MODEL"] [-c sandbox_permissions=["..."]] "PROMPT"
func (r *CodexRunner) Run(ctx context.Context, req RunRequest) (<-chan Chunk, error) {
	args := r.buildArgs(req)
	cmd := exec.CommandContext(ctx, "codex", args...)
	cmd.Dir = req.Cwd
	cmd.Stdin = strings.NewReader(req.Prompt)
	lines, err := stream.PipeCmd(cmd)
	if err != nil {
		return nil, err
	}
	return StringsToChunks(lines), nil
}

// RunCollect executes the prompt synchronously and collects full output.
func (r *CodexRunner) RunCollect(ctx context.Context, req RunRequest) (RunResult, error) {
	args := r.buildArgs(req)
	cmd := exec.CommandContext(ctx, "codex", args...)
	cmd.Dir = req.Cwd
	cmd.Stdin = strings.NewReader(req.Prompt)

	out, err := stream.CollectOutput(cmd)
	if err != nil {
		return RunResult{}, err
	}
	// Clean up codex CLI extra output like "tokens used\nXXXX" or "codex\n" prefix.
	out = cleanCodexOutput(out)
	model := r.resolveModel(req)
	return RunResult{Content: out, Model: model, Agent: r.Name()}, nil
}

func cleanCodexOutput(out string) string {
	lines := strings.Split(out, "\n")
	var result []string
	started := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !started {
			if trimmed == "codex" {
				started = true
			}
			continue
		}
		if trimmed == "tokens used" {
			break // Stop collecting when tokens used is encountered
		}
		result = append(result, line)
	}
	
	// Fallback if 'codex' wasn't found, just return original out
	if !started && len(result) == 0 {
		return strings.TrimSpace(out)
	}

	return strings.TrimSpace(strings.Join(result, "\n"))
}

func (r *CodexRunner) buildArgs(req RunRequest) []string {
	args := []string{"exec"}

	model := r.resolveModel(req)
	if model != "" {
		args = append(args, "-c", `model="`+model+`"`)
	}

	// Grant read access to the repo so codex can inspect files.
	perms := r.sandboxPerms
	if perms == "" {
		perms = "disk-full-read-access"
	}
	args = append(args, "-c", `sandbox_permissions=["`+perms+`"]`)

	// Do not append req.Prompt to args to avoid ARG_MAX "Argument list too long" errors.
	// We will pass it via Stdin.
	return args
}

func (r *CodexRunner) resolveModel(req RunRequest) string {
	if req.Model != "" {
		return req.Model
	}
	if r.model != "" {
		return r.model
	}
	return r.DefaultModel()
}
