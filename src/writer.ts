import { lstat, mkdir, open, readdir, rename, rmdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";

export class FilesystemSafetyError extends Error {
  constructor(message: string, readonly code = "FILESYSTEM_SAFETY_ERROR") { super(message); this.name = "FilesystemSafetyError"; }
}
const fail = (message: string, code: string): never => { throw new FilesystemSafetyError(message, code); };
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.isDirectory() === b.isDirectory();
type Owned = { path: string; stat: Stats };

export function validateMemberPath(path: string): void {
  if (typeof path !== "string" || !path || isAbsolute(path) || /[\\:\x00-\x1f\x7f]/.test(path)) fail("Invalid package member path", "INVALID_MEMBER_PATH");
  for (const part of path.split("/")) {
    if (!part || part === "." || part === ".." || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || part === ".tfss-write-lock") fail("Unsafe package member component", "INVALID_MEMBER_PATH");
  }
}
export function preflightMemberPaths(files: ReadonlyMap<string, string | Uint8Array>): void {
  if (!(files instanceof Map) || files.size === 0) fail("Expected a nonempty file Map", "INVALID_FILE_MAP");
  const seen = new Map<string, string>();
  for (const [path, content] of files) {
    validateMemberPath(path);
    if (typeof content !== "string" && !(content instanceof Uint8Array)) fail("Invalid file content", "INVALID_FILE_MAP");
    const key = path.normalize("NFC").toLowerCase();
    if (seen.has(key)) fail("Case or Unicode path collision", path.normalize("NFC") === seen.get(key)?.normalize("NFC") ? "NORMALIZATION_COLLISION" : "CASE_COLLISION");
    seen.set(key, path);
  }
  for (const key of seen.keys()) {
    const parts = key.split("/"); parts.pop();
    while (parts.length) { if (seen.has(parts.join("/"))) fail("File/directory prefix conflict", "PREFIX_CONFLICT"); parts.pop(); }
  }
}
async function existing(path: string): Promise<Stats | undefined> {
  try { return await lstat(path); } catch (e: any) {
    if (e.code === "ENOENT") return undefined;
    if (e.code === "ENOTDIR") fail("Non-directory path component", "NOT_A_DIRECTORY");
    throw e;
  }
}
async function checkChain(path: string): Promise<void> {
  let current = parse(path).root;
  for (const part of path.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part); const st = await existing(current);
    if (!st) return;
    if (st.isSymbolicLink()) fail("Symlink path component rejected", "SYMLINK_REJECTED");
    if (!st.isDirectory()) fail("Non-directory path component", "NOT_A_DIRECTORY");
  }
}
async function ensureDirectories(path: string, owned: Owned[]): Promise<void> {
  await checkChain(path);
  let current = parse(path).root;
  for (const part of path.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part);
    if (!(await existing(current))) {
      try { await mkdir(current); owned.push({ path: current, stat: await lstat(current) }); }
      catch (e: any) { if (e.code !== "EEXIST") throw e; }
    }
    await checkChain(current);
  }
}
async function assertOwned(entry: Owned): Promise<void> {
  await checkChain(dirname(entry.path));
  const st = await existing(entry.path);
  if (!st || !same(st, entry.stat) || st.isSymbolicLink()) fail("Filesystem entity changed during generation", "DESTINATION_CONFLICT");
}
async function clean(owned: Owned[]): Promise<void> {
  const errors: unknown[] = [];
  for (const entry of [...owned].reverse()) {
    try { await assertOwned(entry); if (entry.stat.isDirectory()) await rmdir(entry.path); else await unlink(entry.path); }
    catch (e) { errors.push(e); }
  }
  if (errors.length) throw new AggregateError(errors, "Owned cleanup incomplete; retained paths require inspection");
}
async function exclusiveFile(path: string, bytes: string | Uint8Array, owned: Owned[]): Promise<void> {
  await checkChain(dirname(path));
  let handle;
  try { handle = await open(path, "wx", 0o644); }
  catch (e: any) { if (e.code === "EEXIST" || e.code === "ELOOP") fail("Destination conflict", "DESTINATION_CONFLICT"); throw e; }
  try {
    owned.push({ path, stat: await handle.stat() });
    await handle.writeFile(bytes); await handle.sync();
  } finally { await handle.close(); }
}

/** Exclusive publication with rollback of unchanged owned entries. Files are visible
 * incrementally. No crash-atomic directory or hostile concurrent-parent guarantee. */
export async function writePackageFiles(files: ReadonlyMap<string, string | Uint8Array>, outDir: string, _options?: { overwrite?: boolean }): Promise<string[]> {
  preflightMemberPaths(files);
  // Snapshot both keys and mutable byte buffers before the first await.
  const snapshot = new Map([...files].map(([path, value]) => [path, typeof value === "string" ? value : Uint8Array.from(value)]));
  if (typeof outDir !== "string" || !outDir.trim() || outDir.includes("\0")) fail("Invalid destination", "INVALID_DESTINATION");
  const target = resolve(outDir), owned: Owned[] = [];
  await checkChain(target);
  const prior = await existing(target);
  if (prior && (await readdir(target)).length) fail("Target directory is not empty", "DIRECTORY_NOT_EMPTY");
  try {
    await ensureDirectories(dirname(target), owned);
    if (!prior) {
      try { await mkdir(target); } catch (e: any) { if (e.code === "EEXIST") fail("Destination appeared during generation", "DESTINATION_CONFLICT"); throw e; }
      owned.push({ path: target, stat: await lstat(target) });
    }
    const root = { path: target, stat: prior ?? (await lstat(target)) };
    await assertOwned(root);
    // Cooperating writers reserve even a pre-existing empty destination exclusively.
    const lockPath = join(target, ".tfss-write-lock");
    await exclusiveFile(lockPath, "tfss package generation\n", owned);
    const lock = owned[owned.length - 1]!;
    if ((await readdir(target)).some(name => name !== ".tfss-write-lock")) fail("Target no longer empty", "DIRECTORY_NOT_EMPTY");
    for (const [path, content] of snapshot) {
      await assertOwned(root); await assertOwned(lock);
      await ensureDirectories(dirname(join(target, path)), owned);
      await exclusiveFile(join(target, path), content, owned);
    }
    await assertOwned(root); await assertOwned(lock);
    await unlink(lockPath); owned.splice(owned.indexOf(lock), 1);
    return [...snapshot.keys()].sort((a, b) => a.localeCompare(b, "en"));
  } catch (error) {
    try { await clean(owned); } catch (cleanup) { throw new AggregateError([error, cleanup], "Generation failed and cleanup was incomplete"); }
    throw error;
  }
}

/** Checked regular-file replacement. Parent directories must remain trusted for the
 * operation's duration; portable Node path APIs cannot pin ancestor capabilities. */
export async function writeCssFile(targetFile: string, content: string | Uint8Array, options?: { overwrite?: boolean }): Promise<string> {
  if (typeof targetFile !== "string" || !targetFile.trim() || targetFile.includes("\0")) fail("Invalid destination", "INVALID_DESTINATION");
  const target = resolve(targetFile), owned: Owned[] = [];
  await checkChain(dirname(target));
  const prior = await existing(target);
  if (prior?.isSymbolicLink()) fail("Symlink destination rejected", "SYMLINK_REJECTED");
  if (prior && !prior.isFile()) fail("Destination is not a regular file", prior.isDirectory() ? "IS_A_DIRECTORY" : "NOT_A_REGULAR_FILE");
  if (prior && !options?.overwrite) fail("Target file already exists", "DESTINATION_CONFLICT");
  try {
    await ensureDirectories(dirname(target), owned);
    if (!prior) await exclusiveFile(target, content, owned);
    else {
      const temp = join(dirname(target), `.tfss-${randomUUID()}.tmp`);
      await exclusiveFile(temp, content, owned);
      await assertOwned({ path: target, stat: prior });
      await assertOwned(owned[owned.length - 1]!);
      await rename(temp, target); owned.pop();
    }
    return target;
  } catch (error) {
    try { await clean(owned); } catch (cleanup) { throw new AggregateError([error, cleanup], "CSS write failed and cleanup was incomplete"); }
    throw error;
  }
}
