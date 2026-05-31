# Open Source Notes

This project should be distributed with `LICENSE` and `NOTICE`.

## Attribution Policy

User-facing docs should describe LocalWiki features using LocalWiki names:

- `LocalWiki`
- `LocalWiki Sonar`
- `CLI Pipeline`
- `Graph Indexer`
- `MCP Manager`

Third-party project names should be used only when needed for:

- legal attribution,
- optional integration instructions,
- source file headers,
- dependency references.

## Included Third-Party Notices

LocalWiki contains small adapted portions of CodeBoarding under the MIT License. These portions are limited to local static analysis, graph, and Mermaid-related code paths. This does not mean the full upstream project is bundled or that LocalWiki is endorsed by that project.

See `NOTICE` for the required attribution text.

## Release Checklist

- Keep `.env`, service account JSON files, API keys, generated logs, and private repository outputs out of Git.
- Include `LICENSE` and `NOTICE` in source and binary distributions.
- Ensure `.env.example` contains placeholders only.
- Search for legacy hosted-service branding or absolute local paths before release.
- Verify Docker build instructions match the active lockfile.
