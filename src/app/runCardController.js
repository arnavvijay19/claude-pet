'use strict';

// Live main-window run-card controller (Phase 3 Task 3).
//
// The app window is a no-bundler Electron renderer loaded from file:// with
// contextIsolation on and no ESM module loader, so it cannot use the Preact+htm
// components here at runtime yet. This controller renders the EXACT same run cards
// the component library draws, but with vanilla DOM built from document.createElement,
// driven by the framework-free model in ../renderer/components/runCardModel.js. The
// two share buildRunCards / deriveTraceProps / formatTraceSummary, so the live cards
// and the Preact components can never drift. When the app shell later gains an ESM
// loader (custom protocol), the live window can swap to the Preact RunCard with zero
// logic change.
//
// This file is dual-mode: it loads as a classic <script> in the renderer (exposing
// globalThis.claudePetRunCards) and is also require()able in Node for jsdom tests.

(function exposeRunCards(root) {
  const model = (root && root.claudePetRunCardModel)
    || (typeof require !== 'undefined' ? require('../renderer/components/runCardModel.js') : null);
  if (!model || typeof model.buildRunCards !== 'function') {
    throw new Error('runCardModel is required by the run-card controller');
  }
  const { buildRunCards, TRACE_KINDS } = model;

  // Phase 3 Task 5: the run scrubber (design 3.5) reuses this controller's run card.
  // Its pure model + live controller are loaded here so the toggle can render an
  // inline, read-only step-by-step replay of a completed run.
  const scrubberModel = (root && root.claudePetRunScrubberModel)
    || (typeof require !== 'undefined' ? require('../renderer/components/runScrubberModel.js') : null);
  const scrubberController = (root && root.claudePetRunScrubber)
    || (typeof require !== 'undefined' ? require('./runScrubberController.js') : null);
  const isScrubbable = scrubberModel && typeof scrubberModel.isScrubbable === 'function'
    ? scrubberModel.isScrubbable
    : () => false;

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
      const row = element(doc, 'span', line.text, `diff__line diff__line--${line.type}`);
      pre.append(row);
    }
    parent.append(pre);
  }

  // Builds one <li> trace item. Command items show the command plus an exit-code
  // badge; file items show the path and an optional inline diff; the rest render a
  // single label line. Text is set via textContent so provider output is never parsed
  // as HTML.
  function appendTraceItem(doc, list, item) {
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

  function appendTrace(doc, cardEl, card, expanded, onToggle) {
    const wrap = element(doc, 'div', '', 'run-card__trace');
    const summary = element(
      doc,
      'button',
      model.formatTraceSummary(card.trace),
      'trace-summary',
    );
    summary.type = 'button';
    summary.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    const icon = element(doc, 'span', expanded ? '▾' : '▸', 'trace-summary__icon');
    icon.setAttribute('aria-hidden', 'true');
    const label = element(doc, 'span', '', 'trace-summary__label');
    label.textContent = model.formatTraceSummary(card.trace);
    summary.append(icon, label);
    if (typeof onToggle === 'function') summary.addEventListener('click', onToggle);
    wrap.append(summary);

    if (expanded) {
      const list = element(doc, 'ul', '', 'trace-list');
      list.setAttribute('role', 'list');
      if (!card.trace.items.length) {
        wrap.append(element(doc, 'p', 'No tool actions were recorded for this run.', 'trace-empty'));
      } else {
        for (const item of card.trace.items) appendTraceItem(doc, list, item);
        wrap.append(list);
      }
    }
    cardEl.append(wrap);
  }

  function appendCard(doc, host, card, expandedStore, rerender, scrubStore) {
    const article = element(doc, 'article', '', 'run-card');
    if (card.id) article.setAttribute('data-run-id', card.id);

    if (card.goal) {
      const header = element(doc, 'header', '', 'run-card__goal');
      header.append(element(doc, 'span', 'You', 'run-card__byline run-card__byline--user'));
      header.append(element(doc, 'p', card.goal.text, 'run-card__goal-text'));
      article.append(header);
    }

    const hasTrace = (card.trace?.steps || 0) > 0;
    if (hasTrace) {
      const id = card.id || '';
      const expanded = expandedStore.has(id);
      appendTrace(doc, article, card, expanded, () => {
        if (expandedStore.has(id)) expandedStore.delete(id);
        else expandedStore.add(id);
        rerender();
      });
    }

    // Phase 3 Task 5: a completed run gains a "Scrub steps" affordance. Toggling it
    // reveals an inline scrubber that replays the run step by step (read-only; no
    // new data collection, no provider calls). The scrubStore (a Map keyed by runId)
    // doubles as the open flag and persists the cursor across re-renders.
    if (isScrubbable(card) && scrubStore) {
      const id = card.id || '';
      const scrubOn = scrubStore.has(id);
      const toggle = element(doc, 'button', scrubOn ? 'Hide scrubber' : 'Scrub steps', 'run-card__scrub-toggle');
      toggle.type = 'button';
      toggle.setAttribute('aria-pressed', scrubOn ? 'true' : 'false');
      toggle.addEventListener('click', () => {
        if (scrubStore.has(id)) scrubStore.delete(id);
        else scrubStore.set(id, undefined);
        rerender();
      });
      article.append(toggle);
      if (scrubOn) {
        const panel = element(doc, 'div', '', 'run-card__scrubber');
        article.append(panel);
        if (scrubberController && typeof scrubberController.createScrubberHost === 'function') {
          scrubberController.createScrubberHost(panel, card, { store: scrubStore });
        }
      }
    }

    if (card.answer) {
      const section = element(doc, 'section', '', 'run-card__answer');
      const byline = element(doc, 'p', '', 'run-card__byline run-card__byline--agent');
      byline.textContent = card.answer.agentName;
      if (card.answer.providerLabel) byline.append(` · ${card.answer.providerLabel}`);
      if (card.answer.model) byline.append(` · ${card.answer.model}`);
      section.append(byline);
      section.append(element(doc, 'p', card.answer.text, 'run-card__answer-text'));
      article.append(section);
    }

    host.append(article);
  }

  // Render the full conversation timeline as run cards into host.
  function renderCards(host, snapshot, expandedStore, scrubStore) {
    const doc = (typeof globalThis !== 'undefined' && globalThis.document) || null;
    if (!doc || !host) return;
    const cards = model.buildRunCards(snapshot);

    const rerender = () => renderCards(host, snapshot, expandedStore, scrubStore);
    if (typeof host.replaceChildren === 'function') host.replaceChildren();
    else { while (host.firstChild) host.removeChild(host.firstChild); }

    if (!cards.length) {
      host.append(element(doc, 'p', 'Start with a clear task. Your agent’s answer will stay in this session.', 'empty-copy'));
      return;
    }
    for (const card of cards) appendCard(doc, host, card, expandedStore, rerender, scrubStore);
  }

  // Bind a run-card timeline to a host element and persistent expand/collapse +
  // scrubber stores. `update` re-derives the run cards from a snapshot and
  // re-renders; expansion + scrubber state survive across updates because they live
  // in the caller-supplied stores.
  function createRunCardHost(host, options = {}) {
    if (!host) throw new TypeError('createRunCardHost requires a host element');
    const expandedStore = options.expandedStore || new Set();
    const scrubStore = options.scrubStore || new Map();

    function update(snapshot) {
      renderCards(host, snapshot, expandedStore, scrubStore);
    }

    return Object.freeze({ update });
  }

  const api = Object.freeze({
    createRunCardHost,
    renderCards,
    buildRunCards,
    formatTraceSummary: model.formatTraceSummary,
    TRACE_KINDS,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.claudePetRunCards = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
