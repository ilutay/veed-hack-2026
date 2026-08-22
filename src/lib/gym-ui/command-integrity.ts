import { canonicalizeJson } from "../contracts/canonical-json";
import { getGymComponentDefinition } from "../contracts/gym-components";
import {
  codexUiCommandSchema,
  parseComponentProps,
  validationReceiptSchema,
  type CodexUiCommand,
} from "./gym-contract";

export type CommandIntegrityFailureCode =
  | "command_schema_invalid"
  | "props_schema_invalid"
  | "crypto_unavailable"
  | "pedagogical_props_mismatch"
  | "validation_binding_mismatch"
  | "gym_spec_binding_mismatch"
  | "feedback_binding_mismatch";

export type CommandIntegrityResult =
  | { success: true; props: unknown }
  | { success: false; code: CommandIntegrityFailureCode };

async function canonicalSha256(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto SHA-256 is unavailable");
  }
  const bytes = new TextEncoder().encode(canonicalizeJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Re-verifies the server's immutable command receipt in the browser before
 * any registered component can render. Exercise and feedback commands use
 * separate policies: feedback remains bound to its source GymSpec but hashes
 * its own visible replay props.
 */
export async function verifyCodexUiCommandIntegrity(
  input: unknown,
): Promise<CommandIntegrityResult> {
  const commandResult = codexUiCommandSchema.safeParse(input);
  if (!commandResult.success) {
    return { success: false, code: "command_schema_invalid" };
  }
  const command: CodexUiCommand = commandResult.data;
  const propsResult = parseComponentProps(command);
  if (!propsResult.success) {
    return { success: false, code: "props_schema_invalid" };
  }
  if (command.commandKind === "shell") {
    return { success: true, props: propsResult.data };
  }

  try {
    const projection = command.gymSpecProjection;
    const projectionHash = await canonicalSha256(projection);
    if (
      projectionHash !== command.gymSpecHash ||
      projection.exerciseId !== command.exerciseId ||
      projection.revision !== command.exerciseRevision ||
      projection.fixtureImportReceiptId !== command.fixtureImportReceiptId
    ) {
      return { success: false, code: "gym_spec_binding_mismatch" };
    }

    const props = propsResult.data as Record<string, unknown>;
    if (command.commandPurpose === "feedback") {
      const propsHash = await canonicalSha256(props);
      const feedbackSchema = getGymComponentDefinition(command.component.name);
      if (
        feedbackSchema.role !== "feedback" ||
        command.pedagogicalPropsSha256 !== propsHash ||
        command.renderContractId !==
          `${projection.renderContract.renderContractId}.feedback`
      ) {
        return { success: false, code: "feedback_binding_mismatch" };
      }
      return { success: true, props };
    }

    const receiptResult = validationReceiptSchema.safeParse(
      props.validationReceipt,
    );
    if (!receiptResult.success) {
      return { success: false, code: "validation_binding_mismatch" };
    }
    const receipt = receiptResult.data;
    const pedagogicalProps = { ...props };
    delete pedagogicalProps.validationReceipt;
    const pedagogicalPropsSha256 = await canonicalSha256(pedagogicalProps);
    if (
      pedagogicalPropsSha256 !== command.pedagogicalPropsSha256 ||
      pedagogicalPropsSha256 !==
        projection.renderContract.pedagogicalPropsSha256 ||
      canonicalizeJson(pedagogicalProps) !==
        canonicalizeJson(projection.renderContract.pedagogicalProps)
    ) {
      return { success: false, code: "pedagogical_props_mismatch" };
    }

    if (
      receipt.exerciseId !== command.exerciseId ||
      receipt.exerciseRevision !== command.exerciseRevision ||
      receipt.validationId !== command.validationId ||
      receipt.contentHash !== command.gymSpecHash
    ) {
      return { success: false, code: "validation_binding_mismatch" };
    }

    if (
      projection.renderContract.renderContractId !== command.renderContractId ||
      projection.renderContract.componentName !== command.component.name ||
      projection.renderContract.componentSchemaVersion !==
        command.componentSchemaVersion
    ) {
      return { success: false, code: "gym_spec_binding_mismatch" };
    }

    return { success: true, props };
  } catch {
    return { success: false, code: "crypto_unavailable" };
  }
}
