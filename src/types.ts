export const COMPILER_NAME = "@knowledge-forge-ai/theme-forge-solar-sail";
export const COMPILER_VERSION = "0.1.0";
export const THEME_SCHEMA_VERSION = "tfss.theme-v1";
export const DESCRIPTOR_SCHEMA_VERSION = "tfss.theme-descriptor-v1";
export const PROVENANCE_SCHEMA_VERSION = "tfss.package-provenance-v1";

export interface ColorTokens {
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
  // Optional canonical chart roles (shadcn v4)
  chart1?: string;
  chart2?: string;
  chart3?: string;
  chart4?: string;
  chart5?: string;
  // Optional canonical sidebar roles (shadcn v4)
  sidebar?: string;
  sidebarForeground?: string;
  sidebarPrimary?: string;
  sidebarPrimaryForeground?: string;
  sidebarAccent?: string;
  sidebarAccentForeground?: string;
  sidebarBorder?: string;
  sidebarRing?: string;
}

export interface SurfacesConfig {
  radius: string;
  borderWidth?: string;
}

export interface TypographyConfig {
  fontSans: string;
  fontHeading?: string;
  fontMono?: string;
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
  surfaces: SurfacesConfig;
  typography: TypographyConfig;
  sourceProfileSha256?: string;
}

export interface ThemeDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  path?: string;
}

export interface ThemeDescriptor {
  schema: "tfss.theme-descriptor-v1";
  themeName: string;
  themeVersion: string;
  inputDigest: string;
  outputDigest: string;
  inventoryDigest: string;
  compiler: {
    name: string;
    version: string;
  };
  diagnostics: ThemeDiagnostic[];
  sourceProfileSha256?: string;
}

export interface CompilationResult {
  specification: ThemeSpecification;
  css: string;
  inputDigest: string;
  outputDigest: string;
  descriptor: ThemeDescriptor;
  diagnostics: ThemeDiagnostic[];
  sourceProfileSha256?: string;
}

export interface PackageMetadata {
  name: string;
  version: string;
  description?: string | undefined;
  author?: string | undefined;
  license?: string | undefined;
  private?: boolean | undefined;
}

export interface PackageProvenance {
  schema: "tfss.package-provenance-v1";
  producer: {
    package: string;
    version: string;
  };
  packageName: string;
  packageVersion: string;
  language?: ("typescript" | "javascript") | undefined;
  inventoryDigest: string;
  inventoryExcludes: string[];
  files: Array<{
    path: string;
    size: number;
    sha256: string;
  }>;
}

export interface GeneratePackageOptions {
  themeSpec: unknown;
  metadata: unknown;
  language?: ("typescript" | "javascript") | undefined;
}

export interface GeneratePackageResult {
  metadata: PackageMetadata;
  themeSpec: ThemeSpecification;
  themeCanonicalJson: string;
  cssContent: string;
  descriptor: ThemeDescriptor;
  provenance: PackageProvenance;
  files: Map<string, string | Uint8Array>;
  diagnostics: ThemeDiagnostic[];
}
