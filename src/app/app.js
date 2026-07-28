'use strict';

(function startClaudePetApp() {
  const bridge = window.claudePetApp;
  const sidebarRoot = document.querySelector('#sidebar-root');
  const firstRun = document.querySelector('#first-run');
  const firstRunForm = document.querySelector('#first-run-form');
  const firstAgentName = document.querySelector('#first-agent-name');
  const firstWorkspace = document.querySelector('#first-workspace');
  const firstGoal = document.querySelector('#first-goal');
  const status = document.querySelector('#app-status');
  const selectedSession = document.querySelector('#selected-session');
  const sessionTitle = document.querySelector('#session-title');
  const sessionSummary = document.querySelector('#session-summary');
  let snapshot = null;

  async function dispatch(type, data = {}) {
    try {
      status.textContent = 'Working…';
      const result = await bridge.intent(type, data);
      status.textContent = '';
      return result;
    } catch (error) {
      status.textContent = error?.message || 'That action could not be completed.';
      throw error;
    }
  }

  function render(value) {
    snapshot = value;
    window.claudePetSidebar.renderSidebar(sidebarRoot, value, dispatch);
    const empty = value.agents.length === 0 || value.sessions.length === 0;
    firstRun.hidden = !empty;
    if (selectedSession) selectedSession.hidden = empty;
    if (!empty && sessionTitle && sessionSummary) {
      sessionTitle.textContent = value.session?.title || 'Choose a session';
      sessionSummary.textContent = value.session
        ? `${value.activeAgent?.name || 'No agent'} · ${value.session.workspacePath}`
        : 'Choose a shared session to continue.';
    }
  }

  firstRunForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = firstAgentName.value.trim() || 'My Agent';
    const workspacePath = firstWorkspace.value.trim();
    const text = firstGoal.value.trim();
    if (!workspacePath || !text) return;
    const agent = await dispatch('create-agent', {
      name,
      marker: 'amber',
      instruction: '',
    });
    await dispatch('save-connection', {
      executorType: 'offline-demo',
      label: 'Offline Demo',
      workspacePath,
      permissionProfile: 'workspace',
      modelId: 'offline-demo',
      effort: null,
      keyHint: null,
    });
    await dispatch('create-session', {
      agentId: agent?.id || snapshot?.agents?.[0]?.id || 'new-agent',
      title: 'My first session',
      workspacePath,
    });
    await dispatch('submit-goal', { text });
  });

  bridge.subscribe(render);
  void bridge.snapshot().then(render).catch((error) => {
    status.textContent = error?.message || 'Claude Pet could not start.';
  });
}());
