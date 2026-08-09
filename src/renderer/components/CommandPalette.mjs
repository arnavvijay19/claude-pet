// CommandPalette — the Phase 3 presentational command palette (design 3.7: `Ctrl+K`).
// A keyboard-first palette that carries actions, not just navigation: switch agent /
// session / connection, re-run with edits, open folder, copy diff, export session.
//
// The pure command derivation + filtering live in ./commandPaletteModel.js so the live
// vanilla-DOM controller (commandPaletteController.js) and this component share one source
// of truth. This module is the component library + jsdom test surface; it re-exports the
// model so existing tests keep importing the pure functions from here unchanged.
//
// Imports resolve through the vendored copies under ../vendor so the package needs no
// bare-specifier ESM resolution under file:// in the asar=false build.

import { h, render } from '../vendor/preact.mjs';
import htm from '../vendor/htm.mjs';
import commandPaletteModel from './commandPaletteModel.js';

const { buildCommands, filterCommands, moveSelection } = commandPaletteModel;

export { commandPaletteModel, buildCommands, filterCommands, moveSelection };

const html = htm.bind(h);

// Presentational palette. `commands` is the full command list for the current snapshot;
// `query` filters it (via the shared model); `selectedIndex` marks the active option.
// Handlers: onQuery(text), onSelect(command), onHover(index).
export function CommandPalette(props = {}) {
  const {
    commands = [],
    query = '',
    selectedIndex = 0,
    onQuery = null,
    onSelect = null,
    onHover = null,
  } = props;

  const visible = filterCommands(commands, query);

  return html`
    <div class="command-palette" role="combobox" aria-expanded="true" aria-haspopup="listbox">
      <input
        class="command-palette__input"
        type="text"
        aria-label="Filter commands"
        aria-controls="command-palette-list"
        placeholder="Type a command…"
        value=${query}
        oninput=${(event) => { if (typeof onQuery === 'function') onQuery(event.target.value); }}
      />
      <ul id="command-palette-list" class="command-palette__list" role="listbox" aria-label="Commands">
        ${visible.length === 0
          ? html`<li class="command-palette__empty">No matching commands</li>`
          : visible.map((command, index) => html`
            <li
              class=${`command-palette__item${index === selectedIndex ? ' is-selected' : ''}`}
              role="option"
              data-command-id=${command.id}
              aria-selected=${index === selectedIndex ? 'true' : 'false'}
              onmousemove=${() => { if (typeof onHover === 'function' && selectedIndex !== index) onHover(index); }}
              onclick=${() => { if (typeof onSelect === 'function') onSelect(command); }}
            >
              <span class="command-palette__item-title">${command.title}</span>
              <span class="command-palette__item-detail">${command.detail}</span>
            </li>
          `)}
      </ul>
    </div>
  `;
}

export function mountCommandPalette(container, props) {
  if (!container) throw new TypeError('CommandPalette requires a host element');
  render(html`<${CommandPalette} ...${props} />`, container);
  return container;
}

export default CommandPalette;
