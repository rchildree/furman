# Syllabusser desktop

A Tauri 2 macOS app for the course repository. It reads and writes ordinary YAML,
Markdown, CSS, and attachments. No database or local HTTP server is required.

## Open the app

Double-click **Syllabusser.app** in this directory after building. The actual
bundle is in `src-tauri/target/release/bundle/macos/Syllabusser.app`; you can copy
that bundle to Applications. Choose the repository folder containing
`courses.yaml`. The app remembers the last folder and course.

From VS Code, use **Tasks: Run Task → Open Syllabusser desktop**. For development,
select **Syllabusser desktop** in Run and Debug and press **F5**. The task starts
the app for you. You do not need to start a web server.

## Editing

- **Schedule:** drag topics, lock dates, edit holidays and assignments, attach
  files, undo/redo, or edit YAML. Return in Topic applies the form. Save or ⌘S
  writes the applied changes. The existing VS Code calendar UI is shared.
- **Course details:** edit dates, meeting days, instructor, location, and final
  exam. Invalid calendars or conflicting locks block saving.
- **Info / Policies:** edit Markdown; Save then open Site preview.
- **Files:** import with the native file picker or attach directly to a meeting.
  Name collisions get a numeric suffix. Importing copies files immediately;
  undoing a schedule link does not delete the attachment.
- **New course:** creates the metadata, schedule, Markdown pages, HTML stubs,
  and manifest entry together. Use a distinct folder name for a new offering.
- **Archive:** changes the manifest status while preserving the URL and files.
  Unlike the existing archive Python script, it does not rename the folder.

Applied edits and unfinished schedule forms are recovered on reopening. An
outside edit blocks saving instead of overwriting that file. Reload explicitly
discards local drafts. Save checks all affected courses, including locks, and
updates their `revised` dates. Empty saves are harmless.

## Website appearance

Appearance controls edit the website, not the desktop interface:

1. Select **All courses** or the current course.
2. Change colors, text size, font, content width, and line spacing.
3. Inspect the real site in the desktop/mobile preview, including its Today,
   Schedule, Info, and Policies pages. The date picker simulates another day.
4. Save locally, then review and publish when ready.

The cascade is `assets/styles.css` → `assets/theme.css` → `assets/custom.css` →
`courses/<slug>/theme.css` → `courses/<slug>/custom.css`. Optional files can be
absent. Theme controls replace only their marked block. Custom CSS is kept in a
separate file. Reset controls preserves handwritten CSS. Course overrides win
when editing the global theme. Course content in preview comes from saved files;
appearance drafts preview immediately.

The preview uses a read-only custom protocol and a sandboxed iframe. It cannot
access the native file or Git commands. Local paths are checked for traversal
and symlinks.

## GitHub publishing

**Review & publish** shows local changes to the site files. Select the files,
review their diffs, enter a commit message, and choose **Commit & push**.

The first version uses installed Git and your existing GitHub authentication.
Deployment status also uses the GitHub CLI (`gh`) when available. It expects a
GitHub `origin`, an existing commit, a configured Git author, and a branch that
tracks the same branch on origin. It does not create a repository or sign you
into GitHub. No credentials are stored in the frontend.

The publisher checks the reviewed file versions, fetches origin, and stops when
the branch is behind. It refuses pre-existing staged changes. Commits are built
with an isolated Git index and update the branch with an expected-HEAD check;
unselected files stay out of the commit. Local hooks are not run; revision dates
are updated by the app before review. Pushes never force overwrite remote history.
A failed push leaves the local commit intact and offers **Push existing commits**.
That action pushes *all* existing commits ahead of the remote on the branch.

A successful push and a successful deployment are separate states. **Deployment
status** checks Actions runs for the exact commit and the latest Pages build.
The existing GitHub Pages configuration or Actions workflow handles deployment;
this app does not change repository hosting settings. Conflict resolution remains
in VS Code. No real publish is performed by the test suite.

## Build and test

Prerequisites for building: Node 22+, Rust, and Xcode command-line tools on macOS.
These are not required merely to launch the bundled app (Git is needed to publish).

```sh
cd desktop
npm ci
npm run app       # release .app and a convenient link in this directory
npm test          # draft/YAML/theme tests
npm run test:ui   # Playwright tests with a mocked native bridge
cargo test --manifest-path src-tauri/Cargo.toml
```

For browser tests, install Chromium once with `npx playwright install chromium`.
The test server is automatic and is used only by tests. `npm run dev` builds the
frontend and launches Tauri without a separate dev server; restart it after
frontend changes. `npm run app` rebuilds the standalone app.

This release is an Apple Silicon local build. Signing/notarization, Intel/Windows
packages, a built-in GitHub sign-in flow, course duplication, and signed automatic
app updates are not configured. Update this local app by rebuilding it. Website
updates already use the review/publish flow above.

## Save recovery

Multi-file saves check all original contents before changing anything, stage
replacement files, and restore earlier files if a write fails. An interrupted
save leaves `.syllabusser-recovery/changes.json` and replacement files in the
repository. Opening stops while that directory exists so another save cannot
hide the evidence. `changes.json` contains the original (`expected`) and new
(`text`) contents for each path. Inspect and restore the desired versions, then
remove the recovery directory before reopening. Do not commit this directory.

## Implementation

`src/app.js` is the desktop shell; `src/domain.js` manages drafts and theme/YAML
changes. The calendar is bundled from `../vscode-extension/media` with the same
YAML model and `../assets/schedule-core.js`. Rust commands in `src-tauri/src`
handle scoped files, native pickers, Git, and the isolated preview protocol.
The capability manifest permits those commands only for the local main window.
