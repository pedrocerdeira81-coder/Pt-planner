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
fs.writeFileSync(path.join(root, 'apps-script/Code.gs'), header + logic + '\n' + server);
let html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
if (!html.includes('/*__PT_LOGIC__*/')) throw new Error('logic marker missing from src/index.html');
html = html.replace('/*__PT_LOGIC__*/', logic.trim());
fs.writeFileSync(path.join(root, 'apps-script/Index.html'), html);
if (html.includes('/*__PT_LOGIC__*/')) throw new Error('logic marker was not replaced');
console.log('built apps-script/Code.gs and apps-script/Index.html (' + html.length + ' html chars)');
