# Desktop Release Process

The desktop release is intentionally a latest-only local build. Source control contains the reproducible build inputs; GitHub Releases contains the generated installers.

## Canonical command

Run from the repository root on the target operating system:

```bash
npm run release:desktop
```

`desktop:build` is kept as a compatibility alias and runs the same pipeline.

## Enforced output contract

Every run performs these steps in order:

1. Validate the repository and desktop release contract.
2. Run the Electron and packaging unit tests.
3. Rebuild the Go agent, FastAPI executable, and Next.js standalone app.
4. Remove the previous `dist/` directory and legacy `dist-electron*` directories.
5. Create only the current installers under `dist/`.

Do not rename output directories to `dist-electron-v2`, `dist-electron-hotfix`, or similar names. A new release replaces the local output in `dist/`; version history belongs in Git tags and GitHub Release assets.

## Platform outputs

- macOS: `.dmg`, `.zip`, and the unpacked app used to build the image.
- Windows: NSIS installer and portable executable.

Build macOS artifacts on macOS and Windows artifacts on Windows. Cross-platform output is not part of this release contract.

## Publishing checklist

```bash
pnpm check:repo
pnpm check:package
pnpm check:release
```

- Confirm `dist/` contains only artifacts from the current version in `package.json`.
- Install the artifact on a clean test account and verify folder selection, permission onboarding, generation, cancellation, and reopening a generated wiki.
- Attach the installer files to a versioned GitHub Release; never commit them.
- Keep the previous GitHub Release available as the rollback artifact.
