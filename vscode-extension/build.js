const fs = require('node:fs');
const path = require('node:path');
fs.copyFileSync(path.join(__dirname, '../assets/schedule-core.js'), path.join(__dirname, 'media/schedule-core.js'));
fs.copyFileSync(path.join(__dirname, '../assets/vendor/marked.min.js'), path.join(__dirname, 'media/marked.min.js'));
