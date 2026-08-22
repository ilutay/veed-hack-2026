"use client";

import { ComponentRenderer } from "@tambo-ai/react";
import Link from "next/link";

import { TasteLabsRendererRegistry } from "@/lib/taste-labs/registry";

import { LessonRenderError } from "./lesson-render-error";
import {
  TasteLabsDemoProvider,
  useTasteLabsDemo,
} from "./taste-labs-demo-provider";

function FixtureStage() {
  const { blocks, notice, turn } = useTasteLabsDemo();
  return (
    <>
      <div className="tasteBoundary" role="note">
        <strong>Fixture-only boundary</strong>
        <span>{notice}</span>
      </div>
      <main>
        {blocks.map((block) => (
          <div className="tasteBlock" key={block.id}>
            <ComponentRenderer
              content={block}
              fallback={<LessonRenderError name={block.name} />}
              messageId={`fixture-turn-${turn}`}
              threadId="taste-labs-fixture-dotcom"
            />
          </div>
        ))}
      </main>
    </>
  );
}

export function TasteLabsApp() {
  return (
    <TasteLabsRendererRegistry>
      <TasteLabsDemoProvider>
        <div className="tasteWrap">
          <header className="tasteSiteHeader">
            <div>
              <span className="tasteMark">TL</span>
              <span>
                <strong>Taste Labs</strong>
                <small>teammate interaction gallery</small>
              </span>
            </div>
            <span className="tasteStatus">LOCAL FIXTURE · READ ONLY</span>
          </header>
          <FixtureStage />
          <footer className="tasteFooter">
            <Link href="/">← Back to Pioneer Gym</Link>
            <span>Registered components render locally without tools or memory.</span>
          </footer>
        </div>
        <div aria-hidden="true" className="tasteGrain" />
      </TasteLabsDemoProvider>
    </TasteLabsRendererRegistry>
  );
}
