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
      const form = navigation.children.find?.((child) => child.className === 'inline-session-form');
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
      const item = element(document, 'li');
      const button = actionButton(document, session.title, () => {
        void dispatch('select-session', { sessionId: session.id });
      }, 'nav-item session-item');
      button.dataset.sessionId = session.id;
      if (snapshot.selection?.sessionId === session.id) button.dataset.selected = 'true';
      item.append(button);
      sessionList.append(item);
    }
    sessionSection.append(sessionList);

    const form = element(document, 'form', '', 'inline-session-form');
    form.hidden = true;
    const title = element(document, 'input');
    title.name = 'title';
    title.setAttribute?.('aria-label', 'Session name');
    const submit = element(document, 'button', 'Create', 'compact-action');
    submit.type = 'submit';
    form.append(title, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const agentId = snapshot.activeAgent?.id || snapshot.agents?.[0]?.id;
      const workspacePath = snapshot.session?.workspacePath
        || snapshot.connections?.[0]?.workspacePath;
      if (agentId && workspacePath && title.value.trim()) {
        void dispatch('create-session', {
          agentId,
          title: title.value.trim(),
          workspacePath,
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
