/**
 * Emits the JSON Schema that constrains Codex's final message to a single
 * component command.
 *
 * Generated from the same zod schemas the renderer validates against, so the
 * model cannot emit a shape the client would then reject.
 *
 * Uses zod 4's native z.toJSONSchema, NOT the zod-to-json-schema package.
 * zod-to-json-schema@3 predates zod 4 and returns a bare
 * `{"$schema": ...}` for a v4 schema — it drops every property silently, with
 * no error. It stays in package.json only because @tambo-ai/react declares it
 * as a peer dependency.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z, type ZodType } from "zod";
import { registeredComponents as gymComponents } from "../src/gym/registry";

/**
 * Normalises a zod-emitted schema for OpenAI structured outputs, which are
 * stricter than JSON Schema: no `$schema`, every object must carry
 * `additionalProperties: false`, and `required` must list every property.
 * zod omits the first on nested objects and leaves `.optional()` props out of
 * the second, so optional props become required-but-nullable here; the bridge
 * strips the nulls before the command reaches the client.
 */
function clean(node: unknown, required = true): unknown {
  if (Array.isArray(node)) return node.map((item) => clean(item));
  if (node && typeof node === "object") {
    const entries = Object.entries(node as Record<string, unknown>)
      .filter(([k]) => k !== "$schema")
      .map(([k, v]) => [k, k === "properties" ? v : clean(v)] as const);
    const out = Object.fromEntries(entries) as Record<string, unknown>;
    if (out.properties && typeof out.properties === "object") {
      const originallyRequired = new Set(Array.isArray(out.required) ? (out.required as string[]) : []);
      const properties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(out.properties as Record<string, unknown>)) {
        properties[key] = clean(value, originallyRequired.has(key));
      }
      out.properties = properties;
      out.required = Object.keys(properties);
      out.additionalProperties = false;
    }
    if (!required && typeof out.type === "string") out.type = [out.type, "null"];
    return out;
  }
  return node;
}

const propVariants = gymComponents.map((c) =>
  clean(z.toJSONSchema(c.propsSchema as ZodType, { io: "input" })),
);

/**
 * Structured outputs reject `oneOf` and require an object at the root, so the
 * command is flattened: a name drawn from the registry plus an `anyOf` over the
 * four prop shapes. The pairing of name to props is therefore not enforced by
 * the schema — the client re-validates, and each component guards its own props.
 */
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["componentName", "props"],
  properties: {
    componentName: { enum: gymComponents.map((c) => c.name) },
    props: { anyOf: propVariants },
  },
};

const out = resolve(import.meta.dirname, "../server/component-command.schema.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(schema, null, 2));
console.log(`wrote ${out} (${propVariants.length} variants)`);
