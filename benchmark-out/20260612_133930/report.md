# Benchmark Report — 20260612_133930

**Repo:** `/Users/jaecjeong/lab/vscode`  
**Module:** `src/vscode-dts/vscode.d.ts`  
**Run at:** 20260612_133930

## Summary

| Provider | Status | Duration | Chars |
|----------|--------|----------|-------|
| gemini | ❌ ERROR | 60.0s | 0 |
| claude | ⏭ SKIPPED | - | 0 |
| codex | ❌ ERROR | 7.8s | 0 |
| antigravity | ✅ OK | 20.1s | 4,794 |
| openrouter/deepseek-v4-flash | ⏭ SKIPPED | - | 0 |

## Output Previews

### gemini (❌ ERROR)
> ❌ Timeout after 60s

### claude (⏭ SKIPPED)
> binary not executable (stub or wrong arch)

### codex (❌ ERROR)
> ❌ ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-5.5-mini' model is not supported when using Codex with a ChatGPT account."}}

### antigravity (✅ OK)
```markdown
# VS Code Extension API Type Declarations (`vscode.d.ts`)

The [vscode.d.ts](file:///Users/jaecjeong/lab/vscode/src/vscode-dts/vscode.d.ts) module serves as the official TypeScript type definition file for the Visual Studio Code Extension API. It defines the public contract between the VS Code core application and external extensions. 

---

## Overview and Purpose

The primary purpose of [vscode.d.ts](file:///Users/jaecjeong/lab/vscode/src/vscode-dts/vscode.d.ts) is to provide extension developers with compile-time type safety, autocompletion (IntelliSense), and inline documentation inside th
...
```

### openrouter/deepseek-v4-flash (⏭ SKIPPED)
> OPENROUTER_API_KEY not set
