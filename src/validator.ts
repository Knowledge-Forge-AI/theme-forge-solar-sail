import {
  THEME_SCHEMA_VERSION,
  type ColorTokens,
  type ThemeDiagnostic,
  type ThemeSpecification,
  type PackageMetadata,
} from "./types.js";

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

export function parseHexColor(hex: string): [number, number, number] | null {
  const trimmed = hex.trim();
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(trimmed);
  if (!match) return null;
  return [
    parseInt(match[1]!, 16),
    parseInt(match[2]!, 16),
    parseInt(match[3]!, 16),
  ];
}

export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs! + 0.7152 * gs! + 0.0722 * bs!;
}

export function calculateContrastRatio(colorA: string, colorB: string): number | null {
  const rgbA = parseHexColor(colorA);
  const rgbB = parseHexColor(colorB);
  if (!rgbA || !rgbB) return null;
  const l1 = relativeLuminance(rgbA);
  const l2 = relativeLuminance(rgbB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function isValidColor(str: unknown): boolean {
  if (typeof str !== "string" || !str.trim()) return false;
  const s = str.trim();
  // Hex
  if (/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return true;
  // CSS functions: oklch, hsl, rgb, var
  if (/^(?:oklch|hsl|hsla|rgb|rgba|var)\(.*\)$/.test(s)) return true;
  return false;
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

  // Schema version
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

  // Name
  if (typeof raw.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.name)) {
    errors.push("Field 'name' must be a lowercase kebab-case string between 1 and 64 characters");
    diagnostics.push({
      severity: "error",
      code: "INVALID_NAME",
      message: "Field 'name' must be a lowercase kebab-case string",
      path: "name",
    });
  }

  // Version
  if (typeof raw.version !== "string" || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(raw.version)) {
    errors.push("Field 'version' must follow semantic versioning (e.g. '0.1.0')");
    diagnostics.push({
      severity: "error",
      code: "INVALID_VERSION",
      message: "Field 'version' must follow semantic versioning",
      path: "version",
    });
  }

  // Palette
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
        for (const role of MANDATORY_ROLES) {
          const val = tokens[role];
          if (!isValidColor(val)) {
            errors.push(
              `Role 'palette.${mode}.${role}' is required and must be a valid color string (hex, oklch, hsl, rgb)`
            );
            diagnostics.push({
              severity: "error",
              code: "MISSING_OR_INVALID_COLOR_ROLE",
              message: `Role 'palette.${mode}.${role}' is invalid or missing`,
              path: `palette.${mode}.${role}`,
            });
          }
        }

        // Contrast diagnostics for hex colors
        for (const [fgKey, bgKey, threshold, desc] of CONTRAST_PAIRS) {
          const fg = tokens[fgKey];
          const bg = tokens[bgKey];
          if (typeof fg === "string" && typeof bg === "string") {
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
            } else if (isValidColor(fg) && isValidColor(bg)) {
              diagnostics.push({
                severity: "info",
                code: "UNEVALUATED_CONTRAST",
                message: `${desc} in ${mode} mode uses non-hex color syntax; automated WCAG contrast verification skipped`,
                path: `palette.${mode}.${fgKey}`,
              });
            }
          }
        }
      }
    }
  }

  // Surfaces
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
    if (typeof surfaces.radius !== "string" || !/^(?:0|\d+(?:\.\d+)?(?:rem|px|em|%))$/.test(surfaces.radius.trim())) {
      errors.push("Field 'surfaces.radius' must be a valid CSS length (e.g. '0.5rem' or '8px')");
      diagnostics.push({
        severity: "error",
        code: "INVALID_RADIUS",
        message: "Field 'surfaces.radius' must be a valid CSS length",
        path: "surfaces.radius",
      });
    }
  }

  // Typography
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
    if (typeof typo.fontSans !== "string" || !typo.fontSans.trim()) {
      errors.push("Field 'typography.fontSans' must be a non-empty string");
      diagnostics.push({
        severity: "error",
        code: "INVALID_FONT_SANS",
        message: "Field 'typography.fontSans' must be a non-empty string",
        path: "typography.fontSans",
      });
    }
  }

  const valid = errors.length === 0;
  return {
    valid,
    errors,
    diagnostics,
    specification: valid ? (raw as unknown as ThemeSpecification) : undefined,
  };
}

export function validatePackageMetadata(input: unknown): PackageMetadata {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Package metadata must be a non-null object");
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    throw new Error("Package metadata 'name' is required");
  }
  if (typeof raw.version !== "string" || !raw.version.trim()) {
    throw new Error("Package metadata 'version' is required");
  }
  return {
    name: raw.name.trim(),
    version: raw.version.trim(),
    description: typeof raw.description === "string" ? raw.description : undefined,
    author: typeof raw.author === "string" ? raw.author : undefined,
    license: typeof raw.license === "string" ? raw.license : "AGPL-3.0-or-later",
    private: typeof raw.private === "boolean" ? raw.private : true,
  };
}
