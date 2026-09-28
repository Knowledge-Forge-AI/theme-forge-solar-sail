import {
  THEME_SCHEMA_VERSION,
  type ColorTokens,
  type ThemeDiagnostic,
  type ThemeSpecification,
  type PackageMetadata,
} from "./types.js";
import { assertSafeData, SafeDataError } from "./input.js";

const MANDATORY_ROLES: (keyof ColorTokens)[] = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "popover",
  "popoverForeground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
  "destructive",
  "destructiveForeground",
  "border",
  "input",
  "ring",
];

const OPTIONAL_CHART_ROLES: (keyof ColorTokens)[] = [
  "chart1",
  "chart2",
  "chart3",
  "chart4",
  "chart5",
];

const OPTIONAL_SIDEBAR_ROLES: (keyof ColorTokens)[] = [
  "sidebar",
  "sidebarForeground",
  "sidebarPrimary",
  "sidebarPrimaryForeground",
  "sidebarAccent",
  "sidebarAccentForeground",
  "sidebarBorder",
  "sidebarRing",
];

const ALL_ALLOWED_ROLES = new Set<string>([
  ...MANDATORY_ROLES,
  ...OPTIONAL_CHART_ROLES,
  ...OPTIONAL_SIDEBAR_ROLES,
]);

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "name",
  "version",
  "description",
  "palette",
  "surfaces",
  "typography",
  "sourceProfileSha256",
]);

const ALLOWED_SURFACES_KEYS = new Set(["radius", "borderWidth"]);
const ALLOWED_TYPOGRAPHY_KEYS = new Set(["fontSans", "fontHeading", "fontMono"]);
const ALLOWED_PALETTE_KEYS = new Set(["light", "dark"]);
const ALLOWED_PACKAGE_METADATA_KEYS = new Set([
  "name",
  "version",
  "description",
  "author",
  "license",
  "private",
]);

const CONTRAST_PAIRS: [keyof ColorTokens, keyof ColorTokens, number, string][] = [
  ["foreground", "background", 4.5, "Text contrast"],
  ["cardForeground", "card", 4.5, "Card text contrast"],
  ["popoverForeground", "popover", 4.5, "Popover text contrast"],
  ["primaryForeground", "primary", 3.0, "Primary button text contrast"],
  ["secondaryForeground", "secondary", 3.0, "Secondary text contrast"],
  ["mutedForeground", "muted", 3.0, "Muted text contrast"],
  ["accentForeground", "accent", 3.0, "Accent text contrast"],
  ["destructiveForeground", "destructive", 3.0, "Destructive button text contrast"],
];

const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const PACKAGE_NAME_REGEX = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function parseHexColor(hex: string): [number, number, number] | null {
  const trimmed = hex.trim();
  const match6 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(trimmed);
  if (match6) {
    return [
      parseInt(match6[1]!, 16),
      parseInt(match6[2]!, 16),
      parseInt(match6[3]!, 16),
    ];
  }
  const match3 = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(trimmed);
  if (match3) {
    return [
      parseInt(match3[1]! + match3[1]!, 16),
      parseInt(match3[2]! + match3[2]!, 16),
      parseInt(match3[3]! + match3[3]!, 16),
    ];
  }
  return null;
}

export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs! + 0.7152 * gs! + 0.0722 * bs!;
}

export function calculateContrastRatio(colorA: string, colorB: string): number | null {
  if (hasAlphaChannel(colorA) || hasAlphaChannel(colorB)) {
    return null;
  }
  const rgbA = parseHexColor(colorA);
  const rgbB = parseHexColor(colorB);
  if (!rgbA || !rgbB) return null;
  const l1 = relativeLuminance(rgbA);
  const l2 = relativeLuminance(rgbB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function hasAlphaChannel(color: string): boolean {
  const s = color.trim().toLowerCase();
  // 4-digit or 8-digit hex has explicit alpha
  if (/^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/i.test(s)) return true;
  if (/^rgba?\(.*[/,].*\)$/i.test(s)) {
    const inside = s.slice(s.indexOf("(") + 1, -1).trim();
    if (inside.includes(",")) {
      return inside.split(",").length === 4;
    }
    if (inside.includes("/")) {
      return true;
    }
  }
  if (/^hsla?\(.*[/,].*\)$/i.test(s)) {
    const inside = s.slice(s.indexOf("(") + 1, -1).trim();
    if (inside.includes(",")) {
      return inside.split(",").length === 4;
    }
    if (inside.includes("/")) {
      return true;
    }
  }
  if (/^oklch\(.*\)$/i.test(s)) {
    const inside = s.slice(s.indexOf("(") + 1, -1).trim();
    if (inside.includes("/")) {
      return true;
    }
  }
  return false;
}

function isValidRgb(s: string): boolean {
  const match = /^rgba?\((.+)\)$/i.exec(s);
  if (!match) return false;
  const inside = match[1]!.trim();
  if (/[\r\n\0;\<\>\{\}\\\"\'\(\)]/.test(inside)) return false;

  if (inside.includes(",")) {
    if (inside.includes("/")) return false;
    const parts = inside.split(",");
    if (parts.length !== 3 && parts.length !== 4) return false;
    for (let i = 0; i < 3; i++) {
      if (!/^(?:\d+(?:\.\d+)?%?|\.\d+%?)$/.test(parts[i]!.trim())) return false;
    }
    if (parts.length === 4) {
      if (!/^(?:\d+(?:\.\d+)?%?|\.\d+%?|none)$/.test(parts[3]!.trim())) return false;
    }
    return true;
  }

  if (inside.includes("/")) {
    const slashParts = inside.split("/");
    if (slashParts.length !== 2) return false;
    const left = slashParts[0]!.trim().split(/\s+/);
    if (left.length !== 3) return false;
    for (const p of left) {
      if (!/^(?:\d+(?:\.\d+)?%?|\.\d+%?|none)$/.test(p)) return false;
    }
    const right = slashParts[1]!.trim();
    return /^(?:\d+(?:\.\d+)?%?|\.\d+%?|none)$/.test(right);
  }

  const tokens = inside.split(/\s+/);
  if (tokens.length !== 3) return false;
  for (const t of tokens) {
    if (!/^(?:\d+(?:\.\d+)?%?|\.\d+%?|none)$/.test(t)) return false;
  }
  return true;
}

function isValidHsl(s: string): boolean {
  const match = /^hsla?\((.+)\)$/i.exec(s);
  if (!match) return false;
  const inside = match[1]!.trim();
  if (/[\r\n\0;\<\>\{\}\\\"\'\(\)]/.test(inside)) return false;

  if (inside.includes(",")) {
    if (inside.includes("/")) return false;
    const parts = inside.split(",");
    if (parts.length !== 3 && parts.length !== 4) return false;
    if (!/^(?:-?\d+(?:\.\d+)?(?:deg|rad|grad|turn)?|none)$/.test(parts[0]!.trim())) return false;
    if (!/^(?:\d+(?:\.\d+)?%|none)$/.test(parts[1]!.trim())) return false;
    if (!/^(?:\d+(?:\.\d+)?%|none)$/.test(parts[2]!.trim())) return false;
    if (parts.length === 4) {
      if (!/^(?:\d+(?:\.\d+)?%?|\.\d+%?|none)$/.test(parts[3]!.trim())) return false;
    }
    return true;
  }

  if (inside.includes("/")) {
    const slashParts = inside.split("/");
    if (slashParts.length !== 2) return false;
    const left = slashParts[0]!.trim().split(/\s+/);
    if (left.length !== 3) return false;
    if (!/^(?:-?\d+(?:\.\d+)?(?:deg|rad|grad|turn)?|none)$/.test(left[0]!)) return false;
    if (!/^(?:\d+(?:\.\d+)?%|none)$/.test(left[1]!)) return false;
    if (!/^(?:\d+(?:\.\d+)?%|none)$/.test(left[2]!)) return false;
    const right = slashParts[1]!.trim();
    return /^(?:\d+(?:\.\d+)?%?|\.\d+%?|none)$/.test(right);
  }

  const tokens = inside.split(/\s+/);
  if (tokens.length !== 3) return false;
  if (!/^(?:-?\d+(?:\.\d+)?(?:deg|rad|grad|turn)?|none)$/.test(tokens[0]!)) return false;
  if (!/^(?:\d+(?:\.\d+)?%|none)$/.test(tokens[1]!)) return false;
  if (!/^(?:\d+(?:\.\d+)?%|none)$/.test(tokens[2]!)) return false;
  return true;
}

function isValidOklch(s: string): boolean {
  const match = /^oklch\((.+)\)$/i.exec(s);
  if (!match) return false;
  const inside = match[1]!.trim();
  if (/[\r\n\0;\<\>\{\}\\\"\'\(\),]/.test(inside)) return false; // commas forbidden in oklch

  if (inside.includes("/")) {
    const slashParts = inside.split("/");
    if (slashParts.length !== 2) return false;
    const left = slashParts[0]!.trim().split(/\s+/);
    if (left.length !== 3) return false;
    if (!/^(?:\d+(?:\.\d+)?%?|\.\d+%?|none)$/.test(left[0]!)) return false;
    if (!/^(?:\d+(?:\.\d+)?%?|\.\d+%?|none)$/.test(left[1]!)) return false;
    if (!/^(?:-?\d+(?:\.\d+)?(?:deg|rad|grad|turn)?|none)$/.test(left[2]!)) return false;
    const right = slashParts[1]!.trim();
    return /^(?:\d+(?:\.\d+)?%?|\.\d+%?|none)$/.test(right);
  }

  const tokens = inside.split(/\s+/);
  if (tokens.length !== 3) return false;
  if (!/^(?:\d+(?:\.\d+)?%?|\.\d+%?|none)$/.test(tokens[0]!)) return false;
  if (!/^(?:\d+(?:\.\d+)?%?|\.\d+%?|none)$/.test(tokens[1]!)) return false;
  if (!/^(?:-?\d+(?:\.\d+)?(?:deg|rad|grad|turn)?|none)$/.test(tokens[2]!)) return false;
  return true;
}

function isValidVar(s: string): boolean {
  const match = /^var\(\s*(--[a-zA-Z0-9_-]+)(?:\s*,\s*(.+))?\s*\)$/.exec(s);
  if (!match) return false;
  const fallback = match[2]?.trim();
  if (fallback === undefined) return true;
  if (/[\r\n\0;\<\>\{\}\\\"\']/.test(fallback)) return false;
  return isValidColor(fallback);
}

export function isValidColor(str: unknown): boolean {
  if (typeof str !== "string" || !str.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(str)) return false;
  const s = str.trim();
  if (s.length > 512 || (s.match(/\(/g)?.length ?? 0) > 8 || [...s.matchAll(/-?(?:\d+(?:\.\d+)?|\.\d+)/g)].some(m => !Number.isFinite(Number(m[0])))) return false;
  if (/[\r\n\0;\<\>\{\}\\]/.test(s)) return false;
  if (/\/\*|\*\//.test(s)) return false;

  // Range-check RGB channels, saturation/lightness and alpha. Finite hue
  // angles and nonnegative OKLCH chroma retain their caller-provided magnitude;
  // v1 does not perform hue normalization or gamut conversion.
  const numeric = /^(rgb|rgba|hsl|hsla|oklch)\((.*)\)$/i.exec(s);
  if (numeric) {
    const body = numeric[2]!;
    const parts = body.split(/[\s,\/]+/).filter(Boolean);
    const inRange = (value: string, max: number) => value === "none" || (Number.isFinite(parseFloat(value)) && parseFloat(value) >= 0 && parseFloat(value) <= (value.endsWith("%") ? 100 : max));
    if (parts.length === 4 && !inRange(parts[3]!, 1)) return false;
    if (body.includes(",") && parts.includes("none")) return false;
    if (/^rgb/.test(numeric[1]!)) {
      if (parts.slice(0, 3).some(p => !inRange(p, 255))) return false;
      if (body.includes(",") && new Set(parts.slice(0, 3).map(p => p.endsWith("%"))).size !== 1) return false;
    } else if (/^hsl/.test(numeric[1]!)) {
      if (parts.slice(1, 3).some(p => !inRange(p, 100))) return false;
    } else if (!inRange(parts[0] ?? "", 1)) return false;
  }

  // 1. Hex
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) {
    return true;
  }

  // 2. var()
  if (s.startsWith("var(")) {
    return isValidVar(s);
  }

  // 3. rgb() / rgba()
  if (s.startsWith("rgb(") || s.startsWith("rgba(")) {
    return isValidRgb(s);
  }

  // 4. hsl() / hsla()
  if (s.startsWith("hsl(") || s.startsWith("hsla(")) {
    return isValidHsl(s);
  }

  // 5. oklch()
  if (s.startsWith("oklch(")) {
    return isValidOklch(s);
  }

  return false;
}

export function isValidCssLength(str: unknown): boolean {
  if (typeof str !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(str)) return false;
  const s = str.trim();
  if (/[\r\n\0;\<\>\{\}\\\(\)\"\']/.test(s)) return false;
  return s.length <= 64 && Number.isFinite(parseFloat(s)) && /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:rem|px|em|%|pt|vh|vw))$/.test(s);
}

export function isValidFontStack(str: unknown): boolean {
  if (typeof str !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(str)) return false;
  const s = str.trim();
  if (!s || s.length > 500) return false;
  if (/[\r\n\0;\<\>\{\}\\\/\*\@\(\)]/.test(s)) return false;

  const parts = s.split(",");
  if (parts.length === 0) return false;

  for (const part of parts) {
    const p = part.trim();
    if (!p || p.length > 100) return false;
    if (!/^(?:'[^',]+'|"[^",]+"|[a-zA-Z0-9_-]+(?: [a-zA-Z0-9_-]+)*)$/.test(p)) {
      return false;
    }
  }
  return true;
}

function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === "object") {
    for (const val of Object.values(obj)) {
      deepFreeze(val);
    }
    Object.freeze(obj);
  }
  return obj;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  diagnostics: ThemeDiagnostic[];
  specification?: ThemeSpecification | undefined;
}

export function validateThemeSpecification(input: unknown): ValidationResult {
  const errors: string[] = [];
  const diagnostics: ThemeDiagnostic[] = [];

  // 1. Assert pre-validation object safety without invoking getters
  try {
    assertSafeData(input);
  } catch (err: any) {
    const code = err instanceof SafeDataError ? err.code : "UNSAFE_INPUT";
    return {
      valid: false,
      errors: [err.message || "Unsafe input data structure"],
      diagnostics: [
        {
          severity: "error",
          code,
          message: err.message || "Unsafe input data structure",
          path: err.path,
        },
      ],
    };
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      valid: false,
      errors: ["Theme specification must be a non-null object"],
      diagnostics: [
        {
          severity: "error",
          code: "INVALID_ROOT",
          message: "Theme specification must be a non-null object",
        },
      ],
    };
  }

  const raw = input as Record<string, unknown>;

  // 2. Harden top-level keys
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      errors.push(`Unknown top-level field '${key}'`);
      diagnostics.push({
        severity: "error",
        code: "UNKNOWN_FIELD",
        message: `Unknown top-level field '${key}'`,
        path: key,
      });
    }
  }

  // 3. Schema version
  if (raw.schemaVersion !== THEME_SCHEMA_VERSION) {
    errors.push(
      `Invalid schemaVersion: expected '${THEME_SCHEMA_VERSION}', got '${String(raw.schemaVersion)}'`
    );
    diagnostics.push({
      severity: "error",
      code: "INVALID_SCHEMA_VERSION",
      message: `Invalid schemaVersion: expected '${THEME_SCHEMA_VERSION}'`,
      path: "schemaVersion",
    });
  }

  // 4. Name
  if (typeof raw.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.name)) {
    errors.push("Field 'name' must be a lowercase kebab-case string between 1 and 64 characters");
    diagnostics.push({
      severity: "error",
      code: "INVALID_NAME",
      message: "Field 'name' must be a lowercase kebab-case string between 1 and 64 characters",
      path: "name",
    });
  }

  // 5. Version
  if (typeof raw.version !== "string" || !SEMVER_REGEX.test(raw.version)) {
    errors.push("Field 'version' must follow semantic versioning (e.g. '0.1.0')");
    diagnostics.push({
      severity: "error",
      code: "INVALID_VERSION",
      message: "Field 'version' must follow semantic versioning",
      path: "version",
    });
  }

  // 6. Description (optional)
  if (raw.description !== undefined) {
    if (
      typeof raw.description !== "string" ||
      /[\u0000-\u001f\u007f-\u009f]/.test(raw.description) ||
      raw.description.length > 512
    ) {
      errors.push("Optional field 'description' must be a single-line string of at most 512 characters without controls");
      diagnostics.push({
        severity: "error",
        code: "INVALID_DESCRIPTION",
        message: "Optional field 'description' must be a single-line string of at most 512 characters without controls",
        path: "description",
      });
    }
  }

  // 7. sourceProfileSha256 (optional)
  if (raw.sourceProfileSha256 !== undefined) {
    if (
      typeof raw.sourceProfileSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(raw.sourceProfileSha256)
    ) {
      errors.push("Optional field 'sourceProfileSha256' must be a 64-character lowercase hex digest");
      diagnostics.push({
        severity: "error",
        code: "INVALID_SOURCE_PROFILE_SHA256",
        message: "Optional field 'sourceProfileSha256' must be a 64-character lowercase hex digest",
        path: "sourceProfileSha256",
      });
    }
  }

  // 8. Palette
  let cleanLight: Record<string, string> | undefined;
  let cleanDark: Record<string, string> | undefined;

  if (!raw.palette || typeof raw.palette !== "object" || Array.isArray(raw.palette)) {
    errors.push("Field 'palette' must be an object with 'light' and 'dark' color token maps");
    diagnostics.push({
      severity: "error",
      code: "INVALID_PALETTE",
      message: "Field 'palette' must be an object with 'light' and 'dark' color token maps",
      path: "palette",
    });
  } else {
    const palette = raw.palette as Record<string, unknown>;

    for (const key of Object.keys(palette)) {
      if (!ALLOWED_PALETTE_KEYS.has(key)) {
        errors.push(`Unknown field 'palette.${key}'`);
        diagnostics.push({
          severity: "error",
          code: "UNKNOWN_FIELD",
          message: `Unknown field 'palette.${key}'`,
          path: `palette.${key}`,
        });
      }
    }

    const modeTokens: Record<"light" | "dark", Record<string, unknown> | null> = {
      light: null,
      dark: null,
    };

    for (const mode of ["light", "dark"] as const) {
      if (!palette[mode] || typeof palette[mode] !== "object" || Array.isArray(palette[mode])) {
        errors.push(`Field 'palette.${mode}' must be an object containing required color roles`);
        diagnostics.push({
          severity: "error",
          code: "INVALID_PALETTE_MODE",
          message: `Field 'palette.${mode}' must be an object containing required color roles`,
          path: `palette.${mode}`,
        });
      } else {
        const tokens = palette[mode] as Record<string, unknown>;
        modeTokens[mode] = tokens;

        // Check for unknown semantic roles
        for (const role of Object.keys(tokens)) {
          if (!ALL_ALLOWED_ROLES.has(role)) {
            errors.push(`Unknown semantic color role 'palette.${mode}.${role}'`);
            diagnostics.push({
              severity: "error",
              code: "UNKNOWN_COLOR_ROLE",
              message: `Unknown semantic color role 'palette.${mode}.${role}' is not a documented role`,
              path: `palette.${mode}.${role}`,
            });
          }
        }

        // Check mandatory roles
        for (const role of MANDATORY_ROLES) {
          const val = tokens[role];
          if (!isValidColor(val)) {
            errors.push(
              `Role 'palette.${mode}.${role}' is required and must be a valid color string (hex, oklch, hsl, rgb, var)`
            );
            diagnostics.push({
              severity: "error",
              code: "MISSING_OR_INVALID_COLOR_ROLE",
              message: `Role 'palette.${mode}.${role}' is invalid or missing`,
              path: `palette.${mode}.${role}`,
            });
          }
        }

        // Check optional roles syntax if present
        for (const role of Object.keys(tokens)) {
          if (ALL_ALLOWED_ROLES.has(role) && !MANDATORY_ROLES.includes(role as keyof ColorTokens)) {
            const val = tokens[role];
            if (!isValidColor(val)) {
              errors.push(`Role 'palette.${mode}.${role}' must be a valid color string`);
              diagnostics.push({
                severity: "error",
                code: "MISSING_OR_INVALID_COLOR_ROLE",
                message: `Role 'palette.${mode}.${role}' is not a valid color string`,
                path: `palette.${mode}.${role}`,
              });
            }
          }
        }
      }
    }

    // Palette role symmetry check (light vs dark)
    if (modeTokens.light && modeTokens.dark) {
      const lightRoles = Object.keys(modeTokens.light);
      const darkRoles = Object.keys(modeTokens.dark);

      for (const role of lightRoles) {
        if (!Object.hasOwn(modeTokens.dark, role)) {
          errors.push(`Color role '${role}' is defined in palette.light but missing in palette.dark`);
          diagnostics.push({
            severity: "error",
            code: "ASYMMETRIC_COLOR_ROLES",
            message: `Color role '${role}' is defined in palette.light but missing in palette.dark`,
            path: `palette.dark.${role}`,
          });
        }
      }

      for (const role of darkRoles) {
        if (!Object.hasOwn(modeTokens.light, role)) {
          errors.push(`Color role '${role}' is defined in palette.dark but missing in palette.light`);
          diagnostics.push({
            severity: "error",
            code: "ASYMMETRIC_COLOR_ROLES",
            message: `Color role '${role}' is defined in palette.dark but missing in palette.light`,
            path: `palette.light.${role}`,
          });
        }
      }

      // Build clean maps if valid
      cleanLight = {};
      for (const key of Object.keys(modeTokens.light).sort()) {
        cleanLight[key] = String(modeTokens.light[key]);
      }
      cleanDark = {};
      for (const key of Object.keys(modeTokens.dark).sort()) {
        cleanDark[key] = String(modeTokens.dark[key]);
      }

      // Evaluate contrast diagnostics
      for (const mode of ["light", "dark"] as const) {
        const tokens = modeTokens[mode]!;
        for (const [fgKey, bgKey, threshold, desc] of CONTRAST_PAIRS) {
          const fg = tokens[fgKey];
          const bg = tokens[bgKey];
          if (typeof fg === "string" && typeof bg === "string" && isValidColor(fg) && isValidColor(bg)) {
            const ratio = calculateContrastRatio(fg, bg);
            if (ratio !== null) {
              if (ratio < threshold) {
                diagnostics.push({
                  severity: "warning",
                  code: "LOW_CONTRAST",
                  message: `${desc} in ${mode} mode has contrast ratio ${ratio.toFixed(2)}:1 (threshold: ${threshold}:1)`,
                  path: `palette.${mode}.${fgKey}`,
                });
              }
            } else {
              diagnostics.push({
                severity: "info",
                code: "UNEVALUATED_CONTRAST",
                message: `${desc} in ${mode} mode uses non-hex or alpha-bearing color syntax; automated WCAG contrast verification skipped`,
                path: `palette.${mode}.${fgKey}`,
              });
            }
          }
        }
      }
    }
  }

  // 9. Surfaces
  let cleanRadius: string | undefined;
  let cleanBorderWidth: string | undefined;

  if (!raw.surfaces || typeof raw.surfaces !== "object" || Array.isArray(raw.surfaces)) {
    errors.push("Field 'surfaces' must be an object containing 'radius'");
    diagnostics.push({
      severity: "error",
      code: "INVALID_SURFACES",
      message: "Field 'surfaces' must be an object containing 'radius'",
      path: "surfaces",
    });
  } else {
    const surfaces = raw.surfaces as Record<string, unknown>;

    for (const key of Object.keys(surfaces)) {
      if (!ALLOWED_SURFACES_KEYS.has(key)) {
        errors.push(`Unknown field 'surfaces.${key}'`);
        diagnostics.push({
          severity: "error",
          code: "UNKNOWN_FIELD",
          message: `Unknown field 'surfaces.${key}'`,
          path: `surfaces.${key}`,
        });
      }
    }

    if (!isValidCssLength(surfaces.radius)) {
      errors.push("Field 'surfaces.radius' must be a valid CSS length (e.g. '0.5rem' or '8px')");
      diagnostics.push({
        severity: "error",
        code: "INVALID_RADIUS",
        message: "Field 'surfaces.radius' must be a valid CSS length",
        path: "surfaces.radius",
      });
    } else {
      cleanRadius = (surfaces.radius as string);
    }

    if (surfaces.borderWidth !== undefined) {
      if (!isValidCssLength(surfaces.borderWidth)) {
        errors.push("Optional field 'surfaces.borderWidth' must be a valid CSS length");
        diagnostics.push({
          severity: "error",
          code: "INVALID_BORDER_WIDTH",
          message: "Optional field 'surfaces.borderWidth' must be a valid CSS length",
          path: "surfaces.borderWidth",
        });
      } else {
        cleanBorderWidth = (surfaces.borderWidth as string);
      }
    }
  }

  // 10. Typography
  let cleanFontSans: string | undefined;
  let cleanFontHeading: string | undefined;
  let cleanFontMono: string | undefined;

  if (!raw.typography || typeof raw.typography !== "object" || Array.isArray(raw.typography)) {
    errors.push("Field 'typography' must be an object containing 'fontSans'");
    diagnostics.push({
      severity: "error",
      code: "INVALID_TYPOGRAPHY",
      message: "Field 'typography' must be an object containing 'fontSans'",
      path: "typography",
    });
  } else {
    const typo = raw.typography as Record<string, unknown>;

    for (const key of Object.keys(typo)) {
      if (!ALLOWED_TYPOGRAPHY_KEYS.has(key)) {
        errors.push(`Unknown field 'typography.${key}'`);
        diagnostics.push({
          severity: "error",
          code: "UNKNOWN_FIELD",
          message: `Unknown field 'typography.${key}'`,
          path: `typography.${key}`,
        });
      }
    }

    if (!isValidFontStack(typo.fontSans)) {
      errors.push("Field 'typography.fontSans' must be a valid CSS font stack");
      diagnostics.push({
        severity: "error",
        code: "INVALID_FONT_SANS",
        message: "Field 'typography.fontSans' must be a valid CSS font stack",
        path: "typography.fontSans",
      });
    } else {
      cleanFontSans = (typo.fontSans as string);
    }

    if (typo.fontHeading !== undefined) {
      if (!isValidFontStack(typo.fontHeading)) {
        errors.push("Optional field 'typography.fontHeading' must be a valid CSS font stack");
        diagnostics.push({
          severity: "error",
          code: "INVALID_FONT_HEADING",
          message: "Optional field 'typography.fontHeading' must be a valid CSS font stack",
          path: "typography.fontHeading",
        });
      } else {
        cleanFontHeading = (typo.fontHeading as string);
      }
    }

    if (typo.fontMono !== undefined) {
      if (!isValidFontStack(typo.fontMono)) {
        errors.push("Optional field 'typography.fontMono' must be a valid CSS font stack");
        diagnostics.push({
          severity: "error",
          code: "INVALID_FONT_MONO",
          message: "Optional field 'typography.fontMono' must be a valid CSS font stack",
          path: "typography.fontMono",
        });
      } else {
        cleanFontMono = (typo.fontMono as string);
      }
    }
  }

  const valid = errors.length === 0;

  let specification: ThemeSpecification | undefined;
  if (valid && cleanLight && cleanDark && cleanRadius && cleanFontSans) {
    const spec: ThemeSpecification = {
      schemaVersion: THEME_SCHEMA_VERSION,
      name: raw.name as string,
      version: raw.version as string,
      ...(typeof raw.description === "string" ? { description: raw.description } : {}),
      palette: {
        light: cleanLight as unknown as ColorTokens,
        dark: cleanDark as unknown as ColorTokens,
      },
      surfaces: {
        radius: cleanRadius,
        ...(cleanBorderWidth !== undefined ? { borderWidth: cleanBorderWidth } : {}),
      },
      typography: {
        fontSans: cleanFontSans,
        ...(cleanFontHeading !== undefined ? { fontHeading: cleanFontHeading } : {}),
        ...(cleanFontMono !== undefined ? { fontMono: cleanFontMono } : {}),
      },
      ...(typeof raw.sourceProfileSha256 === "string"
        ? { sourceProfileSha256: raw.sourceProfileSha256 }
        : {}),
    };

    specification = deepFreeze(spec);
  }

  return {
    valid,
    errors,
    diagnostics,
    specification,
  };
}

export function validatePackageMetadata(input: unknown): PackageMetadata {
  // Public metadata types intentionally permit explicit undefined optionals.
  // Omit only enumerable data properties in those slots; still reject accessors.
  if (input && typeof input === "object" && !Array.isArray(input) && [Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    const descriptors = Object.getOwnPropertyDescriptors(input);
    for (const key of ["description", "author", "license", "private"]) {
      const d = descriptors[key];
      if (d?.enumerable && "value" in d && d.value === undefined) delete descriptors[key];
    }
    input = Object.create(Object.getPrototypeOf(input), descriptors);
  }
  assertSafeData(input);

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Package metadata must be a non-null object");
  }
  const raw = input as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_PACKAGE_METADATA_KEYS.has(key)) {
      throw new Error(`Unknown package metadata key '${key}'`);
    }
  }

  if (
    typeof raw.name !== "string" ||
    !raw.name.trim() ||
    raw.name.length > 214 ||
    !PACKAGE_NAME_REGEX.test(raw.name.trim())
  ) {
    throw new Error("Package metadata 'name' must be a valid npm package identifier");
  }

  if (typeof raw.version !== "string" || !SEMVER_REGEX.test(raw.version.trim())) {
    throw new Error("Package metadata 'version' must follow semantic versioning");
  }

  let description: string | undefined;
  if (raw.description !== undefined) {
    if (
      typeof raw.description !== "string" ||
      /[\u0000-\u001f\u007f-\u009f]/.test(raw.description) ||
      raw.description.length > 512
    ) {
      throw new Error("Package metadata 'description' must be a single-line string of at most 512 characters without controls");
    }
    description = raw.description;
  }

  let author: string | undefined;
  if (raw.author !== undefined) {
    if (
      typeof raw.author !== "string" ||
      /[\u0000-\u001f\u007f-\u009f]/.test(raw.author) ||
      raw.author.length > 256
    ) {
      throw new Error("Package metadata 'author' must be a single-line string of at most 256 characters without controls");
    }
    author = raw.author;
  }

  let license = "AGPL-3.0-or-later";
  if (raw.license !== undefined) {
    if (
      typeof raw.license !== "string" ||
      /[\r\n;\<\>\{\}\"]/.test(raw.license) ||
      raw.license.length > 128
    ) {
      throw new Error("Package metadata 'license' must be a valid license string");
    }
    license = raw.license;
  }

  let isPrivate = true;
  if (raw.private !== undefined) {
    if (typeof raw.private !== "boolean") {
      throw new Error("Package metadata 'private' must be a boolean");
    }
    isPrivate = raw.private;
  }

  const result: PackageMetadata = {
    name: raw.name.trim(),
    version: raw.version.trim(),
    ...(description !== undefined ? { description } : {}),
    ...(author !== undefined ? { author } : {}),
    license,
    private: isPrivate,
  };

  return deepFreeze(result);
}
