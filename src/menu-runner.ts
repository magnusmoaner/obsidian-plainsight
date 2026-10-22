import { Platform } from "obsidian";
import type { ExecFileException } from "child_process";
import { CLICK_SCRIPT, classifyMenuError, MenuFailure, MenuPath, PROBE_SCRIPT } from "./menu-items";

/** Menus are clicked through System Events, which exists only on a Mac. */
export const canUseMenus = (): boolean => Platform.isMacOS && Platform.isDesktopApp;

export interface MenuResult {
  failure: MenuFailure | null;
  detail: string;
}

/** Once more if System Events was still starting (it quits when idle, and
 * the first call after that can come too early). */
async function osascript(script: string, args: string[]): Promise<MenuResult> {
  const result = await runOsascript(script, args);
  if (result.failure !== "starting") return result;
  await sleep(500);
  return runOsascript(script, args);
}

/** Loaded on use: child_process doesn't exist on mobile. A permission
 * prompt keeps osascript waiting, hence the long timeout. */
function runOsascript(script: string, args: string[]): Promise<MenuResult> {
  const { execFile } = window.require("child_process") as typeof import("child_process");
  return new Promise((resolve) => {
    execFile("osascript", ["-e", script, ...args], { timeout: 120_000 }, (error: ExecFileException | null, _out, err) => {
      if (!error) return resolve({ failure: null, detail: "" });
      const detail = (String(err).trim() || error.message).replace(/^\d+:\d+: execution error: /, "");
      resolve({ failure: classifyMenuError(detail), detail });
    });
  });
}

export const clickMenu = (path: MenuPath): Promise<MenuResult> => osascript(CLICK_SCRIPT, path);

/** Tries the menus without clicking: asks macOS for permission if needed. */
export const checkMenuAccess = (): Promise<MenuResult> => osascript(PROBE_SCRIPT, []);

/** System Settings, at the list where Obsidian needs turning on. */
export function openPrivacySettings(failure: "accessibility" | "automation"): void {
  const pane = failure === "accessibility" ? "Privacy_Accessibility" : "Privacy_Automation";
  const { execFile } = window.require("child_process") as typeof import("child_process");
  execFile("open", [`x-apple.systempreferences:com.apple.preference.security?${pane}`]);
}
