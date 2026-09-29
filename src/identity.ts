import { canonicalizeJson, computeSha256 } from "./compiler.js";
import { generateThemePackage } from "./emitter.js";
import { COMPILER_NAME, COMPILER_VERSION, type GeneratePackageOptions } from "./types.js";

/** Identity of the complete effective direct-generator invocation, not profile application. */
export function describeGenerationInvocation(options: GeneratePackageOptions) {
  const result = generateThemePackage(options);
  const manifest = JSON.parse(result.files.get("package.json") as string) as Record<string, unknown>;
  const invocation = {
    schema: "tfss.generation-invocation-v1" as const,
    compiler: { name: COMPILER_NAME, version: COMPILER_VERSION },
    theme: result.themeSpec,
    language: options.language ?? "javascript",
    metadata: {
      name: manifest.name, version: manifest.version, description: manifest.description,
      author: manifest.author ?? null, license: manifest.license, private: manifest.private,
    },
  };
  return {
    invocation,
    invocationDigest: computeSha256("tfss.generation-invocation-v1\n" + canonicalizeJson(invocation)),
    outputFiles: [...result.files].sort(([a], [b]) => a.localeCompare(b, "en")).map(([path, bytes]) => ({
      path, size: typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength, sha256: computeSha256(bytes),
    })),
    descriptorInventoryDigest: result.descriptor.inventoryDigest,
    packageInventoryDigest: result.provenance.inventoryDigest,
    provenanceDigest: computeSha256(result.files.get("provenance.json")!),
  };
}
