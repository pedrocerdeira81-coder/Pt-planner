const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
let logic = fs.readFileSync(path.join(root, 'src/logic.js'), 'utf8');
logic = logic.replace(/\nif \(typeof module[\s\S]*$/, '\n');
const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
const header = [
  '// PT Planner. Paste this whole file into Code.gs.',
  '// Do not put client names in this file. They stay in your private Google Sheet.',
  ''
].join('\n');
let html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
if (!html.includes('/*__PT_LOGIC__*/')) throw new Error('logic marker missing from src/index.html');
html = html.replace('/*__PT_LOGIC__*/', logic.trim());
fs.writeFileSync(path.join(root, 'apps-script/Index.html'), html);
if (html.includes('/*__PT_LOGIC__*/')) throw new Error('logic marker was not replaced');
if (!server.includes('return HTML_LITERAL;')) throw new Error('HTML placeholder missing from src/server.js');
const embedded = server.replace('return HTML_LITERAL;', 'return ' + JSON.stringify(html) + ';');
fs.writeFileSync(path.join(root, 'apps-script/Code.gs'), header + logic + '\n' + embedded);
console.log('built one Apps Script file and the preview (' + html.length + ' html chars)');
