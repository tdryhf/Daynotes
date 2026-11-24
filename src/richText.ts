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
