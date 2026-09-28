import {
  COMPILER_NAME,
  COMPILER_VERSION,
  PROVENANCE_SCHEMA_VERSION,
  type GeneratePackageOptions,
  type GeneratePackageResult,
  type PackageProvenance,
} from "./types.js";
import { compileTheme, canonicalizeJson, computeSha256 } from "./compiler.js";
import { validatePackageMetadata } from "./validator.js";
import { assertSafeData } from "./input.js";
import {
  writePackageFiles,
  writeCssFile,
  FilesystemSafetyError,
} from "./writer.js";

export { writePackageFiles, writeCssFile, FilesystemSafetyError };

import {
  AGPL_3_LICENSE_TEXT,
  FIRST_PARTY_NOTICE_TEXT,
  COMMERCIAL_LICENSE_TEXT,
} from "./legal.js";

/**
 * Escapes Unicode line separators (\u2028, \u2029) to ensure valid TypeScript string literal syntax
 * while preserving identical JSON.parse semantic deserialization.
 */
function toTsSafeJson(jsonString: string): string {
  return jsonString.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function generateThemePackage(options: GeneratePackageOptions): GeneratePackageResult {
  // Validate generation options and language without external dependencies
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("GeneratePackageOptions must be a non-null object");
  }
  const safeOptions: Record<string, unknown> = {};
  if (![Object.prototype, null].includes(Object.getPrototypeOf(options)) || Object.getOwnPropertySymbols(options).length) throw new TypeError("Unsafe generation options");
  for (const key of Object.getOwnPropertyNames(options)) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key)!;
    if (!descriptor.enumerable || !("value" in descriptor) || !["themeSpec", "metadata", "language"].includes(key)) throw new TypeError("Unknown or unsafe generation option");
    if (descriptor.value !== undefined || key !== "language") safeOptions[key] = descriptor.value;
  }
  if (safeOptions.language !== undefined) assertSafeData(safeOptions.language);
  const language = options.language ?? "javascript";
  if (language !== "typescript" && language !== "javascript") {
    throw new TypeError(
      `Invalid language option '${String(options.language)}'. Expected 'typescript' or 'javascript'.`
    );
  }
  if (!options.themeSpec) {
    throw new TypeError("GeneratePackageOptions 'themeSpec' is required");
  }
  if (!options.metadata) {
    throw new TypeError("GeneratePackageOptions 'metadata' is required");
  }

  const metadata = validatePackageMetadata(options.metadata);
  const compilation = compileTheme(options.themeSpec);
  const spec = compilation.specification;
  const isTs = language === "typescript";

  const files = new Map<string, string | Uint8Array>();

  // 1. Theme stylesheet
  files.set("styles/theme.css", compilation.css);

  // 2. Integration modules
  if (isTs) {
    const typeDef = `export interface ColorTokens {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  chart1?: string;
  chart2?: string;
  chart3?: string;
  chart4?: string;
  chart5?: string;
  sidebar?: string;
  sidebarForeground?: string;
  sidebarPrimary?: string;
  sidebarPrimaryForeground?: string;
  sidebarAccent?: string;
  sidebarAccentForeground?: string;
  sidebarBorder?: string;
  sidebarRing?: string;
}

export interface ThemeSpecification {
  schemaVersion: "tfss.theme-v1";
  name: string;
  version: string;
  description?: string;
  palette: {
    light: ColorTokens;
    dark: ColorTokens;
  };
  surfaces: {
    radius: string;
    borderWidth?: string;
  };
  typography: {
    fontSans: string;
    fontHeading?: string;
    fontMono?: string;
  };
  sourceProfileSha256?: string;
}
`;
    const inlinedSpecJson = toTsSafeJson(canonicalizeJson(spec));
    files.set(
      "src/index.ts",
      `${typeDef}
export const themeSpec: ThemeSpecification = ${inlinedSpecJson};
export const themeCss = "./styles/theme.css";
export default themeSpec;
`
    );
    files.set(
      "tsconfig.json",
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2023",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            declaration: true,
            strict: true,
            rootDir: "src",
            outDir: "dist",
          },
          include: ["src/**/*"],
        },
        null,
        2
      ) + "\n"
    );
  } else {
    files.set(
      "index.js",
      `import themeSpecJson from "./theme.json" with { type: "json" };

export const themeSpec = themeSpecJson;
export const themeCss = "./styles/theme.css";
export default themeSpec;
`
    );
    files.set(
      "index.d.ts",
      `export declare const themeSpec: any;
export declare const themeCss: string;
export default themeSpec;
`
    );
  }

  // 3. package.json
  const fileList = isTs
    ? [
        "dist",
        "src",
        "tsconfig.json",
        "styles",
        "theme.json",
        "theme.descriptor.json",
        "provenance.json",
        "README.md",
        "LICENSE",
        "NOTICE",
        "COMMERCIAL-LICENSE.md",
      ]
    : [
        "index.js",
        "index.d.ts",
        "styles",
        "theme.json",
        "theme.descriptor.json",
        "provenance.json",
        "README.md",
        "LICENSE",
        "NOTICE",
        "COMMERCIAL-LICENSE.md",
      ];

  const pkgJson: Record<string, unknown> = {
    name: metadata.name,
    version: metadata.version,
    private: metadata.private ?? true,
    type: "module",
    description:
      metadata.description ??
      `${spec.name} application theme for Tailwind CSS v4 and shadcn/ui`,
    license: metadata.license ?? "AGPL-3.0-or-later",
    ...(metadata.author ? { author: metadata.author } : {}),
    exports: {
      ".": {
        types: isTs ? "./dist/index.d.ts" : "./index.d.ts",
        import: isTs ? "./dist/index.js" : "./index.js",
      },
      "./styles/*": "./styles/*",
      "./theme.json": "./theme.json",
    },
    files: fileList,
    ...(isTs
      ? {
          scripts: { build: "tsc" },
          devDependencies: { typescript: "7.0.2" },
        }
      : {}),
    peerDependencies: {
      tailwindcss: "^4.0.0",
    },
    engines: {
      node: ">=22",
    },
  };
  files.set("package.json", JSON.stringify(pkgJson, null, 2) + "\n");

  // 4. theme.json and theme.descriptor.json
  const themeCanonicalJson = canonicalizeJson(spec);
  files.set("theme.json", themeCanonicalJson);
  files.set("theme.descriptor.json", canonicalizeJson(compilation.descriptor));

  // 5. Documentation and legal
  files.set("LICENSE", AGPL_3_LICENSE_TEXT);
  files.set("NOTICE", FIRST_PARTY_NOTICE_TEXT);
  files.set("COMMERCIAL-LICENSE.md", COMMERCIAL_LICENSE_TEXT);

  // Constrain and encode metadata interpolated into README sink
  const safeReadmeName = metadata.name.replace(/[\r\n]+/g, " ").replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();
  const rawDescription = (pkgJson.description as string) ?? `${spec.name} application theme for Tailwind CSS v4 and shadcn/ui`;
  const safeReadmeDesc = rawDescription.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\[\]`*_!#+|.()\\-]/g, char => `&#${char.charCodeAt(0)};`).replace(/^ +/, spaces => "&#32;".repeat(spaces.length));
  const safeThemeName = String(spec.name).replace(/[\r\n]+/g, " ").replace(/`/g, "\\`");
  const safeThemeVersion = String(spec.version).replace(/[\r\n]+/g, " ").replace(/`/g, "\\`");
  const safeImportSpecifier = metadata.name.replace(/[\r\n"\\`<>]/g, "").trim();

  files.set(
    "README.md",
    `# ${safeReadmeName}

${safeReadmeDesc}

## Overview

Generated by [Theme Forge Solar Sail](https://github.com/Knowledge-Forge-AI/theme-forge-stellar-burst).
Provides a deterministic Tailwind CSS v4 \`@theme inline\` stylesheet and shadcn/ui compatible CSS variables.

- **Theme**: \`${safeThemeName}\` (v${safeThemeVersion})
- **Language Mode**: \`${isTs ? "typescript" : "javascript"}\`
- **Tailwind Version**: \`^4.0.0\`

## Usage

Import the theme stylesheet into your application root CSS file (e.g. \`globals.css\` or \`app.css\`):

\`\`\`css
@import "${safeImportSpecifier}/styles/theme.css";
\`\`\`

All semantic color tokens (\`--color-primary\`, \`--color-background\`, \`--color-card\`, etc.) and border radius utilities (\`rounded-sm\`, \`rounded-md\`, \`rounded-lg\`, \`rounded-xl\`, etc.) are mapped automatically under Tailwind v4.

## Overrides

Consumer styles defined after the \`@import\` take precedence following ordinary CSS cascade rules.
`
  );

  // 6. Provenance
  const sortedFileRecords = [...files.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([path, content]) => ({
      path,
      size: typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength,
      sha256: computeSha256(content),
    }));

  const provenance: PackageProvenance = {
    schema: PROVENANCE_SCHEMA_VERSION,
    producer: {
      package: COMPILER_NAME,
      version: COMPILER_VERSION,
    },
    packageName: metadata.name,
    packageVersion: metadata.version,
    ...(isTs ? { language: "typescript" as const } : {}),
    inventoryDigest: computeSha256(
      "tfss.package-inventory-v1\n" + JSON.stringify(sortedFileRecords)
    ),
    inventoryExcludes: ["provenance.json"],
    files: sortedFileRecords,
  };

  files.set("provenance.json", JSON.stringify(provenance, null, 2) + "\n");

  return {
    metadata,
    themeSpec: spec,
    themeCanonicalJson,
    cssContent: compilation.css,
    descriptor: compilation.descriptor,
    provenance,
    files,
    diagnostics: compilation.diagnostics,
  };
}
