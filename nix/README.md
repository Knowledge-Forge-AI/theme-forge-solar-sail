# Theme Forge Solar Sail — First-Party Nix Distribution

This template targets first-party Nix distribution for Theme Forge Solar Sail.

The private repository maintains this template under `nix/solar-sail/flake.nix` and
`nix/solar-sail/flake.lock`, with the derivation recipe in `nix/packages/solar-sail.nix`.
Public composition maps the template files to the public repository root (`flake.nix` and `flake.lock`)
and maps the recipe to `nix/package.nix`.

## Declared package systems

- `aarch64-darwin`
- `aarch64-linux`
- `x86_64-linux`

## Flake Usage

```sh
# Build default package
nix build .#default

# Run CLI applications
nix run .#tfss -- --help

# Run checks
nix flake check
```

## Architecture Decisions

1. **Pure Source Derivation**:
   TypeScript is compiled from clean source in an isolated build environment using `pkgs.buildNpmPackage` with Node 22.
   All build dependencies are locked via `npmDepsHash = "sha256-+RyO7saPZ+1HEs/CIZMU937Id0C89SLeaTgiPyOXsQs="`.

2. **CWD-Independent Store Wrapper**:
   The wrapper is created under `$out/bin/tfss` using `makeWrapper`.
   It invokes Nix store Node 22 with `--unset NODE_PATH --unset NODE_OPTIONS` pointing to the
   installed entry script `$out/lib/node_modules/@knowledge-forge-ai/theme-forge-solar-sail/bin/tfss.js`.

3. **Checks**:
   `checks.${system}.theme-forge-solar-sail` requires the composed
   `tools/qualify-installed.mjs` and exercises the exact installed wrappers and
   package resources. Missing probes fail; help-only execution cannot qualify an
   installation. Run runtime checks on a qualified native executor. See
   [the distribution guide](../DISTRIBUTION.md) for release and platform limits.
