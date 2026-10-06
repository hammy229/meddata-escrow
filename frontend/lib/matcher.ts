import { Listing, Match } from "./types";

// Keyword fallback. Swap for a Bedrock call server-side when USE_BEDROCK=1.
export function keywordMatch(request: string, listings: Listing[]): Match[] {
  const words = new Set(
    request
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[.,]/g, ""))
      .filter((w) => w.length > 3)
  );
  const out: Match[] = [];
  for (const l of listings) {
    const text = `${l.title} ${l.description} ${l.tags.join(" ")}`.toLowerCase();
    let hits = 0;
    for (const w of words) if (text.includes(w)) hits++;
    if (hits > 0) {
      out.push({
        listing_id: l.listing_id,
        score: Math.min(100, 30 + hits * 20),
        reason: `${hits} keyword ${hits === 1 ? "match" : "matches"} against listing metadata`,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
