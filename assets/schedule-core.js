/* Shared by the public site and the VS Code editor. No DOM or VS Code APIs. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScheduleCore = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const letters = 'UMTWRFS';
  function date(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error('Use a date in YYYY-MM-DD format.');
    const d = new Date(value + 'T12:00:00Z');
    if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== value) throw new Error('Invalid date: ' + value);
    return d;
  }
  function range(start, end) {
    const first = date(start), last = date(end);
    if (last < first) throw new Error('The end date must be on or after the start date.');
    if ((last - first) / 86400000 > 1096) throw new Error('Date ranges cannot exceed three years.');
    const out = [];
    for (let d = first; d <= last; d = new Date(+d + 86400000)) out.push(d.toISOString().slice(0, 10));
    return out;
  }
  function calendar(course) {
    const meeting = (Array.isArray(course.meeting_days) ? course.meeting_days : String(course.meeting_days || '').replace(/\s/g, '').split('')).map(d => String(d).trim().toUpperCase());
    if (!meeting.length || meeting.some(d => !letters.includes(d) || d.length !== 1)) throw new Error('Meeting days must use M T W R F S U.');
    const holidays = new Map();
    for (const h of course.holidays || []) {
      for (const day of range(h.date || h.start, h.date || h.end)) holidays.set(day, h.name || 'Holiday');
    }
    return range(course.start_date, course.end_date).filter(d => meeting.includes(letters[date(d).getUTCDay()]))
      .map(d => ({ date: d, holiday: holidays.get(d) }));
  }
  function topic(value) {
    return typeof value === 'string' ? { title: value } : { ...(value || {}), title: value?.title || '' };
  }
  function resolve(course, schedule) {
    const days = calendar(course), topics = (schedule.topics || []).map(topic), errors = [];
    const available = new Map(days.filter(d => !d.holiday).map(d => [d.date, d]));
    const assigned = new Set();
    topics.forEach((t, index) => {
      if (!t.fixed_date) return;
      const slot = available.get(t.fixed_date);
      if (!slot) errors.push((t.title || 'Untitled topic') + ': locked date ' + t.fixed_date + ' is not a class meeting.');
      else if (slot.index !== undefined) errors.push('Two topics are locked to ' + t.fixed_date + '.');
      else { slot.index = index; slot.topic = t; assigned.add(index); }
    });
    const floating = topics.map((t, index) => ({ t, index })).filter(x => !x.t.fixed_date);
    let next = 0;
    for (const day of days) {
      if (day.holiday || day.index !== undefined) continue;
      const entry = floating[next++];
      if (entry) { day.index = entry.index; day.topic = entry.t; assigned.add(entry.index); }
    }
    return { days, errors, extras: topics.map((t, index) => ({ topic: t, index })).filter(x => !assigned.has(x.index)) };
  }
  // Materialize empty meetings so deleting or editing an empty day cannot move later topics.
  function ordered(course, topics) {
    const result = resolve(course, { topics });
    return [...result.days.filter(d => !d.holiday).map(d => d.topic || { title: '' }), ...result.extras.map(e => e.topic)];
  }
  function move(course, topics, source, targetDate, swap) {
    const result = resolve(course, { topics });
    const target = result.days.find(d => d.date === targetDate && !d.holiday);
    if (!topics[source] || topic(topics[source]).fixed_date) throw new Error('Unlock this topic before moving it.');
    if (!target || target.topic?.fixed_date) throw new Error('Choose an unlocked class meeting.');
    const all = ordered(course, topics).map(topic);
    const sourceItem = topic(topics[source]);
    // Stable editor keys identify the source even when empty meetings were materialized.
    const from = all.findIndex(t => t._key === sourceItem._key);
    const to = result.days.filter(d => !d.holiday).findIndex(d => d.date === targetDate);
    if (from < 0) throw new Error('The topic changed. Try again.');
    if (swap) [all[from], all[to]] = [all[to], all[from]];
    else {
      const unlockedPositions = all.map((t, i) => t.fixed_date ? -1 : i).filter(i => i >= 0);
      const floating = unlockedPositions.map(i => all[i]);
      const a = unlockedPositions.indexOf(from), b = unlockedPositions.indexOf(to);
      floating.splice(b, 0, floating.splice(a, 1)[0]);
      unlockedPositions.forEach((position, i) => { all[position] = floating[i]; });
    }
    return all;
  }
  return { date, range, calendar, topic, resolve, ordered, move };
});
