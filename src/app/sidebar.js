'use strict';

(function exposeSidebar(root) {
  function element(document, tagName, text = '', className = '') {
    const value = document.createElement(tagName);
    value.textContent = text;
    value.className = className;
    return value;
  }

  function actionButton(document, text, action, className = '') {
    const button = element(document, 'button', text, className);
    button.type = 'button';
    button.addEventListener('click', action);
    return button;
  }

  function renderSidebar(target, snapshot, dispatch, options = {}) {
    const document = options.document || globalThis.document;
    const navigation = element(document, 'nav', '', 'sidebar-navigation');
    navigation.setAttribute?.('aria-label', 'Claude Pet navigation');

    const brand = element(document, 'div', '', 'brand');
    brand.append(
      element(document, 'span', 'Claude Pet', 'brand-name'),
      element(document, 'span', 'Your local desktop agent', 'brand-subtitle'),
    );
    const newSession = actionButton(document, 'New session', () => {
      const form = Array.from(navigation.children).find(
        (child) => child.className === 'inline-session-form',
      );
      if (form) {
        form.hidden = false;
        form.children[0]?.focus?.();
      }
    }, 'primary-action');
    newSession.hidden = !Array.isArray(snapshot.agents) || snapshot.agents.length === 0;
    navigation.append(brand, newSession);

    const agentSection = element(document, 'section', '', 'sidebar-section');
    agentSection.append(element(document, 'h2', 'Agents', 'section-label'));
    const agentList = element(document, 'ul', '', 'nav-list');
    for (const agent of snapshot.agents || []) {
      const item = element(document, 'li');
      const button = actionButton(document, agent.name, () => {
        if (snapshot.session?.participants?.some(
          (participant) => participant.agentId === agent.id,
        )) {
          void dispatch('select-participant', {
            sessionId: snapshot.session.id,
            agentId: agent.id,
          });
        }
      }, 'nav-item agent-item');
      button.dataset.agentId = agent.id;
      button.dataset.status = agent.status || 'idle';
      button.append(element(document, 'span', agent.status || 'idle', 'status-label'));
      item.append(button);
      agentList.append(item);
    }
    agentSection.append(agentList);

    const sessionSection = element(document, 'section', '', 'sidebar-section');
    sessionSection.append(element(document, 'h2', 'Shared sessions', 'section-label'));
    const sessionList = element(document, 'ul', '', 'nav-list');
    for (const session of snapshot.sessions || []) {
      const selected = snapshot.selection?.sessionId === session.id;
      const item = element(document, 'li', '', 'session-list-item');
      const button = actionButton(document, session.title, () => {
        void dispatch('select-session', { sessionId: session.id });
      }, 'nav-item session-item');
      button.dataset.sessionId = session.id;
      if (selected) button.dataset.selected = 'true';
      item.append(button);
      if (selected) {
        const menu = element(document, 'div', '', 'session-menu');
        menu.setAttribute?.('role', 'menu');
        menu.hidden = true;
        const rename = actionButton(document, 'Rename', () => {
          menu.hidden = true;
          options.onOpenSessionSettings?.(session.id);
        }, 'compact-action');
        rename.setAttribute?.('role', 'menuitem');
        rename.dataset.action = 'rename-selected-session';
        const remove = actionButton(document, 'Delete', () => {
          menu.hidden = true;
          void dispatch('confirm-delete-session', { sessionId: session.id });
        }, 'compact-action danger-action');
        remove.setAttribute?.('role', 'menuitem');
        remove.dataset.action = 'delete-selected-session';
        menu.append(rename, remove);
        const overflow = actionButton(document, 'More', () => {
          menu.hidden = !menu.hidden;
          if (!menu.hidden) rename.focus?.();
        }, 'session-overflow');
        overflow.setAttribute?.('aria-label', `More actions for ${session.title}`);
        overflow.setAttribute?.('aria-haspopup', 'menu');
        overflow.setAttribute?.('aria-expanded', 'false');
        overflow.dataset.action = 'selected-session-menu';
        menu.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            menu.hidden = true;
            overflow.focus?.();
          }
        });
        item.append(overflow, menu);
      }
      sessionList.append(item);
    }
    sessionSection.append(sessionList);

    const form = element(document, 'form', '', 'inline-session-form');
    form.hidden = true;
    const title = element(document, 'input');
    title.name = 'title';
    title.setAttribute?.('aria-label', 'Session name');
    const connection = element(document, 'select');
    connection.name = 'connection';
    connection.setAttribute?.('aria-label', 'Connection for this session');
    const activeConnectionId = snapshot.session?.participants?.find(
      (participant) => participant.agentId === snapshot.activeAgent?.id,
    )?.connectionId || null;
    for (const item of snapshot.connections || []) {
      const option = element(document, 'option', `${item.label} · ${item.workspacePath}`);
      option.value = item.id;
      option.selected = item.id === activeConnectionId;
      connection.append(option);
    }
    connection.value = activeConnectionId || snapshot.connections?.[0]?.id || '';
    const submit = element(document, 'button', 'Create', 'compact-action');
    submit.type = 'submit';
    form.append(title, connection, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const agentId = snapshot.activeAgent?.id || snapshot.agents?.[0]?.id;
      if (agentId && connection.value && title.value.trim()) {
        void dispatch('create-session', {
          agentId,
          title: title.value.trim(),
          connectionId: connection.value,
        });
      }
    });

    const settings = actionButton(document, 'Settings', () => {
      void dispatch('set-view', { view: 'settings' });
    }, 'settings-action');
    navigation.append(agentSection, sessionSection, form, settings);
    target.replaceChildren(navigation);
    return navigation;
  }

  const api = Object.freeze({ renderSidebar });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.claudePetSidebar = api;
}(globalThis));
