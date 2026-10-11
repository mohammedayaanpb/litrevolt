// These scoring and citation rules apply equally to every AI provider.
export function allocateQuestionMaxScores(questionCount: number): number[] {
  if (!Number.isInteger(questionCount) || questionCount <= 0 || questionCount > 100) {
    throw new Error('question count must be an integer between 1 and 100');
  }
  const base = Math.floor(100 / questionCount);
  const remainder = 100 - base * questionCount;
  return Array.from({ length: questionCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function normalizeCitationText(value: string): string {
  return value.normalize('NFKC')
    .replace(/\u00ad/g, '')
    .replace(/([\p{L}\p{N}])-\s*\r?\n\s*([\p{Ll}\p{N}])/gu, '$1$2')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

export function extractedPages(extractedText: string): Map<number, string> {
  return new Map(Array.from(extractedText.matchAll(/^\[Page (\d+)\][ \t]*\r?\n([\s\S]*?)(?=^\[Page \d+\][ \t]*\r?\n|(?![\s\S]))/gm),
    (match) => [Number(match[1]), normalizeCitationText(match[2])]));
}

export function citationAppearsOnPage(pageText: string, quote: string): boolean {
  const normalizedQuote = normalizeCitationText(quote);
  // Normalize extraction typography only. Dropping or substituting words can
  // reverse a claim (e.g. removing "not") and must never validate as a quote.
  return normalizedQuote.length >= 8 && normalizeCitationText(pageText).includes(normalizedQuote);
}
