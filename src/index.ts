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
  MAPPING_REPORT_SCHEMA_VERSION,
  validatePairedProfile,
  bindSourceProfile,
  mapProfileToSolarSailWithReport,
  mapProfileToStellarLoomWithReport,
  type MappingReport,
  type MappingReportEntry,
  type ProfileProvenance,
  type BoundPairedProfile,
  type BindSourceProfileOptions,
  type PairedProfile,
  type PairedProfileSurfaces,
  mapProfileToSolarSail,
  mapProfileToStellarLoom,
  mapProfileToSyntaxPalette,
} from "./profile.js";

export { parseThemeJson } from "./input.js";
export { describeGenerationInvocation } from "./identity.js";

// Additive versioned paired contract; legacy entrypoints retain their identity domains.
export {
  PAIRED_PROFILE_V2_SCHEMA_VERSION, MAPPING_REPORT_V2_SCHEMA_VERSION,
  PAIRED_V2_ADAPTER_NAME, PAIRED_V2_ADAPTER_VERSION,
  validatePairedProfileV2, bindSourceProfileV2, canonicalizeProfileV2,
  migrateV1ToV2, migrateV2ToV1, applyRecipe,
  classifyProfileError, ERROR_CODES,
  type PairedProfileV2, type BoundPairedProfileV2, type MappingReportV2,
  type StellarLoomMappingOptionsV2, type MigrationResult, type MigrationLoss,
  type RecipeResult,
} from "./paired-v2/index.js";
