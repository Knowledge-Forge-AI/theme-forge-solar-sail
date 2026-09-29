/**
 * TFSB71B2 Paired Profile v2 Schema Types
 *
 * Strict neutral nine-group v2 schema:
 * 1. color: light/dark (19 required neutral roles, 4 optional interaction roles)
 * 2. typography: body/heading/ui/code (family, size, lineHeight)
 * 3. radius: control/surface/overlay
 * 4. spacing: base, density ("compact" | "comfortable" | "spacious")
 * 5. elevation: emphasis ("flat" | "raised"), borderWidth, borderStyle ("solid" | "dashed" | "dotted")
 * 6. focus: color (light/dark), width, offset
 * 7. code: syntax (light/dark 11 categories), frame ("editor" | "terminal" | "plain"), copy ("standard" | "minimal")
 * 8. reading: measure
 * 9. navigation: prominence ("quiet" | "balanced" | "strong"), density ("compact" | "comfortable" | "spacious")
 *
 * targetOverrides: version: "v2", solarSail, loom, syntax.
 * No family-specific universal fields (no background, card, chart1, fontSans, etc. at root).
 */

import type { ColorTokens, ThemeSpecification } from "../types.js";
import type { ProfileSyntaxModel } from "../profile.js";

export const PAIRED_PROFILE_V2_SCHEMA_VERSION = "tf-paired-profile-v2" as const;
export const MAPPING_REPORT_V2_SCHEMA_VERSION = "tf-paired-mapping-report-v2" as const;
export const PAIRED_V2_ADAPTER_NAME = "@knowledge-forge-ai/theme-forge-solar-sail/paired-v2" as const;
export const PAIRED_V2_ADAPTER_VERSION = "0.2.0" as const;

// ============================================================================
// Group 1: Color (Neutral Roles)
// ============================================================================

export interface ColorModeTokensV2 {
  // Exactly 19 required neutral roles:
  canvas: string;
  canvasText: string;
  surface: string;
  surfaceText: string;
  elevatedSurface: string;
  elevatedSurfaceText: string;
  primaryAction: string;
  primaryActionText: string;
  secondaryAction: string;
  secondaryActionText: string;
  mutedSurface: string;
  mutedText: string;
  highlight: string;
  highlightText: string;
  danger: string;
  dangerText: string;
  border: string;
  fieldBorder: string;
  focus: string;

  // Exactly 4 optional interaction roles:
  hover?: string | undefined;
  active?: string | undefined;
  selection?: string | undefined;
  selectionText?: string | undefined;
}

export interface ColorSurfacesInteractionsV2 {
  light: ColorModeTokensV2;
  dark: ColorModeTokensV2;
}

// ============================================================================
// Group 2: Typography (Neutral Roles)
// ============================================================================

export interface TypographyRoleV2 {
  family: string;
  size?: string | undefined;
  lineHeight?: number | undefined;
}

export interface TypographyV2 {
  body?: TypographyRoleV2 | undefined;
  heading?: TypographyRoleV2 | undefined;
  ui?: TypographyRoleV2 | undefined;
  code?: TypographyRoleV2 | undefined;
}

// ============================================================================
// Group 3: Radius
// ============================================================================

export interface RadiusV2 {
  control?: string | undefined;
  surface?: string | undefined;
  overlay?: string | undefined;
}

// ============================================================================
// Group 4: Spacing & Density
// ============================================================================

export type SpacingDensityV2 = "compact" | "comfortable" | "spacious";

export interface SpacingV2 {
  base?: string | undefined;
  density?: SpacingDensityV2 | undefined;
}

// ============================================================================
// Group 5: Elevation & Border
// ============================================================================

export interface ElevationV2 {
  emphasis?: ("flat" | "raised") | undefined;
  borderWidth?: string | undefined;
  borderStyle?: ("solid" | "dashed" | "dotted") | undefined;
}

// ============================================================================
// Group 6: Focus
// ============================================================================

export interface FocusV2 {
  color?: {
    light?: string | undefined;
    dark?: string | undefined;
  } | undefined;
  width?: string | undefined;
  offset?: string | undefined;
}

// ============================================================================
// Group 7: Code Semantic Syntax & Presentation
// ============================================================================

export type SyntaxCategoryName =
  | "comment"
  | "string"
  | "number"
  | "constant"
  | "keyword"
  | "function"
  | "type"
  | "variable"
  | "punctuation"
  | "tag"
  | "attribute";

export type PartialSyntaxCategories = Partial<Record<SyntaxCategoryName, string>>;

export interface CodeV2 {
  syntax?: {
    light?: PartialSyntaxCategories | undefined;
    dark?: PartialSyntaxCategories | undefined;
  } | undefined;
  frame?: ("editor" | "terminal" | "plain") | undefined;
  copy?: ("standard" | "minimal") | undefined;
}

// ============================================================================
// Group 8: Reading Measure
// ============================================================================

export interface ReadingV2 {
  measure?: string | undefined;
}

// ============================================================================
// Group 9: Navigation & Chrome
// ============================================================================

export interface NavigationV2 {
  prominence?: ("quiet" | "balanced" | "strong") | undefined;
  density?: ("compact" | "comfortable" | "spacious") | undefined;
}

// ============================================================================
// Target Overrides (Closed & Versioned)
// ============================================================================

export interface SolarSailTargetOverrideV2 {
  palette?: {
    light?: Partial<ColorTokens> | undefined;
    dark?: Partial<ColorTokens> | undefined;
  } | undefined;
  surfaces?: {
    radius?: string | undefined;
    borderWidth?: string | undefined;
  } | undefined;
}

export interface StellarLoomTargetOverrideV2 {
  content?: number | undefined;
  radii?: number | undefined;
  border?: number | undefined;
  primaryFamily?: string | undefined;
  secondaryFamily?: string | undefined;
  defaultAccent?: string | undefined;
  tokenSetKey?: string | undefined;
}

type PartialSyntaxOverride<T> = T extends object ? { [K in keyof T]?: PartialSyntaxOverride<T[K]> } : T;

export interface TargetOverridesV2 {
  version: "v2";
  solarSail?: SolarSailTargetOverrideV2 | undefined;
  loom?: StellarLoomTargetOverrideV2 | undefined;
  syntax?: PartialSyntaxOverride<ProfileSyntaxModel> | undefined;
}

// ============================================================================
// Paired Profile v2 Root
// ============================================================================

export interface PairedProfileV2 {
  schemaVersion: "tf-paired-profile-v2";
  name: string;
  version: string;
  description?: string | undefined;

  // Group 1 (required):
  color: ColorSurfacesInteractionsV2;

  // Groups 2-9 (optional):
  typography?: TypographyV2 | undefined;
  radius?: RadiusV2 | undefined;
  spacing?: SpacingV2 | undefined;
  elevation?: ElevationV2 | undefined;
  focus?: FocusV2 | undefined;
  code?: CodeV2 | undefined;
  reading?: ReadingV2 | undefined;
  navigation?: NavigationV2 | undefined;

  // Closed versioned overrides:
  targetOverrides?: TargetOverridesV2 | undefined;
}

// ============================================================================
// Mapping Report v2
// ============================================================================

export type MappingClassificationV2 =
  | "consumed"
  | "normalized"
  | "overridden"
  | "target-specific"
  | "unsupported";

export interface MappingReportEntryV2 {
  classification: MappingClassificationV2;
  sourcePath: string;
  targetPath?: string | undefined;
  sourceValue?: unknown;
  targetValue?: unknown;
  reason: string;
}

export interface MappingReportGeneratedDefaultV2 {
  targetPath: string;
  targetValue: unknown;
  reason: string;
}

export interface MappingReportSummaryV2 {
  totalSemanticLeaves: number;
  consumed: number;
  normalized: number;
  overridden: number;
  targetSpecific: number;
  unsupported: number;
  generatedDefaultsCount: number;
}

export interface MappingReportV2 {
  schema: "tf-paired-mapping-report-v2";
  target: "solar-sail" | "stellar-loom";
  profileName: string;
  profileVersion: string;
  sourceSha256: string;
  sourceVerification: "source-bytes" | "serialized-profile" | "transformed";
  compiler: { name: string; version: string };
  groups: Array<{group: string; applicable: boolean; reason: string}>;
  digest: string;
  canonicalDigest: string;
  adapter: {
    name: string;
    version: string;
  };
  options: Record<string, unknown>;
  entries: MappingReportEntryV2[];
  defaults: MappingReportGeneratedDefaultV2[];
  summary: MappingReportSummaryV2;
}

// ============================================================================
// Migration Types
// ============================================================================

export type MigrationLossType =
  | "unsupported_role"
  | "unsupported_group"
  | "precision_loss"
  | "unit_incompatible"
  | "dropped_override"
  | "structural_loss";

export interface MigrationLoss {
  path: string;
  lossType: MigrationLossType;
  message: string;
  sourceValue?: unknown;
}

export interface MigrationOptions {
  allowLossy?: boolean | undefined;
}

export interface MigrationResult<T = unknown> {
  adapter: {
    name: string;
    version: string;
  };
  fromVersion: string;
  toVersion: string;
  sourceSha256: string;
  resultSha256: string;
  sourceBytes: Uint8Array;
  resultBytes: Uint8Array;
  resultJson: string;
  profile: T;
  losses: MigrationLoss[];
  isLossless: boolean;
  conversionReportDigest: string;
}

// ============================================================================
// Recipe Types
// ============================================================================

export type RecipeDensityName = "compact" | "comfortable" | "spacious";
export type RecipeRadiusName = "sharp" | "compact" | "default" | "relaxed" | "pill";
export type RecipeTypographyName = "editorial" | "modern" | "technical" | "system";

export interface RecipeDeltaItem {
  path: string;
  before: unknown;
  after: unknown;
}

export interface RecipeResult {
  recipe: { schema: "tf-paired-recipe-v1"; type: "density"|"radius"|"typography"; variant: string };
  digest: string;
  resultJson: string;
  recipeName: string;
  recipeType: "density" | "radius" | "typography";
  recipeVersion: "1.0.0";
  implementation: { name: string; version: string };
  sourceSha256: string;
  resultSha256: string;
  canonicalDigest: string;
  deltas: RecipeDeltaItem[];
  profile: PairedProfileV2;
}

// ============================================================================
// Bound Profile & Provenance Types
// ============================================================================

export type ProvenanceVerificationStatusV2 =
  | "verified"
  | "unverified-assertion"
  | "transformed";

export interface ProfileProvenanceV2 {
  rawSourceSha256: string;
  canonicalDigest: string;
  verificationStatus: ProvenanceVerificationStatusV2;
  isTransformed: boolean;
  byteLength: number;
  parentSourceSha256?: string | undefined;
}

export interface SolarSailMappingOptionsV2 {
  sourceProfileSha256?: string | undefined;
}

export interface StellarLoomMappingOptionsV2 {
  catalog?: Record<string, any> | undefined;
  tokenSetKey?: string | undefined;
  primaryFamily?: string | undefined;
  secondaryFamily?: string | undefined;
  defaultAccent?: string | undefined;
  familyBindings?: Record<string, string> | undefined;
}

export interface BoundPairedProfileV2 {
  readonly profile: PairedProfileV2;
  readonly provenance: ProfileProvenanceV2;

  mapToSolarSail(options?: SolarSailMappingOptionsV2): {
    specification: ThemeSpecification;
    report: MappingReportV2;
    sourceProfileSha256: string;
    canonicalDigest: string;
  };

  mapToStellarLoom(options?: StellarLoomMappingOptionsV2): {
    catalog: Record<string, any>;
    syntax: ProfileSyntaxModel;
    report: MappingReportV2;
    sourceProfileSha256: string;
    canonicalDigest: string;
  };


  transform(
    mutator: (draft: PairedProfileV2) => PairedProfileV2 | void
  ): BoundPairedProfileV2;
}
