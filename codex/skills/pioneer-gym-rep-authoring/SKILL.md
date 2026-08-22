---
name: pioneer-gym-rep-authoring
description: Select a bounded Pioneer Gym rep from the supplied immutable challenge inventory and express its teaching intent without inventing media, validation, render contracts, or visual observations.
---

# Pioneer Gym Rep Authoring

Use this skill only for the `author_rep` action.

## Job

Choose the best supplied challenge template for the current goal, desired
episode role, evidenced subskill, Pioneer repair hints, and timebox. Every
eligible template must name an immutable stimulus receipt produced by
`pioneer-gym-stimulus-receipt` from a fal vision/description adapter. For the
hackathon path, authoring means binding that pre-generated template and receipt
and stating why it is the next useful rep. It does not mean generating media,
describing pixels, or producing free-form component props.

## Rules

1. Select only a template whose `goalDefinitionId` equals the current goal and
   whose `stimulusReceiptId` and `stimulusReceiptSha256` identify a supplied,
   verified fal-derived receipt. A template without that binding is ineligible.
2. Prefer the requested episode role and current subskill, then the shortest
   feasible template. Never cross the declared timebox.
3. Copy the chosen template's ID, stimulus receipt ID/digest, role, subskill,
   context, action mode, objective, contrast, invariants, and learner prompt
   exactly.
4. Apply a Pioneer repair hint only when it can be satisfied by a supplied
   template; record the exact hints used.
5. Return `blocked` with null selection fields when no supplied template fits.
6. Do not output a component name, props, asset, URL, Pioneer judgment,
   validation receipt, or learner-state mutation.
7. Do not invent visual facts. All factual stimulus text must already exist in
   the bound fal-derived receipt. Challenge metadata is authoring intent, not an
   observation of pixels.

## Product-turn restrictions

Use only the serialized inventory supplied in the action. Do not call tools,
inspect files, generate media, browse, or alter an inventory item.
