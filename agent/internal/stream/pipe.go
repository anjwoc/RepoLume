// Package stream provides utilities for reading subprocess stdout into a channel.
package stream

import (
	"bufio"
	"fmt"
	"os/exec"
	"strings"
)

// PipeCmd starts cmd, reads stdout line-by-line and sends each line as a
// string on the returned channel. The channel is closed when the process exits.
// Stderr is inherited (passes through to terminal for CLI progress output).
func PipeCmd(cmd *exec.Cmd) (<-chan string, error) {
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	ch := make(chan string, 64)

	go func() {
		defer close(ch)
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
		for scanner.Scan() {
			ch <- scanner.Text() + "\n"
		}
		_ = cmd.Wait()
	}()

	return ch, nil
}

// CollectOutput runs cmd synchronously and returns trimmed stdout.
func CollectOutput(cmd *exec.Cmd) (string, error) {
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		if stderr.Len() > 0 {
			return "", fmt.Errorf("%v: %s", err, stderr.String())
		}
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

