import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline } from './richText';

describe('parseInline', () => {
  it('splits bold runs', () => {
    expect(parseInline('The **14th**, not the 7th')).toEqual([
      { text: 'The ', bold: false },
      { text: '14th', bold: true },
      { text: ', not the 7th', bold: false },
    ]);
  });

  it('leaves unmatched asterisks as text', () => {
    expect(parseInline('5 * 3 = 15')).toEqual([{ text: '5 * 3 = 15', bold: false }]);
  });

  it('never produces markup, only text', () => {
    const runs = parseInline('<img src=x onerror=alert(1)>');
    expect(runs).toEqual([{ text: '<img src=x onerror=alert(1)>', bold: false }]);
  });
});

describe('parseBlocks', () => {
  it('groups paragraphs and keeps single line breaks', () => {
    const blocks = parseBlocks('First line\nsecond line\n\nNew paragraph');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'p' });
    expect(blocks[0].type === 'p' && blocks[0].lines).toHaveLength(2);
  });

  it('builds bullet and numbered lists', () => {
    const blocks = parseBlocks('Key points:\n- Launch moved\n* Press list\n1. Draft\n2) Send');
    expect(blocks.map((b) => b.type)).toEqual(['p', 'ul', 'ol']);
    expect(blocks[1].type === 'ul' && blocks[1].items).toHaveLength(2);
    expect(blocks[2].type === 'ol' && blocks[2].items).toHaveLength(2);
  });

  it('reads markdown headings', () => {
    expect(parseBlocks('## Summary\nText')).toEqual([
      { type: 'h', runs: [{ text: 'Summary', bold: false }] },
      { type: 'p', lines: [[{ text: 'Text', bold: false }]] },
    ]);
  });

  it('handles empty input', () => {
    expect(parseBlocks('')).toEqual([]);
  });
});
