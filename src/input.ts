import { Buffer } from "node:buffer";
export class SafeDataError extends Error {
  readonly code: string;
  readonly path: string | undefined;

  constructor(message: string, code = "UNSAFE_DATA", path?: string | undefined) {
    super(path ? `${message} at '${path}'` : message);
    this.name = "SafeDataError";
    this.code = code;
    this.path = path;
  }
}

export const MAX_INPUT_BYTES = 1024 * 1024; // 1 MiB
export const MAX_NODES = 100_000;
export const MAX_DEPTH = 20;

const FORBIDDEN_PROPERTY_NAMES = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Validates input against getters/accessors, prototypes, functions, nonfinite numbers,
 * excessive depth, cycles, hidden/symbol properties, and dangerous patterns.
 * Ensures getters are NEVER invoked during inspection.
 */
export function assertSafeData(value: unknown, maxBytes = MAX_INPUT_BYTES): void {
  const ancestors = new Set<object>();
  let nodes = 0;
  let bytes = 0;

  function visit(val: unknown, depth: number, path: string): void {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) {
      throw new SafeDataError("Data complexity limit exceeded", "MAX_DEPTH_EXCEEDED", path || "root");
    }

    if (val === null || typeof val === "boolean") {
      return;
    }

    if (typeof val === "number") {
      if (!Number.isFinite(val)) {
        throw new SafeDataError("Nonfinite numbers are forbidden", "NONFINITE_NUMBER", path || "root");
      }
      return;
    }

    if (typeof val === "string") {
      bytes += Buffer.byteLength(val, "utf8");
      if (bytes > maxBytes) {
        throw new SafeDataError("Data exceeds maximum byte limit", "OVERSIZED_INPUT", path || "root");
      }
      return;
    }

    if (typeof val !== "object") {
      throw new SafeDataError(
        `Forbidden data type: ${typeof val}`,
        "FORBIDDEN_TYPE",
        path || "root"
      );
    }

    if (ancestors.has(val)) {
      throw new SafeDataError("Circular reference detected", "CIRCULAR_REFERENCE", path || "root");
    }

    const isArr = Array.isArray(val);
    const proto = Object.getPrototypeOf(val);

    if (isArr) {
      if (proto !== Array.prototype) {
        throw new SafeDataError("Invalid array prototype", "INVALID_PROTOTYPE", path || "root");
      }
    } else {
      if (proto !== Object.prototype && proto !== null) {
        throw new SafeDataError("Invalid object prototype", "INVALID_PROTOTYPE", path || "root");
      }
    }

    const symbols = Object.getOwnPropertySymbols(val);
    if (symbols.length > 0) {
      throw new SafeDataError("Symbol properties are forbidden", "FORBIDDEN_SYMBOL", path || "root");
    }

    const propNames = Object.getOwnPropertyNames(val);
    if (propNames.length > 20000 || (isArr && val.length > 20000)) {
      throw new SafeDataError("Collection limit exceeded", "OVERSIZED_INPUT", path || "root");
    }

    if (isArr && propNames.length !== val.length + 1) {
      throw new SafeDataError("Sparse or extended arrays forbidden", "INVALID_ARRAY", path || "root");
    }

    ancestors.add(val);

    for (const key of propNames) {
      if (isArr && key === "length") continue;

      const currentPath = path ? (isArr ? `${path}[${key}]` : `${path}.${key}`) : key;

      if (isArr && !/^(0|[1-9]\d*)$/.test(key)) {
        throw new SafeDataError("Array contains non-index property", "FORBIDDEN_PROPERTY", currentPath);
      }

      if (FORBIDDEN_PROPERTY_NAMES.has(key)) {
        throw new SafeDataError(`Forbidden property name '${key}'`, "FORBIDDEN_PROPERTY", currentPath);
      }

      bytes += Buffer.byteLength(key, "utf8");
      if (bytes > maxBytes) {
        throw new SafeDataError("Data exceeds maximum byte limit", "OVERSIZED_INPUT", currentPath);
      }

      // Check descriptor WITHOUT invoking getters!
      const desc = Object.getOwnPropertyDescriptor(val, key);
      if (!desc) {
        throw new SafeDataError("Unable to retrieve property descriptor", "INVALID_DESCRIPTOR", currentPath);
      }

      if (!desc.enumerable) {
        throw new SafeDataError(
          `Non-enumerable property '${key}' is forbidden`,
          "ACCESSOR_FORBIDDEN",
          currentPath
        );
      }

      if (!("value" in desc) || desc.get !== undefined || desc.set !== undefined) {
        throw new SafeDataError(
          `Accessor property '${key}' is forbidden`,
          "ACCESSOR_FORBIDDEN",
          currentPath
        );
      }

      visit(desc.value, depth + 1, currentPath);
    }

    ancestors.delete(val);
  }

  visit(value, 0, "");
}

class DuplicateFreeJsonParser {
  private i = 0;
  private depth = 0;

  constructor(private readonly source: string) {}

  parse(): unknown {
    this.ws();
    if (this.i >= this.source.length) {
      throw new SafeDataError("Unexpected end of JSON input", "INVALID_JSON");
    }
    const val = this.value();
    this.ws();
    if (this.i !== this.source.length) {
      throw new SafeDataError("Unexpected trailing characters after JSON value", "INVALID_JSON");
    }
    return val;
  }

  private ws(): void {
    while (this.i < this.source.length) {
      const c = this.source[this.i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        this.i++;
      } else {
        break;
      }
    }
  }

  private bad(msg = "Invalid JSON syntax"): never {
    throw new SafeDataError(msg, "INVALID_JSON");
  }

  private value(): unknown {
    this.ws();
    if (this.i >= this.source.length) {
      this.bad("Unexpected end of JSON input");
    }
    const ch = this.source[this.i];

    if (ch === "{") return this.object();
    if (ch === "[") return this.array();
    if (ch === '"') return this.string();

    if (this.source.startsWith("true", this.i)) {
      this.i += 4;
      return true;
    }
    if (this.source.startsWith("false", this.i)) {
      this.i += 5;
      return false;
    }
    if (this.source.startsWith("null", this.i)) {
      this.i += 4;
      return null;
    }

    const numMatch = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.source.slice(this.i));
    if (numMatch) {
      this.i += numMatch[0].length;
      const num = Number(numMatch[0]);
      if (!Number.isFinite(num)) {
        throw new SafeDataError("Nonfinite number in JSON", "NONFINITE_NUMBER");
      }
      return num;
    }

    this.bad(`Unexpected character '${ch}'`);
  }

  private string(): string {
    const start = this.i++;
    while (this.i < this.source.length) {
      const ch = this.source[this.i++]!;
      if (ch === '"') {
        try {
          return JSON.parse(this.source.slice(start, this.i)) as string;
        } catch {
          this.bad("Malformed string escape");
        }
      }
      if (ch === "\\") {
        if (this.i >= this.source.length) this.bad("Unterminated string escape");
        if (this.source[this.i] === "u") {
          this.i += 5;
        } else {
          this.i++;
        }
      } else if (ch.charCodeAt(0) < 0x20) {
        this.bad("Unescaped control character in string");
      }
    }
    this.bad("Unterminated string");
  }

  private object(): Record<string, unknown> {
    if (++this.depth > MAX_DEPTH) {
      throw new SafeDataError("JSON depth limit exceeded", "MAX_DEPTH_EXCEEDED");
    }
    this.i++; // skip '{'
    const out: Record<string, unknown> = Object.create(null);
    const seen = new Set<string>();

    this.ws();
    if (this.i < this.source.length && this.source[this.i] === "}") {
      this.i++;
      this.depth--;
      return Object.assign({}, out);
    }

    while (this.i < this.source.length) {
      this.ws();
      if (this.source[this.i] !== '"') {
        this.bad("Expected string key in object");
      }
      const key = this.string();
      if (FORBIDDEN_PROPERTY_NAMES.has(key)) {
        throw new SafeDataError(`Forbidden property name '${key}' in JSON object`, "FORBIDDEN_PROPERTY");
      }
      if (seen.has(key)) {
        throw new SafeDataError(`Duplicate JSON key '${key}'`, "DUPLICATE_KEY");
      }
      seen.add(key);

      this.ws();
      if (this.source[this.i] !== ":") {
        this.bad("Expected ':' after key in object");
      }
      this.i++; // skip ':'

      out[key] = this.value();

      this.ws();
      const next = this.source[this.i];
      if (next === "}") {
        this.i++;
        this.depth--;
        return Object.assign({}, out);
      }
      if (next === ",") {
        this.i++;
        continue;
      }
      this.bad("Expected ',' or '}' in object");
    }

    this.bad("Unterminated object");
  }

  private array(): unknown[] {
    if (++this.depth > MAX_DEPTH) {
      throw new SafeDataError("JSON depth limit exceeded", "MAX_DEPTH_EXCEEDED");
    }
    this.i++; // skip '['
    const out: unknown[] = [];

    this.ws();
    if (this.i < this.source.length && this.source[this.i] === "]") {
      this.i++;
      this.depth--;
      return out;
    }

    while (this.i < this.source.length) {
      out.push(this.value());

      this.ws();
      const next = this.source[this.i];
      if (next === "]") {
        this.i++;
        this.depth--;
        return out;
      }
      if (next === ",") {
        this.i++;
        continue;
      }
      this.bad("Expected ',' or ']' in array");
    }

    this.bad("Unterminated array");
  }
}

/**
 * Parses JSON text from string or Uint8Array, failing closed on:
 * - duplicate decoded keys (e.g. "a" and "\\u0061")
 * - invalid UTF-8 bytes or UTF-8 BOM
 * - unsafe prototypes, accessors, non-enumerable, symbol, cycle, or nonfinite numbers
 */
export function parseThemeJson(text: string | Uint8Array): unknown {
  let source: string;

  if (text instanceof Uint8Array) {
    try {
      source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(text);
    } catch {
      throw new SafeDataError("Invalid UTF-8 byte sequence", "INVALID_UTF8");
    }
  } else if (typeof text === "string") {
    source = text;
  } else {
    throw new SafeDataError("Input must be a string or Uint8Array", "INVALID_INPUT_TYPE");
  }

  if (source.startsWith("\uFEFF")) {
    throw new SafeDataError("UTF-8 BOM is forbidden", "SCHEMA_INVALID_BOM");
  }

  if (Buffer.byteLength(source, "utf8") > MAX_INPUT_BYTES) {
    throw new SafeDataError("Input exceeds maximum 1 MiB limit", "OVERSIZED_INPUT");
  }

  const parser = new DuplicateFreeJsonParser(source);
  const parsed = parser.parse();

  // Validate post-parse safety invariants
  assertSafeData(parsed);

  return parsed;
}
