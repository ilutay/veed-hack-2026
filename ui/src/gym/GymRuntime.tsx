import type React from "react";
import { TamboRegistryProvider } from "@tambo-ai/react";
import { gymComponents } from "./registry";

/**
 * Registry-only Tambo runtime.
 *
 * TamboRegistryProvider is the whole integration: it seeds the registry that
 * ComponentRenderer reads out of React context. It makes no network call and
 * needs no API key, which is why there is no TamboProvider above it.
 *
 * tools and mcpServers stay empty on purpose — Codex owns tool calling and
 * talks to Pioneer itself. Registering either here would hand that job to
 * Tambo's agent stack.
 */
export function GymRuntime({ children }: React.PropsWithChildren) {
  return (
    <TamboRegistryProvider components={gymComponents} tools={[]} mcpServers={[]}>
      {children}
    </TamboRegistryProvider>
  );
}
