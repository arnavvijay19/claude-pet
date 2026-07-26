'use strict';

const status = document.querySelector('#status');
const list = document.querySelector('#connections');
const workspace = document.querySelector('#workspace');
const executor = document.querySelector('#executor');
const permission = document.querySelector('#permission-profile');
const model = document.querySelector('#model');
const effort = document.querySelector('#effort');
const save = document.querySelector('#save');
const activePermission = document.querySelector('#active-permission');
let editingId = null;

const registries = {
  'codex-cli': {
    models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultModel: 'gpt-5.6-terra', defaultEffort: 'medium', setup: 'Codex',
  },
  'claude-code-cli': {
    models: ['fable', 'opus', 'sonnet'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultModel: 'sonnet', defaultEffort: 'high', setup: 'Claude Code',
  },
};

function text(node, value) { node.textContent = value; }
function options(node, values, selected) {
  node.replaceChildren(...values.map((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    option.selected = value === selected;
    return option;
  }));
}

function renderExecutor({ selectedPermission = null, selectedModel = null, selectedEffort = null } = {}) {
  const registry = registries[executor.value];
  document.querySelector('#model-row').hidden = !registry;
  document.querySelector('#effort-row').hidden = !registry;
  document.querySelector('#permission-row').hidden = !registry;
  document.querySelector('#setup').hidden = !registry;
  if (!registry) {
    permission.replaceChildren();
    text(document.querySelector('#mode-help'), 'Offline Demo is limited to the selected workspace.');
    return;
  }
  options(model, registry.models, selectedModel || registry.defaultModel);
  options(effort, registry.efforts, selectedEffort || registry.defaultEffort);
  const full = document.createElement('option');
  full.value = 'full-computer';
  full.textContent = 'Default - broad access';
  const workspaceOption = document.createElement('option');
  workspaceOption.value = 'workspace';
  workspaceOption.textContent = 'Workspace - unavailable until WSL setup';
  permission.replaceChildren(full, workspaceOption);
  permission.value = selectedPermission || 'full-computer';
  document.querySelector('#setup').textContent = `Sign in to ${registry.setup}`;
  text(document.querySelector('#mode-help'), permission.value === 'full-computer'
    ? 'FULL COMPUTER - broad PC access. Saving may open a native warning.'
    : 'WORKSPACE - selected project only. This mode is unavailable until setup is complete.');
}

function draft() {
  return window.settingsPresentation.draftForSelection({
    id: editingId || undefined,
    executorType: executor.value,
    workspacePath: workspace.value,
    permissionProfile: permission.value || undefined,
    modelId: model.value,
    effort: effort.value,
  });
}

function loadConnection(connection) {
  editingId = connection.id;
  executor.value = connection.executorType;
  workspace.value = connection.workspacePath;
  renderExecutor({
    selectedPermission: connection.permissionProfile,
    selectedModel: connection.modelId,
    selectedEffort: connection.effort,
  });
}

async function refresh(provided) {
  const snapshot = provided || await window.settings.snapshot();
  text(activePermission, snapshot.active?.permissionBadge || 'No connection selected');
  activePermission.classList.toggle('warning-badge', snapshot.active?.permissionWarning === true);
  list.replaceChildren(...snapshot.connections.map((connection) => {
    const item = document.createElement('li');
    const summary = document.createElement('span');
    text(summary, window.settingsPresentation.connectionSummary(connection));
    if (connection.permissionWarning) summary.classList.add('warning-text');
    const use = document.createElement('button');
    text(use, connection.id === snapshot.active?.id ? 'Edit active' : 'Use / edit');
    use.addEventListener('click', async () => {
      await window.settings.select(connection.id);
      loadConnection(connection);
      await refresh();
    });
    const remove = document.createElement('button');
    text(remove, 'Delete');
    remove.addEventListener('click', async () => {
      await window.settings.remove(connection.id);
      if (editingId === connection.id) editingId = null;
      await refresh();
    });
    item.append(summary, use, remove);
    return item;
  }));
  return snapshot;
}

executor.addEventListener('change', () => {
  editingId = null;
  renderExecutor();
});
permission.addEventListener('change', () => renderExecutor({
  selectedPermission: permission.value,
  selectedModel: model.value,
  selectedEffort: effort.value,
}));
renderExecutor();

save.addEventListener('click', async () => {
  save.disabled = true;
  text(status, 'Saving connection...');
  try {
    const snapshot = await window.settings.save(draft());
    editingId = snapshot.active?.id || editingId;
    text(status, snapshot.active?.permissionProfile === 'full-computer'
      ? 'Saved Full Computer connection. Broad PC access remains enabled.'
      : 'Saved Workspace connection. Workspace remains unavailable until setup.');
    await refresh(snapshot);
  } catch {
    text(status, 'Save cancelled or rejected. No permission was added.');
    await refresh();
  } finally {
    save.disabled = false;
  }
});

document.querySelector('#test').addEventListener('click', async () => {
  try { text(status, window.settingsStatus.formatTestStatus(await window.settings.test())); }
  catch { text(status, 'Select a saved connection first.'); }
});
document.querySelector('#setup').addEventListener('click', async () => {
  const registry = registries[executor.value];
  try {
    await window.settings.setup();
    text(status, `${registry.setup} sign-in started in its own window.`);
  } catch {
    text(status, `${registry.setup} sign-in could not start.`);
  }
});

void refresh();
