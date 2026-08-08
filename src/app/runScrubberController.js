'use strict';

// Live main-window run-scrubber controller (Phase 3 Task 5 / design 3.5).
//
// A completed run card can be scrubbed step by step: moving through the steps shows
// the trace, command output, and diff as they stood at that point. It is a strictly
// read-only replay over the run's existing trace items — no new data collection,
// no provider calls.
//
// The app window is a no-bundler Electron renderer loaded from file:// with
// contextIsolation on and no ESM loader, so this renders with vanilla DOM built
// from document.createElement, driven by the framework-free model in
// ../renderer/components/runScrubberModel.js. The Preact RunScrubber.mjs component
// draws the same thing for the component library + tests; both derive from the same
// model so they cannot drift.
//
// Dual-mode: loads as a classic <script> in the renderer (exposing
// globalThis.claudePetRunScrubber) and is also require()able in Node for jsdom tests.

(function exposeRunScrubber(root) {
  const model = (root && root.claudePetRunScrubberModel)
    || (typeof require !== 'undefined' ? require('../renderer/components/runScrubberModel.js') : null);
  if (!model || typeof model.buildScrubberState !== 'function') {
    throw new Error('runScrubberModel is required by the run-scrubber controller');
  }
  // Trace-kind constants are reused from runCardModel for item rendering; fall back
  // to a local copy so the controller still works if runCardModel is unavailable.
  const cardModel = (root && root.claudePetRunCardModel)
    || (typeof require !== 'undefined' ? require('../renderer/components/runCardModel.js') : null);
  const TRACE_KINDS = (cardModel && cardModel.TRACE_KINDS) || Object.freeze({
    FILE: 'file', COMMAND: 'command', TOOL: 'tool', PERMISSION: 'permission',
    NETWORK: 'network', USAGE: 'usage', MESSAGE: 'message', UNKNOWN: 'activity',
  });
  const { formatScrubberLabel, scrubberPosition, visibleItems } = model;

  function element(doc, tagName, text = '', className = '') {
    const value = doc.createElement(tagName);
    if (text) value.textContent = text;
    if (className) value.className = className;
    return value;
  }

  function appendDiff(doc, parent, lines) {
    if (!Array.isArray(lines)) return;
    const pre = element(doc, 'pre', '', 'diff');
    pre.setAttribute('aria-label', 'Unified diff');
    for (const line of lines) {
      pre.append(element(doc, 'span', line.text, `diff__line diff__line--${line.type}`));
    }
    parent.append(pre);
  }

  // Render one cumulative trace item. Mirrors runCardController's trace item, but
  // also surfaces command output (event.output), which the collapsed trace summary
  // does not. Text is set via textContent so provider output is never parsed as HTML.
  function appendScrubItem(doc, list, item) {
    const kind = item.kind || TRACE_KINDS.UNKNOWN;
    const li = element(doc, 'li', '', `trace-item trace-item--${kind}`);
    if (kind === TRACE_KINDS.COMMAND) {
      const code = element(doc, 'code', item.command, 'trace-item__command');
      const exit = element(
        doc,
        'span',
        `exit ${item.exitCode}`,
        `trace-item__exit trace-item__exit--${item.exitCode === 0 ? 'ok' : 'fail'}`,
      );
      li.append(code, exit);
      if (typeof item.output === 'string' && item.output.length > 0) {
        const out = element(doc, 'pre', item.output, 'trace-item__output');
        out.setAttribute('aria-label', 'Command output');
        li.append(out);
      }
    } else if (kind === TRACE_KINDS.FILE) {
      li.append(element(doc, 'span', item.label, 'trace-item__path'));
      if (Array.isArray(item.diffLines)) appendDiff(doc, li, item.diffLines);
    } else if (kind === TRACE_KINDS.TOOL) {
      li.append(element(doc, 'span', item.label, 'trace-item__tool'));
    } else if (kind === TRACE_KINDS.PERMISSION) {
      li.append(element(doc, 'span', item.label, 'trace-item__permission'));
    } else if (kind === TRACE_KINDS.NETWORK) {
      li.append(element(doc, 'span', item.label, 'trace-item__network'));
    } else if (kind === TRACE_KINDS.USAGE) {
      li.append(element(doc, 'span', item.label, 'trace-item__usage'));
    } else {
      li.append(element(doc, 'span', item.label, 'trace-item__note'));
    }
    list.append(li);
  }

  function clear(host) {
    if (typeof host.replaceChildren === 'function') host.replaceChildren();
    else { while (host.firstChild) host.removeChild(host.firstChild); }
  }

  // Bind a run-scrubber UI to a host element for a completed run card. `options.store`
  // (a Map keyed by runId) persists the cursor index across re-renders so scrubbing
  // is not reset when the conversation re-renders. `update(card)` re-derives state
  // (re-clamping the index to the run's current step count) and re-renders.
  function createScrubberHost(host, card, options = {}) {
    if (!host) throw new TypeError('createScrubberHost requires a host element');
    const doc = (typeof globalThis !== 'undefined' && globalThis.document) || null;
    if (!doc) throw new Error('run-scrubber controller requires a document');
    const store = options.store || new Map();

    function readIndex() {
      return (card && card.id != null && store.has(card.id)) ? store.get(card.id) : undefined;
    }
    function persist(state) {
      if (card && card.id != null) store.set(card.id, state.index);
    }

    function render() {
      const state = model.buildScrubberState(card, { startIndex: readIndex() });
      if (!state) { clear(host); return; }
      persist(state);

      const position = scrubberPosition(state);
      const visible = visibleItems(state, card.trace.items);

      const group = element(doc, 'div', '', 'scrubber');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Run step scrubber');
      group.setAttribute('tabindex', '0');

      const toolbar = element(doc, 'div', '', 'scrubber__toolbar');
      const prev = element(doc, 'button', '‹ Prev', 'scrubber__btn scrubber__btn--prev');
      prev.type = 'button';
      prev.setAttribute('aria-label', 'Previous step');
      prev.disabled = position.isStart;
      const live = element(doc, 'span', formatScrubberLabel(state), 'scrubber__position');
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('aria-atomic', 'true');
      const next = element(doc, 'button', 'Next ›', 'scrubber__btn scrubber__btn--next');
      next.type = 'button';
      next.setAttribute('aria-label', 'Next step');
      next.disabled = position.isEnd;
      toolbar.append(prev, live, next);

      const caption = element(
        doc,
        'p',
        'Scrub through the run to see the trace, command output, and diffs as they stood at each step.',
        'scrubber__caption',
      );

      const list = element(doc, 'ul', '', 'scrubber__list');
      list.setAttribute('role', 'list');
      if (!visible.length) {
        list.append(element(doc, 'li', 'No tool actions recorded up to this step.', 'trace-empty'));
      } else {
        for (const item of visible) appendScrubItem(doc, list, item);
      }

      group.append(toolbar, caption, list);

      prev.addEventListener('click', () => {
        const nextState = model.prevStep(state);
        if (nextState) { persist(nextState); render(); }
      });
      next.addEventListener('click', () => {
        const nextState = model.nextStep(state);
        if (nextState) { persist(nextState); render(); }
      });
      group.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          const nextState = model.prevStep(state);
          if (nextState) { persist(nextState); render(); event.preventDefault(); }
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          const nextState = model.nextStep(state);
          if (nextState) { persist(nextState); render(); event.preventDefault(); }
        }
      });

      clear(host);
      host.append(group);
    }

    function update(nextCard) {
      if (nextCard) card = nextCard;
      render();
    }

    render();
    return Object.freeze({ update });
  }

  const api = Object.freeze({
    createScrubberHost,
    isScrubbable: model.isScrubbable,
    buildScrubberState: model.buildScrubberState,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.claudePetRunScrubber = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
