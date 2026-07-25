'use strict';

const fs = require('node:fs');
const { spawn } = require('node:child_process');

const [childPidPath, grandchildPidPath, grandchildScript] = process.argv.slice(2);
fs.writeFileSync(childPidPath, String(process.pid));
const grandchild = spawn(process.execPath, [grandchildScript, grandchildPidPath], { stdio: 'ignore', windowsHide: true });
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
