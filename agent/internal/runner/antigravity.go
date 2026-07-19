// Package runner — Antigravity CLI runner.
package runner

import (
	"context"
	"os/exec"

	"github.com/localwiki/agent/internal/stream"
)

// AntigravityRunner runs prompts via the `agy` CLI.
type AntigravityRunner struct {
}

// NewAntigravityRunner creates a runner.
func NewAntigravityRunner() *AntigravityRunner {
	return &AntigravityRunner{}
}

func (r *AntigravityRunner) Name() string         { return "antigravity" }
func (r *AntigravityRunner) DefaultModel() string { return "agy-gemini-3.5-flash-high" }
func (r *AntigravityRunner) FlashModel() string   { return "agy-gemini-3.5-flash-medium" }
func (r *AntigravityRunner) ProModel() string     { return "agy-gemini-3.1-pro-high" }

// Available checks whether the `agy` binary is on PATH.
func (r *AntigravityRunner) Available() bool {
	_, err := exec.LookPath("agy")
	return err == nil
}

func (r *AntigravityRunner) buildCmd(ctx context.Context, req RunRequest) *exec.Cmd {
	args := []string{"--dangerously-skip-permissions", "--prompt", req.Prompt}
	if req.Model != "" {
		args = append(args, "--model", normalizeAntigravityModel(req.Model))
	}
	cmd := exec.CommandContext(ctx, "agy", args...)
	cmd.Dir = req.Cwd
	return cmd
}

func normalizeAntigravityModel(model string) string {
	models := map[string]string{
		"agy-gemini-3.5-flash-medium": "Gemini 3.5 Flash (Medium)",
		"agy-gemini-3.5-flash-high":   "Gemini 3.5 Flash (High)",
		"agy-gemini-3.5-flash-low":    "Gemini 3.5 Flash (Low)",
		"agy-gemini-3.1-pro-low":      "Gemini 3.1 Pro (Low)",
		"agy-gemini-3.1-pro-high":     "Gemini 3.1 Pro (High)",
	}
	if normalized, ok := models[model]; ok {
		return normalized
	}
	return model
}

// Run executes the prompt and returns a streaming channel of output lines.
func (r *AntigravityRunner) Run(ctx context.Context, req RunRequest) (<-chan Chunk, error) {
	cmd := r.buildCmd(ctx, req)

	lines, err := stream.PipeCmd(cmd)
	if err != nil {
		return nil, err
	}
	return OutputsToChunks(lines), nil
}

// RunCollect executes the prompt synchronously and collects full output.
func (r *AntigravityRunner) RunCollect(ctx context.Context, req RunRequest) (RunResult, error) {
	cmd := r.buildCmd(ctx, req)

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
