import type { Metadata } from "next";
import { archivo, archivoBlack, plexMono } from "./fonts";
import "./globals.css";

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
    <html lang="en" className={`${archivo.variable} ${archivoBlack.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
