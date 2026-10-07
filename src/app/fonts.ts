import { Archivo_Black, Assistant, JetBrains_Mono } from "next/font/google";

// promunch.in's own type: Archivo Black for titles and big numbers,
// Assistant for everything you read, JetBrains Mono for labels and IDs.
export const assistant = Assistant({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

export const archivoBlack = Archivo_Black({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});
