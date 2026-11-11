'use strict';
const vscode = require('vscode');
const path = require('node:path');
const crypto = require('node:crypto');
const model = require('./model');

function activate(context) {
  let activePanel;
  context.subscriptions.push(vscode.commands.registerCommand('syllabusser.save', () => activePanel?.webview.postMessage({ type: 'requestSave' })));
  context.subscriptions.push(vscode.commands.registerCommand('syllabusser.open', async uri => {
    if (!uri) {
      const files = await vscode.workspace.findFiles('**/schedule.yaml', '**/node_modules/**');
      if (!files.length) return vscode.window.showInformationMessage('Open a folder containing schedule.yaml and course.yaml.');
      const picked = await vscode.window.showQuickPick(files.map(u => ({ label: vscode.workspace.asRelativePath(u), uri: u })), { placeHolder: 'Choose a course schedule' });
      uri = picked?.uri;
    }
    if (uri) await vscode.commands.executeCommand('vscode.openWith', uri, 'syllabusser.schedule');
  }));
  context.subscriptions.push(vscode.window.registerCustomEditorProvider('syllabusser.schedule', {
    async resolveCustomTextEditor(document, panel) {
      activePanel = panel;
      panel.onDidChangeViewState(() => { if (panel.active) activePanel = panel; });
      const courseDir = vscode.Uri.joinPath(document.uri, '..');
      const course = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(courseDir, 'course.yaml'));
      panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] };
      const resource = file => panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', file));
      const nonce = crypto.randomBytes(24).toString('hex');
      panel.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${panel.webview.cspSource} data:;"><link rel="stylesheet" href="${resource('editor.css')}"><title>Schedule Editor</title></head><body><div id="app"><p>Loading schedule…</p></div><script nonce="${nonce}" src="${resource('schedule-core.js')}"></script><script nonce="${nonce}" src="${resource('marked.min.js')}"></script><script nonce="${nonce}" src="${resource('editor.js')}"></script></body></html>`;
      let applying = false, disposed = false;
      async function send() {
        if (disposed) return;
        try {
          const state = model.load(document.getText(), course.getText());
          await panel.webview.postMessage({ type: 'state', schedule: state.schedule, course: state.course,
            version: document.version, courseVersion: course.version, dirty: document.isDirty || course.isDirty });
        } catch (e) { await panel.webview.postMessage({ type: 'error', message: e.message, fatal: true }); }
      }
      const same = doc => doc.uri.toString() === document.uri.toString() || doc.uri.toString() === course.uri.toString();
      const change = vscode.workspace.onDidChangeTextDocument(e => { if (same(e.document) && !applying) send(); });
      const saveListener = vscode.workspace.onDidSaveTextDocument(doc => { if (same(doc) && !applying) send(); });
      panel.onDidDispose(() => { disposed = true; change.dispose(); saveListener.dispose(); });
      function current(message) {
        if (message.version !== document.version || message.courseVersion !== course.version) throw new Error('The files changed in another editor. Your calendar has been refreshed; please try the change again.');
      }
      async function commit(message) {
        current(message);
        const out = model.serialize(document.getText(), course.getText(), message);
        const edit = new vscode.WorkspaceEdit();
        let hasChanges = false;
        for (const [doc, text] of [[document, out.scheduleText], [course, out.courseText]]) {
          if (text !== doc.getText()) {
            edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
            hasChanges = true;
          }
        }
        // VS Code returns false for an empty WorkspaceEdit. Nothing to change is
        // a successful Apply; the caller must still be allowed to save dirty files.
        if (!hasChanges) return;
        applying = true;
        try { if (!(await vscode.workspace.applyEdit(edit))) throw new Error('VS Code could not apply the edit.'); }
        finally { applying = false; }
      }
      async function attach(message) {
        current(message);
        const base = model.load(document.getText(), course.getText());
        const topic = base.schedule.topics.find(t => t._key === message.key);
        if (!topic) throw new Error('Select a topic before adding files.');
        const folder = vscode.Uri.joinPath(courseDir, 'files');
        let targets = [];
        if (message.existing) {
          let entries = [];
          try { entries = await vscode.workspace.fs.readDirectory(folder); } catch { /* empty library */ }
          const selected = await vscode.window.showQuickPick(entries.filter(([, type]) => type === vscode.FileType.File).map(([name]) => ({ label: name })), { canPickMany: true, placeHolder: 'Choose course files' });
          if (!selected?.length) return;
          targets = selected.map(item => item.label);
        } else {
          const selected = message.uploads || await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: 'Attach to topic' });
          if (!selected?.length) return;
          if (message.uploads && selected.reduce((sum, item) => sum + String(item.base64 || '').length, 0) > 70000000) throw new Error('Drop fewer than 50 MB at a time, or use Add file.');
          await vscode.workspace.fs.createDirectory(folder);
          for (const source of selected) {
            const upload = !!message.uploads;
            let name = upload ? source.name : path.posix.basename(source.path);
            if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) throw new Error('Invalid attachment filename.');
            let target = vscode.Uri.joinPath(folder, name);
            const copyFile = async (destination, overwrite) => {
              if (!upload) return vscode.workspace.fs.copy(source, destination, { overwrite });
              if (!overwrite) {
                try { await vscode.workspace.fs.stat(destination); throw new Error('That filename already exists. Choose a different name.'); }
                catch (e) { if (e.code !== 'FileNotFound') throw e; }
              }
              await vscode.workspace.fs.writeFile(destination, Buffer.from(source.base64, 'base64'));
            };
            if (upload || source.toString() !== target.toString()) {
              let exists = false;
              try { await vscode.workspace.fs.stat(target); exists = true; } catch { /* absent */ }
              if (exists) {
                const answer = await vscode.window.showQuickPick(['Rename new file', 'Use existing file', 'Replace existing file'], { placeHolder: name + ' already exists' });
                if (!answer) continue;
                if (answer === 'Use existing file') { targets.push(name); continue; }
                if (answer === 'Rename new file') {
                  name = await vscode.window.showInputBox({ prompt: 'New filename', value: name, validateInput: n => !n || n === '.' || n === '..' || /[\\/]/.test(n) ? 'Enter a filename without folders.' : undefined });
                  if (!name) continue;
                  target = vscode.Uri.joinPath(folder, name);
                  await copyFile(target, false);
                } else await copyFile(target, true);
              } else await copyFile(target, false);
            }
            targets.push(name);
          }
        }
        current(message);
        topic.links = [...(topic.links || []), ...targets.map(name => ({ text: name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '), url: 'files/' + encodeURIComponent(name) }))];
        await commit({ ...message, schedule: base.schedule, course: base.course });
      }
      let queue = Promise.resolve();
      async function saveBoth() {
        applying = true;
        try {
          if (!(await document.save()) || !(await course.save())) throw new Error('One of the files could not be saved. Check the unsaved tabs.');
        } finally { applying = false; }
      }
      panel.webview.onDidReceiveMessage(message => {
        queue = queue.then(async () => {
          try {
            if (message.type === 'ready') return;
            if (message.type === 'edit') {
              await commit(message);
              if (message.save) await saveBoth();
            }
            if (message.type === 'attach') await attach(message);
            if (message.type === 'save') await saveBoth();
            if (message.type === 'undo' || message.type === 'redo') await vscode.commands.executeCommand(message.type);
            if (message.type === 'source') await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
          } catch (e) {
            await panel.webview.postMessage({ type: 'error', message: e.message });
            vscode.window.showErrorMessage(e.message);
          } finally { await send(); }
        });
      });
    }
  }, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }));
}
exports.activate = activate;
