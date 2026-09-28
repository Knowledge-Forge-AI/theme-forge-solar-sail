import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { COMPILER_NAME, COMPILER_VERSION } from "./types.js";
import { validateThemeSpecification, validatePackageMetadata } from "./validator.js";
import { compileTheme } from "./compiler.js";
import { generateThemePackage, writePackageFiles, FilesystemSafetyError } from "./emitter.js";
import { parseThemeJson } from "./input.js";
import { writeCssFile } from "./writer.js";

export type CliFailureCode = "ARGUMENT_ERROR" | "PARSE_ERROR" | "VALIDATION_ERROR" |
  "DIAGNOSTIC_FAILURE" | "UNSUPPORTED_INTENT" | "FILESYSTEM_SAFETY_ERROR" | "IO_ERROR" | "INTERNAL_ERROR";

class CliFailure extends Error {
  constructor(readonly code: CliFailureCode, message: string, readonly detail: Record<string, unknown> = {}) { super(message); }
}

/** Small stable taxonomy; arbitrary thrown values never masquerade as I/O failures. */
export function classifyCliFailure(error: unknown): CliFailureCode {
  if (error instanceof CliFailure) return error.code;
  if (error instanceof FilesystemSafetyError) return "FILESYSTEM_SAFETY_ERROR";
  if (error && typeof error === "object" && "code" in error &&
      typeof error.code === "string" && /^(ENOENT|EACCES|EPERM|ENOSPC|EIO|EMFILE|ENFILE|EROFS|EISDIR)$/.test(error.code)) return "IO_ERROR";
  return "INTERNAL_ERROR";
}

export const CLI_HELP = `
Theme Forge Solar Sail CLI (tfss) — Tailwind v4 & shadcn/ui application theme compiler

Usage:
  tfss validate <theme.json> [--json]
  tfss compile <theme.json> --out <file|dir> [--overwrite] [--json]
  tfss generate <theme.json> --package <package.json> --out <dir> [--language typescript|javascript] [--json]
  tfss --help | -h
  tfss --version | -v

Commands:
  validate <theme.json>
    Validate theme specification schema, token completeness, and color contrast.

  compile <theme.json> --out <destination>
    Compile theme specification into a standalone Tailwind v4 stylesheet.
    If --out is a directory, writes 'theme.css'. If --out ends with '.css', writes directly.

  generate <theme.json> --package <pkg> --out <dir>
    Generate an installable theme package with manifest, stylesheet, types, and provenance.
    Destination directory must be absent or empty.

Options:
  --out <path>         Output destination path
  --package <file>     Path to package metadata JSON file (required for generate)
  --language <lang>    Target integration language: 'typescript' or 'javascript' (default: 'javascript')
  --overwrite          Allow overwriting destination (compile only; forbidden for generate)
  --fail-on-diagnostics Fail when contrast diagnostics are present (opt-in)
  --json               Output machine-readable JSON status
  -h, --help           Show this help text
  -v, --version        Show version
`;

export async function runCli(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const isJson = args.includes("--json");
  const command = args[0];
  const emit = (result: Record<string, unknown>, human: string, failed = false) => {
    if (isJson) process.stdout.write(JSON.stringify(result) + "\n");
    else {
      // Preserve our line breaks, but never let input control the terminal.
      const safeHuman = human.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g,
        char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
      (failed ? process.stderr : process.stdout).write(safeHuman + "\n");
    }
  };
  const argument = (message: string): never => { throw new CliFailure("ARGUMENT_ERROR", message); };
  const readJson = async (path: string): Promise<unknown> => {
    const bytes = await readFile(path);
    try { return parseThemeJson(bytes); }
    catch (error) { throw new CliFailure("PARSE_ERROR", error instanceof Error ? error.message : "Invalid JSON input"); }
  };
  try {
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
      emit({ status: "success", command: "help", help: CLI_HELP }, CLI_HELP); return 0;
    }
    if (args.includes("--version") || args.includes("-v")) {
      emit({ status: "success", command: "version", name: COMPILER_NAME, version: COMPILER_VERSION }, `${COMPILER_NAME} v${COMPILER_VERSION}`); return 0;
    }
    if (!command || !["validate", "compile", "generate"].includes(command)) argument(`Unknown command: '${command}'. Run 'tfss --help' for usage.`);
    let inputPath: string | undefined;
    const options = new Map<string, string>();
    const flags = new Set<string>();
    for (let i = 1; i < args.length; i++) {
      const arg = args[i]!;
      if (["--json", "--overwrite", "--fail-on-diagnostics"].includes(arg)) {
        if (flags.has(arg)) argument(`Duplicate option '${arg}'.`);
        flags.add(arg);
      } else if (["--out", "--package", "--language"].includes(arg)) {
        if (options.has(arg)) argument(`Duplicate option '${arg}'.`);
        const value = args[++i];
        if (!value || value.startsWith("-")) argument(`Option '${arg}' requires a value.`);
        options.set(arg, value!);
      } else if (arg.startsWith("-")) argument(`Unknown option '${arg}'.`);
      else if (!inputPath) inputPath = arg;
      else argument(`Unexpected positional argument '${arg}'.`);
    }
    if (!inputPath) argument("Missing input theme specification file.");
    if (command !== "generate" && (options.has("--language") || options.has("--package"))) argument("--language and --package are only supported for generate.");
    if (command === "validate" && (options.has("--out") || flags.has("--overwrite"))) argument("--out and --overwrite are not supported for validate.");
    if (command !== "validate" && !options.has("--out")) argument("Missing required option '--out <destination>'.");
    if (command === "generate" && !options.has("--package")) argument("Missing required option '--package <package.json>'.");
    if (command === "generate" && flags.has("--overwrite")) argument("--overwrite is not permitted for generate. Destination must be absent or empty.");
    const language = options.get("--language") ?? "javascript";
    if (language !== "javascript" && language !== "typescript") argument("--language must be 'typescript' or 'javascript'.");
    const theme = await readJson(inputPath!);
    const validation = validateThemeSpecification(theme);
    if (!validation.valid || !validation.specification) {
      const unsupported = validation.diagnostics.some(d => /UNSUPPORTED|UNKNOWN_(KEY|FIELD|(?:COLOR_)?ROLE)/.test(d.code));
      throw new CliFailure(unsupported ? "UNSUPPORTED_INTENT" : "VALIDATION_ERROR", "Theme validation failed", { valid: false, errors: validation.errors, diagnostics: validation.diagnostics });
    }
    if (flags.has("--fail-on-diagnostics") && validation.diagnostics.length) throw new CliFailure("DIAGNOSTIC_FAILURE", "Contrast diagnostics require attention", { valid: true, errors: [], diagnostics: validation.diagnostics });
    if (command === "validate") {
      emit({ status: "success", command, valid: true, errors: [], diagnostics: validation.diagnostics }, `OK: Theme '${validation.specification.name}' v${validation.specification.version} is valid.\n${validation.diagnostics.map(d => `[${d.severity}] ${d.code}: ${d.message}`).join("\n")}`); return 0;
    }
    const diagnosticText = validation.diagnostics.map(d => `[${d.severity}] ${d.code}: ${d.message}`).join("\n");
    if (command === "compile") {
      const compilation = compileTheme(theme);
      const out = resolve(options.get("--out")!);
      const outputFile = out.endsWith(".css") ? out : resolve(out, "theme.css");
      await writeCssFile(outputFile, compilation.css, { overwrite: flags.has("--overwrite") });
      emit({ status: "success", command, outputFile, outputDigest: compilation.outputDigest, descriptor: compilation.descriptor }, `Compiled '${compilation.specification.name}' -> ${outputFile}\n${diagnosticText}`); return 0;
    }
    const metadataInput = await readJson(options.get("--package")!);
    let metadata;
    try { metadata = validatePackageMetadata(metadataInput); }
    catch (error) { throw new CliFailure("VALIDATION_ERROR", error instanceof Error ? error.message : "Invalid package metadata"); }
    const result = generateThemePackage({ themeSpec: theme, metadata, language: language as "javascript" | "typescript" });
    const outDir = resolve(options.get("--out")!);
    const filesWritten = await writePackageFiles(result.files, outDir);
    emit({ status: "success", command, outDir, filesWritten, descriptor: result.descriptor, provenance: result.provenance }, `Generated '${result.metadata.name}' -> ${outDir} (${filesWritten.length} files)\n${diagnosticText}`);
    return 0;
  } catch (error) {
    const code = classifyCliFailure(error);
    const message = error instanceof Error ? error.message : "Unexpected internal failure";
    const detail = error instanceof CliFailure ? error.detail : {};
    emit({ status: "error", command, code, message, ...detail }, `${code}: ${message}${Array.isArray(detail.errors) ? "\n" + detail.errors.join("\n") : ""}`, true);
    return 1;
  }
}
