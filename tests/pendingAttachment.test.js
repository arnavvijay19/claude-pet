'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPendingAttachment } = require('../src/bridge/pendingAttachment.js');

function authorization(attachment, events) {
  return {
    async consume() {
      events.push('consume');
      if (attachment instanceof Error) throw attachment;
      return attachment;
    },
    async cancel() { events.push('cancel'); },
  };
}

test('publishes metadata but keeps path and text in main', async () => {
  const events = [];
  const pending = createPendingAttachment({
    authorize: async ({ filePath }) => {
      assert.equal(filePath, 'C:\\private\\notes.md');
      return authorization({
        name: 'notes.md', extension: '.md', size: 12, text: 'private text',
      }, events);
    },
    confirm: async (metadata) => {
      assert.deepEqual(metadata, { name: 'notes.md', extension: '.md', size: 12 });
      return true;
    },
  });

  await pending.stage('C:\\private\\notes.md');
  assert.deepEqual(pending.snapshot(), { name: 'notes.md', extension: '.md', size: 12 });
  assert.doesNotMatch(JSON.stringify(pending.snapshot()), /private text|C:\\/);
  assert.deepEqual(events, ['consume', 'cancel']);
});

test('retains the previous attachment when replacement fails or is declined', async () => {
  const attachments = [
    { name: 'first.txt', extension: '.txt', size: 5, text: 'first' },
    { name: 'second.md', extension: '.md', size: 6, text: 'second' },
    new Error('invalid third file'),
  ];
  let index = 0;
  const pending = createPendingAttachment({
    authorize: async () => authorization(attachments[index++], []),
    confirm: async (metadata) => metadata.name === 'first.txt',
  });
  await pending.stage('C:\\first.txt');
  assert.equal(await pending.stage('C:\\second.md'), false);
  assert.deepEqual(pending.snapshot(), { name: 'first.txt', extension: '.txt', size: 5 });
  await assert.rejects(pending.stage('C:\\third.md'), /invalid third file/);
  assert.deepEqual(pending.snapshot(), { name: 'first.txt', extension: '.txt', size: 5 });
});

test('clear and take are one-use and never reopen a path', async () => {
  let authorizations = 0;
  const attachment = { name: 'one.csv', extension: '.csv', size: 3, text: 'a,b' };
  const pending = createPendingAttachment({
    authorize: async () => {
      authorizations += 1;
      return authorization(attachment, []);
    },
    confirm: async () => true,
  });
  await pending.stage('C:\\one.csv');
  assert.deepEqual(pending.take(), attachment);
  assert.equal(pending.take(), null);
  assert.equal(pending.snapshot(), null);
  await pending.stage('C:\\one.csv');
  pending.clear();
  assert.equal(pending.snapshot(), null);
  assert.equal(authorizations, 2);
});
