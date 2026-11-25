import { describe, expect, it } from "vitest";
import { splitBold, splitReply } from "./richText";

describe("AI reply tables", () => {
  it("turns a Markdown table into a table block, with the text around it kept", () => {
    const reply = "Here is your week:\n\n| Habit | Done | Goal |\n|---|:---:|---:|\n| **Run** | 3 | 4 |\n| Read | 5 | 5 |\n\nNice work!";
    expect(splitReply(reply)).toEqual([
      { kind: "text", text: "Here is your week:" },
      { kind: "table", header: ["Habit", "Done", "Goal"], align: [null, "center", "right"], rows: [["**Run**", "3", "4"], ["Read", "5", "5"]] },
      { kind: "text", text: "Nice work!" },
    ]);
  });

  it("reads tables without outer pipes, with escaped pipes, <br> breaks and uneven rows", () => {
    expect(splitReply("Day | Note\n:-- | ---\nMon | a \\| b<br>c\nTue |\nWed | x | extra")).toEqual([
      { kind: "table", header: ["Day", "Note"], align: ["left", null], rows: [["Mon", "a | b\nc"], ["Tue", ""], ["Wed", "x"]] },
    ]);
  });

  it("ends the table at the first line without a pipe", () => {
    expect(splitReply("| A | B |\n| - | - |\n| 1 | 2 |\nThat's all.")).toEqual([
      { kind: "table", header: ["A", "B"], align: [null, null], rows: [["1", "2"]] },
      { kind: "text", text: "That's all." },
    ]);
  });

  it("handles two tables in one reply", () => {
    const blocks = splitReply("| A |\n| --- |\n| 1 |\n\nAnd:\n\n| B |\n| --- |\n| 2 |");
    expect(blocks.map((block) => block.kind)).toEqual(["table", "text", "table"]);
  });

  it("leaves text with pipes but no |---| line exactly as written", () => {
    const reply = "Run | Walk | Rest\nPick one.\n\n- a list item";
    expect(splitReply(reply)).toEqual([{ kind: "text", text: reply }]);
  });

  it("doesn't take a heading underline for a table", () => {
    const reply = "Score | 5\n---\nmore";
    expect(splitReply(reply)).toEqual([{ kind: "text", text: reply }]);
  });

  it("needs the |---| line to match the header's column count", () => {
    const reply = "| A | B |\n| --- |\n| 1 | 2 |";
    expect(splitReply(reply)).toEqual([{ kind: "text", text: reply }]);
  });
});

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
