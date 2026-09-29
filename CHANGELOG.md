# Changelog

All notable changes to `@knowledge-forge-ai/theme-forge-solar-sail` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1]

### Security
- `calculateContrastRatio` no longer backtracks polynomially on long `rgb(`/`hsl(`-prefixed inputs: the two alpha-channel checks are now a linear scan with the same grammar (CodeQL `js/polynomial-redos`, `src/validator.ts`). Valid and invalid colour results are unchanged.

### Documentation
- The README no longer names 0.1.0 as the registry installation target; it points to the registry's `latest` tag.

## [0.2.0] - 2026-09-28

### Added
- Duplicate-aware byte parsing, strict v1 validation and maintained negative/dogfood corpora.
- Mapping coverage reports, source-byte verification, transformed-profile lineage and complete direct-generation invocation reports.
- Stable CLI failure categories and opt-in diagnostic failure policy.
- Exclusive package writing with checked rollback and independent filesystem/sink tests.

### Changed
- **Breaking compatibility corrections:**
  chart roles emit `--chart-1` through `--chart-5` instead of `--chart1` through
  `--chart5`; consumers must update references.
- Validation rejects previously accepted malformed/ambiguous fields, unsafe CSS,
  control characters in CSS and description/author data, and symlink/path escapes.
- Bare Loom mapper provenance options now throw; use the bound mapping/report API.

### Fixed
- Provenance-bearing TypeScript packages compile without excess-property errors.
- Transformed profiles no longer retain stale source bindings.
- Human CLI output escapes terminal controls; README descriptions cannot introduce
  Markdown block syntax or raw metadata control bytes.

Compatibility corrections and filesystem concurrency limits are documented in the
README.

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
