// localwiki-agent — CLI launcher for Gemini, Codex, and Claude Code.
//
// Usage:
//
//	localwiki-agent run --agent gemini --prompt "..." [--cwd /path/to/repo] [--model gemini-2.5-pro]
//	localwiki-agent run --agent codex  --prompt-file /tmp/prompt.txt [--cwd ...]
//	localwiki-agent list  # list available agents
//
// Output is written to stdout as JSON:
//
//	{"agent":"gemini","model":"gemini-2.5-flash","content":"..."}
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/localwiki/agent/internal/runner"
)

// jsonOutput is the structured response sent to Python.
type jsonOutput struct {
	Agent   string `json:"agent"`
	Model   string `json:"model"`
	Content string `json:"content"`
	Error   string `json:"error,omitempty"`
	Elapsed string `json:"elapsed_ms"`
}

type jsonlEvent struct {
	Type    string `json:"type"`
	Agent   string `json:"agent,omitempty"`
	Model   string `json:"model,omitempty"`
	Source  string `json:"source,omitempty"`
	Content string `json:"content,omitempty"`
	Error   string `json:"error,omitempty"`
	Elapsed string `json:"elapsed_ms,omitempty"`
}

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	switch os.Args[1] {
	case "run":
		os.Exit(cmdRun(os.Args[2:]))
	case "list":
		os.Exit(cmdList())
	case "check":
		os.Exit(cmdCheck(os.Args[2:]))
	default:
		fmt.Fprintf(os.Stderr, "unknown subcommand %q\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

// cmdRun handles `localwiki-agent run ...`
func cmdRun(args []string) int {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	agentName := fs.String("agent", "gemini", "Agent to use: gemini | codex | claude")
	prompt := fs.String("prompt", "", "Prompt string (use --prompt-file for long prompts)")
	promptFile := fs.String("prompt-file", "", "File containing the prompt")
	cwd := fs.String("cwd", ".", "Working directory (repo path)")
	model := fs.String("model", "", "Model override (e.g. gemini-2.5-pro)")
	geminiModel := fs.String("gemini-model", "", "Default Gemini model")
	codexModel := fs.String("codex-model", "", "Default Codex model")
	claudeModel := fs.String("claude-model", "", "Default Claude model")
	timeoutSec := fs.Int("timeout", 300, "Timeout in seconds")
	streamJSONL := fs.Bool("stream-jsonl", false, "Emit newline-delimited JSON status/chunk/error/complete events")
	_ = fs.Parse(args)

	// Resolve prompt
	promptText := *prompt
	if *promptFile != "" {
		data, err := os.ReadFile(*promptFile)
		if err != nil {
			fatal("cannot read prompt file: %v", err)
		}
		promptText = strings.TrimSpace(string(data))
	}
	if promptText == "" {
		fatal("--prompt or --prompt-file is required")
	}

	// Build registry
	reg := runner.NewRegistry(*geminiModel, *codexModel, *claudeModel)
	r, err := reg.Get(*agentName)
	if err != nil {
		fatal("%v", err)
	}
	if !r.Available() {
		if *streamJSONL {
			emitJSONL(jsonlEvent{
				Type:  "error",
				Agent: *agentName,
				Error: fmt.Sprintf("%s CLI not found in PATH. Install it first.", *agentName),
			})
			return 1
		}
		outputError(*agentName, fmt.Sprintf("%s CLI not found in PATH. Install it first.", *agentName))
		return 1
	}

	// Context with timeout + SIGINT handling
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(*timeoutSec)*time.Second)
	defer cancel()
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		cancel()
	}()

	req := runner.RunRequest{
		Prompt: promptText,
		Cwd:    *cwd,
		Model:  *model,
	}

	t0 := time.Now()
	if *streamJSONL {
		return runJSONL(ctx, r, req, t0)
	}

	result, err := r.RunCollect(ctx, req)
	elapsed := time.Since(t0)

	if err != nil {
		outputError(*agentName, err.Error())
		return 1
	}

	out := jsonOutput{
		Agent:   result.Agent,
		Model:   result.Model,
		Content: result.Content,
		Elapsed: fmt.Sprintf("%d", elapsed.Milliseconds()),
	}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		fmt.Fprintf(os.Stderr, "json encode error: %v\n", err)
		return 1
	}
	return 0
}

func runJSONL(ctx context.Context, r runner.Runner, req runner.RunRequest, started time.Time) int {
	model := req.Model
	if model == "" {
		model = r.DefaultModel()
	}
	emitJSONL(jsonlEvent{Type: "status", Agent: r.Name(), Model: model, Content: "agent started"})

	ch, err := r.Run(ctx, req)
	if err != nil {
		emitJSONL(jsonlEvent{Type: "error", Agent: r.Name(), Model: model, Error: err.Error()})
		return 1
	}

	content, err := runner.CollectChunksWithCallback(ch, func(chunk runner.Chunk) {
		if chunk.Text != "" {
			emitJSONL(jsonlEvent{
				Type:    "chunk",
				Agent:   r.Name(),
				Model:   model,
				Source:  sourceOrDefault(chunk.Source),
				Content: chunk.Text,
			})
		}
	})
	if err != nil {
		emitJSONL(jsonlEvent{Type: "error", Agent: r.Name(), Model: model, Error: err.Error()})
		return 1
	}

	emitJSONL(jsonlEvent{
		Type:    "complete",
		Agent:   r.Name(),
		Model:   model,
		Content: content,
		Elapsed: fmt.Sprintf("%d", time.Since(started).Milliseconds()),
	})
	return 0
}

func emitJSONL(event jsonlEvent) {
	_ = json.NewEncoder(os.Stdout).Encode(event)
}

func sourceOrDefault(source string) string {
	if source == "" {
		return "stdout"
	}
	return source
}

// cmdList prints available agents.
func cmdList() int {
	reg := runner.NewRegistry("", "", "")
	available := reg.Available()
	all := []string{"gemini", "codex", "claude"}

	fmt.Println("LocalWiki Agent Status:")
	for _, name := range all {
		r, _ := reg.Get(name)
		status := "❌ not found"
		if r.Available() {
			status = fmt.Sprintf("✅ available (default: %s, flash: %s, pro: %s)",
				r.DefaultModel(), r.FlashModel(), r.ProModel())
		}
		fmt.Printf("  %-8s %s\n", name, status)
	}
	fmt.Printf("\nAvailable: %s\n", strings.Join(available, ", "))
	return 0
}

// cmdCheck exits 0 if the named agent is available, 1 otherwise.
func cmdCheck(args []string) int {
	if len(args) == 0 {
		fatal("check requires an agent name")
	}
	reg := runner.NewRegistry("", "", "")
	r, err := reg.Get(args[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if !r.Available() {
		fmt.Fprintf(os.Stderr, "%s is not available\n", args[0])
		return 1
	}
	fmt.Printf("%s OK\n", args[0])
	return 0
}

func outputError(agent, msg string) {
	out := jsonOutput{Agent: agent, Error: msg}
	_ = json.NewEncoder(os.Stdout).Encode(out)
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "localwiki-agent: "+format+"\n", args...)
	os.Exit(1)
}

func printUsage() {
	fmt.Fprintf(os.Stderr, `localwiki-agent — CLI agent launcher

Subcommands:
  run   Execute a prompt via a CLI agent and print JSON result
  list  List available agents
  check Check if an agent CLI is installed

Run usage:
  localwiki-agent run --agent gemini --prompt "Hello" [--cwd /repo] [--model gemini-2.5-pro]
  localwiki-agent run --agent codex  --prompt-file /tmp/p.txt [--timeout 120]
  localwiki-agent run --agent claude --prompt "..." [--model claude-sonnet-4-5]
`)
}
