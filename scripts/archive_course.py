#!/usr/bin/env python3
"""Archive a current course: renames it from its short slug (e.g. `ltn110`)
to a dated slug (e.g. `2026-fall-ltn110`) and marks it archived in
courses.yaml, freeing the short slug for the next offering of that course.

Usage: python3 scripts/archive_course.py <slug>
"""

import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from new_course import code_slug, term_slug  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def read_field(text, key):
    m = re.search(rf'^{key}:\s*"?([^"\n]*)"?\s*$', text, re.M)
    return m.group(1).strip() if m else None


def main():
    if len(sys.argv) != 2 or sys.argv[1] in ("-h", "--help"):
        raise SystemExit(__doc__)
    old_slug = sys.argv[1]

    course_dir = ROOT / "courses" / old_slug
    if not course_dir.exists():
        raise SystemExit(f"error: courses/{old_slug} doesn't exist")

    course_yaml = course_dir / "course.yaml"
    text = course_yaml.read_text()
    code = read_field(text, "code")
    term = read_field(text, "term")
    if not code or not term:
        raise SystemExit(f"error: couldn't read code/term from {course_yaml.relative_to(ROOT)}")

    new_slug = f"{term_slug(term)}-{code_slug(code)}"
    new_dir = ROOT / "courses" / new_slug
    if new_dir.exists():
        raise SystemExit(f"error: courses/{new_slug} already exists")

    manifest = ROOT / "courses.yaml"
    manifest_text = manifest.read_text()
    pattern = re.compile(
        rf"(-\s*slug:\s*){re.escape(old_slug)}(\s*\n\s*status:\s*)current\b"
    )
    new_manifest_text, n = pattern.subn(rf"\g<1>{new_slug}\g<2>archived", manifest_text, count=1)
    if n != 1:
        raise SystemExit(
            f"error: couldn't find a 'slug: {old_slug}' / 'status: current' entry in courses.yaml — "
            "is it already archived, or was the manifest edited by hand?"
        )

    shutil.move(str(course_dir), str(new_dir))
    manifest.write_text(new_manifest_text)

    print(f"Archived courses/{old_slug}/ -> courses/{new_slug}/")
    print(f"  courses.yaml updated: slug -> {new_slug}, status -> archived")
    print(f"  /{old_slug} is now free for the next offering of {code}.")
    print("Commit and push to publish.")


if __name__ == "__main__":
    main()
