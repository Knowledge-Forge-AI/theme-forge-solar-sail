import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// The public qualification tool is native ESM; exercise its API at runtime.
const qualificationToolUrl = new URL("../tools/qualify-installed.mjs", import.meta.url).href;
const {
  compareDirectorySnapshots,
  createMinimalPackageMetadata,
  createMinimalValidPairedProfile,
  createMinimalValidTheme,
  isMainScript,
  killProcessGroup,
  parseInstalledQualificationArgs,
  qualifyInstalledCli,
  qualifyInstalledLibrary,
  qualifyInstalledSolar,
  resolveQualificationTargets,
  runBoundedCommand,
  takeDirectorySnapshot,
} = await import(qualificationToolUrl);

const solarSailRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testScratchDirs: string[] = [];

function makeTempDir(prefix = "solar-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  testScratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of testScratchDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures
    }
  }
});

describe("parseInstalledQualificationArgs", () => {
  it("parses empty args with standard defaults", () => {
    const parsed = parseInstalledQualificationArgs([]);
    expect(parsed.packageRoot).toBeNull();
    expect(parsed.cli).toBeNull();
    expect(parsed.node).toBeNull();
    expect(parsed.kind).toBeNull();
    expect(parsed.workDir).toBeNull();
    expect(parsed.timeoutMs).toBe(15_000);
    expect(parsed.stdout).toBe(true);
    expect(parsed.json).toBe(false);
  });

  it("parses explicit arguments with spaces", () => {
    const parsed = parseInstalledQualificationArgs([
      "--package-root",
      "/opt/solar-pkg",
      "--cli",
      "/opt/solar-pkg/bin/tfss",
      "--node",
      "/usr/bin/node",
      "--kind",
      "nix",
      "--work-dir",
      "/tmp/scratch-solar",
      "--timeout",
      "25000",
      "--no-stdout",
    ]);
    expect(parsed.packageRoot).toBe(resolve("/opt/solar-pkg"));
    expect(parsed.cli).toBe(resolve("/opt/solar-pkg/bin/tfss"));
    expect(parsed.node).toBe(resolve("/usr/bin/node"));
    expect(parsed.kind).toBe("nix");
    expect(parsed.workDir).toBe(resolve("/tmp/scratch-solar"));
    expect(parsed.timeoutMs).toBe(25_000);
    expect(parsed.stdout).toBe(false);
  });

  it("parses arguments with equals syntax and aliases", () => {
    const parsed = parseInstalledQualificationArgs([
      "--package-root=/usr/local/opt/solar-sail",
      "--cli-path=/usr/local/opt/solar-sail/bin/tfss",
      "--node-runtime=/usr/local/bin/node",
      "--package-kind=homebrew",
      "--scratch=/var/tmp/solar-work",
      "--timeout-ms=30000",
      "--json",
    ]);
    expect(parsed.packageRoot).toBe(resolve("/usr/local/opt/solar-sail"));
    expect(parsed.cli).toBe(resolve("/usr/local/opt/solar-sail/bin/tfss"));
    expect(parsed.node).toBe(resolve("/usr/local/bin/node"));
    expect(parsed.kind).toBe("homebrew");
    expect(parsed.workDir).toBe(resolve("/var/tmp/solar-work"));
    expect(parsed.timeoutMs).toBe(30_000);
    expect(parsed.json).toBe(true);
  });

  it("handles --help and -h flags", () => {
    expect(parseInstalledQualificationArgs(["--help"]).help).toBe(true);
    expect(parseInstalledQualificationArgs(["-h"]).help).toBe(true);
  });

  it("rejects duplicate arguments", () => {
    expect(() =>
      parseInstalledQualificationArgs(["--package-root", "/a", "--package-root", "/b"]),
    ).toThrow(/Duplicate --package-root/);
    expect(() =>
      parseInstalledQualificationArgs(["--cli", "/a", "--cli", "/b"]),
    ).toThrow(/Duplicate --cli/);
    expect(() =>
      parseInstalledQualificationArgs(["--node", "/a", "--node", "/b"]),
    ).toThrow(/Duplicate --node/);
    expect(() =>
      parseInstalledQualificationArgs(["--kind", "npm", "--kind", "nix"]),
    ).toThrow(/Duplicate --kind/);
    expect(() =>
      parseInstalledQualificationArgs(["--work-dir", "/a", "--work-dir", "/b"]),
    ).toThrow(/Duplicate --work-dir/);
  });

  it("rejects missing argument values", () => {
    expect(() => parseInstalledQualificationArgs(["--package-root"])).toThrow(/Missing value/);
    expect(() => parseInstalledQualificationArgs(["--cli"])).toThrow(/Missing value/);
    expect(() => parseInstalledQualificationArgs(["--node"])).toThrow(/Missing value/);
    expect(() => parseInstalledQualificationArgs(["--kind"])).toThrow(/Missing value/);
    expect(() => parseInstalledQualificationArgs(["--work-dir"])).toThrow(/Missing value/);
  });

  it("rejects invalid package distribution kinds", () => {
    expect(() => parseInstalledQualificationArgs(["--kind", "dpkg"])).toThrow(
      /Invalid value for --kind.*Expected "npm", "nix", or "homebrew"/,
    );
  });

  it("rejects unexpected arguments", () => {
    expect(() => parseInstalledQualificationArgs(["--unrecognized-option"])).toThrow(
      /Unexpected argument/,
    );
  });
});

describe("resolveQualificationTargets", () => {
  it("rejects omitted or empty installed package root with no PATH fallback", () => {
    expect(() => resolveQualificationTargets()).toThrow(/explicit --package-root directory is required/);
    expect(() => resolveQualificationTargets({ packageRoot: "" })).toThrow(/explicit --package-root directory is required/);
    expect(() => resolveQualificationTargets({ packageRoot: "   " })).toThrow(/explicit --package-root directory is required/);
  });

  it("rejects non-existent package root directory", () => {
    expect(() =>
      resolveQualificationTargets({ packageRoot: "/nonexistent/path/for/solar/qualification" }),
    ).toThrow(/Installed package root does not exist/);
  });

  it("throws when targets cannot be resolved from an empty package directory", () => {
    const emptyPkg = makeTempDir("empty-pkg-");
    expect(() => resolveQualificationTargets({ packageRoot: emptyPkg })).toThrow(
      /Installed package identity is missing/,
    );
  });

  it("rejects an unexpected installed package before executing it", () => {
    const root = makeTempDir("wrong-identity-");
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "wrong-package" }));
    expect(() => resolveQualificationTargets({ packageRoot: root })).toThrow(/Unexpected installed Solar Sail package identity/);
  });

  it("resolves targets when given explicit valid paths", () => {
    const mockPkg = makeTempDir("mock-pkg-");
    writeFileSync(join(mockPkg, "package.json"), readFileSync(join(solarSailRoot, "package.json")));
    mkdirSync(join(mockPkg, "bin"), { recursive: true });
    mkdirSync(join(mockPkg, "dist"), { recursive: true });
    writeFileSync(join(mockPkg, "bin/tfss.js"), "#!/usr/bin/env node\n");
    writeFileSync(join(mockPkg, "dist/index.js"), "export const ok = true;\n");

    const targets = resolveQualificationTargets({
      packageRoot: mockPkg,
      cli: join(mockPkg, "bin/tfss.js"),
      mainExport: join(mockPkg, "dist/index.js"),
      node: process.execPath,
      kind: "nix",
    });

    expect(targets.packageRoot).toBe(mockPkg);
    expect(targets.cli).toBe(join(mockPkg, "bin/tfss.js"));
    expect(targets.mainExport).toBe(join(mockPkg, "dist/index.js"));
    expect(targets.node).toBe(process.execPath);
    expect(targets.kind).toBe("nix");
  });

  it("infers homebrew package kind from /Cellar/ or /homebrew/ paths", () => {
    const brewPkg = makeTempDir("Cellar-mock-");
    writeFileSync(join(brewPkg, "package.json"), readFileSync(join(solarSailRoot, "package.json")));
    mkdirSync(join(brewPkg, "bin"), { recursive: true });
    mkdirSync(join(brewPkg, "dist"), { recursive: true });
    writeFileSync(join(brewPkg, "bin/tfss.js"), "#!/usr/bin/env node\n");
    writeFileSync(join(brewPkg, "dist/index.js"), "export const ok = true;\n");

    const targets = resolveQualificationTargets({ packageRoot: brewPkg });
    expect(targets.kind).toBe("homebrew");
  });
});

describe("directory snapshot and fixture helpers", () => {
  it("takes and compares identical directory snapshots", () => {
    const dir = makeTempDir("snap-identical-");
    writeFileSync(join(dir, "a.txt"), "hello");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.txt"), "world");

    const snap1 = takeDirectorySnapshot(dir);
    const snap2 = takeDirectorySnapshot(dir);
    expect(compareDirectorySnapshots(snap1, snap2)).toBe(true);
    expect(snap1["a.txt"]?.size).toBe(5);
    expect(snap1["sub/b.txt"]?.size).toBe(5);
  });

  it("detects content changes in directory snapshots", () => {
    const dir = makeTempDir("snap-change-");
    writeFileSync(join(dir, "config.json"), '{"version": "1.0.0"}');
    const before = takeDirectorySnapshot(dir);

    writeFileSync(join(dir, "config.json"), '{"version": "2.0.0"}');
    const after = takeDirectorySnapshot(dir);
    expect(compareDirectorySnapshots(before, after)).toBe(false);
  });

  it("detects added or deleted files in snapshots", () => {
    const dir = makeTempDir("snap-add-del-");
    writeFileSync(join(dir, "first.txt"), "first");
    const before = takeDirectorySnapshot(dir);

    writeFileSync(join(dir, "second.txt"), "second");
    expect(compareDirectorySnapshots(before, takeDirectorySnapshot(dir))).toBe(false);

    rmSync(join(dir, "second.txt"));
    expect(compareDirectorySnapshots(before, takeDirectorySnapshot(dir))).toBe(true);
  });

  it("creates valid minimal theme and paired profile structures", () => {
    const theme = createMinimalValidTheme("test-theme");
    expect(theme.schemaVersion).toBe("tfss.theme-v1");
    expect((theme as any).palette?.light?.primary).toBe("#0066cc");

    const paired = createMinimalValidPairedProfile("test-paired");
    expect(paired.schemaVersion).toBe("tf-paired-profile-v1");
    expect((paired as any).palette?.light?.primary).toBe("#0066cc");

    const pkg = createMinimalPackageMetadata("@test/pkg");
    expect(pkg.license).toBe("AGPL-3.0-or-later");
  });
});

describe("runBoundedCommand and process group management", () => {
  it("executes command cleanly and captures bounded stdout", () => {
    const res = runBoundedCommand(process.execPath, ["-e", 'console.log("solar-ok")']);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("solar-ok");
    expect(res.stderr).toBe("");
  });

  it("captures non-zero exit status and stderr", () => {
    const res = runBoundedCommand(process.execPath, [
      "-e",
      'console.error("fatal-solar-error"); process.exit(7);',
    ]);
    expect(res.status).toBe(7);
    expect(res.stderr).toContain("fatal-solar-error");
  });

  it("enforces finite timeouts on long-running processes", () => {
    const start = Date.now();
    const res = runBoundedCommand(
      process.execPath,
      ["-e", "setTimeout(() => {}, 60000);"],
      { timeoutMs: 500 },
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
    expect(res.status).not.toBe(0);
  });

  it("safely handles killProcessGroup on null or already terminated processes", () => {
    expect(() => killProcessGroup(null)).not.toThrow();
    expect(() => killProcessGroup({ killed: true })).not.toThrow();
    expect(() => killProcessGroup({ exitCode: 0 })).not.toThrow();
  });
});

describe("installed CLI and Library qualification behavior", () => {
  const scratchPkgRoot = mkdtempSync(join(tmpdir(), "solar-installed-fixture-"));
  beforeAll(() => {
    const metadata = JSON.parse(readFileSync(join(solarSailRoot, "package.json"), "utf8"));
    for (const member of ["package.json", ...metadata.files]) {
      const source = join(solarSailRoot, member);
      if (existsSync(source)) cpSync(source, join(scratchPkgRoot, member), { recursive: true });
    }
  });
  afterAll(() => rmSync(scratchPkgRoot, { recursive: true, force: true }));

  it(
    "qualifies installed CLI version, validate, compile determinism, malformed rejection, and prior output preservation",
    async () => {
      const targets = resolveQualificationTargets({ packageRoot: scratchPkgRoot });
      const workDir = makeTempDir("cli-qual-work-");

      const cliReport = await qualifyInstalledCli(targets.cli, workDir, {
        timeoutMs: 20_000,
        nodePath: targets.node,
        packageRoot: scratchPkgRoot,
      });

      expect(cliReport.help).toBe(true);
      expect(cliReport.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(cliReport.validThemeValidation).toBe(true);
      expect(cliReport.invalidThemeRejection).toBe(true);
      expect(cliReport.compilationSuccess).toBe(true);
      expect(cliReport.outputDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(cliReport.repeatDeterminism).toBe(true);
      expect(cliReport.malformedRejection).toBe(true);
      expect(cliReport.priorOutputPreserved).toBe(true);
      expect(cliReport.generationSuccess).toBe(true);
      expect(cliReport.cwdIndependence).toBe(true);
      expect(cliReport.isolatedUserState).toBe(true);
    },
  );

  it(
    "qualifies installed library main export for v1/v2 paired mapping, candidate identities, and B1 error taxonomy",
    async () => {
      const targets = resolveQualificationTargets({ packageRoot: scratchPkgRoot });

      const libReport = await qualifyInstalledLibrary(scratchPkgRoot, targets.mainExport, {
        timeoutMs: 15_000,
      });

      expect(libReport.v1Surfaces).toBe(true);
      expect(libReport.v2Surfaces).toBe(true);
      expect(libReport.mappingReports).toBe(true);
      expect(libReport.candidateIdentities).toBe(true);
      expect(libReport.b1ErrorTaxonomy).toBe(true);
    },
  );

  it(
    "executes full qualifyInstalledSolar pipeline and confirms installed tree remains unchanged",
    async () => {
      const report = await qualifyInstalledSolar({
        packageRoot: scratchPkgRoot,
        stdout: false,
      });

      expect(report.qualified).toBe(true);
      expect(report.installedTreeUnchanged).toBe(true);
      expect(report.schemaVersion).toBe(1);
      expect(report.product).toBe("theme-forge-solar-sail");
      expect(report.cli.compilationSuccess).toBe(true);
      expect(report.cli.repeatDeterminism).toBe(true);
      expect(report.cli.priorOutputPreserved).toBe(true);
      expect(report.library.v1Surfaces).toBe(true);
      expect(report.library.v2Surfaces).toBe(true);
      expect(report.library.b1ErrorTaxonomy).toBe(true);
    },
  );

  it("rejects full qualification when package root is missing", async () => {
    await expect(qualifyInstalledSolar()).rejects.toThrow(
      /explicit --package-root directory is required/,
    );
  });
});
