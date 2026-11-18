const STOP = new Set(['the', 'a', 'an', 'at', 'in', 'on', 'of', 'and', 'with', 'by', 'for', 'live', 'edition', 'annual', 'presents']);

/** Title words that matter: lower case, "&" = "and", no years, punctuation or filler words. */
function titleWords(t: string): Set<string> {
  const words = t.toLowerCase().replace(/&/g, ' and ').replace(/\b(19|20)\d{2}\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ');
  return new Set(words.filter((w) => w && !STOP.has(w)));
}

/**
 * Two listings of the same event, e.g. "Carols & Kilts at Shongweni" and "Carols and Kilts, Shongweni 2026":
 * nearly all of the shorter title's words (at least 2) appear in the longer one.
 */
export function similarTitles(a: string, b: string): boolean {
  const A = titleWords(a), B = titleWords(b);
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  if (small.size < 2) return false;
  let shared = 0;
  for (const w of small) if (big.has(w)) shared++;
  return shared / small.size >= 0.8;
}
