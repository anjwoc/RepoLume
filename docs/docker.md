# Docker

LocalWiki ships with Compose files for standard API-key usage and LiteLLM-based local/provider routing.

## Standard Compose

```bash
cp .env.example .env
docker compose up --build
```

Services:

- `localwiki`: FastAPI backend and Next.js frontend in one container.

Ports:

- `3000`: web UI.
- `8001`: backend API by default.

Persistent paths:

- `~/.adalflow:/root/.adalflow`
- `./api/logs:/app/api/logs`

## LiteLLM Compose

```bash
cp docker/docker-compose-litellm.env.example docker/docker-compose-litellm.env
docker compose -f docker/docker-compose-litellm.yml up --build
```

Services:

- `db`: Postgres for LiteLLM.
- `litellm`: OpenAI-compatible model gateway.
- `localwiki`: LocalWiki configured to use the LiteLLM gateway.

The default `docker/litellm-config.yml` points to host Ollama:

```yaml
api_base: http://host.docker.internal:11434
```

Pull local models before using that default:

```bash
ollama pull qwen3:1.7b
ollama pull nomic-embed-text
```

## Build Notes

The Dockerfiles use `pnpm-lock.yaml` for frontend dependency installation and Poetry for backend dependencies.

The standard image expects model providers to be reachable through environment variables. `docker/Dockerfile-ollama-local` bundles Ollama and default models into the image, which makes builds significantly larger and slower.

## Troubleshooting

- If the frontend cannot reach the backend, check `SERVER_BASE_URL`.
- If `/health` fails, inspect `api/logs/application.log`.
- If local Ollama is not reachable from Docker, use `host.docker.internal:11434`.
- If generation fails immediately, verify the provider API key selected in the UI or `.env`.
