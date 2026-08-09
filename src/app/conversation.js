'use strict';

(function exposeConversation(root) {
  const ACTIVITY_LABELS = Object.freeze({
    file: (event) => `${event.operation === 'write' ? 'Updated' : 'Read'} ${event.path}`,
    command: (event) => event.exitCode === 0 ? 'Command completed' : 'Command failed',
    tool: (event) => `Used ${event.toolName}`,
    permission: (event) => `${event.decision === 'allow' ? 'Allowed' : 'Denied'} ${event.permission}`,
    network: () => 'Used network access',
    usage: () => 'Updated token usage',
    message: (event) => event.summary || 'Agent response',
  });

  function element(document, tagName, text = '', className = '') {
    const value = document.createElement(tagName);
    value.textContent = text;
    value.className = className;
    return value;
  }

  function button(document, text, action, className = '') {
    const value = element(document, 'button', text, className);
    value.type = 'button';
    value.addEventListener('click', action);
    return value;
  }

  function activityLabel(event) {
    const formatter = ACTIVITY_LABELS[event?.kind];
    return formatter ? formatter(event) : 'Agent activity';
  }

  // Phase 3 Task 9 (design 3.9): reduce activity noise by default while keeping an
  // expandable, timestamped diagnostic view. Loaded as a global script; Node tests
  // (no global) fall back to require.
  const activityModel = (typeof globalThis !== 'undefined' && globalThis.claudePetActivityModel)
    || (typeof require !== 'undefined' ? require('./activityModel.js') : null);

  // Phase 3 Task 3: the live conversation timeline can be rendered as run cards (the
  // runCardController, driven by the shared runCardModel) instead of flat turns. The
  // controller is exposed on globalThis by the renderer script that loads before
  // conversation.js. When it is absent the conversation falls back to the original
  // per-turn rendering so the app keeps working. The timeline element and controller
  // are created once and reused across renders so run-card expansion state survives
  // re-renders; expansion lives in a module-level store the controller reads. The
  // scrub store (Phase 3 Task 5) persists each run's scrubber open/cursor state.
  let runCardTimeline = null;
  let runCardController = null;
  const runCardExpanded = new Set();
  const runCardScrub = new Map();
  // Phase 3 Task 6: the latest render's reopen handler. The run-card controller is
  // created once (so its onReopenGoal closure is stable), but it delegates to this
  // module-level handler, which is refreshed every render with the current snapshot,
  // draftState, and dispatch. Reopening a past goal seeds the composer with that
  // goal's text and re-renders so the user can edit + re-run it.
  let reopenGoalHandler = null;

  function providerLabel(snapshot, turn) {
    const connection = snapshot.connections.find(
      (item) => item.executorType === turn.provider
        && (!turn.model || item.modelId === turn.model),
    );
    return connection?.label || turn.provider || 'Unknown provider';
  }

  function renderActivityDrawer(target, snapshot, dispatch, options = {}) {
    const document = options.document || globalThis.document;
    const section = element(document, 'section', '', 'activity-drawer');
    const header = element(document, 'header', '', 'drawer-header');
    header.append(
      element(document, 'h2', 'Activity', 'section-title'),
      button(document, 'Close', () => {
        void dispatch('set-view', { view: 'conversation' });
      }, 'compact-action'),
    );
    section.append(header);
    const events = Array.isArray(snapshot.activity?.events) ? snapshot.activity.events : [];
    if (events.length === 0) {
      section.append(element(document, 'p', 'Activity will appear here while your agent works.', 'empty-copy'));
    }
    // Phase 3 Task 9 (design 3.9): each event is one collapsed <details> carrying a
    // concise, timestamped summary by default; the full diagnostic JSON stays in the
    // expandable body. Routine "noise" events are hidden by default and revealed via
    // a single toggle, so the drawer is quiet unless the user asks for everything.
    const routine = [];
    for (const event of events) {
      const summary = (activityModel && activityModel.activityEventSummary)
        ? activityModel.activityEventSummary(event)
        : null;
      const label = summary?.label || activityLabel(event);
      const timestamp = summary?.timestamp || '';
      const isNoise = summary?.level === 'noise';
      const details = element(document, 'details', '', `activity-card${isNoise ? ' activity-noise' : ''}`);
      if (isNoise) details.hidden = true;
      details.dataset.level = summary?.level || 'event';
      if (timestamp) details.dataset.timestamp = timestamp;
      const summaryText = timestamp ? `${label} · ${timestamp}` : label;
      const summaryEl = element(document, 'summary', summaryText);
      const detail = element(document, 'pre', JSON.stringify(event, null, 2), 'activity-detail');
      details.append(summaryEl, detail);
      section.append(details);
      if (isNoise) routine.push(details);
    }
    // Reveal/hide routine activity. Hidden by default (design 3.9); the notable events
    // and the expandable diagnostic view remain visible.
    if (routine.length > 0) {
      const toggle = button(
        document,
        `Show routine activity (${routine.length})`,
        () => {
          const anyHidden = routine.some((item) => item.hidden === true);
          for (const item of routine) item.hidden = !anyHidden;
          toggle.textContent = anyHidden
            ? `Hide routine activity (${routine.length})`
            : `Show routine activity (${routine.length})`;
        },
        'secondary-action',
      );
      toggle.dataset.toggleRoutine = 'true';
      section.append(toggle);
    }
    target.replaceChildren(section);
    return section;
  }

  function renderConversation(target, snapshot, dispatch, options = {}) {
    const document = options.document || globalThis.document;
    const draftState = options.draftState || null;
    const shell = element(document, 'section', '', 'conversation-shell');
    const connection = snapshot.connections.find(
      (item) => item.id === snapshot.session?.participants?.find(
        (participant) => participant.agentId === snapshot.activeAgent?.id,
      )?.connectionId,
    ) || null;
    const header = element(document, 'header', '', 'conversation-header');
    const heading = element(document, 'div');
    heading.append(
      element(document, 'p', snapshot.activeAgent
        ? `Ask ${snapshot.activeAgent.name}`
        : 'Choose an agent', 'eyebrow'),
      element(document, 'h1', snapshot.session?.title || 'No session selected'),
      element(document, 'p', snapshot.session?.workspacePath || 'Choose a project folder', 'muted'),
    );
    const badges = element(document, 'div', '', 'header-badges');
    if (connection) {
      badges.append(
        element(document, 'span', `${connection.label} · ${connection.modelId}`, 'badge'),
        element(
          document,
          'span',
          connection.permissionProfile === 'full-computer'
            ? 'Full computer access'
            : 'Workspace only',
          `badge ${connection.permissionProfile === 'full-computer' ? 'danger-badge' : ''}`,
        ),
      );
    }
    badges.append(button(document, 'Activity', () => {
      void dispatch('set-view', { view: 'activity' });
    }, 'secondary-action'));
    header.append(heading, badges);

    // Build the conversation timeline. Prefer the run-card controller (Phase 3 Task 3)
    // when it is loaded; otherwise fall back to the original per-turn rendering. The
    // controller's host element is created once and reused so expansion state survives.
    let timeline;
    const runCards = (typeof globalThis !== 'undefined' ? globalThis.claudePetRunCards : null);
    if (runCards && typeof runCards.createRunCardHost === 'function') {
      // Refresh the reopen handler with this render's snapshot/draftState/dispatch.
      reopenGoalHandler = (goalText) => {
        if (!draftState || !snapshot.session?.id) return;
        draftState.setComposer(snapshot.session.id, goalText);
        void dispatch('set-view', { view: 'conversation' });
      };
      if (!runCardTimeline) {
        runCardTimeline = element(document, 'div', '', 'conversation-scroll');
        runCardTimeline.setAttribute?.('role', 'log');
        runCardTimeline.setAttribute?.('aria-label', 'Conversation');
        runCardController = runCards.createRunCardHost(runCardTimeline, {
          expandedStore: runCardExpanded,
          scrubStore: runCardScrub,
          onReopenGoal: (goalText) => { if (reopenGoalHandler) reopenGoalHandler(goalText); },
        });
      }
      timeline = runCardTimeline;
      runCardController.update(snapshot);
    } else {
      timeline = element(document, 'div', '', 'conversation-scroll');
      timeline.setAttribute?.('role', 'log');
      timeline.setAttribute?.('aria-label', 'Conversation');
      if (!snapshot.turns.length) {
        timeline.append(element(document, 'p', 'Start with a clear task. Your agent’s answer will stay in this session.', 'empty-copy'));
      }
      for (const turn of snapshot.turns) {
        const agent = snapshot.agents.find((item) => item.id === turn.agentId);
        const article = element(document, 'article', '', `turn turn-${turn.role}`);
        const byline = turn.role === 'user'
          ? `You → ${agent?.name || 'Unknown agent'}`
          : `${agent?.name || 'Unknown agent'} · ${providerLabel(snapshot, turn)} · ${turn.model}`;
        article.append(
          element(document, 'h2', byline, 'turn-byline'),
          element(document, 'p', turn.text, 'turn-text'),
        );
        timeline.append(article);
      }
    }

    if (snapshot.notice) {
      const terminal = element(document, 'section', '', `terminal-state terminal-${snapshot.notice.status}`);
      terminal.append(
        element(document, 'strong', snapshot.notice.message),
        button(document, snapshot.notice.action || 'Continue', () => {
          if (snapshot.notice.action === 'Retry') void dispatch('retry-run', {});
          else composerText.focus?.();
        }, 'compact-action'),
      );
      timeline.append(terminal);
    }

    const composer = element(document, 'form', '', 'composer');
    const selectorLabel = element(document, 'label', 'Ask', 'composer-agent');
    const selector = element(document, 'select');
    selector.setAttribute?.('aria-label', 'Agent for next turn');
    for (const participant of snapshot.session?.participants || []) {
      const agent = snapshot.agents.find((item) => item.id === participant.agentId);
      if (!agent) continue;
      const option = element(document, 'option', agent.name);
      option.value = agent.id;
      option.selected = agent.id === snapshot.activeAgent?.id;
      selector.append(option);
    }
    selector.disabled = snapshot.run.busy;
    selector.addEventListener('change', () => {
      if (snapshot.session?.id && selector.value) {
        void dispatch('select-participant', {
          sessionId: snapshot.session.id,
          agentId: selector.value,
        });
      }
    });
    selectorLabel.append(selector);
    const composerText = element(document, 'textarea');
    composerText.rows = 3;
    composerText.placeholder = snapshot.activeAgent
      ? `Ask ${snapshot.activeAgent.name}…`
      : 'Choose an agent to start';
    composerText.disabled = snapshot.run.busy || !snapshot.activeAgent;
    if (snapshot.session?.id && draftState) {
      composerText.value = draftState.composer(snapshot.session.id);
      composerText.addEventListener('input', () => {
        draftState.setComposer(snapshot.session.id, composerText.value);
      });
    }
    const actions = element(document, 'div', '', 'composer-actions');
    const attachmentArea = element(document, 'div', '', 'attachment-area');
    if (snapshot.pendingAttachment) {
      const size = snapshot.pendingAttachment.size < 1024
        ? `${snapshot.pendingAttachment.size} bytes`
        : `${Math.ceil(snapshot.pendingAttachment.size / 1024)} KB`;
      const chip = element(document, 'div', '', 'attachment-chip');
      chip.append(
        element(document, 'span', `${snapshot.pendingAttachment.name} · ${size}`),
        button(document, 'Remove', () => {
          void dispatch('clear-attachment', {});
        }, 'compact-action'),
      );
      attachmentArea.append(chip);
    }
    attachmentArea.append(element(
      document,
      'p',
      'Text, code, configuration, Markdown, CSV, JSON, and logs · 48 KiB maximum.',
      'attachment-help',
    ));
    const composerEntry = element(document, 'div', '', 'composer-entry');
    composerEntry.append(composerText, attachmentArea);
    const attach = button(document, 'Attach file', () => {
      void dispatch('choose-attachment', {});
    }, 'secondary-action');
    attach.disabled = snapshot.run.busy || !snapshot.activeAgent;
    const primary = button(
      document,
      snapshot.run.busy ? 'Stop' : 'Send',
      () => {
        if (snapshot.run.busy) void dispatch('stop-run', {});
        else if (composerText.value.trim()) {
          void dispatch('submit-goal', { text: composerText.value.trim() }).then(() => {
            composerText.value = '';
            if (snapshot.session?.id && draftState) draftState.clearComposer(snapshot.session.id);
            composerText.focus?.();
          });
        }
      },
      'primary-action composer-primary',
    );
    primary.disabled = !snapshot.run.busy && (!snapshot.activeAgent || !snapshot.session);
    actions.append(attach, primary);
    composer.append(selectorLabel, composerEntry, actions);
    shell.append(header, timeline, composer);
    target.replaceChildren(shell);
    return shell;
  }

  const api = Object.freeze({
    ACTIVITY_LABELS,
    activityLabel,
    renderActivityDrawer,
    renderConversation,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.claudePetConversation = api;
}(globalThis));
