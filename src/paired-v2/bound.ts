/**
 * TFSB71B2 Bound Paired Profile v2 & Source-Aware Provenance
 *
 * Implements:
 * - Binds actual source bytes, raw SHA-256 digest, and canonical digest.
 * - Enforces stale provenance detection against raw source bytes.
 * - Maps to Solar Sail specification and Stellar Loom catalog with truthful reports.
 * - In-memory immutable transformations with lineage tracking.
 */

import { Buffer } from "node:buffer";
import type { ThemeSpecification } from "../types.js";
import type { ProfileSyntaxModel } from "../profile.js";
import {
  type PairedProfileV2,
  type BoundPairedProfileV2,
  type ProfileProvenanceV2,
  type SolarSailMappingOptionsV2,
  type StellarLoomMappingOptionsV2,
  type MappingReportV2,
} from "./types.js";
import { assertValidPairedProfileV2 } from "./validator.js";
import {
  parseProfileV2Json,
  canonicalizeProfileV2,
  computeCanonicalDigestV2,
  computeRawSourceSha256,
  assertSafeDataV2,
} from "./canonical.js";
import {
  mapProfileToSolarSailV2,
  mapProfileToStellarLoomWithReportV2,
  generateMappingReportV2,
} from "./mapping.js";
import { deepFreeze } from "./normalize.js";
import { StaleProvenanceV2Error, PairedProfileV2Error, ERROR_CODES } from "./errors.js";

function createBoundInstance(
  profile: PairedProfileV2,
  provenance: ProfileProvenanceV2
): BoundPairedProfileV2 {
  const frozenProfile = deepFreeze(JSON.parse(JSON.stringify(profile))) as PairedProfileV2;
  const frozenProvenance = Object.freeze({ ...provenance });

  return {
    profile: frozenProfile,
    provenance: frozenProvenance,

    mapToSolarSail(options?: SolarSailMappingOptionsV2): {
      specification: ThemeSpecification;
      report: MappingReportV2;
      sourceProfileSha256: string;
      canonicalDigest: string;
    } {
      const effectiveSha256 =
        frozenProvenance.verificationStatus === "unverified-assertion"
          ? ""
          : frozenProvenance.rawSourceSha256;

      if (options) {
        assertSafeDataV2(options);
        if(Object.keys(options).some(k=>k!=="sourceProfileSha256") || options.sourceProfileSha256!==undefined && options.sourceProfileSha256!==effectiveSha256) throw new PairedProfileV2Error("Mapping source identity must match bound bytes",ERROR_CODES.STALE_PROVENANCE);
      }
      const specification = mapProfileToSolarSailV2(frozenProfile, {
        ...(effectiveSha256 ? { sourceProfileSha256: effectiveSha256 } : {}),
      });

      const report = generateMappingReportV2(
        frozenProfile,
        "solar-sail",
        { ...(options ?? {}), ...(effectiveSha256 ? { sourceProfileSha256: effectiveSha256 } : {}) },
        effectiveSha256 || undefined,
        frozenProvenance.verificationStatus === "transformed" ? "transformed" : effectiveSha256 ? "source-bytes" : "serialized-profile"
      );

      return {
        specification,
        report,
        sourceProfileSha256: effectiveSha256,
        canonicalDigest: frozenProvenance.canonicalDigest,
      };
    },

    mapToStellarLoom(options?: StellarLoomMappingOptionsV2): {
      catalog: Record<string, any>;
      syntax: ProfileSyntaxModel;
      report: MappingReportV2;
      sourceProfileSha256: string;
      canonicalDigest: string;
    } {
      const effectiveSha256 = frozenProvenance.verificationStatus === "unverified-assertion" ? "" : frozenProvenance.rawSourceSha256;
      const { catalog, syntax } = mapProfileToStellarLoomWithReportV2(frozenProfile, options?.catalog ?? {}, options);
      const report = generateMappingReportV2(frozenProfile, "stellar-loom", options as Record<string, unknown>, effectiveSha256 || undefined, frozenProvenance.verificationStatus === "transformed" ? "transformed" : effectiveSha256 ? "source-bytes" : "serialized-profile");
      return {
        catalog,
        syntax,
        report,
        sourceProfileSha256: effectiveSha256,
        canonicalDigest: frozenProvenance.canonicalDigest,
      };
    },


    transform(
      mutator: (draft: PairedProfileV2) => PairedProfileV2 | void
    ): BoundPairedProfileV2 {
      const draft = JSON.parse(JSON.stringify(frozenProfile)) as PairedProfileV2;
      const res = mutator(draft);
      const mutated = (res !== undefined ? res : draft) as PairedProfileV2;

      assertValidPairedProfileV2(mutated);

      const canonicalJson = canonicalizeProfileV2(mutated);
      const canonicalDigest = computeCanonicalDigestV2(canonicalJson);
      const rawSourceSha256 = computeRawSourceSha256(Buffer.from(canonicalJson, "utf8"));

      return createBoundInstance(mutated, {
        rawSourceSha256,
        canonicalDigest,
        verificationStatus: "transformed",
        isTransformed: true,
        byteLength: Buffer.byteLength(canonicalJson, "utf8"),
        parentSourceSha256: frozenProvenance.rawSourceSha256,
      });
    },
  };
}

export interface BindSourceProfileOptionsV2 {
  expectedSha256?: string | undefined;
}

/**
 * Binds actual source bytes, validates duplicate-aware JSON and schema,
 * verifies optional expected hash against raw source, and returns BoundPairedProfileV2.
 */
export function bindSourceProfileV2(
  source: string | Uint8Array,
  options?: BindSourceProfileOptionsV2
): BoundPairedProfileV2 {
  parseProfileV2Json(source);
  if(options){assertSafeDataV2(options);if(Object.keys(options).some(k=>k!=="expectedSha256"))throw new PairedProfileV2Error("Unknown binding option", ERROR_CODES.SCHEMA_VALIDATION);}
  const rawBytes = typeof source === "string" ? Buffer.from(source, "utf8") : Buffer.from(source);
  const rawSourceSha256 = computeRawSourceSha256(rawBytes);

  if (options?.expectedSha256 !== undefined) {
    if(typeof options.expectedSha256!=="string" || !/^(sha256:)?[a-f0-9]{64}$/.test(options.expectedSha256)) throw new PairedProfileV2Error("Invalid expected hash", ERROR_CODES.SCHEMA_VALIDATION);
    const expected = options.expectedSha256.startsWith("sha256:")
      ? options.expectedSha256.slice(7)
      : options.expectedSha256;
    if (expected.toLowerCase() !== rawSourceSha256.toLowerCase()) {
      throw new StaleProvenanceV2Error(
        options.expectedSha256,
        `sha256:${rawSourceSha256}`
      );
    }
  }

  const parsed = parseProfileV2Json(rawBytes);
  assertValidPairedProfileV2(parsed);
  const profile = parsed as PairedProfileV2;

  const canonicalJson = canonicalizeProfileV2(profile);
  const canonicalDigest = computeCanonicalDigestV2(canonicalJson);

  return createBoundInstance(profile, {
    rawSourceSha256,
    canonicalDigest,
    verificationStatus: "verified",
    isTransformed: false,
    byteLength: rawBytes.byteLength,
  });
}

/**
 * Creates a BoundPairedProfileV2 from an existing in-memory profile object.
 * Legacy hash assertions are recorded as unverified caller assertions.
 */
export function fromUnverifiedProfileV2(
  profile: PairedProfileV2,
  options?: { assertedSha256?: string }
): BoundPairedProfileV2 {
  assertValidPairedProfileV2(profile);

  const cleanAsserted = options?.assertedSha256
    ? options.assertedSha256.startsWith("sha256:")
      ? options.assertedSha256.slice(7)
      : options.assertedSha256
    : "";

  const canonicalJson = canonicalizeProfileV2(profile);
  const canonicalDigest = computeCanonicalDigestV2(canonicalJson);
  const derivedSha256 = computeRawSourceSha256(Buffer.from(canonicalJson, "utf8"));

  return createBoundInstance(profile, {
    rawSourceSha256: cleanAsserted || derivedSha256,
    canonicalDigest,
    verificationStatus: "unverified-assertion",
    isTransformed: false,
    byteLength: Buffer.byteLength(canonicalJson, "utf8"),
  });
}
