import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateThemeSpecification,
  validatePackageMetadata,
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

  it("rejects unknown top-level keys", () => {
    const invalid = { ...validTheme, unknownField: true };
    const res = validateThemeSpecification(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("unknownField"))).toBe(true);
    expect(res.diagnostics.some((d) => d.code === "UNKNOWN_FIELD")).toBe(true);
  });

  it("rejects unknown nested keys in surfaces and typography", () => {
    const badSurfaces = structuredClone(validTheme);
    badSurfaces.surfaces.shadow = "0 1px 2px rgba(0,0,0,0.1)";
    const resSurfaces = validateThemeSpecification(badSurfaces);
    expect(resSurfaces.valid).toBe(false);
    expect(resSurfaces.diagnostics.some((d) => d.code === "UNKNOWN_FIELD")).toBe(true);

    const badTypo = structuredClone(validTheme);
    badTypo.typography.letterSpacing = "0.05em";
    const resTypo = validateThemeSpecification(badTypo);
    expect(resTypo.valid).toBe(false);
    expect(resTypo.diagnostics.some((d) => d.code === "UNKNOWN_FIELD")).toBe(true);
  });

  it("rejects unknown color roles and asymmetric roles", () => {
    const badRole = structuredClone(validTheme);
    badRole.palette.light.customRole = "#123456";
    badRole.palette.dark.customRole = "#123456";
    const resBadRole = validateThemeSpecification(badRole);
    expect(resBadRole.valid).toBe(false);
    expect(resBadRole.diagnostics.some((d) => d.code === "UNKNOWN_COLOR_ROLE")).toBe(true);

    const asym = structuredClone(validTheme);
    asym.palette.light.chart1 = "oklch(0.6 0.1 20)";
    // chart1 missing in dark
    const resAsym = validateThemeSpecification(asym);
    expect(resAsym.valid).toBe(false);
    expect(resAsym.diagnostics.some((d) => d.code === "ASYMMETRIC_COLOR_ROLES")).toBe(true);
  });

  it("rejects CSS injection across color, length, and font sinks", () => {
    const injectColor = structuredClone(validTheme);
    injectColor.palette.light.primary = "oklch(0.5 0.1 20); } body { color: red; }";
    expect(validateThemeSpecification(injectColor).valid).toBe(false);

    const injectLength = structuredClone(validTheme);
    injectLength.surfaces.radius = "0.5rem; } evil { color: red; }";
    expect(validateThemeSpecification(injectLength).valid).toBe(false);

    const injectFont = structuredClone(validTheme);
    injectFont.typography.fontSans = "sans-serif; } body { display: none; }";
    expect(validateThemeSpecification(injectFont).valid).toBe(false);
  });

  it("rejects invalid optional types", () => {
    const badDesc = structuredClone(validTheme);
    badDesc.description = 123;
    expect(validateThemeSpecification(badDesc).valid).toBe(false);

    const badBorder = structuredClone(validTheme);
    badBorder.surfaces.borderWidth = 123;
    expect(validateThemeSpecification(badBorder).valid).toBe(false);

    const badHeading = structuredClone(validTheme);
    badHeading.typography.fontHeading = true;
    expect(validateThemeSpecification(badHeading).valid).toBe(false);
  });

  it("accepts symmetric optional chart and sidebar roles", () => {
    const extended = structuredClone(validTheme);
    extended.palette.light.chart1 = "#112233";
    extended.palette.dark.chart1 = "#445566";
    extended.palette.light.sidebar = "#ffffff";
    extended.palette.dark.sidebar = "#000000";

    const res = validateThemeSpecification(extended);
    expect(res.valid).toBe(true);
    expect(res.specification?.palette.light.chart1).toBe("#112233");
    expect(res.specification?.palette.dark.chart1).toBe("#445566");
  });

  it("returns deeply frozen owned data that protects against caller mutation", () => {
    const inputTheme = structuredClone(validTheme);
    const res = validateThemeSpecification(inputTheme);
    expect(res.valid).toBe(true);
    expect(res.specification).toBeDefined();
    expect(Object.isFrozen(res.specification)).toBe(true);
    expect(Object.isFrozen(res.specification!.palette)).toBe(true);
    expect(Object.isFrozen(res.specification!.palette.light)).toBe(true);

    inputTheme.name = "mutated-name";
    inputTheme.palette.light.primary = "#000000";
    expect(res.specification!.name).toBe("forge-console");
    expect(res.specification!.palette.light.primary).toBe("#126475");
  });
});
