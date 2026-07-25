'use strict';

const fs = require('node:fs');
fs.writeFileSync(process.argv[2], String(process.pid));
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
