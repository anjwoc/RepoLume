# `pythonCookbookData.ts` Module Documentation

## Overview

The `pythonCookbookData.ts` module serves as a central repository for predefined "cookbook" entries or code transformation prompts specifically tailored for Python development within the VS Code Copilot extension. It stores a collection of code snippets and explanations, primarily focused on addressing common Python code issues, linter rule violations (such as those from Ruff), and best practice recommendations for frameworks like Airflow and FastAPI, as well as general Python version compatibility.

**Important Note:** This file is explicitly marked as "automatically generated. Do not edit it." This indicates that its content is managed by an upstream process, likely a build step or a dedicated script that compiles data from various sources (e.g., linter documentation, style guides) into this structured format for consumption by the Copilot extension.

## Purpose and Responsibilities

The primary purpose of this module is to provide structured data that the Copilot extension can utilize to offer intelligent, context-aware code suggestions, refactorings, or explanations to Python developers. Its key responsibilities include:

*   **Storing Python Code Recipes:** Maintaining a mapping of unique rule identifiers to detailed prompt strings that describe a code issue and provide "Before" and "After" examples for its resolution.
*   **Facilitating Code Quality and Best Practices:** Enabling Copilot to guide users in adhering to Python best practices, resolving linter warnings (e.g., Ruff), and correctly using specific frameworks or language features.
*   **Supporting Contextual Suggestions:** Providing the underlying data for Copilot to generate relevant inline code fixes or explanations based on the developer's current code context and identified patterns.

## Key Structures

### `PromptMap` Type

```typescript
type PromptMap = Record<string, string>;
```

This type alias defines the structure for storing the Python cookbook data. It's a simple JavaScript `Record` (or dictionary/hash map) where:

*   **Keys (`string`):** Represent unique identifiers for specific code rules or patterns (e.g., `AIR001`, `FAST001`, `YTT101`, `ANN001`). These keys often correspond to linter rule codes.
*   **Values (`string`):** Contain the detailed prompt information, typically formatted in Markdown. This includes a description of the issue, "Before" code snippet showing the problematic code, and an "After" code snippet demonstrating the correct or improved solution.

### `pythonRuffCookbooks` Constant

```typescript
export const pythonRuffCookbooks: PromptMap = { ... };
```

This exported constant is the core data structure of the module. It's an instance of `PromptMap` that holds all the Python code recipes. The name `pythonRuffCookbooks` suggests an initial focus on Ruff linter rules, but the content also includes other categories like `AIR` (Airflow), `FAST` (FastAPI), `YTT` (Python version compatibility checks), and `ANN` (Type Annotations).

Each entry within this object follows the pattern:

```json
"RULE_CODE": "Description of the issue. [Before] ```python ... ``` [After] ```python ... ```"
```

For example:

*   `'AIR001'`: Focuses on Airflow variable naming conventions.
*   `'FAST001'`: Addresses redundant parameters in FastAPI routes.
*   `'YTT101'`: Provides guidance on using `sys.version_info` for Python version checks.
*   `'ANN001'`: Recommends adding type annotations to function arguments.

## Design Decisions and Patterns

1.  **Data-Driven Approach:** The module externalizes common code issues and their solutions into a structured data format. This allows the core logic of the Copilot extension to remain generic while the specific suggestions are driven by this data.
2.  **Automatic Generation:** The explicit "Do not edit it" comment is a strong indicator of a meta-programming or code generation pipeline. This ensures consistency, maintainability, and scalability by centralizing the source of truth for these prompts and generating the TypeScript file automatically.
3.  **Markdown-Formatted Prompts:** Using Markdown within the string values allows for rich formatting, including code blocks (` ```python `), which are essential for presenting clear "Before" and "After" code examples.
4.  **Categorized Rule Codes:** The use of prefixes like `AIR`, `FAST`, `YTT`, and `ANN` in the rule codes helps in organizing the prompts by domain (Airflow, FastAPI, Python `sys` module, Annotations) and potentially allows the Copilot extension to filter or prioritize suggestions based on the detected context (e.g., if an Airflow DAG is being edited).

## Integration with the Larger Project

This module is part of the `extensions/copilot/src/extension/prompts/node/inline/` directory, which clearly positions it as a data source for the Node.js backend logic of the VS Code Copilot extension, specifically for "inline" suggestions.

In the broader context of the VS Code Copilot extension:

*   When a user is editing a Python file, the extension's language server or a dedicated analysis component likely identifies code patterns that match the issues described by these rule codes (e.g., an outdated `days_ago` usage in an Airflow DAG).
*   The detected rule code (e.g., `AIR302`) is then used as a key to retrieve the corresponding prompt from `pythonRuffCookbooks`.
*   The extracted prompt, containing the explanation and the "Before/After" code, is then processed by Copilot's suggestion engine to generate an inline code suggestion or a quick fix in the editor, helping the developer to resolve the issue efficiently.

By centralizing these "recipes," the extension can easily be updated with new linting rules or best practices without requiring changes to the core suggestion logic.