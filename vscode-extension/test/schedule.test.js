const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const core = require('../media/schedule-core');
const model = require('../model');
const root = path.join(__dirname, '../..');
const course = { start_date: '2026-11-02', end_date: '2026-11-13', meeting_days: 'MWF', holidays: [] };
const topics = ['One', 'Two', 'Exam', 'Three', 'Four', 'Five'].map((title, i) => ({ title, _key: 't' + i, ...(title === 'Exam' ? { fixed_date: '2026-11-06', exam: true, links: [{ text: 'Guide', url: 'files/a.pdf' }] } : {}) }));
test('locks reserve dates while floating topics fill remaining meetings', () => {
  const result = core.resolve(course, { topics });
  assert.deepEqual(result.days.map(d => d.topic.title), ['One', 'Two', 'Exam', 'Three', 'Four', 'Five']);
  const moved = core.move(course, topics, 0, '2026-11-11');
  const after = core.resolve(course, { topics: moved });
  assert.deepEqual(after.days.map(d => d.topic.title), ['Two', 'Three', 'Exam', 'Four', 'One', 'Five']);
  assert.equal(after.days[2].topic.links[0].url, 'files/a.pdf');
  assert.throws(() => core.move(course, topics, 0, '2026-11-06'), /unlocked/);
  assert.throws(() => core.move(course, topics, 2, '2026-11-11'), /Unlock/);
});
test('swap exchanges only source and destination', () => {
  const moved = core.move(course, topics, 0, '2026-11-11', true);
  assert.deepEqual(core.resolve(course, { topics: moved }).days.map(d => d.topic.title), ['Four', 'Two', 'Exam', 'Three', 'One', 'Five']);
});
test('holidays reflow topics, retain overflow, and identify lock conflicts', () => {
  const changed = { ...course, holidays: [{ date: '2026-11-04', name: 'Break' }] };
  const result = core.resolve(changed, { topics });
  assert.equal(result.days[2].topic.title, 'Exam');
  assert.equal(result.extras[0].topic.title, 'Five');
  assert.equal(result.days[3].topic.title, 'Two');
  assert.match(core.resolve({ ...course, holidays: [{ date: '2026-11-06' }] }, { topics }).errors[0], /not a class meeting/);
  assert.match(core.resolve(course, { topics: [...topics, { title: 'Collision', fixed_date: '2026-11-06' }] }).errors[0], /Two topics/);
});
test('blank meetings survive moving, clearing and serialization', () => {
  const short = [{ title: 'First', _key: 't0' }];
  const moved = core.move(course, short, 0, '2026-11-13');
  assert.equal(moved.length, 6);
  assert.equal(core.resolve(course, { topics: moved }).days[5].topic.title, 'First');
  assert.equal(core.resolve(course, { topics: moved }).days[0].topic.title, '');
});
test('date validation rejects rollover, backwards ranges and malformed dates', () => {
  for (const value of ['2026-02-30', '2026-13-01', '2026-1-01']) assert.throws(() => core.date(value));
  assert.throws(() => core.range('2026-11-02', '2026-11-01'));
});
for (const folder of ['courses/ltn110', 'example-clas2200']) {
  test(folder + ' loads and unchanged saves are byte-for-byte identical', () => {
    const s = fs.readFileSync(path.join(root, folder, 'schedule.yaml'), 'utf8');
    const c = fs.readFileSync(path.join(root, folder, 'course.yaml'), 'utf8');
    const state = model.load(s, c), saved = model.serialize(s, c, state);
    assert.equal(saved.scheduleText, s);
    assert.equal(saved.courseText, c);
    assert.equal(core.resolve(state.course, state.schedule).errors.length, 0);
    const python = `import sys,json,datetime as dt\nsys.path.insert(0, 'scripts')\nimport new_course\nc=json.loads(sys.argv[1])\nholidays=[{k:dt.date.fromisoformat(v) if k in ('date','start','end') else v for k,v in h.items()} for h in c['holidays']]\nprint(json.dumps([str(d) for d,h in new_course.build_calendar(dt.date.fromisoformat(c['start_date']),dt.date.fromisoformat(c['end_date']),c['meeting_days'],holidays) if not h]))`;
    const dates = JSON.parse(execFileSync('python3', ['-c', python, JSON.stringify(model.clean(state.course))], { cwd: root, encoding: 'utf8' }));
    assert.deepEqual(core.calendar(state.course).filter(d => !d.holiday).map(d => d.date), dates);
  });
  test(folder + ' edits and reorders retain attachments and scheduling after reopening', () => {
    const s = fs.readFileSync(path.join(root, folder, 'schedule.yaml'), 'utf8');
    const c = fs.readFileSync(path.join(root, folder, 'course.yaml'), 'utf8');
    const state = model.load(s, c);
    const built = core.resolve(state.course, state.schedule);
    const exam = built.days.find(d => d.topic?.exam);
    state.schedule.topics[exam.index].fixed_date = exam.date;
    state.schedule.topics[0].notes = 'Colon: text\n*Markdown* and "quotes".';
    const expectedLinks = state.schedule.topics.filter(t => t.links).flatMap(t => t.links.map(l => l.url)).sort();
    state.schedule.topics = core.move(state.course, state.schedule.topics, 0, built.days.filter(d => !d.holiday)[5].date);
    const saved = model.serialize(s, c, state), reopened = model.load(saved.scheduleText, saved.courseText);
    const after = core.resolve(reopened.course, reopened.schedule);
    assert.equal(after.days.find(d => d.date === exam.date).topic.fixed_date, exam.date);
    assert.deepEqual(reopened.schedule.topics.filter(t => t.links).flatMap(t => t.links.map(l => l.url)).sort(), expectedLinks);
    assert.deepEqual(after.days.map(d => d.topic?.title), core.resolve(state.course, state.schedule).days.map(d => d.topic?.title));
    assert.equal(saved.courseText, c);
    // Regenerated comments must not duplicate on subsequent changes.
    reopened.schedule.topics[0].title += '!';
    const twice = model.serialize(saved.scheduleText, saved.courseText, reopened);
    assert.equal((twice.scheduleText.match(/# Meeting:/g) || []).length, built.days.filter(d => !d.holiday).length);
  });
}
test('unknown fields and user comments survive holiday and topic edits', () => {
  const s = '# Keep this header\ncustom: preserved\ntopics:\n  - title: Topic # teacher note\n    custom_field: keep\nassignments: []\n';
  const c = 'code: TEST\nstart_date: 2026-11-02\nend_date: 2026-11-13\nmeeting_days: MWF\nholidays: []\nrevised: 2026-11-01 # keep footer\n';
  const state = model.load(s, c);
  state.schedule.topics[0].title = 'Changed: title';
  state.course.holidays.push({ date: '2026-11-04', name: 'Break' });
  const saved = model.serialize(s, c, state);
  assert.match(saved.scheduleText, /teacher note/);
  assert.match(saved.scheduleText, /Keep this header/);
  assert.match(saved.scheduleText, /custom_field: keep/);
  assert.match(saved.courseText, /keep footer/);
  assert.equal(model.load(saved.scheduleText, saved.courseText).course.holidays[0].date, '2026-11-04');
});
