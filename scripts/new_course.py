#!/usr/bin/env python3
"""Create a new course for the Syllabusser site.

Interactive:      python3 scripts/new_course.py
Non-interactive:  python3 scripts/new_course.py --code "ENGL 101" --title "Intro to Composition" \
                      --term "Summer 2026" --instructor "Dr. X" --days Mon,Tue,Wed,Thu \
                      --start 2026-06-01 --end 2026-08-06 \
                      --holiday "2026-06-19:Juneteenth" \
                      --holiday "2026-07-02..2026-07-03:Independence Day break"

Generates courses/<slug>/ with course.yaml, a schedule.yaml prepopulated with one
entry per computed class meeting (dates as comments), info.md/policies.md
skeletons, and the four HTML page stubs; registers the course in courses.yaml.
"""

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]  # Python: Monday = 0

SEASONS = {"spring", "summer", "fall", "winter"}


# ---------- small helpers ----------

def parse_date(s):
    try:
        return dt.date.fromisoformat(str(s).strip())
    except ValueError:
        raise SystemExit(f"error: not a valid date (YYYY-MM-DD): {s!r}")


def day_index(name):
    key = str(name).strip()[:3].lower()
    for i, d in enumerate(DOW):
        if d.lower() == key:
            return i
    raise SystemExit(f"error: unknown meeting day: {name!r} (use Mon, Tue, ...)")


def yq(s):
    """Quote a free-text value for YAML output."""
    s = str(s)
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def slugify(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")


def code_slug(code):
    return re.sub(r"[^a-z0-9]", "", code.lower()) or slugify(code)


def derive_slug(code):
    # Current courses live at a short, stable URL (just the course code) so
    # it can be shared/bookmarked once and keep working across offerings.
    # When a course is archived, archive_course.py renames it to a dated
    # slug (see term_slug below) and this short slug frees up again.
    return code_slug(code)


def term_slug(term):
    """'Fall 2026' -> '2026-fall'"""
    words = term.lower().split()
    season = next((w for w in words if w in SEASONS), None)
    year = next((w for w in words if w.isdigit() and len(w) == 4), None)
    if not season or not year:
        raise SystemExit(f"error: can't parse a year and season out of term {term!r}")
    return f"{year}-{season}"


# ---------- calendar ----------
# KEEP IN SYNC: assets/app.js (buildCalendar) implements this same algorithm so
# the dates written into schedule.yaml match what the site renders.

def expand_holidays(holidays):
    """[{date|start+end, name}] -> {date: name}"""
    out = {}
    for h in holidays:
        if "date" in h:
            out[h["date"]] = h["name"]
        else:
            d = h["start"]
            while d <= h["end"]:
                out[d] = h["name"]
                d += dt.timedelta(days=1)
    return out


def build_calendar(start, end, meeting_days, holidays):
    """-> [(date, holiday_name_or_None)] one per scheduled meeting day."""
    meet = {day_index(d) for d in meeting_days}
    hmap = expand_holidays(holidays)
    days = []
    d = start
    while d <= end:
        if d.weekday() in meet:
            days.append((d, hmap.get(d)))
        d += dt.timedelta(days=1)
    return days


def monday_of(d):
    return d - dt.timedelta(days=d.weekday())


# ---------- file emission ----------

def course_yaml(a, holidays):
    lines = [
        f"code: {yq(a.code)}",
        f"title: {yq(a.title)}",
        f"term: {yq(a.term)}",
    ]
    if a.instructor:
        lines.append(f"instructor: {yq(a.instructor)}")
    if a.email:
        lines.append(f"email: {yq(a.email)}")
    if a.location:
        lines.append(f"location: {yq(a.location)}")
    if a.time:
        lines.append(f"meeting_time: {yq(a.time)}")
    lines.append("meeting_days: [" + ", ".join(a.days) + "]")
    lines.append(f"start_date: {a.start.isoformat()}")
    lines.append(f"end_date: {a.end.isoformat()}")
    if holidays:
        lines.append("holidays:")
        for h in holidays:
            if "date" in h:
                lines.append(f"  - date: {h['date'].isoformat()}")
            else:
                lines.append(f"  - start: {h['start'].isoformat()}")
                lines.append(f"    end: {h['end'].isoformat()}")
            lines.append(f"    name: {yq(h['name'])}")
    else:
        lines.append("holidays: []")
    return "\n".join(lines) + "\n"


def schedule_yaml(a, days):
    out = [
        f"# Schedule for {a.code} — {a.term}",
        "#",
        "# One entry per class meeting, IN ORDER. The site assigns dates automatically",
        "# (entry 1 = first meeting, entry 2 = second, ...), so you can insert or move",
        "# entries freely — dates reflow on the site. The date comments below were",
        "# written when this file was generated; they are editing aids, and may go",
        "# stale if you shuffle entries. The rendered site is always correct.",
        "#",
        "# A plain string is a normal day. For a bigger day (exam, project due in",
        "# class, etc.) use a block:",
        "#",
        '#   - title: "Exam 1"',
        "#     exam: true",
        "#     notes: |",
        "#       Covers weeks 1-3. Bring a blue book.",
        "#     links:",
        "#       - text: Study guide",
        "#         url: https://example.com/guide",
        "",
        "topics:",
    ]
    week_key = None
    week_num = 0
    for d, holiday in days:
        if monday_of(d) != week_key:
            week_key = monday_of(d)
            week_num += 1
            out.append(f"  # ── Week {week_num} " + "─" * 30)
        if holiday:
            out.append(f"  #   (no class {DOW[d.weekday()]} {d.isoformat()} — {holiday})")
        else:
            out.append(f"  - TBD".ljust(42) + f"# {DOW[d.weekday()]} {d.isoformat()}")
    out += [
        "",
        "# Assignments and other due dates. Each needs a title and a due date;",
        "# notes and link are optional. Example:",
        "#",
        "#   - title: Essay 1",
        "#     due: 2026-06-18",
        "#     notes: Submit on Canvas by 11:59pm.",
        "#     link: https://example.com/essay1",
        "assignments:",
    ]
    return "\n".join(out) + "\n"


INFO_MD = """## Description

_What is this course about? A paragraph or two._

## Background

_Where the course sits in the curriculum; prerequisites; who it's for._

## Goals

By the end of this course, you will be able to:

- _goal one_
- _goal two_

## Expectations

- _come to class prepared, participate, etc._

## Materials

- _required texts, tools, accounts_

## Contact & office hours

_Where and when to find me; how quickly I answer email._
"""

POLICIES_MD = """## Attendance

_Your attendance policy._

## Late work & makeups

_How late work is handled; how makeup exams are arranged._

## Academic honesty

_Plagiarism, collaboration, AI use, and so on._

## Accommodations

_Disability services statement._

## Communication

_Announcements, email etiquette, response times._
"""

FILES_README = """Drop attachments here (study guides, handouts, slides, etc.) and link
to them from schedule.yaml with a path relative to this course folder:

    links:
      - text: Study guide
        url: files/exam1-guide.pdf

This file itself isn't linked from anywhere — delete it once you've
added a real attachment, or leave it, it won't show up on the site.
"""

STUB = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="stylesheet" href="../../assets/styles.css">
</head>
<body data-page="{page}">
<div class="wrap" id="app"><div class="loading">Loading…</div></div>
<script src="../../assets/vendor/js-yaml.min.js"></script>
<script src="../../assets/vendor/marked.min.js"></script>
<script src="../../assets/app.js"></script>
</body>
</html>
"""

PAGES = [("index.html", "now"), ("schedule.html", "schedule"),
         ("info.html", "info"), ("policies.html", "policies")]


def register_course(slug):
    manifest = ROOT / "courses.yaml"
    entry = f"  - slug: {slug}\n    status: current\n"
    if not manifest.exists():
        manifest.write_text(
            "# Course manifest. To archive a finished course, run:\n"
            "#   python3 scripts/archive_course.py <slug>\n"
            "title: \"Courses\"\n"
            "courses:\n" + entry
        )
        return
    text = manifest.read_text()
    if re.search(rf"slug:\s*{re.escape(slug)}\s*$", text, re.M):
        print(f"  (already registered in courses.yaml)")
        return
    if not text.endswith("\n"):
        text += "\n"
    manifest.write_text(text + entry)


# ---------- input ----------

def parse_holiday_spec(spec):
    """'2026-06-19:Juneteenth' or '2026-07-02..2026-07-03:Break' -> dict"""
    if ":" not in spec:
        raise SystemExit(f"error: holiday must be DATE:NAME or START..END:NAME, got {spec!r}")
    dates, name = spec.split(":", 1)
    name = name.strip() or "Holiday"
    if ".." in dates:
        s, e = dates.split("..", 1)
        return {"start": parse_date(s), "end": parse_date(e), "name": name}
    return {"date": parse_date(dates), "name": name}


def ask(prompt, required=True, default=None):
    while True:
        suffix = f" [{default}]" if default else ""
        val = input(f"{prompt}{suffix}: ").strip()
        if not val and default:
            return default
        if val or not required:
            return val
        print("  (required)")


def interactive(a):
    print("New course — answer a few questions.\n")
    a.code = a.code or ask("Course code (e.g. ENGL 101)")
    a.title = a.title or ask("Course title")
    a.term = a.term or ask("Term (e.g. Fall 2026)")
    a.instructor = a.instructor or ask("Instructor", required=False)
    a.email = a.email or ask("Contact email", required=False)
    a.location = a.location or ask("Meeting location", required=False)
    a.time = a.time or ask("Meeting time (e.g. 10:00–11:15)", required=False)
    if not a.days:
        a.days = [d.strip() for d in
                  ask("Meeting days, comma-separated (e.g. Mon,Wed,Fri)").replace("/", ",").split(",") if d.strip()]
    a.start = a.start or parse_date(ask("First day of classes (YYYY-MM-DD)"))
    a.end = a.end or parse_date(ask("Last day of classes (YYYY-MM-DD)"))
    if a.holiday is None:
        a.holiday = []
        print("Holidays / breaks (blank date to finish):")
        while True:
            d = input("  date YYYY-MM-DD (or range YYYY-MM-DD..YYYY-MM-DD): ").strip()
            if not d:
                break
            name = input("  name: ").strip() or "Holiday"
            a.holiday.append(parse_holiday_spec(f"{d}:{name}"))
    return a


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--code")
    p.add_argument("--title")
    p.add_argument("--term")
    p.add_argument("--instructor")
    p.add_argument("--email")
    p.add_argument("--location")
    p.add_argument("--time")
    p.add_argument("--days", help="comma-separated, e.g. Mon,Wed,Fri")
    p.add_argument("--start", type=parse_date, help="first day of classes YYYY-MM-DD")
    p.add_argument("--end", type=parse_date, help="last day of classes YYYY-MM-DD")
    p.add_argument("--holiday", action="append", type=parse_holiday_spec, default=None,
                   help="DATE:NAME or START..END:NAME (repeatable)")
    p.add_argument("--slug", help="directory name (default: derived from code+term)")
    a = p.parse_args()

    if a.days:
        a.days = [d.strip() for d in a.days.split(",") if d.strip()]

    required = [a.code, a.title, a.term, a.days, a.start, a.end]
    if not all(required):
        if not sys.stdin.isatty() and not all(required):
            missing = [n for n, v in
                       zip(["--code", "--title", "--term", "--days", "--start", "--end"], required) if not v]
            raise SystemExit("error: missing " + ", ".join(missing) + " (and stdin is not a tty)")
        a = interactive(a)

    a.days = [DOW[day_index(d)] for d in a.days]  # normalize to Mon/Tue/...
    holidays = a.holiday or []
    if a.end < a.start:
        raise SystemExit("error: end date is before start date")

    slug = a.slug or derive_slug(a.code)
    course_dir = ROOT / "courses" / slug
    if course_dir.exists():
        raise SystemExit(
            f"error: {course_dir.relative_to(ROOT)} already exists.\n"
            f"       If that's a past offering, archive it first: python3 scripts/archive_course.py {slug}\n"
            f"       Otherwise pick a different --slug."
        )

    days = build_calendar(a.start, a.end, a.days, holidays)
    meetings = [d for d, h in days if not h]
    if not meetings:
        raise SystemExit("error: no class meetings in that date range — check days/dates")

    course_dir.mkdir(parents=True)
    (course_dir / "course.yaml").write_text(course_yaml(a, holidays))
    (course_dir / "schedule.yaml").write_text(schedule_yaml(a, days))
    (course_dir / "info.md").write_text(INFO_MD)
    (course_dir / "policies.md").write_text(POLICIES_MD)
    for fname, page in PAGES:
        (course_dir / fname).write_text(STUB.format(page=page, title=f"{a.code} — {a.title}"))
    files_dir = course_dir / "files"
    files_dir.mkdir()
    (files_dir / "README.md").write_text(FILES_README)
    register_course(slug)

    weeks = len({monday_of(d) for d, _ in days})
    print(f"\nCreated courses/{slug}/ — {len(meetings)} class meetings over {weeks} weeks.")
    print("Next steps:")
    print(f"  1. Fill in the TBD topics:   courses/{slug}/schedule.yaml")
    print(f"  2. Write the course info:    courses/{slug}/info.md")
    print(f"  3. Write the policies:      courses/{slug}/policies.md")
    print("  4. Commit and push — the site updates itself.")


if __name__ == "__main__":
    main()
