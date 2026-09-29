import { describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
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
    expect(indexTs).toContain("sourceProfileSha256?: string;");
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

  it("emits sourceProfileSha256 in ThemeSpecification without excess-property defect", () => {
    const themeWithSha = {
      ...validTheme,
      sourceProfileSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    };

    const res = generateThemePackage({
      themeSpec: themeWithSha,
      metadata: validMetadata,
      language: "typescript",
    });

    const indexTs = res.files.get("src/index.ts") as string;
    expect(indexTs).toContain("sourceProfileSha256?: string;");

    const inlinedSpecMatch = indexTs.match(/export const themeSpec: ThemeSpecification = ([\s\S]*?);\nexport const themeCss/);
    expect(inlinedSpecMatch).not.toBeNull();
    const parsedInlinedSpec = JSON.parse(inlinedSpecMatch![1]);
    expect(parsedInlinedSpec.sourceProfileSha256).toBe(themeWithSha.sourceProfileSha256);

    const themeJson = JSON.parse(res.files.get("theme.json") as string);
    expect(parsedInlinedSpec).toEqual(themeJson);
  });

  it("validates generation options without external dependencies", () => {
    expect(() => generateThemePackage(null as any)).toThrow(TypeError);
    expect(() => generateThemePackage({} as any)).toThrow(TypeError);
    expect(() =>
      generateThemePackage({
        themeSpec: validTheme,
        metadata: validMetadata,
        language: "python" as any,
      })
    ).toThrow(TypeError);
    expect(() =>
      generateThemePackage({
        themeSpec: null as any,
        metadata: validMetadata,
      })
    ).toThrow(TypeError);
    expect(() =>
      generateThemePackage({
        themeSpec: validTheme,
        metadata: null as any,
      })
    ).toThrow(TypeError);
  });

  it("enforces filesystem safety: refuses non-empty directories even with overwrite:true", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tfss-test-safety-"));
    const existingFilePath = join(tempDir, "existing.txt");
    const existingContent = "pre-existing secret data";
    await writeFile(existingFilePath, existingContent);

    const res = generateThemePackage({
      themeSpec: validTheme,
      metadata: validMetadata,
    });

    // Without overwrite option
    await expect(writePackageFiles(res.files, tempDir)).rejects.toThrow(
      FilesystemSafetyError
    );

    // With overwrite: true, MUST STILL BE REFUSED
    await expect(
      writePackageFiles(res.files, tempDir, { overwrite: true })
    ).rejects.toThrow(FilesystemSafetyError);

    // Verify existing bytes are completely preserved
    const preservedContent = await readFile(existingFilePath, "utf8");
    expect(preservedContent).toBe(existingContent);
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
