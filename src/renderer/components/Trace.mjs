// Trace — the Phase 3 trace components (design 3.3): a collapsed summary chip and an
// expanded list of tool-action trace items with command exit codes, file operations,
// and inline unified diffs colored by +/- line. No third-party syntax highlighter is
// added; structural markup, monospace, and diff coloring carry it.
//
// Imports resolve through the vendored copies under ../vendor so the package needs no
// bare-specifier ESM resolution under file:// in the asar=false build.

import { h } from '../vendor/preact.mjs';
import htm from '../vendor/htm.mjs';
import runCardModel from './runCardModel.js';
const { TRACE_KINDS } = runCardModel;

export { runCardModel };

const html = htm.bind(h);

// The collapsed summary: "N steps · M files changed · duration". It is a button so the
// whole chip is keyboard-operable; aria-expanded reflects the current state.
export function TraceSummary(props = {}) {
  const { summary = '', expanded = false, onToggle = null } = props;
  return html`
    <button
      class="trace-summary"
      type="button"
      aria-expanded=${expanded ? 'true' : 'false'}
      onClick=${typeof onToggle === 'function' ? onToggle : null}
    >
      <span class="trace-summary__icon" aria-hidden="true">${expanded ? '▾' : '▸'}</span>
      <span class="trace-summary__label">${summary}</span>
    </button>
  `;
}

// Renders one diff as typed rows. Each row is a styled line; sign lines are colored
// via class so app.css owns the palette.
function renderDiffLines(lines) {
  if (!Array.isArray(lines)) return null;
  return html`<pre class="diff" aria-label="Unified diff">${
    lines.map((line, index) => html`<span
      key=${`diff-${index}`}
      class=${`diff__line diff__line--${line.type}`}
    >${line.text}</span>`)
  }</pre>`;
}

// Renders the expanded list of trace items. Each item is one tool action: a command
// with its exit-code badge, a file operation, a tool use, a permission decision, etc.
export function TraceList(props = {}) {
  const { items = [] } = props;
  if (items.length === 0) {
    return html`<p class="trace-empty">No tool actions were recorded for this run.</p>`;
  }
  return html`<ul class="trace-list" role="list">
    ${items.map((item, index) => {
      const kind = item.kind || TRACE_KINDS.UNKNOWN;
      return html`<li key=${item.id || `trace-${index}`} class=${`trace-item trace-item--${kind}`}>
        ${kind === TRACE_KINDS.COMMAND
          ? html`<code class="trace-item__command">${item.command}</code>
              <span class=${`trace-item__exit trace-item__exit--${item.exitCode === 0 ? 'ok' : 'fail'}`}>exit ${item.exitCode}</span>
              ${item.output ? html`<pre class="trace-item__output" aria-label="Command output">${item.output}</pre>` : null}`
          : null}
        ${kind === TRACE_KINDS.FILE
          ? html`<span class="trace-item__path">${item.label}</span>
              ${item.diffLines ? renderDiffLines(item.diffLines) : null}`
          : null}
        ${kind === TRACE_KINDS.TOOL
          ? html`<span class="trace-item__tool">${item.label}</span>`
          : null}
        ${kind === TRACE_KINDS.PERMISSION
          ? html`<span class="trace-item__permission">${item.label}</span>`
          : null}
        ${kind === TRACE_KINDS.NETWORK
          ? html`<span class="trace-item__network">${item.label}</span>`
          : null}
        ${kind === TRACE_KINDS.USAGE
          ? html`<span class="trace-item__usage">${item.label}</span>`
          : null}
        ${(kind === TRACE_KINDS.MESSAGE || kind === TRACE_KINDS.UNKNOWN)
          ? html`<span class="trace-item__note">${item.label}</span>`
          : null}
      </li>`;
    })}
  </ul>`;
}

export default TraceList;
