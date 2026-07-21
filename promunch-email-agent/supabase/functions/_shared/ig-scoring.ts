// Shared influencer fit-score formula. Used by BOTH ig-analyze (inbound collab
// threads, official Business Discovery metrics) and ig-discovery-tick (Apify
// prospects) so a prospect's score is directly comparable with a thread's.
//
// Score = follower-band fit (0–40) + engagement rate (0–35) + AI niche (0–25).

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

// follower-band fit: full inside the band, partial within half/double, low else.
export function scoreBand(followers: number | null, min: number, max: number): number {
  if (followers == null) return 0;
  if (followers >= min && followers <= max) return 40;
  if (followers >= min / 2 && followers <= max * 2) return 20;
  return 5;
}

// engagement: ~8%+ ER (strong for micro) maxes out the 35 points. er is a fraction (0–1).
export function scoreEr(er: number | null): number {
  if (er == null) return 0;
  return clamp((er * 100 / 8) * 35, 0, 35);
}

export function compositeFit(
  followers: number | null,
  er: number | null,
  nicheScore: number,
  min: number,
  max: number,
): number {
  return clamp(scoreBand(followers, min, max) + scoreEr(er) + clamp(nicheScore, 0, 25), 0, 100);
}
