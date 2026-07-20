# RepoLume

RepoLume turns a source repository into a structured, local-first wiki. It analyzes repository structure, proposes a table of contents for approval, writes Markdown pages, renders Mermaid diagrams, and provides a web UI for reviewing the generated documentation.

It is designed for teams that want high-quality code onboarding material without sending every repository through a hosted indexing service.

## Highlights

- Local-first repository analysis for local paths and Git URLs.
- Interactive Next.js wiki viewer with Mermaid rendering.
- FastAPI backend for wiki generation, cache management, and streaming progress logs.
- CLI pipeline for headless wiki generation and Confluence publishing.
- Multi-provider model support: Gemini, OpenAI, Claude, OpenRouter, Bedrock, Azure OpenAI, Ollama, and LiteLLM-compatible routing.
- Static analysis and graph context for architecture summaries and diagrams.
- MCP context hooks for GitHub, Jira/Confluence, and databases.
- Source citation blocks appended to generated pages.

## Getting Started

Choose the path that matches how you plan to use RepoLume:

- **Installed desktop app:** download the `.dmg` or `.exe` attached to a GitHub Release. No Node.js, Python, Poetry, or Go installation is required.
- **Docker Compose:** the shortest reproducible path for self-hosting.
- **Source checkout:** intended for contributors and custom builds.

### Docker Compose

Create an environment file:

```bash
cp .env.example .env
```

Edit `.env` and provide the API key for the model provider used to generate the wiki.

Start the app:

```bash
docker compose up --build
```

Open:

- Web UI: `http://localhost:3000`
- API: `http://localhost:8001`
- Health check: `http://localhost:8001/health`

Generated repositories, embeddings, and logs are persisted through Docker volumes/mounts:

- `~/.adalflow` for repository and embedding cache.
- `./api/logs` for application logs.

Confirm the backend is ready:

```bash
curl http://localhost:8001/health
```

Then open `http://localhost:3000`, select a repository folder, approve the requested folder permission, choose a model, and start analysis. RepoLume writes runtime databases, logs, and generated content outside the tracked source files.

### Local Development

Source builds require Node.js 20+, pnpm 10+, Python 3.11–3.12 with Poetry, and Go 1.24.4+.

Install dependencies for both frontend and backend:

```bash
pnpm run setup
```

Run the frontend, backend API, and local Go agent concurrently:

```bash
pnpm run dev:all
```

> **Note:** The Go agent binary is compiled automatically during `dev:all` and is saved to `bin/repolume-agent`.

Open `http://localhost:3000`.

## CLI Usage

Generate a wiki from a local repository:

```bash
python3 -m cli.wiki generate /path/to/repo --provider gemini --lang ko --output ./wiki-out/my-repo
```

Generate from a Git URL:

```bash
python3 -m cli.wiki generate https://github.com/owner/repo --provider openai --lang en
```

Use a CLI subscription agent instead of an API key:

```bash
python3 -m cli.wiki generate ./my-repo --agent codex --lang en
```

Preview the planned wiki structure without writing pages:

```bash
python3 -m cli.wiki plan ./my-repo --provider gemini --verbose
```

Publish generated Markdown to Confluence:

```bash
python3 -m cli.wiki publish ./wiki-out/my-repo \
  --url https://your-domain.atlassian.net/wiki \
  --space ENG \
  --username you@example.com \
  --token "$ATLASSIAN_API_TOKEN" \
  --root-title "My Repo Wiki"
```

## Desktop App (Electron)

The desktop build bundles the Next.js UI, FastAPI backend, and Go agent into a standalone app. End users do not need `pnpm`, Poetry, Python, or Go installed. Those tools are required only on the machine building the installer.

Run in development mode (no build step):

```bash
pnpm run desktop
```

Build a clean distributable release:

```bash
npm run release:desktop
```

Every run removes the previous `dist/` and legacy `dist-electron*` outputs, then places only the current build in `dist/`. The built `.dmg` (macOS) or `.exe` (Windows) can be installed and run independently. Runtime databases, caches, and generated artifacts are stored under Electron's per-user application-data directory and are never part of the source tree.

The current desktop product intentionally generates Korean documentation. The initial setup and settings screens therefore do not expose a language selector.

> **Note:** For air-gapped or locked-down machines, Docker Compose is the simpler install path.



## Configuration

Common environment variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | Backend API port. Defaults to `8001`. |
| `SERVER_BASE_URL` | Backend URL used by the Next.js frontend rewrites. |
| `OPENAI_API_KEY` | OpenAI generation and/or embedding access. |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Gemini generation and Google embedding access. |
| `ANTHROPIC_API_KEY` | Claude generation access. |
| `OPENROUTER_API_KEY` | OpenRouter generation access. |
| `OLLAMA_HOST` | Ollama host. Defaults to `http://localhost:11434` in backend code. |
| `LITELLM_BASE_URL` | LiteLLM API base URL when using LiteLLM compose. |
| `LITELLM_API_KEY` | LiteLLM API key. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | AWS Bedrock access. |
| `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_VERSION` | Azure OpenAI access. |
| `LOG_LEVEL`, `LOG_FILE_PATH` | Backend logging controls. |

Model and embedding defaults live in:

- `api/config/generator.json`
- `api/config/embedder.json`
- `api/config/lang.json`
- `config/mcp-config.yaml.example`

## Docker Variants

- `docker-compose.yml`: standard RepoLume stack, using external model APIs or host services configured through `.env`.
- `docker/docker-compose-litellm.yml`: adds LiteLLM and Postgres, useful when routing local Ollama or multiple providers through a single OpenAI-compatible endpoint.
- `docker/Dockerfile-ollama-local`: bundles Ollama and pulls default local models during image build. This image is large and build-time model pulls can be slow.



## Architecture

RepoLume has three major layers:

- Frontend: Next.js UI for setup, project selection, streaming logs, wiki browsing, and settings.
- Backend API: FastAPI service for repository processing, wiki cache, and generation stream events.
- CLI pipeline: repository resolution, static analysis, graph context, MCP context collection, structure planning, page generation, and export.



## Open Source Notices

This repository includes original RepoLume code and portions adapted from MIT-licensed third-party projects. Keep `LICENSE` and `NOTICE` with source and binary distributions. User-facing product documentation refers to the static analysis layer as RepoLume Sonar; detailed third-party attribution lives in `NOTICE` and source file headers.

See [NOTICE](NOTICE).

## Repository Hygiene

Only source code, reproducible build scripts, tests, public documentation, and sanitized examples belong in Git. Installers, databases, generated wikis, benchmark output, local indexes, execution traces, and organization-specific configuration are ignored.

Run the same guard used by CI before publishing:

```bash
pnpm check:repo
```

## Security

Do not commit `.env`, service account JSON files, API keys, generated logs, or private repository output. The default `.gitignore` and `.dockerignore` exclude common secret and cache paths.

For responsible disclosure and supported deployment assumptions, see [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
