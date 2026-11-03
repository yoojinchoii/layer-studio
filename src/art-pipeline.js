// A model report is evidence for a stage, not an unconditional quality certificate.
export const ART_STAGES=['analyze','separate','complete','structure','materials','rig'];
export function normalizeReport(input){
  if(!input||input.version!=='art-pipeline-1'||!Array.isArray(input.stages)||input.stages.length!==6)return null;
  if(!ART_STAGES.every((id,i)=>input.stages[i]?.id===id))return null;
  if(JSON.stringify(input).length>100000)return null;
  const report=structuredClone(input);
  report.issues=Array.isArray(report.issues)?report.issues.slice(0,30).map(i=>({code:String(i.code||''),message:String(i.message||'').slice(0,500),part:i.part?String(i.part).slice(0,120):null})):[];
  const checks=report.stages.slice(0,5).every(s=>s.status==='passed');
  report.rig_allowed=input.rig_allowed===true&&checks&&['art_passed','rig_passed','rig_review'].includes(input.status);
  return report;
}
export function artAllowsRig(report){return normalizeReport(report)?.rig_allowed===true;}
export function invalidateArt(report){return report?{...report,status:'needs_review',rig_allowed:false,issues:[...(report.issues||[]).filter(i=>i.code!=='edited'),{code:'edited',message:'파츠 위치·순서·표시·이미지가 바뀌어 이전 검사가 무효화됐습니다. 재검사해주세요.'}],stages:report.stages.map(s=>['structure','materials','rig'].includes(s.id)?{...s,status:'pending',detail:'파츠 변경 후 재검사 필요'}:s)}:null;}
export function exportAllowed(report){return !report||artAllowsRig(report)&&report.status==='rig_passed';}
export function completeRigReview(report,audit){
  if(!artAllowsRig(report))throw Error('파츠 검사를 먼저 통과해야 합니다.');
  const issues=audit.issues||[];
  return {...report,status:issues.length?'rig_review':'rig_passed',rig_allowed:true,
    rig_review:{parts:audit.parts,poses:audit.poses,issues},
    stages:report.stages.map(s=>s.id==='rig'?{...s,status:issues.length?'review':'passed',detail:`${audit.poses}개 굽힘 검사 · 확인 ${issues.length}건`}:s)};
}
const jointMap={neck:'neck',head:'head',chest:'chest',pelvis:'pelvis',shoulder_R:'arm_left',elbow_R:'elbow_left',wrist_R:'wrist_left',shoulder_L:'arm_right',elbow_L:'elbow_right',wrist_L:'wrist_right',hip_R:'hip_left',knee_R:'knee_left',ankle_R:'ankle_left',hip_L:'hip_right',knee_L:'knee_right',ankle_L:'ankle_right'};
export function applyArtBindings(rig,layers,report){
  if(!artAllowsRig(report))throw Error('검사를 통과하지 않은 파츠입니다.');
  for(const [key,point]of Object.entries(report.analysis?.joints||{})){
    const id=jointMap[key];if(!id||!rig.points[id]||!Array.isArray(point)||point.length!==2||!point.every(v=>Number.isFinite(v)&&v>=0&&v<=1000))continue;
    rig.points[id]={x:point[0]*(rig.width-1)/1000,y:point[1]*(rig.height-1)/1000};
  }
  rig.artPrepared=true;rig.partBones??={};rig.sleeves={};rig.armSplits={};rig.limbStyle='mesh';rig.meshDensity='balanced';
  const modes=new Set(['rigid','torso','neck','arm_left','arm_right','leg_left','leg_right','sleeve_left','sleeve_right']);
  layers.forEach((l,i)=>{const a=l.art;if(!a)return;
    if(!rig.points[a.bone]||!modes.has(a.mode)||!Array.isArray(a.allowed_bones)||!a.allowed_bones.length||a.allowed_bones.some(b=>!rig.points[b]))throw Error(`${l.name}: 본 연결 정보가 올바르지 않습니다.`);
    if(a.role==='torso'&&a.allowed_bones.some(b=>/arm|elbow|wrist/.test(b)))throw Error('옷 몸통에는 팔 가중치를 붙일 수 없습니다.');
    rig.assignments[i]=a.bone;rig.modes[i]=a.mode;rig.partBones[i]=a.allowed_bones.slice();
  });
  return rig;
}
export function installArtReport({state,retry,download}){
  const root=document.getElementById('artPipeline');
  const names={passed:'통과',running:'진행 중',pending:'대기',review:'확인 필요',error:'실패'};
  function render(){
    root.hidden=!state.pipeline;
    if(!state.pipeline)return;
    const p=state.pipeline;document.getElementById('artPipelineTitle').textContent=({running:'분석·복원 진행 중',needs_review:'파츠 확인 필요 · 자동 리깅 중단',art_passed:'파츠 검사 통과 · 동작 검사 대기',rig_review:'리깅 동작 확인 필요',rig_passed:'자동 검사 통과 · 모션을 확인하세요'})[p.status]||'파츠 검사 기록';
    const list=document.getElementById('artStages');list.replaceChildren();
    for(const s of p.stages||[]){const li=document.createElement('li');li.dataset.status=s.status;li.textContent=`${s.label} · ${names[s.status]||'미확인'}`;li.title=s.detail||'';list.append(li);}
    const issues=[...(p.issues||[]),...(p.rig_review?.issues||[]).map(i=>({message:`${i.part}: ${i.message}`}))];
    document.getElementById('artIssues').replaceChildren(...issues.slice(0,12).map(i=>{const li=document.createElement('li');li.textContent=i.message;return li;}));
    document.getElementById('artRetry').disabled=state.busy||!state.server?.artPipeline||state.layers.length<2;
    document.getElementById('artCandidateSave').hidden=!state.artCandidate;
    document.getElementById('artRawHint').textContent=p.status==='needs_review'?'원본/분리 결과를 유지했습니다. 후보 PSD는 확인용이며 자동 적용되지 않습니다.':'검사 통과는 모든 포즈의 그림 품질을 보장하지 않습니다.';
  }
  document.getElementById('artRetry').onclick=retry;
  document.getElementById('artReportSave').onclick=()=>download(new Blob([JSON.stringify(state.pipeline,null,2)],{type:'application/json'}),'art-quality-report.json');
  return {render};
}
