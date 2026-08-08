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
  let editingConnectionId = null;
  let settingsTab = 'agent';

  // One independent, observable connection state per saved connection. This replaces the old
  // single global `connectionActionPending` boolean and global `connectionFeedback` string so
  // an in-flight test or a failure is keyed to the exact connection the user acted on, and
  // unrelated connections stay usable. The wrapper is loaded as a global script in the
  // renderer; the guarded fallback keeps the app working if it is somehow absent.
  const connectionStateApi = (typeof globalThis !== 'undefined' ? globalThis.claudePetConnectionState : null);
  const connectionState = connectionStateApi
    && typeof connectionStateApi.createRendererConnectionState === 'function'
    ? connectionStateApi.createRendererConnectionState()
    : null;

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

  function connectionErrorMessage(error) {
    const message = error?.message || 'That connection action could not be completed.';
    const publicMessage = message.match(/AgentError:\s*(.+)$/);
    return publicMessage ? publicMessage[1] : message;
  }

  // Move a connection's per-connection state machine forward from a test-connection result.
  // Only fixed, safe outcomes are stored; raw errors, causes, credentials, paths, and
  // provider output never enter the renderer state.
  function applyConnectionResult(type, result, data) {
    const connectionId = data.connectionId;
    if (result?.failure?.message) {
      // Preserve the original master behaviour of combining the safe message with its
      // suggested next action (e.g. "… Retry the compatibility check."), so the renderer
      // shows one complete, fixed-strings-only line. Raw cause/paths never enter here.
      const message = `${result.failure.message} ${result.failure.action || ''}`.trim();
      connectionState.fail(connectionId, result.failure.code || 'CONNECTION_FAILED', message);
      return;
    }
    if (type === 'test-connection') {
      const statusResult = result?.status || {};
      if (statusResult.installed === false) {
        connectionState.fail(
          connectionId,
          'CLI_NOT_INSTALLED',
          `The ${connectionProvider(data)} command is not installed.`,
        );
        return;
      }
      if (statusResult.compatible === false) {
        connectionState.fail(
          connectionId,
          'CLI_VERSION_UNSUPPORTED',
          'This Codex update is not compatible with Claude Pet yet. Update Claude Pet or install a compatible Codex version.',
        );
        return;
      }
      if (statusResult.authenticated === false) {
        connectionState.markSignInRequired(connectionId, { oneTime: result?.oneTime === true });
        return;
      }
      connectionState.markInstalled(connectionId);
    }
  }

  async function connectionAction(type, data) {
    const connectionId = data?.connectionId || (type === 'save-connection' && data?.id) || null;
    if (connectionState && connectionId && type === 'test-connection') {
      connectionState.verifying(connectionId);
      render(snapshot);
    }
    try {
      const result = await dispatch(type, data);
      if (connectionState) {
        if (type === 'save-connection' && result?.id) {
          editingConnectionId = result.id;
          // Saving changes the connection; clear any prior tested state.
          connectionState.reset(result.id);
        } else if (connectionId) {
          applyConnectionResult(type, result, data);
        }
      } else if (type === 'save-connection' && result?.id) {
        editingConnectionId = result.id;
      }
      return result;
    } catch (error) {
      if (connectionState && connectionId) {
        connectionState.fail(connectionId, 'CONNECTION_ACTION_FAILED', connectionErrorMessage(error));
      }
      return null;
    } finally {
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
          connectionCancel: (connectionId) => {
            if (connectionState) connectionState.cancel(connectionId);
            // Also tell the main process to abort the in-flight verification, not just the
            // local UI state, so the underlying provider process is actually stopped.
            try {
              void bridge.intent('cancel-test-connection', { connectionId });
            } catch (error) { /* best-effort; local state is already reset */ }
            render(snapshot);
          },
          getConnectionState: (connectionId) => (connectionState ? connectionState.view(connectionId) : null),
          connectionStates: connectionStateApi?.STATES || null,
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
