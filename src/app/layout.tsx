import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Tilt_Neon } from "next/font/google";
import "@/styles/riso.css";

// Variable cut with the live axes (XROT/YROT −45..45). Tilt Neon has no wdth;
// Google Fonts 400s `family=Tilt+Neon:wdth@75..125`.
const tiltNeon = Tilt_Neon({
  subsets: ["latin"],
  display: "swap",
  weight: "variable",
  axes: ["XROT", "YROT"],
  variable: "--font-tilt-neon",
});

export const metadata: Metadata = {
  title: "Taste Labs",
  description:
    "Risograph learning player driven by Codex + a Tambo component registry.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={tiltNeon.variable}>
      <body>{children}</body>
    </html>
  );
}
