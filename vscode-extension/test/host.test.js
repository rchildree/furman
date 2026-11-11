const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../model');
const disposable = () => ({ dispose() {} });

async function host() {
  const uri = value => ({ path: value, toString: () => value });
  let provider, receive, changed, saved, resolver;
  const states = [], errors = [], commands = new Map();
  const files = new Map([['/incoming/guide #1.pdf', Buffer.from('PDF fixture')]]);
  const docs = new Map();
  for (const name of ['schedule.yaml', 'course.yaml']) {
    const doc = { uri: uri('/course/' + name), version: 1, isDirty: false, saves: 0,
      text: fs.readFileSync(path.join(__dirname, '../../courses/ltn110/' + name), 'utf8'),
      getText() { return this.text; }, positionAt(n) { return n; },
      async save() { this.saves++; this.isDirty = false; saved?.(this); return true; } };
    docs.set(doc.uri.toString(), doc);
  }
  const vscode = {
    Uri: { joinPath: (base, ...parts) => uri(path.posix.join(base.path, ...parts)) },
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    WorkspaceEdit: class { edits = []; replace(uri, range, text) { this.edits.push({ uri, text }); } },
    FileType: { File: 1 },
    commands: { registerCommand: (name, fn) => { commands.set(name, fn); return disposable(); }, executeCommand: async () => {} },
    window: {
      registerCustomEditorProvider: (name, p) => { provider = p; return disposable(); },
      showErrorMessage: message => errors.push(message),
      showOpenDialog: async () => [uri('/incoming/guide #1.pdf')],
      showQuickPick: async options => typeof options[0] === 'string' ? 'Use existing file' : [options[0]],
      showInputBox: async () => 'renamed.pdf'
    },
    workspace: {
      openTextDocument: async u => docs.get(u.toString()),
      onDidChangeTextDocument: fn => { changed = fn; return disposable(); },
      onDidSaveTextDocument: fn => { saved = fn; return disposable(); },
      applyEdit: async edit => { for (const e of edit.edits) { const doc = docs.get(e.uri.toString()); doc.text = e.text; doc.version++; doc.isDirty = true; changed?.({ document: doc }); } return true; },
      fs: {
        createDirectory: async () => {},
        stat: async u => { if (!files.has(u.path)) throw Object.assign(new Error('Missing'), { code: 'FileNotFound' }); return {}; },
        copy: async (from, to, { overwrite }) => { if (!overwrite && files.has(to.path)) throw new Error('Exists'); files.set(to.path, files.get(from.path)); },
        writeFile: async (to, bytes) => files.set(to.path, bytes),
        readDirectory: async folder => [...files.keys()].filter(p => path.posix.dirname(p) === folder.path).map(p => [path.posix.basename(p), 1])
      }
    }
  };
  const panel = { active: true, onDidChangeViewState: disposable, onDidDispose: disposable, webview: {
    asWebviewUri: value => value.toString(), cspSource: 'test:',
    postMessage: async message => {
      if (message.type === 'state') { states.push(message); if (resolver) { const resolve = resolver; resolver = undefined; resolve(message); } }
    },
    onDidReceiveMessage: callback => { receive = callback; }
  } };
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8'), {
    exports, Buffer, require: name => name === 'vscode' ? vscode : name === './model' ? model : require(name)
  });
  exports.activate({ subscriptions: [], extensionUri: uri('/extension') });
  await provider.resolveCustomTextEditor(docs.get('/course/schedule.yaml'), panel);
  async function send(message) {
    const response = new Promise(resolve => { resolver = resolve; });
    receive(message);
    return response;
  }
  await send({ type: 'ready' });
  return { send, docs, files, errors, states, last: () => states.at(-1), panel, commands };
}

test('extension applies topic and holiday edits, then saves both documents', async () => {
  const h = await host(), before = h.last();
  const next = structuredClone(before);
  next.schedule.topics[0].title = 'Updated in VS Code';
  next.course.holidays.push({ name: 'Extra break', date: '2026-09-01' });
  await h.send({ ...next, type: 'edit', save: true });
  assert.equal(h.errors.length, 0);
  assert.match(h.docs.get('/course/schedule.yaml').text, /Updated in VS Code/);
  assert.match(h.docs.get('/course/course.yaml').text, /Extra break/);
  assert.equal(h.docs.get('/course/schedule.yaml').saves, 1);
  assert.equal(h.docs.get('/course/course.yaml').saves, 1);
  assert.match(h.panel.webview.html, /Content-Security-Policy/);
  assert.ok(h.commands.has('syllabusser.save'));
});
test('stale edits are rejected without overwriting the current documents', async () => {
  const h = await host();
  const before = h.docs.get('/course/schedule.yaml').text;
  await h.send({ ...h.last(), type: 'edit', version: 0 });
  assert.match(h.errors[0], /another editor/);
  assert.equal(h.docs.get('/course/schedule.yaml').text, before);
});
test('file picker copies attachments, percent-encodes URLs, and reuses existing files', async () => {
  const h = await host();
  await h.send({ ...h.last(), type: 'attach', key: 't0' });
  assert.equal(h.files.get('/course/files/guide #1.pdf').toString(), 'PDF fixture');
  assert.equal(h.last().schedule.topics[0].links[0].url, 'files/guide%20%231.pdf');
  await h.send({ ...h.last(), type: 'attach', key: 't1', existing: true });
  assert.equal(h.last().schedule.topics[1].links.at(-1).url, 'files/guide%20%231.pdf');
  assert.equal(h.errors.length, 0);
});
test('file drops write bytes and reject path traversal filenames', async () => {
  const h = await host();
  await h.send({ ...h.last(), type: 'attach', key: 't0', uploads: [{ name: 'handout.pdf', base64: Buffer.from('Dropped PDF').toString('base64') }] });
  assert.equal(h.files.get('/course/files/handout.pdf').toString(), 'Dropped PDF');
  await h.send({ ...h.last(), type: 'attach', key: 't0', uploads: [{ name: '../outside.pdf', base64: '' }] });
  assert.match(h.errors.at(-1), /Invalid attachment/);
  assert.equal(h.files.has('/course/outside.pdf'), false);
});
