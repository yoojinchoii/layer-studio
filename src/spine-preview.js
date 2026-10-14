import {zipSync,strToU8} from 'fflate';
import {encodePNG} from './spine-export.js';
const BRIDGE='http://127.0.0.1:19464';
const HEADERS={'X-Layer-Studio':'spine-preview-v1'};

// Package exactly the current edit; never trigger AI cleanup, inference or inpainting here.
export function makePreviewArchive({name,skeleton,parts,projectId}){
  const files={
    'preview.json':strToU8(JSON.stringify({format:'layer-studio-spine-preview-v1',name:String(name||'character').slice(0,80),...(projectId?{projectId}:{})})),
    'skeleton.json':strToU8(JSON.stringify(skeleton))
  };
  for(const p of parts){
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(p.slot)||files[`images/${p.slot}.png`])throw Error('파츠 이름이 올바르지 않거나 중복됩니다.');
    files[`images/${p.slot}.png`]=encodePNG(p.data,p.width,p.height);
  }
  const bytes=zipSync(files,{level:1});
  if(bytes.length>60*1024*1024)throw Error('전송 파일이 60MB를 넘어요. 파츠 크기를 줄여주세요.');
  return bytes;
}

export function installSpinePreview({snapshot,canSend,download}){
  const $=id=>document.getElementById(id);
  let sending=false,job=null,timer=null,revision=0,savedRevision=-1,liveReady=false;
  const say=text=>$('spineBridgeStatus').textContent=text;
  const unavailable='직접 연결을 사용할 수 없어요. Mac 연결 프로그램을 실행했다면 ‘Spine에서 확인’을 눌러 다운로드 방식으로 전송할 수 있어요.';
  async function request(path,options={}){
    let response;
    try{response=await fetch(BRIDGE+path,{...options,headers:{...HEADERS,...options.headers},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(options.method==='POST'?30000:5000)});}
    catch{throw Object.assign(Error(unavailable),{localConnectionFailed:true});}
    const data=await response.json();
    if(!response.ok)throw Error(data.message||`연결 프로그램 응답 오류 (${response.status})`);
    return data;
  }
  async function health(){
    const data=await request('/health');
    if(data.service!=='layer-studio-spine-bridge'||![1,2].includes(data.version))throw Error('지원되지 않는 Spine 연결 프로그램입니다. 최신 연결 프로그램을 실행해주세요.');
    if(!data.spineFound)throw Error('이 컴퓨터의 /Applications/Spine.app을 찾지 못했어요.');
    liveReady=data.liveSync===true;return data;
  }
  function update(){ $('rigSpinePreview').disabled=sending||!canSend();$('spineBridgeCheck').disabled=sending; }
  async function waitForJob(){
    const deadline=Date.now()+180000;
    while(Date.now()<deadline){
      const result=await request('/jobs/'+job);
      if(result.status==='failed'){job=null;throw Error(result.message);}
      if(result.status==='done'){
        job=null;
        if(result.synced&&!result.opened){say('로컬 폴더 저장 완료. 이미지 수정은 연결된 Spine에 반영됩니다. 관절·메쉬·가중치를 바꿨으면 ‘Spine에서 확인’을 눌러 다시 열어주세요.');$('spinePreviewPath').textContent=result.json||result.project;return result;}
        say(result.opened?`Spine으로 열기 요청을 보냈어요 · 파츠 ${result.parts}개, 뼈대 ${result.bones}개. Spine의 저장 안내가 떠 있으면 먼저 처리해주세요. 포즈는 manual_pose에서 확인하세요.`:'Spine 파일을 만들었지만 자동 열기에 실패했어요. 연결 프로그램의 Previews 폴더에서 preview.spine을 열어주세요.');
        $('spinePreviewPath').textContent=result.project;
        return result;
      }
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw Error('변환 결과를 아직 받지 못했어요. ‘연결 확인’을 누르면 같은 작업의 결과를 다시 확인합니다.');
  }
  async function submit(path,body,type='application/zip'){
    const result=await request(path,{method:'POST',headers:{'Content-Type':type},body});
    if(!/^[a-f0-9]{32}$/.test(result.job_id||''))throw Error('Spine 작업 번호가 올바르지 않습니다.');
    job=result.job_id;return waitForJob();
  }
  async function sync(){
    if(!$('spineAutoSync').checked||!canSend())return;
    if(sending){timer=setTimeout(sync,1200);return;}
    sending=true;update();const current=revision;
    try{const info=await health();if(!info.liveSync)throw Error('연결 프로그램 v2를 실행해주세요.');if(info.busy)throw Error('이전 변환이 진행 중이에요. 잠시 뒤 다시 켜주세요.');
      if(job)await waitForJob();
      await submit('/sync',makePreviewArchive(snapshot()));savedRevision=current;
    }catch(e){$('spineAutoSync').checked=false;say(e.localConnectionFailed?'브라우저가 직접 연결을 막고 있어요. 연결 프로그램 v2를 실행하고 ‘직접 연결 작업실 열기’에서 저장한 편집 프로젝트를 불러오세요. 자동 저장은 ZIP 다운로드를 반복하지 않습니다.':e.message);}
    finally{sending=false;update();if($('spineAutoSync').checked&&revision!==savedRevision)timer=setTimeout(sync,1200);}
  }
  const changed=()=>{revision++;clearTimeout(timer);if($('spineAutoSync').checked)timer=setTimeout(sync,1200);};
  $('spineAutoSync').onchange=()=>{clearTimeout(timer);if($('spineAutoSync').checked){savedRevision=-1;sync();}else say('자동 저장을 껐어요. Spine에서 마무리한 작업은 별도 파일로 저장하세요.');};
  $('spineBridgeCheck').onclick=async()=>{
    sending=true;update();say(job?'진행 중인 Spine 변환 결과를 확인하는 중…':'이 컴퓨터의 Spine 연결을 확인하는 중…');
    try{await health();if(job)await waitForJob();else say(liveReady?'직접 연결 준비 완료. 자동 저장을 켜면 같은 폴더에 갱신합니다. 관절·가중치 변경 후에는 Spine에서 확인을 누르세요.':'연결 프로그램 v2로 업데이트하면 자동 저장을 사용할 수 있어요.');}
    catch(e){say(e.message);}finally{sending=false;update();}
  };
  $('rigSpinePreview').onclick=async()=>{
    if(sending||!canSend())return;
    sending=true;update();say('Spine 연결을 확인하는 중…');
    try{
      let info;
      try{info=await health();}
      catch(e){
        if(!e.localConnectionFailed||job)throw e;
        const archive=makePreviewArchive(snapshot());
        download(new Blob([archive],{type:'application/zip'}),'LayerStudio-Preview-'+crypto.randomUUID()+'.zip');
        say('직접 연결이 안 되어 확인용 파일 다운로드를 요청했어요. Mac 연결 프로그램이 실행 중이면 다운로드 폴더에서 자동으로 받아 Spine을 엽니다. 파일 저장 위치는 ‘다운로드’를 선택해주세요.');
        $('spinePreviewPath').textContent='진행 결과는 연결 프로그램 창에서 확인할 수 있어요. 프로그램이 꺼져 있다면 실행 후 다시 눌러주세요.';
        return;
      }
      if(job){say('이전 전송 결과를 먼저 확인하는 중…');await waitForJob();return;}
      if(info.busy)throw Error('이전 Spine 변환이 끝난 뒤 다시 눌러주세요.');
      if(info.liveSync){const shot=snapshot();say('같은 연결 폴더에 저장하고 Spine 파일을 갱신하는 중…');await submit('/sync',makePreviewArchive(shot));const applied=await submit('/open-live',JSON.stringify({projectId:shot.projectId}),'application/json');if(!applied.opened){say('Spine 파일은 갱신됐지만 열기에 실패했어요. 아래 경로의 preview.spine을 열어주세요.');return;}say('같은 preview.spine 파일을 갱신하고 열기 요청을 보냈어요. 이미 열려 있으면 저장 안내를 처리한 뒤 해당 파일을 다시 여세요. 포즈는 manual_pose에서 확인하세요.');return;}
      say('현재 파츠·관절·포즈를 Spine으로 보내는 중…');
      const archive=makePreviewArchive(snapshot());
      const result=await request('/preview',{method:'POST',headers:{'Content-Type':'application/zip'},body:archive});
      if(!/^[a-f0-9]{32}$/.test(result.job_id||''))throw Error('Spine 작업 번호가 올바르지 않습니다.');
      job=result.job_id;say('Spine 프로젝트로 변환하는 중… 잠시 기다려주세요.');
      await waitForJob();
    }catch(e){say(e.message+(job?' 전송된 작업은 계속 진행될 수 있어요. ‘연결 확인’으로 결과를 확인해주세요.':''));}
    finally{sending=false;update();}
  };
  update();return {update,changed};
}
