import {zipSync,strToU8} from 'fflate';
import {encodePNG} from './spine-export.js';
const BRIDGE='http://127.0.0.1:19464';
const HEADERS={'X-Layer-Studio':'spine-preview-v1'};

// Package exactly the current edit; never trigger AI cleanup, inference or inpainting here.
export function makePreviewArchive({name,skeleton,parts}){
  const files={
    'preview.json':strToU8(JSON.stringify({format:'layer-studio-spine-preview-v1',name:String(name||'character').slice(0,80)})),
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
  let sending=false,job=null;
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
    if(data.service!=='layer-studio-spine-bridge'||data.version!==1)throw Error('지원되지 않는 Spine 연결 프로그램입니다. 최신 연결 프로그램을 실행해주세요.');
    if(!data.spineFound)throw Error('이 컴퓨터의 /Applications/Spine.app을 찾지 못했어요.');
    return data;
  }
  function update(){ $('rigSpinePreview').disabled=sending||!canSend();$('spineBridgeCheck').disabled=sending; }
  async function waitForJob(){
    const deadline=Date.now()+180000;
    while(Date.now()<deadline){
      const result=await request('/jobs/'+job);
      if(result.status==='failed'){job=null;throw Error(result.message);}
      if(result.status==='done'){
        job=null;
        say(result.opened?`Spine으로 열기 요청을 보냈어요 · 파츠 ${result.parts}개, 뼈대 ${result.bones}개. Spine의 저장 안내가 떠 있으면 먼저 처리해주세요. 포즈는 manual_pose에서 확인하세요.`:'Spine 파일을 만들었지만 자동 열기에 실패했어요. 연결 프로그램의 Previews 폴더에서 preview.spine을 열어주세요.');
        $('spinePreviewPath').textContent=result.project;
        return;
      }
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw Error('변환 결과를 아직 받지 못했어요. ‘연결 확인’을 누르면 같은 작업의 결과를 다시 확인합니다.');
  }
  $('spineBridgeCheck').onclick=async()=>{
    sending=true;update();say(job?'진행 중인 Spine 변환 결과를 확인하는 중…':'이 컴퓨터의 Spine 연결을 확인하는 중…');
    try{await health();if(job)await waitForJob();else say('Spine 연결 준비 완료. 수정 후 ‘Spine에서 확인’을 누르세요.');}
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
      say('현재 파츠·관절·포즈를 Spine으로 보내는 중…');
      const archive=makePreviewArchive(snapshot());
      const result=await request('/preview',{method:'POST',headers:{'Content-Type':'application/zip'},body:archive});
      if(!/^[a-f0-9]{32}$/.test(result.job_id||''))throw Error('Spine 작업 번호가 올바르지 않습니다.');
      job=result.job_id;say('Spine 프로젝트로 변환하는 중… 잠시 기다려주세요.');
      await waitForJob();
    }catch(e){say(e.message+(job?' 전송된 작업은 계속 진행될 수 있어요. ‘연결 확인’으로 결과를 확인해주세요.':''));}
    finally{sending=false;update();}
  };
  update();return {update};
}
