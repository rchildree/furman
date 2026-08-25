#!/usr/bin/env python3
"""Update `revised` in the staged metadata for changed syllabus courses.

This script is intended to be called by .githooks/pre-commit.  It deliberately
updates Git's index directly instead of using `git add`, so unstaged edits to a
course.yaml file are never accidentally included in a commit.
"""

from __future__ import annotations

import datetime as dt
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
COURSE_FILE_RE = re.compile(
    r"^courses/[^/]+/(course\.yaml|info\.md|policies\.md|schedule\.yaml)$"
)
REVISED_LINE_RE = re.compile(r"^revised\s*:\s*[^\r\n]*(?P<ending>\r?\n|$)", re.MULTILINE)


def git(*args: str, input_text: str | None = None) -> str:
    """Run Git at the repository root and return standard output."""
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        input=input_text,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or " ".join(("git", *args)))
    return result.stdout


def has_substantive_course_yaml_change(path: str) -> bool:
    """Ignore a commit that changes only an existing `revised` line."""
    diff = git("diff", "--cached", "--no-color", "--unified=0", "--", path)
    for line in diff.splitlines():
        if line.startswith(("+++", "---", "@@")) or not line.startswith(("+", "-")):
            continue
        if not re.match(r"^revised\s*:", line[1:].strip()):
            return True
    return False


def changed_courses() -> list[str]:
    """Return course.yaml paths for courses with staged syllabus changes."""
    paths = git("diff", "--cached", "--name-only", "--diff-filter=ACMR").splitlines()
    courses: set[str] = set()
    for path in paths:
        match = COURSE_FILE_RE.fullmatch(path)
        if not match:
            continue
        filename = match.group(1)
        if filename != "course.yaml" or has_substantive_course_yaml_change(path):
            courses.add(path.rsplit("/", 1)[0] + "/course.yaml")
    return sorted(courses)


def revised_text(text: str, today: str) -> str:
    """Replace or append the single course metadata revision date."""
    replacement = f'revised: {today}  # shown as "Last revised ..." in the footer'
    match = REVISED_LINE_RE.search(text)
    if match:
        return text[: match.start()] + replacement + match.group("ending") + text[match.end() :]
    if text and not text.endswith(("\n", "\r")):
        text += "\n"
    return text + replacement + "\n"


def index_mode(path: str) -> str:
    entry = git("ls-files", "--stage", "--", path).split(maxsplit=1)
    return entry[0] if entry else "100644"


def update_course(path: str, today: str) -> bool:
    """Update the staged metadata and, when safe, its working-tree counterpart."""
    try:
        staged = git("show", f":{path}")
    except RuntimeError:
        # A source file can be staged before its new course.yaml is staged.
        return False

    updated = revised_text(staged, today)
    if updated == staged:
        return False

    worktree_path = ROOT / path
    if worktree_path.is_file() and worktree_path.read_text(encoding="utf-8") == staged:
        worktree_path.write_text(updated, encoding="utf-8")
    elif worktree_path.is_file():
        print(f"Updated staged {path}; left its unstaged working-copy edits untouched.")

    blob = git("hash-object", "-w", "--stdin", input_text=updated).strip()
    git("update-index", "--add", "--cacheinfo", f"{index_mode(path)},{blob},{path}")
    print(f"Updated {path}: revised {today}")
    return True


def main() -> int:
    today = dt.date.today().isoformat()
    try:
        for path in changed_courses():
            update_course(path, today)
    except RuntimeError as error:
        print(f"Could not update revised date: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
