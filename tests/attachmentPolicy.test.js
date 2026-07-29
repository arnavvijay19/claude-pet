'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_ATTACHMENT_BYTES,
  TEXT_ATTACHMENT_EXTENSIONS,
  attachmentFormatDescription,
  validateAttachmentName,
} = require('../src/bridge/attachmentPolicy.js');

test('accepts readable source and configuration types with one 48 KiB policy', () => {
  assert.equal(MAX_ATTACHMENT_BYTES, 49152);
  assert.equal(validateAttachmentName('query.SQL').extension, '.sql');
  assert.equal(validateAttachmentName('notes.md').extension, '.md');
  assert.equal(TEXT_ATTACHMENT_EXTENSIONS.has('.jsonl'), true);
  assert.match(attachmentFormatDescription(), /48 KiB/);
});

test('rejects binary, disguised, dotfile, and path-shaped names', () => {
  for (const name of [
    'photo.png',
    'report.pdf',
    'archive.zip',
    '.env',
    'notes.txt.exe',
    'folder\\notes.txt',
    '../notes.txt',
  ]) {
    assert.throws(
      () => validateAttachmentName(name),
      (error) => error.code === 'ATTACHMENT_INVALID',
    );
  }
});
