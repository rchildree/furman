const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../model');
const root = path.join(__dirname, '../..');
test.use({ viewport: { width: 1250, height: 900 } });

async function setup(page, recovered) {
  let schedule = fs.readFileSync(path.join(root, 'courses/ltn110/schedule.yaml'), 'utf8');
  let course = fs.readFileSync(path.join(root, 'courses/ltn110/course.yaml'), 'utf8');
  let version = 1;
  const history = [], redo = [];
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  async function state() {
    const loaded = model.load(schedule, course);
    await page.evaluate(data => window.postMessage(data, '*'), { type: 'state', schedule: loaded.schedule, course: loaded.course, version, courseVersion: version, dirty: version > 1 });
  }
  await page.exposeFunction('hostMessage', async message => {
    if (message.type === 'edit') {
      try {
        expect(message.version).toBe(version);
        const out = model.serialize(schedule, course, message);
        history.push([schedule, course]); redo.length = 0;
        schedule = out.scheduleText; course = out.courseText; version++;
      } catch (e) { await page.evaluate(message => window.postMessage({ type: 'error', message }, '*'), e.message); }
    }
    if (message.type === 'undo' && history.length) { redo.push([schedule, course]); [schedule, course] = history.pop(); version++; }
    if (message.type === 'redo' && redo.length) { history.push([schedule, course]); [schedule, course] = redo.pop(); version++; }
    await state();
  });
  await page.setContent('<div id="app"></div>');
  await page.addStyleTag({ content: ':root { --vscode-editor-background: #fcfcfa; --vscode-editor-foreground: #252b2b; --vscode-panel-border: #d8deda; --vscode-descriptionForeground: #646e6b; --vscode-button-secondaryBackground:#ebefeb; --vscode-button-secondaryForeground:#252b2b; --vscode-button-background:#315b4a; --vscode-button-foreground:#fff; --vscode-focusBorder:#315b4a; --vscode-input-background:#fff; --vscode-input-foreground:#252b2b; --vscode-badge-background:#e1ece3; --vscode-badge-foreground:#315b4a; --vscode-list-inactiveSelectionBackground:#eff5ee; --vscode-sideBar-background:#f1f2ee; --vscode-inputValidation-errorBorder:#b24832; --vscode-inputValidation-warningBorder:#a9874d; }' });
  await page.addStyleTag({ path: path.join(__dirname, '../media/editor.css') });
  await page.evaluate(recovered => { window.savedWebviewState = recovered; window.acquireVsCodeApi = () => ({ postMessage: window.hostMessage, setState: value => { window.savedWebviewState = value; }, getState: () => window.savedWebviewState }); }, recovered);
  await page.addScriptTag({ path: path.join(__dirname, '../media/schedule-core.js') });
  await page.addScriptTag({ path: path.join(__dirname, '../media/marked.min.js') });
  await page.addScriptTag({ path: path.join(__dirname, '../media/editor.js') });
  await expect(page.locator('h1')).toContainText('LTN 110');
  return { state, read: () => model.load(schedule, course), errors, external: async () => { const parsed = model.load(schedule, course); parsed.schedule.topics[0].title = 'External change'; const out = model.serialize(schedule, course, parsed); schedule = out.scheduleText; version++; await state(); } };
}

test('edit, lock, drag, clear, undo and preview', async ({ page }) => {
  const host = await setup(page);
  await page.locator('[data-select="2026-09-21"]').click();
  await page.getByLabel('Lock to a date', { exact: true }).check();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('[data-date="2026-09-21"]')).toContainText('Locked');
  await page.locator('[data-select="2026-09-14"]').scrollIntoViewIfNeeded();
  const source = await page.locator('[data-select="2026-09-14"]').boundingBox();
  const target = await page.locator('[data-date="2026-09-22"]').boundingBox();
  await page.mouse.move(source.x + 20, source.y + 10);
  await page.mouse.down();
  await page.mouse.move(source.x + 30, source.y + 20, { steps: 5 });
  await page.mouse.move(target.x + 20, target.y + 30, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('[data-select="2026-09-22"]')).toContainText('LESSON 5');
  await expect(page.locator('[data-select="2026-09-21"]')).toContainText('Exam 1');
  await page.getByLabel('Topic', { exact: true }).fill('Review: "quoted" *Latin*');
  await page.getByLabel('Notes · Markdown supported').fill('Line one\nLine two: details.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-select="2026-09-22"]')).toContainText('Review: "quoted"');
  expect(host.read().schedule.topics.some(t => t.notes === 'Line one\nLine two: details.')).toBeTruthy();
  await page.locator('.topic-options summary').click();
  await page.getByRole('button', { name: 'Clear topic', exact: true }).click();
  await expect(page.locator('[data-select="2026-09-22"]')).toContainText('Add topic');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-select="2026-09-22"]')).toContainText('Review: "quoted"');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Schedule preview' })).toBeVisible();
  expect(host.errors).toEqual([]);
});
test('holiday preview, lock conflict, overflow and undo', async ({ page }) => {
  const host = await setup(page);
  await page.locator('[data-select="2026-11-23"]').click();
  await page.getByLabel('Lock to a date', { exact: true }).check();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('[data-date="2026-11-23"]')).toContainText('Locked');
  await page.getByRole('button', { name: '+ Holiday', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Extra break');
  await expect(page.getByRole('button', { name: 'Apply holiday', exact: true })).toBeDisabled();
  await page.getByLabel('First day').fill('2026-11-16');
  await page.getByLabel('Last day').fill('2026-11-17');
  await expect(page.locator('#holiday-impact')).toContainText('2 meetings removed');
  await page.getByRole('button', { name: 'Apply holiday', exact: true }).click();
  await expect(page.locator('[data-date="2026-11-16"]')).toContainText('Extra break');
  await expect(page.locator('[data-date="2026-11-23"]')).toContainText('Exam 4');
  await expect(page.getByRole('heading', { name: 'Unscheduled · 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-date="2026-11-16"]')).toContainText('LESSON 15');
  expect(host.read().course.holidays.length).toBe(3);
  expect(host.errors).toEqual([]);
});
test('assignment edits and external changes protect unsubmitted forms', async ({ page }) => {
  const host = await setup(page);
  await page.getByRole('button', { name: '+ Assignment', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Reading response');
  await page.getByLabel('Due date').fill('2026-11-15');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('[data-date="2026-11-15"]')).toContainText('Reading response');
  await page.locator('[data-select="2026-08-25"]').click();
  await page.getByLabel('Topic', { exact: true }).fill('Unsaved form text');
  await host.external();
  await expect(page.getByLabel('Topic', { exact: true })).toHaveValue('Unsaved form text');
  await expect(page.getByRole('button', { name: 'Reload files', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reload files', exact: true }).click();
  await expect(page.getByLabel('Topic', { exact: true })).toHaveValue('External change');
  expect(host.errors).toEqual([]);
});
test('calendar layout at desktop and narrow widths', async ({ page }) => {
  await setup(page);
  // Padding and the date label are part of the edit target, not just the title.
  await page.locator('[data-select="2026-08-27"]').click({ position: { x: 5, y: 5 } });
  await expect(page.getByLabel('Topic', { exact: true })).toHaveValue('LESSON 1. The textbook. Beginnings.');
  await expect(page.locator('.week-label')).toHaveText(Array.from({ length: 16 }, (_, i) => 'Week ' + (i + 1)));
  await expect(page.locator('.days').first().locator('.placeholder')).toHaveCount(1);
  await expect(page.locator('.days').last().locator('.placeholder')).toHaveCount(2);
  await expect(page.locator('[data-date="2026-08-25"] .meeting-number')).toHaveText('#1');
  await expect(page.locator('[data-date="2026-09-07"] .meeting-number')).toHaveCount(0);
  await expect(page.locator('[data-date="2026-09-08"] .meeting-number')).toHaveText('#8');
  const geometry = await page.locator('.days').evaluateAll(grids => grids.map(grid => [...grid.children].map(card => ({ x: card.getBoundingClientRect().x, width: card.getBoundingClientRect().width }))));
  expect(geometry.every(row => row.length === 4)).toBeTruthy();
  for (const row of geometry) row.forEach((card, i) => {
    expect(Math.abs(card.x - geometry[0][i].x)).toBeLessThan(1);
    expect(Math.abs(card.width - geometry[0][i].width)).toBeLessThan(1);
  });
  await expect(page.getByRole('heading', { name: 'Move topic', exact: true })).toHaveCount(0);
  await expect(page.locator('.form-actions > button')).toHaveText(['Apply', 'Reset']);
  await expect(page.locator('[data-date="2026-09-07"]')).toHaveClass(/holiday/);
  await expect(page.locator('[data-date="2026-09-21"]')).toHaveClass(/exam/);
  await page.screenshot({ path: '/tmp/syllabusser-editor-desktop.png', fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.setViewportSize({ width: 550, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(await page.locator('.days').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(4);
});

test('unfinished forms recover when the webview is recreated', async ({ page }) => {
  await setup(page);
  await page.locator('[data-select="2026-08-25"]').click();
  await page.getByLabel('Topic', { exact: true }).fill('Recovered topic draft');
  const draft = await page.evaluate(() => window.savedWebviewState);
  const restored = await page.context().newPage();
  const host = await setup(restored, draft);
  await expect(restored.getByLabel('Topic', { exact: true })).toHaveValue('Recovered topic draft');
  await restored.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(restored.locator('[data-select="2026-08-25"] .topic')).toHaveText('Recovered topic draft');
  expect(host.read().schedule.topics[0].title).toBe('Recovered topic draft');
});

test('published schedule and Now page honor a fixed exam date', async ({ page }) => {
  const initial = model.load(fs.readFileSync(path.join(root, 'courses/ltn110/schedule.yaml'), 'utf8'), fs.readFileSync(path.join(root, 'courses/ltn110/course.yaml'), 'utf8'));
  initial.schedule.topics.find(t => t.title === 'Exam 4').fixed_date = '2026-11-20';
  const YAML = require('yaml');
  const messages = [];
  page.on('pageerror', e => messages.push(e.message));
  await page.route('http://syllabusser.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/schedule.yaml')) return route.fulfill({ contentType: 'text/yaml', body: YAML.stringify(model.clean(initial.schedule)) });
    const file = path.join(root, url.pathname);
    const contentType = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    await route.fulfill({ contentType, body: fs.readFileSync(file) });
  });
  await page.goto('http://syllabusser.test/courses/ltn110/schedule.html');
  const exam = page.locator('.meeting.exam').filter({ hasText: 'Exam 4' });
  await expect(exam.locator('.dom')).toHaveText('20');
  await page.goto('http://syllabusser.test/courses/ltn110/index.html?today=2026-11-10');
  await expect(page.locator('.due-item').filter({ hasText: 'Exam 4' }).locator('.dom')).toHaveText('20');
  expect(messages).toEqual([]);
});
