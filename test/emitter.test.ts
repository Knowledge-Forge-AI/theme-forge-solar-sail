import { describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  generateThemePackage,
  writePackageFiles,
  FilesystemSafetyError,
} from "../src/emitter.js";

const exampleThemePath = resolve(import.meta.dirname, "../examples/forge-console.theme.json");
const examplePkgPath = resolve(import.meta.dirname, "../examples/package-metadata.json");

const validTheme = JSON.parse(readFileSync(exampleThemePath, "utf8"));
const validMetadata = JSON.parse(readFileSync(examplePkgPath, "utf8"));

describe("Solar Sail emitter", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("emits JavaScript integration files by default", () => {
    const res = generateThemePackage({
      themeSpec: validTheme,
      metadata: validMetadata,
      language: "javascript",
    });

    expect(res.files.has("index.js")).toBe(true);
    expect(res.files.has("index.d.ts")).toBe(true);
    expect(res.files.has("index.ts")).toBe(false);
    expect(res.files.has("styles/theme.css")).toBe(true);
    expect(res.provenance.language).toBeUndefined(); // Omitted in default JS mode
  });

  it("emits TypeScript integration files when requested", () => {
    const res = generateThemePackage({
      themeSpec: validTheme,
      metadata: validMetadata,
      language: "typescript",
    });

    expect(res.files.has("src/index.ts")).toBe(true);
    expect(res.files.has("tsconfig.json")).toBe(true);
    expect(res.files.has("LICENSE")).toBe(true);
    expect(res.files.has("NOTICE")).toBe(true);
    expect(res.files.has("COMMERCIAL-LICENSE.md")).toBe(true);
    expect(res.provenance.language).toBe("typescript");

    const indexTs = res.files.get("src/index.ts") as string;
    expect(indexTs).not.toContain("@knowledge-forge-ai/theme-forge-solar-sail");
    expect(indexTs).toContain("export interface ThemeSpecification");
    expect(indexTs).toContain("export const themeSpec: ThemeSpecification =");

    // Spec parity: verify the JSON-serialized spec in src/index.ts matches theme.json
    const themeJson = JSON.parse(res.files.get("theme.json") as string);
    const inlinedSpecMatch = indexTs.match(/export const themeSpec: ThemeSpecification = ([\s\S]*?);\nexport const themeCss/);
    expect(inlinedSpecMatch).not.toBeNull();
    const parsedInlinedSpec = JSON.parse(inlinedSpecMatch![1]);
    expect(parsedInlinedSpec).toEqual(themeJson);

    const pkgJson = JSON.parse(res.files.get("package.json") as string);
    expect(pkgJson.files).toContain("COMMERCIAL-LICENSE.md");
    expect(pkgJson.files).toContain("dist");
    expect(pkgJson.files).toContain("src");
    expect(pkgJson.files).toContain("tsconfig.json");
    expect(pkgJson.scripts?.build).toBe("tsc");
    expect(pkgJson.devDependencies?.typescript).toBe("7.0.2");
    expect(pkgJson.exports["."].import).toBe("./dist/index.js");
    expect(pkgJson.exports["."].types).toBe("./dist/index.d.ts");
  });

  it("enforces filesystem safety: refuses non-empty directories without overwrite", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tfss-test-safety-"));
    // Place a file inside to make it non-empty
    await writeFile(join(tempDir, "existing.txt"), "pre-existing");

    const res = generateThemePackage({
      themeSpec: validTheme,
      metadata: validMetadata,
    });

    await expect(writePackageFiles(res.files, tempDir)).rejects.toThrow(
      FilesystemSafetyError
    );
  });

  it("successfully writes package files to an empty or absent directory", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tfss-test-write-"));
    const targetDir = join(tempDir, "target-pkg");

    const res = generateThemePackage({
      themeSpec: validTheme,
      metadata: validMetadata,
      language: "typescript",
    });

    const written = await writePackageFiles(res.files, targetDir);
    expect(written.length).toBeGreaterThan(5);
    expect(written).toContain("src/index.ts");
    expect(written).toContain("styles/theme.css");
  });
});
