'use strict';
const YAML = require('yaml');
const core = require('./media/schedule-core');

function parse(text, name) {
  const doc = YAML.parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(name + ': ' + doc.errors[0].message);
  if (!YAML.isMap(doc.contents)) throw new Error(name + ' must contain a YAML mapping.');
  return doc;
}
function list(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(name + ' must be a list.');
  return value;
}
function load(scheduleText, courseText) {
  const scheduleDoc = parse(scheduleText, 'schedule.yaml'), courseDoc = parse(courseText, 'course.yaml');
  const schedule = scheduleDoc.toJS(), course = courseDoc.toJS();
  schedule.topics = list(schedule.topics, 'topics').map((t, i) => {
    if (t != null && typeof t !== 'string' && (typeof t !== 'object' || Array.isArray(t))) throw new Error('Topic ' + (i + 1) + ' must be text or a mapping.');
    return { ...core.topic(t), _key: 't' + i };
  });
  schedule.assignments = list(schedule.assignments, 'assignments').map((a, i) => ({ ...a, _key: 'a' + i }));
  course.holidays = list(course.holidays, 'holidays').map((h, i) => ({ ...h, _key: 'h' + i }));
  core.calendar(course);
  return { schedule, course, scheduleDoc, courseDoc };
}
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => k !== '_key').map(([k, v]) => [k, clean(v)]));
  return value;
}
function equal(a, b) { return JSON.stringify(clean(a)) === JSON.stringify(clean(b)); }

// Patch existing nodes instead of dumping parsed objects: retain comments and unknown fields.
function patchNode(doc, node, value) {
  if (YAML.isMap(node) && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const pair of [...node.items]) if (!Object.hasOwn(value, String(pair.key.value))) node.delete(pair.key.value);
    for (const [key, next] of Object.entries(value)) {
      const before = node.get(key, true);
      if (equal(before?.toJSON(), next)) continue;
      node.set(key, patchNode(doc, before, next));
    }
    return node;
  }
  if (YAML.isScalar(node) && (typeof value !== 'object' || value === null)) { node.value = value; return node; }
  const next = doc.createNode(value);
  if (node && next) { next.commentBefore = node.commentBefore; next.comment = node.comment; next.spaceBefore = node.spaceBefore; }
  return next;
}
function patchList(doc, field, values, prefix) {
  const before = doc.get(field, true);
  const originals = YAML.isSeq(before) ? [...before.items] : [];
  const used = new Set();
  const nodes = values.map(item => {
    const match = new RegExp('^' + prefix + '(\\d+)$').exec(item._key || '');
    const key = match ? Number(match[1]) : -1;
    if (key >= 0 && (key >= originals.length || used.has(key))) throw new Error('The document changed. Reload before editing.');
    used.add(key);
    const original = originals[key];
    let value = clean(item);
    // Preserve shorthand strings until the user adds notes, a lock or an attachment.
    if (prefix === 't' && YAML.isScalar(original) && Object.keys(value).every(k => k === 'title')) value = value.title;
    return patchNode(doc, original, value);
  });
  const sequence = YAML.isSeq(before) ? before : doc.createNode([]);
  sequence.items = nodes;
  doc.set(field, sequence);
}
function validate(state) {
  const result = core.resolve(state.course, state.schedule);
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  for (const t of state.schedule.topics) {
    if (typeof t.title !== 'string') throw new Error('Topic titles must be text.');
    for (const l of list(t.links, 'links')) {
      if (!l || typeof l.url !== 'string' || typeof l.text !== 'string') throw new Error('Each link needs a label and URL.');
      if (/^\s*(javascript|data|vbscript):/i.test(l.url)) throw new Error('Use a file path or web address for links.');
    }
  }
  for (const a of state.schedule.assignments) {
    core.date(a.due);
    if (!a.title?.trim()) throw new Error('Each assignment needs a title.');
  }
}
function serialize(scheduleText, courseText, next) {
  validate(next);
  const old = load(scheduleText, courseText);
  let scheduleOut = scheduleText, courseOut = courseText;
  if (!equal(old.schedule, next.schedule) || !equal(old.course.holidays, next.course.holidays)) {
    // Drop generated positional aids wherever they landed (including notes/links),
    // then regenerate dates from the actual calendar. Other comments are retained.
    const stripped = scheduleText.replace(/^\s*# ── Week.*\n/gm, '').replace(/^\s*#\s*\(no class .*\)\s*\n/gm, '')
      .replace(/[ \t]+# (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{4}-\d{2}-\d{2}[ \t]*(?=\r?$)/gm, '')
      .replace(/^\s*# Meeting: \d{4}-\d{2}-\d{2}\s*\n/gm, '');
    const doc = parse(stripped, 'schedule.yaml');
    patchList(doc, 'topics', next.schedule.topics, 't');
    patchList(doc, 'assignments', next.schedule.assignments, 'a');
    const nodes = doc.get('topics', true).items;
    for (const day of core.resolve(next.course, next.schedule).days) {
      if (day.index === undefined) continue;
      const n = nodes[day.index];
      n.commentBefore = [n.commentBefore, ' Meeting: ' + day.date].filter(Boolean).join('\n');
    }
    scheduleOut = doc.toString({ lineWidth: 0 });
  }
  if (!equal(old.course.holidays, next.course.holidays)) {
    patchList(old.courseDoc, 'holidays', next.course.holidays, 'h');
    courseOut = old.courseDoc.toString({ lineWidth: 0 });
  }
  return { scheduleText: scheduleOut, courseText: courseOut };
}
module.exports = { load, serialize, validate, clean };
