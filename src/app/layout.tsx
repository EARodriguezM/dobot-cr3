import type { Metadata } from "next";
import { Syne, IBM_Plex_Mono, Lora } from "next/font/google";
import "./globals.css";

// PRIMBIO type system: Syne (display), IBM Plex Mono (technical labels),
// Lora (prose). Weights match the brand's reference implementation.
const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dobot CR3 — Laboratorio Remoto PRIMBIO",
  description:
    "Teleoperación remota del brazo colaborativo Dobot CR3 del semillero PRIMBIO: " +
    "un operador activo, múltiples observadores en vivo.",
};

// Typed explicitly rather than with Next's generated `LayoutProps`, which only
// exists after a build has written .next/types — a clean checkout (CI) would
// not typecheck.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      className={`${syne.variable} ${ibmPlexMono.variable} ${lora.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
