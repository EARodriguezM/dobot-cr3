import type { Metadata } from "next";
import { Syne, IBM_Plex_Mono, Lora } from "next/font/google";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

// Template metadata — each lab replaces the title/description when forking.
export const metadata: Metadata = {
  title: "Laboratorio Remoto — PRIMBIO",
  description:
    "Laboratorio remoto del semillero PRIMBIO — teleoperación de hardware en tiempo real.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${syne.variable} ${ibmPlexMono.variable} ${lora.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
