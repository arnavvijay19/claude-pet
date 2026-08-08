// StatusRibbon — the Preact+htm presentational ribbon for the Phase 3 main window.
//
// Per the design (3.2) the ribbon is the single morphing status surface: it absorbs the
// connection chip, the Full Computer chip, the hidden connection feedback line, and the
// Stop / Activity controls. It always shows the current truth and, when one exists, exactly
// one obvious next action: Check now, Sign in to Codex, Cancel, or Stop.
//
// The pure state-to-props mapping (deriveRibbonProps) and the connection/snapshot mapping
// live in ./ribbonModel.js so the live vanilla-DOM renderer and this component share one
// source of truth. This module is the component library + jsdom test surface; it re-exports
// the model so existing tests keep importing deriveRibbonProps from here unchanged.
//
// Imports resolve through the vendored copies under ../vendor so the package needs no
// bare-specifier ESM resolution under file:// in the asar=false build.

import { h, render } from '../vendor/preact.mjs';
import htm from '../vendor/htm.mjs';
import { color } from '../designTokens.mjs';
// ribbonModel.js is a dual-mode CJS module (it also loads as a classic <script> in the
// live renderer); it assigns `module.exports = ribbonModel` as one frozen object, so Node's
// CJS lexer cannot surface its members as named ESM exports. Import the whole object via the
// default export and destructure — this is the documented workaround for CJS named-import gaps.
import ribbonModel from './ribbonModel.js';
const { deriveRibbonProps, RIBBON_KINDS, RIBBON_ACTIONS, RIBBON_ACTION_TYPES } = ribbonModel;

export {
  deriveRibbonProps,
  RIBBON_KINDS,
  RIBBON_ACTIONS,
  RIBBON_ACTION_TYPES,
};

const html = htm.bind(h);

// Renders a Preact+htm ribbon. `primaryAction` is null when there is nothing actionable.
export function StatusRibbon(props = {}) {
  const {
    label = '',
    detail = null,
    primaryAction = null,
    primaryType = null,
    tone = 'muted',
    onPrimaryAction = null,
  } = props;
  return html`
    <div class="status-ribbon" data-tone=${tone} role="status" aria-live="polite">
      <span class="status-ribbon__dot" data-tone=${tone} aria-hidden="true"></span>
      <span class="status-ribbon__label">${label}</span>
      ${detail ? html`<span class="status-ribbon__detail">${detail}</span>` : null}
      ${primaryAction
        ? html`<button
            class=${`status-ribbon__action status-ribbon__action--${primaryType || 'default'}`}
            type="button"
            data-action-type=${primaryType || 'default'}
            onClick=${typeof onPrimaryAction === 'function' ? onPrimaryAction : null}
          >${primaryAction}</button>`
        : null}
    </div>
  `;
}

export function mountStatusRibbon(container, props) {
  if (!container) throw new TypeError('StatusRibbon requires a host element');
  render(html`<${StatusRibbon} ...${props} />`, container);
  return container;
}

// Keep an intentional reference so tree-shaking never drops the shared token
// table this component is built around; also handy for stylesheets that read
// the same palette.
export const ribbonPalette = color;

export default StatusRibbon;
