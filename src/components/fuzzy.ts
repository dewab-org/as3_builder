/** Subsequence fuzzy matching for the NetBox application picker.
 *
 * Kept out of the dialog component so that file exports only components
 * (see chips.ts for why). */

// Fuzzy match: rank contiguous substring hits above in-order subsequence
// hits; everything else is filtered out.
export function fuzzyRank(name: string, query: string): number | null {
  const n = name.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const idx = n.indexOf(q);
  if (idx >= 0) return idx === 0 ? 0 : 1;
  let pos = 0;
  for (const ch of q) {
    pos = n.indexOf(ch, pos);
    if (pos < 0) return null;
    pos += 1;
  }
  return 2;
}
