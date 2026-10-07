import type { Metadata } from "next";
import { assistant, archivoBlack, jetbrainsMono } from "./fonts";
import "./globals.css";
import "./redesign.css";

export const metadata: Metadata = {
  title: "PROMUNCH CRM",
  description: "Sales, customers and marketing for PROMUNCH",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Light only for now: the redesign has no dark palette yet (open question 10).
    <html lang="en" data-theme="light" className={`${assistant.variable} ${archivoBlack.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
