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

  // Cancel an in-flight verification the same way the Settings panel does: reset the local
  // per-connection state and tell the main process to abort the underlying provider process.
  // Extracted to IIFE scope so both the Settings panel and the live status ribbon can call it.
  function connectionCancel(connectionId) {
    if (connectionState) connectionState.cancel(connectionId);
    try {
      void bridge.intent('cancel-test-connection', { connectionId });
    } catch (error) { /* best-effort; local state is already reset */ }
    render(snapshot);
  }

  // Phase 3: wire the live status ribbon (vanilla-DOM controller from ribbonController.js,
  // driven by the shared ribbon model). The controller is exposed on globalThis by the
  // renderer script that loads before app.js. If it is absent the ribbon simply stays empty
  // and the rest of the app works unchanged.
  const ribbonHost = document.querySelector('#app-ribbon');
  const ribbonController = (ribbonHost && globalThis.claudePetRibbon
    && typeof globalThis.claudePetRibbon.createRibbonHost === 'function')
    ? globalThis.claudePetRibbon.createRibbonHost(ribbonHost, {
      getConnectionState: (connectionId) => (connectionState ? connectionState.view(connectionId) : null),
      actions: {
        check: (connectionId) => { if (connectionId) void connectionAction('test-connection', { connectionId }); },
        cancel: (connectionId) => { if (connectionId) connectionCancel(connectionId); },
        signIn: (connectionId) => { if (connectionId) void connectionAction('begin-provider-setup', { connectionId }); },
        stop: () => void dispatch('stop-run', {}),
      },
    })
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

  // Phase 3 Task 7: command palette (design 3.7). Ctrl+K opens a keyboard-first palette
  // of actions (switch agent/session/connection, re-run with edits, open folder, copy diff,
  // export session). The pure command derivation lives in commandPaletteModel.js; the live
  // vanilla-DOM controller (commandPaletteController.js) renders it. The executor below
  // interprets each command's `action` — dispatch intents go through `dispatch`, while the
  // composer-seed / clipboard / download / folder actions are handled locally.
  const commandPaletteModel = (typeof globalThis !== 'undefined' ? globalThis.claudePetCommandPaletteModel : null);
  const commandPalette = (commandPaletteModel
    && globalThis.claudePetCommandPalette
    && typeof globalThis.claudePetCommandPalette.createCommandPalette === 'function')
    ? globalThis.claudePetCommandPalette.createCommandPalette({ onExecute: executeCommand })
    : null;

  // Downloads the current session as a local Markdown run log (design 3.8). No cloud, no
  // network, no telemetry — the markdown is produced by the shared model; this only saves it.
  function downloadSessionMarkdown() {
    if (!snapshot || typeof commandPaletteModel?.exportSessionMarkdown !== 'function') return;
    const markdown = commandPaletteModel.exportSessionMarkdown(snapshot);
    if (!markdown) return;
    const title = (snapshot.session?.title || snapshot.selection?.sessionId || 'session')
      .replace(/[^\w.-]+/g, '_');
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${title}.md`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function executeCommand(command) {
    if (!command || typeof command !== 'object') return;
    const action = command.action || {};
    switch (action.kind) {
      case 'intent':
        if (action.intent?.type) void dispatch(action.intent.type, action.intent.data || {});
        break;
      case 'reopen-goal':
        if (draftState && snapshot?.session?.id && typeof action.text === 'string') {
          draftState.setComposer(snapshot.session.id, action.text);
          void dispatch('set-view', { view: 'conversation' });
        }
        break;
      case 'open-folder':
        if (action.path && typeof action.path === 'string') {
          try { void window.claudePetApp?.openPath?.(action.path); } catch { /* best-effort */ }
        }
        break;
      case 'copy-diff':
        if (typeof action.text === 'string') {
          try { void navigator.clipboard?.writeText?.(action.text); } catch { /* best-effort */ }
        }
        break;
      case 'export-session':
        downloadSessionMarkdown();
        break;
      default:
        break;
    }
  }

  // Ctrl+K opens / toggles the command palette. Guarded so environments without a DOM
  // listener surface (e.g. the renderer VM test harness) are unaffected.
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
        if (commandPalette) {
          event.preventDefault();
          commandPalette.toggle(snapshot);
        }
      }
    });
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
          connectionCancel,
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
    // Phase 3: keep the live status ribbon in sync with every snapshot.
    if (ribbonController) ribbonController.update(value);
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
