// Package stream provides utilities for reading subprocess stdout into a channel.
package stream

import (
	"bufio"
	"fmt"
	"os/exec"
	"strings"
	"sync"
)

type Output struct {
	Text  string
	Error error
}

// PipeCmd starts cmd, reads stdout line-by-line and sends each line as a
// string on the returned channel. The channel is closed when the process exits.
func PipeCmd(cmd *exec.Cmd) (<-chan Output, error) {
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	ch := make(chan Output, 64)

	go func() {
		defer close(ch)
		var stderrText strings.Builder
		var stdoutError error
		var stderrError error
		var waitGroup sync.WaitGroup
		waitGroup.Add(2)
		go func() {
			defer waitGroup.Done()
			scanner := bufio.NewScanner(stdout)
			scanner.Buffer(make([]byte, 1024*1024), 100*1024*1024)
			for scanner.Scan() {
				ch <- Output{Text: scanner.Text() + "\n"}
			}
			stdoutError = scanner.Err()
		}()
		go func() {
			defer waitGroup.Done()
			scanner := bufio.NewScanner(stderr)
			scanner.Buffer(make([]byte, 1024*1024), 100*1024*1024)
			for scanner.Scan() {
				stderrText.WriteString(scanner.Text())
				stderrText.WriteByte('\n')
			}
			stderrError = scanner.Err()
		}()
		waitGroup.Wait()
		if stdoutError != nil {
			ch <- Output{Error: stdoutError}
			return
		}
		if stderrError != nil {
			ch <- Output{Error: stderrError}
			return
		}
		if waitError := cmd.Wait(); waitError != nil {
			message := strings.TrimSpace(stderrText.String())
			if message != "" {
				waitError = fmt.Errorf("%w: %s", waitError, message)
			}
			ch <- Output{Error: waitError}
		}
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
