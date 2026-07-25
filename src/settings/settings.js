'use strict';
const status = document.querySelector('#status'); const list = document.querySelector('#connections'); const workspace = document.querySelector('#workspace');
function text(node, value){node.textContent=value;}
async function refresh(){const snapshot=await window.settings.snapshot(); list.replaceChildren(...snapshot.connections.map((connection)=>{const item=document.createElement('li'); text(item,`${connection.label} — ${connection.workspacePath} (Workspace)`); return item;}));}
document.querySelector('#save').addEventListener('click',async()=>{try{await window.settings.save({executorType:'offline-demo',label:'Offline Demo',workspacePath:workspace.value.trim(),permissionProfile:'workspace',modelId:'offline-demo',effort:null,keyHint:null});text(status,'Saved built-in offline agent.');await refresh();}catch{ text(status,'Choose a workspace before saving.');}});
document.querySelector('#test').addEventListener('click',async()=>{try{await window.settings.test();text(status,'Offline Demo is ready.');}catch{text(status,'Select a saved connection first.');}}); void refresh();
