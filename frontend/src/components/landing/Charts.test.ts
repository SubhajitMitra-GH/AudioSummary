import { describe, expect, it } from 'vitest';
import { ASSUME, passageCount, tokensCloud, tokensTellMe } from './Charts';

describe('token estimates', () => {
  it('match the backend retrieval settings', () => {
    // backend/app/rag_pipeline.py: chunk_size=1000, chunk_overlap=150, retrieve_context(k=6)
    expect(ASSUME.passageChars).toBe(1000);
    expect(ASSUME.passageOverlap).toBe(150);
    expect(ASSUME.passagesSent).toBe(6);
  });

  it('chatbot cost grows with the recording, Tell Me. stays flat', () => {
    expect(tokensCloud(120)).toBeGreaterThan(tokensCloud(60));
    expect(tokensTellMe(120)).toBe(tokensTellMe(60));
    expect(tokensTellMe(60)).toBe(ASSUME.passagesSent * ASSUME.passageTokens + ASSUME.promptTokens);
  });

  it('never claims to send more than the transcript for short recordings', () => {
    expect(tokensTellMe(2)).toBe(2 * ASSUME.tokensPerMin + ASSUME.promptTokens);
  });

  it('counts passages like the text splitter', () => {
    expect(passageCount(1)).toBe(1);
    expect(passageCount(60)).toBe(61);
  });
});
