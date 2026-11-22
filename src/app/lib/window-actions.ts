import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/shared/api";

type AppWindow = ReturnType<typeof getCurrentWindow>;
export type WindowResizeDirection = Parameters<
  AppWindow["startResizeDragging"]
>[0];

async function runWindowAction(
  action: (appWindow: AppWindow) => Promise<void>,
) {
  if (!isTauri()) return;

  try {
    await action(getCurrentWindow());
  } catch (error) {
    console.error("Window action failed:", error);
  }
}

export function startWindowDrag() {
  return runWindowAction((appWindow) => appWindow.startDragging());
}

export function minimizeWindow() {
  return runWindowAction((appWindow) => appWindow.minimize());
}

export function toggleMaximizeWindow() {
  return runWindowAction((appWindow) => appWindow.toggleMaximize());
}

export function closeWindow() {
  return runWindowAction((appWindow) => appWindow.close());
}

export function startWindowResize(direction: WindowResizeDirection) {
  return runWindowAction((appWindow) =>
    appWindow.startResizeDragging(direction),
  );
}
