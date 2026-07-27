'use strict';
const fs = require('node:fs'); const path = require('node:path');
const FORBIDDEN = new Map([['connections.json','runtime-state'],['sessions.json','runtime-state'],['providers.json','runtime-state'],['auth.json','auth-file'],['credentials.json','auth-file'],['.env','environment-file'],['.git','development-tree'],['.claude','development-tree'],['.codex','development-tree'],['.agents','development-tree'],['docs','development-tree'],['tests','development-tree'],['scripts','development-tree']]);
function fail(relative, rule) { throw new Error(`${rule}: ${relative.replace(/\\/g, '/')}`); }
function verifyPackage(packageRoot, { readFile = fs.readFileSync, walk = fs.readdirSync } = {}) {
  const root = path.resolve(packageRoot); let files = 0; let bytes = 0;
  const visit = (directory) => { for (const entry of walk(directory, { withFileTypes: true })) { const full = path.join(directory, entry.name); const relative = path.relative(root, full); const stat = fs.lstatSync(full); if (stat.isSymbolicLink() || stat.isBlockDevice() || stat.isCharacterDevice()) fail(relative, 'reparse-object'); const rule = FORBIDDEN.get(entry.name.toLowerCase()); if (rule) fail(relative, rule); if (/\.map$/i.test(entry.name)) fail(relative, 'source-map-suffix'); if (stat.isDirectory()) { visit(full); continue; } if (!stat.isFile()) fail(relative, 'unsupported-object'); files += 1; bytes += stat.size; if (stat.size <= 1024 * 1024 && /\.(?:js|json|txt|md|html|css)$/i.test(entry.name)) { const text = readFile(full, 'utf8'); if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{16,}|(?:sk-|ghp_|github_pat_|xoxb-|AKIA)[A-Za-z0-9_-]{12,}/i.test(text)) fail(relative, 'secret-pattern'); } } };
  visit(root); return Object.freeze({ files, bytes });
}
if (require.main === module) { const result = verifyPackage(process.argv[2]); process.stdout.write(`${JSON.stringify(result)}\n`); }
module.exports = { verifyPackage, FORBIDDEN };
