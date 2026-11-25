export type TextPiece = { text: string; bold: boolean };

// Markdown-style **bold** on one line. As in Markdown, the marks must hug the words (no space just inside them).
const BOLD = /\*\*([^\s*](?:[^\n]*?[^\s*])?)\*\*/g;

/** Splits an AI reply into plain and bold pieces so it can be shown without the literal ** marks. */
export function splitBold(text: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  let last = 0;
  for (const match of text.matchAll(BOLD)) {
    if (match.index > last) pieces.push({ text: text.slice(last, match.index), bold: false });
    pieces.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length || !pieces.length) pieces.push({ text: text.slice(last), bold: false });
  return pieces;
}

export type CellAlign = "left" | "center" | "right" | null;
export type ReplyBlock =
  | { kind: "text"; text: string }
  | { kind: "table"; header: string[]; align: CellAlign[]; rows: string[][] };

// A line that belongs to a Markdown table has at least one | that isn't escaped as \|.
const isTableLine = (line: string) => line.trim() !== "" && line.replace(/\\\|/g, "").includes("|");

/** The cells of one Markdown table line. Outer pipes are optional, and \| is a literal pipe inside a cell. */
function tableCells(line: string) {
  const row = line.trim();
  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < row.length; index += 1) {
    if (row[index] === "\\" && row[index + 1] === "|") { cell += "|"; index += 1; }
    else if (row[index] === "|") { cells.push(cell); cell = ""; }
    else cell += row[index];
  }
  cells.push(cell);
  if (row.startsWith("|")) cells.shift();
  if (row.endsWith("|") && !row.endsWith("\\|")) cells.pop();
  // The model sometimes breaks lines inside a cell with <br>.
  return cells.map((value) => value.replace(/<br\s*\/?>/gi, "\n").trim());
}

/** The column alignments if `line` is the |---|:---:| line under a table header with `columns` cells. */
function delimiterAlign(line: string | undefined, columns: number): CellAlign[] | null {
  if (line === undefined || !isTableLine(line)) return null;
  const cells = tableCells(line);
  if (cells.length !== columns || !cells.every((cell) => /^:?-+:?$/.test(cell))) return null;
  return cells.map((cell) => cell.endsWith(":") ? (cell.startsWith(":") ? "center" : "right") : cell.startsWith(":") ? "left" : null);
}

/**
 * Splits an AI reply into plain text and Markdown tables (a header line, a |---| line, then the rows),
 * so tables can be shown as real tables instead of pipes and dashes. A reply without a table comes back
 * as a single text block, unchanged.
 */
export function splitReply(text: string): ReplyBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: ReplyBlock[] = [];
  let pending: string[] = [];
  const flushText = () => {
    // Blank lines next to a table are just spacing; the layout adds its own.
    const value = pending.join("\n").replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, "");
    if (value.trim()) blocks.push({ kind: "text", text: value });
    pending = [];
  };
  for (let index = 0; index < lines.length;) {
    const header = isTableLine(lines[index]) ? tableCells(lines[index]) : null;
    const align = header && header.length ? delimiterAlign(lines[index + 1], header.length) : null;
    if (!header || !align) { pending.push(lines[index]); index += 1; continue; }
    const rows: string[][] = [];
    for (index += 2; index < lines.length && isTableLine(lines[index]); index += 1) {
      const cells = tableCells(lines[index]);
      rows.push(header.map((_, column) => cells[column] ?? ""));
    }
    flushText();
    blocks.push({ kind: "table", header, align, rows });
  }
  if (!blocks.some((block) => block.kind === "table")) return [{ kind: "text", text }];
  flushText();
  return blocks;
}
