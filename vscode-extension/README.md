# Syllabusser Schedule Editor

Edit this repo's course schedules inside VS Code, without starting a server.

## Install once

In VS Code, run **Extensions: Install from VSIX…** from the Command Palette and select `syllabusser-schedule-editor-0.1.4.vsix` from this folder. Then open a `schedule.yaml` file. If it opens as text, right-click its tab and choose **Reopen Editor With… → Schedule Editor**.

**Syllabusser: Open Schedule** lists schedules in the current workspace.

## Edit a schedule

- Click anywhere in a meeting card to edit its topic, notes, exam flag, links, or date lock. Weeks use fixed weekday columns, including empty spaces at the start and end of term. Meeting numbers count class meetings, excluding holidays.
- Selecting a meeting places the cursor in **Topic**. Press **Return** in Topic to apply the edit.
- **Apply** updates the open YAML document. **Save** or **Cmd+S / Ctrl+S** applies the form and saves both the schedule and its holiday changes.
- Drag an unlocked topic to another meeting to reorder it. Other unlocked topics shift; locked topics stay on their dates.
- Under **More**, **Clear topic** leaves an empty slot. **Delete & shift** shifts later unlocked topics forward. Unlock a topic before deleting it.
- **Add file…** copies files into the course's `files/` folder and inserts relative links. You can also drop files onto a topic (up to 50 MB per drop). **Course files…** attaches files already there. Duplicate filenames offer Rename, Use existing, or Replace. Removing a link leaves the file on disk.
- **+ Holiday** accepts one date or a range, previews the schedule changes, and updates `course.yaml`. A holiday cannot overlap a locked topic until you unlock or reschedule it.
- **+ Assignment** creates a dated assignment. Edit its due date in the details panel; topic moves and holidays do not change assignment dates.
- Topics that do not fit appear under **Unscheduled**. They remain in the YAML and can be dragged back onto the calendar.
- **Preview** shows the resolved schedule and Markdown notes. **YAML** switches back to the text editor.
- **Undo / Redo** use VS Code's document history. File imports and replacements are filesystem operations and are not undone when you undo a link.

The editor detects text edits made in other tabs. An unfinished form is kept visible if the files change, and the editor requires **Reload files** before applying it. Form drafts are retained in VS Code's webview state for restoration when the editor is recreated. Applied edits use VS Code's normal unsaved-document and recovery behavior.

## File format

Existing string and mapping topics work without migration. An optional `fixed_date: "YYYY-MM-DD"` reserves a meeting for that topic. Other topics fill available meetings in list order. Holidays do not consume topics. Duplicate locks and locks on non-meeting days are reported as errors.

The editor preserves unknown YAML fields and user comments. When the schedule changes, it replaces generated week/date hints with current `# Meeting: YYYY-MM-DD` comments; the first save can therefore produce a formatting diff. Dates are strings, and quotes and multiline text are serialized automatically. No changes are made merely by opening a schedule.

The final exam remains a separate field in `course.yaml`; it is displayed in the editor. Course dates and meeting days can be changed in the YAML text editor.

## Develop from VS Code

Open the repository root, choose **Run and Debug → Schedule Editor**, and press **F5**. The launch task installs dependencies and prepares the extension automatically. A separate Extension Development Host window opens with this repository. Open a schedule there.

For command-line development, use Node.js 22.12 or newer (required by the packaging tool):

```sh
cd vscode-extension
npm ci
npm run build
npm test
npx playwright install chromium
npx playwright test test/editor.spec.js
npm run package
```

The public site and editor share `assets/schedule-core.js`. `npm run build` copies it and the existing Markdown renderer into the extension package; the public site still needs no build step.

The extension uses VS Code's [custom text editor API](https://code.visualstudio.com/api/extension-guides/custom-editors) and [webview API](https://code.visualstudio.com/api/extension-guides/webview). YAML node editing uses [yaml](https://eemeli.org/yaml/).
