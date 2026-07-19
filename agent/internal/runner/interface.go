// Package runner defines the common interface for all CLI agent runners.
package runner

import (
	"context"
	"io"

	"github.com/localwiki/agent/internal/stream"
)

// Chunk is a single streaming output chunk from the agent.
type Chunk struct {
	Text   string
	Source string
	Done   bool
	Error  error
}

// RunRequest holds everything needed to invoke a CLI agent.
type RunRequest struct {
	Prompt    string // The user prompt
	Cwd       string // Working directory (repo path)
	Model     string // Model override (empty = default)
	MaxTokens int    // 0 = provider default
}

// RunResult is the collected result after all chunks are consumed.
type RunResult struct {
	Content string
	Model   string // actual model used
	Agent   string // "gemini" | "codex" | "claude"
}

// Runner is the interface every CLI agent runner must implement.
type Runner interface {
	// Name returns the agent identifier ("gemini", "codex", "claude").
	Name() string
	// DefaultModel returns the default model for this runner.
	DefaultModel() string
	// FlashModel returns the lighter/faster model for this runner.
	FlashModel() string
	// ProModel returns the high-quality model for this runner.
	ProModel() string
	// Available reports whether the CLI tool is installed and reachable.
	Available() bool
	// Run executes the prompt and returns a channel of streaming chunks.
	Run(ctx context.Context, req RunRequest) (<-chan Chunk, error)
	// RunCollect executes the prompt and collects the full output synchronously.
	RunCollect(ctx context.Context, req RunRequest) (RunResult, error)
}

// StringsToChunks converts a string channel into a Chunk channel.
func StringsToChunks(lines <-chan string) <-chan Chunk {
	ch := make(chan Chunk, 64)
	go func() {
		defer close(ch)
		for line := range lines {
			ch <- Chunk{Text: line}
		}
		ch <- Chunk{Done: true}
	}()
	return ch
}

func OutputsToChunks(outputs <-chan stream.Output) <-chan Chunk {
	chunks := make(chan Chunk, 64)
	go func() {
		defer close(chunks)
		for output := range outputs {
			chunks <- Chunk{Text: output.Text, Error: output.Error}
		}
		chunks <- Chunk{Done: true}
	}()
	return chunks
}

// CollectChunks drains a chunk channel and returns the concatenated text.
func CollectChunks(ch <-chan Chunk) (string, error) {
	var buf []byte
	for chunk := range ch {
		if chunk.Error != nil {
			return string(buf), chunk.Error
		}
		buf = append(buf, chunk.Text...)
	}
	return string(buf), nil
}

// CollectChunksWithCallback drains a chunk channel, invoking cb for each chunk
// before returning the concatenated text.
func CollectChunksWithCallback(ch <-chan Chunk, cb func(Chunk)) (string, error) {
	var buf []byte
	for chunk := range ch {
		if chunk.Error != nil {
			return string(buf), chunk.Error
		}
		if cb != nil {
			cb(chunk)
		}
		buf = append(buf, chunk.Text...)
	}
	return string(buf), nil
}

// DrainTo writes all chunks to w, returns final error if any.
func DrainTo(ch <-chan Chunk, w io.Writer) error {
	for chunk := range ch {
		if chunk.Error != nil {
			return chunk.Error
		}
		if _, err := io.WriteString(w, chunk.Text); err != nil {
			return err
		}
	}
	return nil
}
