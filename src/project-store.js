// Local-only recovery; credentials and server settings are never included.
const DB='layer-studio-projects',STORE='projects';let opened;
function database(){return opened??=new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore(STORE,{keyPath:'id'});req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();opened=null;};resolve(db);};req.onerror=()=>{opened=null;reject(req.error);};});}
export async function saveProject(record){
  const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);store.put(record);const all=store.getAll();all.onsuccess=()=>{const sorted=all.result.sort((a,b)=>b.updatedAt-a.updatedAt);for(const old of sorted.slice(5))store.delete(old.id);};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('저장을 완료하지 못했어요.'));});
}
export async function listProjects(){const db=await database();return new Promise((resolve,reject)=>{const req=db.transaction(STORE).objectStore(STORE).getAll();req.onsuccess=()=>resolve(req.result.sort((a,b)=>b.updatedAt-a.updatedAt));req.onerror=()=>reject(req.error);});}
// Serialize writes so an older, slower save can never replace a newer edit.
export function createSaveQueue(write){let queue=Promise.resolve();return record=>{const next=queue.catch(()=>{}).then(()=>write(record));queue=next;return next;};}
export function installRecovery({capture,restore,isBusy,notify}){
  const $=id=>document.getElementById(id),write=createSaveQueue(saveProject);let timer,records=[],restoring=false,pending=false,revision=0;
  async function refresh(){records=await listProjects();const selected=$('recoveryList').value;$('recoveryList').replaceChildren(...records.map(r=>new Option(`${r.name} · ${new Date(r.updatedAt).toLocaleString('ko-KR')} · ${r.snapshot.layers.length}파츠`,r.id)));if(records.some(r=>r.id===selected))$('recoveryList').value=selected;$('restoreProject').disabled=!records.length;}
  async function flush(force=false){clearTimeout(timer);if(restoring)return;if(isBusy()&&!force){timer=setTimeout(flush,1000);return;}try{const savedRevision=revision,record=capture();if(!record){pending=false;return;}pending=true;$('recoveryStatus').textContent='이 브라우저에 저장 중…';await write(structuredClone(record));pending=revision!==savedRevision;$('recoveryStatus').textContent=pending?'새 변경 사항 저장 대기 중…':`자동 저장됨 · ${new Date(record.updatedAt).toLocaleTimeString('ko-KR')}`;await refresh();}catch(e){pending=false;$('recoveryStatus').textContent='자동 저장 실패 · PSD 또는 편집 프로젝트를 파일로 저장해주세요.';}}
  const changed=()=>{if(restoring)return;revision++;pending=true;clearTimeout(timer);timer=setTimeout(flush,900);$('recoveryStatus').textContent='변경 사항 저장 대기 중…';};
  $('restoreProject').onclick=async()=>{if(isBusy())return;try{await flush();const record=records.find(r=>r.id===$('recoveryList').value);if(!record)return;restoring=true;await restore(structuredClone(record));notify('저장된 작업을 복원했어요. AI 재분리는 실행하지 않았습니다.');}catch(e){notify(`복원 실패: ${e.message}`);}finally{restoring=false;}};
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&pending)flush();});
  window.addEventListener('beforeunload',e=>{if(pending){e.preventDefault();e.returnValue='';}});
  refresh().catch(()=>{$('recoveryStatus').textContent='이 브라우저에서 자동 저장을 사용할 수 없어요. 파일로 저장해주세요.';});
  return {changed,flush};
}
