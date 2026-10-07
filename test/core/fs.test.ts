import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_CONFLICT, PikabanError } from "../../src/core/errors.js";
import { atomicWrite, contentHash, createExclusive } from "../../src/core/fs.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pikaban-fs-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("atomicWrite", () => {
  it("makes a new file and replaces an existing file", () => {
    const file = join(dir, "a.md");
    atomicWrite(file, "one");
    expect(readFileSync(file, "utf8")).toBe("one");
    atomicWrite(file, "two ✓");
    expect(readFileSync(file, "utf8")).toBe("two ✓");
    expect(readdirSync(dir)).toEqual(["a.md"]);
  });

  it("removes the temporary file when the rename fails", () => {
    const target = join(dir, "target");
    mkdirSync(join(target, "child"), { recursive: true });
    expect(() => atomicWrite(target, "x")).toThrow();
    expect(readdirSync(dir)).toEqual(["target"]);
  });

  it("fails when the folder does not exist", () => {
    expect(() => atomicWrite(join(dir, "missing", "a.md"), "x")).toThrow(
      expect.objectContaining({ code: "ENOENT" }),
    );
  });
});

describe("createExclusive", () => {
  it("makes a new file", () => {
    const file = join(dir, "new.md");
    createExclusive(file, "hello");
    expect(readFileSync(file, "utf8")).toBe("hello");
  });

  it("stops with a PikabanError if the file exists, and does not change it", () => {
    const file = join(dir, "old.md");
    writeFileSync(file, "old");
    let err: unknown;
    try {
      createExclusive(file, "new");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PikabanError);
    expect((err as PikabanError).code).toBe(EXIT_CONFLICT);
    expect(readFileSync(file, "utf8")).toBe("old");
  });
});

describe("contentHash", () => {
  it("is SHA-256 hex of the content", () => {
    expect(contentHash("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(contentHash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("gives the same hash for a string and its UTF-8 bytes", () => {
    expect(contentHash("ü")).toBe(contentHash(Buffer.from("ü", "utf8")));
  });

  it("changes when the body changes", () => {
    expect(contentHash("---\na\n---\nbody")).not.toBe(contentHash("---\na\n---\nbody2"));
  });
});
