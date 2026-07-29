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
  const conversationRoot = document.querySelector('#conversation-root');
  const activityRoot = document.querySelector('#activity-root');
  const settingsRoot = document.querySelector('#settings-root');
  const draftState = window.claudePetDraftState?.createDraftState?.() || null;
  let snapshot = null;
  let connectionFeedback = '';
  let connectionActionPending = false;
  let editingConnectionId = null;
  let settingsTab = 'agent';

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

  function connectionProvider(data = {}) {
    const executorType = data.executorType
      || snapshot?.connections?.find((item) => item.id === data.connectionId)?.executorType;
    return executorType === 'claude-code-cli' ? 'Claude Code' : 'Codex';
  }

  function connectionResultMessage(type, result, data) {
    const provider = connectionProvider(data);
    if (result?.failure?.message) return `${result.failure.message} ${result.failure.action || ''}`.trim();
    if (type === 'save-connection') return `${provider} connection saved. It has not replaced your active agent.`;
    if (type === 'begin-provider-setup') {
      return result?.started
        ? `Official ${provider} sign-in opened. Complete it there, then test this connection again.`
        : `${provider} sign-in did not start. Check the connection and try again.`;
    }
    if (type === 'test-connection') {
      if (result?.status?.installed === false) return `The ${provider} command is not installed.`;
      if (result?.status?.authenticated === false) return `${provider} is installed but not signed in yet.`;
      if (result?.permission?.available === false) return `${provider} is signed in, but this access mode is unavailable.`;
      if (result?.permission?.allowed === false) return `${provider} is signed in, but this access mode is blocked.`;
      return `${provider} is installed, signed in, and ready to use with this connection.`;
    }
    return 'Connection updated.';
  }

  function connectionErrorMessage(error) {
    const message = error?.message || 'That connection action could not be completed.';
    const publicMessage = message.match(/AgentError:\s*(.+)$/);
    return publicMessage ? publicMessage[1] : message;
  }

  async function connectionAction(type, data) {
    connectionActionPending = true;
    render(snapshot);
    try {
      const result = await dispatch(type, data);
      connectionFeedback = connectionResultMessage(type, result, data);
      if (type === 'save-connection' && result?.id) editingConnectionId = result.id;
      return result;
    } catch (error) {
      connectionFeedback = connectionErrorMessage(error);
      return null;
    } finally {
      connectionActionPending = false;
      render(snapshot);
    }
  }

  function render(value) {
    snapshot = value;
    window.claudePetSidebar.renderSidebar(sidebarRoot, value, dispatch, {
      onOpenSessionSettings() {
        settingsTab = 'session';
        void dispatch('set-view', { view: 'settings' });
      },
    });
    const empty = value.agents.length === 0 || value.sessions.length === 0;
    const noAgents = value.agents.length === 0;
    firstRun.hidden = !empty;
    firstRunForm.hidden = !noAgents;
    const firstRunTitle = document.querySelector('#first-run-title');
    const firstRunDescription = document.querySelector('#first-run-description');
    if (firstRunTitle && firstRunDescription) {
      firstRunTitle.textContent = noAgents ? 'Start with Offline Demo' : 'Create a new session';
      firstRunDescription.textContent = noAgents
        ? 'Pick a project folder, name your agent, and give it a first task. No account is needed.'
        : 'Your agents and provider connections are still here. Use New session in the sidebar to continue.';
    }
    if (conversationRoot && settingsRoot && activityRoot) {
      conversationRoot.hidden = empty || value.view === 'settings';
      settingsRoot.hidden = empty || value.view !== 'settings';
      activityRoot.hidden = empty || value.view !== 'activity';
      if (!empty && value.view === 'settings') {
        window.claudePetSettings.renderSettings(settingsRoot, value, dispatch, {
          connectionAction,
          connectionActionPending,
          connectionFeedback,
          editingConnectionId,
          draftState,
          settingsTab,
          onSelectTab(value) {
            settingsTab = value;
            render(snapshot);
          },
          onRefresh() {
            render(snapshot);
          },
          onEditConnection(connectionId) {
            editingConnectionId = connectionId;
            connectionFeedback = '';
            render(snapshot);
          },
        });
      } else if (!empty) {
        window.claudePetConversation.renderConversation(conversationRoot, value, dispatch, {
          draftState,
        });
        window.claudePetConversation.renderActivityDrawer(activityRoot, value, dispatch);
      }
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
    const connection = await dispatch('save-connection', {
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
      connectionId: connection?.id || '',
    });
    await dispatch('submit-goal', { text });
  });

  bridge.subscribe(render);
  void bridge.snapshot().then(render).catch((error) => {
    status.textContent = error?.message || 'Claude Pet could not start.';
  });
}());
