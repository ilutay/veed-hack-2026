import type { Metadata } from "next";
import { LessonApp } from "@/components/LessonApp";

export const metadata: Metadata = {
  title: "Taste Labs",
  description:
    "Learn a topic. Codex runs the pipeline; the page plays the lesson.",
};

export default function HomePage() {
  return (
    <>
      <div className="grain" aria-hidden="true" />
      <LessonApp />
    </>
  );
}
