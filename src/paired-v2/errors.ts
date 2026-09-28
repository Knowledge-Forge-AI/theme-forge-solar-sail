/**
 * TFSB71B2 Error Classes & Instance-Independent Error Classifier
 *
 * Implements small, stable code/name error classifier that functions
 * across duplicated module instances, workers, or VM contexts without
 * relying on `instanceof`.
 */

import type { MigrationLoss } from "./types.js";

export const ERROR_CODES = {
  UNSUPPORTED_MAPPING: "V2_UNSUPPORTED_MAPPING_ERROR",
  SCHEMA_VALIDATION: "V2_SCHEMA_VALIDATION_ERROR",
  UNSAFE_DATA: "V2_UNSAFE_DATA_ERROR",
  STALE_PROVENANCE: "V2_STALE_PROVENANCE_ERROR",
  MIGRATION_LOSS: "V2_MIGRATION_LOSS_ERROR",
  UNKNOWN_FUTURE_VERSION: "V2_UNKNOWN_FUTURE_VERSION_ERROR",
  UNSUPPORTED_OVERRIDE: "V2_UNSUPPORTED_OVERRIDE_ERROR",
  INVALID_LENGTH: "V2_INVALID_EXPLICIT_LENGTH_ERROR",
  INVALID_HEX: "V2_INVALID_HEX_COLOR_ERROR",
  RECIPE_ERROR: "V2_RECIPE_ERROR",
  CANONICAL_ERROR: "V2_CANONICAL_ERROR",
} as const;

export type PairedProfileV2ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class PairedProfileV2Error extends Error {
  readonly code: string;
  readonly isPairedProfileError = true as const;

  constructor(message: string, code: string = ERROR_CODES.SCHEMA_VALIDATION) {
    super(message);
    this.name = "PairedProfileV2Error";
    this.code = code;
  }
}

export class PairedProfileV2ValidationError extends PairedProfileV2Error {
  readonly errors: string[];

  constructor(message: string, errors: string[] = [message]) {
    super(message, ERROR_CODES.SCHEMA_VALIDATION);
    this.name = "PairedProfileV2ValidationError";
    this.errors = errors;
  }
}

export class StaleProvenanceV2Error extends PairedProfileV2Error {
  readonly expectedSha256: string;
  readonly actualSha256: string;

  constructor(
    expectedSha256: string,
    actualSha256: string,
    message: string = `Stale profile provenance: expected hash ${expectedSha256} does not match actual source hash ${actualSha256}`
  ) {
    super(message, ERROR_CODES.STALE_PROVENANCE);
    this.name = "StaleProvenanceV2Error";
    this.expectedSha256 = expectedSha256;
    this.actualSha256 = actualSha256;
  }
}

export class MigrationV2Error extends PairedProfileV2Error {
  readonly losses: MigrationLoss[];

  constructor(
    message: string,
    losses: MigrationLoss[] = [],
    code: string = ERROR_CODES.MIGRATION_LOSS
  ) {
    super(message, code);
    this.name = "MigrationV2Error";
    this.losses = losses;
  }
}

export class InvalidExplicitLengthError extends PairedProfileV2Error {
  readonly value: unknown;
  readonly path?: string | undefined;

  constructor(value: unknown, path?: string | undefined, message?: string | undefined) {
    const desc = path ? ` at path '${path}'` : "";
    super(
      message || `Invalid explicit length '${String(value)}'${desc}: must be bounded length with px, rem, or em unit (or 0)`,
      ERROR_CODES.INVALID_LENGTH
    );
    this.name = "InvalidExplicitLengthError";
    this.value = value;
    this.path = path;
  }
}

export class InvalidHexColorError extends PairedProfileV2Error {
  readonly value: unknown;
  readonly path?: string | undefined;

  constructor(value: unknown, path?: string | undefined, message?: string | undefined) {
    const desc = path ? ` at path '${path}'` : "";
    super(
      message || `Invalid hex color '${String(value)}'${desc}: must be 3, 4, 6, or 8 digit hex sRGB color`,
      ERROR_CODES.INVALID_HEX
    );
    this.name = "InvalidHexColorError";
    this.value = value;
    this.path = path;
  }
}

export class RecipeError extends PairedProfileV2Error {
  readonly recipeName: string;

  constructor(recipeName: string, message: string) {
    super(`Recipe error [${recipeName}]: ${message}`, ERROR_CODES.RECIPE_ERROR);
    this.name = "RecipeError";
    this.recipeName = recipeName;
  }
}

// ============================================================================
// Instance-Independent Error Classifier
// ============================================================================

export interface ProfileErrorClassification {
  isProfileError: boolean;
  code?: string | undefined;
  name?: string | undefined;
  message: string;
  errors?: string[] | undefined;
  losses?: MigrationLoss[] | undefined;
}

/**
 * Determines whether an arbitrary error value is a Paired Profile error
 * across duplicated instances or realms WITHOUT using `instanceof`.
 */
export function isPairedProfileV2Error(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;

  if (e.isPairedProfileError === true) return true;

  if (typeof e.name === "string") {
    if (
      e.name === "PairedProfileV2Error" ||
      e.name === "PairedProfileV2ValidationError" ||
      e.name === "StaleProvenanceV2Error" ||
      e.name === "MigrationV2Error" ||
      e.name === "InvalidExplicitLengthError" ||
      e.name === "InvalidHexColorError" ||
      e.name === "RecipeError" ||
      e.name === "PairedProfileValidationError" ||
      e.name === "StaleProvenanceError"
    ) {
      return true;
    }
  }

  if (typeof e.code === "string") {
    if (
      (Object.values(ERROR_CODES) as string[]).includes(e.code) ||
      e.code === "SCHEMA_VALIDATION_ERROR" ||
      e.code === "STALE_PROVENANCE" ||
      e.code === "MIGRATION_LOSS"
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Classifies an unknown error into a structured profile error summary,
 * robust against duplicate package copies or realm isolation.
 */
export function classifyProfileError(err: unknown): ProfileErrorClassification {
  if (!err || typeof err !== "object") {
    return {
      isProfileError: false,
      message: String(err),
    };
  }

  const e = err as Record<string, unknown>;
  const isErr = isPairedProfileV2Error(err);

  return {
    isProfileError: isErr,
    code: typeof e.code === "string" ? e.code : undefined,
    name: typeof e.name === "string" ? e.name : undefined,
    message: typeof e.message === "string" ? e.message : String(err),
    errors: Array.isArray(e.errors) ? (e.errors as string[]) : undefined,
    losses: Array.isArray(e.losses) ? (e.losses as MigrationLoss[]) : undefined,
  };
}
