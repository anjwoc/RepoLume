// Package runner — Gemini CLI runner.
//
// Uses `gemini -p "prompt" -m model` (headless mode).
// The user must be authenticated via `gemini auth` (Google One AI Premium).
package runner

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/localwiki/agent/internal/stream"
)

// GeminiRunner runs prompts via the `gemini` CLI (0.44.1+).
type GeminiRunner struct {
	model string // override; empty = use DefaultModel()
}

// NewGeminiRunner creates a runner, optionally overriding the model.
func NewGeminiRunner(model string) *GeminiRunner {
	return &GeminiRunner{model: model}
}

func (r *GeminiRunner) Name() string        { return "gemini" }
func (r *GeminiRunner) DefaultModel() string { return "gemini-3.1-flash" }
func (r *GeminiRunner) FlashModel() string   { return "gemini-3.1-flash" }
func (r *GeminiRunner) ProModel() string     { return "gemini-3.1-pro" }

// Available checks whether the `gemini` binary is on PATH.
func (r *GeminiRunner) Available() bool {
	_, err := exec.LookPath("gemini")
	return err == nil
}

// Run executes the prompt in headless mode and returns a streaming channel.
// stderr is captured and forwarded as an error chunk when stdout produces no content.
//
//	gemini --prompt "" [-m MODEL]  (stdin carries the actual prompt)
func (r *GeminiRunner) Run(ctx context.Context, req RunRequest) (<-chan Chunk, error) {
	args := []string{"--prompt", ""}
	model := r.resolveModel(req)
	if model != "" {
		args = append(args, "--model", model)
	}

	cmd := exec.CommandContext(ctx, "gemini", args...)
	cmd.Dir = req.Cwd
	cmd.Stdin = strings.NewReader(req.Prompt)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	ch := make(chan Chunk, 64)
	go func() {
		defer close(ch)
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
		hasContent := false
		for scanner.Scan() {
			line := scanner.Text()
			if line != "" {
				hasContent = true
				ch <- Chunk{Text: line + "\n"}
			}
		}
		_ = cmd.Wait()
		if !hasContent && stderrBuf.Len() > 0 {
			// Surface the tail of stderr (where the actual error lives) as an error chunk.
			errText := stderrBuf.String()
			if len(errText) > 800 {
				errText = "..." + errText[len(errText)-800:]
			}
			ch <- Chunk{Text: fmt.Sprintf("[gemini stderr] %s", strings.TrimSpace(errText)), Source: "error"}
		}
	}()
	return ch, nil
}

// RunCollect executes the prompt synchronously and collects full output.
func (r *GeminiRunner) RunCollect(ctx context.Context, req RunRequest) (RunResult, error) {
	args := []string{"--prompt", ""}
	model := r.resolveModel(req)
	if model != "" {
		args = append(args, "--model", model)
	}

	cmd := exec.CommandContext(ctx, "gemini", args...)
	cmd.Dir = req.Cwd
	cmd.Stdin = strings.NewReader(req.Prompt)

	out, err := stream.CollectOutput(cmd)
	if err != nil {
		return RunResult{}, err
	}
	return RunResult{Content: out, Model: model, Agent: r.Name()}, nil
}

func (r *GeminiRunner) resolveModel(req RunRequest) string {
	if req.Model != "" {
		return req.Model
	}
	if r.model != "" {
		return r.model
	}
	return r.DefaultModel()
}
