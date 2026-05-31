# LocalWiki

LocalWiki generates private, local-first documentation for codebases. It analyzes a repository, plans a wiki structure, writes Markdown pages, renders Mermaid diagrams, and provides a web UI for browsing and asking questions over the generated knowledge base.

It is designed for teams that want high-quality code onboarding material without sending every repository through a hosted indexing service.

## Highlights

- Local-first repository analysis for local paths and Git URLs.
- Interactive Next.js wiki viewer with Mermaid rendering.
- FastAPI backend for generation, cache, streaming logs, and RAG Q&A.
- CLI pipeline for headless wiki generation and Confluence publishing.
- Multi-provider model support: Gemini, OpenAI, Claude, OpenRouter, Bedrock, Azure OpenAI, Ollama, and LiteLLM-compatible routing.
- Static analysis and graph context for architecture summaries and diagrams.
- MCP context hooks for GitHub, Jira/Confluence, and databases.
- Source citation blocks appended to generated pages.

## Quick Start With Docker Compose

Create an environment file:

```bash
cp .env.example .env
```

Edit `.env` and provide at least one generation provider key. For RAG embeddings, `OPENAI_API_KEY` or `GOOGLE_API_KEY` is recommended depending on your embedder configuration.

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

## Local Development

Install frontend dependencies:

```bash
pnpm install
```

Install backend dependencies:

```bash
python3 -m pip install poetry==2.0.1
poetry install -C api
```

Run the backend:

```bash
python3 -m api.main
```

Run the frontend:

```bash
pnpm dev
```

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

- `docker-compose.yml`: standard LocalWiki stack, using external model APIs or host services configured through `.env`.
- `docker-compose-litellm.yml`: adds LiteLLM and Postgres, useful when routing local Ollama or multiple providers through a single OpenAI-compatible endpoint.
- `Dockerfile-ollama-local`: bundles Ollama and pulls default local models during image build. This image is large and build-time model pulls can be slow.

See [docs/docker.md](docs/docker.md) for more operational notes.

## Architecture

LocalWiki has three major layers:

- Frontend: Next.js UI for setup, project selection, streaming logs, wiki browsing, and settings.
- Backend API: FastAPI service for repository processing, wiki cache, RAG chat, and stream events.
- CLI pipeline: repository resolution, static analysis, graph context, MCP context collection, structure planning, page generation, and export.

See [docs/architecture.md](docs/architecture.md) and [docs/workflow.md](docs/workflow.md).

## Open Source Notices

This repository includes original LocalWiki code and portions adapted from MIT-licensed third-party projects. Keep `LICENSE` and `NOTICE` with source and binary distributions. User-facing product documentation refers to the static analysis layer as LocalWiki Sonar; detailed third-party attribution lives in `NOTICE` and source file headers.

See [NOTICE](NOTICE) and [docs/open-source.md](docs/open-source.md).

## Security

Do not commit `.env`, service account JSON files, API keys, generated logs, or private repository output. The default `.gitignore` and `.dockerignore` exclude common secret and cache paths.

For responsible disclosure and supported deployment assumptions, see [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
