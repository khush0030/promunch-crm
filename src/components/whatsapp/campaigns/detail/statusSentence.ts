import { fmtIst } from "../logic";

/**
 * "Cancelled on 30 Sept, 4:10 pm." when the time is known, "Cancelled." when it isn't.
 * Never leaks the "–" placeholder that fmtIst uses for missing/invalid times.
 */
export function whenSentence(verb: string, iso: string | number | null | undefined): string {
  const valid = iso != null && !Number.isNaN(new Date(iso).getTime());
  return valid ? `${verb} on ${fmtIst(iso)}.` : `${verb}.`;
}
