import { useSyncExternalStore } from "react";
import { getDemoServerState, getDemoState, subscribeDemo, type DemoState } from "@/lib/demo";

/** Re-render on demo-store changes; SSR always sees the empty state. */
export function useDemoState(): DemoState {
  return useSyncExternalStore(subscribeDemo, getDemoState, getDemoServerState);
}
