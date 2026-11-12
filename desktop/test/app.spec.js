import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
let disk, calls;
test.beforeEach(async ({ page }) => {
  disk = {};
  calls = [];
  for (const p of [
    "courses.yaml",
    "courses/ltn110/course.yaml",
    "courses/ltn110/schedule.yaml",
    "courses/ltn110/info.md",
    "courses/ltn110/policies.md",
    "assets/theme.css",
    "assets/custom.css",
  ])
    disk[p] = await fs.readFile("../" + p, "utf8");
  await page.exposeFunction("mockNative", async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === "choose_folder") return "/test/courses";
    if (cmd === "open_library") return "/test/courses";
    if (cmd === "read_files")
      return Object.fromEntries(args.paths.map((p) => [p, disk[p] ?? null]));
    if (cmd === "save_files") {
      for (const c of args.changes)
        if ((disk[c.path] ?? null) !== c.expected)
          throw Error(c.path + " changed outside Syllabusser");
      for (const c of args.changes) disk[c.path] = c.text;
      return;
    }
    if (cmd === "list_files") return ["courses/ltn110/files/reading.pdf"];
    if (cmd === "import_files") return ["courses/ltn110/files/new.pdf"];
    if (cmd === "git_review")
      return {
        remote: "https://github.com/example/courses.git",
        branch: "main",
        head: "abc1234",
        token: "review1",
        ahead: 0,
        behind: 0,
        excluded: 3,
        staged: false,
        files: [
          {
            path: "courses/ltn110/schedule.yaml",
            status: " M",
            diff: "-Old\n+New",
          },
        ],
      };
    if (cmd === "git_publish")
      return { commit: "abc1234", pushed: true, message: "Pushed to GitHub." };
    throw Error("Unexpected command " + cmd);
  });
  await page.addInitScript(() => {
    window.__SYLLABUSSER_TEST__ = window.mockNative;
    window.__SYLLABUSSER_PREVIEW__ = "http://127.0.0.1:4318/site/";
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open course folder…", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Introduction to Latin" }),
  ).toBeVisible();
});
test("calendar return applies, save writes, undo retains drafts", async ({
  page,
}) => {
  const f = page.frameLocator("#schedule-editor");
  await f.locator(".day[role=button]").first().click();
  const input = f.locator("#topic-title");
  await expect(input).toBeFocused();
  await input.fill("Desktop test topic");
  await input.press("Enter");
  await expect(f.locator(".day[role=button]").first()).toContainText(
    "Desktop test topic",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#save-label")).toHaveText("Saved locally");
  await expect
    .poll(() => disk["courses/ltn110/schedule.yaml"])
    .toContain("Desktop test topic");
  await f.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(f.locator("#save-status")).toContainText("Unsaved");
});
test("native save rejects outside edits and keeps the draft", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Info", exact: true }).click();
  await page.locator("#markdown").fill("# My draft");
  disk["courses/ltn110/info.md"] = "# External edit";
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("changed outside");
  expect(disk["courses/ltn110/info.md"]).toBe("# External edit");
  await expect(page.locator("#markdown")).toHaveValue("# My draft");
  await page.reload();
  await page.getByRole("button", { name: "Info", exact: true }).click();
  await expect(page.locator("#markdown")).toHaveValue("# My draft");
});
test("appearance controls save separately and preview renders actual course", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.locator("#theme-base-size").fill("20");
  await page.locator("#theme-base-size").dispatchEvent("input");
  await expect(page.frameLocator("#site-preview").locator("html")).toHaveCSS(
    "font-size",
    "20px",
  );
  await page.getByText("Custom CSS", { exact: true }).click();
  await page
    .locator("#custom-css")
    .fill(".site-title { letter-spacing: 0.02em; }");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => disk["assets/theme.css"])
    .toContain("--base-size: 20px");
  expect(disk["assets/custom.css"]).toContain("letter-spacing");
  await expect(
    page.frameLocator("#site-preview").locator(".course-title"),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/appearance.png",
    fullPage: true,
  });
});
test("new course creates manifest and complete site stubs", async ({
  page,
}) => {
  await page.getByRole("button", { name: "+ New course", exact: true }).click();
  for (const [name, value] of Object.entries({
    slug: "latin-spring",
    code: "LTN 111",
    title: "Latin II",
    term: "Spring 2027",
    start_date: "2027-01-11",
    end_date: "2027-05-01",
  }))
    await page.locator(`#new-course [name=${name}]`).fill(value);
  await page
    .getByRole("button", { name: "Create course", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Latin II", exact: true }),
  ).toBeVisible();
  expect(disk["courses.yaml"]).toContain("latin-spring");
  expect(disk["courses/latin-spring/schedule.html"]).toContain(
    'data-page="schedule"',
  );
  expect(disk["courses/latin-spring/schedule.yaml"]).toContain("topics:");
});
test("publish is explicit and sends only checked review files", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Review & publish", exact: true })
    .click();
  await expect(
    page.getByText("3 changes outside the course site are excluded.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(calls.some(([cmd]) => cmd === "git_publish")).toBe(false);
  await page
    .getByRole("button", { name: "Commit & push", exact: true })
    .click();
  await expect(page.locator("#publish-result")).toContainText(
    "Pushed to GitHub",
  );
  const publish = calls.find(([cmd]) => cmd === "git_publish")[1];
  expect(publish.paths).toEqual(["courses/ltn110/schedule.yaml"]);
  expect(publish.token).toBe("review1");
});
