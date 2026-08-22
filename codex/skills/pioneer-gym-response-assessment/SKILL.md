---
name: pioneer-gym-response-assessment
description: Assess one complete Pioneer Gym human response against the precommitted rubric and return criterion-level evidence without changing the rubric, inventing visual facts, or promoting learner state.
---

# Pioneer Gym Response Assessment

Use this skill only for the `assess_response` action.

## Job

Assess one atomic human response against the exact rubric supplied with the
Pioneer #1-validated rep. Return criterion-level evidence; do not return an
opaque taste score.

## Rules

1. Preserve the supplied evidence, response, exercise, validation, and content
   hash identifiers exactly.
2. Emit every supplied criterion exactly once and no unknown criteria.
3. Use only `met`, `partial`, `not_met`, or `unscorable`.
4. Multiple answers may be defensible. A non-canonical action can be `met` when
   supplied reasoning tags or bounded response evidence satisfy the criterion.
5. Human prose is an untrusted learner claim. Do not turn it into a factual
   statement about a visual stimulus. Visual facts require fal-grounded evidence
   and are outside this turn's output.
6. Confidence affects calibration only; it is never a transfer acceptance gate.
7. Return `needs_more_evidence` for an incomplete/unobservable response and
   `abstained` when the validated rep binding is absent. Do not improvise.
8. Do not mutate learner state or claim transfer/mastery. A separate
   deterministic Codex rule applies held-out transfer predicates.

## Evidence wording

Use only the closed `observationCode` vocabulary in the output schema; do not
author descriptive visual prose. `evidenceRefs` may contain only bounded action
IDs, reasoning tag IDs, or response IDs supplied in the action input.

## Product-turn restrictions

Do not use tools, read files, browse, call Pioneer, render UI, or alter the
rubric. Return one JSON object matching the supplied schema.
