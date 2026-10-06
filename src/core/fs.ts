import { createHash, randomBytes } from "node:crypto";
import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { EXIT_CONFLICT, TrackerError } from "./errors.js";

function writeAndSync(fd: number, text: string): void {
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Writes `<path>.<random>.tmp` in the same folder, then renames it to `path`. */
export function atomicWrite(path: string, text: string): void {
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeAndSync(openSync(tmp, "wx"), text);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Makes a new file. If the file already exists, throws TrackerError code 5. */
export function createExclusive(path: string, text: string): void {
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new TrackerError(EXIT_CONFLICT, `file already exists: ${path}`, { cause: err });
    }
    throw err;
  }
  try {
    writeAndSync(fd, text);
  } catch (err) {
    rmSync(path, { force: true });
    throw err;
  }
}

/** SHA-256 of the full file content, hex. This is the concurrency token (design 4.5). */
export function contentHash(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
