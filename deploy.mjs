// Copies the built plugin into the local Obsidian vault for testing.
// Override the target with OBSIDIAN_PLUGIN_DIR.
import { copyFileSync, mkdirSync } from "fs";
import { join } from "path";

const dest =
  process.env.OBSIDIAN_PLUGIN_DIR ??
  "/Users/magnus/Library/Mobile Documents/iCloud~md~obsidian/Documents/moaner./.obsidian/plugins/plainsight";

mkdirSync(dest, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  copyFileSync(file, join(dest, file));
}
console.log(`Deployed to ${dest}`);
