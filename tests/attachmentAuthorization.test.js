'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { authorizeTextAttachment } = require('../src/bridge/attachmentAuthorization.js');

function handleFor(bytes, { changedSize = null } = {}) {
  const source = Buffer.from(bytes);
  let statCalls = 0;
  let closed = false;
  return {
    async stat() {
      statCalls += 1;
      const size = statCalls > 1 && changedSize !== null ? changedSize : source.length;
      return { isFile: () => true, size };
    },
    async read(buffer, offset, length, position) {
      const bytesRead = source.copy(
        buffer,
        offset,
        position,
        Math.min(source.length, position + length),
      );
      return { bytesRead, buffer };
    },
    async close() { closed = true; },
    isClosed: () => closed,
  };
}

test('rejects a disallowed extension before opening the path', async () => {
  let opens = 0;
  await assert.rejects(
    authorizeTextAttachment({
      filePath: 'C:\\Users\\owner\\photo.png',
      open: async () => { opens += 1; },
    }),
    (error) => error.code === 'ATTACHMENT_INVALID',
  );
  assert.equal(opens, 0);
});

test('consumes one bounded attachment with public metadata and closes its handle', async () => {
  const handle = handleFor('hello');
  const authorization = await authorizeTextAttachment({
    filePath: 'C:\\Users\\owner\\NOTES.MD',
    open: async () => handle,
  });

  assert.deepEqual(await authorization.consume(), {
    name: 'NOTES.MD',
    extension: '.md',
    size: 5,
    text: 'hello',
  });
  assert.equal(handle.isClosed(), true);
  await assert.rejects(
    authorization.consume(),
    (error) => error.code === 'ATTACHMENT_CONFIRMATION_EXPIRED',
  );
});

test('an allowlisted extension does not authorize NUL or changed content', async () => {
  const binary = await authorizeTextAttachment({
    filePath: 'C:\\Users\\owner\\notes.txt',
    open: async () => handleFor(Buffer.from('a\0')),
  });
  await assert.rejects(
    binary.consume(),
    (error) => error.code === 'ATTACHMENT_INVALID',
  );

  const changed = await authorizeTextAttachment({
    filePath: 'C:\\Users\\owner\\notes.txt',
    open: async () => handleFor('hello', { changedSize: 6 }),
  });
  await assert.rejects(
    changed.consume(),
    (error) => error.code === 'ATTACHMENT_CHANGED',
  );
});
