import {DEFAULT_SERVER,validateConnection,readConnection,writeConnection,forgetConnection} from './connection-store.js';
export function installConnectionUI({state,updateRun,updateEngine,toast}){
  const $=id=>document.getElementById(id);let generation=0,pending=null,checking=false,retryTimer;
  const note=text=>$('connectionMessage').textContent=text;
  function update(){
    $('connectionBtn').querySelector('span').textContent=state.server?'서버 연결됨':checking?'서버 연결 중…':'서버 연결';
    $('saveConnection').disabled=state.busy||checking;$('connectionFileBtn').disabled=state.busy||checking;$('connectionFile').disabled=state.busy||checking;$('disconnectBtn').disabled=state.busy;
  }
  function forget(){try{forgetConnection(localStorage);return true;}catch{note('브라우저에서 저장 정보 삭제를 허용하지 않아요. 사이트 데이터를 지워주세요.');return false;}}
  async function connect({automatic=false,attempt=0,config:provided}={}){
    if(state.busy||checking)return;clearTimeout(retryTimer);
    let config;try{config=validateConnection(provided||{url:$('serverUrl').value,token:$('serverToken').value});}catch(e){note(e.message);return;}
    const ticket=++generation;pending=new AbortController();const requestController=pending;const timeout=setTimeout(()=>requestController.abort(),30000);checking=true;state.server=null;state.connectionHint=automatic?'저장된 서버에 자동 연결 중…':'서버 연결을 확인하는 중…';note(state.connectionHint);update();updateRun();
    try{
      const headers={};if(config.token)headers.Authorization=`Bearer ${config.token}`;
      const response=await fetch(config.url+'/health',{headers,signal:requestController.signal,redirect:'error',cache:'no-store'});
      if(ticket!==generation)return;
      if(response.status===401||response.status===403){forget();throw Error('접속 키가 만료되었거나 올바르지 않아요. 연결 파일을 다시 불러와주세요.');}
      if(!response.ok)throw Error(`서버 응답 오류 (${response.status})`);
      const info=await response.json();if(ticket!==generation)return;
      const supported=Array.from($('engine').options).filter(o=>Array.isArray(info.engines)&&info.engines.includes(o.value));
      if(info.service!=='layer-studio'||info.api_version!==1||!supported.length)throw Error('지원되는 Layer Studio 서버가 아닙니다.');
      state.server={...config,asyncJobs:info.async_jobs===true,rigAssist:info.rig_assist===true,artPipeline:info.art_pipeline===1};for(const option of $('engine').options)option.disabled=!info.engines.includes(option.value);
      if($('engine').selectedOptions[0]?.disabled){$('engine').value=supported[0].value;updateEngine();}
      let remembered=false;
      if($('rememberConnection').checked){try{writeConnection(localStorage,config);remembered=true;}catch{note('연결됐지만 브라우저 저장을 사용할 수 없어 이번 창에서만 유지돼요.');}}
      else forget();
      if(remembered)note('연결됐어요. 다음부터 이 브라우저에서 자동으로 연결합니다.');
      else if(!$('rememberConnection').checked)note('연결됐어요. 이번 창에서만 유지합니다.');
      state.connectionHint='';if(!automatic){toast(remembered?'연결 정보를 기억했어요. 다음부터 자동 연결됩니다.':'서버에 연결됐어요.');$('connectionDialog').close();}
    }catch(e){if(ticket!==generation)return;state.server=null;state.connectionHint='자동 연결 대기 · 서버 연결에서 다시 시도';if(automatic&&attempt<2&&(e instanceof TypeError||e.name==='AbortError')){state.connectionHint='서버에 다시 자동 연결하는 중…';retryTimer=setTimeout(()=>{if(ticket===generation&&!$('connectionDialog').open)connect({automatic:true,attempt:attempt+1,config});},1500*(attempt+1));}note(e.name==='AbortError'?'서버 응답을 기다리다 멈췄어요. 연결 확인을 눌러 다시 시도해주세요.':e.message==='Failed to fetch'?'서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.':e.message);}
    finally{clearTimeout(timeout);if(ticket===generation){checking=false;pending=null;update();updateRun();}}
  }
  $('serverUrl').value=DEFAULT_SERVER;
  $('connectionBtn').onclick=()=>{clearTimeout(retryTimer);$('connectionDialog').showModal();};$('saveConnection').onclick=()=>connect();
  $('disconnectBtn').onclick=()=>{if(state.busy)return;generation++;clearTimeout(retryTimer);pending?.abort();pending=null;checking=false;state.server=null;state.connectionHint='연결 정보 삭제됨 · 서버 연결에서 설정';const removed=forget();$('serverToken').value='';$('serverUrl').value=DEFAULT_SERVER;for(const option of $('engine').options)option.disabled=false;if(removed)note('연결과 저장한 접속 키를 모두 지웠어요.');update();updateRun();};
  $('rememberConnection').onchange=()=>{if(!$('rememberConnection').checked){clearTimeout(retryTimer);if(forget())note('저장된 접속 키를 지웠어요. 현재 연결은 이 창에서만 유지됩니다.');}else if(state.server){try{writeConnection(localStorage,state.server);note('다음부터 이 브라우저에서 자동 연결합니다.');}catch{note('이 브라우저에서는 연결 정보를 저장할 수 없어요.');}}};
  $('connectionFileBtn').onclick=()=>$('connectionFile').click();
  $('connectionFile').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>8192)throw Error('연결 파일이 너무 큽니다.');const config=validateConnection(JSON.parse(await file.text()));$('serverUrl').value=config.url;$('serverToken').value=config.token;await connect();}catch(err){note(err.message);}finally{e.target.value='';}};
  function restore(){try{const saved=readConnection(localStorage);if(saved){$('serverUrl').value=saved.url;$('serverToken').value=saved.token;$('rememberConnection').checked=true;connect({automatic:true});}}catch{note('브라우저 저장을 사용할 수 없어 연결 파일로 접속해주세요.');}}
  window.addEventListener('online',()=>{if(!state.server&&!state.busy&&!checking)restore();});
  update();restore();return {update};
}
