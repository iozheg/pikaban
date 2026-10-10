import { describe, expect, it } from "vitest";
import { renderSelect, selectStep, type SelectState } from "../../src/cli/prompt.js";

describe("selectStep", () => {
  const start: SelectState = { cursor: 0, on: [true, false] };

  it("arrows and j/k move the cursor and wrap", () => {
    expect(selectStep(start, { name: "down" })).toEqual({ cursor: 1, on: [true, false] });
    expect(selectStep(start, { name: "up" })).toEqual({ cursor: 1, on: [true, false] });
    expect(selectStep({ ...start, cursor: 1 }, { name: "j" })).toMatchObject({ cursor: 0 });
    expect(selectStep({ ...start, cursor: 1 }, { name: "k" })).toMatchObject({ cursor: 0 });
  });

  it("space toggles the item under the cursor", () => {
    expect(selectStep(start, { name: "space" })).toEqual({ cursor: 0, on: [false, false] });
    expect(selectStep({ ...start, cursor: 1 }, { name: "space" })).toEqual({ cursor: 1, on: [true, true] });
  });

  it("enter ends, Ctrl+C, Ctrl+D and Esc cancel, other keys do nothing", () => {
    expect(selectStep(start, { name: "return" })).toBe("done");
    expect(selectStep(start, { name: "c", ctrl: true })).toBe("cancel");
    expect(selectStep(start, { name: "d", ctrl: true })).toBe("cancel");
    expect(selectStep(start, { name: "escape" })).toBe("cancel");
    expect(selectStep(start, { name: "x" })).toBe(start);
  });
});

describe("renderSelect", () => {
  it("shows the question, the cursor, the checkboxes and the keys", () => {
    const items = [
      { value: "backlog", label: "backlog", note: "for later" },
      { value: "review", label: "review" },
    ];
    expect(renderSelect("Pick", items, { cursor: 1, on: [true, false] }, "(note)")).toEqual([
      "Pick (note)",
      "  [x] backlog  for later",
      "> [ ] review ",
      "  up/down move, space select, enter confirm",
    ]);
  });
});
