# Contributing

Thanks for improving RepoLume.

## Development Setup

```bash
pnpm install
python3 -m pip install poetry==2.0.1
poetry install -C api
```

Run backend:

```bash
python3 -m api.main
```

Run frontend:

```bash
pnpm dev
```

## Pull Request Guidelines

- Keep changes focused.
- Do not commit secrets, logs, generated private wiki output, or local caches.
- Update README or docs when changing setup, Docker, CLI flags, or provider behavior.
- Preserve third-party license notices in source headers and `NOTICE`.
- Prefer small tests or smoke checks that match the change.

## Documentation Naming

Use RepoLume product names in user-facing docs. Keep third-party project names only in legal notices, optional integration instructions, source headers, or dependency references.
