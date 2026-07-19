# Security Policy

## Supported Use

RepoLume is intended for local or self-hosted code documentation workflows. Treat generated output as sensitive when the source repository is private.

## Secrets

Never commit:

- `.env` files
- API keys
- service account JSON files
- generated application logs
- generated wiki output for private repositories
- repository and embedding caches

The repository includes `.gitignore` and `.dockerignore` rules for common secret and cache paths, but users remain responsible for reviewing changes before publishing.

## Reporting

If you discover a security issue, report it privately to the project maintainer instead of opening a public issue with exploit details.

Include:

- affected version or commit,
- reproduction steps,
- impact,
- suggested fix if known.
