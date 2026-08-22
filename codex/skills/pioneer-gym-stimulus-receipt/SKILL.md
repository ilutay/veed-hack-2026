---
name: pioneer-gym-stimulus-receipt
description: Deterministically prepare Pioneer Gym stimulus-description fields from an immutable raw fal UTF-8 text receipt using exact byte spans and a closed transform allowlist; never author or infer a visual observation.
---

# Pioneer Gym Stimulus Receipt

Use this skill for the Codex-owned `prepare_stimulus_receipt` stage. This is a
deterministic adapter action, not a model-judgment turn.

## Input boundary

The stage accepts:

- one or two immutable raw UTF-8 text responses from fal;
- the fal provider request/model IDs and expected raw-text SHA-256;
- exact UTF-8 byte spans selected for named manifest fields; and
- one declared transform from the canonical closed allowlist for each span.

It never receives pixels through Pioneer and never asks Codex to describe an
image. The raw fal text is the only source of stimulus-description strings.

## Allowed transforms

Apply only these exhaustive transforms:

- `identity`
- `trim_whitespace`
- `unicode_nfc`
- `exact_enum_map`
- `parse_explicit_number`
- `split_explicit_list`
- `normalize_explicit_coordinates`
- `exact_equality_compare`

Coordinate normalization may parse only coordinates and canvas dimensions fal
explicitly states in the selected source span. Enum mapping uses only the
canonical verifier's pinned one-to-one lookup. Equality may compare grounded
literal values only.

## Forbidden behavior

Never paraphrase, summarize, infer, semantically relabel, estimate geometry,
infer salience or reading order, resolve conflicting claims, add copy, or fill a
missing field. A human spot check may reject a receipt but may not rewrite it.

## Validation

1. Calculate SHA-256 over the exact raw UTF-8 bytes and require the expected
   digest.
2. Require every span to be in range and on UTF-8 code-point boundaries.
3. Extract exact source text from the declared byte range.
4. Apply the single declared allowed transform deterministically.
5. Record the raw-text digest, exact span, exact source text, transform, and
   normalized value for each field.
6. Fail the whole preparation on an invalid digest, span, transform, parse,
   enum value, dimensions, or bound. Never silently drop a required field.

The output proves lineage into fal text; it does not prove that fal's visual
description is correct. Pioneer may certify only the teaching signal represented
by this audited receipt and must abstain when the receipt lacks a required
factor.
