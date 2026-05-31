# Configuration

## Environment Variables

Copy `.env.example` to `.env` for local or Compose usage.

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | Backend API port. Defaults to `8001`. |
| `SERVER_BASE_URL` | No | Backend URL used by frontend rewrites. |
| `OPENAI_API_KEY` | Provider-dependent | OpenAI generation and embedding access. |
| `GOOGLE_API_KEY` | Provider-dependent | Gemini generation and Google embedding access. |
| `GEMINI_API_KEY` | Provider-dependent | Alternative Gemini key name used by CLI providers. |
| `ANTHROPIC_API_KEY` | Provider-dependent | Claude generation access. |
| `OPENROUTER_API_KEY` | Provider-dependent | OpenRouter generation access. |
| `OLLAMA_HOST` | No | Ollama endpoint. |
| `LITELLM_BASE_URL` | LiteLLM only | LiteLLM API base URL. |
| `LITELLM_API_KEY` | LiteLLM only | LiteLLM API key. |
| `AWS_ACCESS_KEY_ID` | Bedrock only | AWS access key. |
| `AWS_SECRET_ACCESS_KEY` | Bedrock only | AWS secret key. |
| `AWS_SESSION_TOKEN` | No | Optional AWS session token. |
| `AWS_REGION` | Bedrock only | AWS region. |
| `AWS_ROLE_ARN` | No | Optional Bedrock role ARN. |
| `AZURE_OPENAI_API_KEY` | Azure only | Azure OpenAI API key. |
| `AZURE_OPENAI_ENDPOINT` | Azure only | Azure OpenAI endpoint. |
| `AZURE_OPENAI_VERSION` | Azure only | Azure OpenAI API version. |
| `LOG_LEVEL` | No | Backend log level. |
| `LOG_FILE_PATH` | No | Backend log path. |

## Model Configuration

Generation providers are configured in `api/config/generator.json`.

Embedding providers are configured in `api/config/embedder.json`.

Supported output languages are configured in `api/config/lang.json`.

## MCP Configuration

Start with:

```bash
mkdir -p ~/.localwiki
cp config/mcp-config.yaml.example ~/.localwiki/mcp-config.yaml
```

Enable only the MCP sources you want. Keep tokens in environment variables when possible.

Supported MCP categories in the example config:

- Databases through DBHub-compatible connectors.
- Atlassian Jira/Confluence.
- GitHub MCP.

## Generated Output

CLI output defaults to:

```text
./wiki-out/<repo-name>
```

The Docker app also persists repository and embedding data under:

```text
~/.adalflow
```
