'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { agentSettingsSections, agentSettingsGuidedSection, connectionSetupSteps }
  = require('../src/app/settingsModel.js');

test('agent settings sections lead with provider connections, profile below', () => {
  const sections = agentSettingsSections();
  const keys = sections.map((s) => s.key);
  assert.deepEqual(keys, [
    'provider-connections',
    'assigned-connection',
    'agent-profile',
    'agent-library',
  ]);
  // Connections come first; agent profile is below the connection sections.
  assert.ok(keys.indexOf('provider-connections') < keys.indexOf('agent-profile'));
  assert.equal(sections[0].title, 'Provider connections');
  assert.equal(sections[2].title, 'Active agent profile');
});

test('agent settings sections are frozen and keyed by string', () => {
  const sections = agentSettingsSections();
  assert.equal(Object.isFrozen(sections), true);
  for (const section of sections) {
    assert.equal(typeof section.key, 'string');
    assert.equal(typeof section.title, 'string');
  }
});

test('guided section identifies the connection setup flow', () => {
  const guided = agentSettingsGuidedSection();
  assert.equal(guided.key, 'connection-setup');
  assert.ok(guided.title.length > 0);
});

test('connection setup flow lists the four guided steps in order', () => {
  const { steps } = connectionSetupSteps({});
  assert.deepEqual(steps.map((s) => s.id), ['provider', 'workspace', 'model', 'confirm']);
  assert.deepEqual(steps.map((s) => s.label), [
    'Choose a provider',
    'Pick a project folder',
    'Select model and effort',
    'Confirm and save',
  ]);
});

test('empty draft marks only the confirm step incomplete and is on provider', () => {
  const { steps, activeStep } = connectionSetupSteps({});
  assert.equal(activeStep, 'provider');
  assert.equal(steps[0].complete, false);
  assert.equal(steps[3].complete, false);
});

test('provider chosen advances active step to workspace', () => {
  const { steps, activeStep } = connectionSetupSteps({ executorType: 'codex-cli' });
  assert.equal(activeStep, 'workspace');
  assert.equal(steps[0].complete, true);
  assert.equal(steps[1].complete, false);
});

test('workspace chosen advances active step to model', () => {
  const { steps, activeStep } = connectionSetupSteps({
    executorType: 'codex-cli', workspacePath: 'Z:\\workspace',
  });
  assert.equal(activeStep, 'model');
  assert.equal(steps[1].complete, true);
  assert.equal(steps[2].complete, false);
});

test('fully filled draft rests on the confirm step with all prior complete', () => {
  const { steps, activeStep } = connectionSetupSteps({
    executorType: 'codex-cli', workspacePath: 'Z:\\workspace', modelId: 'gpt-5.6-terra',
  });
  assert.equal(activeStep, 'confirm');
  assert.equal(steps[0].complete, true);
  assert.equal(steps[1].complete, true);
  assert.equal(steps[2].complete, true);
  assert.equal(steps[3].complete, false);
});

test('whitespace-only workspace is treated as incomplete', () => {
  const { activeStep } = connectionSetupSteps({
    executorType: 'codex-cli', workspacePath: '   ',
  });
  assert.equal(activeStep, 'workspace');
});

test('missing draft falls back to a safe meaningful flow', () => {
  const { steps, activeStep } = connectionSetupSteps(null);
  assert.equal(steps.length, 4);
  assert.equal(activeStep, 'provider');
});

test('model exposes a stable frozen api', () => {
  const mod = require('../src/app/settingsModel.js');
  assert.equal(Object.isFrozen(mod), true);
  assert.equal(typeof mod.agentSettingsSections, 'function');
  assert.equal(typeof mod.connectionSetupSteps, 'function');
});
