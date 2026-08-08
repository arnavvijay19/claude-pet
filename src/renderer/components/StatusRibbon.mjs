// StatusRibbon — the single morphing status surface for the Phase 3 main window.
//
// Per the design (3.2) the ribbon is the only status element: it absorbs the
// connection chip, the Full Computer chip, the hidden connection feedback line,
// and the Stop / Activity controls. It always shows the current truth and, when
// one exists, exactly one obvious next action: Check now, Sign in to Codex,
// Cancel, or Stop.
//
// The module is split in two so the state-to-props mapping is unit-testable
// without a DOM:
//   - deriveRibbonProps(input)  pure function, returns the props to render
//   - StatusRibbon(props)       presentational Preact+htm component
//   - mountStatusRibbon(el, props) mounts into a host element (test/renderer glue)
//
// Imports resolve through the vendored copies under ../vendor so the package
// needs no bare-specifier ESM resolution under file://.

import { h, render } from '../vendor/preact.mjs';
import htm from '../vendor/htm.mjs';
import { color, stateTone } from '../designTokens.mjs';

const html = htm.bind(h);

export const RIBBON_KINDS = Object.freeze({
  IDLE: 'idle',
  READY: 'ready',
  VERIFYING: 'verifying',
  RUNNING: 'running',
  SIGN_IN_REQUIRED: 'sign-in-required',
  BLOCKED: 'blocked',
});

export const RIBBON_ACTIONS = Object.freeze({
  CHECK: 'Check now',
  SIGN_IN: 'Sign in to Codex',
  CANCEL: 'Cancel',
  STOP: 'Stop',
});

export const RIBBON_ACTION_TYPES = Object.freeze({
  CHECK: 'check',
  SIGN_IN: 'signin',
  CANCEL: 'cancel',
  STOP: 'stop',
});

// Maps a normalized view of run + connection state to exactly the props the
// ribbon renders. Priority is: an in-flight run wins over a stale connection
// problem, a required sign-in beats a generic block, and a terminal block beats
// a neutral ready state. Returns an immutable object; `primaryAction` is null
// when there is nothing actionable (a calm "Ready").
export function deriveRibbonProps(input = {}) {
  const run = input.run || {};
  const connection = input.connection || null;
  const busy = run.busy === true;

  if (busy && run.phase === 'verifying') {
    return {
      kind: RIBBON_KINDS.VERIFYING,
      tone: stateTone.verifying,
      label: 'Verifying Codex connection…',
      detail: 'First identity check runs once per exact identity.',
      primaryAction: RIBBON_ACTIONS.CANCEL,
      primaryType: RIBBON_ACTION_TYPES.CANCEL,
    };
  }
  if (busy && run.phase === 'running') {
    return {
      kind: RIBBON_KINDS.RUNNING,
      tone: stateTone.running,
      label: 'Running agent',
      detail: null,
      primaryAction: RIBBON_ACTIONS.STOP,
      primaryType: RIBBON_ACTION_TYPES.STOP,
    };
  }
  if (connection && connection.state === RIBBON_KINDS.SIGN_IN_REQUIRED) {
    return {
      kind: RIBBON_KINDS.SIGN_IN_REQUIRED,
      tone: stateTone['sign-in-required'],
      label: connection.oneTime ? 'One-time Codex identity check required' : 'Codex sign-in required',
      detail: connection.oneTime
        ? 'Official sign-in is provider-owned and runs once per identity revision.'
        : 'Official sign-in is provider-owned; Claude Pet never reads credentials.',
      primaryAction: RIBBON_ACTIONS.SIGN_IN,
      primaryType: RIBBON_ACTION_TYPES.SIGN_IN,
    };
  }
  if (connection && (connection.state === RIBBON_KINDS.BLOCKED || connection.failureMessage)) {
    return {
      kind: RIBBON_KINDS.BLOCKED,
      tone: stateTone.blocked,
      label: connection.failureMessage || 'Connection blocked',
      detail: null,
      primaryAction: RIBBON_ACTIONS.CHECK,
      primaryType: RIBBON_ACTION_TYPES.CHECK,
    };
  }
  if (connection && connection.state === RIBBON_KINDS.VERIFYING) {
    return {
      kind: RIBBON_KINDS.VERIFYING,
      tone: stateTone.verifying,
      label: 'Verifying Codex connection…',
      detail: null,
      primaryAction: RIBBON_ACTIONS.CANCEL,
      primaryType: RIBBON_ACTION_TYPES.CANCEL,
    };
  }
  if (connection && connection.state === 'not-checked') {
    return {
      kind: RIBBON_KINDS.IDLE,
      tone: stateTone.idle,
      label: 'Codex connection not checked yet',
      detail: null,
      primaryAction: RIBBON_ACTIONS.CHECK,
      primaryType: RIBBON_ACTION_TYPES.CHECK,
    };
  }
  return {
    kind: RIBBON_KINDS.READY,
    tone: stateTone.ready,
    label: 'Ready',
    detail: null,
    primaryAction: null,
    primaryType: null,
  };
}

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
