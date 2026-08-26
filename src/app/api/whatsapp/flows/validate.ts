// Sarvam Voice Agents initial_language_name enum (docs.sarvam.ai instant-outbound).
export const VOICE_LANGUAGES = [
  "Hindi", "English", "Bengali", "Gujarati", "Kannada", "Malayalam", "Tamil",
  "Telugu", "Punjabi", "Marathi", "Odia", "Assamese",
] as const;

/** Returns an error string or null. Hours are IST, start inclusive, end exclusive. */
export function validateVoiceHours(start: number, end: number): string | null {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return "call hours must be whole hours";
  if (start < 0 || start > 23 || end < 1 || end > 24) return "call hours must be within 0-24";
  if (start >= end) return "call start hour must be before the end hour";
  return null;
}
