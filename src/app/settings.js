'use strict';

(function exposeSettings(root) {
  const PROVIDERS = Object.freeze({
    'codex-cli': Object.freeze({
      label: 'Codex',
      models: Object.freeze(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']),
      efforts: Object.freeze(['none', 'low', 'medium', 'high', 'xhigh', 'max']),
      defaultModel: 'gpt-5.6-terra',
      defaultEffort: 'medium',
    }),
    'claude-code-cli': Object.freeze({
      label: 'Claude Code',
      models: Object.freeze(['fable', 'opus', 'sonnet']),
      efforts: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']),
      defaultModel: 'sonnet',
      defaultEffort: 'high',
    }),
  });

  function element(document, tagName, text = '', className = '') {
    const value = document.createElement(tagName);
    value.textContent = text;
    value.className = className;
    return value;
  }

  function actionButton(document, text, action, className = '', busy = false) {
    const value = element(document, 'button', text, className);
    value.type = 'button';
    value.disabled = busy;
    if (busy) value.dataset.mutation = 'true';
    value.addEventListener('click', action);
    return value;
  }

  function mutationButton(document, text, action, busy, className = '') {
    const value = actionButton(document, text, action, className, busy);
    value.dataset.mutation = 'true';
    return value;
  }

  function group(document, title, description = '') {
    const section = element(document, 'section', '', 'settings-group');
    section.append(element(document, 'h2', title, 'section-title'));
    if (description) section.append(element(document, 'p', description, 'muted'));
    return section;
  }

  function label(document, text, control) {
    const value = element(document, 'label', '', 'field-label');
    value.append(element(document, 'span', text), control);
    return value;
  }

  function input(document, field, value = '') {
    const control = element(document, 'input');
    control.dataset.field = field;
    control.value = value;
    return control;
  }

  function textarea(document, field, value = '') {
    const control = element(document, 'textarea');
    control.dataset.field = field;
    control.value = value;
    control.rows = 5;
    return control;
  }

  function selectField(document, field, values, selected) {
    const control = element(document, 'select');
    control.dataset.field = field;
    for (const optionValue of values) {
      const option = element(document, 'option', optionValue);
      option.value = optionValue;
      option.selected = optionValue === selected;
      control.append(option);
    }
    control.value = selected;
    return control;
  }

  function settingsDraft(options, key, defaults) {
    return { ...defaults, ...(options.draftState?.settings(key) || {}) };
  }

  function bindDraft(options, key, control, property = control.dataset.field) {
    const update = () => options.draftState?.patchSettings(key, {
      [property]: control.value,
    });
    control.addEventListener('input', update);
    control.addEventListener('change', update);
  }

  function activeConnection(snapshot) {
    const participant = snapshot.session?.participants?.find(
      (item) => item.agentId === snapshot.activeAgent?.id,
    );
    return snapshot.connections?.find((item) => item.id === participant?.connectionId) || null;
  }

  function renderAgentProfile(document, panel, snapshot, dispatch, options, busy) {
    const profile = snapshot.activeAgentProfile || {
      id: snapshot.activeAgent?.id,
      name: snapshot.activeAgent?.name || '',
      marker: snapshot.activeAgent?.marker || 'amber',
      instruction: '',
    };
    const section = group(
      document,
      'Active agent profile',
      'These instructions are used only when this agent handles a turn.',
    );
    if (!profile.id) {
      section.append(element(document, 'p', 'Choose an agent to edit its profile.', 'muted'));
      panel.append(section);
      return;
    }
    const key = `agent:${profile.id}`;
    const draft = settingsDraft(options, key, profile);
    const form = element(document, 'form', '', 'settings-form agent-profile-form');
    const name = input(document, 'agent-name', draft.name);
    const marker = input(document, 'agent-marker', draft.marker);
    const instruction = textarea(document, 'agent-instruction', draft.instruction);
    for (const [control, property] of [
      [name, 'name'], [marker, 'marker'], [instruction, 'instruction'],
    ]) {
      control.disabled = busy;
      control.dataset.mutation = 'true';
      bindDraft(options, key, control, property);
    }
    const count = element(
      document,
      'p',
      `${new TextEncoder().encode(instruction.value).byteLength} / 2,000 bytes`,
      'field-help',
    );
    instruction.addEventListener('input', () => {
      count.textContent = `${new TextEncoder().encode(instruction.value).byteLength} / 2,000 bytes`;
    });
    const save = mutationButton(document, 'Save agent', async () => {
      if (!name.value.trim()
          || new TextEncoder().encode(instruction.value).byteLength > 2000) return;
      await dispatch('update-agent', {
        agentId: profile.id,
        name: name.value.trim(),
        marker: marker.value.trim() || 'amber',
        instruction: instruction.value,
      });
      options.draftState?.clearSettings(key);
    }, busy, 'primary-action');
    save.dataset.action = 'save-agent-profile';
    form.append(
      label(document, 'Agent name', name),
      label(document, 'Marker', marker),
      label(document, 'Agent instructions', instruction),
      count,
      save,
    );
    section.append(form);
    panel.append(section);
  }

  function renderAssignedConnection(document, panel, snapshot, dispatch, busy) {
    const section = group(
      document,
      'Assigned connection',
      'Choose which saved provider connection this agent uses in the selected session.',
    );
    const current = activeConnection(snapshot);
    section.append(element(
      document,
      'p',
      current
        ? `${current.label} · ${current.modelId} · ${current.workspacePath}`
        : 'No connection is assigned.',
      'muted',
    ));
    const actions = element(document, 'div', '', 'connection-actions');
    for (const connection of snapshot.connections || []) {
      if (connection.id === current?.id) continue;
      actions.append(mutationButton(document, `Use ${connection.label}`, () => {
        void dispatch('set-participant-connection', {
          sessionId: snapshot.session.id,
          agentId: snapshot.activeAgent.id,
          connectionId: connection.id,
        });
      }, busy, 'compact-action'));
    }
    section.append(actions);
    panel.append(section);
  }

  function renderConnectionCards(document, panel, snapshot, options, busy) {
    const action = options.connectionAction || (() => {});
    const section = group(document, 'Provider connections');
    for (const connection of snapshot.connections || []) {
      const card = element(document, 'article', '', 'settings-card connection-card');
      const copy = element(document, 'div');
      copy.append(
        element(document, 'strong', connection.label),
        element(
          document,
          'p',
          `${connection.modelId}${connection.effort ? ` · ${connection.effort}` : ''} · ${connection.workspacePath}`,
          'muted',
        ),
      );
      card.append(copy);
      if (PROVIDERS[connection.executorType]) {
        const controls = element(document, 'div', '', 'connection-actions');
        const provider = PROVIDERS[connection.executorType];
        const edit = mutationButton(document, `Edit ${provider.label}`, () => {
          options.onEditConnection?.(connection.id);
        }, busy, 'compact-action');
        edit.dataset.action = `edit-${connection.executorType}`;
        const test = mutationButton(document, 'Test', () => {
          void action('test-connection', { connectionId: connection.id });
        }, busy, 'compact-action');
        test.dataset.action = `test-${connection.executorType}`;
        const signIn = mutationButton(document, `Sign in to ${provider.label}`, () => {
          void action('begin-provider-setup', { connectionId: connection.id });
        }, busy, 'compact-action');
        signIn.dataset.action = `setup-${connection.executorType}`;
        controls.append(edit, test, signIn);
        card.append(controls);
      }
      section.append(card);
    }
    panel.append(section);
  }

  function renderConnectionEditor(document, panel, snapshot, options, busy) {
    const editing = snapshot.connections?.find(
      (connection) => connection.id === options.editingConnectionId
        && PROVIDERS[connection.executorType],
    ) || null;
    const key = `connection:${editing?.id || 'new'}`;
    const defaults = {
      executorType: editing?.executorType || 'codex-cli',
      workspacePath: editing?.workspacePath || snapshot.session?.workspacePath || '',
      modelId: editing?.modelId || 'gpt-5.6-terra',
      effort: editing?.effort || 'medium',
    };
    const draft = settingsDraft(options, key, defaults);
    const provider = PROVIDERS[draft.executorType] || PROVIDERS['codex-cli'];
    if (!provider.models.includes(draft.modelId)) draft.modelId = provider.defaultModel;
    if (!provider.efforts.includes(draft.effort)) draft.effort = provider.defaultEffort;
    const section = group(
      document,
      editing ? `Edit ${provider.label} connection` : 'Add provider connection',
      'Credentials remain in the official provider CLI. Claude Pet stores connection settings only.',
    );
    if (options.connectionFeedback) {
      section.append(element(document, 'p', options.connectionFeedback, 'connection-feedback'));
    }
    const form = element(document, 'form', '', 'settings-form provider-editor');
    const providerSelect = selectField(
      document,
      'connection-provider',
      Object.keys(PROVIDERS),
      draft.executorType,
    );
    for (const option of providerSelect.children) option.textContent = PROVIDERS[option.value].label;
    const workspace = input(document, 'connection-workspace', draft.workspacePath);
    const browse = mutationButton(document, 'Browse', async () => {
      const chosen = await options.dispatch?.('choose-directory', {});
      if (!chosen) return;
      workspace.value = chosen;
      options.draftState?.patchSettings(key, { workspacePath: chosen });
    }, busy, 'compact-action');
    browse.dataset.action = 'browse-connection-workspace';
    const workspaceRow = element(document, 'div', '', 'field-with-action');
    workspaceRow.append(workspace, browse);
    const model = selectField(document, 'connection-model', provider.models, draft.modelId);
    const effort = selectField(document, 'connection-effort', provider.efforts, draft.effort);
    for (const control of [providerSelect, workspace, model, effort]) {
      control.disabled = busy;
      control.dataset.mutation = 'true';
    }
    bindDraft(options, key, workspace, 'workspacePath');
    bindDraft(options, key, model, 'modelId');
    bindDraft(options, key, effort, 'effort');
    providerSelect.addEventListener('change', () => {
      const next = PROVIDERS[providerSelect.value];
      options.draftState?.patchSettings(key, {
        executorType: providerSelect.value,
        modelId: next.defaultModel,
        effort: next.defaultEffort,
      });
      options.onRefresh?.();
    });
    const warning = element(document, 'div', '', 'access-warning');
    warning.append(
      element(document, 'strong', 'Full computer access'),
      element(document, 'p', `${provider.label} can access your whole computer. Saving requires a separate confirmation.`),
    );
    const unavailable = element(document, 'div', '', 'workspace-unavailable muted');
    unavailable.append(
      element(document, 'strong', 'Workspace only is not available yet'),
      element(document, 'p', 'It requires the separately approved WSL boundary and never falls back to Full Computer.'),
    );
    const save = mutationButton(document, editing ? 'Save connection changes' : 'Save connection', async () => {
      if (!workspace.value.trim()) return;
      const result = await (options.connectionAction || options.dispatch)('save-connection', {
        ...(editing ? { id: editing.id } : {}),
        executorType: draft.executorType,
        label: provider.label,
        workspacePath: workspace.value.trim(),
        permissionProfile: 'full-computer',
        modelId: model.value,
        effort: effort.value,
        keyHint: null,
      });
      if (result) options.draftState?.clearSettings(key);
    }, busy, 'primary-action');
    save.dataset.action = 'save-provider-connection';
    form.append(
      label(document, 'Provider', providerSelect),
      label(document, 'Project folder', workspaceRow),
      label(document, 'Model', model),
      label(document, 'Effort', effort),
      warning,
      unavailable,
      save,
    );
    section.append(form);
    panel.append(section);
  }

  function renderAgentLibrary(document, panel, snapshot, dispatch, busy) {
    const section = group(document, 'Agent library');
    const name = input(document, 'new-agent-name', '');
    name.placeholder = 'New agent name';
    name.disabled = busy;
    name.dataset.mutation = 'true';
    const create = mutationButton(document, 'Create agent', async () => {
      if (!name.value.trim()) return;
      await dispatch('create-agent', {
        name: name.value.trim(), marker: 'blue', instruction: '',
      });
      name.value = '';
    }, busy, 'primary-action');
    create.dataset.action = 'create-agent';
    section.append(label(document, 'New agent name', name), create);
    panel.append(section);
  }

  function renderAgentSettings(document, panel, snapshot, dispatch, options, busy) {
    renderAgentProfile(document, panel, snapshot, dispatch, options, busy);
    renderAssignedConnection(document, panel, snapshot, dispatch, busy);
    renderConnectionCards(document, panel, snapshot, options, busy);
    renderConnectionEditor(document, panel, snapshot, options, busy);
    renderAgentLibrary(document, panel, snapshot, dispatch, busy);
  }

  function renderSessionSettings(document, panel, snapshot, dispatch, busy) {
    const session = snapshot.session;
    const details = group(document, 'Session details');
    if (!session) {
      details.append(element(document, 'p', 'No session is selected.', 'muted'));
      panel.append(details);
      return;
    }
    const title = input(document, 'session-title', session.title);
    title.disabled = busy;
    title.dataset.mutation = 'true';
    const save = mutationButton(document, 'Save session name', () => dispatch(
      'rename-session',
      { sessionId: session.id, title: title.value.trim() },
    ), busy, 'primary-action');
    save.dataset.action = 'rename-session';
    details.append(
      label(document, 'Session name', title),
      element(document, 'p', `Project folder: ${session.workspacePath}`, 'muted'),
      element(document, 'p', `Last updated: ${session.updatedAt}`, 'muted'),
      save,
    );
    panel.append(details);

    const participants = group(
      document,
      'Participants',
      'Removing a participant preserves their attributed history in this session.',
    );
    const assigned = activeConnection(snapshot);
    for (const participant of session.participants || []) {
      const agent = snapshot.agents.find((item) => item.id === participant.agentId);
      const connection = snapshot.connections.find((item) => item.id === participant.connectionId);
      if (!agent) continue;
      const row = element(document, 'div', '', 'participant-row');
      row.append(
        element(
          document,
          'span',
          `${agent.name}${participant.agentId === session.activeAgentId ? ' · Active' : ''}`,
        ),
        element(document, 'span', connection?.label || 'No connection', 'muted'),
      );
      if ((session.participants?.length || 0) > 1) {
        const remove = mutationButton(document, 'Remove', () => dispatch(
          'remove-participant',
          { sessionId: session.id, agentId: participant.agentId },
        ), busy, 'compact-action danger-action');
        remove.dataset.removeParticipant = participant.agentId;
        row.append(remove);
      }
      participants.append(row);
    }
    const available = snapshot.agents.find(
      (agent) => !session.participants.some((participant) => participant.agentId === agent.id),
    );
    if (available && assigned) {
      const add = mutationButton(document, `Add ${available.name}`, () => dispatch(
        'add-participant',
        { sessionId: session.id, agentId: available.id, connectionId: assigned.id },
      ), busy, 'secondary-action');
      add.dataset.action = 'add-participant';
      participants.append(add);
    }
    panel.append(participants);

    const danger = group(
      document,
      'Danger zone',
      'Deleting this session removes its saved conversation. Agents and connections remain.',
    );
    danger.className += ' danger-zone';
    const remove = mutationButton(document, 'Delete session', () => dispatch(
      'confirm-delete-session',
      { sessionId: session.id },
    ), busy, 'danger-action secondary-action');
    remove.dataset.action = 'delete-session';
    danger.append(remove);
    panel.append(danger);
  }

  function renderTabs(document, shell, selected, options) {
    const tabs = element(document, 'div', '', 'settings-tabs');
    tabs.setAttribute?.('role', 'tablist');
    const definitions = [
      ['agent', 'Agent settings'],
      ['session', 'Session settings'],
    ];
    const buttons = definitions.map(([id, text]) => {
      const tab = actionButton(document, text, () => options.onSelectTab?.(id), 'settings-tab');
      tab.setAttribute?.('role', 'tab');
      tab.setAttribute?.('aria-selected', String(selected === id));
      tab.setAttribute?.('aria-controls', `${id}-settings-panel`);
      tab.dataset.settingsTab = id;
      return tab;
    });
    tabs.addEventListener('keydown', (event) => {
      const current = definitions.findIndex(([id]) => id === selected);
      let next = current;
      if (event.key === 'ArrowRight' || event.key === 'End') next = definitions.length - 1;
      if (event.key === 'ArrowLeft' || event.key === 'Home') next = 0;
      if (next !== current) {
        event.preventDefault?.();
        options.onSelectTab?.(definitions[next][0]);
        buttons[next].focus?.();
      }
    });
    tabs.append(...buttons);
    shell.append(tabs);
  }

  function renderSettings(target, snapshot, dispatch, options = {}) {
    const document = options.document || globalThis.document;
    const busy = snapshot.run?.busy === true || options.connectionActionPending === true;
    const selected = options.settingsTab === 'session' ? 'session' : 'agent';
    const shell = element(document, 'section', '', 'settings-shell');
    const header = element(document, 'header', '', 'settings-header');
    header.append(
      element(document, 'div', '', 'settings-title'),
      actionButton(document, 'Back to conversation', () => {
        void dispatch('set-view', { view: 'conversation' });
      }, 'secondary-action'),
    );
    header.children[0].append(
      element(document, 'p', 'Claude Pet', 'eyebrow'),
      element(document, 'h1', 'Settings'),
    );
    shell.append(header);
    renderTabs(document, shell, selected, options);
    const panel = element(document, 'div', '', 'settings-panel');
    panel.setAttribute?.('role', 'tabpanel');
    panel.setAttribute?.('id', `${selected}-settings-panel`);
    panel.setAttribute?.('aria-label', selected === 'agent' ? 'Agent settings' : 'Session settings');
    const merged = { ...options, dispatch };
    if (selected === 'agent') renderAgentSettings(document, panel, snapshot, dispatch, merged, busy);
    else renderSessionSettings(document, panel, snapshot, dispatch, busy);
    shell.append(panel);
    target.replaceChildren(shell);
    return shell;
  }

  const api = Object.freeze({ PROVIDERS, renderSettings });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.claudePetSettings = api;
}(globalThis));
