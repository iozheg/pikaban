import { describe, expect, it } from "vitest";
import { EXIT_AMBIGUOUS, EXIT_GENERAL, EXIT_NOT_FOUND, EXIT_USAGE } from "../../src/core/errors.js";
import { fileName, formatShort, newUlid, nextShort, parseRef, resolveRef } from "../../src/core/ids.js";
import { ULID_RE } from "../../src/core/schema.js";
import { pikabanError } from "../helpers.js";

// ULIDs in ascending order.
const A = "01JA2B3C4D5E6F7G8H9J0KMNPQ";
const B = "01JA2B9X4D5E6F7G8H9J0KMNPR";
const C = "01JA2BAB4D5E6F7G8H9J0KMNPS";

describe("newUlid", () => {
  it("gives an uppercase 26-character ULID", () => {
    const id = newUlid();
    expect(id).toMatch(ULID_RE);
    expect(newUlid()).not.toBe(id);
  });
});

describe("nextShort", () => {
  it("gives task-0001 for an empty list", () => {
    expect(nextShort([])).toBe("task-0001");
  });

  it("gives task-0042 after task-0041", () => {
    expect(nextShort([{ id: A, short: "task-0041" }])).toBe("task-0042");
  });

  it("uses the newest task (highest ULID), not the highest number", () => {
    expect(
      nextShort([
        { id: B, short: "task-0005" },
        { id: A, short: "task-0100" },
      ]),
    ).toBe("task-0006");
  });

  it("skips numbers that live tasks already have", () => {
    expect(
      nextShort([
        { id: A, short: "task-0042" },
        { id: B, short: "task-0043" },
        { id: C, short: "task-0041" },
      ]),
    ).toBe("task-0044");
  });

  it("skips reserved short names (task files that are not valid)", () => {
    expect(nextShort([{ id: A, short: "task-0006" }], ["task-0007", "task-0008"])).toBe("task-0009");
    expect(nextShort([], ["task-0001"])).toBe("task-0002");
  });

  it("continues at task-0001 after task-9999, or at the next free number", () => {
    expect(nextShort([{ id: A, short: "task-9999" }])).toBe("task-0001");
    expect(
      nextShort([
        { id: A, short: "task-0001" },
        { id: B, short: "task-0002" },
        { id: C, short: "task-9999" },
      ]),
    ).toBe("task-0003");
  });

  it("gives a clear error if all 9999 numbers are in use", () => {
    const tasks = Array.from({ length: 9999 }, (_, i) => ({
      id: `01JA2B3C4D5E6F7G8H9J${String(i).padStart(6, "0")}`,
      short: formatShort(i + 1),
    }));
    const err = pikabanError(EXIT_GENERAL, () => nextShort(tasks));
    expect(err.message).toMatch(/all 9999 short names are in use/);
  });
});

describe("parseRef", () => {
  it("accepts the short name forms", () => {
    for (const ref of ["task-0042", "0042", "42", "TASK-0042", " 42 "]) {
      expect(parseRef(ref)).toEqual({ kind: "short", short: "task-0042" });
    }
    expect(parseRef("9999")).toEqual({ kind: "short", short: "task-9999" });
  });

  it("accepts a full ULID, also in lowercase", () => {
    expect(parseRef(A)).toEqual({ kind: "id", id: A });
    expect(parseRef(A.toLowerCase())).toEqual({ kind: "id", id: A });
  });

  it("gives code 2 for other text", () => {
    for (const ref of ["", "0", "task-0000", "12345", "task-", "abc", "01JA2B3C4D5E6F7G8H9J0KMNP"]) {
      pikabanError(EXIT_USAGE, () => parseRef(ref));
    }
  });
});

describe("fileName", () => {
  it("gives task-XXXX-<ULID>.md", () => {
    expect(fileName("task-0042", A)).toBe(`task-0042-${A}.md`);
  });
});

describe("resolveRef", () => {
  const items = [
    { id: A, short: "task-0042" },
    { id: B, short: "task-0043" },
    { id: C, short: "task-0042" },
  ];

  it("finds a task by ULID or by a unique short name", () => {
    expect(resolveRef(items, A)).toBe(items[0]);
    expect(resolveRef(items, "43")).toBe(items[1]);
  });

  it("gives code 3 when nothing matches", () => {
    pikabanError(EXIT_NOT_FOUND, () => resolveRef(items, "7"));
    pikabanError(EXIT_NOT_FOUND, () => resolveRef(items, "01JA2BAB4D5E6F7G8H9J0KMNPZ"));
  });

  it("gives code 4 with the ULIDs when two tasks have one short name", () => {
    const err = pikabanError(EXIT_AMBIGUOUS, () => resolveRef(items, "task-0042"));
    expect(err.message).toContain(A);
    expect(err.message).toContain(C);
  });

  it("finds a duplicate short name by its ULID", () => {
    expect(resolveRef(items, C)).toBe(items[2]);
  });
});
