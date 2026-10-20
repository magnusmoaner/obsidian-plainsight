// Copies the built plugin into an Obsidian vault for testing. The target is
// OBSIDIAN_PLUGIN_DIR, from the environment or from .env.local (not in git).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

function fromEnvFile(name) {
  if (!existsSync(".env.local")) return undefined;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match && match[1] === name) return match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return undefined;
}

const dest = process.env.OBSIDIAN_PLUGIN_DIR ?? fromEnvFile("OBSIDIAN_PLUGIN_DIR");
if (!dest) {
  console.error(
    "Set OBSIDIAN_PLUGIN_DIR to your vault's .obsidian/plugins/plainsight folder, " +
      "in the environment or in a .env.local file:\n" +
      "  OBSIDIAN_PLUGIN_DIR=/path/to/vault/.obsidian/plugins/plainsight"
  );
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  copyFileSync(file, join(dest, file));
}
console.log(`Deployed to ${dest}`);
