/**
 * TFSB71B2 Strict Closed Schema Validator for tf-paired-profile-v2
 *
 * Enforces:
 * - Exact closed top-level schema and nine neutral group schemas
 * - 19 required neutral color roles + 4 optional interaction roles
 * - Rejection of family-specific universal fields (no background, card, chart1, fontSans at root)
 * - Bounded explicit lengths (px, rem, em only; no assumed root conversion)
 * - Hex sRGB colors only (preserves authored spelling; projection normalizes)
 * - Light / dark palette symmetry
 * - Closed, versioned targetOverrides (version: "v2")
 * - Unsafe prototype / accessor / nonfinite / -0 rejection
 */

import { assertSafeDataV2 } from "./canonical.js";
import { isValidFontStack } from "../validator.js";
import {
  PAIRED_PROFILE_V2_SCHEMA_VERSION,
  type PairedProfileV2,
  type ColorModeTokensV2,
  type SyntaxCategoryName,
  type TargetOverridesV2,
} from "./types.js";
import {
  isValidExplicitLength,
  isValidHexColor,
  deepFreeze,
} from "./normalize.js";
import {
  PairedProfileV2ValidationError,
} from "./errors.js";

const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PROFILE_NAME_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "name",
  "version",
  "description",
  "color",
  "typography",
  "radius",
  "spacing",
  "elevation",
  "focus",
  "code",
  "reading",
  "navigation",
  "targetOverrides",
]);

export const MANDATORY_NEUTRAL_COLOR_ROLES: (keyof ColorModeTokensV2)[] = [
  "canvas",
  "canvasText",
  "surface",
  "surfaceText",
  "elevatedSurface",
  "elevatedSurfaceText",
  "primaryAction",
  "primaryActionText",
  "secondaryAction",
  "secondaryActionText",
  "mutedSurface",
  "mutedText",
  "highlight",
  "highlightText",
  "danger",
  "dangerText",
  "border",
  "fieldBorder",
  "focus",
];

export const OPTIONAL_INTERACTION_COLOR_ROLES: (keyof ColorModeTokensV2)[] = [
  "hover",
  "active",
  "selection",
  "selectionText",
];

const ALL_ALLOWED_COLOR_ROLES = new Set<string>([
  ...MANDATORY_NEUTRAL_COLOR_ROLES,
  ...OPTIONAL_INTERACTION_COLOR_ROLES,
]);

// Forbidden shadcn / family-centric roles in universal color
const FORBIDDEN_UNIVERSAL_COLOR_ROLES = new Set([
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
  "ring",
  "input",
  "chart1",
  "chart2",
  "chart3",
  "chart4",
  "chart5",
  "sidebar",
  "sidebarForeground",
  "sidebarPrimary",
  "sidebarPrimaryForeground",
  "sidebarAccent",
  "sidebarAccentForeground",
  "sidebarBorder",
  "sidebarRing",
]);

export const SYNTAX_CATEGORIES: SyntaxCategoryName[] = [
  "comment",
  "string",
  "number",
  "constant",
  "keyword",
  "function",
  "type",
  "variable",
  "punctuation",
  "tag",
  "attribute",
];

export interface ValidationResultV2 {
  valid: boolean;
  errors: string[];
  warnings: string[];
  profile?: PairedProfileV2 | undefined;
}

/**
 * Validates whether an object strictly conforms to tf-paired-profile-v2 schema.
 */
export function validatePairedProfileV2(input: unknown): ValidationResultV2 {
  const errors: string[] = [];
  const bad = (msg: string) => errors.push(msg);

  try {
    assertSafeDataV2(input);
  } catch (err: any) {
    return { valid: false, errors: [err?.message || "Unsafe input data"], warnings: [] };
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Paired profile v2 must be an object"], warnings: [] };
  }

  const raw = input as Record<string, any>;

  // 1. Top-level keys
  for (const k of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(k)) {
      bad(`Unknown top-level field '${k}'`);
    }
  }

  // 2. Schema version
  if (raw.schemaVersion !== PAIRED_PROFILE_V2_SCHEMA_VERSION) {
    bad(`Invalid schemaVersion: expected '${PAIRED_PROFILE_V2_SCHEMA_VERSION}', got '${String(raw.schemaVersion)}'`);
  }

  // 3. Name & Version
  if (typeof raw.name !== "string" || !PROFILE_NAME_REGEX.test(raw.name)) {
    bad("Field 'name' must be a lowercase kebab-case string (1-64 characters)");
  }

  if (typeof raw.version !== "string" || !SEMVER_REGEX.test(raw.version)) {
    bad("Field 'version' must follow semantic versioning (e.g. '1.0.0')");
  }

  // 4. Description (optional)
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(raw.description) || raw.description.length > 512) {
      bad("Optional field 'description' must be a single-line string <= 512 chars without control characters");
    }
  }

  const clean: Record<string, any> = {
    schemaVersion: PAIRED_PROFILE_V2_SCHEMA_VERSION,
    name: raw.name,
    version: raw.version,
    ...(raw.description !== undefined ? { description: raw.description } : {}),
  };

  // 5. Group 1: Color
  if (!raw.color || typeof raw.color !== "object" || Array.isArray(raw.color)) {
    bad("Field 'color' must be an object containing 'light' and 'dark' token sets");
  } else {
    for (const k of Object.keys(raw.color)) {
      if (k !== "light" && k !== "dark") bad(`Unknown color mode '${k}' in color`);
    }

    const cleanColor: { light?: Record<string, string>; dark?: Record<string, string> } = {};

    for (const mode of ["light", "dark"] as const) {
      const modeObj = raw.color[mode];
      if (!modeObj || typeof modeObj !== "object" || Array.isArray(modeObj)) {
        bad(`Field 'color.${mode}' must be an object containing color tokens`);
      } else {
        cleanColor[mode] = {};

        // Check for forbidden family-centric roles
        for (const role of Object.keys(modeObj)) {
          if (FORBIDDEN_UNIVERSAL_COLOR_ROLES.has(role)) {
            bad(`Role '${role}' is not allowed in universal color. Universal color roles must be neutral (e.g. canvas, surface, primaryAction, focus). Chart and sidebar roles belong in targetOverrides.solarSail.palette.`);
          } else if (!ALL_ALLOWED_COLOR_ROLES.has(role)) {
            bad(`Unknown color role 'color.${mode}.${role}'`);
          }
        }

        // Validate required 19 neutral roles
        for (const role of MANDATORY_NEUTRAL_COLOR_ROLES) {
          const val = modeObj[role];
          if (val === undefined) {
            bad(`Role 'color.${mode}.${role}' is required`);
          } else if (!isValidHexColor(val)) {
            bad(`Role 'color.${mode}.${role}' must be a valid hex sRGB color (#rgb, #rgba, #rrggbb, #rrggbbaa)`);
          } else {
            cleanColor[mode]![role] = val;
          }
        }

        // Validate optional interaction roles
        for (const role of OPTIONAL_INTERACTION_COLOR_ROLES) {
          if (modeObj[role] !== undefined) {
            const val = modeObj[role];
            if (!isValidHexColor(val)) {
              bad(`Role 'color.${mode}.${role}' must be a valid hex sRGB color`);
            } else {
              cleanColor[mode]![role] = val;
            }
          }
        }
      }
    }

    // Light/Dark symmetry check
    if (raw.color.light && raw.color.dark && typeof raw.color.light === "object" && typeof raw.color.dark === "object") {
      for (const r of Object.keys(raw.color.light)) {
        if (!Object.hasOwn(raw.color.dark, r)) {
          bad(`Color role '${r}' defined in color.light but missing in color.dark`);
        }
      }
      for (const r of Object.keys(raw.color.dark)) {
        if (!Object.hasOwn(raw.color.light, r)) {
          bad(`Color role '${r}' defined in color.dark but missing in color.light`);
        }
      }
    }

    clean.color = cleanColor;
  }

  // 6. Group 2: Typography (Neutral Roles)
  if (raw.typography !== undefined) {
    if (!raw.typography || typeof raw.typography !== "object" || Array.isArray(raw.typography)) {
      bad("Field 'typography' must be an object");
    } else {
      const allowedRoles = ["body", "heading", "ui", "code"];
      for (const k of Object.keys(raw.typography)) {
        if (k === "fontSans" || k === "fontHeading" || k === "fontMono") {
          bad(`Field 'typography.${k}' is not allowed in v2. Universal typography must use neutral roles (body, heading, ui, code); fontSans is rejected.`);
        } else if (!allowedRoles.includes(k)) {
          bad(`Unknown typography role 'typography.${k}'`);
        }
      }

      const cleanTypography: Record<string, any> = {};

      for (const role of allowedRoles) {
        if (raw.typography[role] !== undefined) {
          const rObj = raw.typography[role];
          if (!rObj || typeof rObj !== "object" || Array.isArray(rObj)) {
            bad(`typography.${role} must be an object`);
          } else {
            for (const k of Object.keys(rObj)) {
              if (!["family", "size", "lineHeight"].includes(k)) {
                bad(`Unknown field in typography.${role}.${k}`);
              }
            }
            if (typeof rObj.family !== "string" || !isValidFontStack(rObj.family)) {
              bad(`Field 'typography.${role}.family' is required and must be a valid CSS font stack`);
            }
            if (rObj.size !== undefined && !isValidExplicitLength(rObj.size)) {
              bad(`Field 'typography.${role}.size' must be an explicit length (px, rem, em, 0)`);
            }
            if (rObj.lineHeight !== undefined && (!Number.isFinite(rObj.lineHeight) || rObj.lineHeight <= 0 || rObj.lineHeight > 10)) {
              bad(`Field 'typography.${role}.lineHeight' must be a positive finite number (e.g. 1.5)`);
            }
            cleanTypography[role] = {
              family: rObj.family,
              ...(rObj.size !== undefined ? { size: rObj.size } : {}),
              ...(rObj.lineHeight !== undefined ? { lineHeight: rObj.lineHeight } : {}),
            };
          }
        }
      }

      clean.typography = cleanTypography;
    }
  }

  // 7. Group 3: Radius
  if (raw.radius !== undefined) {
    if (!raw.radius || typeof raw.radius !== "object" || Array.isArray(raw.radius)) {
      bad("Field 'radius' must be an object");
    } else {
      for (const k of Object.keys(raw.radius)) {
        if (!["control", "surface", "overlay"].includes(k)) {
          bad(`Unknown radius field 'radius.${k}'`);
        }
      }
      const cleanRadius: Record<string, string> = {};
      for (const k of ["control", "surface", "overlay"]) {
        if (raw.radius[k] !== undefined) {
          if (!isValidExplicitLength(raw.radius[k])) {
            bad(`Field 'radius.${k}' must be an explicit length (px, rem, em, 0)`);
          } else {
            cleanRadius[k] = raw.radius[k];
          }
        }
      }
      clean.radius = cleanRadius;
    }
  }

  // 8. Group 4: Spacing & Density
  if (raw.spacing !== undefined) {
    if (!raw.spacing || typeof raw.spacing !== "object" || Array.isArray(raw.spacing)) {
      bad("Field 'spacing' must be an object");
    } else {
      for (const k of Object.keys(raw.spacing)) {
        if (!["base", "density"].includes(k)) {
          bad(`Unknown spacing field 'spacing.${k}'`);
        }
      }
      const cleanSpacing: Record<string, any> = {};
      if (raw.spacing.base !== undefined) {
        if (!isValidExplicitLength(raw.spacing.base)) {
          bad("Field 'spacing.base' must be an explicit length");
        } else {
          cleanSpacing.base = raw.spacing.base;
        }
      }
      if (raw.spacing.density !== undefined) {
        if (!["compact", "comfortable", "spacious"].includes(raw.spacing.density)) {
          bad("Field 'spacing.density' must be 'compact', 'comfortable', or 'spacious'");
        } else {
          cleanSpacing.density = raw.spacing.density;
        }
      }
      clean.spacing = cleanSpacing;
    }
  }

  // 9. Group 5: Elevation & Border
  if (raw.elevation !== undefined) {
    if (!raw.elevation || typeof raw.elevation !== "object" || Array.isArray(raw.elevation)) {
      bad("Field 'elevation' must be an object");
    } else {
      for (const k of Object.keys(raw.elevation)) {
        if (!["emphasis", "borderWidth", "borderStyle"].includes(k)) {
          bad(`Unknown elevation field 'elevation.${k}'`);
        }
      }
      const cleanElevation: Record<string, any> = {};
      if (raw.elevation.emphasis !== undefined) {
        if (!["flat", "raised"].includes(raw.elevation.emphasis)) {
          bad("Field 'elevation.emphasis' must be 'flat' or 'raised'");
        } else {
          cleanElevation.emphasis = raw.elevation.emphasis;
        }
      }
      if (raw.elevation.borderWidth !== undefined) {
        if (!isValidExplicitLength(raw.elevation.borderWidth)) {
          bad("Field 'elevation.borderWidth' must be an explicit length");
        } else {
          cleanElevation.borderWidth = raw.elevation.borderWidth;
        }
      }
      if (raw.elevation.borderStyle !== undefined) {
        if (!["solid", "dashed", "dotted"].includes(raw.elevation.borderStyle)) {
          bad("Field 'elevation.borderStyle' must be 'solid', 'dashed', or 'dotted'");
        } else {
          cleanElevation.borderStyle = raw.elevation.borderStyle;
        }
      }
      clean.elevation = cleanElevation;
    }
  }

  // 10. Group 6: Focus
  if (raw.focus !== undefined) {
    if (!raw.focus || typeof raw.focus !== "object" || Array.isArray(raw.focus)) {
      bad("Field 'focus' must be an object");
    } else {
      for (const k of Object.keys(raw.focus)) {
        if (!["color", "width", "offset"].includes(k)) {
          bad(`Unknown focus field 'focus.${k}'`);
        }
      }
      const cleanFocus: Record<string, any> = {};
      if (raw.focus.width !== undefined) {
        if (!isValidExplicitLength(raw.focus.width)) bad("Field 'focus.width' must be an explicit length");
        else cleanFocus.width = raw.focus.width;
      }
      if (raw.focus.offset !== undefined) {
        if (!isValidExplicitLength(raw.focus.offset)) bad("Field 'focus.offset' must be an explicit length");
        else cleanFocus.offset = raw.focus.offset;
      }
      if (raw.focus.color !== undefined) {
        if (!raw.focus.color || typeof raw.focus.color !== "object" || Array.isArray(raw.focus.color)) {
          bad("Field 'focus.color' must be an object");
        } else {
          cleanFocus.color = {};
          for (const m of Object.keys(raw.focus.color)) {
            if (m !== "light" && m !== "dark") bad(`Unknown focus color mode '${m}'`);
          }
          if (raw.focus.color.light !== undefined) {
            if (!isValidHexColor(raw.focus.color.light)) bad("Field 'focus.color.light' must be a valid hex color");
            else cleanFocus.color.light = raw.focus.color.light;
          }
          if (raw.focus.color.dark !== undefined) {
            if (!isValidHexColor(raw.focus.color.dark)) bad("Field 'focus.color.dark' must be a valid hex color");
            else cleanFocus.color.dark = raw.focus.color.dark;
          }
        }
      }
      clean.focus = cleanFocus;
    }
  }

  // 11. Group 7: Code Semantic Syntax & Presentation
  if (raw.code !== undefined) {
    if (!raw.code || typeof raw.code !== "object" || Array.isArray(raw.code)) {
      bad("Field 'code' must be an object");
    } else {
      for (const k of Object.keys(raw.code)) {
        if (!["syntax", "frame", "copy"].includes(k)) {
          bad(`Unknown code field 'code.${k}'`);
        }
      }
      const cleanCode: Record<string, any> = {};
      if (raw.code.frame !== undefined) {
        if (!["editor", "terminal", "plain"].includes(raw.code.frame)) {
          bad("Field 'code.frame' must be 'editor', 'terminal', or 'plain'");
        } else {
          cleanCode.frame = raw.code.frame;
        }
      }
      if (raw.code.copy !== undefined) {
        if (!["standard", "minimal"].includes(raw.code.copy)) {
          bad("Field 'code.copy' must be 'standard' or 'minimal'");
        } else {
          cleanCode.copy = raw.code.copy;
        }
      }
      if (raw.code.syntax !== undefined) {
        if (!raw.code.syntax || typeof raw.code.syntax !== "object" || Array.isArray(raw.code.syntax)) {
          bad("Field 'code.syntax' must be an object");
        } else {
          cleanCode.syntax = {};
          for (const m of Object.keys(raw.code.syntax)) {
            if (m !== "light" && m !== "dark") bad(`Unknown syntax mode '${m}' in code.syntax`);
          }
          for (const mode of ["light", "dark"] as const) {
            if (raw.code.syntax[mode] !== undefined) {
              const mObj = raw.code.syntax[mode];
              if (!mObj || typeof mObj !== "object" || Array.isArray(mObj)) {
                bad(`Field 'code.syntax.${mode}' must be an object`);
              } else {
                cleanCode.syntax[mode] = {};
                for (const cat of Object.keys(mObj)) {
                  if (!SYNTAX_CATEGORIES.includes(cat as any)) {
                    bad(`Unknown syntax category '${cat}' in code.syntax.${mode}`);
                  } else {
                    const cVal = mObj[cat];
                    if (!isValidHexColor(cVal)) {
                      bad(`Syntax color 'code.syntax.${mode}.${cat}' must be a valid hex color`);
                    } else {
                      cleanCode.syntax[mode][cat] = cVal;
                    }
                  }
                }
              }
            }
          }
        }
      }
      clean.code = cleanCode;
    }
  }

  // 12. Group 8: Reading Measure
  if (raw.reading !== undefined) {
    if (!raw.reading || typeof raw.reading !== "object" || Array.isArray(raw.reading)) {
      bad("Field 'reading' must be an object");
    } else {
      for (const k of Object.keys(raw.reading)) {
        if (k !== "measure") bad(`Unknown reading field 'reading.${k}'`);
      }
      const cleanReading: Record<string, string> = {};
      if (raw.reading.measure !== undefined) {
        if (!isValidExplicitLength(raw.reading.measure)) {
          bad("Field 'reading.measure' must be an explicit length (e.g. '704px')");
        } else {
          cleanReading.measure = raw.reading.measure;
        }
      }
      clean.reading = cleanReading;
    }
  }

  // 13. Group 9: Navigation & Chrome
  if (raw.navigation !== undefined) {
    if (!raw.navigation || typeof raw.navigation !== "object" || Array.isArray(raw.navigation)) {
      bad("Field 'navigation' must be an object");
    } else {
      for (const k of Object.keys(raw.navigation)) {
        if (!["prominence", "density"].includes(k)) {
          bad(`Unknown navigation field 'navigation.${k}'`);
        }
      }
      const cleanNav: Record<string, any> = {};
      if (raw.navigation.prominence !== undefined) {
        if (!["quiet", "balanced", "strong"].includes(raw.navigation.prominence)) {
          bad("Field 'navigation.prominence' must be 'quiet', 'balanced', or 'strong'");
        } else {
          cleanNav.prominence = raw.navigation.prominence;
        }
      }
      if (raw.navigation.density !== undefined) {
        if (!["compact", "comfortable", "spacious"].includes(raw.navigation.density)) {
          bad("Field 'navigation.density' must be 'compact', 'comfortable', or 'spacious'");
        } else {
          cleanNav.density = raw.navigation.density;
        }
      }
      clean.navigation = cleanNav;
    }
  }

  // 14. Target Overrides (Closed & Versioned)
  if (raw.targetOverrides !== undefined) {
    if (!raw.targetOverrides || typeof raw.targetOverrides !== "object" || Array.isArray(raw.targetOverrides)) {
      bad("Field 'targetOverrides' must be an object");
    } else {
      for (const k of Object.keys(raw.targetOverrides)) {
        if (!["version", "solarSail", "loom", "syntax"].includes(k)) {
          bad(`Unknown targetOverrides field '${k}'`);
        }
      }
      if (raw.targetOverrides.version !== "v2") {
        bad("targetOverrides.version must be 'v2'");
      }

      const cleanOverrides: Record<string, any> = { version: "v2" };

      // Solar Sail target overrides
      if (raw.targetOverrides.solarSail !== undefined) {
        const ss = raw.targetOverrides.solarSail;
        if (!ss || typeof ss !== "object" || Array.isArray(ss)) {
          bad("targetOverrides.solarSail must be an object");
        } else {
          for (const k of Object.keys(ss)) {
            if (!["surfaces", "palette"].includes(k)) bad(`Unknown targetOverrides.solarSail.${k}`);
          }
          const cleanSS: Record<string, any> = {};
          if (ss.surfaces !== undefined) {
            if (!ss.surfaces || typeof ss.surfaces !== "object" || Array.isArray(ss.surfaces)) {
              bad("targetOverrides.solarSail.surfaces must be an object");
            } else {
              cleanSS.surfaces = {};
              for (const sk of Object.keys(ss.surfaces)) {
                if (!["radius", "borderWidth"].includes(sk)) bad(`Unknown solarSail surface override '${sk}'`);
                else if (!isValidExplicitLength(ss.surfaces[sk])) bad(`Invalid solarSail.surfaces.${sk}: must be explicit length`);
                else cleanSS.surfaces[sk] = ss.surfaces[sk];
              }
            }
          }
          if (ss.palette !== undefined) {
            if (!ss.palette || typeof ss.palette !== "object" || Array.isArray(ss.palette)) {
              bad("targetOverrides.solarSail.palette must be an object");
            } else {
              cleanSS.palette = {};
              for (const m of Object.keys(ss.palette)) {
                if (m !== "light" && m !== "dark") bad(`Unknown solarSail palette mode '${m}'`);
              }
              for (const mode of ["light", "dark"] as const) {
                if (ss.palette[mode] !== undefined) {
                  const pObj = ss.palette[mode];
                  if (!pObj || typeof pObj !== "object" || Array.isArray(pObj)) {
                    bad(`targetOverrides.solarSail.palette.${mode} must be an object`);
                  } else {
                    cleanSS.palette[mode] = {};
                    for (const [r, v] of Object.entries(pObj)) {
                      if (!FORBIDDEN_UNIVERSAL_COLOR_ROLES.has(r) && r!=="border") bad(`Unknown Solar palette role ${r}`);
                      else if (!isValidHexColor(v)) bad(`targetOverrides.solarSail.palette.${mode}.${r} must be a valid hex color`);
                      else cleanSS.palette[mode][r] = v as string;
                    }
                  }
                }
              }
            }
          }
          cleanOverrides.solarSail = cleanSS;
        }
      }

      // Stellar Loom target overrides
      if (raw.targetOverrides.loom !== undefined) {
        const loom = raw.targetOverrides.loom;
        if (!loom || typeof loom !== "object" || Array.isArray(loom)) {
          bad("targetOverrides.loom must be an object");
        } else {
          for (const k of Object.keys(loom)) {
            if (!["primaryFamily", "secondaryFamily", "defaultAccent", "tokenSetKey", "content", "radii", "border"].includes(k)) {
              bad(`Unknown targetOverrides.loom.${k}`);
            }
          }
          const cleanLoom: Record<string, any> = {};
          for (const fam of ["primaryFamily", "secondaryFamily", "defaultAccent"]) {
            if (loom[fam] !== undefined) {
              if (typeof loom[fam] !== "string" || !/^[a-z][a-z0-9-]*$/.test(loom[fam])) {
                bad(`Invalid loom.${fam}: must be lowercase kebab identifier`);
              } else {
                cleanLoom[fam] = loom[fam];
              }
            }
          }
          if (loom.tokenSetKey !== undefined) {
            if (typeof loom.tokenSetKey !== "string" || !loom.tokenSetKey.trim()) {
              bad("Invalid loom.tokenSetKey: must be non-empty string");
            } else {
              cleanLoom.tokenSetKey = loom.tokenSetKey.trim();
            }
          }
          if (loom.content !== undefined) {
            if (!Number.isSafeInteger(loom.content) || loom.content <= 0) {
              bad("Invalid loom.content: must be positive safe integer");
            } else {
              cleanLoom.content = loom.content;
            }
          }
          for (const num of ["radii", "border"]) {
            if (loom[num] !== undefined) {
              if (!Number.isFinite(loom[num]) || loom[num] < 0) {
                bad(`Invalid loom.${num}: must be finite non-negative number`);
              } else {
                cleanLoom[num] = loom[num];
              }
            }
          }
          cleanOverrides.loom = cleanLoom;
        }
      }

      // Syntax target overrides
      if (raw.targetOverrides.syntax !== undefined) {
        const syn = raw.targetOverrides.syntax;
        if (!syn || typeof syn !== "object" || Array.isArray(syn)) {
          bad("targetOverrides.syntax must be an object");
        } else {
          for (const k of Object.keys(syn)) {
            if (!["syntax", "chrome", "diffs", "copy", "frame", "tabs"].includes(k)) {
              bad(`Unknown targetOverrides.syntax.${k}`);
            }
          }
          const colorKeys: Record<string, readonly string[]> = {
            syntax: SYNTAX_CATEGORIES,
            chrome: ["background","foreground","border","focus","tabBarBackground","tabBarBorder","activeTabBackground","activeTabForeground","activeTabBorder","terminalTitlebarBackground","terminalTitlebarForeground","copyButtonForeground","copyButtonBorder","tooltipSuccessBackground","tooltipSuccessForeground"],
            diffs: ["inserted","deleted","marked","insertedBackground","deletedBackground","markedBackground"],
          };
          for (const [group, allowed] of Object.entries(colorKeys)) {
            if(syn[group] === undefined) continue;
            const modes=syn[group];
            if(!modes || typeof modes!=="object" || Array.isArray(modes)) {bad(`Invalid syntax override ${group}`);continue;}
            for(const [mode, values] of Object.entries(modes)) {
              if(!["light","dark"].includes(mode)||!values||typeof values!=="object"||Array.isArray(values)){bad(`Invalid syntax override ${group}.${mode}`);continue;}
              for(const [key,value] of Object.entries(values)) if(!allowed.includes(key)||!isValidHexColor(value)) bad(`Invalid syntax override ${group}.${mode}.${key}`);
            }
          }
          if(syn.frame!==undefined&&!["editor","terminal","plain"].includes(syn.frame))bad("Invalid syntax frame");
          if(syn.copy!==undefined&&!["standard","minimal"].includes(syn.copy))bad("Invalid syntax copy");
          if(syn.tabs!==undefined && (!syn.tabs||typeof syn.tabs!=="object"||Array.isArray(syn.tabs)||Object.keys(syn.tabs).some(k=>k!=="activeIndicator")||syn.tabs.activeIndicator!==undefined&&!["top","bottom","border","accent"].includes(syn.tabs.activeIndicator)))bad("Invalid syntax tabs");
          cleanOverrides.syntax = { ...syn };
        }
      }

      clean.targetOverrides = cleanOverrides as TargetOverridesV2;
    }
  }

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    warnings: [],
    ...(valid ? { profile: deepFreeze(JSON.parse(JSON.stringify(clean))) as PairedProfileV2 } : {}),
  };
}

/**
 * Asserts that the given input strictly conforms to tf-paired-profile-v2.
 */
export function assertValidPairedProfileV2(input: unknown): asserts input is PairedProfileV2 {
  const result = validatePairedProfileV2(input);
  if (!result.valid || !result.profile) {
    throw new PairedProfileV2ValidationError(
      `Paired Profile v2 validation failed:\n - ${result.errors.join("\n - ")}`,
      result.errors
    );
  }
}
