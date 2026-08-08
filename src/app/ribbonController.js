'use strict';

// Live main-window status ribbon controller (Phase 3 Task 2).
//
// The app window is a no-bundler Electron renderer loaded from file:// with
// contextIsolation on and no ESM module loader, so it cannot use the Preact+htm
// component here at runtime yet. This controller renders the EXACT same ribbon the
// component library draws, but with vanilla DOM built from document.createElement,
// driven by the framework-free model in ../renderer/components/ribbonModel.js. The
// two share deriveRibbonProps, so the live ribbon and the Preact component can never
// drift. When the app shell later gains an ESM loader (custom protocol), the live
// window can swap to the Preact StatusRibbon with zero logic change.
//
// This file is dual-mode: it loads as a classic <script> in the renderer (exposing
// globalThis.claudePetRibbon) and is also require()able in Node for jsdom tests.

(function exposeRibbon(root) {
  const model = (root && root.claudePetRibbonModel)
    || (typeof require !== 'undefined' ? require('../renderer/components/ribbonModel.js') : null);
  if (!model || typeof model.deriveRibbonProps !== 'function') {
    throw new Error('ribbonModel is required by the ribbon controller');
  }
  const { deriveRibbonProps, buildRibbonModel, RIBBON_ACTION_TYPES, RIBBON_ACTIONS, RIBBON_KINDS } = model;

  // Build the ribbon DOM from props and mount it into host, wiring the single action.
  function renderRibbon(host, props, onAction) {
    const doc = (typeof globalThis !== 'undefined' && globalThis.document) || null;
    if (!doc || !host) return;
    const tone = props.tone || 'muted';

    const ribbon = doc.createElement('div');
    ribbon.className = 'status-ribbon';
    ribbon.setAttribute('data-tone', tone);
    ribbon.setAttribute('role', 'status');
    ribbon.setAttribute('aria-live', 'polite');

    const dot = doc.createElement('span');
    dot.className = 'status-ribbon__dot';
    dot.setAttribute('data-tone', tone);
    dot.setAttribute('aria-hidden', 'true');

    const label = doc.createElement('span');
    label.className = 'status-ribbon__label';
    label.textContent = props.label || '';

    ribbon.append(dot, label);

    if (props.detail) {
      const detail = doc.createElement('span');
      detail.className = 'status-ribbon__detail';
      detail.textContent = props.detail;
      ribbon.append(detail);
    }

    if (props.primaryAction) {
      const button = doc.createElement('button');
      button.type = 'button';
      const primaryType = props.primaryType || 'default';
      button.className = `status-ribbon__action status-ribbon__action--${primaryType}`;
      button.setAttribute('data-action-type', primaryType);
      button.textContent = props.primaryAction;
      if (typeof onAction === 'function') button.addEventListener('click', onAction);
      ribbon.append(button);
    }

    if (typeof host.replaceChildren === 'function') host.replaceChildren(ribbon);
    else { while (host.firstChild) host.removeChild(host.firstChild); host.append(ribbon); }
  }

  // Bind a ribbon to a host element and an action provider. `update` re-derives the model
  // from a snapshot and re-renders; the action handler routes the ribbon's single primary
  // action to the matching app intent for the active connection.
  function createRibbonHost(host, options = {}) {
    if (!host) throw new TypeError('createRibbonHost requires a host element');
    const { getConnectionState = () => null, actions = {} } = options;
    let lastConnectionId = null;

    function update(snapshot) {
      if (!host) return;
      const model = buildRibbonModel(snapshot, getConnectionState);
      lastConnectionId = model.connectionId || null;
      const props = deriveRibbonProps(model);
      const onAction = () => {
        const type = props.primaryType;
        const id = lastConnectionId;
        if (type === RIBBON_ACTION_TYPES.CHECK) actions.check?.(id);
        else if (type === RIBBON_ACTION_TYPES.CANCEL) actions.cancel?.(id);
        else if (type === RIBBON_ACTION_TYPES.SIGN_IN) actions.signIn?.(id);
        else if (type === RIBBON_ACTION_TYPES.STOP) actions.stop?.();
      };
      renderRibbon(host, props, onAction);
    }

    return Object.freeze({ update });
  }

  const api = Object.freeze({
    createRibbonHost,
    renderRibbon,
    deriveRibbonProps,
    buildRibbonModel,
    RIBBON_ACTIONS,
    RIBBON_ACTION_TYPES,
    RIBBON_KINDS,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.claudePetRibbon = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
