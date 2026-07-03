# Syllabusser

Syllabus pages for university courses, served as a static site on GitHub Pages. No build step: the pages read plain YAML and Markdown files in the browser, so **updating the site is editing a text file and pushing**.

Each course gets four pages:

- **Now** — what's happening this week and what's due in the next two weeks (computed from today's date)
- **Schedule** — the whole term, week by week, generated from meeting days + start/end dates + holidays, with the current week highlighted
- **Info** — description, background, goals, expectations, materials
- **Policies** — attendance, makeups, honesty, etc.

The landing page lists all current courses.

## Adding a course

```
python3 scripts/new_course.py
```

Answer the prompts (code, title, term, meeting days, first/last day, holidays). The script creates `courses/<slug>/` with everything the course needs and registers it on the landing page. It also works non-interactively — see `python3 scripts/new_course.py --help`.

Then fill in three files (see below), commit, push. Done.

## Editing a course

All the files you edit live in `courses/<slug>/`:

### `schedule.yaml` — daily topics and assignments

Topics are **one entry per class meeting, in order**. The generator prepopulates the file with a `TBD` line for every meeting, dated:

```yaml
topics:
  # ── Week 1 ──────────────────────────────
  - Introduction                          # Mon 2026-06-01
  - "*Iliad* 1: the rage of Achilles"     # Tue 2026-06-02
```

The site assigns dates by position (entry 1 = first meeting, entry 2 = second, …), so you can insert or move entries and the dates reflow automatically. The `# Mon 2026-06-01` comments are editing aids written at generation time — they can go stale if you shuffle entries; the rendered site is always correct.

Formatting notes:

- Markdown works in titles and notes: `*Iliad*` renders italic, `[text](url)` renders as a link.
- If a title contains a colon or starts with `*`, wrap it in double quotes (as above).
- For a big day (exam, in-class due date), use a block instead of a string:

```yaml
  - title: "Exam 1"
    exam: true                # gets highlighted styling and an EXAM tag
    notes: |
      Covers weeks 1–3. Bring a blue book.
    links:
      - text: Study guide
        url: https://example.com/guide
```

Assignments are dated (not positional) and appear both on the schedule (in their week) and on the Now page when due within two weeks:

```yaml
assignments:
  - title: Essay 1
    due: 2026-06-24
    notes: Canvas, 11:59pm.          # optional
    link: https://example.com/essay1 # optional
```

If you have more topic entries than class meetings, the schedule page shows a warning listing the extras, so mismatches are impossible to miss.

### `course.yaml` — course facts and the calendar

Code, title, term, instructor, location, meeting time — plus the three fields the calendar is generated from:

```yaml
meeting_days: [Mon, Tue, Wed, Thu]
start_date: 2026-06-01
end_date: 2026-08-06
holidays:
  - date: 2026-06-19
    name: Juneteenth
  - start: 2026-07-02          # ranges work too
    end: 2026-07-03
    name: Independence Day break
```

Holidays that land on meeting days show up as "No class — …" on the schedule and don't consume a topic entry.

### `info.md` and `policies.md`

Plain Markdown. `##` headings become the section heads.

## Archiving a course

In `courses.yaml` at the repo root, change the course's status:

```yaml
courses:
  - slug: clas2200-su26
    status: archived      # was: current
```

Archived courses disappear from the landing page (their pages still exist at their URLs if a student has a direct link). Flip back to `current` to restore.

## Previewing

- Locally: `python3 -m http.server` in the repo root, then open <http://localhost:8000>. (Opening the files directly without a server won't work — the pages fetch their data files.)
- Time travel: add `?today=2026-09-15` to any page URL to see the Now page and current-week highlight as they'll appear on that date.

## How it works / repo map

- `assets/app.js` — all rendering. Builds the calendar from `course.yaml`, zips topics onto it, renders each page. The calendar algorithm is duplicated in `scripts/new_course.py` (marked `KEEP IN SYNC` in both).
- `assets/styles.css` — the design. Colors and type are set as CSS variables at the top.
- `assets/vendor/` — pinned copies of js-yaml and marked (no CDN dependency).
- `assets/fonts/` — Source Serif 4 variable fonts, hosted locally.
- `courses.yaml` — landing-page manifest: which courses exist and whether they're shown.
- `.nojekyll` — tells GitHub Pages to serve files as-is.

## One-time GitHub Pages setup (already done for this repo)

1. Push the repo to GitHub.
2. Repo → Settings → Pages → deploy from the `main` branch, `/ (root)` folder.
3. The site appears at `https://<user>.github.io/<repo>/`.
