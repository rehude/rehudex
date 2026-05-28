import pc from "picocolors";
import type { UiAdapter } from "./types.js";
import { ClassicAdapter } from "./classic.js";

export type UiType = "classic" | "ink";

export function createUiAdapter(type: UiType = "classic"): UiAdapter {
  switch (type) {
    case "classic":
      return new ClassicAdapter();
    case "ink":
      // Ink adapter 尚未实现,本次回退到 classic
      console.warn(pc.yellow("⚠ Ink UI 尚未实现,本次回退到 classic"));
      return new ClassicAdapter();
    default:
      throw new Error(`Unknown UI type: ${type}`);
  }
}

export { ClassicAdapter };
export type { UiAdapter, UiEvent, UiEventType } from "./types.js";
