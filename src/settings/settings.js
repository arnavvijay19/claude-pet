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
const sessionAgent = document.querySelector('#session-agent');
const sessionSession = document.querySelector('#session-session');
const nextProvider = document.querySelector('#next-provider');
const sessionButtons = ['#create-agent', '#rename-agent', '#delete-agent', '#create-session', '#rename-session', '#delete-session'].map((id) => document.querySelector(id));
const connectionMutationControls = [workspace, executor, permission, model, effort, save];
let sessionBusy = false;
let saving = false;

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

function setMutationDisabled(disabled) {
  sessionBusy = disabled === true;
  sessionAgent.disabled = sessionBusy;
  sessionSession.disabled = sessionBusy;
  nextProvider.disabled = sessionBusy;
  sessionButtons.forEach((button) => { button.disabled = sessionBusy; });
  connectionMutationControls.forEach((control) => { control.disabled = sessionBusy || (control === save && saving); });
  document.querySelectorAll('[data-settings-mutation]').forEach((control) => { control.disabled = sessionBusy; });
}

function sessionOptions(node, values, selected, label) {
  node.replaceChildren(...values.map((value) => { const option = document.createElement('option'); option.value = value.id; option.textContent = value[label]; option.selected = value.id === selected; return option; }));
}
function renderSessionSnapshot(snapshot) {
  sessionOptions(sessionAgent, snapshot.agents, snapshot.selection.agentId, 'name');
  sessionOptions(sessionSession, snapshot.sessions, snapshot.selection.sessionId, 'title');
  sessionOptions(nextProvider, snapshot.connections, snapshot.session?.nextConnectionId, 'label');
  setMutationDisabled(snapshot.busy === true);
  return snapshot;
}
async function refreshSessions() {
  return renderSessionSnapshot(await window.settings.sessionSnapshot());
}

async function refresh(provided) {
  const snapshot = provided || await window.settings.snapshot();
  setMutationDisabled(snapshot.mutationsDisabled === true || sessionBusy);
  text(activePermission, snapshot.active?.permissionBadge || 'No connection selected');
  activePermission.classList.toggle('warning-badge', snapshot.active?.permissionWarning === true);
  list.replaceChildren(...snapshot.connections.map((connection) => {
    const item = document.createElement('li');
    const summary = document.createElement('span');
    text(summary, window.settingsPresentation.connectionSummary(connection));
    if (connection.permissionWarning) summary.classList.add('warning-text');
    const use = document.createElement('button');
    use.dataset.settingsMutation = 'connection-select';
    use.disabled = sessionBusy;
    text(use, connection.id === snapshot.active?.id ? 'Edit active' : 'Use / edit');
    use.addEventListener('click', async () => {
      await window.settings.select(connection.id);
      loadConnection(connection);
      await refresh();
    });
    const remove = document.createElement('button');
    remove.dataset.settingsMutation = 'connection-remove';
    remove.disabled = sessionBusy;
    text(remove, 'Delete');
    remove.addEventListener('click', async () => {
      await window.settings.remove(connection.id);
      if (editingId === connection.id) editingId = null;
      await refresh();
    });
    item.append(summary, use, remove);
    return item;
  }));
  await refreshSessions(); return snapshot;
}

sessionAgent.addEventListener('change', async () => { await window.settings.selectSession({ agentId: sessionAgent.value, sessionId: null }); await refresh(); });
sessionSession.addEventListener('change', async () => { await window.settings.selectSession({ agentId: sessionAgent.value, sessionId: sessionSession.value }); await refresh(); });
nextProvider.addEventListener('change', async () => {
  try {
    text(status, 'Changing next run provider...');
    await window.settings.setNextConnection({ sessionId: sessionSession.value, connectionId: nextProvider.value });
    text(status, 'Next run provider updated.');
  } catch (error) {
    text(status, error?.message || 'Provider switch cancelled. No provider was changed.');
  } finally {
    await refresh();
  }
});
document.querySelector('#create-agent').addEventListener('click', async () => { const name = window.prompt('Agent name', 'My Agent'); if (name) { await window.settings.createAgent({ name }); await refresh(); } });
document.querySelector('#rename-agent').addEventListener('click', async () => { const name = window.prompt('Agent name', sessionAgent.selectedOptions[0]?.textContent || ''); if (name) { await window.settings.renameAgent(sessionAgent.value, name); await refresh(); } });
document.querySelector('#delete-agent').addEventListener('click', async () => { await window.settings.deleteAgent(sessionAgent.value); await refresh(); });
document.querySelector('#create-session').addEventListener('click', async () => { const title = window.prompt('Session title', 'New session'); if (title && workspace.value.trim()) { await window.settings.createSession({ agentId: sessionAgent.value, title, workspacePath: workspace.value }); await refresh(); } });
document.querySelector('#rename-session').addEventListener('click', async () => { const title = window.prompt('Session title', sessionSession.selectedOptions[0]?.textContent || ''); if (title) { await window.settings.renameSession(sessionSession.value, title); await refresh(); } });
document.querySelector('#delete-session').addEventListener('click', async () => { await window.settings.deleteSession(sessionSession.value); await refresh(); });

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
window.settings.onSessionState((value) => renderSessionSnapshot(value));

save.addEventListener('click', async () => {
  saving = true;
  setMutationDisabled(sessionBusy);
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
    saving = false;
    setMutationDisabled(sessionBusy);
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
