import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-space", weight: ["500", "600", "700"] });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jet = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jet", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Domino Sky: Control — Predict the ripple. Break the chain.",
  description: "Deterministic airline disruption simulator: close any airport, watch the delay cascade through aircraft rotations, connections and crew duty, then find and prove a feasible recovery.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${space.variable} ${inter.variable} ${jet.variable}`}>{children}</body>
    </html>
  );
}
