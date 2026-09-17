# Changelog

All notable changes to `@knowledge-forge-ai/theme-forge-solar-sail` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-17

### Added
- Initial public release candidate for Theme Forge Solar Sail.
- Deterministic compiler translating `tfss.theme-v1` specifications into Tailwind CSS v4 `@theme inline` configuration and CSS custom properties.
- Full shadcn/ui semantic color roles support (`background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, chart roles) across light and dark modes.
- Complete border-radius progression (`--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`, `--radius-2xl`, `--radius-3xl`, `--radius-4xl`).
- Actionable contrast ratio diagnostics evaluating text and foreground elements against respective backgrounds.
- `tfss` CLI providing `validate`, `compile`, and `generate` subcommands with human-readable and structured `--json` output.
- Distribution package generation supporting standalone TypeScript (`--language typescript`) with `tsconfig.json` and compiled `dist/` exports, as well as zero-build JavaScript (`--language javascript`).
- Cross-framework paired profile mapping between Solar Sail application themes and Stellar Loom documentation themes.
- Independent consumer qualification suite validating packed npm installation without compiler or private repository runtime dependencies.
