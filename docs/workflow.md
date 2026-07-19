# Generation Workflow

This page describes the end-to-end RepoLume generation flow.

## Sequence

```mermaid
sequenceDiagram
    autonumber

    actor User
    participant UI as Frontend
    participant API as Backend API
    participant CLI as CLI Pipeline
    participant Analyzer as Local Analysis
    participant LLM as Model Provider

    User->>UI: Select local path or Git URL
    UI->>API: Start generation with settings
    API->>CLI: Run pipeline

    rect rgb(240, 248, 255)
        Note over CLI,Analyzer: 1. Repository and context preparation
        CLI->>Analyzer: Load files and metadata
        Analyzer->>Analyzer: Extract symbols, relationships, and diagrams
        Analyzer-->>CLI: Return compact code context
    end

    rect rgb(245, 255, 250)
        Note over CLI,LLM: 2. Wiki planning
        CLI->>LLM: Ask for structured page plan
        LLM-->>CLI: Return sections and pages
    end

    rect rgb(255, 250, 240)
        Note over CLI,LLM: 3. Page generation
        loop Each planned page
            CLI->>LLM: Send page goal and relevant context
            LLM-->>CLI: Return Markdown
            CLI->>CLI: Add citations and diagrams where available
        end
    end

    rect rgb(255, 245, 255)
        Note over CLI,API: 4. Export and render
        CLI->>CLI: Write Markdown files and cache
        CLI-->>API: Return completion status
    end

    API-->>UI: Stream final result
    UI-->>User: Render interactive wiki
```

## Steps

1. Repository resolution

   RepoLume accepts a local path or Git URL. Git URLs are cloned to a temporary or configured directory. Local paths are read directly.

2. Local analysis

   RepoLume Sonar scans supported source files to extract symbols, relationships, and diagram context. The graph indexer can add compact call/import context when available.

3. Optional MCP enrichment

   If configured, MCP clients can add context from databases, GitHub issues/PRs, Jira, and Confluence. This helps generated docs connect code to operational and product context.

4. Structure planning

   The structure planner asks the model to create a page plan before any full page is generated. This keeps output organized around architecture, workflows, APIs, components, and deployment.

5. Page generation

   Each page is generated with the relevant source context. The model router can choose a lightweight or stronger model based on page importance and context richness.

6. Export

   The file exporter writes a Markdown wiki tree. The UI can render that tree, and the CLI can publish it to Confluence.
