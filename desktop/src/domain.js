import YAML from "yaml";
import model from "../../vscode-extension/model.js";
import core from "../../assets/schedule-core.js";
export { YAML, model, core };
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function parse(text, name = "YAML") {
  const d = YAML.parseDocument(text, { uniqueKeys: true });
  if (d.errors.length) throw new Error(`${name}: ${d.errors[0].message}`);
  if (!YAML.isMap(d.contents)) throw new Error(`${name} must be a mapping.`);
  return d;
}
export function patch(text, values) {
  const d = parse(text);
  for (const [k, v] of Object.entries(values)) {
    if (JSON.stringify(d.get(k)?.toJSON?.() ?? d.get(k)) === JSON.stringify(v))
      continue;
    d.set(k, v);
  }
  return d.toString({ lineWidth: 0 });
}
export function manifest(text) {
  const m = parse(text, "courses.yaml").toJS();
  if (!Array.isArray(m.courses))
    throw new Error("courses.yaml needs a courses list.");
  const used = new Set();
  for (const c of m.courses) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(c.slug) || used.has(c.slug))
      throw new Error("Each course needs a unique simple folder name.");
    used.add(c.slug);
  }
  return m;
}
export const themeFields = [
  ["accent", "Link color", "color", "#1f40c4"],
  ["paper", "Page background", "color", "#fdfdfd"],
  ["ink", "Text color", "color", "#202124"],
  ["muted", "Secondary text", "color", "#6b7280"],
  ["base-size", "Text size", "number", "17px", 14, 24, "px"],
  ["content-width", "Content width", "number", "44rem", 32, 72, "rem"],
  ["body-leading", "Line spacing", "number", "1.5", 1.2, 2.2, ""],
  ["serif", "Body font", "font", '"Source Serif 4", Georgia, serif'],
];
export const fonts = {
  '"Source Serif 4", Georgia, serif': "Source Serif 4",
  "Georgia, serif": "Georgia",
  '"Nebula Sans", system-ui, sans-serif': "Nebula Sans",
  "system-ui, sans-serif": "System font",
};
export function themeValues(css) {
  const out = {};
  for (const [k] of themeFields) {
    const m = css?.match(new RegExp(`--${k}\\s*:\\s*([^;}]+)`));
    if (m) out[k] = m[1].trim();
  }
  return out;
}
export function themeCSS(original, values) {
  const cleaned = (original || "")
    .replace(/\/\* Syllabusser theme \*\/[\s\S]*?\/\* End theme \*\//g, "")
    .trim();
  const rules = themeFields
    .filter(([k]) => values[k] != null && values[k] !== "")
    .map(([k, , type, , min, max, unit]) => {
      let v = String(values[k]);
      if (type === "color" && !/^#[0-9a-f]{6}$/i.test(v))
        throw new Error("Choose a valid color.");
      if (type === "number") {
        const n = Number(v.replace(unit || "", ""));
        if (!Number.isFinite(n) || n < min || n > max)
          throw new Error(`${k} is out of range.`);
        v = n + (unit || "");
      }
      if (type === "font" && !Object.hasOwn(fonts, v))
        throw new Error("Choose a listed font.");
      return `  --${k}: ${v};`;
    });
  return (
    [
      cleaned,
      rules.length
        ? `/* Syllabusser theme */\n:root {\n${rules.join("\n")}\n}\n/* End theme */`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n") + "\n"
  );
}
export class Drafts {
  constructor(invoke, storage, key) {
    this.invoke = invoke;
    this.storage = storage;
    this.key = key;
    this.files = {};
    this.undo = [];
    this.redo = [];
    this.version = 1;
    try {
      this.files = JSON.parse(storage.getItem(key)) || {};
    } catch {}
  }
  async load(paths) {
    const missing = paths.filter((p) => !Object.hasOwn(this.files, p));
    if (missing.length) {
      const texts = await this.invoke("read_files", { paths: missing });
      for (const p of missing)
        this.files[p] = { base: texts[p], text: texts[p] };
    }
    return this;
  }
  text(p) {
    return this.files[p]?.text ?? "";
  }
  dirty(p) {
    const f = this.files[p];
    return f && f.base !== f.text;
  }
  get changed() {
    return Object.keys(this.files).filter((p) => this.dirty(p));
  }
  persist() {
    this.storage.setItem(
      this.key,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(this.files).filter(([p]) => this.dirty(p)),
        ),
      ),
    );
  }
  set(changes, history = true) {
    const before = {};
    for (const [p, text] of Object.entries(changes)) {
      if (!Object.hasOwn(this.files, p))
        throw new Error("Load the file before editing.");
      if (this.files[p].text !== text) {
        before[p] = this.files[p].text;
        this.files[p].text = text;
      }
    }
    if (Object.keys(before).length) {
      if (history) {
        this.undo.push(before);
        if (this.undo.length > 80) this.undo.shift();
        this.redo = [];
      }
      this.version++;
      this.persist();
    }
  }
  travel(from, to) {
    const changes = this[from].pop();
    if (!changes) return;
    const before = {};
    for (const p of Object.keys(changes)) before[p] = this.files[p].text;
    this.set(changes, false);
    this[to].push(before);
  }
  async save() {
    const paths = this.changed;
    if (!paths.length) return;
    await this.invoke("save_files", {
      changes: paths.map((p) => ({
        path: p,
        expected: this.files[p].base,
        text: this.files[p].text,
      })),
    });
    for (const p of paths) this.files[p].base = this.files[p].text;
    this.persist();
  }
  async reload() {
    const texts = await this.invoke("read_files", {
      paths: Object.keys(this.files),
    });
    this.files = Object.fromEntries(
      Object.entries(texts).map(([p, t]) => [p, { base: t, text: t }]),
    );
    this.undo = [];
    this.redo = [];
    this.version++;
    this.persist();
  }
}
