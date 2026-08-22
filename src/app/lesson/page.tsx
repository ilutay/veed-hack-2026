import Link from "next/link";

import { DemoAccessGate } from "@/components/gym/demo-access-gate";

import styles from "./lesson.module.css";

export default function LessonPage() {
  return (
    <DemoAccessGate>
      <main className={styles.lessonRoot}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/">
            PIONEER//GYM
          </Link>
          <Link className={styles.backLink} href="/">
            Back to the gym
          </Link>
        </header>

        <section className={styles.lesson}>
          <div className={styles.intro}>
            <p className={styles.eyebrow}>SAMPLE LESSON · 00:33</p>
            <h1>How the dot-com bubble formed</h1>
            <p>
              A real FAL-rendered lesson from the checked-in media pipeline. It
              is a fixed sample; your gym prompt creates practice, not a new video.
            </p>
          </div>

          <video
            className={styles.video}
            controls
            playsInline
            poster="/media/dotcom-lesson-poster.jpg"
            preload="metadata"
          >
            <source src="/media/dotcom-lesson.mp4" type="video/mp4" />
            Your browser does not support HTML video.
          </video>
        </section>
      </main>
    </DemoAccessGate>
  );
}
