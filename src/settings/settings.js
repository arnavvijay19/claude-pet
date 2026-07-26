'use strict';
const status = document.querySelector('#status'); const list = document.querySelector('#connections'); const workspace = document.querySelector('#workspace'); const executor = document.querySelector('#executor'); const model = document.querySelector('#model'); const effort = document.querySelector('#effort');
const registries={
  'codex-cli':{label:'Codex Workspace',models:['gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna'],efforts:['none','low','medium','high','xhigh','max'],defaultModel:'gpt-5.6-terra',defaultEffort:'medium',setup:'Codex'},
  'claude-code-cli':{label:'Claude Code Workspace',models:['fable','opus','sonnet'],efforts:['low','medium','high','xhigh','max'],defaultModel:'sonnet',defaultEffort:'high',setup:'Claude Code'},
};
function text(node, value){node.textContent=value;}
function options(node,values,selected){node.replaceChildren(...values.map(value=>{const option=document.createElement('option');option.value=value;option.textContent=value;option.selected=value===selected;return option;}));}
function renderExecutor(){const registry=registries[executor.value];document.querySelector('#model-row').hidden=!registry;document.querySelector('#effort-row').hidden=!registry;document.querySelector('#setup').hidden=!registry;if(registry){options(model,registry.models,registry.defaultModel);options(effort,registry.efforts,registry.defaultEffort);document.querySelector('#setup').textContent=`Sign in to ${registry.setup}`;}}
function draft(){const registry=registries[executor.value];return {executorType:executor.value,label:registry?registry.label:'Offline Demo',workspacePath:workspace.value.trim(),permissionProfile:'workspace',modelId:registry?model.value:'offline-demo',effort:registry?effort.value:null,keyHint:null};}
async function refresh(){const snapshot=await window.settings.snapshot(); list.replaceChildren(...snapshot.connections.map((connection)=>{const item=document.createElement('li'); text(item,`${connection.label} - ${connection.workspacePath} (Workspace)`); return item;}));}
executor.addEventListener('change',renderExecutor);renderExecutor();
document.querySelector('#save').addEventListener('click',async()=>{try{await window.settings.save(draft());text(status,'Saved Workspace connection.');await refresh();}catch{ text(status,'Choose a valid workspace, model, and effort.');}});
document.querySelector('#test').addEventListener('click',async()=>{try{text(status,window.settingsStatus.formatTestStatus(await window.settings.test()));}catch{text(status,'Select a saved connection first.');}});
document.querySelector('#setup').addEventListener('click',async()=>{const registry=registries[executor.value];try{await window.settings.setup();text(status,`${registry.setup} sign-in started in its own window.`);}catch{text(status,`${registry.setup} sign-in could not start.`);}}); void refresh();
