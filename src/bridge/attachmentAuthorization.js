'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { AgentError } = require('../agent/agentErrors.js');
const { readBoundedUtf8File } = require('./fileContext.js');
const {
  MAX_ATTACHMENT_BYTES,
  validateAttachmentName,
} = require('./attachmentPolicy.js');

async function authorizeTextAttachment({ filePath, open = fs.open }) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new AgentError('ATTACHMENT_INVALID');
  const metadata = validateAttachmentName(path.basename(filePath));
  const handle = await open(filePath, 'r'); let consumed = false; let closed = false;
  const close = async () => { if (!closed) { closed = true; await handle.close(); } };
  try {
    const initial = await handle.stat();
    if (!initial.isFile() || initial.size > MAX_ATTACHMENT_BYTES) { await close(); throw new AgentError(initial.size > MAX_ATTACHMENT_BYTES ? 'ATTACHMENT_TOO_LARGE' : 'ATTACHMENT_INVALID'); }
    return Object.freeze({
      async consume() {
        if (consumed) throw new AgentError('ATTACHMENT_CONFIRMATION_EXPIRED');
        consumed = true;
        try {
          const current = await handle.stat();
          if (!current.isFile() || current.size !== initial.size) throw new AgentError('ATTACHMENT_CHANGED');
          return Object.freeze({
            ...metadata,
            size: initial.size,
            text: await readBoundedUtf8File({ handle, size: initial.size }),
          });
        } finally { await close(); }
      },
      cancel: close,
    });
  } catch (error) { await close(); throw error; }
}
module.exports = { authorizeTextAttachment };
