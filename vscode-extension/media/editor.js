/* global acquireVsCodeApi, ScheduleCore, marked */
(() => {
  'use strict';
  const vscode = acquireVsCodeApi(), core = ScheduleCore, app = document.getElementById('app');
  const recovered = vscode.getState();
  let state, selectedDate = recovered?.selectedDate, selectedExtra = recovered?.selectedExtra, assignmentKey = recovered?.assignmentKey, baseSnapshot;
  let preview = false, busy = false, formDirty = false, incoming, error = '', holidayDraft;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const copy = value => JSON.parse(JSON.stringify(value));
  const snapshot = value => JSON.stringify({ course: value.course, schedule: value.schedule });
  const label = d => core.date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const newKey = () => 'new-' + Math.random().toString(36).slice(2);
  function markdown(value, inline = false) {
    const parsed = new DOMParser().parseFromString(inline ? marked.parseInline(value || '') : marked.parse(value || ''), 'text/html');
    const allowed = new Set(['P', 'BR', 'EM', 'STRONG', 'DEL', 'CODE', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR']);
    for (const el of [...parsed.body.querySelectorAll('*')].reverse()) {
      if (!allowed.has(el.tagName)) el.replaceWith(document.createTextNode(el.textContent));
      else for (const attribute of [...el.attributes]) el.removeAttribute(attribute.name);
    }
    return parsed.body.innerHTML;
  }
  const button = (action, text, attrs = '') => `<button type="button" data-action="${action}" ${attrs}>${text}</button>`;
  const field = (id, text, value, type = 'text') => `<label for="${id}">${text}</label><input id="${id}" type="${type}" value="${escape(value)}">`;
  function currentTopic() {
    const built = core.resolve(state.course, state.schedule);
    return selectedExtra ? state.schedule.topics.find(t => t._key === selectedExtra) : built.days.find(d => d.date === selectedDate)?.topic;
  }
  function collect(next) {
    if (document.getElementById('topic-title')) {
      const old = currentTopic();
      let t = old && next.schedule.topics.find(t => t._key === old._key);
      if (!t) {
        next.schedule.topics = core.ordered(next.course, next.schedule.topics);
        const days = core.resolve(next.course, next.schedule).days;
        t = next.schedule.topics[days.find(d => d.date === selectedDate).index];
        t._key = newKey();
      }
      t.title = document.getElementById('topic-title').value;
      const notes = document.getElementById('topic-notes').value;
      if (notes || Object.hasOwn(t, 'notes')) t.notes = notes;
      const exam = document.getElementById('topic-exam').checked;
      if (exam || Object.hasOwn(t, 'exam')) t.exam = exam;
      if (document.getElementById('topic-locked').checked) t.fixed_date = document.getElementById('topic-date').value;
      else delete t.fixed_date;
      const links = [...document.querySelectorAll('[data-link-row]')].map(row => ({ ...(t.links || [])[Number(row.dataset.linkRow)], text: row.querySelector('[data-link-text]').value, url: row.querySelector('[data-link-url]').value }));
      if (links.length || t.links) t.links = links;
    }
    if (document.getElementById('assignment-title')) {
      const a = next.schedule.assignments.find(a => a._key === assignmentKey);
      a.title = document.getElementById('assignment-title').value;
      a.due = document.getElementById('assignment-date').value;
      a.notes = document.getElementById('assignment-notes').value;
      a.link = document.getElementById('assignment-link').value;
    }
    return next;
  }
  function pending() { return collect(copy(state)); }
  function submit(next, save = false) {
    if (busy) return;
    if (incoming) return showError('Files changed outside this editor. Use Reload files before applying changes. Your form has been kept for reference.');
    try {
      const built = core.resolve(next.course, next.schedule);
      if (built.errors.length) throw new Error(built.errors.join(' '));
      for (const a of next.schedule.assignments) { core.date(a.due); if (!a.title.trim()) throw new Error('Each assignment needs a title.'); }
      busy = true;
      error = '';
      vscode.postMessage({ ...next, type: 'edit', save });
      document.getElementById('save-status').textContent = 'Applying changes…';
    } catch (e) { showError(e.message); }
  }
  function showError(message) {
    error = message;
    const el = document.getElementById('message');
    if (el) { el.textContent = message; el.hidden = false; }
  }
  function render() {
    if (!state) return;
    const calendarScroll = document.querySelector('main')?.scrollTop || 0;
    const detailsScroll = document.querySelector('aside')?.scrollTop || 0;
    const topicFocused = document.activeElement?.id === 'topic-title';
    const built = core.resolve(state.course, state.schedule);
    const topic = currentTopic();
    const selected = built.days.find(d => d.date === selectedDate);
    app.innerHTML = `<header><div class="toolbar"><div class="identity"><h1>${escape(state.course.code)} · Schedule</h1><div class="subtitle">${escape(state.course.term)} · ${escape(state.course.meeting_days)} · ${state.course.start_date} – ${state.course.end_date}</div></div>${button('undo', 'Undo')}${button('redo', 'Redo')}${button('preview', preview ? 'Edit calendar' : 'Preview')}${button('source', 'YAML')}${button('save', 'Save', 'class="primary"')}</div><div class="toolbar status"><span id="save-status">${state.dirty ? 'Unsaved file changes' : 'Saved'}${formDirty ? ' · Form changes not applied' : ''}</span><span class="identity"></span>${button('holiday', '+ Holiday')}${button('assignment', '+ Assignment')}${button('topic', '+ Topic')}</div></header>
      <div id="message" class="message error" role="alert" ${error ? '' : 'hidden'}>${escape(error)}</div>
      ${incoming ? `<div class="message warning">Files changed outside this editor. Form entries have been kept. ${button('reload', 'Reload files')}</div>` : ''}
      <div class="layout"><main ${preview ? 'class="full"' : ''}>${built.errors.map(e => `<div class="error">${escape(e)}</div>`).join('')}${preview ? previewHTML(built) : calendarHTML(built)}
      ${built.extras.length ? `<section class="section"><h2>Unscheduled · ${built.extras.length}</h2><p class="muted">These topics have no available meeting. Drag one onto an unlocked meeting to place it.</p>${built.extras.map(e => `<div class="day"><div role="button" tabindex="0" class="topic" draggable="${!e.topic.fixed_date}" data-extra="${escape(e.topic._key)}" data-index="${e.index}">${escape(e.topic.title || 'Empty topic')}</div></div>`).join('')}</section>` : ''}
      ${state.course.final_exam ? `<section class="section final-exam"><h2>Final exam · ${escape(state.course.final_exam.date)}</h2><p>${escape(state.course.final_exam.time || '')}</p><p class="muted">Configured separately in course.yaml.</p></section>` : ''}
      ${!preview ? holidayList() : ''}</main>
      ${preview ? '' : `<aside>${assignmentKey ? assignmentForm() : selected?.holiday ? `<h2>${label(selected.date)}</h2><p>No class — ${escape(selected.holiday)}</p>${button('holiday', 'Manage holidays')}` : selectedDate || selectedExtra ? topicForm(topic, selected) : `<h2>Meeting details</h2><p class="muted">Select a topic to edit it. Drag topics between meetings to reorder them.</p><p class="muted">Lock an exam to keep its date while other topics move.</p>`}</aside>`}</div>`;
    document.querySelector('main').scrollTop = calendarScroll;
    const aside = document.querySelector('aside');
    if (aside) aside.scrollTop = detailsScroll;
    if (topicFocused) focusTopic();
    remember();
  }
  function focusTopic() {
    const input = document.getElementById('topic-title');
    if (!input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }
  function remember() {
    vscode.setState({ selectedDate, selectedExtra, assignmentKey, draft: formDirty ? { base: baseSnapshot, next: pending() } : undefined });
  }
  function calendarHTML(built) {
    const mondayOf = value => {
      const d = core.date(value);
      d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
      return d;
    };
    const firstMonday = mondayOf(state.course.start_date);
    const lastMonday = mondayOf(state.course.end_date);
    const meetingDays = new Set((Array.isArray(state.course.meeting_days) ? state.course.meeting_days : String(state.course.meeting_days).replace(/\s/g, '').split('')).map(d => d.toUpperCase()));
    const offsets = [...'MTWRFSU'].map((letter, offset) => meetingDays.has(letter) ? offset : -1).filter(offset => offset >= 0);
    let meetingNumber = 0;
    const byDate = new Map(built.days.map(d => [d.date, { ...d, number: d.holiday ? undefined : ++meetingNumber, due: [] }]));
    for (const a of state.schedule.assignments) {
      try { core.date(a.due); } catch { continue; }
      if (!byDate.has(a.due)) byDate.set(a.due, { date: a.due, due: [], dueOnly: true });
      byDate.get(a.due).due.push(a);
    }
    const weeks = new Map();
    for (let monday = firstMonday; monday <= lastMonday; monday = new Date(+monday + 7 * 86400000)) weeks.set(monday.toISOString().slice(0, 10), []);
    for (const d of byDate.values()) {
      const key = mondayOf(d.date).toISOString().slice(0, 10);
      if (!weeks.has(key)) weeks.set(key, []);
      weeks.get(key).push(d);
    }
    const assignments = day => day.due.map(a => `<button type="button" class="assignment" data-assignment="${escape(a._key)}">Due · ${escape(a.title)}</button>`).join('');
    function card(d) {
      if (!d) return '<div class="day placeholder" aria-hidden="true"></div>';
      const title = d.holiday ? 'No class — ' + d.holiday : d.topic?.title || '+ Add topic';
      return `<article role="button" tabindex="0" aria-label="${escape(label(d.date) + (d.number ? ', meeting ' + d.number : '') + ': ' + title)}" class="day ${d.holiday ? 'holiday' : d.topic?.exam ? 'exam' : ''} ${d.date === selectedDate ? 'selected' : ''}" data-date="${d.date}" data-select="${d.date}" data-index="${d.index ?? ''}" draggable="${d.index !== undefined && !d.topic?.fixed_date}"><div class="date"><span>${label(d.date)}</span>${d.number ? `<span class="meeting-number" aria-label="Meeting ${d.number}">#${d.number}</span>` : ''}</div><div class="topic">${escape(title)}</div><div class="tags">${d.topic?.exam ? '<span class="tag">Exam</span>' : ''}${d.topic?.fixed_date ? '<span class="tag">Locked</span>' : ''}${d.topic?.links?.length ? `<span class="tag">${d.topic.links.length} ${d.topic.links.length === 1 ? 'attachment' : 'attachments'}</span>` : ''}</div>${assignments(d)}</article>`;
    }
    return [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([monday, days]) => {
      const start = core.date(monday);
      const week = Math.round((start - firstMonday) / (7 * 86400000)) + 1;
      const heading = start < firstMonday ? 'Before term' : start > lastMonday ? 'After term' : 'Week ' + week;
      const slots = offsets.map(offset => {
        const date = new Date(+start + offset * 86400000).toISOString().slice(0, 10);
        const day = byDate.get(date);
        return card(day && !day.dueOnly ? day : undefined);
      });
      return `<section class="week"><div class="week-label">${heading}</div><div class="days cols-${offsets.length}">${slots.join('')}</div>${days.filter(d => d.dueOnly).sort((a, b) => a.date.localeCompare(b.date)).map(d => `<div class="due-only" data-date="${d.date}"><span class="date">${label(d.date)}</span>${assignments(d)}</div>`).join('')}</section>`;
    }).join('');
  }
  function topicForm(t, selected) {
    t ||= { title: '' };
    return `<h2>${selected ? label(selected.date) : 'Unscheduled topic'}</h2>${field('topic-title', 'Topic', t.title)}<label for="topic-notes">Notes · Markdown supported</label><textarea id="topic-notes" rows="5">${escape(t.notes || '')}</textarea>
      <label class="check"><input id="topic-exam" type="checkbox" ${t.exam ? 'checked' : ''}> Exam</label>
      <label class="check"><input id="topic-locked" type="checkbox" ${t.fixed_date ? 'checked' : ''}> Lock to a date</label>${field('topic-date', 'Locked date', t.fixed_date || selectedDate || state.course.start_date, 'date')}
      <div class="form-actions">${button('apply', 'Apply', 'class="primary"')}${button('discard', 'Reset')}<details class="topic-options"><summary>More</summary><div class="topic-menu">${button('clear', 'Clear topic')}<span>Leave this meeting empty.</span>${button('close-gap', 'Delete & shift')}<span>Move later topics forward.</span></div></details></div>
      <section class="section"><h2>Files and links</h2>${(t.links || []).map((l, i) => `<div class="link" data-link-row="${i}"><label>Link label<input data-link-text value="${escape(l.text)}"></label><label>File path or URL<input data-link-url value="${escape(l.url)}"></label>${button('remove-link', 'Remove link', `data-link="${i}"`)}</div>`).join('')}
      <div class="actions">${button('attach', 'Add file…')}${button('existing', 'Course files…')}${button('link', '+ Web link')}</div></section>
      `;
  }
  function assignmentForm() {
    const a = state.schedule.assignments.find(a => a._key === assignmentKey);
    if (!a) { assignmentKey = undefined; return ''; }
    return `<h2>Assignment</h2>${field('assignment-title', 'Title', a.title)}${field('assignment-date', 'Due date', a.due, 'date')}<label for="assignment-notes">Notes</label><textarea id="assignment-notes" rows="4">${escape(a.notes || '')}</textarea>${field('assignment-link', 'Link', a.link || '')}<div class="actions">${button('apply', 'Apply', 'class="primary"')}${button('delete-assignment', 'Delete assignment')}</div>`;
  }
  function holidayList() {
    return `<section class="section holiday-list"><h2>Holidays</h2>${state.course.holidays.map(h => `<div class="row"><span>${escape(h.date || h.start)}${h.end ? ' – ' + escape(h.end) : ''} · ${escape(h.name)}</span>${button('edit-holiday', 'Edit', `data-key="${escape(h._key)}"`)}${button('remove-holiday', 'Remove', `data-key="${escape(h._key)}"`)}</div>`).join('') || '<p class="muted">No holidays configured.</p>'}</section>`;
  }
  function previewHTML(built) {
    return `<h2>Schedule preview</h2>${built.days.map(d => `<div class="preview-row"><div>${label(d.date)}</div><div><strong>${markdown(d.holiday ? 'No class — ' + d.holiday : d.topic?.title || 'TBD', true)}</strong>${d.topic?.exam ? ' · Exam' : ''}<div class="preview-notes">${markdown(d.topic?.notes || '')}</div>${(d.topic?.links || []).map(l => `<div>${escape(l.text)} · ${escape(l.url)}</div>`).join('')}${state.schedule.assignments.filter(a => a.due === d.date).map(a => `<p>Due: ${escape(a.title)} — ${escape(a.notes || '')}</p>`).join('')}</div></div>`).join('')}<section class="section"><h2>Assignments</h2>${state.schedule.assignments.map(a => `<p>${escape(a.due)} · ${escape(a.title)}</p>`).join('') || '<p class="muted">No assignments.</p>'}</section>`;
  }
  function holidayDialog(key) {
    if (formDirty) return showError('Apply the meeting changes before editing holidays.');
    const old = state.course.holidays.find(h => h._key === key);
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `<h2>${old ? 'Edit holiday' : 'Add holiday'}</h2>${field('holiday-name', 'Name', old?.name || '')}${field('holiday-start', 'First day', old?.date || old?.start || selectedDate || state.course.start_date, 'date')}${field('holiday-end', 'Last day', old?.date || old?.end || selectedDate || state.course.start_date, 'date')}<div id="holiday-impact" class="warning" role="status">Choose dates to preview the changes.</div><div class="actions">${button('holiday-apply', 'Apply holiday', 'class="primary"')}${button('holiday-cancel', 'Cancel')}</div>`;
    app.append(dialog);
    function update() {
      try {
        const start = document.getElementById('holiday-start').value, end = document.getElementById('holiday-end').value;
        core.range(start, end);
        holidayDraft = copy(state);
        const h = { ...(old || {}), _key: old?._key || newKey(), name: document.getElementById('holiday-name').value.trim() || 'Holiday' };
        delete h.date; delete h.start; delete h.end;
        if (start === end) h.date = start; else { h.start = start; h.end = end; }
        if (old) holidayDraft.course.holidays[holidayDraft.course.holidays.findIndex(h => h._key === key)] = h;
        else holidayDraft.course.holidays.push(h);
        const before = core.resolve(state.course, state.schedule), after = core.resolve(holidayDraft.course, holidayDraft.schedule);
        const beforeDates = new Map(before.days.filter(d => d.topic).map(d => [d.topic._key, d.date]));
        const moved = after.days.filter(d => d.topic && beforeDates.get(d.topic._key) && beforeDates.get(d.topic._key) !== d.date).length;
        const removed = before.days.filter(d => !d.holiday).length - after.days.filter(d => !d.holiday).length;
        const due = state.schedule.assignments.filter(a => a.due >= start && a.due <= end).length;
        document.getElementById('holiday-impact').textContent = after.errors.length ? after.errors.join(' ') : `${Math.abs(removed)} meeting${Math.abs(removed) === 1 ? '' : 's'} ${removed >= 0 ? 'removed' : 'restored'}; ${moved} topics move; ${after.extras.length} unscheduled. ${due ? due + ' assignments retain their due dates during this holiday.' : ''}`;
        dialog.querySelector('[data-action=holiday-apply]').disabled = !!after.errors.length;
      } catch (e) { document.getElementById('holiday-impact').textContent = e.message; dialog.querySelector('[data-action=holiday-apply]').disabled = true; }
    }
    dialog.addEventListener('input', update);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal(); update();
  }
  app.addEventListener('input', e => {
    if (e.target.closest('aside')) {
      formDirty = true;
      document.getElementById('save-status').textContent = 'Form changes not applied';
      remember();
    }
  });
  app.addEventListener('click', e => {
    const target = e.target.closest('button, [role=button]');
    if (!target || busy) return;
    try {
      if (target.dataset.select || target.dataset.extra || target.dataset.assignment) {
        if (formDirty) return showError('Apply or save your form changes before selecting another meeting.');
        selectedDate = target.dataset.select;
        selectedExtra = target.dataset.extra;
        assignmentKey = target.dataset.assignment;
        error = ''; render();
        const aside = document.querySelector('aside');
        if (aside) aside.scrollTop = 0;
        focusTopic();
        return;
      }
      const action = target.dataset.action;
      if (action === 'discard') { formDirty = false; error = ''; vscode.postMessage({ type: 'ready' }); return; }
      if (action === 'reload') { state = incoming || state; baseSnapshot = snapshot(state); incoming = undefined; formDirty = false; error = ''; render(); return; }
      if (action === 'holiday-cancel') { target.closest('dialog').close(); return; }
      if (action === 'holiday-apply') { target.closest('dialog').close(); submit(holidayDraft); return; }
      if (action === 'holiday' || action === 'edit-holiday') return holidayDialog(target.dataset.key);
      if (action === 'preview') { if (formDirty) return showError('Apply your changes before previewing.'); preview = !preview; render(); return; }
      if (['undo', 'redo', 'source'].includes(action)) {
        if (formDirty) return showError('Apply or save your form changes first.');
        vscode.postMessage({ type: action }); return;
      }
      let next = pending();
      if (action === 'save' || action === 'apply') return submit(next, action === 'save');
      if (action === 'attach' || action === 'existing') {
        if (formDirty || !currentTopic()?._key?.startsWith('t')) return showError('Apply this topic first, then add files.');
        busy = true; vscode.postMessage({ type: 'attach', key: currentTopic()._key, existing: action === 'existing', version: state.version, courseVersion: state.courseVersion }); return;
      }
      if (action === 'topic') {
        next.schedule.topics.push({ title: 'New topic', _key: newKey() });
        selectedExtra = undefined; selectedDate = undefined;
      } else if (action === 'assignment') {
        next.schedule.assignments.push({ title: 'New assignment', due: selectedDate || state.course.start_date, _key: newKey() });
        assignmentKey = 'a' + (next.schedule.assignments.length - 1);
      } else if (action === 'delete-assignment') {
        next.schedule.assignments = next.schedule.assignments.filter(a => a._key !== assignmentKey); assignmentKey = undefined;
      } else if (action === 'remove-holiday') {
        next.course.holidays = next.course.holidays.filter(h => h._key !== target.dataset.key);
      } else {
        const t = currentTopic();
        const index = next.schedule.topics.findIndex(n => n._key === t?._key);
        if (index < 0) return showError('Apply this topic first.');
        if ((action === 'clear' || action === 'close-gap') && t.fixed_date) return showError('Unlock this topic before deleting it.');
        if (action === 'clear') next.schedule.topics[index] = { title: '', _key: t._key };
        if (action === 'close-gap') next.schedule.topics.splice(index, 1);
        if (action === 'link') {
          next.schedule.topics[index].links ||= [];
          next.schedule.topics[index].links.push({ text: 'Link', url: 'https://' });
        }
        if (action === 'remove-link') next.schedule.topics[index].links.splice(Number(target.dataset.link), 1);

      }
      submit(next);
    } catch (err) { showError(err.message); }
  });
  app.addEventListener('dragstart', e => {
    const t = e.target.closest('[data-index]');
    if (!t || t.dataset.index === '' || formDirty || busy) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/syllabusser-topic', t.dataset.index);
    e.dataTransfer.effectAllowed = 'move';
  });
  app.addEventListener('dragover', e => {
    const day = e.target.closest('[data-date]');
    if (day && (e.dataTransfer.types.includes('text/syllabusser-topic') || e.dataTransfer.types.includes('Files'))) { e.preventDefault(); day.classList.add('over'); }
  });
  app.addEventListener('dragleave', e => e.target.closest('[data-date]')?.classList.remove('over'));
  app.addEventListener('drop', async e => {
    e.preventDefault();
    document.querySelectorAll('.over').forEach(el => el.classList.remove('over'));
    const target = e.target.closest('[data-date]'), source = e.dataTransfer.getData('text/syllabusser-topic');
    const files = [...e.dataTransfer.files];
    if (target && files.length && !busy) {
      if (formDirty) return showError('Apply the form changes before dropping files.');
      const day = core.resolve(state.course, state.schedule).days.find(d => d.date === target.dataset.date);
      if (!day?.topic) return showError('Add a topic to this meeting before attaching files.');
      if (files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) return showError('Drop fewer than 50 MB at a time, or use Add file.');
      try {
        busy = true;
        const uploads = await Promise.all(files.map(async file => {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = '';
          for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          return { name: file.name, base64: btoa(binary) };
        }));
        selectedDate = day.date; selectedExtra = undefined; assignmentKey = undefined;
        vscode.postMessage({ type: 'attach', key: day.topic._key, uploads, version: state.version, courseVersion: state.courseVersion });
      } catch (err) { busy = false; showError(err.message); }
      return;
    }
    if (!target || !source || busy) return;
    try {
      const next = pending();
      next.schedule.topics = core.move(next.course, next.schedule.topics, Number(source), target.dataset.date, false);
      selectedDate = target.dataset.date; selectedExtra = undefined; assignmentKey = undefined;
      submit(next);
    } catch (err) { showError(err.message); }
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'topic-title' && !e.isComposing) {
      e.preventDefault();
      submit(pending());
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button]')) { e.preventDefault(); e.target.click(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); submit(pending(), true); }
  });
  window.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'requestSave' && state) return submit(pending(), true);
    if (message.type === 'error') {
      busy = false;
      if (message.fatal) { app.innerHTML = `<div class="error">${escape(message.message)}</div>${button('source', 'Open YAML to fix')}`; }
      else showError(message.message);
    }
    if (message.type === 'state') {
      if (!state && recovered?.draft) {
        state = { ...message, course: recovered.draft.next.course, schedule: recovered.draft.next.schedule };
        baseSnapshot = recovered.draft.base;
        formDirty = true;
        if (snapshot(message) !== baseSnapshot) { incoming = message; error = 'Recovered form entries. The files changed; reload before applying them.'; }
        else error = 'Recovered your unfinished form. Apply changes to update the YAML.';
        render(); return;
      }
      if (formDirty && !busy && state && (message.version !== state.version || message.courseVersion !== state.courseVersion)) { incoming = message; showError('Files changed outside this editor. Apply was paused to protect your changes.'); const b = document.createElement('button'); b.dataset.action = 'reload'; b.textContent = 'Reload files'; document.getElementById('message').append(b); return; }
      if (formDirty && !busy && state && message.version === state.version && message.courseVersion === state.courseVersion) return;
      state = message; baseSnapshot = snapshot(message); busy = false; formDirty = false; incoming = undefined; render();
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
