// Which groups must stay hidden from a grouped answer.
//
// Dropping only the groups under the floor is not enough: the total minus the
// published groups gives the dropped group's exact size. This is the standard
// fix, complementary suppression: keep hiding the next smallest group until
// what is hidden adds up to at least the floor, so subtraction only ever
// reveals a sum that is safe to reveal.

/** Keys to hide, given each group's count of people and the cell floor. */
export function withheldCells(
  sizes: ReadonlyMap<string, number>,
  floor: number,
): Set<string> {
  const hidden = new Set<string>();
  let total = 0;
  for (const [key, n] of sizes) {
    if (n < floor) {
      hidden.add(key);
      total += n;
    }
  }
  if (hidden.size === 0) return hidden;

  const rest = [...sizes]
    .filter(([key]) => !hidden.has(key))
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  for (const [key, n] of rest) {
    if (total >= floor) break;
    hidden.add(key);
    total += n;
  }
  return hidden;
}
