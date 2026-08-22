"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  initialTasteLabsDemoState,
  reduceTasteLabsDemoState,
  type TasteLabsDemoState,
} from "@/lib/taste-labs/demo-protocol";
import type { TasteLabsDemoAction } from "@/lib/taste-labs/contracts";

type TasteLabsDemoContextValue = TasteLabsDemoState & {
  dispatch: (action: TasteLabsDemoAction) => void;
};

const TasteLabsDemoContext =
  createContext<TasteLabsDemoContextValue | null>(null);

/**
 * A browser-local fixture controller. It does not call Codex, Pioneer, Tambo
 * Cloud, a workflow endpoint, or any provider. Tambo only renders the blocks
 * this deterministic reducer selects.
 */
export function TasteLabsDemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TasteLabsDemoState>(
    initialTasteLabsDemoState,
  );
  const dispatch = useCallback((action: TasteLabsDemoAction) => {
    setState((current) => reduceTasteLabsDemoState(current, action));
  }, []);
  const value = useMemo(
    () => ({ ...state, dispatch }),
    [dispatch, state],
  );

  return (
    <TasteLabsDemoContext.Provider value={value}>
      {children}
    </TasteLabsDemoContext.Provider>
  );
}

export function useTasteLabsDemo(): TasteLabsDemoContextValue {
  const context = useContext(TasteLabsDemoContext);
  if (!context) {
    throw new Error(
      "Taste Labs components must render inside TasteLabsDemoProvider.",
    );
  }
  return context;
}
