// RunCard — the Phase 3 presentational run card (design 3.3: "Runs, not chat
// bubbles"). One card shows the goal, a compact trace summary that expands to the
// tool-action trace, and the agent's answer. The pure state-to-props mapping and
// trace formatting live in ./runCardModel.js so the live vanilla-DOM controller and
// this component share one source of truth. This module is the component library +
// jsdom test surface; it re-exports the model so existing tests keep importing the
// pure functions from here unchanged.
//
// Imports resolve through the vendored copies under ../vendor so the package needs no
// bare-specifier ESM resolution under file:// in the asar=false build.

import { h, render } from '../vendor/preact.mjs';
import htm from '../vendor/htm.mjs';
import runCardModel from './runCardModel.js';
import { color } from '../designTokens.mjs';
import { TraceSummary, TraceList } from './Trace.mjs';

const {
  RUN_CARD_ROLES,
  TRACE_KINDS,
  formatTraceSummary,
} = runCardModel;

export {
  runCardModel,
  RUN_CARD_ROLES,
  TRACE_KINDS,
  formatTraceSummary,
};

const html = htm.bind(h);

// One run card. `expanded` is the UI state owned by the host; `onToggleTrace` flips it.
// A card with only a goal and no answer yet reads as an in-progress run; a card with
// only an answer (e.g. a leading assistant turn) shows the answer and its trace.
export function RunCard(props = {}) {
  const {
    id = null,
    goal = null,
    answer = null,
    trace = { steps: 0, filesChanged: 0, durationMs: 0, items: [] },
    expanded = false,
    onToggleTrace = null,
  } = props;

  const hasTrace = (trace?.steps || 0) > 0;
  const summary = formatTraceSummary(trace);

  return html`
    <article class="run-card" data-run-id=${id || ''}>
      ${goal
        ? html`<header class="run-card__goal">
            <span class="run-card__byline run-card__byline--user">You</span>
            <p class="run-card__goal-text">${goal.text}</p>
          </header>`
        : null}
      ${hasTrace
        ? html`<div class="run-card__trace">
            <${TraceSummary}
              summary=${summary}
              expanded=${expanded}
              onToggle=${typeof onToggleTrace === 'function' ? onToggleTrace : null}
            />
            ${expanded
              ? html`<${TraceList} items=${trace.items} />`
              : null}
          </div>`
        : null}
      ${answer
        ? html`<section class="run-card__answer">
            <p class="run-card__byline run-card__byline--agent">
              ${answer.agentName}${answer.providerLabel ? html` · ${answer.providerLabel}` : null}${answer.model ? html` · ${answer.model}` : null}
            </p>
            <p class="run-card__answer-text">${answer.text}</p>
          </section>`
        : null}
    </article>
  `;
}

export function mountRunCard(container, props) {
  if (!container) throw new TypeError('RunCard requires a host element');
  render(html`<${RunCard} ...${props} />`, container);
  return container;
}

// Keep an intentional reference so tree-shaking never drops the shared token
// table this component is built around.
export const runCardPalette = color;

export default RunCard;
