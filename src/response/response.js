'use strict';

const summary = document.querySelector('#summary');
const phase = document.querySelector('#phase');
const executor = document.querySelector('#executor');
const model = document.querySelector('#model');
const workspace = document.querySelector('#workspace');
const agent = document.querySelector('#agent');
const session = document.querySelector('#session');
const turns = document.querySelector('#turns');
const permissionHeader = document.querySelector('#permission-header');
const permissionSimple = document.querySelector('#permission-simple');
const permissionComprehensive = document.querySelector('#permission-comprehensive');
const elapsed = document.querySelector('#elapsed');
const events = document.querySelector('#events');
const changed = document.querySelector('#changed');
const stop = document.querySelector('#stop');
const dismiss = document.querySelector('#dismiss');
let currentDismiss = null;

function render(state) {
  const view = window.responseViewModel.createResponseViewModel(state);
  summary.textContent = view.summary;
  phase.textContent = view.phase;
  executor.textContent = view.executor;
  model.textContent = view.model;
  workspace.textContent = view.workspace;
  agent.textContent = view.agent;
  session.textContent = view.session;
  for (const badge of [permissionHeader, permissionSimple, permissionComprehensive]) {
    badge.textContent = view.permissionBadge;
    badge.classList.toggle('warning', view.permissionWarning);
  }
  elapsed.textContent = view.elapsed;
  stop.disabled = !view.canStop;
  dismiss.hidden = !view.canDismiss;
  dismiss.disabled = !view.canDismiss;
  currentDismiss = view.dismiss;
  document.querySelector('#simple-panel').hidden = view.activityView === 'comprehensive';
  document.querySelector('#comprehensive-panel').hidden = view.activityView !== 'comprehensive';
  changed.textContent = view.changedFiles.length ? `Changed: ${view.changedFiles.join(', ')}` : '';
  turns.replaceChildren(...view.turns.map((turn) => { const item = document.createElement('li'); item.textContent = turn.role === 'assistant' ? `${turn.provider} / ${turn.model}: ${turn.text}` : `You: ${turn.text}`; return item; }));
  events.replaceChildren(...view.events.map((event) => {
    const item = document.createElement('li');
    const row = document.createElement('details');
    const title = document.createElement('summary');
    const timestamp = Number.isFinite(event.timestamp) ? new Date(event.timestamp).toLocaleTimeString() : 'now';
    title.textContent = `${timestamp} ${event.phase}: ${event.summary}`;
    const detail = document.createElement('p');
    detail.textContent = event.detail || event.status || event.kind;
    row.append(title, detail); item.append(row);
    return item;
  }));
}

window.response.onState(render);
window.response.onActivity(render);
void window.response.state().then(render);
setInterval(() => { void window.response.state().then(render); }, 1000);
stop.addEventListener('click', () => window.response.stop());
dismiss.addEventListener('click', () => { if (currentDismiss) window.response.dismiss(currentDismiss); });
document.querySelector('#settings').addEventListener('click', () => window.response.openSettings());
document.querySelector('#simple').addEventListener('click', () => window.response.setActivityView('simple'));
document.querySelector('#comprehensive').addEventListener('click', () => window.response.setActivityView('comprehensive'));
