// RunScrubber — the Phase 3 presentational run scrubber (design 3.5). A completed
// run card can be scrubbed step by step to see the trace, command output, and diff
// as they stood at that point. Read-only replay over the run's existing trace items;
// it adds no data collection and no provider calls.
//
// Imports resolve through the vendored copies under ../vendor so the package needs
// no bare-specifier ESM resolution under file:// in the asar=false build. This is
// the component library + jsdom test surface; it re-exports the model so existing
// tests keep importing the pure functions from here unchanged.

import { h, render, Component } from '../vendor/preact.mjs';
import htm from '../vendor/htm.mjs';
import runScrubberModel from './runScrubberModel.js';
import runCardModel from './runCardModel.js';
import { TraceList } from './Trace.mjs';

const {
  isScrubbable,
  buildScrubberState,
  nextStep,
  prevStep,
  scrubberPosition,
  visibleItems,
  formatScrubberLabel,
} = runScrubberModel;

const { TRACE_KINDS } = runCardModel;

export {
  runScrubberModel,
  runCardModel,
  isScrubbable,
  buildScrubberState,
  TRACE_KINDS,
};

const html = htm.bind(h);

// One run scrubber. The cursor index is local component state; the visible region
// is the cumulative trace items 0..index, rendered with the shared TraceList so it
// shows command output and diffs exactly like the expanded trace. A class component
// is used because only Preact core (no hooks) is vendored.
export class RunScrubber extends Component {
  constructor(props = {}) {
    super(props);
    const card = props.card;
    const start = props.startIndex != null
      ? props.startIndex
      : (card && card.trace ? card.trace.items.length - 1 : 0);
    this.state = { index: start };
  }

  onPrev() {
    const state = buildScrubberState(this.props.card, { startIndex: this.state.index });
    const nextState = prevStep(state);
    if (nextState) this.setState({ index: nextState.index });
  }

  onNext() {
    const state = buildScrubberState(this.props.card, { startIndex: this.state.index });
    const nextState = nextStep(state);
    if (nextState) this.setState({ index: nextState.index });
  }

  render() {
    const { card } = this.props;
    if (!isScrubbable(card)) return null;
    const state = buildScrubberState(card, { startIndex: this.state.index });
    const position = scrubberPosition(state);
    const visible = visibleItems(state, card.trace.items);

    return html`
      <div
        class="scrubber"
        role="group"
        aria-label="Run step scrubber"
        tabindex="0"
        onKeyDown=${(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { this.onPrev(); event.preventDefault(); }
          else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { this.onNext(); event.preventDefault(); }
        }}
      >
        <div class="scrubber__toolbar">
          <button
            type="button"
            class="scrubber__btn scrubber__btn--prev"
            aria-label="Previous step"
            disabled=${position.isStart}
            onClick=${() => this.onPrev()}
          >‹ Prev</button>
          <span class="scrubber__position" aria-live="polite" aria-atomic="true">${formatScrubberLabel(state)}</span>
          <button
            type="button"
            class="scrubber__btn scrubber__btn--next"
            aria-label="Next step"
            disabled=${position.isEnd}
            onClick=${() => this.onNext()}
          >Next ›</button>
        </div>
        <p class="scrubber__caption">Scrub through the run to see the trace, command output, and diffs as they stood at each step.</p>
        <${TraceList} items=${visible} />
      </div>
    `;
  }
}

export function mountRunScrubber(container, props) {
  if (!container) throw new TypeError('RunScrubber requires a host element');
  render(html`<${RunScrubber} ...${props} />`, container);
  return container;
}

export default RunScrubber;
