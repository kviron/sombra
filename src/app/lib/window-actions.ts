import {tauri, type WindowResizeDirection} from '@/shared/api';

export type {WindowResizeDirection};

export function startWindowDrag() {
 return tauri.window.startDrag();
}

export function minimizeWindow() {
 return tauri.window.minimize();
}

export function toggleMaximizeWindow() {
 return tauri.window.toggleMaximize();
}

export function closeWindow() {
 return tauri.window.close();
}

export function startWindowResize(direction: WindowResizeDirection) {
 return tauri.window.startResize(direction);
}
