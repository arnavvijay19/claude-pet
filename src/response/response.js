'use strict';

const summary = document.querySelector('#summary');
const phase = document.querySelector('#phase');
const executor = document.querySelector('#executor');
const model = document.querySelector('#model');
const workspace = document.querySelector('#workspace');
const permission = document.querySelector('#permission');
const elapsed = document.querySelector('#elapsed');
const events = document.querySelector('#events');
const stop = document.querySelector('#stop');

function render(state) {
  const view = window.responseViewModel.createResponseViewModel(state);
  summary.textContent = view.summary;
  phase.textContent = view.phase;
  executor.textContent = view.executor;
  model.textContent = view.model;
  workspace.textContent = view.workspace;
  permission.textContent = view.permissionBadge;
  elapsed.textContent = view.elapsed;
  stop.disabled = !view.canStop;
  events.hidden = view.activityView !== 'comprehensive';
  events.replaceChildren(...view.events.map((event) => {
    const item = document.createElement('li');
    item.textContent = `${event.phase}: ${event.summary}`;
    return item;
  }));
}

window.response.onState(render);
window.response.onActivity(render);
void window.response.state().then(render);
setInterval(() => { void window.response.state().then(render); }, 1000);
stop.addEventListener('click', () => window.response.stop());
document.querySelector('#settings').addEventListener('click', () => window.response.openSettings());
document.querySelector('#simple').addEventListener('click', () => window.response.setActivityView('simple'));
document.querySelector('#comprehensive').addEventListener('click', () => window.response.setActivityView('comprehensive'));
