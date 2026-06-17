# Benchmark Report — 20260612_134319

**Repo:** `/Users/jaecjeong/lab/vscode`  
**Module:** `extensions/copilot/src/extension/prompts/node/inline/pythonCookbookData.ts`  
**Run at:** 20260612_134319

## Summary

| Provider | Status | Duration | Chars |
|----------|--------|----------|-------|
| gemini | ✅ OK | 34.1s | 5,812 |
| claude | ⏭ SKIPPED | - | 0 |
| codex | ❌ ERROR | 9.5s | 0 |
| antigravity | ✅ OK | 19.0s | 3,452 |
| openrouter/deepseek-v4-flash | ⏭ SKIPPED | - | 0 |

## Output Previews

### gemini (✅ OK)
```markdown
# `pythonCookbookData.ts` Module Documentation

## Overview

The `pythonCookbookData.ts` module serves as a central repository for predefined "cookbook" entries or code transformation prompts specifically tailored for Python development within the VS Code Copilot extension. It stores a collection of code snippets and explanations, primarily focused on addressing common Python code issues, linter rule violations (such as those from Ruff), and best practice recommendations for frameworks like Airflow and FastAPI, as well as general Python version compatibility.

**Important Note:** This file is 
...
```

### claude (⏭ SKIPPED)
> binary not executable (stub or wrong arch)

### codex (❌ ERROR)
> ❌ ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-5.5-mini' model is not supported when using Codex with a ChatGPT account."}}

### antigravity (✅ OK)
```markdown
# Python Ruff Cookbook Data Module

The `pythonCookbookData.ts` module provides a mapping of Python Ruff linter rule IDs to code transformation instructions. This data serves as standard reference examples ("cookbooks") used to guide Copilot's inline code generation and refactoring capabilities for Python files.

## Purpose

The main objective of this module is to supply the Copilot extension with structured, rule-specific knowledge for Python codebase improvements. By referencing this map, the extension can enrich LLM prompts with exact contextual explanations and concrete `Before` / `After` 
...
```

### openrouter/deepseek-v4-flash (⏭ SKIPPED)
> OPENROUTER_API_KEY not set
