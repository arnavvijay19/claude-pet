'use strict';

// Live main-window command-palette controller (Phase 3 Task 7 / design 3.7).
//
// `Ctrl+K` opens a keyboard-first palette that replaces the composer's participant
// dropdown and carries actions (switch agent / session / connection, re-run with
// edits, open folder, copy diff, export session). Navigation is keyboard-first:
// ArrowUp/Down and j/k move the selection (wrapping), Enter executes, Escape closes,
// and typing filters the commands. Each entry states the exact target it will act on.
//
// The no-bundler Electron renderer loads from file:// with contextIsolation on and no
// ESM loader, so this renders with vanilla DOM from document.createElement, driven by
// the framework-free model in ../renderer/components/commandPaletteModel.js. The Preact
// CommandPalette.mjs component draws the same thing for the component library + tests.
// Both derive from the same model and the same executor contract, so they cannot drift.
//
// Dual-mode: loads as a classic <script> (exposes globalThis.claudePetCommandPalette)
// and is require()able in Node for jsdom tests.

(function exposeCommandPalette(root) {
  const model = (root && root.claudePetCommandPaletteModel)
    || (typeof require !== 'undefined' ? require('../renderer/components/commandPaletteModel.js') : null);
  if (!model || typeof model.buildCommands !== 'function') {
    throw new Error('commandPaletteModel is required by the command-palette controller');
  }

  function element(doc, tagName, text = '', className = '') {
    const value = doc.createElement(tagName);
    if (text) value.textContent = text;
    if (className) value.className = className;
    return value;
  }

  // Bind a command palette to a mount element. `options.onExecute(command)` is invoked
  // with the chosen command descriptor (its `action` is interpreted by the app). The
  // palette owns its overlay DOM (created once) and only rebuilds the list on open/filter.
  function createCommandPalette(options = {}) {
    const mount = options.mount
      || (typeof globalThis !== 'undefined' ? globalThis.document?.body : null);
    if (!mount) throw new TypeError('createCommandPalette requires a mount element');
    const doc = (typeof globalThis !== 'undefined' && globalThis.document)
      || options.document
      || null;
    if (!doc) throw new Error('command-palette controller requires a document');
    if (typeof options.onExecute !== 'function') {
      throw new TypeError('createCommandPalette requires an onExecute callback');
    }

    let isOpen = false;
    let snapshot = null;
    let query = '';
    let commands = []; // all commands for the current snapshot
    let visible = []; // filtered + ranked, in display order
    let selectedIndex = 0;

    // --- overlay scaffolding (created once) ---
    const overlay = element(doc, 'div', '', 'command-palette-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Command palette');
    overlay.setAttribute('aria-modal', 'true');
    overlay.hidden = true;

    const dialog = element(doc, 'div', '', 'command-palette');
    dialog.setAttribute('role', 'combobox');
    dialog.setAttribute('aria-expanded', 'true');
    dialog.setAttribute('aria-haspopup', 'listbox');

    const input = element(doc, 'input', '', 'command-palette__input');
    input.type = 'text';
    input.setAttribute('aria-label', 'Filter commands (type to search, Arrow keys or j/k to move, Enter to run, Escape to close)');
    input.setAttribute('aria-controls', 'command-palette-list');
    input.setAttribute('aria-autocomplete', 'list');
    input.placeholder = 'Type a command…  (switch agent, session, connection, re-run, open folder, copy diff, export)';

    const list = element(doc, 'ul', '', 'command-palette__list');
    list.id = 'command-palette-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Commands');

    const status = element(doc, 'p', '', 'command-palette__status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');

    dialog.append(input, list, status);
    overlay.append(dialog);
    mount.append(overlay);

    function renderStatus() {
      if (visible.length === 0) {
        status.textContent = query.trim() ? 'No matching commands' : 'No commands available';
      } else {
        const current = visible[selectedIndex] || visible[0];
        status.textContent = `${selectedIndex + 1} of ${visible.length}: ${current.title} — ${current.detail}`;
      }
    }

    function renderList() {
      if (typeof list.replaceChildren === 'function') list.replaceChildren();
      else { while (list.firstChild) list.removeChild(list.firstChild); }
      visible.forEach((command, index) => {
        const item = element(doc, 'li', '', 'command-palette__item');
        item.setAttribute('role', 'option');
        item.dataset.commandId = command.id;
        item.setAttribute('aria-selected', index === selectedIndex ? 'true' : 'false');
        if (index === selectedIndex) item.classList.add('is-selected');
        const title = element(doc, 'span', command.title, 'command-palette__item-title');
        const detail = element(doc, 'span', command.detail, 'command-palette__item-detail');
        item.append(title, detail);
        item.addEventListener('mousemove', () => { if (selectedIndex !== index) { selectedIndex = index; renderList(); } });
        item.addEventListener('click', () => execute(command));
        list.append(item);
      });
      renderStatus();
    }

    function refresh() {
      visible = model.filterCommands(commands, query);
      if (selectedIndex >= visible.length) selectedIndex = 0;
      if (visible.length === 0) selectedIndex = -1;
      renderList();
    }

    function open(nextSnapshot) {
      snapshot = nextSnapshot || snapshot;
      commands = model.buildCommands(snapshot);
      query = '';
      input.value = '';
      selectedIndex = 0;
      visible = model.filterCommands(commands, query);
      refresh();
      isOpen = true;
      overlay.hidden = false;
      input.focus();
    }

    function close() {
      isOpen = false;
      overlay.hidden = true;
      query = '';
      input.value = '';
      input.blur?.();
    }

    function toggle(nextSnapshot) {
      if (isOpen) close();
      else open(nextSnapshot);
      return isOpen;
    }

    function execute(command) {
      if (!command) return;
      try {
        options.onExecute(command);
      } finally {
        close();
      }
    }

    function onKeydown(event) {
      if (!isOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'ArrowDown' || event.key === 'j') {
        if (visible.length > 0) {
          selectedIndex = model.moveSelection(visible, selectedIndex, 1);
          renderList();
        }
        event.preventDefault();
      } else if (event.key === 'ArrowUp' || event.key === 'k') {
        if (visible.length > 0) {
          selectedIndex = model.moveSelection(visible, selectedIndex, -1);
          renderList();
        }
        event.preventDefault();
      } else if (event.key === 'Enter') {
        const current = visible[selectedIndex] || visible[0] || null;
        execute(current);
        event.preventDefault();
      }
    }

    input.addEventListener('input', () => {
      query = input.value || '';
      selectedIndex = 0;
      refresh();
    });
    // A single document-level handler makes global Ctrl+K unnecessary here; app.js wires
    // the Ctrl+K opener and routes other keys to this handler only while open.
    doc.addEventListener('keydown', onKeydown);

    return Object.freeze({
      open,
      close,
      toggle,
      isOpen: () => isOpen,
      // Test/inspection helpers (not used by the live app):
      _getVisible: () => visible.slice(),
      _getSelectedIndex: () => selectedIndex,
      _getQuery: () => query,
    });
  }

  const api = Object.freeze({ createCommandPalette });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.claudePetCommandPalette = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
