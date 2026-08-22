export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

/**
 * RFC 8785-compatible JSON canonicalization for values already constrained to
 * the JSON data model. This module is runtime-neutral so the renderer can
 * independently verify the exact bytes committed by the server.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number": {
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(
          "non-finite numbers are not valid canonical JSON",
        );
      }
      return JSON.stringify(value);
    }
    case "object": {
      if (Array.isArray(value)) {
        return `[${value
          .map((entry, index) => {
            if (entry === undefined) {
              throw new CanonicalizationError(
                `undefined array value at index ${index} is not canonical JSON`,
              );
            }
            return canonicalizeJson(entry);
          })
          .join(",")}]`;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new CanonicalizationError(
          "only plain JSON objects can be canonicalized",
        );
      }

      const objectValue = value as Record<string, unknown>;
      if (Object.getOwnPropertySymbols(objectValue).length > 0) {
        throw new CanonicalizationError(
          "symbol object keys are not canonical JSON",
        );
      }

      const keys = Object.keys(objectValue).sort();
      return `{${keys
        .map((key) => {
          const entry = objectValue[key];
          if (entry === undefined) {
            throw new CanonicalizationError(
              `undefined object value at ${key} is not canonical JSON`,
            );
          }
          return `${JSON.stringify(key)}:${canonicalizeJson(entry)}`;
        })
        .join(",")}}`;
    }
    default:
      throw new CanonicalizationError(
        `${typeof value} values are not valid canonical JSON`,
      );
  }
}
