import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";

import { calculateContrastRatio, isSeparatedColorFunction } from "../src/validator.js";

// The shipped 0.2.0 expressions (CodeQL js/polynomial-redos), kept here only as the equivalence oracle.
const ORIGINAL = { rgb: /^rgba?\(.*[/,].*\)$/i, hsl: /^hsla?\(.*[/,].*\)$/i } as const;
const ALPHABET = ["r", "g", "b", "a", "h", "s", "l", "R", "A", "(", ")", ",", "/", " ", "x", "\n", "\r", "\u2028", "\u2029"];

function agrees(candidate: string, mismatches: string[]) {
  const s = candidate.trim().toLowerCase();
  for (const name of ["rgb", "hsl"] as const) if (ORIGINAL[name].test(s) !== isSeparatedColorFunction(s, name)) mismatches.push(`${name}:${JSON.stringify(candidate)}`);
}

describe("Solar Sail linear alpha-channel grammar", () => {
  it("is equivalent to the original expressions on exhaustive short and seeded random inputs", () => {
    const mismatches: string[] = [];
    let checked = 0;
    const visit = (prefix: string, depth: number) => {
      agrees(prefix, mismatches); checked += 1;
      if (depth > 0) for (const character of ALPHABET) visit(prefix + character, depth - 1);
    };
    for (const start of ["rgb(", "rgba(", "hsl(", "hsla(", "RGB(", "Hsla(", " rgb(", ""]) visit(start, start ? 3 : 4);
    let seed = 20260929;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let index = 0; index < 20_000; index += 1) {
      let candidate = ["rgb(", "rgba(", "hsl(", "hsla(", "RGBA(", "rgb", "hsl", " \t", ""][Math.floor(next() * 9)]!;
      const length = Math.floor(next() * 24);
      for (let offset = 0; offset < length; offset += 1) candidate += ALPHABET[Math.floor(next() * ALPHABET.length)]!;
      agrees(candidate, mismatches); checked += 1;
    }
    for (const literal of ["rgb(1, 2, 3)", "rgba(1,2,3,0.5)", "rgb(1 2 3 / 50%)", "HSLA(1, 2%, 3%, .4)", "hsl(1 2% 3%)", "rgb(1,\n2,3)", "rgb(1,2,3)\n", " rgb(1/2) ", "rgb()", "rgb(,)", "rgba(", "rgb(\u2028,)"]) agrees(literal, mismatches);
    expect(checked).toBeGreaterThan(100_000);
    expect(mismatches).toEqual([]);
  });

  it("preserves ordinary exported contrast results", () => {
    expect(calculateContrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(calculateContrastRatio("#FFF", "#000")).toBeCloseTo(21, 5);
    expect(calculateContrastRatio("#ffffff80", "#000000")).toBeNull();
    expect(calculateContrastRatio("rgba(0, 0, 0, 0.5)", "#000000")).toBeNull();
    expect(calculateContrastRatio("hsl(0 0% 0% / 50%)", "#000000")).toBeNull();
    expect(calculateContrastRatio(" #000000\n", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("scales linearly on adversarial unterminated inputs through the exported API", () => {
    const median = (input: string) => {
      const samples: number[] = [];
      for (let run = 0; run < 5; run += 1) {
        const started = performance.now();
        expect(calculateContrastRatio(input, "#000000")).toBeNull();
        samples.push(performance.now() - started);
      }
      return Math.max(samples.sort((left, right) => left - right)[2]!, 0.05);
    };
    for (const [head, unit] of [["rgb(", ","], ["hsla(", "/"], ["rgba(", ", "], ["hsl(", "1,"]] as const) {
      const small = median(head + unit.repeat(25_000)), large = median(head + unit.repeat(200_000));
      // 8x more input: linear work grows about 8x, the original quadratic backtracking about 64x.
      expect(large / small, `${head}${unit}`).toBeLessThan(32);
    }
  });
});
