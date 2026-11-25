// An edge window (src-tauri/src/edge.rs): the lights of what's waiting, drawn
// on a see-through strip. Told everything by events, every second or so.

import "@fontsource/jetbrains-mono/400.css";
import { edgeLights } from "./edgelight.js";

const lights = edgeLights(document.getElementById("c"));

if ("__TAURI_INTERNALS__" in window) {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { invoke } = await import("@tauri-apps/api/core");
  const me = getCurrentWebviewWindow();
  lights.onSeen = (source) => invoke("dismiss_lantern", { source });
  me.listen("edge", (e) => lights.set(e.payload));
  me.listen("edge-pop", (e) => lights.pop(e.payload));
  me.listen("edge-cursor", (e) => lights.cursor(e.payload));
}
