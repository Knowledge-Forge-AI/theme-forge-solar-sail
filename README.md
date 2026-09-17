# @knowledge-forge-ai/theme-forge-solar-sail

Deterministic theme compiler, library, and `tfss` CLI for Tailwind CSS v4 and shadcn/ui application theming. Sibling engine to Theme Forge Stellar Loom.

## Overview

Theme Forge Solar Sail translates declarative theme specifications (`tfss.theme-v1`) into:
- **Tailwind CSS v4 `@theme inline` configuration**: Emits clean CSS theme variables directly compatible with Tailwind v4's stylesheet-first engine.
- **shadcn/ui semantic roles**: Maps tokens to standard component roles (`background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, and optional chart tokens).
- **Light and dark theme support**: Emits scoped `:root` and `.dark` / `@custom-variant dark (&:is(.dark *))` styles.
- **Radius progression**: Defines full radius scales from `--radius-sm` through `--radius-4xl`.
- **Actionable diagnostics**: Verifies color contrast ratios against background tokens and reports missing role warnings.
- **Standalone distribution packages**: Generates self-contained packages in TypeScript or zero-build JavaScript that require zero runtime dependencies on Solar Sail or any external service.

## Installation

Install as a development dependency:

```bash
npm install --save-dev @knowledge-forge-ai/theme-forge-solar-sail
```

Or invoke the CLI via `npx`:

```bash
npx tfss --help
```

## CLI Usage

The `tfss` CLI provides three primary subcommands:

### 1. Validate a Theme Specification

Validates theme schema conformance, ensures required color roles are defined, and evaluates contrast diagnostics:

```bash
tfss validate path/to/theme.json
tfss validate path/to/theme.json --json
```

### 2. Compile to CSS

Compiles a theme specification into standalone CSS stylesheets:

```bash
tfss compile path/to/theme.json --out dist/styles
tfss compile path/to/theme.json --json
```

Emits:
- `theme.css`: Complete Tailwind CSS v4 and shadcn/ui custom properties.
- `theme.descriptor.json`: Deterministic SHA-256 digests of inputs and outputs.

### 3. Generate a Standalone Distribution Package

Generates a complete, installable npm package:

```bash
tfss generate path/to/theme.json --package path/to/package-metadata.json --out packages/my-app-theme --language typescript
```

Options:
- `--package <path>`: Path to package metadata JSON (`name`, `version`, `description`, `license`).
- `--out <dir>`: Target directory (must be empty or absent for safety).
- `--language <typescript|javascript>`: Emission language mode (default: `javascript`).
- `--json`: Structured machine-readable output.

## Package Architecture & Modes

Generated theme packages are completely self-contained:
- In **TypeScript mode** (`--language typescript`), emits `src/index.ts`, `tsconfig.json`, and builds compiled distribution files in `dist/`.
- In **JavaScript mode** (`--language javascript`), emits zero-build `index.js` and `index.d.ts` entry points.
- Neither mode requires Solar Sail, Nebular Fusion, or private repository packages at consumer runtime.

## Programmatic API

```typescript
import {
  compileTheme,
  validateThemeSpecification,
  generateThemePackage,
  type ThemeSpecification,
} from "@knowledge-forge-ai/theme-forge-solar-sail";

// Validate
const validation = validateThemeSpecification(themeSpec);
if (!validation.valid) {
  console.error("Diagnostics:", validation.diagnostics);
}

// Compile CSS
const result = compileTheme(themeSpec);
console.log(result.css); // Compiled Tailwind v4 @theme inline block + custom properties

// Generate Package
const pkg = generateThemePackage({
  themeSpec,
  metadata: { name: "my-theme", version: "1.0.0" },
  language: "typescript",
});
```

## Boundaries & Limitations

- **Theme Backend Only**: Solar Sail is a deterministic theme backend and compiler. It generates CSS tokens, radius scales, and package envelopes. It does **not** generate arbitrary React/TSX application code or UI component implementations.
- **Tailwind v4 First**: Output stylesheets are targeted for Tailwind CSS v4 `@theme inline` and standard CSS custom properties.
- **Filesystem Safety**: Package generation requires the target directory to be absent or completely empty to prevent accidental overwrites.

## License

This project is licensed under the GNU Affero General Public License v3.0 or later. See `LICENSE` and `NOTICE`. Commercial licensing terms are available; see `COMMERCIAL-LICENSE.md`.
