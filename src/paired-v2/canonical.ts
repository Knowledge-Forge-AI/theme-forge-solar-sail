/**
 * TFSB71B2 Canonical Serializer & Duplicate-Aware Byte Parsing
 *
 * Implements:
 * - Canonical serializer with unsigned UTF-8 byte ordering, compact JSON, and final LF.
 * - Domain-separated canonical digest ("tf-paired-profile-v2\n" prefix).
 * - Exact source byte SHA-256 calculated separately from canonical digest.
 * - Duplicate-aware byte parsing with Unicode safety, -0 rejection, and unsafe number rejection.
 */

import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { assertSafeData, parseThemeJson } from "../input.js";
import { PairedProfileV2Error, ERROR_CODES } from "./errors.js";

export const V2_CANONICAL_DOMAIN_TAG = "tf-paired-profile-v2\n" as const;

/**
 * Compares two strings by their unsigned UTF-8 byte representation.
 */
export function compareUtf8Keys(a: string, b: string): number {
  if (a === b) return 0;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.compare(bufB);
}

/**
 * Recursively sorts all object keys using unsigned UTF-8 byte ordering.
 */
export function sortKeysUnsignedUtf8(val: unknown): unknown {
  if (val === null || typeof val !== "object") {
    return val;
  }

  if (Array.isArray(val)) {
    return val.map(sortKeysUnsignedUtf8);
  }

  const sortedObj: Record<string, unknown> = {};
  const sortedKeys = Object.keys(val).sort(compareUtf8Keys);

  for (const key of sortedKeys) {
    sortedObj[key] = sortKeysUnsignedUtf8((val as Record<string, unknown>)[key]);
  }

  return sortedObj;
}

/**
 * Canonicalizes a profile object into deterministic compact JSON with final LF,
 * sorted by unsigned UTF-8 byte ordering.
 */
export function canonicalizeProfileV2(obj: unknown): string {
  assertSafeDataV2(obj);
  const encode = (v: any): string => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(encode).join(",")}]` : `{${Object.keys(v).sort(compareUtf8Keys).map(k => `${JSON.stringify(k)}:${encode(v[k])}`).join(",")}}`;
  const result = encode(obj) + "\n";
  if (Buffer.byteLength(result) > 1048576) throw new PairedProfileV2Error("Oversized canonical data", ERROR_CODES.CANONICAL_ERROR);
  return result;
}

/**
 * Computes the domain-separated canonical digest of a canonicalized JSON string.
 */
export function computeCanonicalDigestV2(canonicalJson: string): string {
  return createHash("sha256")
    .update(V2_CANONICAL_DOMAIN_TAG + canonicalJson, "utf8")
    .digest("hex");
}

/**
 * Computes the exact SHA-256 digest of raw source bytes.
 */
export function computeRawSourceSha256(source: string | Uint8Array): string {
  if(typeof source!=="string" && !(source instanceof Uint8Array)) throw new PairedProfileV2Error("Source bytes required", ERROR_CODES.CANONICAL_ERROR);
  const bytes = typeof source === "string" ? Buffer.from(source, "utf8") : Buffer.from(source);
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Checks whether a string contains lone/unpaired UTF-16 surrogates.
 */
export function hasLoneSurrogates(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: must be followed by a low surrogate
      if (i + 1 >= str.length) return true;
      const next = str.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      i++; // skip valid pair
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // Low surrogate without preceding high surrogate
      return true;
    }
  }
  return false;
}

/**
 * Validates that an object contains only safe data:
 * - No lone surrogates in strings
 * - No unsafe numbers (-0, non-finite, unsafe integers)
 * - No prototype poison keys
 */
export function assertSafeDataV2(val: unknown, _path = ""): void {
  try { assertSafeData(val); } catch { throw new PairedProfileV2Error("Unsafe JSON data", ERROR_CODES.UNSAFE_DATA); }
  const visit = (v: unknown): void => {
    if (typeof v === "string" && hasLoneSurrogates(v)) throw new PairedProfileV2Error("Invalid Unicode", ERROR_CODES.CANONICAL_ERROR);
    if (typeof v === "number" && (Object.is(v, -0) || Math.abs(v) > Number.MAX_SAFE_INTEGER)) throw new PairedProfileV2Error("Unsafe number", ERROR_CODES.UNSAFE_DATA);
    if (v && typeof v === "object") for (const [key, child] of Object.entries(v)) { visit(key); visit(child); }
  };
  visit(val);
}

/**
 * Parses JSON from string or Uint8Array, verifying:
 * - Bounded input (<= 1 MiB)
 * - No UTF-8 BOM
 * - Duplicate-free keys
 * - Safe data (no prototypes, accessors, nonfinite numbers, negative zero -0, unsafe ints)
 * - Valid Unicode (no lone surrogates)
 */
export function parseProfileV2Json(source: string | Uint8Array): unknown {
  if (typeof source === "string" && hasLoneSurrogates(source)) throw new PairedProfileV2Error("Invalid Unicode", ERROR_CODES.CANONICAL_ERROR);
  if(typeof source!=="string" && !(source instanceof Uint8Array)) throw new PairedProfileV2Error("Source bytes required", ERROR_CODES.CANONICAL_ERROR);
  const bytes = typeof source === "string" ? Buffer.from(source, "utf8") : Buffer.from(source);

  if (bytes.length > 1_048_576) {
    throw new PairedProfileV2Error("Input exceeds maximum allowed size of 1 MiB", ERROR_CODES.CANONICAL_ERROR);
  }

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new PairedProfileV2Error("UTF-8 BOM is not allowed", ERROR_CODES.CANONICAL_ERROR);
  }

  let rawString: string;
  try {
    rawString = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PairedProfileV2Error("Invalid UTF-8 byte sequence", ERROR_CODES.CANONICAL_ERROR);
  }

  if (hasLoneSurrogates(rawString)) {
    throw new PairedProfileV2Error("Invalid Unicode: lone surrogates in input", ERROR_CODES.CANONICAL_ERROR);
  }

  // Use the duplicate-free parser from input.js
  let parsed: unknown;
  try { parsed = parseThemeJson(bytes); } catch { throw new PairedProfileV2Error("Malformed or unsafe JSON", ERROR_CODES.CANONICAL_ERROR); }

  // Validate post-parse safety (-0, lone surrogates in parsed strings, unsafe ints, prototypes)
  assertSafeDataV2(parsed);

  return parsed;
}
