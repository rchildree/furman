import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
await build({
  entryPoints: ["src/domain.js"],
  outfile: "/tmp/syllabusser-domain.cjs",
  platform: "node",
  format: "cjs",
  bundle: true,
  plugins: [
    {
      name: "core",
      setup(b) {
        b.onResolve({ filter: /\.\/media\/schedule-core$/ }, () => ({
          path: new URL("../../assets/schedule-core.js", import.meta.url)
            .pathname,
        }));
      },
    },
  ],
});
const { Drafts, themeCSS, themeValues, manifest, patch, model } =
  await import("/tmp/syllabusser-domain.cjs");
function storage() {
  const m = new Map();
  return { getItem: (k) => m.get(k), setItem: (k, v) => m.set(k, v) };
}
test("draft recovery keeps original content for optimistic concurrency", async () => {
  let disk = { "courses.yaml": "old" },
    saved;
  const invoke = async (cmd, args) => {
    if (cmd === "read_files") return disk;
    saved = args.changes;
  };
  const s = storage();
  let d = new Drafts(invoke, s, "key");
  await d.load(["courses.yaml"]);
  d.set({ "courses.yaml": "draft" });
  disk["courses.yaml"] = "external";
  d = new Drafts(invoke, s, "key");
  await d.load(["courses.yaml"]);
  assert.equal(d.text("courses.yaml"), "draft");
  await d.save();
  assert.deepEqual(saved, [
    { path: "courses.yaml", expected: "old", text: "draft" },
  ]);
});
test("undo and redo retain saved baseline", async () => {
  const d = new Drafts(async () => ({ a: "original" }), storage(), "k");
  await d.load(["a"]);
  d.set({ a: "edit" });
  d.travel("undo", "redo");
  assert.equal(d.text("a"), "original");
  assert.deepEqual(d.changed, []);
  d.travel("redo", "undo");
  assert.equal(d.text("a"), "edit");
});
test("theme controls preserve custom content and replace their block", () => {
  let css = themeCSS("/* keep */\nh1 { color: red; }", {
    accent: "#123456",
    "base-size": "19px",
  });
  css = themeCSS(css, { accent: "#654321" });
  assert.match(css, /h1 \{ color: red; \}/);
  assert.equal((css.match(/Syllabusser theme/g) || []).length, 1);
  assert.deepEqual(themeValues(css), { accent: "#654321" });
  assert.throws(() => themeCSS("", { accent: "red; display:none" }));
});
test("manifest rejects path traversal and duplicate slugs", () => {
  assert.throws(() => manifest("courses:\n- slug: ../outside"));
  assert.throws(() => manifest("courses:\n- slug: latin\n- slug: latin"));
});
test("metadata retains comments and unknown fields", () => {
  const out = patch("# Keep\ncode: Latin # course\nunknown: yes\n", {
    code: "LTN 110",
  });
  assert.match(out, /# Keep/);
  assert.match(out, /# course/);
  assert.match(out, /unknown: yes/);
});
test("schedule adapter preserves source on no-op and checks locks", () => {
  const c =
    "code: LTN\nmeeting_days: MWF\nstart_date: 2026-11-02\nend_date: 2026-11-06\n";
  const s = "topics:\n- title: Intro # keep\n";
  const loaded = model.load(s, c);
  assert.equal(model.serialize(s, c, loaded).scheduleText, s);
  loaded.schedule.topics[0].fixed_date = "2026-11-03";
  assert.throws(() => model.serialize(s, c, loaded));
});
