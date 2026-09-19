import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateThemeSpecification,
  calculateContrastRatio,
  parseHexColor,
  relativeLuminance,
} from "../src/validator.js";

const examplePath = resolve(import.meta.dirname, "../examples/forge-console.theme.json");
const validTheme = JSON.parse(readFileSync(examplePath, "utf8"));

describe("Solar Sail validator", () => {
  it("accepts a valid theme specification", () => {
    const res = validateThemeSpecification(validTheme);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.specification).toBeDefined();
    expect(res.specification?.name).toBe("forge-console");
  });

  it("rejects non-object inputs", () => {
    expect(validateThemeSpecification(null).valid).toBe(false);
    expect(validateThemeSpecification("string").valid).toBe(false);
    expect(validateThemeSpecification([1, 2, 3]).valid).toBe(false);
  });

  it("rejects invalid schemaVersion", () => {
    const invalid = { ...validTheme, schemaVersion: "invalid.version" };
    const res = validateThemeSpecification(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects invalid theme names", () => {
    const invalid = { ...validTheme, name: "INVALID NAME!" };
    const res = validateThemeSpecification(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("rejects missing mandatory color roles", () => {
    const invalid = structuredClone(validTheme);
    delete (invalid.palette.light as any).primary;
    const res = validateThemeSpecification(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("primary"))).toBe(true);
  });

  it("rejects invalid radius format", () => {
    const invalid = structuredClone(validTheme);
    invalid.surfaces.radius = "invalid-radius";
    const res = validateThemeSpecification(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("surfaces.radius"))).toBe(true);
  });

  it("computes WCAG contrast ratio accurately", () => {
    // White on Black -> 21:1
    const maxRatio = calculateContrastRatio("#ffffff", "#000000");
    expect(maxRatio).not.toBeNull();
    expect(maxRatio!).toBeCloseTo(21.0, 1);

    // Black on Black -> 1:1
    const minRatio = calculateContrastRatio("#000000", "#000000");
    expect(minRatio).not.toBeNull();
    expect(minRatio!).toBeCloseTo(1.0, 1);
  });

  it("emits contrast warning diagnostics when contrast is below threshold", () => {
    const lowContrastTheme = structuredClone(validTheme);
    // Low contrast light foreground on light background
    lowContrastTheme.palette.light.foreground = "#fff7f0";
    lowContrastTheme.palette.light.background = "#ffffff";

    const res = validateThemeSpecification(lowContrastTheme);
    expect(res.valid).toBe(true); // Warnings do not invalidate the theme
    expect(res.diagnostics.some((d) => d.code === "LOW_CONTRAST")).toBe(true);
  });

  it("emits info diagnostic for non-hex colors in contrast pairs", () => {
    const oklchTheme = structuredClone(validTheme);
    oklchTheme.palette.light.primary = "oklch(0.55 0.12 210)";
    oklchTheme.palette.light.primaryForeground = "oklch(0.98 0.01 210)";

    const res = validateThemeSpecification(oklchTheme);
    expect(res.valid).toBe(true);
    expect(res.diagnostics.some((d) => d.code === "UNEVALUATED_CONTRAST")).toBe(true);
  });
});
