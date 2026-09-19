import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { COMPILER_NAME, COMPILER_VERSION } from "./types.js";
import { validateThemeSpecification } from "./validator.js";
import { compileTheme } from "./compiler.js";
import { generateThemePackage, writePackageFiles, FilesystemSafetyError } from "./emitter.js";

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
  --json               Output machine-readable JSON status
  -h, --help           Show this help text
  -v, --version        Show version
`;

export async function runCli(argv: string[]): Promise<number> {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(CLI_HELP + "\n");
    return 0;
  }

  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${COMPILER_NAME} v${COMPILER_VERSION}\n`);
    return 0;
  }

  const isJson = args.includes("--json");
  const isOverwrite = args.includes("--overwrite");

  const command = args[0];
  if (!command || !["validate", "compile", "generate"].includes(command)) {
    process.stderr.write(`Unknown command: '${command}'. Run 'tfss --help' for usage.\n`);
    return 1;
  }

  // Parse positional and flag arguments
  let inputPath: string | undefined;
  const options = new Map<string, string>();

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json" || arg === "--overwrite") {
      continue;
    }
    if (arg === "--out" || arg === "--package" || arg === "--language") {
      const val = args[++i];
      if (!val || val.startsWith("-")) {
        process.stderr.write(`Error: Option '${arg}' requires a value.\n`);
        return 1;
      }
      options.set(arg, val);
    } else if (arg.startsWith("-")) {
      process.stderr.write(`Error: Unknown option '${arg}'.\n`);
      return 1;
    } else if (!inputPath) {
      inputPath = arg;
    } else {
      process.stderr.write(`Error: Unexpected positional argument '${arg}'.\n`);
      return 1;
    }
  }

  if (!inputPath) {
    process.stderr.write("Error: Missing input theme specification file.\n");
    return 1;
  }

  if (command !== "generate") {
    if (options.has("--language")) {
      process.stderr.write("Error: Option '--language' is only supported for the 'generate' command.\n");
      return 1;
    }
    if (options.has("--package")) {
      process.stderr.write("Error: Option '--package' is only supported for the 'generate' command.\n");
      return 1;
    }
  }
  if (command === "validate") {
    if (options.has("--out")) {
      process.stderr.write("Error: Option '--out' is not supported for the 'validate' command.\n");
      return 1;
    }
  }

  try {
    const rawTheme = await readFile(inputPath, "utf8");
    const themeJson = JSON.parse(rawTheme);

    if (command === "validate") {
      const validation = validateThemeSpecification(themeJson);
      if (isJson) {
        process.stdout.write(
          JSON.stringify(
            {
              status: validation.valid ? "success" : "error",
              command: "validate",
              valid: validation.valid,
              errors: validation.errors,
              diagnostics: validation.diagnostics,
            },
            null,
            2
          ) + "\n"
        );
      } else {
        if (validation.valid) {
          process.stdout.write(`OK: Theme '${themeJson.name}' v${themeJson.version} is valid.\n`);
          if (validation.diagnostics.length > 0) {
            process.stdout.write(`Diagnostics (${validation.diagnostics.length}):\n`);
            for (const d of validation.diagnostics) {
              process.stdout.write(`  [${d.severity.toUpperCase()}] ${d.code}: ${d.message}\n`);
            }
          }
        } else {
          process.stderr.write(`Validation failed with ${validation.errors.length} error(s):\n`);
          for (const err of validation.errors) {
            process.stderr.write(`  - ${err}\n`);
          }
        }
      }
      return validation.valid ? 0 : 1;
    }

    if (command === "compile") {
      const out = options.get("--out");
      if (!out) {
        process.stderr.write("Error: Missing required option '--out <destination>'.\n");
        return 1;
      }

      const compilation = compileTheme(themeJson);
      const absOut = resolve(out);
      const isCssFile = absOut.endsWith(".css");
      const targetFile = isCssFile ? absOut : resolve(absOut, "theme.css");

      await mkdir(dirname(targetFile), { recursive: true });
      await writeFile(targetFile, compilation.css, {
        flag: isOverwrite ? "w" : "wx",
      });

      if (isJson) {
        process.stdout.write(
          JSON.stringify(
            {
              status: "success",
              command: "compile",
              outputFile: targetFile,
              outputDigest: compilation.outputDigest,
              descriptor: compilation.descriptor,
            },
            null,
            2
          ) + "\n"
        );
      } else {
        process.stdout.write(
          `Compiled '${compilation.specification.name}' v${compilation.specification.version} -> ${targetFile} (digest: ${compilation.outputDigest})\n`
        );
      }
      return 0;
    }

    if (command === "generate") {
      const outDir = options.get("--out");
      const pkgPath = options.get("--package");
      const language = options.get("--language") as "typescript" | "javascript" | undefined;

      if (!outDir) {
        process.stderr.write("Error: Missing required option '--out <destination>'.\n");
        return 1;
      }
      if (!pkgPath) {
        process.stderr.write("Error: Missing required option '--package <package.json>'.\n");
        return 1;
      }
      if (language && !["typescript", "javascript"].includes(language)) {
        process.stderr.write(
          `Error: Invalid --language '${language}'. Must be 'typescript' or 'javascript'.\n`
        );
        return 1;
      }
      if (isOverwrite) {
        process.stderr.write(
          "Error: --overwrite is not permitted for generate. Theme packages must be written to an absent or empty directory.\n"
        );
        return 1;
      }

      const rawPkg = await readFile(pkgPath, "utf8");
      const metadataJson = JSON.parse(rawPkg);

      const result = generateThemePackage({
        themeSpec: themeJson,
        metadata: metadataJson,
        language: language ?? "javascript",
      });

      const absOutDir = resolve(outDir);
      const writtenFiles = await writePackageFiles(result.files, absOutDir);

      if (isJson) {
        process.stdout.write(
          JSON.stringify(
            {
              status: "success",
              command: "generate",
              outDir: absOutDir,
              filesWritten: writtenFiles,
              descriptor: result.descriptor,
              provenance: result.provenance,
            },
            null,
            2
          ) + "\n"
        );
      } else {
        process.stdout.write(
          `Generated package '${result.metadata.name}' v${result.metadata.version} -> ${absOutDir} (${writtenFiles.length} files, language: ${language ?? "javascript"})\n`
        );
      }
      return 0;
    }

    return 0;
  } catch (err: any) {
    if (err instanceof FilesystemSafetyError) {
      if (isJson) {
        process.stdout.write(
          JSON.stringify({ status: "error", code: "FILESYSTEM_SAFETY_ERROR", message: err.message }) +
            "\n"
        );
      } else {
        process.stderr.write(`Filesystem safety error: ${err.message}\n`);
      }
      return 1;
    }

    if (isJson) {
      process.stdout.write(
        JSON.stringify({ status: "error", code: "EXECUTION_ERROR", message: err.message }) + "\n"
      );
    } else {
      process.stderr.write(`Error: ${err.message}\n`);
    }
    return 1;
  }
}
