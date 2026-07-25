'use strict';
const status = document.querySelector('#status'); const list = document.querySelector('#connections'); const workspace = document.querySelector('#workspace'); const executor = document.querySelector('#executor'); const model = document.querySelector('#model'); const effort = document.querySelector('#effort');
function text(node, value){node.textContent=value;}
function renderExecutor(){const codex=executor.value==='codex-cli';document.querySelector('#model-row').hidden=!codex;document.querySelector('#effort-row').hidden=!codex;document.querySelector('#setup').hidden=!codex;}
function draft(){const codex=executor.value==='codex-cli';return {executorType:executor.value,label:codex?'Codex Workspace':'Offline Demo',workspacePath:workspace.value.trim(),permissionProfile:'workspace',modelId:codex?model.value:'offline-demo',effort:codex?effort.value:null,keyHint:null};}
async function refresh(){const snapshot=await window.settings.snapshot(); list.replaceChildren(...snapshot.connections.map((connection)=>{const item=document.createElement('li'); text(item,`${connection.label} â€” ${connection.workspacePath} (Workspace)`); return item;}));}
executor.addEventListener('change',renderExecutor);renderExecutor();
document.querySelector('#save').addEventListener('click',async()=>{try{await window.settings.save(draft());text(status,'Saved Workspace connection.');await refresh();}catch{ text(status,'Choose a valid workspace, model, and effort.');}});
document.querySelector('#test').addEventListener('click',async()=>{try{text(status,window.settingsStatus.formatTestStatus(await window.settings.test()));}catch{text(status,'Select a saved connection first.');}});
document.querySelector('#setup').addEventListener('click',async()=>{try{await window.settings.setup();text(status,'Codex sign-in started in its own window.');}catch{text(status,'Codex sign-in could not start.');}}); void refresh();
