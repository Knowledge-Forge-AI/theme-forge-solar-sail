import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileTheme, computeSha256 } from "../src/compiler.js";

const examplePath = resolve(import.meta.dirname, "../examples/forge-console.theme.json");
const validTheme = JSON.parse(readFileSync(examplePath, "utf8"));

describe("Solar Sail compiler", () => {
  it("compiles a valid specification to Tailwind v4 @theme inline format", () => {
    const res = compileTheme(validTheme);
    expect(res.css).toContain("@custom-variant dark (&:is(.dark *));");
    expect(res.css).toContain("@theme inline {");
    expect(res.css).toContain("--radius-sm: calc(var(--radius) * 0.6);");
    expect(res.css).toContain("--radius-4xl: calc(var(--radius) * 2.6);");
    expect(res.css).toContain("--color-primary: var(--primary);");
    expect(res.css).toContain("--color-background: var(--background);");
    expect(res.css).toContain(":root {");
    expect(res.css).toContain(".dark, :root[data-theme='dark'] {");
    expect(res.descriptor.schema).toBe("tfss.theme-descriptor-v1");
  });

  it("is strictly deterministic across repeated compilations", () => {
    const first = compileTheme(validTheme);
    const second = compileTheme(validTheme);
    expect(first.inputDigest).toBe(second.inputDigest);
    expect(first.outputDigest).toBe(second.outputDigest);
    expect(first.css).toBe(second.css);
    expect(first.descriptor.inventoryDigest).toBe(second.descriptor.inventoryDigest);
  });

  it("changes outputDigest and inputDigest when tokens change", () => {
    const modified = structuredClone(validTheme);
    modified.palette.dark.primary = "#00ffff"; // changed cyan
    const original = compileTheme(validTheme);
    const updated = compileTheme(modified);

    expect(updated.inputDigest).not.toBe(original.inputDigest);
    expect(updated.outputDigest).not.toBe(original.outputDigest);
  });
});

describe("Paired profile mapping", () => {
  const profilePath = resolve(import.meta.dirname, "../examples/forge-console.profile.json");
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));

  it("maps profile to Solar Sail theme specification", async () => {
    const { mapProfileToSolarSail } = await import("../src/profile.js");
    const ss = mapProfileToSolarSail(profile);
    expect(ss.schemaVersion).toBe("tfss.theme-v1");
    expect(ss.name).toBe("forge-console");
    expect(ss.palette.light.primary).toBe("#126475");
    expect(ss.palette.dark.primary).toBe("#69d3e4");
    expect(ss.surfaces.radius).toBe("0.5rem");
  });

  it("maps profile to Stellar Loom catalog specification", async () => {
    const { mapProfileToStellarLoom } = await import("../src/profile.js");
    const sl = mapProfileToStellarLoom(profile);
    expect(sl.schemaVersion).toBe("tfsl.theme-v2");
    expect(sl.tokenSets["forge-console"]["cyan-light-accent-base"]).toBe("#126475");
    expect(sl.tokenSets["forge-console"]["cyan-dark-accent-base"]).toBe("#69d3e4");
    expect(sl.surfaces.content).toBe(704);
  });

  it("faithfully maps profile into existing Forge Console reading catalog without clobbering primary tokens", async () => {
    const { mapProfileToStellarLoom } = await import("../src/profile.js");
    const localFixture = resolve(import.meta.dirname, "fixtures/forge-console-reading-catalog.json");
    if (!existsSync(localFixture)) {
      throw new Error(`Required vendored test fixture missing at ${localFixture}`);
    }
    const existingCatalog = JSON.parse(readFileSync(localFixture, "utf8"));
    const sl = mapProfileToStellarLoom(profile, existingCatalog);

    expect(sl.tokenSets["forge-console"]["cyan-light-accent-base"]).toBe("#126475");
    expect(sl.tokenSets["forge-console"]["cyan-dark-accent-base"]).toBe("#69d3e4");
    expect(sl.tokenSets["forge-console"]["cyan-light-page"]).toBe("#fff8f0");
    expect(sl.tokenSets["forge-console"]["cyan-light-body"]).toBe("#262a33");
    expect(sl.tokenSets["forge-console"]["orange-light-accent-base"]).toBe("#9c3e0b");
    expect(sl.tokenSets["forge-console"]["orange-dark-accent-base"]).toBe("#ff8a3d");
  });
});

