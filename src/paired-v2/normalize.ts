/**
 * TFSB71B2 Length & Color Validation and Normalization
 *
 * Enforces:
 * - Bounded explicit lengths (px, rem, em support; no assumed root conversion; 0/0px allowed; units %, pt, etc. rejected).
 * - Hex sRGB only: normalize case (lowercase) and short hex (#rgb -> #rrggbb, #rgba -> #rrggbbaa), preserving alpha.
 * - Loom constraints: only opaque #rrggbb and unitless px fields.
 */

import { InvalidExplicitLengthError, InvalidHexColorError } from "./errors.js";

// ============================================================================
// Length Validation & Handling
// ============================================================================

const EXPLICIT_LENGTH_REGEX = /^(?:0|0px|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em))$/;

/**
 * Validates whether a value is a bounded explicit length with px, rem, or em unit.
 */
export function isValidExplicitLength(val: unknown): val is string {
  if (typeof val !== "string") return false;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(val)) return false;
  const s = val.trim();
  if (!s || s.length > 64) return false;
  if (/[\r\n\0;\<\>\{\}\\\(\)\"\']/.test(s)) return false;
  if (!EXPLICIT_LENGTH_REGEX.test(s)) return false;

  const num = parseFloat(s);
  if (!Number.isFinite(num) || num < 0 || num > 100_000) return false;

  return true;
}

export function assertExplicitLength(val: unknown, path?: string): asserts val is string {
  if (!isValidExplicitLength(val)) {
    throw new InvalidExplicitLengthError(val, path);
  }
}

export interface ParsedLength {
  value: number;
  unit: "px" | "rem" | "em";
}

export function parseExplicitLength(val: string): ParsedLength {
  const trimmed = val.trim();
  if (trimmed === "0" || trimmed === "0px") {
    return { value: 0, unit: "px" };
  }
  const match = /^(\d+(?:\.\d+)?|\.\d+)(px|rem|em)$/.exec(trimmed);
  if (!match) {
    throw new InvalidExplicitLengthError(val);
  }
  return {
    value: parseFloat(match[1]!),
    unit: match[2] as "px" | "rem" | "em",
  };
}

/**
 * Extracts a unitless pixel number from an explicit length.
 * Returns null for rem/em lengths because NO assumed root conversion is permitted.
 */
export function toUnitlessPx(val: string): number | null {
  if (!isValidExplicitLength(val)) return null;
  const parsed = parseExplicitLength(val);
  if (parsed.unit === "px") {
    return parsed.value;
  }
  // rem and em cannot be converted without an assumed root conversion
  return null;
}

// ============================================================================
// Hex sRGB Color Validation & Normalization
// ============================================================================

const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Validates whether a value is a strict hex sRGB color.
 * Rejects all non-hex formats (oklch, hsl, rgb, var, named colors).
 */
export function isValidHexColor(val: unknown): val is string {
  if (typeof val !== "string") return false;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(val)) return false;
  const s = val.trim();
  if (s.length > 9) return false;
  return HEX_COLOR_REGEX.test(s);
}

export function assertHexColor(val: unknown, path?: string): asserts val is string {
  if (!isValidHexColor(val)) {
    throw new InvalidHexColorError(val, path);
  }
}

/**
 * Normalizes a hex color:
 * - converts to lowercase
 * - expands short hex (#rgb -> #rrggbb, #rgba -> #rrggbbaa)
 * - preserves alpha channel
 */
export function normalizeHexColor(val: string): string {
  const s = val.trim().toLowerCase();
  if (!HEX_COLOR_REGEX.test(s)) {
    throw new InvalidHexColorError(val);
  }

  // 3-digit: #rgb -> #rrggbb
  if (s.length === 4) {
    const r = s[1]!;
    const g = s[2]!;
    const b = s[3]!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  // 4-digit: #rgba -> #rrggbbaa (preserves alpha)
  if (s.length === 5) {
    const r = s[1]!;
    const g = s[2]!;
    const b = s[3]!;
    const a = s[4]!;
    return `#${r}${r}${g}${g}${b}${b}${a}${a}`;
  }

  // 6-digit or 8-digit already standard length
  return s;
}

/**
 * Checks if a hex color is strictly opaque (#rrggbb or #rrggbbff).
 */
export function isOpaqueHexColor(val: string): boolean {
  if (!isValidHexColor(val)) return false;
  const normalized = normalizeHexColor(val);
  if (normalized.length === 7) return true; // #rrggbb
  if (normalized.length === 9 && normalized.slice(7) === "ff") return true; // #rrggbbff
  return false;
}

/**
 * Checks if a hex color has an active non-opaque alpha channel.
 */
export function hasAlphaChannel(val: string): boolean {
  if (!isValidHexColor(val)) return false;
  const normalized = normalizeHexColor(val);
  return normalized.length === 9 && normalized.slice(7) !== "ff";
}

// ============================================================================
// Immutability Helper
// ============================================================================

export function deepFreeze<T>(val: T): T {
  if (val !== null && typeof val === "object") {
    for (const child of Object.values(val as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(val);
  }
  return val;
}
