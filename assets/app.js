/* Syllabusser client renderer.
 * Zero-build: every page is a tiny stub with <body data-page="...">; this file
 * fetches the course's YAML/Markdown and renders the page.
 */
(function () {
  "use strict";

  var PAGE = document.body.dataset.page;
  var APP = document.getElementById("app");

  /* ---------- dates ---------- */

  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MON_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // Parse into a *local* Date. Never `new Date("YYYY-MM-DD")` (UTC off-by-one).
  // Also tolerates a Date (in case a YAML schema ever emits one) via UTC getters.
  function parseDate(v) {
    if (v instanceof Date) {
      return new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
    }
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v).trim());
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  function ymd(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function mondayOf(d) {
    return addDays(d, -((d.getDay() + 6) % 7));
  }

  function shortDate(d) {
    return MON[d.getMonth()] + " " + d.getDate();
  }

  function today() {
    var o = new URLSearchParams(location.search).get("today");
    var d = o ? parseDate(o) : new Date();
    if (!d) d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  var TODAY = today();

  /* ---------- fetching ---------- */

  function fetchText(path) {
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + " → HTTP " + r.status);
      return r.text();
    });
  }

  function fetchYaml(path) {
    return fetchText(path).then(function (t) {
      // CORE_SCHEMA keeps YYYY-MM-DD as strings (no implicit timestamps).
      return jsyaml.load(t, { schema: jsyaml.CORE_SCHEMA });
    });
  }

  /* ---------- html helpers ---------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function md(s) {
    return marked.parse(String(s == null ? "" : s));
  }

  function mdInline(s) {
    return marked.parseInline(String(s == null ? "" : s));
  }

  function fail(err) {
    APP.innerHTML = '<div class="error-state"><strong>Couldn’t load this page.</strong> ' +
      esc(err && err.message ? err.message : err) + "</div>";
    console.error(err);
  }

  /* ---------- calendar ----------
   * KEEP IN SYNC: scripts/new_course.py (build_calendar) implements this same
   * algorithm so generated schedule.yaml files line up with what renders here.
   */

  function dayIndex(name) {
    var i = DOW.map(function (d) { return d.toLowerCase(); })
      .indexOf(String(name).slice(0, 3).toLowerCase());
    if (i < 0) throw new Error("Unknown meeting day: " + name);
    return i;
  }

  // -> Map of "YYYY-MM-DD" -> holiday name
  function expandHolidays(list) {
    var map = new Map();
    (list || []).forEach(function (h) {
      if (h.date) {
        map.set(ymd(parseDate(h.date)), h.name || "Holiday");
      } else if (h.start && h.end) {
        for (var d = parseDate(h.start), e = parseDate(h.end); d <= e; d = addDays(d, 1)) {
          map.set(ymd(d), h.name || "Holiday");
        }
      }
    });
    return map;
  }

  // -> [{date, holiday?}] one entry per scheduled meeting day (incl. holidays)
  function buildCalendar(course) {
    var start = parseDate(course.start_date);
    var end = parseDate(course.end_date);
    if (!start || !end) throw new Error("course.yaml needs start_date and end_date (YYYY-MM-DD)");
    var meet = new Set((course.meeting_days || []).map(dayIndex));
    if (!meet.size) throw new Error("course.yaml needs meeting_days");
    var holidays = expandHolidays(course.holidays);
    var days = [];
    for (var d = new Date(start); d <= end; d = addDays(d, 1)) {
      if (!meet.has(d.getDay())) continue;
      var h = holidays.get(ymd(d));
      days.push(h ? { date: d, holiday: h } : { date: d });
    }
    return days;
  }

  function normalizeTopic(t) {
    if (t == null) return { title: "TBD" };
    if (typeof t === "string") return { title: t };
    return {
      title: t.title || "TBD",
      exam: !!t.exam,
      notes: t.notes,
      links: t.links || []
    };
  }

  // Zip ordered topics onto class meetings (holidays don't consume topics),
  // group into Monday-anchored weeks, attach assignments due within each week.
  function buildWeeks(course, schedule) {
    var days = buildCalendar(course);
    var topics = (schedule.topics || []).map(normalizeTopic);
    var ti = 0;
    days.forEach(function (day) {
      if (!day.holiday) day.topic = topics[ti++] || { title: "TBD", tbd: true };
    });
    var extraTopics = topics.slice(ti);

    var weeks = [];
    var byMon = new Map();
    days.forEach(function (day) {
      var key = ymd(mondayOf(day.date));
      var w = byMon.get(key);
      if (!w) {
        w = { monday: mondayOf(day.date), days: [], due: [] };
        byMon.set(key, w);
        weeks.push(w);
      }
      w.days.push(day);
    });
    weeks.forEach(function (w, i) { w.num = i + 1; });

    (schedule.assignments || []).forEach(function (a) {
      var due = parseDate(a.due);
      if (!due) return;
      var key = ymd(mondayOf(due));
      var w = byMon.get(key);
      var item = { title: a.title || "Assignment", due: due, notes: a.notes, link: a.link };
      if (w) w.due.push(item);
    });
    weeks.forEach(function (w) {
      w.due.sort(function (a, b) { return a.due - b.due; });
    });

    return { weeks: weeks, extraTopics: extraTopics, days: days };
  }

  function currentWeek(weeks) {
    var monKey = ymd(mondayOf(TODAY));
    for (var i = 0; i < weeks.length; i++) {
      if (ymd(weeks[i].monday) === monKey) return weeks[i];
    }
    return null;
  }

  /* ---------- shared chrome ---------- */

  function rootPrefix() {
    return PAGE === "home" ? "" : "../../";
  }

  function chipHTML(d) {
    return '<span class="date-chip" aria-label="' + esc(DOW_FULL[d.getDay()] + ", " + MON_FULL[d.getMonth()] + " " + d.getDate()) + '">' +
      '<span class="dow">' + DOW[d.getDay()] + "</span>" +
      '<span class="dom">' + d.getDate() + "</span>" +
      '<span class="mon">' + MON[d.getMonth()] + "</span></span>";
  }

  function headerHTML(course) {
    var meta = [];
    if (course.term) meta.push(esc(course.term));
    if (course.instructor) meta.push(esc(course.instructor));
    if (course.email) meta.push('<a href="mailto:' + esc(course.email) + '">' + esc(course.email) + "</a>");
    var meta2 = [];
    if (course.meeting_days && course.meeting_days.length) meta2.push(esc(course.meeting_days.join("/")));
    if (course.meeting_time) meta2.push(esc(course.meeting_time));
    if (course.location) meta2.push(esc(course.location));
    return '<header class="site-header">' +
      '<a class="home-link" href="' + rootPrefix() + 'index.html">← All courses</a>' +
      '<p class="course-code">' + esc(course.code || "") + "</p>" +
      '<h1 class="course-title">' + esc(course.title || "") + "</h1>" +
      '<p class="course-meta">' + meta.join('<span class="sep">·</span>') +
      (meta2.length ? "<br>" + meta2.join('<span class="sep">·</span>') : "") + "</p>" +
      "</header>";
  }

  function navHTML() {
    var items = [
      ["now", "index.html", "Now"],
      ["schedule", "schedule.html", "Schedule"],
      ["info", "info.html", "Info"],
      ["policies", "policies.html", "Policies"]
    ];
    var q = location.search; // keep ?today= override while navigating
    return '<nav class="page-nav" aria-label="Course pages">' + items.map(function (it) {
      return '<a href="' + it[1] + q + '"' + (PAGE === it[0] ? ' aria-current="page"' : "") + ">" + it[2] + "</a>";
    }).join("") + "</nav>";
  }

  function footerHTML(course) {
    var bits = [];
    if (course && course.code) bits.push(esc(course.code) + (course.term ? " · " + esc(course.term) : ""));
    bits.push("Schedule may be revised; this site is the current version.");
    return '<footer class="site-footer">' + bits.join(" — ") + "</footer>";
  }

  /* ---------- meeting / due rendering ---------- */

  function meetingHTML(day) {
    var cls = "meeting";
    var isToday = ymd(day.date) === ymd(TODAY);
    if (isToday) cls += " is-today";
    if (day.holiday) {
      return '<div class="' + cls + ' holiday">' + chipHTML(day.date) +
        '<div class="meeting-body"><h3>No class — ' + esc(day.holiday) + "</h3></div></div>";
    }
    var t = day.topic;
    if (t.exam) cls += " exam";
    var html = '<div class="' + cls + '">' + chipHTML(day.date) + '<div class="meeting-body">';
    html += "<h3>" + mdInline(t.title) + (t.exam ? '<span class="tag">Exam</span>' : "") + "</h3>";
    if (t.notes) html += '<div class="notes">' + md(t.notes) + "</div>";
    if (t.links && t.links.length) {
      html += '<ul class="link-row">' + t.links.map(function (l) {
        return '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.text || l.url) + "</a></li>";
      }).join("") + "</ul>";
    }
    html += "</div></div>";
    return html;
  }

  function dueItemHTML(item) {
    var cls = "due-item" + (ymd(item.due) === ymd(TODAY) ? " overdue-ish" : "");
    var title = item.link
      ? '<a href="' + esc(item.link) + '" target="_blank" rel="noopener">' + esc(item.title) + "</a>"
      : esc(item.title);
    return '<div class="' + cls + '">' + chipHTML(item.due) +
      '<div class="due-body"><h4>' + title + "</h4>" +
      (item.notes ? '<p class="notes">' + mdInline(item.notes) + "</p>" : "") +
      "</div></div>";
  }

  function weekHTML(week, isCurrent) {
    var first = week.days[0].date;
    var last = week.days[week.days.length - 1].date;
    var html = '<section class="week' + (isCurrent ? " is-current" : "") + '" id="week-' + week.num + '">';
    html += '<div class="week-head"><h2>Week ' + week.num + "</h2>" +
      '<span class="range">' + shortDate(first) + " – " + shortDate(last) + "</span>" +
      (isCurrent ? '<span class="badge-current">This week</span>' : "") + "</div>";
    html += week.days.map(meetingHTML).join("");
    if (week.due.length) {
      html += '<div class="week-due"><h3>Due this week</h3>' + week.due.map(dueItemHTML).join("") + "</div>";
    }
    html += "</section>";
    return html;
  }

  /* ---------- pages ---------- */

  function renderSchedule(course, schedule) {
    var built = buildWeeks(course, schedule);
    var cur = currentWeek(built.weeks);
    var html = headerHTML(course) + navHTML() + '<main class="content">';
    if (built.extraTopics.length) {
      html += '<div class="warn"><strong>' + built.extraTopics.length +
        " topic(s) beyond the last class meeting:</strong> " +
        built.extraTopics.map(function (t) { return esc(t.title); }).join(" · ") +
        " — check schedule.yaml against the calendar.</div>";
    }
    html += built.weeks.map(function (w) { return weekHTML(w, cur === w); }).join("");
    html += "</main>" + footerHTML(course);
    APP.innerHTML = html;
    if (cur) {
      var el = document.getElementById("week-" + cur.num);
      if (el) el.scrollIntoView({ block: "start" });
    }
  }

  function renderNow(course, schedule) {
    var built = buildWeeks(course, schedule);
    var cur = currentWeek(built.weeks);
    var start = parseDate(course.start_date);
    var end = parseDate(course.end_date);

    var html = headerHTML(course) + navHTML() + '<main class="content">';
    html += '<p class="now-today">Today is <strong>' +
      DOW_FULL[TODAY.getDay()] + ", " + MON_FULL[TODAY.getMonth()] + " " + TODAY.getDate() + "</strong>" +
      (cur ? " · Week " + cur.num + " of " + built.weeks.length : "") + "</p>";

    if (TODAY < start) {
      html += '<div class="notice">The term hasn’t started yet — first class is <strong>' +
        DOW_FULL[built.days[0].date.getDay()] + ", " + shortDate(built.days[0].date) + "</strong>.</div>";
    } else if (TODAY > end) {
      html += '<div class="empty-state">The term has ended. Thanks for a great semester!</div>';
    } else if (cur) {
      html += '<section class="week is-current"><div class="week-head"><h2>This week</h2>' +
        '<span class="range">' + shortDate(cur.days[0].date) + " – " +
        shortDate(cur.days[cur.days.length - 1].date) + "</span></div>" +
        cur.days.map(meetingHTML).join("") + "</section>";
    } else {
      html += '<div class="empty-state">No class meetings this week.</div>';
    }

    if (TODAY <= end) {
      var horizon = addDays(TODAY, 14);
      var upcoming = (schedule.assignments || []).map(function (a) {
        return { title: a.title || "Assignment", due: parseDate(a.due), notes: a.notes, link: a.link };
      }).filter(function (a) {
        return a.due && a.due >= TODAY && a.due <= horizon;
      }).sort(function (a, b) { return a.due - b.due; });
      if (upcoming.length) {
        html += '<section class="due-section"><h2>Due in the next two weeks</h2>' +
          upcoming.map(dueItemHTML).join("") + "</section>";
      } else if (TODAY >= start) {
        html += '<section class="due-section"><h2>Due in the next two weeks</h2>' +
          '<p class="notes" style="margin:0;color:var(--muted)">Nothing due — enjoy it.</p></section>';
      }
    }

    html += "</main>" + footerHTML(course);
    APP.innerHTML = html;
  }

  function renderMarkdownPage(course, file) {
    return fetchText(file).then(function (text) {
      APP.innerHTML = headerHTML(course) + navHTML() +
        '<main class="content"><div class="prose">' + md(text) + "</div></main>" + footerHTML(course);
    });
  }

  function renderHome(manifest) {
    var current = (manifest.courses || []).filter(function (c) {
      return (c.status || "current") === "current";
    });
    var title = manifest.title || "Courses";
    document.title = title;
    var head = '<header class="site-header"><h1 class="site-title">' + esc(title) + "</h1>" +
      (manifest.tagline ? '<p class="site-tagline">' + esc(manifest.tagline) + "</p>" : "") + "</header>";
    if (!current.length) {
      APP.innerHTML = head + '<div class="empty-state">No current courses.</div>';
      return;
    }
    Promise.all(current.map(function (c) {
      return fetchYaml("courses/" + c.slug + "/course.yaml").catch(function () { return null; });
    })).then(function (metas) {
      var items = current.map(function (c, i) {
        var m = metas[i] || {};
        return '<li><a href="courses/' + esc(c.slug) + '/index.html">' +
          '<span class="code">' + esc(m.code || c.slug) + "</span>" +
          '<span class="title">' + esc(m.title || "") + "</span>" +
          '<span class="term">' + esc(m.term || "") + "</span></a></li>";
      }).join("");
      APP.innerHTML = head + '<main class="content"><ul class="course-list">' + items + "</ul></main>" +
        '<footer class="site-footer">Built with Syllabusser.</footer>';
    }).catch(fail);
  }

  /* ---------- boot ---------- */

  if (PAGE === "home") {
    fetchYaml("courses.yaml").then(renderHome).catch(fail);
    return;
  }

  fetchYaml("course.yaml").then(function (course) {
    document.title = (course.code ? course.code + " — " : "") + (course.title || "Syllabus");
    if (PAGE === "info") return renderMarkdownPage(course, "info.md");
    if (PAGE === "policies") return renderMarkdownPage(course, "policies.md");
    return fetchYaml("schedule.yaml").then(function (schedule) {
      schedule = schedule || {};
      if (PAGE === "schedule") renderSchedule(course, schedule);
      else renderNow(course, schedule);
    });
  }).catch(fail);
})();
