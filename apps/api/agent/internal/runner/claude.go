// Package runner — Claude Code CLI runner.
//
// Uses `claude -p "prompt"` (non-interactive mode).
// The user must be authenticated via `claude auth` (Anthropic Max subscription).
// Install: npm install -g @anthropic-ai/claude-code
package runner

import (
	"context"
	"os/exec"

	"github.com/repolume/agent/internal/stream"
)

// ClaudeRunner runs prompts via the `claude` CLI.
type ClaudeRunner struct {
	model string // override; empty = use DefaultModel()
}

// NewClaudeRunner creates a runner, optionally overriding the model.
func NewClaudeRunner(model string) *ClaudeRunner {
	return &ClaudeRunner{model: model}
}

func (r *ClaudeRunner) Name() string         { return "claude" }
func (r *ClaudeRunner) DefaultModel() string { return "" } // use claude's built-in default
func (r *ClaudeRunner) FlashModel() string   { return "" }
func (r *ClaudeRunner) ProModel() string     { return "claude-sonnet-4-5" }

// Available checks whether the `claude` binary is on PATH.
func (r *ClaudeRunner) Available() bool {
	_, err := exec.LookPath("claude")
	return err == nil
}

// Run executes the prompt via `claude -p` and returns a streaming channel.
//
//	claude -p "PROMPT" [--model MODEL] --output-format stream-json
func (r *ClaudeRunner) Run(ctx context.Context, req RunRequest) (<-chan Chunk, error) {
	args := r.buildArgs(req)
	cmd := exec.CommandContext(ctx, "claude", args...)
	cmd.Dir = req.Cwd
	lines, err := stream.PipeCmd(cmd)
	if err != nil {
		return nil, err
	}
	return OutputsToChunks(lines), nil
}

// RunCollect executes the prompt synchronously and collects full output.
func (r *ClaudeRunner) RunCollect(ctx context.Context, req RunRequest) (RunResult, error) {
	args := r.buildArgs(req)
	cmd := exec.CommandContext(ctx, "claude", args...)
	cmd.Dir = req.Cwd

	out, err := stream.CollectOutput(cmd)
	if err != nil {
		return RunResult{}, err
	}
	model := r.resolveModel(req)
	return RunResult{Content: out, Model: model, Agent: r.Name()}, nil
}

func (r *ClaudeRunner) buildArgs(req RunRequest) []string {
	args := []string{"-p", req.Prompt}
	model := r.resolveModel(req)
	if model != "" {
		args = append(args, "--model", model)
	}
	// Request plain text output (not JSON stream) for simpler parsing.
	args = append(args, "--output-format", "text")
	// Automatically approve permissions for non-interactive execution
	args = append(args, "--dangerously-skip-permissions")
	return args
}

func (r *ClaudeRunner) resolveModel(req RunRequest) string {
	if req.Model != "" {
		return req.Model
	}
	if r.model != "" {
		return r.model
	}
	return r.DefaultModel()
}
