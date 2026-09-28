import { createHash } from "node:crypto";
import { assertSafeData, parseThemeJson } from "./input.js";
import { validateThemeSpecification, isValidCssLength, isValidColor } from "./validator.js";
import type {
  ColorTokens,
  SurfacesConfig,
  ThemeSpecification,
  TypographyConfig,
} from "./types.js";

export const PAIRED_PROFILE_SCHEMA_VERSION = "tf-paired-profile-v1" as const;
export const MAPPING_REPORT_SCHEMA_VERSION = "tf-paired-mapping-report-v1" as const;

export { assertSafeData, parseThemeJson };

export interface PairedProfileSurfaces extends SurfacesConfig {
  content?: number;
}

export interface PairedProfile {
  schemaVersion: "tf-paired-profile-v1";
  name: string;
  version: string;
  description?: string;
  palette: {
    light: ColorTokens;
    dark: ColorTokens;
  };
  surfaces: PairedProfileSurfaces;
  typography: TypographyConfig;
  targetOverrides?: {
    loom?: Record<string, unknown>;
    solarSail?: Record<string, unknown>;
    syntax?: Partial<ProfileSyntaxModel>;
  };
}

// ============================================================================
// Errors & Validation Result
// ============================================================================

export class PairedProfileValidationError extends Error {
  constructor(message: string, public readonly errors: string[] = [message]) {
    super(message);
    this.name = "PairedProfileValidationError";
  }
}

export class StaleProvenanceError extends Error {
  constructor(
    public readonly expectedSha256: string,
    public readonly actualSha256: string,
    message: string = `Stale profile provenance: expected hash ${expectedSha256} does not match actual source hash ${actualSha256}`
  ) {
    super(message);
    this.name = "StaleProvenanceError";
  }
}

export interface PairedProfileValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  profile?: PairedProfile | undefined;
}

/**
 * Performs strict validation of a PairedProfile v1 structure.
 */
export function validatePairedProfile(input: unknown): PairedProfileValidationResult {
  const errors: string[] = [];
  const bad = (message: string) => errors.push(message);
  try { assertSafeData(input); } catch (e) { return { valid: false, errors: [String(e)], warnings: [] }; }
  if (!input || typeof input !== "object" || Array.isArray(input)) return { valid: false, errors: ["Profile must be an object"], warnings: [] };
  const raw = input as Record<string, any>;
  const keys = ["schemaVersion", "name", "version", "description", "palette", "surfaces", "typography", "targetOverrides"];
  for (const key of Object.keys(raw)) if (!keys.includes(key)) bad(`Unknown profile field '${key}'`);
  if (raw.schemaVersion !== PAIRED_PROFILE_SCHEMA_VERSION) bad("Invalid schemaVersion");
  const surfaces = raw.surfaces && typeof raw.surfaces === "object" && !Array.isArray(raw.surfaces) ? { ...raw.surfaces } : raw.surfaces;
  if (surfaces && typeof surfaces === "object") {
    if (surfaces.content !== undefined && (!Number.isSafeInteger(surfaces.content) || surfaces.content <= 0)) bad("surfaces.content must be a positive safe integer");
    delete surfaces.content;
  }
  const shared = validateThemeSpecification({ schemaVersion: "tfss.theme-v1", name: raw.name, version: raw.version,
    ...(raw.description !== undefined ? { description: raw.description } : {}), palette: raw.palette, surfaces, typography: raw.typography });
  errors.push(...shared.errors);
  if (raw.targetOverrides !== undefined) {
    const overrides = raw.targetOverrides;
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) bad("targetOverrides must be an object");
    else for (const [target, value] of Object.entries(overrides)) {
      if (!["solarSail", "loom", "syntax"].includes(target)) bad(`Unknown targetOverrides.${target}`);
      if (!value || typeof value !== "object" || Array.isArray(value)) { bad(`targetOverrides.${target} must be an object`); continue; }
      const v = value as Record<string, any>;
      if (target === "solarSail" && v.surfaces !== undefined) {
        if (!v.surfaces || typeof v.surfaces !== "object" || Array.isArray(v.surfaces)) bad("Solar Sail surfaces override must be an object");
        else for (const key of ["radius", "borderWidth"]) if (v.surfaces[key] !== undefined && !isValidCssLength(v.surfaces[key])) bad(`Invalid solarSail.surfaces.${key}`);
      }
      if (target === "loom") {
        for (const key of ["primaryFamily", "secondaryFamily", "defaultAccent"]) if (v[key] !== undefined && (typeof v[key] !== "string" || !/^[a-z][a-z0-9-]*$/.test(v[key]))) bad(`Invalid loom.${key}`);
        if (v.content !== undefined && (!Number.isSafeInteger(v.content) || v.content <= 0)) bad("Invalid loom.content");
      }
      if (target === "syntax") {
        const walk = (node: unknown, path: string) => {
          if (node && typeof node === "object" && !Array.isArray(node)) { for (const [k, val] of Object.entries(node)) walk(val, `${path}.${k}`); }
          else if (/\.(light|dark)\./.test(path) && !isValidColor(node)) bad(`Invalid syntax color ${path}`);
        };
        walk(v, "syntax");
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings: [], ...(errors.length === 0 ? { profile: deepFreezeProfile(JSON.parse(JSON.stringify(raw))) as PairedProfile } : {}) };
}

/**
 * Asserts that the given value conforms strictly to tf-paired-profile-v1.
 */
export function assertValidPairedProfile(input: unknown): asserts input is PairedProfile {
  const result = validatePairedProfile(input);
  if (!result.valid || !result.profile) {
    throw new PairedProfileValidationError(
      `Paired profile validation failed:\n - ${result.errors.join("\n - ")}`,
      result.errors
    );
  }
}

// ============================================================================
// Additive Mapping Report
// ============================================================================

export type MappingEntryClassification =
  | "consumed"
  | "unsupported"
  | "target-specific"
  | "overridden"
  | "normalized"
  | "degraded";

export interface MappingReportEntry {
  classification: MappingEntryClassification;
  sourcePath: string;
  targetPath?: string | undefined;
  sourceValue?: unknown;
  targetValue?: unknown;
  reason: string;
}

export interface MappingReportSummary {
  totalLeaves: number;
  consumed: number;
  unsupported: number;
  targetSpecific: number;
  overridden: number;
  normalized: number;
  degraded: number;
}

export interface MappingReport {
  schema: "tf-paired-mapping-report-v1";
  target: "solar-sail" | "stellar-loom";
  profileName: string;
  entries: MappingReportEntry[];
  summary: MappingReportSummary;
}

/**
 * Generates an additive, truthful mapping report accounting for every semantic leaf
 * of the paired profile when mapping to a specific target engine.
 */
export function generateMappingReport(profile: PairedProfile, target: "solar-sail" | "stellar-loom", options?: { existingCatalog?: Record<string, any> }): MappingReport {
  assertValidPairedProfile(profile);
  if (target !== "solar-sail" && target !== "stellar-loom") throw new PairedProfileValidationError("Unknown mapping target");
  const entries: MappingReportEntry[] = [];
  const leaves = (node: unknown, path: string) => {
    if (node && typeof node === "object" && Object.keys(node).length) { for (const [key, value] of Object.entries(node)) leaves(value, path ? `${path}.${key}` : key); return; }
    let classification: MappingEntryClassification = "unsupported";
    let targetPath: string | undefined;
    let targetValue: unknown = node;
    let reason = "No mapping in this v1 target adapter";
    if (path === "schemaVersion") { classification = "normalized"; targetPath = path; targetValue = target === "solar-sail" ? "tfss.theme-v1" : "tfsl.theme-v2"; reason = "Explicit target schema adapter"; }
    else if (path === "name" || (target === "solar-sail" && ["version", "description"].includes(path))) { classification = "consumed"; targetPath = path; reason = "Copied metadata"; }
    else if (target === "solar-sail" && (/^palette\.(light|dark)\./.test(path) || path.startsWith("typography.") || ["surfaces.radius", "surfaces.borderWidth"].includes(path))) {
      classification = "consumed"; targetPath = path; reason = "Copied to application theme without color conversion";
      const key = path.split(".")[1]!;
      const override = (profile.targetOverrides?.solarSail?.surfaces as Record<string, unknown> | undefined)?.[key];
      if (path.startsWith("surfaces.") && override !== undefined) { classification = "overridden"; targetValue = override; reason = "Explicit Solar Sail override wins"; }
    } else if (path.startsWith("targetOverrides.")) {
      const [, owner, section, key] = path.split(".");
      const own = target === "solar-sail" ? "solarSail" : "loom";
      if (owner !== own) { classification = "target-specific"; reason = "Retained for another adapter; not applied by this mapper"; }
      else if (owner === "solarSail" && section === "surfaces" && ["radius", "borderWidth"].includes(key!)) { classification = "target-specific"; targetPath = `surfaces.${key}`; reason = "Applied Solar Sail surface override"; }
      else if (owner === "loom" && ["content", "defaultAccent", "primaryFamily", "secondaryFamily"].includes(section!)) { classification = "target-specific"; targetPath = section === "content" ? "surfaces.content" : section === "defaultAccent" ? "defaultAccent" : "tokenSets"; reason = "Applied Loom catalog selection"; }
    } else if (target === "stellar-loom") {
      if (path === "surfaces.content") { classification = profile.targetOverrides?.loom?.content === undefined ? "consumed" : "overridden"; targetPath = path; targetValue = profile.targetOverrides?.loom?.content ?? node; reason = "Loom reading measure"; }
      else if (/^palette\.(light|dark)\.(primary|ring|background|foreground|card|border|accent)$/.test(path)) { classification = "consumed"; targetPath = "tokenSets"; reason = "Projected into selected Loom accent family; companion catalog supplies the remaining intent"; }
    }
    entries.push({ classification, sourcePath: path, ...(targetPath ? { targetPath, targetValue } : {}), sourceValue: node, reason });
  };
  leaves(profile, "");
  // Defaults are an additional normalization event, not an unrepresented source leaf.
  if (target === "solar-sail" && !profile.description) entries.push({ classification: "normalized", sourcePath: "description", targetPath: "description", targetValue: `${profile.name} application theme for Tailwind CSS v4 and shadcn/ui`, reason: "Documented description default" });
  const count = (c: MappingEntryClassification) => entries.filter(e => e.classification === c).length;
  return { schema: MAPPING_REPORT_SCHEMA_VERSION, target, profileName: profile.name, entries, summary: { totalLeaves: entries.length, consumed: count("consumed"), unsupported: count("unsupported"), targetSpecific: count("target-specific"), overridden: count("overridden"), normalized: count("normalized"), degraded: count("degraded") } };
}

// ============================================================================
// Core Mappers (Preserving bare return shapes and override-wins precedence)
// ============================================================================

/**
 * Maps a shared declarative profile to a Theme Forge Solar Sail specification (`tfss.theme-v1`).
 * Embedded profile hashes are NOT trusted. Legacy options.sourceProfileSha256 is treated as a caller assertion.
 */
function mapSolarCore(
  profile: PairedProfile,
  options?: { sourceProfileSha256?: string }
): ThemeSpecification {
  assertValidPairedProfile(profile);
  // Explicit option is a caller assertion; embedded sha256 / sourceProfileSha256 are NOT trusted
  if (options) {
    assertSafeData(options);
    if (Object.keys(options).some(key => key !== "sourceProfileSha256") || (options.sourceProfileSha256 !== undefined && !/^[0-9a-f]{64}$/.test(options.sourceProfileSha256))) throw new PairedProfileValidationError("Invalid caller-asserted source hash option");
  }
  const callerAssertedDigest = options?.sourceProfileSha256;

  const surfaces: SurfacesConfig = {
    radius: profile.surfaces.radius,
    ...(profile.surfaces.borderWidth ? { borderWidth: profile.surfaces.borderWidth } : {}),
    ...Object.fromEntries(Object.entries((profile.targetOverrides?.solarSail?.surfaces ?? {}) as Record<string, unknown>).filter(([key]) => key === "radius" || key === "borderWidth")),
  };

  return {
    schemaVersion: "tfss.theme-v1",
    name: profile.name,
    version: profile.version,
    description:
      profile.description ||
      `${profile.name} application theme for Tailwind CSS v4 and shadcn/ui`,
    palette: {
      light: { ...profile.palette.light },
      dark: { ...profile.palette.dark },
    },
    surfaces,
    typography: {
      fontSans: profile.typography.fontSans,
      ...(profile.typography.fontHeading ? { fontHeading: profile.typography.fontHeading } : {}),
      ...(profile.typography.fontMono ? { fontMono: profile.typography.fontMono } : {}),
    },
    ...(callerAssertedDigest ? { sourceProfileSha256: callerAssertedDigest } : {}),
  };
}

export function mapProfileToSolarSail(profile: PairedProfile, options?: { sourceProfileSha256?: string }): ThemeSpecification {
  const report = generateMappingReport(profile, "solar-sail");
  if (report.entries.some(e => e.classification === "unsupported" && e.sourcePath.startsWith("targetOverrides.solarSail."))) throw new PairedProfileValidationError("Unsupported Solar Sail override; use mapProfileToSolarSailWithReport to inspect loss");
  return mapSolarCore(profile, options);
}

/**
 * Maps a shared declarative profile to a Solar Sail specification along with an additive mapping report.
 */
export function mapProfileToSolarSailWithReport(
  profile: PairedProfile,
  options?: { sourceProfileSha256?: string }
): {
  specification: ThemeSpecification;
  report: MappingReport;
} {
  const specification = mapSolarCore(profile, options);
  const report = generateMappingReport(profile, "solar-sail");
  return { specification, report };
}

/**
 * Maps a shared declarative profile to a Theme Forge Stellar Loom catalog specification (`tfsl.theme-v2`).
 * Hidden properties are completely removed; pass sourceProfileSha256 directly to compileThemeCatalog options instead.
 */
export function mapProfileToStellarLoom(
  profile: PairedProfile,
  existingCatalog: Record<string, any> = {},
  _options?: { sourceProfileSha256?: string }
): Record<string, any> {
  assertValidPairedProfile(profile);
  assertSafeData(existingCatalog);
  if (_options?.sourceProfileSha256 !== undefined) throw new PairedProfileValidationError("Pass sourceProfileSha256 explicitly to compileThemeCatalog; catalog objects cannot carry provenance options");
  const light = profile.palette.light;
  const dark = profile.palette.dark;

  const loomOverrides = profile.targetOverrides?.loom as Record<string, any> | undefined;

  const tokenSetKey =
    existingCatalog?.tokenSets && Object.keys(existingCatalog.tokenSets).length > 0
      ? Object.keys(existingCatalog.tokenSets)[0]
      : profile.name;

  const existingTokens = existingCatalog?.tokenSets?.[tokenSetKey] || {};

  const primaryFamily =
    (typeof loomOverrides?.primaryFamily === "string" ? loomOverrides.primaryFamily : undefined) ||
    ("cyan-light-accent-base" in existingTokens ? "cyan" : undefined) ||
    (typeof loomOverrides?.defaultAccent === "string" ? loomOverrides.defaultAccent : undefined) ||
    "cyan";

  const secondaryFamily =
    (typeof loomOverrides?.secondaryFamily === "string" ? loomOverrides.secondaryFamily : undefined) ||
    ("orange-light-accent-base" in existingTokens ? "orange" : undefined) ||
    "orange";

  const defaultAccent =
    (typeof loomOverrides?.defaultAccent === "string" ? loomOverrides.defaultAccent : undefined) ||
    existingCatalog.defaultAccent ||
    primaryFamily;

  const updatedTokens = {
    ...existingTokens,
    // Primary accent family (e.g. cyan)
    [`${primaryFamily}-light-accent-base`]: light.primary,
    [`${primaryFamily}-light-focus`]: light.ring || light.primary,
    [`${primaryFamily}-light-link`]: light.primary,
    [`${primaryFamily}-light-page`]: light.background,
    [`${primaryFamily}-light-body`]: light.foreground,
    [`${primaryFamily}-light-card`]: light.card,
    [`${primaryFamily}-light-hairline`]: light.border,
    [`${primaryFamily}-dark-accent-base`]: dark.primary,
    [`${primaryFamily}-dark-focus`]: dark.ring || dark.primary,
    [`${primaryFamily}-dark-link`]: dark.primary,
    [`${primaryFamily}-dark-page`]: dark.background,
    [`${primaryFamily}-dark-body`]: dark.foreground,
    [`${primaryFamily}-dark-card`]: dark.card,
    [`${primaryFamily}-dark-hairline`]: dark.border,

    // Secondary accent family (e.g. orange)
    [`${secondaryFamily}-light-accent-base`]: light.accent,
    [`${secondaryFamily}-light-focus`]: light.accent,
    [`${secondaryFamily}-light-link`]: light.accent,
    [`${secondaryFamily}-dark-accent-base`]: dark.accent,
    [`${secondaryFamily}-dark-focus`]: dark.accent,
    [`${secondaryFamily}-dark-link`]: dark.accent,
  };

  // Support Flexoki/palette naming conventions (acc-*, paper-*, ink-*)
  if (`acc-${defaultAccent}-base-light` in existingTokens) {
    updatedTokens[`acc-${defaultAccent}-base-light`] = light.primary;
  }
  if (`acc-${defaultAccent}-base-dark` in existingTokens) {
    updatedTokens[`acc-${defaultAccent}-base-dark`] = dark.primary;
  }
  if ("acc-orange-base-light" in existingTokens) {
    updatedTokens["acc-orange-base-light"] = light.accent;
  }
  if ("acc-orange-base-dark" in existingTokens) {
    updatedTokens["acc-orange-base-dark"] = dark.accent;
  }
  if ("paper-page-light" in existingTokens) {
    updatedTokens["paper-page-light"] = light.background;
  }
  if ("paper-page-dark" in existingTokens) {
    updatedTokens["paper-page-dark"] = dark.background;
  }
  if ("ink-body-light" in existingTokens) {
    updatedTokens["ink-body-light"] = light.foreground;
  }
  if ("ink-body-dark" in existingTokens) {
    updatedTokens["ink-body-dark"] = dark.foreground;
  }
  if ("ink-hairline-light" in existingTokens) {
    updatedTokens["ink-hairline-light"] = light.border;
  }
  if ("ink-hairline-dark" in existingTokens) {
    updatedTokens["ink-hairline-dark"] = dark.border;
  }

  const contentWidth =
    (typeof loomOverrides?.content === "number" ? loomOverrides.content : undefined) ||
    profile.surfaces.content ||
    704;

  const result: Record<string, any> = {
    ...existingCatalog,
    name: profile.name,
    schemaVersion: "tfsl.theme-v2",
    defaultAccent,
    tokenSets: {
      ...(existingCatalog.tokenSets || {}),
      [tokenSetKey]: updatedTokens,
    },
    surfaces: {
      ...(existingCatalog.surfaces || {}),
      content: contentWidth,
    },
  };

  // NOTE: Hidden non-enumerable sourceProfileSha256 property has been removed.
  // Callers pass sourceProfileSha256 directly to compileThemeCatalog(result, { sourceProfileSha256 }).

  return result;
}

/**
 * Maps a shared declarative profile to a Stellar Loom catalog along with an additive mapping report.
 */
export function mapProfileToStellarLoomWithReport(
  profile: PairedProfile,
  existingCatalog: Record<string, any> = {},
  options?: { sourceProfileSha256?: string }
): {
  catalog: Record<string, any>;
  report: MappingReport;
} {
  const catalog = mapProfileToStellarLoom(profile, existingCatalog);
  if (options?.sourceProfileSha256 !== undefined) throw new PairedProfileValidationError("Use bindSourceProfile for companion compiler provenance");
  const report = generateMappingReport(profile, "stellar-loom", { existingCatalog });
  return { catalog, report };
}

// ============================================================================
// Source-Aware API & Bound Paired Profile
// ============================================================================

export type ProvenanceVerificationStatus = "verified" | "unverified-assertion" | "transformed";

export interface ProfileProvenance {
  /** SHA-256 digest of the raw source bytes as provided. Empty if unverified in-memory draft. */
  rawSourceSha256: string;
  /** SHA-256 digest of the canonicalized normalized JSON representation. */
  normalizedSha256: string;
  /** Verification status of the bound profile provenance. */
  verificationStatus: ProvenanceVerificationStatus;
  /** Whether the profile has undergone in-memory mutation/transformation after source binding. */
  isTransformed: boolean;
  /** Length in bytes of the bound source. */
  byteLength: number;
  parentSourceSha256?: string;
}

export interface BoundPairedProfile {
  readonly profile: PairedProfile;
  readonly provenance: ProfileProvenance;

  mapToSolarSail(): {
    specification: ThemeSpecification;
    report: MappingReport;
    sourceProfileSha256: string;
  };

  mapToStellarLoom(existingCatalog?: Record<string, any>): {
    catalog: Record<string, any>;
    report: MappingReport;
    sourceProfileSha256: string;
  };

  mapToSyntaxPalette(): ProfileSyntaxModel;

  /**
   * Applies an in-memory transformation, returning a new BoundPairedProfile
   * with distinct normalized identity and marked as transformed.
   */
  transform(mutator: (draft: PairedProfile) => PairedProfile | void): BoundPairedProfile;
}

/**
 * Canonicalizes a profile object into a deterministic JSON string with sorted keys.
 */
export function canonicalizeProfile(obj: unknown): string {
  function sortKeys(val: unknown): unknown {
    if (val === null || typeof val !== "object") return val;
    if (Array.isArray(val)) return val.map(sortKeys);
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(val).sort((a, b) => a.localeCompare(b, "en"))) {
      sorted[key] = sortKeys((val as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return JSON.stringify(sortKeys(obj), null, 2) + "\n";
}

function deepFreezeProfile<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) deepFreezeProfile(child); Object.freeze(value); }
  return value;
}

function createBoundProfileInstance(
  profile: PairedProfile,
  provenance: ProfileProvenance
): BoundPairedProfile {
  const profileCopy = deepFreezeProfile(JSON.parse(JSON.stringify(profile))) as PairedProfile;

  return {
    profile: profileCopy,
    provenance: Object.freeze({ ...provenance }),

    mapToSolarSail() {
      const report = generateMappingReport(profileCopy, "solar-sail");
      const effectiveSha256 = provenance.verificationStatus === "unverified-assertion" ? "" : provenance.rawSourceSha256;
      const specification = mapSolarCore(profileCopy, {
        ...(effectiveSha256 ? { sourceProfileSha256: effectiveSha256 } : {}),
      });
      return {
        specification,
        report,
        sourceProfileSha256: effectiveSha256,
      };
    },

    mapToStellarLoom(existingCatalog: Record<string, any> = {}) {
      const report = generateMappingReport(profileCopy, "stellar-loom", { existingCatalog });
      const catalog = mapProfileToStellarLoom(profileCopy, existingCatalog);
      const effectiveSha256 = provenance.verificationStatus === "unverified-assertion" ? "" : provenance.rawSourceSha256;
      return {
        catalog,
        report,
        sourceProfileSha256: effectiveSha256,
      };
    },

    mapToSyntaxPalette() {
      return mapProfileToSyntaxPalette(profileCopy);
    },

    transform(mutator: (draft: PairedProfile) => PairedProfile | void): BoundPairedProfile {
      const draft = JSON.parse(JSON.stringify(profileCopy)) as PairedProfile;
      const res = mutator(draft);
      const mutated = (res !== undefined ? res : draft) as PairedProfile;
      assertValidPairedProfile(mutated);

      const newNormalizedJson = canonicalizeProfile(mutated);
      const newNormalizedSha256 = createHash("sha256").update(newNormalizedJson).digest("hex");

      return createBoundProfileInstance(mutated, {
        rawSourceSha256: createHash("sha256").update(newNormalizedJson).digest("hex"),
        parentSourceSha256: provenance.rawSourceSha256,
        normalizedSha256: newNormalizedSha256,
        verificationStatus: "transformed",
        isTransformed: true,
        byteLength: Buffer.byteLength(newNormalizedJson, "utf8"),
      });
    },
  };
}

export interface BindSourceProfileOptions {
  /** Optional expected SHA-256 hash. If provided, verified against actual raw bytes. */
  expectedSha256?: string | undefined;
}

/**
 * Binds actual source bytes, calculates and verifies the raw SHA-256 digest,
 * rejects stale provenance, safely parses and validates the paired profile,
 * and computes a separate normalized semantic identity.
 */
export function bindSourceProfile(
  source: string | Uint8Array,
  options?: BindSourceProfileOptions
): BoundPairedProfile {
  const rawBytes = typeof source === "string" ? Buffer.from(source, "utf8") : Buffer.from(source);
  const rawSourceSha256 = createHash("sha256").update(rawBytes).digest("hex");

  if (options?.expectedSha256) {
    const expected = options.expectedSha256.startsWith("sha256:")
      ? options.expectedSha256.slice(7)
      : options.expectedSha256;
    if (expected.toLowerCase() !== rawSourceSha256.toLowerCase()) {
      throw new StaleProvenanceError(
        options.expectedSha256,
        `sha256:${rawSourceSha256}`
      );
    }
  }

  const parsed = parseThemeJson(rawBytes);
  assertValidPairedProfile(parsed);
  const profile: PairedProfile = parsed;

  const normalizedJson = canonicalizeProfile(profile);
  const normalizedSha256 = createHash("sha256").update(normalizedJson).digest("hex");

  return createBoundProfileInstance(profile, {
    rawSourceSha256,
    normalizedSha256,
    verificationStatus: "verified",
    isTransformed: false,
    byteLength: rawBytes.byteLength,
  });
}

/**
 * Creates a BoundPairedProfile from an existing in-memory profile object.
 * Legacy hash assertions are recorded as unverified caller assertions.
 */
export function fromUnverifiedProfile(
  profile: PairedProfile,
  options?: { assertedSha256?: string }
): BoundPairedProfile {
  assertValidPairedProfile(profile);

  const cleanAsserted = options?.assertedSha256
    ? options.assertedSha256.startsWith("sha256:")
      ? options.assertedSha256.slice(7)
      : options.assertedSha256
    : "";

  const normalizedJson = canonicalizeProfile(profile);
  const normalizedSha256 = createHash("sha256").update(normalizedJson).digest("hex");

  return createBoundProfileInstance(profile, {
    rawSourceSha256: cleanAsserted,
    normalizedSha256,
    verificationStatus: "unverified-assertion",
    isTransformed: false,
    byteLength: Buffer.byteLength(normalizedJson, "utf8"),
  });
}

// ============================================================================
// Syntax Palette Model Mapping (Preserved for Stellar Loom syntax compilation)
// ============================================================================

export interface ProfileSyntaxCategoryColors {
  comment: string;
  string: string;
  number: string;
  constant: string;
  keyword: string;
  function: string;
  type: string;
  variable: string;
  punctuation: string;
  tag: string;
  attribute: string;
}

export interface ProfileSyntaxCategoryPalette {
  light: ProfileSyntaxCategoryColors;
  dark: ProfileSyntaxCategoryColors;
}

export interface ProfileChromeRoleColors {
  background: string;
  foreground: string;
  border: string;
  focus: string;
  tabBarBackground: string;
  tabBarBorder: string;
  activeTabBackground: string;
  activeTabForeground: string;
  activeTabBorder: string;
  terminalTitlebarBackground: string;
  terminalTitlebarForeground: string;
  copyButtonForeground: string;
  copyButtonBorder: string;
  tooltipSuccessBackground: string;
  tooltipSuccessForeground: string;
}

export interface ProfileChromePalette {
  light: ProfileChromeRoleColors;
  dark: ProfileChromeRoleColors;
}

export interface ProfileDiffRoleColors {
  inserted?: string | undefined;
  deleted?: string | undefined;
  marked?: string | undefined;
  insertedBackground?: string | undefined;
  deletedBackground?: string | undefined;
  markedBackground?: string | undefined;
}

export interface ProfileDiffPalette {
  light: ProfileDiffRoleColors;
  dark: ProfileDiffRoleColors;
}

export interface ProfileSyntaxModel {
  syntax: ProfileSyntaxCategoryPalette;
  chrome?: Partial<ProfileChromePalette> | undefined;
  diffs?: Partial<ProfileDiffPalette> | undefined;
  copy?: ("standard" | "minimal") | undefined;
  frame?: ("editor" | "terminal" | "plain") | undefined;
  tabs?: {
    activeIndicator?: ("top" | "bottom" | "border" | "accent") | undefined;
  } | undefined;
}

/**
 * Maps a shared declarative profile to a SyntaxPaletteModel compatible with
 * Stellar Loom syntax compilation (Outcome D).
 */
export function mapProfileToSyntaxPalette(profile: PairedProfile): ProfileSyntaxModel {
  assertValidPairedProfile(profile);
  const light = profile.palette.light;
  const dark = profile.palette.dark;

  const syntaxOverride = profile.targetOverrides?.syntax || {};

  const derivedSyntax: ProfileSyntaxCategoryPalette = {
    light: {
      comment: light.mutedForeground,
      string: light.primary,
      number: light.accent,
      constant: light.accent,
      keyword: light.primary,
      function: light.primary,
      type: light.primary,
      variable: light.foreground,
      punctuation: light.mutedForeground,
      tag: light.primary,
      attribute: light.accent,
      ...(syntaxOverride.syntax?.light || {}),
    },
    dark: {
      comment: dark.mutedForeground,
      string: dark.primary,
      number: dark.accent,
      constant: dark.accent,
      keyword: dark.primary,
      function: dark.primary,
      type: dark.primary,
      variable: dark.foreground,
      punctuation: dark.mutedForeground,
      tag: dark.primary,
      attribute: dark.accent,
      ...(syntaxOverride.syntax?.dark || {}),
    },
  };

  const derivedChrome: ProfileChromePalette = {
    light: {
      background: light.background,
      foreground: light.foreground,
      border: light.border,
      focus: light.ring || light.primary,
      tabBarBackground: light.card || light.muted,
      tabBarBorder: light.border,
      activeTabBackground: light.background,
      activeTabForeground: light.foreground,
      activeTabBorder: light.border,
      terminalTitlebarBackground: light.muted,
      terminalTitlebarForeground: light.foreground,
      copyButtonForeground: light.mutedForeground,
      copyButtonBorder: light.border,
      tooltipSuccessBackground: light.primary,
      tooltipSuccessForeground: light.primaryForeground,
      ...(syntaxOverride.chrome?.light || {}),
    },
    dark: {
      background: dark.background,
      foreground: dark.foreground,
      border: dark.border,
      focus: dark.ring || dark.primary,
      tabBarBackground: dark.card || dark.muted,
      tabBarBorder: dark.border,
      activeTabBackground: dark.background,
      activeTabForeground: dark.foreground,
      activeTabBorder: dark.border,
      terminalTitlebarBackground: dark.muted,
      terminalTitlebarForeground: dark.foreground,
      copyButtonForeground: dark.mutedForeground,
      copyButtonBorder: dark.border,
      tooltipSuccessBackground: dark.primary,
      tooltipSuccessForeground: dark.primaryForeground,
      ...(syntaxOverride.chrome?.dark || {}),
    },
  };

  return {
    syntax: derivedSyntax,
    chrome: derivedChrome,
    diffs: syntaxOverride.diffs,
    copy: syntaxOverride.copy || "standard",
    frame: syntaxOverride.frame || "editor",
    tabs: syntaxOverride.tabs || { activeIndicator: "accent" },
  };
}
