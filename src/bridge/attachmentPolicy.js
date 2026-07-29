'use strict';

const path = require('node:path');

const { AgentError } = require('../agent/agentErrors.js');

const MAX_ATTACHMENT_BYTES = 49152;
const TEXT_ATTACHMENT_EXTENSIONS = Object.freeze(new Set([
  '.txt', '.md', '.rst', '.log',
  '.json', '.jsonl', '.csv', '.tsv', '.xml', '.yaml', '.yml', '.toml',
  '.ini', '.cfg', '.conf',
  '.html', '.htm', '.css', '.scss',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.java', '.c',
  '.cc', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.rb', '.php',
  '.sql', '.sh', '.ps1',
]));

function validateAttachmentName(value) {
  if (typeof value !== 'string'
      || value.length === 0
      || value.includes('\0')
      || path.win32.basename(value) !== value
      || path.posix.basename(value) !== value
      || value.startsWith('.')) {
    throw new AgentError('ATTACHMENT_INVALID');
  }
  const extension = path.extname(value).toLowerCase();
  if (!TEXT_ATTACHMENT_EXTENSIONS.has(extension)) {
    throw new AgentError('ATTACHMENT_INVALID');
  }
  return Object.freeze({ name: value, extension });
}

function attachmentFormatDescription() {
  return 'UTF-8 text, documentation, data, configuration, web, or source files up to 48 KiB';
}

module.exports = {
  MAX_ATTACHMENT_BYTES,
  TEXT_ATTACHMENT_EXTENSIONS,
  attachmentFormatDescription,
  validateAttachmentName,
};
