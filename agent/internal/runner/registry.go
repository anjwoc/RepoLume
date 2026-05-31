// Package runner — registry that maps agent names to Runner instances.
package runner

import (
	"fmt"
	"strings"
)

// Registry holds all registered runners.
type Registry struct {
	runners map[string]Runner
}

// NewRegistry returns a Registry pre-populated with Gemini, Codex, and Claude.
// model overrides are applied only when non-empty.
func NewRegistry(geminiModel, codexModel, claudeModel string) *Registry {
	r := &Registry{runners: make(map[string]Runner)}
	r.Register(NewGeminiRunner(geminiModel))
	r.Register(NewCodexRunner(codexModel, ""))
	r.Register(NewClaudeRunner(claudeModel))
	r.Register(NewAntigravityRunner())
	return r
}

// Register adds a Runner under its Name().
func (r *Registry) Register(runner Runner) {
	r.runners[runner.Name()] = runner
}

// Get returns the Runner for the given agent name.
// Aliases: "gpt", "openai" → codex; "anthropic" → claude; "google" → gemini.
func (r *Registry) Get(name string) (Runner, error) {
	name = strings.ToLower(strings.TrimSpace(name))
	// Resolve aliases
	switch name {
	case "gpt", "openai", "codex-cli":
		name = "codex"
	case "anthropic", "claude-code", "claude-cli":
		name = "claude"
	case "google", "gemini-cli":
		name = "gemini"
	case "antigravity", "agy":
		name = "antigravity"
	}
	runner, ok := r.runners[name]
	if !ok {
		return nil, fmt.Errorf("unknown agent %q (valid: gemini, codex, claude, antigravity)", name)
	}
	return runner, nil
}

// Available returns names of all runners where Available() == true.
func (r *Registry) Available() []string {
	var names []string
	for name, runner := range r.runners {
		if runner.Available() {
			names = append(names, name)
		}
	}
	return names
}

// MustGet returns the runner or panics. Useful in tests.
func (r *Registry) MustGet(name string) Runner {
	runner, err := r.Get(name)
	if err != nil {
		panic(err)
	}
	return runner
}
