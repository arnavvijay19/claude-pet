'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  activityEventLabel,
  classifyActivityEvent,
  formatActivityTimestamp,
  activityEventSummary,
  splitActivityEvents,
} = require('../src/app/activityModel.js');

test('labels every activity kind with a safe, concise string', () => {
  assert.equal(activityEventLabel({ kind: 'file', operation: 'write', path: 'notes.txt' }), 'Updated notes.txt');
  assert.equal(activityEventLabel({ kind: 'file', operation: 'read', path: 'notes.txt' }), 'Read notes.txt');
  assert.equal(activityEventLabel({ kind: 'command', exitCode: 1 }), 'Command failed');
  assert.equal(activityEventLabel({ kind: 'tool', toolName: 'Read' }), 'Used Read');
  assert.equal(activityEventLabel({ kind: 'permission', decision: 'allow', permission: 'files' }), 'Allowed files');
  assert.equal(activityEventLabel({ kind: 'network' }), 'Used network access');
  assert.equal(activityEventLabel({ kind: 'usage' }), 'Updated token usage');
  assert.equal(activityEventLabel({ kind: 'message', summary: 'Done' }), 'Done');
  assert.equal(activityEventLabel(undefined), 'Agent activity');
});

test('classifies routine activity as noise and state-changing activity as event', () => {
  assert.equal(classifyActivityEvent({ kind: 'file', operation: 'read' }), 'noise');
  assert.equal(classifyActivityEvent({ kind: 'usage' }), 'noise');
  assert.equal(classifyActivityEvent({ kind: 'network' }), 'noise');
  // Writes, commands, tool use, permissions, and responses are notable.
  assert.equal(classifyActivityEvent({ kind: 'file', operation: 'write' }), 'event');
  assert.equal(classifyActivityEvent({ kind: 'command' }), 'event');
  assert.equal(classifyActivityEvent({ kind: 'tool' }), 'event');
  assert.equal(classifyActivityEvent({ kind: 'permission' }), 'event');
  assert.equal(classifyActivityEvent({ kind: 'message' }), 'event');
  assert.equal(classifyActivityEvent(undefined), 'event');
});

test('formats timestamps from epoch ms and ISO strings', () => {
  assert.equal(formatActivityTimestamp(0), '00:00:00');
  assert.equal(formatActivityTimestamp(3661000), '01:01:01');
  assert.equal(formatActivityTimestamp('2026-01-02T03:04:05.000Z').length, 8);
});

test('formats timestamps tolerate missing or invalid values', () => {
  assert.equal(formatActivityTimestamp(null), '');
  assert.equal(formatActivityTimestamp(undefined), '');
  assert.equal(formatActivityTimestamp(''), '');
  assert.equal(formatActivityTimestamp('not-a-date'), '');
});

test('activityEventSummary returns label, level, and formatted timestamp', () => {
  const out = activityEventSummary({ kind: 'file', operation: 'read', path: 'a.txt', timestamp: 3661000 });
  assert.equal(out.label, 'Read a.txt');
  assert.equal(out.level, 'noise');
  assert.equal(out.timestamp, '01:01:01');
  const notable = activityEventSummary({ kind: 'command', exitCode: 0, timestamp: 0 });
  assert.equal(notable.level, 'event');
  assert.equal(notable.timestamp, '00:00:00');
});

test('activityEventSummary omits timestamp when none is present', () => {
  const out = activityEventSummary({ kind: 'tool', toolName: 'Grep' });
  assert.equal(out.label, 'Used Grep');
  assert.equal(out.timestamp, '');
});

test('splitActivityEvents buckets routine vs notable', () => {
  const events = [
    { kind: 'file', operation: 'read' },
    { kind: 'usage' },
    { kind: 'command', exitCode: 0 },
    { kind: 'tool', toolName: 'X' },
  ];
  const { routine, notable } = splitActivityEvents(events);
  assert.equal(routine.length, 2);
  assert.equal(notable.length, 2);
  assert.ok(routine.every((e) => classifyActivityEvent(e) === 'noise'));
  assert.ok(notable.every((e) => classifyActivityEvent(e) === 'event'));
});

test('splitActivityEvents handles empty and non-array input', () => {
  assert.deepEqual(splitActivityEvents([]).routine.length, 0);
  assert.deepEqual(splitActivityEvents(null).notable.length, 0);
});

test('model api is frozen and stable', () => {
  const mod = require('../src/app/activityModel.js');
  assert.equal(Object.isFrozen(mod), true);
  for (const key of ['activityEventLabel', 'classifyActivityEvent', 'formatActivityTimestamp', 'activityEventSummary', 'splitActivityEvents']) {
    assert.equal(typeof mod[key], 'function', key);
  }
});
