'use strict';

(function exposeSettings(root) {
  function element(document, tagName, text = '', className = '') {
    const value = document.createElement(tagName);
    value.textContent = text;
    value.className = className;
    return value;
  }

  function mutationButton(document, text, action, busy, className = '') {
    const value = element(document, 'button', text, className);
    value.type = 'button';
    value.dataset.mutation = 'true';
    value.disabled = busy;
    value.addEventListener('click', action);
    return value;
  }

  function actionButton(document, text, action, className = '') {
    const value = element(document, 'button', text, className);
    value.type = 'button';
    value.addEventListener('click', action);
    return value;
  }

  function group(document, title) {
    const section = element(document, 'section', '', 'settings-group');
    section.append(element(document, 'h2', title, 'section-title'));
    return section;
  }

  const CODEX_MODELS = Object.freeze(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  const CODEX_EFFORTS = Object.freeze(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

  function selectField(document, field, values, selected) {
    const value = element(document, 'select');
    value.dataset.field = field;
    for (const optionValue of values) {
      const option = element(document, 'option', optionValue);
      option.value = optionValue;
      option.selected = optionValue === selected;
      value.append(option);
    }
    value.value = selected;
    return value;
  }

  function renderSettings(target, snapshot, dispatch, options = {}) {
    const document = options.document || globalThis.document;
    const busy = snapshot.run?.busy === true;
    const codexActionBusy = busy || options.connectionActionPending === true;
    const connectionAction = options.connectionAction || dispatch;
    const shell = element(document, 'section', '', 'settings-shell');
    const header = element(document, 'header', '', 'settings-header');
    header.append(
      element(document, 'p', 'Claude Pet', 'eyebrow'),
      element(document, 'h1', 'Settings'),
      actionButton(document, 'Back to conversation', () => {
        void dispatch('set-view', { view: 'conversation' });
      }, 'secondary-action'),
    );
    shell.append(header);

    const connections = group(document, 'Connections');
    for (const connection of snapshot.connections || []) {
      const card = element(document, 'article', '', 'settings-card');
      card.append(
        element(document, 'strong', connection.label),
        element(document, 'span', `${connection.modelId} · ${connection.workspacePath}`, 'muted'),
        mutationButton(document, 'Use for active agent', () => {
          if (snapshot.session?.id && snapshot.activeAgent?.id) {
            void dispatch('set-participant-connection', {
              sessionId: snapshot.session.id,
              agentId: snapshot.activeAgent.id,
              connectionId: connection.id,
            });
          }
        }, busy, 'compact-action'),
      );
      if (connection.executorType === 'codex-cli') {
        const actions = element(document, 'div', '', 'connection-actions');
        const edit = mutationButton(document, 'Edit Codex', () => {
          options.onEditConnection?.(connection.id);
        }, codexActionBusy, 'compact-action');
        edit.dataset.action = 'edit-codex-connection';
        const test = mutationButton(document, 'Test connection', () => {
          void connectionAction('test-connection', { connectionId: connection.id });
        }, codexActionBusy, 'compact-action');
        test.dataset.action = 'test-codex-connection';
        const signIn = mutationButton(document, 'Sign in to Codex', () => {
          void connectionAction('begin-provider-setup', { connectionId: connection.id });
        }, codexActionBusy, 'compact-action');
        signIn.dataset.action = 'begin-codex-setup';
        actions.append(edit, test, signIn);
        card.append(actions);
      }
      connections.append(card);
    }
    shell.append(connections);

    const codex = group(document, 'Set up Codex');
    const editing = snapshot.connections?.find(
      (connection) => connection.id === options.editingConnectionId
        && connection.executorType === 'codex-cli',
    ) || null;
    codex.append(element(
      document,
      'p',
      editing ? 'Update this saved Codex connection.' : 'Create a Codex connection without sharing credentials with Claude Pet.',
      'muted',
    ));
    if (options.connectionFeedback) {
      codex.append(element(document, 'p', options.connectionFeedback, 'connection-feedback'));
    }
    const codexForm = element(document, 'form', '', 'codex-editor');
    const workspace = element(document, 'input');
    workspace.dataset.field = 'codex-workspace';
    workspace.value = editing?.workspacePath || snapshot.session?.workspacePath || '';
    workspace.placeholder = 'Project folder';
    workspace.disabled = codexActionBusy;
    const codexModel = selectField(document, 'codex-model', CODEX_MODELS, editing?.modelId || 'gpt-5.6-terra');
    codexModel.disabled = codexActionBusy;
    const codexEffort = selectField(document, 'codex-effort', CODEX_EFFORTS, editing?.effort || 'medium');
    codexEffort.disabled = codexActionBusy;
    const fullComputerWarning = element(document, 'div', '', 'access-warning');
    fullComputerWarning.append(
      element(document, 'strong', 'Full computer access'),
      element(document, 'p', 'Codex can access your whole computer. Saving requires a separate confirmation.'),
    );
    const workspaceUnavailable = element(document, 'div', '', 'workspace-unavailable muted');
    workspaceUnavailable.append(
      element(document, 'strong', 'Workspace only is not available yet'),
      element(document, 'p', 'It requires the separately approved WSL boundary and will not fall back to Full Computer.'),
    );
    const save = mutationButton(document, editing ? 'Save Codex changes' : 'Save Codex connection', async () => {
      const workspacePath = workspace.value.trim();
      if (!workspacePath) return;
      await connectionAction('save-connection', {
        ...(editing ? { id: editing.id } : {}),
        executorType: 'codex-cli',
        label: 'Codex',
        workspacePath,
        permissionProfile: 'full-computer',
        modelId: codexModel.value,
        effort: codexEffort.value,
        keyHint: null,
      });
    }, codexActionBusy, 'primary-action');
    save.dataset.action = 'save-codex-connection';
    codexForm.append(workspace, codexModel, codexEffort, fullComputerWarning, workspaceUnavailable, save);
    codex.append(codexForm);
    shell.append(codex);

    const access = group(document, 'Access');
    const activeParticipant = snapshot.session?.participants?.find(
      (item) => item.agentId === snapshot.activeAgent?.id,
    );
    const activeConnection = snapshot.connections?.find(
      (item) => item.id === activeParticipant?.connectionId,
    );
    if (activeConnection?.permissionProfile === 'full-computer'
        || snapshot.connections?.some((item) => item.permissionProfile === 'full-computer')) {
      const warning = element(document, 'div', '', 'access-warning');
      warning.append(
        element(document, 'strong', 'Full computer access'),
        element(document, 'p', 'This agent can access your whole computer.'),
      );
      access.append(warning);
    } else {
      access.append(element(document, 'p', 'Workspace only — selected project files.', 'muted'));
    }
    shell.append(access);

    const model = group(document, 'Model');
    model.append(element(
      document,
      'p',
      activeConnection
        ? `${activeConnection.label} · ${activeConnection.modelId}${activeConnection.effort ? ` · ${activeConnection.effort}` : ''}`
        : 'Choose a connection for the active agent.',
      'muted',
    ));
    shell.append(model);

    const agents = group(document, 'Session participants');
    for (const participant of snapshot.session?.participants || []) {
      const agent = snapshot.agents.find((item) => item.id === participant.agentId);
      if (!agent) continue;
      const row = element(document, 'div', '', 'participant-row');
      row.append(element(document, 'span', agent.name));
      if (participant.agentId !== snapshot.activeAgent?.id) {
        const remove = mutationButton(document, 'Remove', () => dispatch(
          'remove-participant',
          { sessionId: snapshot.session.id, agentId: participant.agentId },
        ), busy, 'compact-action danger-action');
        remove.dataset.removeParticipant = participant.agentId;
        row.append(remove);
      }
      agents.append(row);
    }
    shell.append(agents);

    const agentProfiles = group(document, 'Agents');
    const newAgentName = element(document, 'input');
    newAgentName.placeholder = 'New agent name';
    newAgentName.dataset.field = 'new-agent-name';
    newAgentName.disabled = busy;
    newAgentName.dataset.mutation = 'true';
    const createAgent = mutationButton(document, 'Create agent', async () => {
      const name = newAgentName.value.trim();
      if (!name) return;
      await dispatch('create-agent', { name, marker: 'blue', instruction: '' });
      newAgentName.value = '';
    }, busy, 'primary-action');
    createAgent.dataset.action = 'create-agent';
    agentProfiles.append(newAgentName, createAgent);

    const availableAgent = snapshot.agents.find(
      (agent) => !snapshot.session?.participants?.some(
        (participant) => participant.agentId === agent.id,
      ),
    );
    if (availableAgent && snapshot.session && activeConnection) {
      const add = mutationButton(document, `Add ${availableAgent.name} to this session`, () => dispatch(
        'add-participant',
        {
          sessionId: snapshot.session.id,
          agentId: availableAgent.id,
          connectionId: activeConnection.id,
        },
      ), busy, 'secondary-action');
      add.dataset.action = 'add-participant';
      agentProfiles.append(add);
    }
    shell.append(agentProfiles);

    target.replaceChildren(shell);
    return shell;
  }

  const api = Object.freeze({ renderSettings });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.claudePetSettings = api;
}(globalThis));
