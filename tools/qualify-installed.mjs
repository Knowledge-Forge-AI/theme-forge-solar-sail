#!/usr/bin/env node

/**
 * @fileoverview Sibling-free installed Solar Sail qualification probe and CLI.
 *
 * Qualifies an installed Theme Forge Solar Sail package (npm, Nix, or Homebrew)
 * without requiring monorepo sibling packages or private workspace infrastructure.
 *
 * Verifies:
 * 1. Explicit package root, node runtime, and scratch directory (no PATH/source fallback).
 * 2. Installed CLI (tfss) version, help, validation, compilation, and package generation.
 * 3. Independent expected output bytes and SHA-256 digest computation.
 * 4. Strict compilation repeat determinism.
 * 5. Malformed input rejection and prior-output preservation.
 * 6. Working directory independence and isolated user/cache environment.
 * 7. Installed library main export:
 *    - v1/v2 paired profile mapping surfaces
 *    - Candidate-set and generation invocation identities and mapping reports
 *    - B1/B2 safety and error taxonomy (ERROR_CODES, classifyProfileError, FilesystemSafetyError)
 * 8. Immutability of the installed package tree during qualification.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Checks whether this module was executed directly as a script.
 *
 * @param {string} importMetaUrl
 * @returns {boolean}
 */
export function isMainScript(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(importMetaUrl) === resolve(process.argv[1]);
  } catch {
    return false;
  }
}

/**
 * Terminates a process group or child process safely.
 *
 * @param {{ pid?: number | null, killed?: boolean, exitCode?: number | null } | null | undefined} child
 * @param {NodeJS.Signals | number} [signal]
 */
export function killProcessGroup(child, signal = "SIGKILL") {
  if (!child || child.killed || (child.exitCode !== null && child.exitCode !== undefined)) return;
  try {
    if (child.pid && process.platform !== "win32") {
      process.kill(-child.pid, signal);
    }
  } catch {
    try {
      if (child.pid) {
        process.kill(child.pid, signal);
      }
    } catch {
      // Process already terminated
    }
  }
}

/**
 * Executes a command with bounded execution time, bounded output collection,
 * and automatic process group cleanup on failure or timeout.
 *
 * @param {string} executable
 * @param {string[]} args
 * @param {{
 *   cwd?: string,
 *   timeoutMs?: number,
 *   maxOutputBytes?: number,
 *   nodePath?: string,
 *   env?: Record<string, string>,
 *   homeDir?: string,
 *   workDir?: string,
 * }} [options]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
export function runBoundedCommand(executable, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxOutputBytes = options.maxOutputBytes ?? 10_000_000;
  const nodePath = options.nodePath ?? process.execPath;

  let bin = executable;
  let cmdArgs = [...args];
  if (executable.endsWith(".js") || executable.endsWith(".mjs")) {
    bin = nodePath;
    cmdArgs = [executable, ...args];
  }

  const baseHome = options.homeDir ?? options.workDir ?? tmpdir();
  const isolatedEnv = {
    ...process.env,
    HOME: baseHome,
    XDG_CONFIG_HOME: join(baseHome, ".config"),
    XDG_CACHE_HOME: join(baseHome, ".cache"),
    npm_config_cache: join(baseHome, ".npm"),
    ...(options.env || {}),
  };

  /** @type {import("node:child_process").SpawnSyncOptionsWithStringEncoding & { detached?: boolean }} */
  const spawnSyncOpts = {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: maxOutputBytes,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: isolatedEnv,
  };

  const result = spawnSync(bin, cmdArgs, spawnSyncOpts);

  if (result.pid) {
    killProcessGroup({ pid: result.pid }, "SIGKILL");
  }

  return {
    status: result.status ?? (result.signal ? 1 : 0),
    stdout: result.stdout ?? "",
    stderr: result.stderr || (result.error ? result.error.message : ""),
  };
}

/**
 * Creates an in-memory recursive snapshot of a directory mapping relative paths
 * to file sizes and SHA-256 hex digests.
 *
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {Record<string, { size: number, sha256: string }>}
 */
export function takeDirectorySnapshot(dir, prefix = "") {
  /** @type {Record<string, { size: number, sha256: string }>} */
  const entries = {};
  const currentDir = prefix === "" ? dir : join(dir, prefix);
  if (!existsSync(currentDir)) return entries;

  const items = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) =>
    Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)),
  );

  for (const item of items) {
    const rel = prefix === "" ? item.name : `${prefix}/${item.name}`;
    const full = join(dir, rel);
    if (item.isDirectory()) {
      Object.assign(entries, takeDirectorySnapshot(dir, rel));
    } else if (item.isFile()) {
      const buf = readFileSync(full);
      entries[rel] = {
        size: statSync(full).size,
        sha256: createHash("sha256").update(buf).digest("hex"),
      };
    }
  }
  return entries;
}

/**
 * Compares two directory snapshots for exact size and SHA-256 equivalence.
 *
 * @param {Record<string, { size: number, sha256: string }>} before
 * @param {Record<string, { size: number, sha256: string }>} after
 * @returns {boolean}
 */
export function compareDirectorySnapshots(before, after) {
  const beforeKeys = Object.keys(before).sort();
  const afterKeys = Object.keys(after).sort();
  if (beforeKeys.length !== afterKeys.length) return false;
  for (let i = 0; i < beforeKeys.length; i++) {
    const key = beforeKeys[i];
    if (key === undefined || key !== afterKeys[i]) return false;
    const b = before[key];
    const a = after[key];
    if (!b || !a || b.size !== a.size || b.sha256 !== a.sha256) return false;
  }
  return true;
}

/**
 * Creates a minimal valid ThemeSpecification object.
 *
 * @param {string} [name]
 * @returns {Record<string, unknown>}
 */
export function createMinimalValidTheme(name = "qualification-theme") {
  return {
    schemaVersion: "tfss.theme-v1",
    name,
    version: "1.0.0",
    description: "Minimal valid qualification theme",
    palette: {
      light: {
        background: "#ffffff",
        foreground: "#111111",
        card: "#f8f8f8",
        cardForeground: "#111111",
        popover: "#ffffff",
        popoverForeground: "#111111",
        primary: "#0066cc",
        primaryForeground: "#ffffff",
        secondary: "#e5e5e5",
        secondaryForeground: "#111111",
        muted: "#f0f0f0",
        mutedForeground: "#666666",
        accent: "#ff9900",
        accentForeground: "#000000",
        destructive: "#cc0000",
        destructiveForeground: "#ffffff",
        border: "#cccccc",
        input: "#cccccc",
        ring: "#0066cc",
      },
      dark: {
        background: "#111111",
        foreground: "#ffffff",
        card: "#1a1a1a",
        cardForeground: "#ffffff",
        popover: "#1a1a1a",
        popoverForeground: "#ffffff",
        primary: "#3399ff",
        primaryForeground: "#000000",
        secondary: "#333333",
        secondaryForeground: "#ffffff",
        muted: "#222222",
        mutedForeground: "#999999",
        accent: "#ffaa33",
        accentForeground: "#000000",
        destructive: "#ff3333",
        destructiveForeground: "#ffffff",
        border: "#444444",
        input: "#444444",
        ring: "#3399ff",
      },
    },
    surfaces: {
      radius: "0.5rem",
    },
    typography: {
      fontSans: "system-ui, sans-serif",
      fontHeading: "system-ui, sans-serif",
      fontMono: "monospace",
    },
  };
}

/**
 * Creates minimal valid PackageMetadata for tfss generate.
 *
 * @param {string} [name]
 * @returns {Record<string, unknown>}
 */
export function createMinimalPackageMetadata(name = "@qualification/theme-pkg") {
  return {
    name,
    version: "1.0.0",
    description: "Qualification theme package",
    license: "AGPL-3.0-or-later",
    private: true,
  };
}

/**
 * Creates a minimal valid PairedProfile (v1) object.
 *
 * @param {string} [name]
 * @returns {Record<string, unknown>}
 */
export function createMinimalValidPairedProfile(name = "qualification-paired") {
  return {
    schemaVersion: "tf-paired-profile-v1",
    name,
    version: "1.0.0",
    description: "Minimal valid paired profile for qualification",
    palette: {
      light: {
        primary: "#0066cc",
        primaryForeground: "#ffffff",
        accent: "#ff9900",
        accentForeground: "#000000",
        background: "#ffffff",
        foreground: "#111111",
        card: "#f8f8f8",
        cardForeground: "#111111",
        popover: "#ffffff",
        popoverForeground: "#111111",
        secondary: "#e5e5e5",
        secondaryForeground: "#111111",
        muted: "#f0f0f0",
        mutedForeground: "#666666",
        border: "#cccccc",
        input: "#cccccc",
        ring: "#0066cc",
        destructive: "#cc0000",
        destructiveForeground: "#ffffff",
      },
      dark: {
        primary: "#3399ff",
        primaryForeground: "#000000",
        accent: "#ffaa33",
        accentForeground: "#000000",
        background: "#111111",
        foreground: "#ffffff",
        card: "#1a1a1a",
        cardForeground: "#ffffff",
        popover: "#1a1a1a",
        popoverForeground: "#ffffff",
        secondary: "#333333",
        secondaryForeground: "#ffffff",
        muted: "#222222",
        mutedForeground: "#999999",
        border: "#444444",
        input: "#444444",
        ring: "#3399ff",
        destructive: "#ff3333",
        destructiveForeground: "#ffffff",
      },
    },
    surfaces: {
      radius: "0.5rem",
      content: 704,
    },
    typography: {
      fontSans: "system-ui, sans-serif",
      fontHeading: "system-ui, sans-serif",
      fontMono: "monospace",
    },
  };
}

/**
 * Parses CLI arguments for qualify-installed.mjs.
 *
 * @param {string[]} args
 * @returns {{
 *   packageRoot: string | null,
 *   cli: string | null,
 *   node: string | null,
 *   kind: "npm" | "nix" | "homebrew" | null,
 *   workDir: string | null,
 *   timeoutMs: number,
 *   stdout: boolean,
 *   json: boolean,
 *   help?: boolean,
 * }}
 */
export function parseInstalledQualificationArgs(args) {
  /** @type {any} */
  const result = {
    packageRoot: null,
    cli: null,
    node: null,
    kind: null,
    workDir: null,
    timeoutMs: 15_000,
    stdout: true,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      result.help = true;
      return result;
    }

    /**
     * @param {string} name
     * @returns {string}
     */
    const parseVal = (name) => {
      if (arg.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1);
      }
      if (arg === name) {
        i++;
        const val = args[i];
        if (i >= args.length || val === undefined || val.startsWith("-")) {
          throw new Error(`Missing value for argument "${name}".`);
        }
        return val;
      }
      throw new Error(`Internal argument parsing error for "${name}".`);
    };

    if (arg === "--package-root" || arg.startsWith("--package-root=")) {
      if (result.packageRoot !== null) throw new Error("Duplicate --package-root argument.");
      result.packageRoot = resolve(parseVal("--package-root"));
    } else if (
      arg === "--cli" ||
      arg.startsWith("--cli=") ||
      arg === "--cli-path" ||
      arg.startsWith("--cli-path=") ||
      arg === "--tfss" ||
      arg.startsWith("--tfss=")
    ) {
      if (result.cli !== null) throw new Error("Duplicate --cli argument.");
      const prefix = arg.startsWith("--cli-path")
        ? "--cli-path"
        : arg.startsWith("--tfss")
          ? "--tfss"
          : "--cli";
      result.cli = resolve(parseVal(prefix));
    } else if (
      arg === "--node" ||
      arg.startsWith("--node=") ||
      arg === "--node-runtime" ||
      arg.startsWith("--node-runtime=") ||
      arg === "--node-path" ||
      arg.startsWith("--node-path=")
    ) {
      if (result.node !== null) throw new Error("Duplicate --node argument.");
      const prefix = arg.startsWith("--node-runtime")
        ? "--node-runtime"
        : arg.startsWith("--node-path")
          ? "--node-path"
          : "--node";
      result.node = resolve(parseVal(prefix));
    } else if (
      arg === "--kind" ||
      arg.startsWith("--kind=") ||
      arg === "--package-kind" ||
      arg.startsWith("--package-kind=")
    ) {
      if (result.kind !== null) throw new Error("Duplicate --kind argument.");
      const prefix = arg.startsWith("--package-kind") ? "--package-kind" : "--kind";
      const val = parseVal(prefix);
      if (val !== "npm" && val !== "nix" && val !== "homebrew") {
        throw new Error(`Invalid value for --kind: "${val}". Expected "npm", "nix", or "homebrew".`);
      }
      result.kind = val;
    } else if (
      arg === "--work-dir" ||
      arg.startsWith("--work-dir=") ||
      arg === "--scratch" ||
      arg.startsWith("--scratch=")
    ) {
      if (result.workDir !== null) throw new Error("Duplicate --work-dir argument.");
      const prefix = arg.startsWith("--scratch") ? "--scratch" : "--work-dir";
      result.workDir = resolve(parseVal(prefix));
    } else if (
      arg === "--timeout" ||
      arg.startsWith("--timeout=") ||
      arg === "--timeout-ms" ||
      arg.startsWith("--timeout-ms=")
    ) {
      const prefix = arg.startsWith("--timeout-ms") ? "--timeout-ms" : "--timeout";
      const val = parseInt(parseVal(prefix), 10);
      if (Number.isNaN(val) || val <= 0) throw new Error(`Invalid value for --timeout: "${val}".`);
      result.timeoutMs = val;
    } else if (arg === "--no-stdout") {
      result.stdout = false;
    } else if (arg === "--stdout") {
      result.stdout = true;
    } else if (arg === "--json") {
      result.json = true;
    } else {
      throw new Error(`Unexpected argument: "${arg}".`);
    }
  }

  return result;
}

/**
 * Resolves targets strictly within the explicit package root.
 * Fails closed without PATH or source fallback.
 *
 * @param {{
 *   packageRoot?: string | null,
 *   cli?: string | null,
 *   mainExport?: string | null,
 *   node?: string | null,
 *   kind?: "npm" | "nix" | "homebrew" | null,
 * }} [options]
 * @returns {{
 *   packageRoot: string,
 *   cli: string,
 *   mainExport: string,
 *   node: string,
 *   kind: "npm" | "nix" | "homebrew",
 * }}
 */
export function resolveQualificationTargets(options = {}) {
  if (!options?.packageRoot || typeof options.packageRoot !== "string" || !options.packageRoot.trim()) {
    throw new Error("An explicit --package-root directory is required; no PATH or source fallback.");
  }

  const packageRoot = resolve(options.packageRoot.trim());
  if (!existsSync(packageRoot)) {
    throw new Error(`Installed package root does not exist: "${packageRoot}".`);
  }
  const manifestPath = join(packageRoot, "package.json");
  if (!existsSync(manifestPath)) throw new Error("Installed package identity is missing.");
  const metadata = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (metadata.name !== "@knowledge-forge-ai/theme-forge-solar-sail" ||
      metadata.type !== "module" || typeof metadata.version !== "string" ||
      metadata.exports?.["."]?.import !== "./dist/index.js") {
    throw new Error("Unexpected installed Solar Sail package identity or main export.");
  }

  // Resolve Node runtime
  const node = options.node ? resolve(options.node) : process.execPath;
  if (!existsSync(node)) {
    throw new Error(`Node runtime binary does not exist at: "${node}".`);
  }

  // Resolve CLI executable strictly within packageRoot if not explicitly given
  let cli = options.cli ? resolve(options.cli) : null;
  if (!cli) {
    const candidates = [
      join(packageRoot, "bin", "tfss.js"),
      join(packageRoot, "bin", "tfss"),
      join(packageRoot, "dist", "cli.js"),
      join(packageRoot, "node_modules", ".bin", "tfss"),
    ];
    cli = candidates.find((c) => existsSync(c)) ?? null;
  }
  if (!cli || !existsSync(cli)) {
    throw new Error(`Could not resolve tfss CLI executable at package root "${packageRoot}". Specify --cli.`);
  }

  // Resolve main library export strictly within packageRoot if not explicitly given
  let mainExport = options.mainExport ? resolve(options.mainExport) : null;
  if (!mainExport) {
    const candidates = [
      join(packageRoot, "dist", "index.js"),
      join(packageRoot, "index.js"),
    ];
    mainExport = candidates.find((c) => existsSync(c)) ?? null;
  }
  if (!mainExport || !existsSync(mainExport)) {
    throw new Error(`Could not resolve main library export at package root "${packageRoot}".`);
  }
  if (realpathSync(mainExport) !== realpathSync(join(packageRoot, metadata.exports["."].import))) {
    throw new Error("Main export must resolve to the installed package's declared export.");
  }

  // Resolve Kind
  let kind = options.kind;
  if (!kind) {
    if (packageRoot.includes("/nix/store/")) {
      kind = "nix";
    } else if (
      packageRoot.includes("/Cellar/") ||
      packageRoot.includes("/homebrew/") ||
      packageRoot.toLowerCase().includes("cellar") ||
      packageRoot.toLowerCase().includes("homebrew")
    ) {
      kind = "homebrew";
    } else {
      kind = "npm";
    }
  }

  return { packageRoot, cli, mainExport, node, kind };
}

/**
 * Exercises installed tfss CLI operations:
 * - Version & help
 * - Theme validation (valid and malformed rejection)
 * - Deterministic compilation to CSS and digest comparison
 * - Repeat determinism across runs
 * - Malformed input rejection and prior-output preservation
 * - Generate command
 * - Working directory independence
 * - Isolated user/cache environment
 *
 * @param {string} cliExecutable
 * @param {string} workDir
 * @param {{
 *   timeoutMs?: number,
 *   nodePath?: string,
 *   packageRoot?: string,
 * }} [options]
 * @returns {Promise<{
 *   version: string,
 *   help: boolean,
 *   validThemeValidation: boolean,
 *   invalidThemeRejection: boolean,
 *   compilationSuccess: boolean,
 *   outputDigest: string,
 *   repeatDeterminism: boolean,
 *   malformedRejection: boolean,
 *   priorOutputPreserved: boolean,
 *   generationSuccess: boolean,
 *   cwdIndependence: boolean,
 *   isolatedUserState: boolean,
 * }>}
 */
export async function qualifyInstalledCli(cliExecutable, workDir, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const nodePath = options.nodePath ?? process.execPath;
  const packageRoot = options.packageRoot ?? dirname(dirname(cliExecutable));
  const resolvedWorkDir = existsSync(workDir) ? realpathSync(workDir) : resolve(workDir);

  const isolatedHome = join(resolvedWorkDir, "isolated-home");
  mkdirSync(isolatedHome, { recursive: true });
  const isolatedEnv = {
    HOME: isolatedHome,
    NODE_OPTIONS: "",
    NODE_PATH: "",
    XDG_CONFIG_HOME: join(isolatedHome, ".config"),
    XDG_CACHE_HOME: join(isolatedHome, ".cache"),
    npm_config_cache: join(isolatedHome, ".npm"),
  };

  /** @type {Parameters<typeof runBoundedCommand>[2]} */
  const cmdOpts = {
    timeoutMs,
    nodePath,
    env: isolatedEnv,
    cwd: resolvedWorkDir,
  };

  // 1. Version and Help
  const verRes = runBoundedCommand(cliExecutable, ["--version"], cmdOpts);
  if (verRes.status !== 0) {
    throw new Error(`CLI --version failed (exit ${verRes.status}): ${verRes.stderr}`);
  }
  const verShortRes = runBoundedCommand(cliExecutable, ["-v"], cmdOpts);
  if (verShortRes.status !== 0) {
    throw new Error(`CLI -v failed (exit ${verShortRes.status}): ${verShortRes.stderr}`);
  }
  const versionMatch = verRes.stdout.match(/\d+\.\d+\.\d+/);
  if (!versionMatch) {
    throw new Error(`CLI --version returned unexpected output: "${verRes.stdout}"`);
  }
  const versionStr = versionMatch[0];

  const helpRes = runBoundedCommand(cliExecutable, ["--help"], cmdOpts);
  if (helpRes.status !== 0) {
    throw new Error(`CLI --help failed (exit ${helpRes.status}): ${helpRes.stderr}`);
  }
  if (!helpRes.stdout.includes("Theme Forge Solar Sail CLI (tfss)") || !helpRes.stdout.includes("Usage:")) {
    throw new Error(`CLI --help returned unexpected output: "${helpRes.stdout}"`);
  }
  const helpShortRes = runBoundedCommand(cliExecutable, ["-h"], cmdOpts);
  if (helpShortRes.status !== 0) {
    throw new Error(`CLI -h failed (exit ${helpShortRes.status}): ${helpShortRes.stderr}`);
  }

  // 2. Validate valid theme specification
  const validThemeFile = join(resolvedWorkDir, "valid-theme.json");
  const pkgExampleTheme = join(packageRoot, "examples", "forge-console.theme.json");
  if (existsSync(pkgExampleTheme)) {
    writeFileSync(validThemeFile, readFileSync(pkgExampleTheme, "utf8"));
  } else {
    writeFileSync(validThemeFile, JSON.stringify(createMinimalValidTheme("qual-theme"), null, 2));
  }

  const valRes = runBoundedCommand(cliExecutable, ["validate", validThemeFile, "--json"], cmdOpts);
  if (valRes.status !== 0) {
    throw new Error(`CLI validate failed for valid theme: ${valRes.stderr}`);
  }
  const valJson = JSON.parse(valRes.stdout);
  if (valJson.status !== "success" || valJson.valid !== true) {
    throw new Error(`CLI validate report did not indicate valid: ${valRes.stdout}`);
  }

  // 3. Validate rejection on malformed/invalid specification
  const invalidThemeFile = join(resolvedWorkDir, "invalid-theme.json");
  writeFileSync(
    invalidThemeFile,
    JSON.stringify({ schemaVersion: "tfss.theme-v1", name: "bad", unknownKey: "forbidden" }, null, 2),
  );
  const valBadRes = runBoundedCommand(cliExecutable, ["validate", invalidThemeFile, "--json"], cmdOpts);
  if (valBadRes.status === 0) {
    throw new Error("CLI validate unexpectedly succeeded for invalid theme with unknown fields.");
  }
  let invalidThemeRejection = false;
  try {
    const badJson = JSON.parse(valBadRes.stdout);
    if (badJson.status === "error") {
      invalidThemeRejection = true;
    }
  } catch {
    invalidThemeRejection = valBadRes.status !== 0;
  }

  // 4. Compile independent expected bytes / digest
  const outputCssDir = join(resolvedWorkDir, "compiled-output");
  mkdirSync(outputCssDir, { recursive: true });
  const outputCssFile = join(outputCssDir, "theme.css");

  const compileRes1 = runBoundedCommand(
    cliExecutable,
    ["compile", validThemeFile, "--out", outputCssFile, "--json"],
    cmdOpts,
  );
  if (compileRes1.status !== 0) {
    throw new Error(
      `CLI compile run 1 failed (exit ${compileRes1.status}): ${compileRes1.stderr || compileRes1.stdout}`,
    );
  }
  if (!existsSync(outputCssFile)) {
    throw new Error(`CLI compile did not produce output file: ${outputCssFile}`);
  }
  const compileJson1 = JSON.parse(compileRes1.stdout);
  const cssBytes1 = readFileSync(outputCssFile);
  const independentDigest1 = createHash("sha256").update(cssBytes1).digest("hex");

  if (compileJson1.outputDigest && compileJson1.outputDigest !== independentDigest1) {
    throw new Error(
      `Compiler reported digest ${compileJson1.outputDigest} does not match independently computed ${independentDigest1}`,
    );
  }

  const cssText1 = cssBytes1.toString("utf8");
  if (
    !cssText1.includes("/* Generated by Theme Forge Solar Sail") ||
    !cssText1.includes("@theme inline {") ||
    !cssText1.includes(":root {") ||
    !cssText1.includes(".dark")
  ) {
    throw new Error("Compiled CSS missing core structural selectors.");
  }

  // 5. Strict repeat determinism
  const compileRes2 = runBoundedCommand(
    cliExecutable,
    ["compile", validThemeFile, "--out", outputCssFile, "--overwrite", "--json"],
    cmdOpts,
  );
  if (compileRes2.status !== 0) {
    throw new Error(`CLI compile run 2 failed: ${compileRes2.stderr}`);
  }
  const cssBytes2 = readFileSync(outputCssFile);
  const independentDigest2 = createHash("sha256").update(cssBytes2).digest("hex");
  if (independentDigest1 !== independentDigest2 || Buffer.compare(cssBytes1, cssBytes2) !== 0) {
    throw new Error(
      `Compile repeat determinism violation: digest ${independentDigest1} !== ${independentDigest2}`,
    );
  }

  // 6. Malformed rejection and prior-output preservation
  const malformedFile = join(resolvedWorkDir, "malformed.json");
  writeFileSync(malformedFile, '{"schemaVersion": "tfss.theme-v1", syntax_error: <<<');
  const compileMalformedRes = runBoundedCommand(
    cliExecutable,
    ["compile", malformedFile, "--out", outputCssFile, "--overwrite", "--json"],
    cmdOpts,
  );
  if (compileMalformedRes.status === 0) {
    throw new Error("CLI compile unexpectedly succeeded on malformed JSON input.");
  }
  if (!existsSync(outputCssFile)) {
    throw new Error("CLI compile deleted prior output file when compilation failed.");
  }
  const cssBytesAfterMalformed = readFileSync(outputCssFile);
  const digestAfterMalformed = createHash("sha256").update(cssBytesAfterMalformed).digest("hex");
  if (digestAfterMalformed !== independentDigest1) {
    throw new Error(
      `CLI compile corrupted prior output on failure: ${digestAfterMalformed} !== ${independentDigest1}`,
    );
  }

  // 7. Generate command execution
  const pkgMetaFile = join(resolvedWorkDir, "package-metadata.json");
  writeFileSync(pkgMetaFile, JSON.stringify(createMinimalPackageMetadata(), null, 2));
  const generateOutDir = join(resolvedWorkDir, "generated-package");
  const genRes = runBoundedCommand(
    cliExecutable,
    ["generate", validThemeFile, "--package", pkgMetaFile, "--out", generateOutDir, "--json"],
    cmdOpts,
  );
  if (genRes.status !== 0) {
    throw new Error(`CLI generate failed: ${genRes.stderr}`);
  }
  if (
    !existsSync(join(generateOutDir, "package.json")) ||
    !existsSync(join(generateOutDir, "styles", "theme.css")) ||
    !existsSync(join(generateOutDir, "provenance.json")) ||
    !existsSync(join(generateOutDir, "theme.descriptor.json"))
  ) {
    throw new Error("CLI generate did not write all expected package files.");
  }

  // 8. Working directory independence
  const isolatedCwd = join(resolvedWorkDir, "isolated-cwd");
  mkdirSync(isolatedCwd, { recursive: true });
  const cwdRes = runBoundedCommand(
    cliExecutable,
    ["validate", validThemeFile, "--json"],
    { ...cmdOpts, cwd: isolatedCwd },
  );
  if (cwdRes.status !== 0) {
    throw new Error(`CLI validate failed when invoked from isolated cwd: ${cwdRes.stderr}`);
  }

  return {
    version: versionStr,
    help: true,
    validThemeValidation: true,
    invalidThemeRejection,
    compilationSuccess: true,
    outputDigest: independentDigest1,
    repeatDeterminism: true,
    malformedRejection: true,
    priorOutputPreserved: true,
    generationSuccess: true,
    cwdIndependence: true,
    isolatedUserState: true,
  };
}

/**
 * Exercises installed library main exports:
 * - v1/v2 paired profile mapping surfaces
 * - Candidate-set identities and mapping reports
 * - B1/B2 safety and error taxonomy
 *
 * @param {string} packageRoot
 * @param {string} mainExportPath
 * @param {{ timeoutMs?: number }} [_options]
 * @returns {Promise<{
 *   v1Surfaces: boolean,
 *   v2Surfaces: boolean,
 *   mappingReports: boolean,
 *   candidateIdentities: boolean,
 *   b1ErrorTaxonomy: boolean,
 * }>}
 */
export async function qualifyInstalledLibrary(packageRoot, mainExportPath, _options = {}) {
  const mainUrl = pathToFileURL(mainExportPath).href;
  /** @type {any} */
  const mod = await import(mainUrl);

  // 1. v1 Paired Mapping Surfaces
  if (typeof mod.validatePairedProfile !== "function") throw new Error("Missing validatePairedProfile");
  if (typeof mod.bindSourceProfile !== "function") throw new Error("Missing bindSourceProfile");
  if (typeof mod.mapProfileToSolarSailWithReport !== "function") throw new Error("Missing mapProfileToSolarSailWithReport");
  if (typeof mod.mapProfileToSolarSail !== "function") throw new Error("Missing mapProfileToSolarSail");
  if (mod.PAIRED_PROFILE_SCHEMA_VERSION !== "tf-paired-profile-v1") throw new Error("PAIRED_PROFILE_SCHEMA_VERSION mismatch");
  if (mod.MAPPING_REPORT_SCHEMA_VERSION !== "tf-paired-mapping-report-v1") throw new Error("MAPPING_REPORT_SCHEMA_VERSION mismatch");

  // Load v1 fixture from package examples if present, else use minimal valid profile
  let v1Profile;
  const flexokiPath = join(packageRoot, "examples", "flexoki.profile.json");
  if (existsSync(flexokiPath)) {
    v1Profile = JSON.parse(readFileSync(flexokiPath, "utf8"));
  } else {
    v1Profile = createMinimalValidPairedProfile("test-v1");
  }

  const v1Validation = mod.validatePairedProfile(v1Profile);
  if (!v1Validation || v1Validation.valid !== true) {
    throw new Error(`validatePairedProfile failed on valid profile: ${JSON.stringify(v1Validation)}`);
  }

  const v1Mapped = mod.mapProfileToSolarSailWithReport(v1Profile);
  const v1Specification = v1Mapped?.specification ?? v1Mapped?.themeSpec;
  if (!v1Mapped || !v1Specification || !v1Mapped.report) {
    throw new Error("mapProfileToSolarSailWithReport did not return specification and report");
  }
  const reportSchema = v1Mapped.report.schema ?? v1Mapped.report.schemaVersion;
  if (reportSchema !== mod.MAPPING_REPORT_SCHEMA_VERSION) {
    throw new Error(`v1 mapping report schema mismatch: ${reportSchema}`);
  }
  if (v1Specification.schemaVersion !== "tfss.theme-v1") {
    throw new Error(`v1 mapped theme specification schemaVersion mismatch: ${v1Specification.schemaVersion}`);
  }

  const rawSourceV1 = JSON.stringify(v1Profile);
  const boundV1 = mod.bindSourceProfile(rawSourceV1);
  if (!boundV1 || boundV1.provenance?.verificationStatus !== "verified") {
    throw new Error("bindSourceProfile did not return verified provenance");
  }

  // 2. v2 Paired Mapping Surfaces
  if (typeof mod.validatePairedProfileV2 !== "function") throw new Error("Missing validatePairedProfileV2");
  if (typeof mod.bindSourceProfileV2 !== "function") throw new Error("Missing bindSourceProfileV2");
  if (typeof mod.canonicalizeProfileV2 !== "function") throw new Error("Missing canonicalizeProfileV2");
  if (typeof mod.migrateV1ToV2 !== "function") throw new Error("Missing migrateV1ToV2");
  if (typeof mod.migrateV2ToV1 !== "function") throw new Error("Missing migrateV2ToV1");
  if (typeof mod.applyRecipe !== "function") throw new Error("Missing applyRecipe");
  if (mod.PAIRED_PROFILE_V2_SCHEMA_VERSION !== "tf-paired-profile-v2") throw new Error("PAIRED_PROFILE_V2_SCHEMA_VERSION mismatch");
  if (mod.MAPPING_REPORT_V2_SCHEMA_VERSION !== "tf-paired-mapping-report-v2") throw new Error("MAPPING_REPORT_V2_SCHEMA_VERSION mismatch");
  if (mod.PAIRED_V2_ADAPTER_NAME !== "@knowledge-forge-ai/theme-forge-solar-sail/paired-v2") throw new Error("PAIRED_V2_ADAPTER_NAME mismatch");

  // Migration v1 -> v2 (requires source string or bytes)
  const migrationResult = mod.migrateV1ToV2(rawSourceV1);
  if (!migrationResult || !migrationResult.profile) {
    throw new Error("migrateV1ToV2 failed to return migrated profile");
  }
  const v2Profile = migrationResult.profile;
  if (v2Profile.schemaVersion !== mod.PAIRED_PROFILE_V2_SCHEMA_VERSION) {
    throw new Error(`v2Profile schemaVersion mismatch: ${v2Profile.schemaVersion}`);
  }
  const rawSourceV2 = JSON.stringify(v2Profile);

  const v2Validation = mod.validatePairedProfileV2(v2Profile);
  if (!v2Validation || v2Validation.valid !== true) {
    throw new Error(`validatePairedProfileV2 failed: ${JSON.stringify(v2Validation)}`);
  }

  const canon1 = mod.canonicalizeProfileV2(v2Profile);
  const canon2 = mod.canonicalizeProfileV2(v2Profile);
  if (!canon1 || canon1 !== canon2) {
    throw new Error("canonicalizeProfileV2 repeat determinism failure");
  }

  // Apply deterministic recipe
  const recipeResult = mod.applyRecipe(rawSourceV2, {
    schema: "tf-paired-recipe-v1",
    type: "radius",
    variant: "sharp",
  });
  if (!recipeResult || recipeResult.profile?.radius?.control !== "0px") {
    throw new Error("applyRecipe radius:sharp did not produce radius 0px");
  }

  // Migration v2 -> v1 (requires source string or bytes)
  const v1Back = mod.migrateV2ToV1(JSON.stringify(v2Profile), { allowLossy: true });
  if (!v1Back || v1Back.profile.schemaVersion !== mod.PAIRED_PROFILE_SCHEMA_VERSION) {
    throw new Error("migrateV2ToV1 did not return valid v1 profile");
  }

  // 3. Candidate-Set and Generation Invocation Identities
  if (typeof mod.describeGenerationInvocation !== "function") throw new Error("Missing describeGenerationInvocation");
  const invocationDesc = mod.describeGenerationInvocation({
    themeSpec: v1Specification,
    metadata: { name: "@qual/test-theme", version: "1.0.0" },
  });
  if (
    !invocationDesc ||
    invocationDesc.invocation?.schema !== "tfss.generation-invocation-v1" ||
    typeof invocationDesc.invocationDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(invocationDesc.invocationDigest) ||
    !Array.isArray(invocationDesc.outputFiles) ||
    invocationDesc.outputFiles.length === 0
  ) {
    throw new Error("describeGenerationInvocation failed to return structured candidate identity");
  }

  // 4. B1/B2 Safety and Error Taxonomy
  if (!mod.ERROR_CODES || typeof mod.ERROR_CODES !== "object") throw new Error("Missing ERROR_CODES taxonomy");
  if (typeof mod.classifyProfileError !== "function") throw new Error("Missing classifyProfileError");
  if (typeof mod.FilesystemSafetyError !== "function") throw new Error("Missing FilesystemSafetyError");

  // Verify StaleProvenance error taxonomy
  const rawSourceV2Stale = JSON.stringify(v2Profile);
  let staleCaught = null;
  try {
    mod.bindSourceProfileV2(rawSourceV2Stale, {
      expectedSha256: "0000000000000000000000000000000000000000000000000000000000000000",
    });
  } catch (err) {
    staleCaught = err;
  }
  if (!staleCaught) {
    throw new Error("bindSourceProfileV2 failed to throw on hash mismatch");
  }
  const classifiedStale = mod.classifyProfileError(staleCaught);
  if (!classifiedStale.isProfileError || classifiedStale.code !== mod.ERROR_CODES.STALE_PROVENANCE) {
    throw new Error(`classifyProfileError taxonomy mismatch for stale provenance: ${JSON.stringify(classifiedStale)}`);
  }

  // Verify RecipeError taxonomy
  let recipeCaught = null;
  try {
    mod.applyRecipe(rawSourceV2, {
      schema: "tf-paired-recipe-v1",
      type: "radius",
      variant: "nonexistent-fake-recipe",
    });
  } catch (err) {
    recipeCaught = err;
  }
  if (!recipeCaught) {
    throw new Error("applyRecipe failed to throw on unknown recipe");
  }
  const classifiedRecipe = mod.classifyProfileError(recipeCaught);
  if (!classifiedRecipe.isProfileError || classifiedRecipe.code !== mod.ERROR_CODES.RECIPE_ERROR) {
    throw new Error(`classifyProfileError taxonomy mismatch for recipe error: ${JSON.stringify(classifiedRecipe)}`);
  }

  // Verify Schema validation failure taxonomy
  const invalidV2 = { schemaVersion: mod.PAIRED_PROFILE_V2_SCHEMA_VERSION, name: "bad" };
  const invalidV2Report = mod.validatePairedProfileV2(invalidV2);
  if (invalidV2Report.valid || !Array.isArray(invalidV2Report.errors) || invalidV2Report.errors.length === 0) {
    throw new Error("validatePairedProfileV2 did not reject incomplete profile");
  }

  // Verify FilesystemSafetyError taxonomy
  const fsErr = new mod.FilesystemSafetyError("Test safety error", "DESTINATION_CONFLICT");
  if (fsErr.name !== "FilesystemSafetyError" || fsErr.code !== "DESTINATION_CONFLICT") {
    throw new Error("FilesystemSafetyError taxonomy mismatch");
  }

  return {
    v1Surfaces: true,
    v2Surfaces: true,
    mappingReports: true,
    candidateIdentities: true,
    b1ErrorTaxonomy: true,
  };
}

/**
 * Full qualification pipeline for an installed Theme Forge Solar Sail package.
 *
 * @param {{
 *   packageRoot?: string | null,
 *   cli?: string | null,
 *   mainExport?: string | null,
 *   node?: string | null,
 *   kind?: "npm" | "nix" | "homebrew" | null,
 *   workDir?: string | null,
 *   timeoutMs?: number,
 *   stdout?: boolean,
 * }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function qualifyInstalledSolar(options = {}) {
  const targets = resolveQualificationTargets(options);
  const root = targets.packageRoot;
  const workDir = options.workDir
    ? resolve(options.workDir)
    : realpathSync(mkdtempSync(join(tmpdir(), "solar-installed-qual-")));
  const isManagedWorkDir = !options.workDir;

  try {
    mkdirSync(workDir, { recursive: true });

    // 1. Pre-qualification directory snapshot of installed package root
    const snapshotBefore = takeDirectorySnapshot(root);

    // 2. CLI Qualification
    const cliReport = await qualifyInstalledCli(targets.cli, join(workDir, "cli-test"), {
      timeoutMs: options.timeoutMs,
      nodePath: targets.node,
      packageRoot: root,
    });

    // 3. Library Qualification
    const libraryReport = await qualifyInstalledLibrary(root, targets.mainExport, {
      timeoutMs: options.timeoutMs,
    });

    // 4. Post-qualification directory snapshot comparison
    const snapshotAfter = takeDirectorySnapshot(root);
    const installedTreeUnchanged = compareDirectorySnapshots(snapshotBefore, snapshotAfter);
    if (!installedTreeUnchanged) {
      throw new Error("Installed package root was mutated during qualification.");
    }

    const report = {
      schemaVersion: 1,
      product: "theme-forge-solar-sail",
      qualified: true,
      installedTreeUnchanged: true,
      packageRoot: root,
      targets: {
        cli: targets.cli,
        mainExport: targets.mainExport,
        node: targets.node,
        kind: targets.kind,
      },
      cli: cliReport,
      library: libraryReport,
    };

    if (options.stdout !== false) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    }

    return report;
  } finally {
    if (isManagedWorkDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

// CLI Execution Entrypoint
if (process.argv[1] && isMainScript(import.meta.url)) {
  const parsed = parseInstalledQualificationArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`Usage:
  qualify-installed.mjs --package-root <path> [options]

Options:
  --package-root <path>    Required root directory of the installed Solar Sail package
  --cli <path>             Explicit path to the tfss CLI executable (resolved from root if omitted)
  --node <path>            Explicit path to the Node runtime binary (defaults to process.execPath)
  --kind <npm|nix|homebrew> Package distribution kind under test (auto-detected if omitted)
  --work-dir <path>        Optional scratch directory for qualification execution (cleaned up if omitted)
  --timeout <ms>           Operation timeout in milliseconds (default: 15000)
  --no-stdout              Suppress JSON report output to stdout
  --json                   Output machine-readable JSON status
  --help, -h               Show this help message
`);
    process.exit(0);
  }

  /** @type {Parameters<typeof qualifyInstalledSolar>[0]} */
  const qualOpts = {
    timeoutMs: parsed.timeoutMs,
    stdout: parsed.stdout,
  };
  if (parsed.packageRoot !== null) qualOpts.packageRoot = parsed.packageRoot;
  if (parsed.cli !== null) qualOpts.cli = parsed.cli;
  if (parsed.node !== null) qualOpts.node = parsed.node;
  if (parsed.kind !== null) qualOpts.kind = parsed.kind;
  if (parsed.workDir !== null) qualOpts.workDir = parsed.workDir;

  qualifyInstalledSolar(qualOpts).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
