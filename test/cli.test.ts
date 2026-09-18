import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCli } from "../src/cli.js";

const exampleThemePath = resolve(import.meta.dirname, "../examples/forge-console.theme.json");
const examplePkgPath = resolve(import.meta.dirname, "../examples/package-metadata.json");

describe("Solar Sail CLI", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("prints help message with --help", async () => {
    const code = await runCli(["node", "tfss", "--help"]);
    expect(code).toBe(0);
  });

  it("validates theme with tfss validate", async () => {
    const code = await runCli(["node", "tfss", "validate", exampleThemePath, "--json"]);
    expect(code).toBe(0);
  });

  it("compiles theme with tfss compile", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tfss-cli-compile-"));
    const outCss = join(tempDir, "theme.css");

    const code = await runCli([
      "node",
      "tfss",
      "compile",
      exampleThemePath,
      "--out",
      outCss,
      "--json",
    ]);
    expect(code).toBe(0);

    const cssContent = await readFile(outCss, "utf8");
    expect(cssContent).toContain("@theme inline");
  });

  it("generates theme package with tfss generate", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tfss-cli-gen-"));
    const outDir = join(tempDir, "generated-pkg");

    const code = await runCli([
      "node",
      "tfss",
      "generate",
      exampleThemePath,
      "--package",
      examplePkgPath,
      "--out",
      outDir,
      "--language",
      "typescript",
      "--json",
    ]);
    expect(code).toBe(0);

    const pkgJson = JSON.parse(await readFile(join(outDir, "package.json"), "utf8"));
    expect(pkgJson.name).toBe("@knowledge-forge-ai/app-theme-forge-console");
    expect(await readFile(join(outDir, "src/index.ts"), "utf8")).toContain("themeSpec");
  });

  it("rejects unsupported --language on validate and compile", async () => {
    const codeValidate = await runCli([
      "node",
      "tfss",
      "validate",
      exampleThemePath,
      "--language",
      "typescript",
    ]);
    expect(codeValidate).toBe(1);

    const codeCompile = await runCli([
      "node",
      "tfss",
      "compile",
      exampleThemePath,
      "--language",
      "typescript",
    ]);
    expect(codeCompile).toBe(1);
  });
});
