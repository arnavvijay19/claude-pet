'use strict';

// Phase 3 Task 9 (design 3.9): Settings becomes secondary and task-oriented.
//
// Pure, framework-free logic for two things the redesign asks for:
//   1. The agent-settings panel order — provider connections FIRST (connection
//      setup is the blocking task) and the agent-profile fields BELOW.
//   2. The short GUIDED connection-setup flow — "not a form plus unrelated
//      controls" but a named sequence of steps with the current step highlighted.
//
// No DOM, no Electron, no Preact: fully unit-testable in Node. Dual-mode: loaded
// as a classic <script> (exposes globalThis.claudePetSettingsModel) and require()-able.

// Ordered sections of the agent-settings panel. Connections lead; the agent
// profile follows. (design 3.9)
function agentSettingsSections() {
  return Object.freeze([
    Object.freeze({ key: 'provider-connections', title: 'Provider connections' }),
    Object.freeze({ key: 'assigned-connection', title: 'Assigned connection' }),
    Object.freeze({ key: 'agent-profile', title: 'Active agent profile' }),
    Object.freeze({ key: 'agent-library', title: 'Agent library' }),
  ]);
}

// The connection editor is rendered separately, after the sections above, so it
// reads as a guided setup flow rather than a form mixed with the profile controls.
function agentSettingsGuidedSection() {
  return Object.freeze({ key: 'connection-setup', title: 'Add or edit a connection' });
}

// The short guided connection-setup steps (design 3.9): provider -> workspace ->
// model & effort -> confirm. `draft` is the in-progress connection form values.
// Returns the ordered steps (each with a completion flag) and the active step id
// (the first not-yet-complete step, or `confirm` once everything else is filled).
function connectionSetupSteps(draft) {
  const d = draft && typeof draft === 'object' ? draft : {};
  const hasProvider = typeof d.executorType === 'string' && d.executorType.length > 0;
  const hasWorkspace = typeof d.workspacePath === 'string' && d.workspacePath.trim().length > 0;
  const hasModel = typeof d.modelId === 'string' && d.modelId.length > 0;
  const steps = [
    Object.freeze({ id: 'provider', label: 'Choose a provider', complete: hasProvider }),
    Object.freeze({ id: 'workspace', label: 'Pick a project folder', complete: hasWorkspace }),
    Object.freeze({ id: 'model', label: 'Select model and effort', complete: hasModel }),
    Object.freeze({ id: 'confirm', label: 'Confirm and save', complete: false }),
  ];
  let activeStep = 'confirm';
  for (const step of steps) {
    if (!step.complete) { activeStep = step.id; break; }
  }
  return Object.freeze({ steps: Object.freeze(steps), activeStep });
}

const settingsModel = Object.freeze({
  agentSettingsSections,
  agentSettingsGuidedSection,
  connectionSetupSteps,
});

if (typeof module !== 'undefined' && module.exports) module.exports = settingsModel;
if (typeof globalThis !== 'undefined') globalThis.claudePetSettingsModel = settingsModel;
