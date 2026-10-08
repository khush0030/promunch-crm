import { Assistant, JetBrains_Mono } from "next/font/google";

// promunch.in's reading + label type from the redesign, loaded only for the
// Influencers page (ahead of the full redesign) under their own variable
// names so the app-wide --font-sans / --font-mono stay as they are.
// Archivo Black (titles, big numbers) is already the app's --font-display.
// Delete this file when the full redesign merges into main.
const rdSans = Assistant({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-rd-sans",
  display: "swap",
});

const rdMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-rd-mono",
  display: "swap",
});

/** Put on the Influencers page wrapper: turns on redesign-scope.css + its fonts. */
export const REDESIGN_SCOPE = `pm-rd ${rdSans.variable} ${rdMono.variable}`;
