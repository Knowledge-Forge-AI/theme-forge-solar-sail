import type {
  ColorTokens,
  SurfacesConfig,
  ThemeSpecification,
  TypographyConfig,
} from "./types.js";

export const PAIRED_PROFILE_SCHEMA_VERSION = "tf-paired-profile-v1";

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

/**
 * Maps a shared declarative profile to a Theme Forge Solar Sail specification (`tfss.theme-v1`).
 */
export function mapProfileToSolarSail(
  profile: PairedProfile,
  options?: { sourceProfileSha256?: string }
): ThemeSpecification {
  const profileDigest =
    options?.sourceProfileSha256 ||
    (profile as any).sourceProfileSha256 ||
    (profile as any).sha256;
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
    surfaces: {
      radius: profile.surfaces.radius,
      ...(profile.surfaces.borderWidth ? { borderWidth: profile.surfaces.borderWidth } : {}),
      ...(profile.targetOverrides?.solarSail?.surfaces &&
      typeof profile.targetOverrides.solarSail.surfaces === "object"
        ? (profile.targetOverrides.solarSail.surfaces as Partial<SurfacesConfig>)
        : {}),
    },
    typography: {
      fontSans: profile.typography.fontSans,
      ...(profile.typography.fontHeading ? { fontHeading: profile.typography.fontHeading } : {}),
      ...(profile.typography.fontMono ? { fontMono: profile.typography.fontMono } : {}),
    },
    ...(profileDigest ? { sourceProfileSha256: profileDigest } : {}),
  };
}

/**
 * Maps a shared declarative profile to a Theme Forge Stellar Loom catalog specification (`tfsl.theme-v2`).
 */
export function mapProfileToStellarLoom(
  profile: PairedProfile,
  existingCatalog: Record<string, any> = {},
  options?: { sourceProfileSha256?: string }
): Record<string, any> {
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

  const profileDigest =
    options?.sourceProfileSha256 ||
    (profile as any).sourceProfileSha256 ||
    (profile as any).sha256;

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
  if (profileDigest) {
    Object.defineProperty(result, "sourceProfileSha256", {
      value: profileDigest,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

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

