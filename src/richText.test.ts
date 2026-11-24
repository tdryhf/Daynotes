import { describe, expect, it } from "vitest";
import { splitBold } from "./richText";

describe("AI reply formatting", () => {
  it("turns **text** into bold pieces and drops the marks", () => {
    expect(splitBold("You ran **12 km** this week, **well done**!")).toEqual([
      { text: "You ran ", bold: false }, { text: "12 km", bold: true },
      { text: " this week, ", bold: false }, { text: "well done", bold: true }, { text: "!", bold: false },
    ]);
  });

  it("leaves text without marks as one plain piece", () => {
    expect(splitBold("Plain reply.\n- a list item")).toEqual([{ text: "Plain reply.\n- a list item", bold: false }]);
  });

  it("keeps unmatched or empty marks as written", () => {
    expect(splitBold("2 ** 3 and ****")).toEqual([{ text: "2 ** 3 and ****", bold: false }]);
  });

  it("doesn't let bold run across lines", () => {
    expect(splitBold("**start\nend**")).toEqual([{ text: "**start\nend**", bold: false }]);
  });
});
