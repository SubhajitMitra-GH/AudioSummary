/**
 * A tiny, safe formatter for model answers: paragraphs, bullet and numbered lists,
 * short headings and **bold**. It returns plain data (never HTML), so nothing in an
 * answer can inject markup.
 */

export interface InlineRun {
  text: string;
  bold: boolean;
}

export type Block =
  | { type: 'p'; lines: InlineRun[][] }
  | { type: 'h'; runs: InlineRun[] }
  | { type: 'ul' | 'ol'; items: InlineRun[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,4}\s+(.*)$/;

export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), bold: false });
    runs.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold: false });
  return runs.length ? runs : [{ text: '', bold: false }];
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;

  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!raw.trim()) {
      flush();
      continue;
    }
    const bullet = raw.match(BULLET);
    const numbered = bullet ? null : raw.match(NUMBERED);
    const heading = bullet || numbered ? null : raw.match(HEADING);

    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      const item = parseInline((bullet ?? numbered)![1]);
      if (current && current.type === type) {
        current.items.push(item);
      } else {
        flush();
        current = { type, items: [item] };
      }
    } else if (heading) {
      flush();
      blocks.push({ type: 'h', runs: parseInline(heading[1].replace(/\*\*/g, '')) });
    } else if (current && current.type === 'p') {
      current.lines.push(parseInline(raw));
    } else {
      flush();
      current = { type: 'p', lines: [parseInline(raw)] };
    }
  }
  flush();
  return blocks;
}
