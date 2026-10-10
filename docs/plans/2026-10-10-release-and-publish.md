# Release and Publish Plan

Date: 2026-10-10
Status: Parked. Agreed approach; not started.

**Goal:** make Plainsight releasable: clean up what shouldn't ship, generate release notes and versions automatically from commits, and publish to the Obsidian Community Plugins directory.

**Approach:** commits already follow Conventional Commits (`feat:`, `fix:`, `style:`, `docs:`, `chore:`), so release-please can turn them into a changelog and version bumps. A release PR is opened and kept up to date on every push to `main`. Merging it tags the release, and a build workflow attaches the three files Obsidian installs. Publishing is a one-time PR to `obsidianmd/obsidian-releases`, opened from Magnus's GitHub account.

**Work on a `chore/release` branch.** Per CLAUDE.md, update the README in the same commit as any user-visible change.

---

## Findings this plan is based on (checked 2026-10-10)

- **The repo is public.** No personal names or vault content appear anywhere in the git history or tracked files. The only personal detail is the hardcoded vault path in `deploy.mjs`.
- **`minAppVersion` is too low.** It's `1.5.0`, but the plugin awaits `workspace.revealLeaf`, which returns a Promise only from **1.7.2** (`@since` in `obsidian.d.ts`). Everything else used is older.
- **Debug code ships today:** the "Dump syntax tree" and "Copy block DOM" commands, the `Mod-Alt-d` keymap, and two `console.log` calls (`src/main.ts`).
- **Inline styles:** `src/sidebar/view.ts` sets `element.style` in six places (`--ps-nav-width`, `--ps-depth`, and `display` in `fitTagRows`). Obsidian's review lint prefers CSS classes or `setCssProps`.
- **Undocumented APIs**, all isolated in `src/sidebar/internals.ts` and failing safely: Bookmarks `items`/`removeItem`/`on("changed")`, `vault.getConfig`/`setConfig`, `app.commands.executeCommandById`, `app.internalPlugins`, `app.setting`. Plus the Tasks plugin's `apiV1`.

---

## Task 1: Remove debug code

- Delete the `dump-syntax-tree` and `dump-block-dom` commands, the `Mod-Alt-d` keymap, `describeBlockDom`, `copyDump` and the `console.log` calls from `src/main.ts`.
- Remove any imports this leaves unused (e.g. `treeOf` and `enclosingCallout`, if nothing else uses them).
- Verify with `npm run build` and `npx vitest run`, and `git grep -n "console\.log" src` must be empty.
- Commit: `chore: remove debug commands before release`.

## Task 2: Correct the manifest

- **`manifest.json`:**
  - `minAppVersion` → `"1.7.2"`.
  - Rewrite `description` to cover both halves, in one sentence ending with a period, without the word "Obsidian". For example: "Edit Markdown without seeing its syntax, and browse notes, tasks and attachments from a two-column sidebar."
  - Add `authorUrl` (Magnus's site or GitHub profile).
  - Add `fundingUrl`, if wanted.
- **`package.json`:** keep `version` in step with the manifest.
- Commit: `chore: manifest for publishing`.

## Task 3: Stop shipping a personal path

- **`deploy.mjs`:** read the target from `OBSIDIAN_PLUGIN_DIR`, falling back to a git-ignored `.env.local` read by a few lines of code (no new dependency). If neither is set, exit with a clear message and don't guess a path.
- Add `.env.local` to `.gitignore`. Magnus creates his own `.env.local` with his vault path.
- **README → Development:** document `OBSIDIAN_PLUGIN_DIR` / `.env.local`.
- Commit: `chore: deploy target from env, not the repo`.

## Task 4: No inline styles

- **CSS variables** (`--ps-nav-width`, `--ps-depth`): set them with `el.setCssProps({ "--ps-nav-width": … })`.
- **`display` toggles in `fitTagRows`:** replace them with a class, `.ps-hidden { display: none; }`, added and removed instead.
- Re-check card rendering in the vault, including the `+N` tag folding and resizing the sidebar.
- Commit: `refactor(sidebar): CSS classes and setCssProps instead of inline styles`.

## Task 5: versions.json

- Add `versions.json` at the repo root, mapping each plugin version to its `minAppVersion`, e.g. `{ "0.2.0": "1.7.2" }`. Obsidian uses it to offer older plugin versions to older apps.
- Commit: `chore: versions.json`.

## Task 6: Release automation

**`release-please-config.json`**
- `release-type: "node"`, with `CHANGELOG.md` as the changelog.
- `extra-files`, so the bump also updates the `version` in `manifest.json` and adds the new version to `versions.json`. If the generic JSON updater can't add a key to `versions.json`, a version-bump script run from the build workflow does it instead.
- Changelog sections:
  - **Features** ← `feat`
  - **Bug fixes** ← `fix`
  - **Polish** ← `style` and `refactor`
  - hidden ← `docs`, `chore` and `test`
- Tag format: **no `v` prefix**, because Obsidian requires the tag to equal the manifest version exactly (`include-v-in-tag: false`).

**`.release-please-manifest.json`:** the current version.

**`.github/workflows/release-please.yml`:** runs on push to `main` and keeps the release PR up to date.

**`.github/workflows/release.yml`:** runs when a release is published, or on a tag push.
- `npm ci`, `npx vitest run`, `npm run build`.
- Attach `main.js`, `manifest.json` and `styles.css` to the release (`gh release upload <tag> …`).
- Fail the run if the tag doesn't equal `manifest.json`'s `version`.

**Test it:** merge to `main` and check that a release PR appears with a sensible CHANGELOG. Don't merge that PR until Task 7.

Commit: `ci: release-please and release build`.

## Task 7: First release, on GitHub only

- Merge the release PR. Check that the GitHub Release has the generated notes and the three assets, and that its tag equals the manifest version.
- **Magnus** installs it via BRAT (a community plugin that installs other plugins straight from GitHub) on desktop and on his phone, to confirm the release files work outside the dev deploy.
- Fix anything found, then release again.

## Task 8: Submit to the Community Plugins directory

**Claude prepares, Magnus opens the PR from his account.**

1. Fork `obsidianmd/obsidian-releases`, and add to the end of `community-plugins.json`:
   ```json
   {
     "id": "plainsight",
     "name": "Plainsight",
     "author": "Magnus",
     "description": "<same as manifest.json>",
     "repo": "magnusmoaner/obsidian-plainsight"
   }
   ```
2. Open the PR with the template's checklist completed. Point reviewers to:
   - **"Take over rendering"** changes the vault's Live Preview setting. It's off by default, opt-in, and the previous value is restored when it's turned off or the plugin is disabled.
   - **Cmd+B / Cmd+I / Cmd+`** and **Cmd+Opt+0…6** are bound in a CodeMirror keymap inside the editor. They aren't command hotkeys, but Cmd+B and Cmd+I override Obsidian's own bindings while editing.
   - **Undocumented APIs** are isolated in one file, read defensively, and hide their feature if unavailable.
   - **Writes to notes** are minimal, line-based edits that refuse unrecognised shapes rather than re-serializing YAML.
3. **The automated bot** checks the manifest and release within minutes. Fix anything it reports by publishing a new release; the PR doesn't need to change.
4. **Human review** commonly takes weeks. Reply to review comments on the PR.
5. **After approval,** every GitHub release appears in Obsidian's plugin browser automatically.

## Verification

- `npx vitest run` and `npm run build` pass on `chore/release`.
- `git grep -n -E "console\.log|\.style\.|/Users/" -- src deploy.mjs` returns nothing.
- After Task 7, a fresh install via BRAT works on desktop and mobile.
- A test commit (`fix: …`) after the first release updates the release PR with a patch bump and a "Bug fixes" changelog entry.

## Open decisions for Magnus

- `authorUrl` and `fundingUrl` values.
- The first public version number: `0.2.0` (suggested), or `1.0.0` once links are finished.
- Whether to publish before or after links slices 3–5. Slices 1–2 already render links; publishing early gets the review queue started.
