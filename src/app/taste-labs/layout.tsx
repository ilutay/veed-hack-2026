import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./riso.css";

export const metadata: Metadata = {
  title: "Taste Labs Fixture Gallery · Pioneer Gym",
  description:
    "An isolated, fixture-only gallery of teammate lesson-player ideas.",
};

export default function TasteLabsLayout({ children }: { children: ReactNode }) {
  return children;
}
