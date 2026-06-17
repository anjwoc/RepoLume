// Package runner — Antigravity CLI runner.
//
// agy reads from stdin when --prompt "" is given:
//   echo "PROMPT" | agy --prompt ""
package runner

import (
	"context"
	"os/exec"
	"strings"

	"github.com/localwiki/agent/internal/stream"
)

// AntigravityRunner runs prompts via the `agy` CLI.
type AntigravityRunner struct {
}

// NewAntigravityRunner creates a runner.
func NewAntigravityRunner() *AntigravityRunner {
	return &AntigravityRunner{}
}

func (r *AntigravityRunner) Name() string        { return "antigravity" }
func (r *AntigravityRunner) DefaultModel() string { return "gemini-3.1-flash" }
func (r *AntigravityRunner) FlashModel() string   { return "gemini-3.1-flash" }
func (r *AntigravityRunner) ProModel() string     { return "gemini-3.1-pro" }

// Available checks whether the `agy` binary is on PATH.
func (r *AntigravityRunner) Available() bool {
	_, err := exec.LookPath("agy")
	return err == nil
}

// Run executes the prompt via stdin (agy reads stdin when --prompt "" is set)
// and returns a streaming channel of output lines.
func (r *AntigravityRunner) Run(ctx context.Context, req RunRequest) (<-chan Chunk, error) {
	cmd := exec.CommandContext(ctx, "agy", "--prompt", "")
	cmd.Dir = req.Cwd
	cmd.Stdin = strings.NewReader(req.Prompt)

	lines, err := stream.PipeCmd(cmd)
	if err != nil {
		return nil, err
	}
	return StringsToChunks(lines), nil
}

// RunCollect executes the prompt synchronously and collects full output.
func (r *AntigravityRunner) RunCollect(ctx context.Context, req RunRequest) (RunResult, error) {
	cmd := exec.CommandContext(ctx, "agy", "--prompt", "")
	cmd.Dir = req.Cwd
	cmd.Stdin = strings.NewReader(req.Prompt)

	out, err := stream.CollectOutput(cmd)
	if err != nil {
		return RunResult{}, err
	}
	resolvedModel := req.Model
	if resolvedModel == "" {
		resolvedModel = r.DefaultModel()
	}
	return RunResult{Content: out, Model: resolvedModel, Agent: r.Name()}, nil
}
