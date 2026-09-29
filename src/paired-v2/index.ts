/**
 * TFSB71B2 Paired Profile v2 Module Index
 *
 * Provides complete explicit export list for parent orchestrator integration.
 */

// Schema & Version Constants
export {
  PAIRED_PROFILE_V2_SCHEMA_VERSION,
  MAPPING_REPORT_V2_SCHEMA_VERSION,
  PAIRED_V2_ADAPTER_NAME,
  PAIRED_V2_ADAPTER_VERSION,
} from "./types.js";

export {
  V2_CANONICAL_DOMAIN_TAG,
  compareUtf8Keys,
  sortKeysUnsignedUtf8,
  canonicalizeProfileV2,
  computeCanonicalDigestV2,
  computeRawSourceSha256,
  hasLoneSurrogates,
  assertSafeDataV2,
  parseProfileV2Json,
} from "./canonical.js";

// Types
export type {
  ColorModeTokensV2,
  ColorSurfacesInteractionsV2,
  TypographyRoleV2,
  TypographyV2,
  RadiusV2,
  SpacingDensityV2,
  SpacingV2,
  ElevationV2,
  FocusV2,
  SyntaxCategoryName,
  PartialSyntaxCategories,
  CodeV2,
  ReadingV2,
  NavigationV2,
  SolarSailTargetOverrideV2,
  StellarLoomTargetOverrideV2,
  TargetOverridesV2,
  PairedProfileV2,
  MappingClassificationV2,
  MappingReportEntryV2,
  MappingReportGeneratedDefaultV2,
  MappingReportSummaryV2,
  MappingReportV2,
  MigrationLossType,
  MigrationLoss,
  MigrationOptions,
  MigrationResult,
  RecipeDensityName,
  RecipeRadiusName,
  RecipeTypographyName,
  RecipeDeltaItem,
  RecipeResult,
  ProvenanceVerificationStatusV2,
  ProfileProvenanceV2,
  SolarSailMappingOptionsV2,
  StellarLoomMappingOptionsV2,
  BoundPairedProfileV2,
} from "./types.js";

// Normalization & Length / Color Validation
export {
  isValidExplicitLength,
  assertExplicitLength,
  parseExplicitLength,
  toUnitlessPx,
  isValidHexColor,
  assertHexColor,
  normalizeHexColor,
  isOpaqueHexColor,
  hasAlphaChannel,
  deepFreeze,
  type ParsedLength,
} from "./normalize.js";

// Validation
export {
  validatePairedProfileV2,
  assertValidPairedProfileV2,
  MANDATORY_NEUTRAL_COLOR_ROLES,
  OPTIONAL_INTERACTION_COLOR_ROLES,
  SYNTAX_CATEGORIES,
  type ValidationResultV2,
} from "./validator.js";

// Mapping & Reports
export {
  NEUTRAL_TO_SOLAR_COLOR_MAP,
  SOLAR_TO_NEUTRAL_COLOR_MAP,
  generateMappingReportV2,
  mapProfileToSolarSailV2,
  mapProfileToSolarSailWithReportV2,
  mapProfileToSyntaxPaletteV2,
  mapProfileToStellarLoomV2,
  mapProfileToStellarLoomWithReportV2,
} from "./mapping.js";

// Migrations
export {
  migrateV1ToV2,
  migrateV2ToV1,
} from "./migration.js";

// Recipes
export {
  applyRecipe,
  RECIPE_CATALOG,
  DENSITY_RECIPES,
  RADIUS_RECIPES,
  TYPOGRAPHY_RECIPES,
  type ProfileRecipe,
  type DensityRecipe,
  type RadiusRecipe,
  type TypographyRecipe,
} from "./recipes.js";

// Bound Profiles
export {
  bindSourceProfileV2,
  fromUnverifiedProfileV2,
  type BindSourceProfileOptionsV2,
} from "./bound.js";

// Errors & Instance-Independent Classifier
export {
  ERROR_CODES,
  classifyProfileError,
  isPairedProfileV2Error,
  PairedProfileV2Error,
  PairedProfileV2ValidationError,
  StaleProvenanceV2Error,
  MigrationV2Error,
  InvalidExplicitLengthError,
  InvalidHexColorError,
  RecipeError,
  type PairedProfileV2ErrorCode,
  type ProfileErrorClassification,
} from "./errors.js";
