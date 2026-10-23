/*
 * Menu commands: items in Obsidian's macOS menu bar turned into commands, so
 * they can have Obsidian hotkeys. This part is pure; menu-runner.ts clicks
 * the item through System Events.
 */

/** Apple Intelligence's Writing Tools in Edit › Writing Tools, named as
 * macOS names them (AppKit's WritingTools string table, English). */
export const WRITING_TOOLS = [
  "Show Writing Tools",
  "Proofread",
  "Rewrite",
  "Make Friendly",
  "Make Professional",
  "Make Concise",
  "Summarize",
  "Create Key Points",
  "Make List",
  "Make Table",
  "Compose…",
] as const;

const WRITING_TOOLS_MENU = ["Edit", "Writing Tools"];

/** A menu item, from the menu bar down: ["Edit", "Writing Tools", "Summarize"]. */
export type MenuPath = string[];

export interface MenuSettings {
  writingToolsCommands: boolean;
  writingTools: string[];
  menuCommands: string;
}

/**
 * "Window > Minimize", one per line, into paths. `>`, `›`, `→` and `->`
 * all separate levels. A line needs a menu and an item; others are skipped.
 */
export function parseMenuPaths(text: string): MenuPath[] {
  const paths: MenuPath[] = [];
  for (const line of text.split(/\r?\n/)) {
    const path = line
      .split(/->|[>›→]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (path.length >= 2) paths.push(path);
  }
  return paths;
}

/** Stable from the path alone, so a hotkey stays bound to the same item. */
export function menuCommandId(path: MenuPath): string {
  const slug = path
    .join(" ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return `menu-${slug}`;
}

export function menuCommandName(path: MenuPath): string {
  const isWritingTool =
    path.length === 3 && path[0] === WRITING_TOOLS_MENU[0] && path[1] === WRITING_TOOLS_MENU[1];
  return isWritingTool ? `Writing Tools: ${path[2]}` : path.join(" › ");
}

/** Every menu command the settings ask for, each once. */
export function menuPaths(settings: MenuSettings): MenuPath[] {
  const tools = settings.writingToolsCommands
    ? WRITING_TOOLS.filter((item) => settings.writingTools.includes(item)).map((item) => [
        ...WRITING_TOOLS_MENU,
        item,
      ])
    : [];
  const seen = new Set<string>();
  return [...tools, ...parseMenuPaths(settings.menuCommands)].filter((path) => {
    const id = menuCommandId(path);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Clicks the item given as arguments (menu bar item first). Arguments rather
 * than text pasted into the script, so no menu name needs escaping. Each menu
 * on the way is opened as a mouse would: macOS asks the app what's selected
 * as a menu opens, and Writing Tools pressed in a closed menu can act on a
 * stale answer. A greyed-out item is reported instead of clicked, and on any
 * error Escape closes the menus again.
 */
export const CLICK_SCRIPT = `on run argv
  tell application "System Events"
    tell (first application process whose bundle identifier is "md.obsidian")
      set target to menu bar item (item 1 of argv) of menu bar 1
      try
        click target
        repeat with i from 2 to count of argv
          set target to menu item (item i of argv) of menu 1 of target
          if i < (count of argv) then click target
        end repeat
        if not (enabled of target) then error "Greyed out" number 7001
        click target
      on error message number code
        key code 53
        error message number code
      end try
    end tell
  end tell
end run`;

/** Reads the menu bar without clicking anything: needs both permissions,
 * and asks macOS for the Automation one the first time. */
export const PROBE_SCRIPT = `tell application "System Events"
  tell (first application process whose bundle identifier is "md.obsidian")
    get name of menu bar item 1 of menu bar 1
  end tell
end tell`;

export type MenuFailure = "automation" | "accessibility" | "missing" | "disabled" | "starting" | "other";

/** What went wrong, from osascript's error text. "starting": System Events,
 * which macOS quits when idle, was still starting up; trying again works. */
export function classifyMenuError(message: string): MenuFailure {
  if (/-600\b/.test(message)) return "starting";
  if (/-1743\b/.test(message)) return "automation";
  if (/-25211\b|-1719\b|assistive access/i.test(message)) return "accessibility";
  if (/\(7001\)/.test(message)) return "disabled";
  if (/-1728\b/.test(message)) return "missing";
  return "other";
}

const PRIVACY = "System Settings → Privacy & Security";

/** A sentence for a Notice or the settings tab. */
export function explainMenuFailure(failure: MenuFailure, path: MenuPath | null, detail = ""): string {
  const item = path ? `"${path.join(" › ")}"` : "the menu item";
  const isWritingTool = path !== null && menuCommandName(path).startsWith("Writing Tools:");
  switch (failure) {
    case "automation":
      return (
        `Plainsight needs permission to use the menus: allow Obsidian to control System Events ` +
        `under ${PRIVACY} → Automation.`
      );
    case "accessibility":
      return `Plainsight needs permission to use the menus: turn on Obsidian under ${PRIVACY} → Accessibility.`;
    case "disabled":
      return isWritingTool
        ? `${item} is greyed out right now. Select some text in a note first.`
        : `${item} is greyed out right now.`;
    case "missing":
      return isWritingTool
        ? `There's no ${item} in the menu bar. Writing Tools needs Apple Intelligence turned on, ` +
            `and shows only while you're typing in a note.`
        : `There's no ${item} in the menu bar. Names must match the menu exactly, in your Mac's language.`;
    case "starting":
      return `macOS's System Events didn't start in time for ${item}. Try again.`;
    case "other":
      return `Couldn't use ${item}${detail ? `: ${detail}` : "."}`;
  }
}
