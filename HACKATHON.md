# Pioneer Gym — hackathon copy

Paste-ready text for the {Tech: Europe} × VEED Summer Lock-In (22 Aug 2026).
Claims below are from the checked-in product on `main`, not from the earlier
video-pipeline scaffold.

## Name and tagline

**Pioneer Gym** — an RL gym for humans: practice that adapts after every decision.

## One-liner

You type what you want to learn, do a short observable rep, see the evidence, then attempt a held-out transfer — Pioneer picks the next eligible exercise to maximize transferable learning per minute.

## Paste-ready description

Most AI learning products generate more content. Pioneer Gym treats the human as the thing being trained.

A learner types a goal. Codex, the only execution agent, turns that into one certified practice rep. Pioneer then does two jobs and nothing else: P1 certifies that the exercise has a usable teaching signal, and P2 chooses the exact next eligible rep from an immutable inventory. The objective is transferable learning gain per minute, not video length or quiz completion.

The live demo trains visual hierarchy for short-form product video. You compare two frames, name what your eye noticed first, see criterion-level feedback on the artifact, then reconstruct the reading order in a changed format (side-by-side product frame → vertical outdoor story). A session is timeboxed to 90 seconds of practice. The product will not call that mastery; the UI says “transfer evidence, not a guarantee of learning.”

The trust boundary is the rest of the product. Pioneer is text-only, one request, four seconds, no tools, and never receives pixels, URLs, or media. When an exercise depends on a visual, fal returns UTF-8 observations; Codex binds one pedagogical content hash from certification through render; Tambo only mounts a registered component after the browser re-verifies that receipt. Drift fails closed to a separately certified fallback, never a repaired prompt. Live Codex runs only typed Pioneer Gym actions through a Unix-socket TeamBox gateway — the browser cannot submit a free-form agent prompt.

`/lesson` plays a real 33-second fal-rendered sample (“How the dot-com bubble formed”). A gym prompt creates practice, not a new video.

## 60-second demo script

1. Unlock the gated demo. Goal: “Teach me to spot weak visual hierarchy.”
2. Compare two product frames. Commit a choice, a reason tag, and confidence.
3. Show the credit-assignment replay: which layer actually earned the decision.
4. Pioneer picks the next edge. If the criterion is already met, it can skip retry and go straight to held-out transfer.
5. Transfer: order layers from first attention to final action in a new format.
6. Point at the P1 receipt on screen (judgment + provenance). Say the fallback is labeled when Pioneer is unavailable — it never impersonates a live choice.
7. Optional: `/lesson` for the checked-in fal video; `/taste-labs` only if asked — it is a fixture-only teammate gallery, not the gym loop.

## Sponsor stack, as actually used

| Partner | In Pioneer Gym | Also in repo |
| --- | --- | --- |
| **Pioneer** | P1 teaching-signal certification; P2 next-rep selection from the eligible inventory. Live: one text call, 4s deadline, no tools, no retry. | — |
| **OpenAI Codex** | Sole execution agent. Typed skills under `codex/skills/pioneer-gym*`. TeamBox Unix-socket gateway; no public TCP, no free-form browser prompts. | Educational-video workflow orchestration |
| **Tambo** | Renderer only: registered React components, no tools, backend, memory, or curriculum authority. Browser re-verifies the Codex receipt before mount. | Same renderer for the `/taste-labs` fixture gallery |
| **fal** | Stimulus text receipts (`perceptron/isaac-01`). Pioneer sees allowlisted UTF-8 and source spans, never the image. | Slide images, TTS, and the `/lesson` sample (`public/media/dotcom-lesson.mp4`) |
| **Tavily** | Not in the gym control loop. | Topic research and onboarding packs for the lesson pipeline |
| **VEED Fabric** | Not in the gym control loop. | Talking-head intro stage of the lesson workflow; fixture includes `talking-head-intro.mp4` |

## What not to claim

- The gym does not generate a new video from the learner prompt.
- Pioneer does not train itself; the human is the learner.
- A completed transfer is evidence in this session, not durable learning.
- `/taste-labs` cannot start providers, write runs, or impersonate Codex.
- TeamBox templates under `ops/teambox/` are the deployment contract, not proof a host is running.

## Repo

https://github.com/ilutay/veed-hack-2026
