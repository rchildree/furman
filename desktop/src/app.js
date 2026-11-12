import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  YAML,
  model,
  core,
  today,
  parse,
  patch,
  manifest,
  Drafts,
  themeFields,
  themeValues,
  themeCSS,
  fonts,
} from "./domain.js";
const invoke = (command, args = {}) =>
  window.__SYLLABUSSER_TEST__
    ? window.__SYLLABUSSER_TEST__(command, args)
    : tauriInvoke(command, args);
const $ = (s) => document.querySelector(s),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const button = (action, text, extra = "") =>
  `<button data-action="${action}" ${extra}>${text}</button>`;
let root,
  drafts,
  library,
  courses = [],
  slug,
  tab = "schedule",
  appearanceScope = "global",
  previewPage = "schedule.html",
  mobile = false,
  previewDate = today(),
  review,
  busy = false,
  noticeTimer;
const coursePath = (name) => `courses/${slug}/${name}`;
const editorId = () => encodeURIComponent(`${root}|${slug}`);
const editorKey = () => `editor:${decodeURIComponent(editorId())}`;
function notice(text, error = false) {
  clearTimeout(noticeTimer);
  $("#notice").textContent = text;
  $("#notice").className = error ? "error" : "";
  $("#notice").hidden = false;
  noticeTimer = setTimeout(
    () => ($("#notice").hidden = true),
    error ? 15000 : 5000,
  );
}
function fail(e) {
  console.error(e);
  notice(e.message || String(e), true);
}
async function task(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (e) {
    fail(e);
  } finally {
    busy = false;
  }
}
function stats() {
  const n = drafts?.changed.length || 0;
  const el = $("#save-label");
  if (el)
    el.textContent = n
      ? `${n} unsaved ${n === 1 ? "file" : "files"}`
      : "Saved locally";
}
function current() {
  return courses.find((c) => c.slug === slug);
}
function send(message) {
  $("#schedule-editor")?.contentWindow.postMessage(message, location.origin);
}
function state() {
  const loaded = model.load(
    drafts.text(coursePath("schedule.yaml")),
    drafts.text(coursePath("course.yaml")),
  );
  return {
    type: "state",
    course: loaded.course,
    schedule: loaded.schedule,
    version: drafts.version,
    courseVersion: drafts.version,
    dirty:
      drafts.dirty(coursePath("schedule.yaml")) ||
      drafts.dirty(coursePath("course.yaml")),
  };
}
function editorState() {
  try {
    send(state());
  } catch (e) {
    send({ type: "error", fatal: true, message: e.message });
  }
}
function remember() {
  localStorage.setItem("syllabusser:last", JSON.stringify({ root, slug }));
}
async function open(path) {
  try {
    root = await invoke("open_library", { path });
    drafts = new Drafts(invoke, localStorage, `drafts:${root}`);
    await drafts.load([
      "courses.yaml",
      "assets/theme.css",
      "assets/custom.css",
    ]);
    library = manifest(drafts.text("courses.yaml"));
    await loadLibrary();
    remember();
    render();
    if (drafts.changed.length) notice("Recovered your unsaved local changes.");
  } catch (e) {
    root = null;
    drafts = null;
    slug = undefined;
    render();
    throw e;
  }
}
async function loadLibrary() {
  library = manifest(drafts.text("courses.yaml"));
  await drafts.load(
    library.courses.map((c) => `courses/${c.slug}/course.yaml`),
  );
  courses = library.courses.map((c) => ({
    ...c,
    ...parse(drafts.text(`courses/${c.slug}/course.yaml`)).toJS(),
    slug: c.slug,
    status: c.status || "current",
  }));
  if (!courses.some((c) => c.slug === slug))
    slug =
      courses.find((c) => c.status === "current")?.slug || courses[0]?.slug;
  if (slug)
    await drafts.load(
      [
        "schedule.yaml",
        "info.md",
        "policies.md",
        "theme.css",
        "custom.css",
      ].map(coursePath),
    );
}
function render() {
  if (!root) {
    $("#shell").innerHTML =
      `<div class="empty"><h1>Syllabusser</h1><p>Open your course repository to edit schedules, update course pages, and publish to GitHub.</p>${button("open", "Open course folder…", 'class="primary"')}<p><small>Choose the folder containing courses.yaml. Your courses stay in their existing files.</small></p></div>`;
    return;
  }
  const c = current();
  $("#shell").innerHTML =
    `<div class="app-layout"><aside class="library"><div class="brand"><span class="brand-mark">S</span>Syllabusser</div>${button("new", "+ New course")}<div class="course-list">${[
      "current",
      "archived",
    ]
      .map(
        (status) =>
          `<div class="library-label">${status === "current" ? "Courses" : "Archived"}</div>${courses
            .filter((c) => c.status === status)
            .map(
              (c) =>
                `<button class="course-button ${c.slug === slug ? "active" : ""}" data-course="${esc(c.slug)}"><b>${esc(c.code || c.slug)}</b><small>${esc(c.term)}</small></button>`,
            )
            .join("")}`,
      )
      .join(
        "",
      )}</div><div class="library-footer">${button("publish-view", "Review & publish")}${button("open", "Open another folder…")}<div class="library-path">${esc(root.split("/").slice(-2).join("/"))}</div></div></aside><section class="workspace"><header class="topbar"><div><h1>${esc(c?.title || "Course library")}</h1><p class="muted">${esc(c ? [c.code, c.term, c.status === "archived" ? "Archived" : ""].filter(Boolean).join(" · ") : library.title)}</p></div><div class="spacer"></div><span class="save-label" id="save-label"></span>${button("reload", "Reload", 'title="Reload files from disk"')}${button("save", "Save", 'class="primary"')}</header><nav class="tabs" aria-label="Course sections">${[
      ["schedule", "Schedule"],
      ["facts", "Course details"],
      ["info", "Info"],
      ["policies", "Policies"],
      ["files", "Files"],
      ["appearance", "Appearance"],
      ["preview", "Site preview"],
    ]
      .map(
        ([id, label]) =>
          `<button class="tab ${tab === id ? "active" : ""}" data-tab="${id}">${label}</button>`,
      )
      .join("")}</nav><div class="view" id="view"></div></section></div>`;
  stats();
  renderView().catch(fail);
}
async function renderView() {
  const view = $("#view");
  if (tab === "publish") {
    await showReview();
    return;
  }
  if (!slug) {
    view.innerHTML =
      '<div class="empty"><h2>No courses yet</h2><p>Use New course to create your first course.</p></div>';
    return;
  }
  if (tab === "schedule") {
    view.innerHTML = `<iframe id="schedule-editor" title="Schedule editor" src="editor/index.html?id=${editorId()}"></iframe>`;
    return;
  }
  if (tab === "facts") {
    showFacts();
    return;
  }
  if (tab === "info" || tab === "policies") {
    const path = coursePath(`${tab}.md`);
    view.innerHTML = `<div class="page"><div class="page-head"><div><h2>${tab === "info" ? "Course information" : "Course policies"}</h2><p>Write in Markdown. Save to update the site preview.</p></div><div class="spacer"></div>${button("site-preview", "Preview")}</div><label><span class="muted">${tab}.md</span><textarea class="markdown-editor" id="markdown" spellcheck="true">${esc(drafts.text(path))}</textarea></label></div>`;
    $("#markdown").oninput = (e) => {
      drafts.set({ [path]: e.target.value });
      stats();
    };
    return;
  }
  if (tab === "files") {
    await showFiles();
    return;
  }
  if (tab === "appearance") {
    showAppearance();
    return;
  }
  if (tab === "preview") {
    view.innerHTML = `<div class="preview-pane" style="height:100%">${previewMarkup()}</div>`;
    bindPreview();
    return;
  }
}
function field(key, label, value, type = "text", extra = "") {
  return `<label>${label}<input name="${key}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function showFacts() {
  const c = parse(drafts.text(coursePath("course.yaml"))).toJS();
  $("#view").innerHTML =
    `<div class="page"><div class="page-head"><div><h2>Course details</h2><p>Dates and meeting days determine the schedule. R means Thursday; U means Sunday.</p></div></div><form id="facts" class="form-grid">${[
      ["code", "Course code"],
      ["title", "Title"],
      ["term", "Term"],
      ["instructor", "Instructor"],
      ["email", "Email"],
      ["location", "Location"],
      ["meeting_time", "Meeting time"],
      ["meeting_days", "Meeting days"],
    ]
      .map(([k, l]) => field(k, l, c[k]))
      .join(
        "",
      )}${field("start_date", "First class", c.start_date, "date")}${field("end_date", "Last class", c.end_date, "date")}${field("final_date", "Final exam date", c.final_exam?.date, "date")}${field("final_time", "Final exam time", c.final_exam?.time)}</form><div class="form-section"><p class="muted">${current().status === "archived" ? "Archived courses remain accessible on the website." : "Archive when this offering has ended. Its existing URL will stay the same."}</p><div class="spacer"></div>${button("archive", current().status === "archived" ? "Restore course" : "Archive course")}</div></div>`;
  $("#facts").oninput = () => {
    const values = Object.fromEntries(new FormData($("#facts")));
    const final = {
      ...c.final_exam,
      date: values.final_date,
      time: values.final_time,
    };
    delete values.final_date;
    delete values.final_time;
    values.final_exam = final.date ? final : null;
    drafts.set({
      [coursePath("course.yaml")]: patch(
        drafts.text(coursePath("course.yaml")),
        values,
      ),
    });
    stats();
  };
  $("#facts").onsubmit = (e) => e.preventDefault();
}
async function saveAll() {
  const affected = new Set(
    drafts.changed
      .filter((p) =>
        /^courses\/[^/]+\/(course|schedule)\.yaml$|^courses\/[^/]+\/(info|policies)\.md$/.test(
          p,
        ),
      )
      .map((p) => p.split("/")[1]),
  );
  for (const s of affected) {
    const cp = `courses/${s}/course.yaml`,
      sp = `courses/${s}/schedule.yaml`;
    await drafts.load([cp, sp]);
    model.validate(model.load(drafts.text(sp), drafts.text(cp)));
    drafts.set({ [cp]: patch(drafts.text(cp), { revised: today() }) });
  }
  manifest(drafts.text("courses.yaml"));
  await drafts.save();
  await loadLibrary();
  stats();
  notice("Saved to your course folder.");
}
async function save() {
  if (tab === "schedule" && $("#schedule-editor"))
    send({ type: "requestSave" });
  else await saveAll();
}
function hasPendingForms() {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(`editor:${root}|`)) {
      try {
        if (JSON.parse(localStorage.getItem(k))?.draft) return true;
      } catch {}
    }
  }
  return false;
}
let bridgeQueue = Promise.resolve();
window.addEventListener("message", (e) => {
  if (e.source === $("#site-preview")?.contentWindow) {
    if (e.data.type === "preview-ready") sendTheme();
    if (e.data.type === "external-link")
      invoke("open_url", { url: e.data.url }).catch(fail);
    return;
  }
  if (
    e.source !== $("#schedule-editor")?.contentWindow ||
    e.origin !== location.origin ||
    e.data?.channel !== "schedule"
  )
    return;
  const message = e.data.message;
  bridgeQueue = bridgeQueue.then(async () => {
    busy = true;
    try {
      if (message.type === "ready") return editorState();
      if (message.type === "edit") {
        if (
          message.version !== drafts.version ||
          message.courseVersion !== drafts.version
        )
          throw new Error(
            "The course changed. Reload the calendar before applying this edit.",
          );
        const out = model.serialize(
          drafts.text(coursePath("schedule.yaml")),
          drafts.text(coursePath("course.yaml")),
          message,
        );
        drafts.set({
          [coursePath("schedule.yaml")]: out.scheduleText,
          [coursePath("course.yaml")]: out.courseText,
        });
        if (message.save) await saveAll();
        editorState();
        stats();
        return;
      }
      if (message.type === "undo" || message.type === "redo") {
        drafts.travel(message.type, message.type === "undo" ? "redo" : "undo");
        editorState();
        stats();
        return;
      }
      if (message.type === "source") {
        await sourceDialog();
        editorState();
        return;
      }
      if (message.type === "attach") {
        if (message.version !== drafts.version)
          throw new Error(
            "The course changed. Reload before attaching a file.",
          );
        let paths;
        if (message.existing) {
          const files = await invoke("list_files", {
            dir: coursePath("files"),
          });
          const chosen = await chooseFile(files);
          paths = chosen ? [chosen] : [];
        } else if (message.uploads)
          paths = await invoke("upload_files", {
            dir: coursePath("files"),
            uploads: message.uploads,
          });
        else paths = await invoke("import_files", { dir: coursePath("files") });
        if (paths.length) {
          const next = state(),
            topic = next.schedule.topics.find((t) => t._key === message.key);
          if (!topic)
            throw new Error(
              "Select the meeting again. Files were added to the course folder.",
            );
          topic.links ||= [];
          for (const p of paths)
            topic.links.push({
              text: p.split("/").pop(),
              url: p
                .slice(`courses/${slug}/`.length)
                .split("/")
                .map(encodeURIComponent)
                .join("/"),
            });
          const out = model.serialize(
            drafts.text(coursePath("schedule.yaml")),
            drafts.text(coursePath("course.yaml")),
            next,
          );
          drafts.set({
            [coursePath("schedule.yaml")]: out.scheduleText,
            [coursePath("course.yaml")]: out.courseText,
          });
          stats();
        }
        editorState();
      }
    } catch (err) {
      send({ type: "error", message: err.message || String(err) });
      fail(err);
    } finally {
      busy = false;
    }
  });
});
function dialog(html, handle) {
  const d = $("#dialog");
  d.innerHTML = html + '<p class="error" id="dialog-error" role="alert"></p>';
  d.showModal();
  return new Promise((resolve) => {
    d.onclose = () => resolve(null);
    d.onclick = async (e) => {
      const action = e.target.closest("[data-dialog]")?.dataset.dialog;
      if (!action) return;
      if (action === "cancel") {
        d.close();
        return;
      }
      const b = e.target.closest("button");
      b.disabled = true;
      try {
        const value = await handle(action, d);
        if (value !== false) {
          d.close();
          resolve(value);
        }
      } catch (err) {
        $("#dialog-error").textContent = err.message || String(err);
      } finally {
        b.disabled = false;
      }
    };
  });
}
async function chooseFile(files) {
  if (!files.length) {
    notice("This course has no files yet. Use Add file.");
    return null;
  }
  return dialog(
    `<h2>Course files</h2><label>File<select id="file-choice">${files.map((p) => `<option value="${esc(p)}">${esc(p.split("/").slice(2).join("/"))}</option>`).join("")}</select></label><div class="actions">${'<button data-dialog="cancel">Cancel</button><button class="primary" data-dialog="choose">Attach file</button>'}</div>`,
    () => $("#file-choice").value,
  );
}
async function sourceDialog() {
  return dialog(
    `<h2>Schedule YAML</h2><p class="muted">Apply updates the local draft. Save writes it to your course folder.</p><label><textarea id="source">${esc(drafts.text(coursePath("schedule.yaml")))}</textarea></label><div class="actions"><button data-dialog="cancel">Cancel</button><button class="primary" data-dialog="apply">Apply</button></div>`,
    () => {
      const text = $("#source").value;
      model.validate(model.load(text, drafts.text(coursePath("course.yaml"))));
      drafts.set({ [coursePath("schedule.yaml")]: text });
      stats();
      return true;
    },
  );
}
async function showFiles() {
  const source = slug;
  const files = await invoke("list_files", { dir: coursePath("files") });
  if (tab !== "files" || slug !== source) return;
  $("#view").innerHTML =
    `<div class="page"><div class="page-head"><div><h2>Course files</h2><p>Files are copied into this course’s folder. Existing names receive a numeric suffix.</p></div><div class="spacer"></div>${button("import", "Add files…", 'class="primary"')}</div>${files.length ? files.map((p) => `<div class="file-row"><code>${esc(p.slice(`courses/${slug}/`.length))}</code>${button("copy-path", "Copy link", `data-path="${esc(p.slice(`courses/${slug}/`.length).split("/").map(encodeURIComponent).join("/"))}"`)}</div>`).join("") : '<p class="muted">No files yet. Add handouts, readings, or other course materials.</p>'}</div>`;
}
function previewURL() {
  const protocol = window.__SYLLABUSSER_PREVIEW__ || "preview://localhost/";
  return `${protocol}courses/${encodeURIComponent(slug)}/${previewPage}?today=${previewDate}&v=${Date.now()}`;
}
function previewMarkup() {
  return `<div class="preview-tools"><strong>Site preview</strong><select id="preview-page" aria-label="Preview page">${[
    ["index.html", "Today"],
    ["schedule.html", "Schedule"],
    ["info.html", "Info"],
    ["policies.html", "Policies"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${v === previewPage ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select><input id="preview-date" type="date" aria-label="Preview date" value="${previewDate}"><div class="spacer"></div>${button("device", mobile ? "Mobile" : "Desktop")}${button("refresh-preview", "↻", 'aria-label="Refresh preview" title="Refresh saved site"')}</div><div class="preview-stage ${mobile ? "mobile" : ""}"><iframe id="site-preview" title="Course website preview" sandbox="allow-scripts" src="${previewURL()}"></iframe></div>`;
}
function bindPreview() {
  $("#preview-page").onchange = (e) => {
    previewPage = e.target.value;
    $("#site-preview").src = previewURL();
  };
  $("#preview-date").onchange = (e) => {
    previewDate = e.target.value;
    $("#site-preview").src = previewURL();
  };
  $("#site-preview").onload = () => sendTheme();
}
function showAppearance() {
  const prefix = appearanceScope === "global" ? "assets" : `courses/${slug}`,
    path = `${prefix}/theme.css`,
    custom = `${prefix}/custom.css`;
  const defaults = Object.fromEntries(themeFields.map(([k, , , v]) => [k, v]));
  const global = themeValues(drafts.text("assets/theme.css"));
  const own = themeValues(drafts.text(path));
  const values = { ...defaults, ...global, ...own };
  $("#view").innerHTML =
    `<div class="appearance"><aside class="controls"><h2>Website appearance</h2><p>Changes preview immediately. Save to keep them; publish when ready.</p><label>Apply to<select id="scope"><option value="global" ${appearanceScope === "global" ? "selected" : ""}>All courses</option><option value="course" ${appearanceScope === "course" ? "selected" : ""}>${esc(current().code)} only</option></select></label>${themeFields
      .map(
        ([k, l, t, , min, max, unit]) =>
          `<div class="control"><label for="theme-${k}">${l}</label>${
            t === "font"
              ? `<select id="theme-${k}" data-theme="${k}">${Object.entries(
                  fonts,
                )
                  .map(
                    ([v, l]) =>
                      `<option value="${esc(v)}" ${values[k] === v ? "selected" : ""}>${l}</option>`,
                  )
                  .join("")}</select>`
              : `<div class="control-unit"><input id="theme-${k}" aria-label="${l}" data-theme="${k}" type="${t}" value="${esc(t === "number" ? parseFloat(values[k]) : values[k])}" ${t === "number" ? `min="${min}" max="${max}" step="${unit ? "1" : "0.1"}"` : ""}>${unit || ""}</div>`
          }</div>`,
      )
      .join(
        "",
      )}<div class="form-section">${button("reset-theme", appearanceScope === "global" ? "Reset controls" : "Use global settings")}</div><details class="advanced"><summary>Custom CSS</summary><p style="margin-top:10px">Stored separately from the controls above.</p><label><span class="muted">${esc(custom)}</span><textarea id="custom-css" spellcheck="false" placeholder=".site-title { … }">${esc(drafts.text(custom))}</textarea></label></details></aside><section class="preview-pane">${previewMarkup()}</section></div>`;
  $("#scope").onchange = (e) => {
    appearanceScope = e.target.value;
    showAppearance();
  };
  for (const el of document.querySelectorAll("[data-theme]"))
    el.oninput = () => {
      try {
        const key = el.dataset.theme,
          def = themeFields.find((f) => f[0] === key);
        own[key] = el.value + (def[2] === "number" ? def[6] || "" : "");
        drafts.set({ [path]: themeCSS(drafts.text(path), own) });
        stats();
        sendTheme();
      } catch (e) {
        notice(e.message, true);
      }
    };
  $("#custom-css").oninput = (e) => {
    drafts.set({ [custom]: e.target.value });
    stats();
    sendTheme();
  };
  bindPreview();
}
function sendTheme() {
  if (!slug) return;
  const global =
      drafts.text("assets/theme.css") + "\n" + drafts.text("assets/custom.css"),
    course =
      drafts.text(coursePath("theme.css")) +
      "\n" +
      drafts.text(coursePath("custom.css"));
  $("#site-preview")?.contentWindow.postMessage(
    { type: "theme-preview", global, course },
    "*",
  );
}
async function newCourse() {
  await dialog(
    `<h2>New course</h2><form id="new-course" class="form-grid">${field("slug", "Folder name", "", "text", 'placeholder="ltn110-spring2027" required pattern="[a-z0-9][a-z0-9_-]*"')}${field("code", "Course code", "", "text", "required")}${field("title", "Title", "", "text", "required")}${field("term", "Term", "", "text", 'placeholder="Spring 2027" required')}${field("instructor", "Instructor", current()?.instructor || "")}${field("meeting_days", "Meeting days", "MWF", "text", "required")}${field("start_date", "First class", "", "date", "required")}${field("end_date", "Last class", "", "date", "required")}</form><div class="actions"><button data-dialog="cancel">Cancel</button><button class="primary" data-dialog="create">Create course</button></div>`,
    async () => {
      const form = $("#new-course");
      if (!form.reportValidity()) return false;
      const values = Object.fromEntries(new FormData(form)),
        s = values.slug;
      delete values.slug;
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(s) || courses.some((c) => c.slug === s))
        throw new Error(
          "Choose a new folder name using lowercase letters, numbers, hyphens, or underscores.",
        );
      const days = core.calendar({ ...values, holidays: [] });
      if (!days.length) throw new Error("These dates contain no meetings.");
      const paths = [
        "course.yaml",
        "schedule.yaml",
        "info.md",
        "policies.md",
        "index.html",
        "schedule.html",
        "info.html",
        "policies.html",
      ].map((n) => `courses/${s}/${n}`);
      await drafts.load(paths);
      if (paths.some((p) => drafts.files[p].base !== null || drafts.text(p)))
        throw new Error(
          "That course folder already has files. Choose another name.",
        );
      const data = { ...values, holidays: [], revised: today() };
      const output = {
        [paths[0]]: YAML.stringify(data),
        [paths[1]]: YAML.stringify({
          topics: days.map(() => ({ title: "" })),
          assignments: [],
        }),
        [paths[2]]: "# Course information\n\n",
        [paths[3]]: "# Course policies\n\n",
      };
      for (const name of ["index", "schedule", "info", "policies"])
        output[`courses/${s}/${name}.html`] =
          `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(values.code)} — ${esc(values.title)}</title><link rel="stylesheet" href="../../assets/styles.css"></head><body data-page="${name === "index" ? "now" : name}"><div class="wrap" id="app">Loading…</div><script src="../../assets/vendor/js-yaml.min.js"></script><script src="../../assets/vendor/marked.min.js"></script><script src="../../assets/schedule-core.js"></script><script src="../../assets/app.js"></script></body></html>\n`;
      const d = parse(drafts.text("courses.yaml"));
      d.get("courses").add({ slug: s, status: "current" });
      output["courses.yaml"] = d.toString();
      // New course + manifest are one checked save; unrelated drafts remain drafts.
      await invoke("save_files", {
        changes: Object.entries(output).map(([path, text]) => ({
          path,
          expected: drafts.files[path].base,
          text,
        })),
      });
      for (const [path, text] of Object.entries(output))
        drafts.files[path] = { base: text, text };
      drafts.persist();
      slug = s;
      tab = "schedule";
      await loadLibrary();
      remember();
      render();
      return true;
    },
  );
}
async function archive() {
  const status = current().status === "archived" ? "current" : "archived";
  await dialog(
    `<h2>${status === "archived" ? "Archive" : "Restore"} ${esc(current().code)}?</h2><p>${status === "archived" ? "It will move to the Archived list. Its files and website URL stay in place." : "It will return to the current course list."}</p><div class="actions"><button data-dialog="cancel">Cancel</button><button class="primary" data-dialog="confirm">${status === "archived" ? "Archive" : "Restore"}</button></div>`,
    async () => {
      const d = parse(drafts.text("courses.yaml"));
      d.get("courses")
        .items.find((n) => n.get("slug") === slug)
        .set("status", status);
      drafts.set({ "courses.yaml": d.toString() });
      await saveAll();
      render();
      return true;
    },
  );
}
async function showReview() {
  $("#view").innerHTML =
    '<div class="page"><p class="muted">Reading local Git changes…</p></div>';
  try {
    review = await invoke("git_review");
    if (tab !== "publish") return;
    $("#view").innerHTML =
      `<div class="page"><div class="page-head"><div><h2>Review & publish</h2><p>Only checked files go into this commit. Publishing pushes to ${esc(review.branch)} on GitHub.</p></div><div class="spacer"></div>${button("refresh-review", "Refresh")}${button("deployment", "Deployment status")}</div><div class="review-summary"><strong>${esc(review.remote)}</strong><br>Branch ${esc(review.branch)} · ${review.ahead} local commits ahead · ${review.behind} behind${review.excluded ? `<br>${review.excluded} changes outside the course site are excluded.` : ""}<br>GitHub runs the repository’s existing Pages or Actions deployment after the push.</div>${drafts.changed.length || hasPendingForms() ? '<div class="warning">Unsaved drafts are not included. Save your edits before publishing.</div>' : ""}${review.staged ? '<div class="warning">There are staged changes in Git. Commit or unstage them in VS Code before using this publisher.</div>' : ""}<div id="publish-result"></div>${review.files.length ? review.files.map((f) => `<details class="review-file"><summary><label><input type="checkbox" data-publish-path="${esc(f.path)}" checked><code>${esc(f.status.trim())}</code> ${esc(f.path)}</label></summary><pre>${esc(f.diff || "File removed.")}</pre></details>`).join("") : '<p class="muted">No course file changes to commit.</p>'}<div class="publish-bar"><input id="commit-message" aria-label="Commit message" value="Update course materials">${button("publish", "Commit & push", 'class="primary" ' + (!review.files.length || review.staged ? "disabled" : ""))}${review.ahead ? button("push", "Push existing commits") : ""}</div><div id="deployment-result"></div></div>`;
  } catch (e) {
    $("#view").innerHTML =
      `<div class="page"><h2>Publishing is unavailable</h2><p class="warning">${esc(e.message || e)}</p><p class="muted">Open a Git repository with a GitHub origin remote. Git uses your existing authentication. Course editing works offline.</p>${button("refresh-review", "Try again")}</div>`;
  }
}
async function validatePublish(paths) {
  if (drafts.changed.length || hasPendingForms())
    throw new Error(
      "Save all drafts and apply unfinished schedule forms before publishing.",
    );
  const m = manifest(drafts.text("courses.yaml"));
  for (const c of m.courses) {
    const cp = `courses/${c.slug}/course.yaml`,
      sp = `courses/${c.slug}/schedule.yaml`;
    const disk = await invoke("read_files", { paths: [cp, sp] });
    model.validate(model.load(disk[sp], disk[cp]));
  }
  for (const path of paths) {
    const match =
      /^courses\/([^/]+)\/(schedule\.yaml|info\.md|policies\.md)$/.exec(path);
    if (match) {
      const metadata = `courses/${match[1]}/course.yaml`;
      if (
        review.files.some((f) => f.path === metadata) &&
        !paths.includes(metadata)
      )
        throw new Error(
          `Also select ${metadata} to publish the updated revision date.`,
        );
    }
  }
  if (!paths.length) throw new Error("Select at least one file.");
}
async function publish() {
  const paths = [
    ...document.querySelectorAll("[data-publish-path]:checked"),
  ].map((e) => e.dataset.publishPath);
  await validatePublish(paths);
  $("#publish-result").innerHTML =
    '<p class="warning">Checking GitHub, committing selected files, and pushing…</p>';
  const result = await invoke("git_publish", {
    token: review.token,
    paths,
    message: $("#commit-message").value,
  });
  await showReview();
  $("#publish-result").innerHTML =
    `<p class="${result.pushed ? "success" : "warning"}">${esc(result.message)}<br><code>${esc(result.commit.slice(0, 10))}</code></p>`;
}
async function deployments() {
  const el = $("#deployment-result");
  el.innerHTML = '<p class="muted">Checking GitHub…</p>';
  try {
    const data = await invoke("deployment");
    const runs = data.runs || [];
    el.innerHTML = `<h3>Deployment for ${esc(data.commit.slice(0, 10))}</h3>${runs.map((r) => `<div class="file-row"><span>${esc(r.name)} · ${esc(r.conclusion || r.status)}</span>${button("external", "View run", `data-url="${esc(r.html_url)}"`)}</div>`).join("")}${data.build ? `<p class="muted">Latest Pages build: ${esc(data.build.status)} · ${data.build.commit === data.commit ? "this commit" : "a different commit"}</p>` : ""}${data.pages?.html_url ? button("external", "Open published site", `data-url="${esc(data.pages.html_url)}"`) : ""}${!runs.length && !data.build ? '<p class="warning">No deployment found for this commit. Check the repository’s Pages settings or Actions workflow on GitHub.</p>' : ""}`;
  } catch (e) {
    el.innerHTML = `<p class="warning">${esc(e.message || e)}</p>`;
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.closest("#dialog")) return;
  task(async () => {
    if (b.dataset.course) {
      slug = b.dataset.course;
      await drafts.load(
        [
          "schedule.yaml",
          "info.md",
          "policies.md",
          "theme.css",
          "custom.css",
        ].map(coursePath),
      );
      remember();
      render();
      return;
    }
    if (b.dataset.tab) {
      tab = b.dataset.tab;
      render();
      return;
    }
    const a = b.dataset.action;
    if (a === "open") {
      const path = await invoke("choose_folder");
      if (path) await open(path);
    }
    if (a === "save") await save();
    if (a === "reload") {
      await dialog(
        '<h2>Reload files from disk?</h2><p>This discards unsaved drafts in this folder, including unfinished schedule forms.</p><div class="actions"><button data-dialog="cancel">Cancel</button><button data-dialog="reload" class="danger">Discard drafts & reload</button></div>',
        async () => {
          await drafts.reload();
          for (const k of Object.keys(localStorage))
            if (k.startsWith(`editor:${root}|`)) localStorage.removeItem(k);
          await loadLibrary();
          render();
          return true;
        },
      );
    }
    if (a === "new") await newCourse();
    if (a === "archive") await archive();
    if (a === "site-preview") {
      previewPage = `${tab}.html`;
      tab = "preview";
      render();
    }
    if (a === "publish-view" || a === "refresh-review") {
      tab = "publish";
      render();
    }
    if (a === "publish") await publish();
    if (a === "push") {
      const r = await invoke("git_push", { head: review.head });
      await showReview();
      $("#publish-result").innerHTML =
        `<p class="${r.pushed ? "success" : "warning"}">${esc(r.message)}</p>`;
    }
    if (a === "deployment") await deployments();
    if (a === "import") {
      await invoke("import_files", { dir: coursePath("files") });
      await showFiles();
    }
    if (a === "copy-path") {
      await navigator.clipboard.writeText(b.dataset.path);
      notice("File link copied.");
    }
    if (a === "external") await invoke("open_url", { url: b.dataset.url });
    if (a === "device") {
      mobile = !mobile;
      $(".preview-stage").classList.toggle("mobile", mobile);
      b.textContent = mobile ? "Mobile" : "Desktop";
    }
    if (a === "refresh-preview") $("#site-preview").src = previewURL();
    if (a === "reset-theme") {
      const p =
        appearanceScope === "global"
          ? "assets/theme.css"
          : coursePath("theme.css");
      drafts.set({ [p]: themeCSS(drafts.text(p), {}) });
      stats();
      showAppearance();
    }
  });
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    task(save);
  }
});
async function boot() {
  render();
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem("syllabusser:last"));
  } catch {}
  if (saved?.root) {
    slug = saved.slug;
    try {
      await open(saved.root);
    } catch (e) {
      root = null;
      render();
      fail(e);
    }
  }
}
boot();
