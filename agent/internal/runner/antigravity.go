// Package runner — Antigravity CLI runner.
//
// Uses `agy --print "prompt"`.
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
func (r *AntigravityRunner) DefaultModel() string { return "gemini-3.1-flash" } // Antigravity uses gemini under the hood
func (r *AntigravityRunner) FlashModel() string   { return "gemini-3.1-flash" }
func (r *AntigravityRunner) ProModel() string     { return "gemini-3.1-pro" }

// Available checks whether the `agy` binary is on PATH.
func (r *AntigravityRunner) Available() bool {
	_, err := exec.LookPath("agy")
	return err == nil
}

// Run executes the prompt in headless mode and returns a streaming channel.
//
//	agy --print "PROMPT"
func (r *AntigravityRunner) Run(ctx context.Context, req RunRequest) (<-chan Chunk, error) {
	// agy supports stdin if prompt is empty string according to test `echo "hello" | agy --prompt ""`
	args := []string{"--prompt", ""}

	// agy는 에이전트이므로 파일을 생성하지 않고 표준 출력으로 반환하도록 강제 지시문 추가
	strictPrompt := req.Prompt + "\n\nCRITICAL INSTRUCTION: DO NOT use any tools to create files or save documents to the workspace or artifact directory. You MUST output the final requested content (e.g. markdown) directly as plain text to standard output so the caller can read it. Do not include any conversational filler, output ONLY the raw markdown content."

	cmd := exec.CommandContext(ctx, "agy", args...)
	cmd.Dir = req.Cwd
	cmd.Stdin = strings.NewReader(strictPrompt)

	lines, err := stream.PipeCmd(cmd)
	if err != nil {
		return nil, err
	}
	return StringsToChunks(lines), nil
}

// RunCollect executes the prompt synchronously and collects full output.
func (r *AntigravityRunner) RunCollect(ctx context.Context, req RunRequest) (RunResult, error) {
	args := []string{"--prompt", ""}

	strictPrompt := req.Prompt + "\n\nCRITICAL INSTRUCTION: DO NOT use any tools to create files or save documents to the workspace or artifact directory. You MUST output the final requested content (e.g. markdown) directly as plain text to standard output so the caller can read it. Do not include any conversational filler, output ONLY the raw markdown content."

	cmd := exec.CommandContext(ctx, "agy", args...)
	cmd.Dir = req.Cwd
	cmd.Stdin = strings.NewReader(strictPrompt)

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
