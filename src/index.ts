export {
  COMPILER_NAME,
  COMPILER_VERSION,
  THEME_SCHEMA_VERSION,
  DESCRIPTOR_SCHEMA_VERSION,
  PROVENANCE_SCHEMA_VERSION,
  type ColorTokens,
  type SurfacesConfig,
  type TypographyConfig,
  type ThemeSpecification,
  type ThemeDiagnostic,
  type ThemeDescriptor,
  type CompilationResult,
  type PackageMetadata,
  type PackageProvenance,
  type GeneratePackageOptions,
  type GeneratePackageResult,
} from "./types.js";

export {
  validateThemeSpecification,
  validatePackageMetadata,
  calculateContrastRatio,
  parseHexColor,
  relativeLuminance,
  type ValidationResult,
} from "./validator.js";

export {
  compileTheme,
  canonicalizeJson,
  computeSha256,
} from "./compiler.js";

export {
  generateThemePackage,
  writePackageFiles,
  FilesystemSafetyError,
} from "./emitter.js";

export {
  PAIRED_PROFILE_SCHEMA_VERSION,
  type PairedProfile,
  type PairedProfileSurfaces,
  mapProfileToSolarSail,
  mapProfileToStellarLoom,
  mapProfileToSyntaxPalette,
} from "./profile.js";

