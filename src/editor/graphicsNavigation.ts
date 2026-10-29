import type { GraphicsFocus } from "../core/graphics";

export function requestGraphicsEditor(focus: GraphicsFocus): void {
  window.dispatchEvent(new CustomEvent<GraphicsFocus>("yellow-editor:open-graphics", { detail: focus }));
}
