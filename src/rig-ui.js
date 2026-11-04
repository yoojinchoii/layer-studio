import {artworkChanged} from './artwork-model.js';
import {normalizeReport,artAllowsRig,exportAllowed,applyArtBindings,completeRigReview} from './art-pipeline.js';
import {armFillSignature} from './arm-reconstruction.js';
import {restoreArmChains,mergedArmIndices,startArmSplit,setHandOutline,validateArmSplits} from './arm-separation.js';
import {reviewPose,repairPoseBindings,enableFullBody} from './pose-review.js';
import {applyBuiltin} from './rig-templates.js';
import {availableAnimations,animationDescriptions} from './rig-demo-motions.js';
import {poseBounds,paddedViewport,animationViewport,viewportPoint,rasterSize} from './rig-viewport.js';
import {detectFrame,facialOffsets,extendHalfFace} from './face-rig.js';
import {installRigFeatures} from './rig-feature-ui.js';
import {activeIds,activeBone,validateControls,chainFor,chainDefs,availableChain} from './rig-scope.js';
import {rotateJoint,setChainMode,initializeControls,motionPoints,moveJoint,setJointOffset,setJointScale,resetJointPose} from './rig-motion.js';
import {psdDocument} from './psd-document.js';
import {auditRig} from './rig-audit.js';
import {initSleeves,suggestSleeve,cuffLine} from './garment-parts.js';
import {installSpinePreview} from './spine-preview.js';
import {partBoneCandidates,cleanPixels,repairSeams,splitLegLayers,inferRig,refineRig,buildParts,applyPose,applyFill,hiddenMasks,matchOriginal,centerJoints,attachProps,makeSkeleton,poseMatrices,boneLabels,meshWorldVertices,vertexWeights,regionMatrix,mul,spineName,animationNames,animationDuration,addJoint,addJointAt,insertJointAt,upgradeRig,upgradeGarments,deleteJoint,setParent,boneOrder} from './rig-core.js';
import {repairNeckGap,restoreNeckFromReference} from './neck-gap.js';
import {packAtlas,encodePNG} from './spine-export.js';
import {zipSync,strToU8} from 'fflate';
import {writePsd} from 'ag-psd';
export function installRigUI({state,canvas,canvasBlob,download,toast,render}){
  const $=id=>document.getElementById(id);let placing=false,project=null,playing=false,processing=false,raf=0,started=0,cached=null,cachedParts=null,drag=null,history=[],future=[];
  let armGuide=null,armPainting=false,handSelection=null;
  let viewZoom=1,viewport=null,viewportLock=false,motionView=null,inspectionTime=null;
  const viewScale=()=>(viewport?.width||project.rig.width)/Math.max(1,$('rigCanvas').getBoundingClientRect().width);
  function fitPreview(){if(!project||!$('rigDialog').open)return;const c=$('rigCanvas'),box=c.parentElement,w=box.clientWidth,h=box.clientHeight;if(!w||!h)return;const v=viewport||project.rig,scale=Math.min(w/v.width,h/v.height)*viewZoom;c.style.width=`${v.width*scale}px`;c.style.height=`${v.height*scale}px`;$('rigZoomValue').textContent=`${Math.round(viewZoom*100)}%`;}
  for(const key of ['Joints','Parts','Templates','Finish'])$('rigTab'+key).onclick=()=>{cancelHandSelection();for(const k of ['Joints','Parts','Templates','Finish']){$('rigTab'+k).setAttribute('aria-selected',String(k===key));$('rigPanel'+k).hidden=k!==key;}fitPreview();draw();};
  $('rigZoomIn').onclick=()=>{viewZoom=Math.min(4,viewZoom+.25);fitPreview();draw();};$('rigZoomOut').onclick=()=>{viewZoom=Math.max(.5,viewZoom-.25);fitPreview();draw();};$('rigZoomFit').onclick=()=>{viewZoom=1;fitPreview();draw();};$('rigOnlyPart').onchange=()=>draw();
  new ResizeObserver(()=>{fitPreview();if(project&&$('rigDialog').open)draw();}).observe($('rigCanvas').parentElement);
  const metadata=l=>({name:l.name,x:l.x,y:l.y,width:l.canvas.width,height:l.canvas.height,opacity:l.opacity,visible:l.visible,art:l.art});
  const pixelCache=new WeakMap(),pixels=c=>{if(!pixelCache.has(c))pixelCache.set(c,c.getContext('2d').getImageData(0,0,c.width,c.height).data);return pixelCache.get(c);};
  const stop=(preserve=false)=>{playing=false;cancelAnimationFrame(raf);$('rigPlay').textContent='모션 재생';if(!preserve)inspectionTime=null;};
  const message=text=>{$('rigStatus').textContent=text;};
  let spinePreview,features;const dirty=()=>{if(state.pipeline&&['rig_passed','rig_review'].includes(state.pipeline.status)){state.pipeline={...state.pipeline,status:'art_passed',stages:state.pipeline.stages.map(s=>s.id==='rig'?{...s,status:'pending',detail:'관절·웨이트 변경 후 동작 재검사 필요'}:s)};}cached=null;cachedParts=null;spinePreview?.changed();state.onEdited?.();if($('rigAuditSummary').textContent){$('rigAuditSummary').textContent='작업이 변경됐어요. 점검을 다시 실행해주세요.';$('rigAuditResults').replaceChildren();}};
  const assist=()=>state.server?.rigAssist?state.server:null;
  const fillKey=()=>JSON.stringify([project.hiddenKey,armFillSignature(project.rig),$('rigStrength').value,project.removed]);
  async function call(path,body,type){const server=assist();const r=await fetch(server.url+path,{method:'POST',headers:{Authorization:`Bearer ${server.token}`,'Content-Type':type},body,signal:AbortSignal.timeout(300000)});if(!r.ok){let e;try{e=await r.json();}catch{}throw Error(e?.detail||`서버 오류 (${r.status})`);}return r.json();}
  // AI joints: pose keypoints from the server, then centred on the actual limb pixels.
  async function detectJoints(){if(!assist()||!project)return false;message('AI로 관절 위치를 찾는 중…');const data=await call('/api/pose',await canvasBlob(state.original),'application/octet-stream');const layers=project.layers.map((l,i)=>({...project.meta[i],data:pixels(l.canvas)}));const n=applyPose(project.rig,data.keypoints);if(!n){message('AI가 관절을 찾지 못해 모양 기반 추정을 사용합니다.');return false;}centerJoints(project.rig,layers);attachProps(project.rig,layers);dirty();fields();status();message(`AI가 관절 ${n}개를 찾았어요. 점이 어긋나면 드래그로 고쳐주세요.`);return true;}
  // AI redraw of joint caps (the hidden part of each piece behind its neighbour).
  const b64=async c=>(await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.slice(22));f.readAsDataURL(c);}));
  const maskCanvas=(mask,w,h)=>{const m=canvas(w,h),img=new ImageData(w,h);for(let i=0;i<mask.length;i++)if(mask[i])img.data.set([255,255,255,255],i*4);m.getContext('2d').putImageData(img,0,0);return m;};
  // Areas of each layer hidden behind other layers: redraw them as a plain continuation of the visible
  // part, so moving a piece reveals no invented outlines or hard edges.
  async function redrawHidden(){
    const key=`${project.ids}|${project.cleanVersion||0}`;if(project.hiddenKey===key)return;
    const masks=hiddenMasks(project.layers.map((l,i)=>({...project.meta[i],data:pixels(l.canvas)})),project.rig.width,project.rig.height);
    const todo=masks.map((m,i)=>({...m,i})).filter(m=>m.count>=40&&Math.max(project.layers[m.i].canvas.width,project.layers[m.i].canvas.height)<=1024);
    if(todo.length){message(`AI가 가려진 부분 ${todo.length}개 레이어를 다시 그리는 중…`);
      for(let start=0;start<todo.length;start+=16){const batch=todo.slice(start,start+16),items=[];
        for(const m of batch){const c=project.layers[m.i].canvas;items.push({image:await b64(await canvasBlob(c)),mask:await b64(await canvasBlob(maskCanvas(m.mask,c.width,c.height)))});}
        const res=await call('/api/inpaint',JSON.stringify({items}),'application/json');
        for(const [k,m]of batch.entries()){const l=project.layers[m.i],bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(res.images[k]),c=>c.charCodeAt(0))],{type:'image/png'})),tmp=canvas(l.canvas.width,l.canvas.height);tmp.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
          const rgb=tmp.getContext('2d').getImageData(0,0,tmp.width,tmp.height).data,c=canvas(l.canvas.width,l.canvas.height),ctx=c.getContext('2d'),img=ctx.createImageData(c.width,c.height);img.data.set(pixels(l.canvas));
          for(let i=0;i<m.mask.length;i++)if(m.mask[i]){img.data[i*4]=rgb[i*4];img.data[i*4+1]=rgb[i*4+1];img.data[i*4+2]=rgb[i*4+2];}ctx.putImageData(img,0,0);project.layers[m.i]={...l,canvas:c};}}}
    project.hiddenKey=key;dirty();
  }
  async function redraw(armsOnly=false){if(!assist())throw Error('다시 그리기는 서버 연결 후 사용할 수 있어요.');if(!armsOnly)await redrawHidden();const key=fillKey();if(project.fill?.key===key)return;cachedParts=null;const todo=parts().filter(p=>p.fill&&(!armsOnly||p.reconstruction));if(!todo.length){draw();message('가려진 부분을 AI로 다시 그렸어요.');return;}message(`AI가 관절 이음새 ${todo.length}곳을 다시 그리는 중…`);
    const items=[];for(const p of todo)items.push({image:await b64(await canvasBlob(p.canvas)),mask:await b64(await canvasBlob(maskCanvas(p.fill,p.width,p.height)))});
    const res=await call('/api/inpaint',JSON.stringify({items}),'application/json'),images=project.fill?.key===key?{...project.fill.images}:{};
    for(const [k,p]of todo.entries()){const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(res.images[k]),c=>c.charCodeAt(0))],{type:'image/png'}));const c=canvas(p.width,p.height);c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();images[p.slot]=c.getContext('2d').getImageData(0,0,p.width,p.height).data;}
    if(key!==fillKey())throw Error('복원 중 관절이나 영역이 바뀌어 결과를 적용하지 않았어요. 현재 설정으로 다시 복원해주세요.');project.fill={key,images};dirty();draw();status();message('가려진 부분과 관절 이음새를 AI로 다시 그렸어요.');}
  const pushHistory=(stack,value)=>{stack.push(value);if(stack.length>40)stack.shift();};
  const remember=()=>{if(!project)return;const value=JSON.stringify(project.rig);if(history.at(-1)!==value)pushHistory(history,value);future=[];$('rigUndo').disabled=false;};
  function restoreHistory(from,to,label){cancelHandSelection();armGuide=null;$('rigArmGuideCancel').hidden=true;if(!project||!from.length)return false;stop();pushHistory(to,JSON.stringify(project.rig));project.rig=JSON.parse(from.pop());sleeveHistory=weightHistory=angleHistory=false;dirty();menus();message(label);return true;}
  const undo=()=>restoreHistory(history,future,'한 단계 되돌렸어요.');
  const redo=()=>restoreHistory(future,history,'되돌린 작업을 다시 적용했어요.');
  const poseMode=()=>$('rigMode').value==='pose';
  const selected=()=>$('rigBone').value;
  const status=()=>{const n=parts().length,meshes=Object.values(skeleton().skins[0].attachments).map(a=>Object.values(a)[0]).filter(a=>a.type==='mesh'),vertices=meshes.reduce((n,a)=>n+a.uvs.length/2,0);message(`Spine 파츠 ${n}개 · 메쉬 ${meshes.length}개 / 정점 ${vertices}개 · 관절 ${activeIds(project.rig).length}개. ${meshes.length?'가중치 포함: Spine에서 다시 붙일 필요 없어요.':'파츠 회전 방식입니다. 메쉬·가중치 적용으로 전환하세요.'}`);};
  function menus(id=selected()||'body'){
    const layerSelection=$('rigLayer').value;
    const opts=()=>boneOrder(project.rig).filter(k=>k!=='root'&&activeIds(project.rig).includes(k)).map(k=>new Option(project.rig.labels[k]||k,k));
    $('rigBone').replaceChildren(...opts());$('rigBone').value=activeIds(project.rig).includes(id)?id:'body';
    $('rigParent').replaceChildren(new Option('전체 기준','root'),...opts());
    $('rigBind').replaceChildren(new Option('전체 기준','root'),...opts());
    $('rigLayer').replaceChildren(...project.meta.map((l,i)=>new Option(l.name,String(i))));if(layerSelection&&Number(layerSelection)<project.meta.length)$('rigLayer').value=layerSelection;
    const frame=project.rig.frame||'full',old=$('rigAnim').value,names=availableAnimations(project.rig),preferred=frame==='bust'?'head_sway':frame==='half'?'upper_sway':'idle';
    $('rigAnim').replaceChildren(...names.map(key=>new Option(animationNames[key],key)));$('rigAnim').value=$('rigAnim').dataset.frame===frame&&names.includes(old)?old:names.includes(preferred)?preferred:names[0];$('rigAnim').dataset.frame=frame;motionHint();
    $('rigMeshDensity').value=project.rig.meshDensity||'balanced';$('rigLimbStyle').value=project.rig.limbStyle??'cutout';$('rigIK').checked=project.rig.ik!==false;fields();binding();status();poseReview();
  }
  const reviewLayers=()=>project.layers.map((l,i)=>({...project.meta[i],data:pixels(l.canvas)}));
  function armGuideFields(){$('rigArmPartsCancel').hidden=!armGuide;handFields();const key=chainFor(selected());$('rigArmGuide').disabled=!!armGuide||!key?.startsWith('arm_')||!project.rig.activeBones?.includes(chainDefs[key]?.[2])||processing;}
  $('rigArmGuide').onclick=()=>{cancelHandSelection();if(!project||processing)return;const key=chainFor(selected());if(!key?.startsWith('arm_')||!project.rig.activeBones?.includes(chainDefs[key]?.[2]))return;stop();remember();$('rigArmPaint').checked=false;armGuide={ids:chainDefs[key],step:0,before:JSON.stringify(project.rig)};$('rigMode').value='setup';$('rigShowBones').checked=true;$('rigArmGuideCancel').hidden=false;armGuideFields();message('① 어깨 중심을 클릭하세요. 이어서 팔꿈치 → 손목을 클릭합니다.');};
  function cancelArmGuide(){if(!armGuide)return;project.rig=JSON.parse(armGuide.before);armGuide=null;$('rigArmGuideCancel').hidden=true;dirty();menus();draw();message('팔 3점 맞추기를 취소하고 이전 위치로 돌아왔어요.');}
  $('rigArmGuideCancel').onclick=$('rigArmPartsCancel').onclick=cancelArmGuide;
  function poseReview(){
    if(!project)return;const issues=reviewPose(project.rig,reviewLayers());$('rigPoseReview').hidden=!issues.length;
    $('rigPoseIssues').replaceChildren(...issues.map(issue=>{const li=document.createElement('li');li.textContent=`${issue.name} · ${issue.message}`;return li;}));
    $('rigRepairBindings').hidden=!issues.some(i=>i.kind==='headwear'||i.kind==='merged'&&!i.fixed);
    $('rigEnableFull').hidden=!issues.some(i=>i.kind==='frame');$('rigOpenArms').hidden=!mergedArmIndices(project.rig,reviewLayers()).length;
  }
  $('rigOpenArms').onclick=()=>{const i=mergedArmIndices(project.rig,reviewLayers())[0];if(i===undefined)return;$('rigLayer').value=String(i);$('rigTabParts').click();binding();};
  function armSplitFields(){
    const i=Number($('rigLayer').value),valid=mergedArmIndices(project.rig,reviewLayers()).includes(i),cfg=project.rig.armSplits?.[i],split=project.rig.modes[i]==='split_arms';
    $('rigArmSplitTools').hidden=!valid;$('rigGenericBinding').hidden=valid;
    $('rigArmSplitStart').textContent=split?'팔 영역 초안 사용 중':'팔 영역 초안 만들기';$('rigArmSplitStart').disabled=split;
    $('rigArmFront').value=cfg?.front||'left';$('rigArmBias').value=cfg?.bias||0;
    for(const id of ['rigArmFront','rigArmBias','rigArmPaint','rigArmPaintSide','rigArmRadius','rigArmSplitReset'])$(id).disabled=!split;
    $('rigArmSplitNote').textContent='분리 결과에 양팔과 손이 한 장으로 들어 있습니다. 기존 자동 분리 초안은 손을 반대 팔에 넣을 수 있어요. 아래에서 각 손의 소속을 지정해주세요.';
    handFields();
  }
  function handFields(){
    const side=$('rigArmSide').value,cfg=project?.rig.armSplits?.[Number($('rigLayer').value)],drawing=!!handSelection;
    const ready=!!cfg?.hands?.left&&!!cfg?.hands?.right;
    $('rigArmRestore').disabled=!ready||drawing||processing;
    $('rigArmRestoreNote').textContent=!ready?'오른손·왼손을 모두 지정하면 가려진 팔 복원을 시작할 수 있어요.':cfg.reconstruct?(project.fill?.key===fillKey()?'팔 복원 그림이 저장되어 있어요. 양팔을 움직여 경계를 확인하세요.':'팔 모양 초안입니다. AI로 질감을 채우려면 아래 버튼을 누르세요.'):'손 아래에 가려졌던 팔 모양과 질감을 만듭니다. 원본에서 보이지 않는 부분은 추정이므로 동작을 보고 확인해주세요.';
    $('rigArmRestoreWidth').value=String(cfg?.widthScale||1);
    $('rigArmPaintSide').value=side;$('rigHandActions').hidden=!drawing;$('rigHandApply').disabled=!drawing||handSelection.points.length<3;
    $('rigHandBack').disabled=!drawing||!handSelection.points.length;$('rigHandClear').hidden=!cfg?.hands?.[side]||drawing;
    $('rigHandStart').disabled=drawing;$('rigPlay').disabled=drawing||!!armGuide;$('rigArmSide').disabled=drawing||!!armGuide;$('rigArmGuideSelected').disabled=drawing||!!armGuide;
    $('rigHandProgress').textContent=drawing?`${side==='left'?'주황 오른손':'파랑 왼손'} 테두리 ${handSelection.points.length}점 · 손목부터 손가락까지 둘러주세요. 3점 이상 찍고 아래 버튼을 누르세요.`:cfg?.hands?.[side]?'이 손은 선택한 팔의 손목에 연결되어 있어요. 경계가 틀리면 다시 지정하세요.':'아직 이 손의 소속을 지정하지 않았어요.';
  }
  function cancelHandSelection(){handSelection=null;viewportLock=false;if(project)handFields();}
  $('rigArmSide').onchange=()=>{cancelHandSelection();$('rigArmPaint').checked=false;$('rigBone').value=`arm_${$('rigArmSide').value}`;fields();handFields();draw();};
  $('rigArmGuideSelected').onclick=()=>{$('rigBone').value=`arm_${$('rigArmSide').value}`;fields();$('rigArmGuide').click();handFields();};
  $('rigArmSplitStart').onclick=()=>{const i=Number($('rigLayer').value);if(!project||processing)return;stop();remember();startArmSplit(project.rig,reviewLayers(),i);initializeControls(project.rig);$('rigMode').value='setup';dirty();menus(`arm_${$('rigArmSide').value}`);$('rigShowArmRegions').checked=true;draw();message('거리 기준으로 나눈 초안이에요. 손의 소속은 테두리로 따로 지정해주세요.');};
  $('rigHandStart').onclick=()=>{if(!project||processing)return;stop();cancelArmGuide();$('rigArmPaint').checked=false;$('rigMode').value='setup';handSelection={index:Number($('rigLayer').value),side:$('rigArmSide').value,points:[]};viewportLock=true;handFields();draw();message('손목부터 손가락 끝까지, 손의 테두리를 여러 점으로 둘러주세요.');};
  $('rigHandBack').onclick=()=>{handSelection?.points.pop();handFields();draw();};
  $('rigHandCancel').onclick=()=>{cancelHandSelection();draw();message('손 지정 취소 · 기존 파츠는 그대로 유지됩니다.');};
  $('rigHandApply').onclick=()=>{if(!handSelection)return;const before=JSON.stringify(project.rig),{index,side,points}=handSelection;try{setHandOutline(project.rig,reviewLayers(),index,side,points);pushHistory(history,before);future=[];initializeControls(project.rig);cancelHandSelection();dirty();menus(`wrist_${side}`);$('rigShowArmRegions').checked=true;draw();message('지정한 손을 별도 파츠로 떼어 이 팔의 손목에만 연결했어요. 반대쪽 손도 확인해주세요.');}catch(e){project.rig=JSON.parse(before);message(e.message);}};
  $('rigHandClear').onclick=()=>{const cfg=project.rig.armSplits?.[Number($('rigLayer').value)];if(!cfg?.hands)return;remember();delete cfg.hands[$('rigArmSide').value];dirty();binding();message('손 지정이 해제되어 자동 추정 상태입니다. 이 손을 다시 지정해야 팔 복원을 할 수 있어요.');};
  $('rigArmRestoreWidth').onchange=()=>{const c=project.rig.armSplits?.[Number($('rigLayer').value)];if(!c)return;stop();remember();c.widthScale=Number($('rigArmRestoreWidth').value);dirty();handFields();draw();};
  $('rigArmRestore').onclick=async()=>{if(processing)return;const c=project.rig.armSplits?.[Number($('rigLayer').value)];if(!c?.hands?.left||!c?.hands?.right)return;stop();remember();c.reconstruct=true;dirty();draw();processing=true;handFields();try{await redraw(true);message('손 소속과 가려진 팔 복원 적용 · 모션 재생으로 양팔의 연결과 그림을 확인해주세요.');}catch(e){message(`팔 모양 초안만 적용됐어요. AI 질감 복원 실패: ${e.message}`);}finally{processing=false;handFields();}};
  $('rigArmFront').onchange=$('rigArmBias').onchange=()=>{const i=Number($('rigLayer').value),cfg=project.rig.armSplits?.[i];if(!cfg)return;stop();remember();cfg.front=$('rigArmFront').value;cfg.bias=Number($('rigArmBias').value);dirty();binding();};
  $('rigArmSplitReset').onclick=()=>{cancelHandSelection();const i=Number($('rigLayer').value);stop();remember();project.rig.modes[i]='crossed_arms';project.rig.assignments[i]='chest';delete project.rig.armSplits[i];$('rigArmPaint').checked=false;dirty();menus();$('rigLayer').value=String(i);binding();message('양팔을 원본 한 파츠로 되돌렸어요. 관절 위치는 유지됩니다.');};
  $('rigShowArmRegions').onchange=()=>draw();$('rigArmPaint').onchange=()=>{cancelHandSelection();stop();if($('rigArmPaint').checked){$('rigMode').value='setup';$('rigShowArmRegions').checked=true;cancelArmGuide();fields();}draw();};
  function paintArm(pos){const i=Number($('rigLayer').value),cfg=project.rig.armSplits?.[i];if(!cfg||project.rig.modes[i]!=='split_arms')return;const radius=Number($('rigArmRadius').value);if(cfg.strokes.length>=2000){message('브러시 획이 많습니다. 프로젝트를 저장하고 PSD에서 이어서 다듬어주세요.');return;}cfg.strokes.push({x:Math.max(0,Math.min(project.rig.width,pos.x)),y:Math.max(0,Math.min(project.rig.height,pos.y)),radius,side:$('rigArmPaintSide').value});dirty();draw();}
  $('rigRepairBindings').onclick=()=>{if(!project||processing)return;stop();remember();const n=repairPoseBindings(project.rig,reviewLayers());dirty();menus('head');draw();message(`연결 ${n}곳을 보정했어요. 겹친 팔은 가슴을 따라 움직이며 원본 그림과 다른 관절은 유지됩니다.`);};
  $('rigEnableFull').onclick=()=>{if(!project||processing)return;stop();remember();enableFullBody(project.rig);extendHalfFace(project.rig,reviewLayers());initializeControls(project.rig);state.frameHint='full';$('frameHint').value=$('rigTemplateSelect').value='full';dirty();menus('body');draw();message('기존 얼굴·상체 설정을 유지하고 전신 관절을 켰어요. 다리 관절 위치도 확인해주세요.');};
  async function prepare(options={}){
    if((state.busy&&!options.pipeline)||processing)return false;if(state.pipeline&&!artAllowsRig(state.pipeline)){toast('파츠 검사에 통과하지 못했어요. 검사 결과를 확인하고 저장된 파츠로 재검사해주세요.');return false;}if(state.layers.length<2){toast('먼저 AI로 파츠를 분리하거나 레이어 PSD를 불러와주세요.');return;}
    try{
      // Retain edits when reopening the same project; discard only on a real layer/source change.
      const same=currentProject();
      if(!same){const source=state.layers.map(l=>({...l})),meta=source.map(metadata),data=source.map((l,i)=>({...meta[i],data:pixels(l.canvas)})),frame=['full','half','bust'].includes(state.frameHint)?state.frameHint:detectFrame(data,state.width,state.height),rig=applyBuiltin(frame,data,state.width,state.height).rig;
        if(state.pipeline)applyArtBindings(rig,source,state.pipeline);else if(frame!=='bust')initSleeves(data,rig);$('rigTemplateSelect').value=frame;
        project={ids:state.layers.map(l=>l.id).join('|'),source,layers:source,rig,meta,removed:0};history=[];future=[];$('rigStrength').value='1';$('rigAmplitude').value='1';}
      else{const previous=project.meta,ids=project.source.map(l=>l.id);project.source=state.layers.map(l=>{const i=ids.indexOf(l.id),raw=project.source[i];return {...l,canvas:raw?.canvas||l.canvas,x:raw?raw.x+l.x-(previous[i]?.x??l.x):l.x,y:raw?raw.y+l.y-(previous[i]?.y??l.y):l.y};});project.meta=state.layers.map(metadata);project.layers=project.layers.map((l,i)=>({...l,...project.meta[i]}));}
      initializeControls(project.rig);dirty();$('rigMode').value='setup';menus();if(options.show!==false&&!$('rigDialog').open)$('rigDialog').showModal();if(!same){message('경계를 정리하고 있어요…');await new Promise(r=>setTimeout(r,30));if(!state.pipeline)await cleanup();if(!state.pipeline&&project.rig.frame==='bust'){project.rig=applyBuiltin('bust',project.layers.map((l,i)=>({...project.meta[i],data:pixels(l.canvas)})),state.width,state.height).rig;dirty();menus('head');}try{if(!state.pipeline&&options.detect!==false)await detectJoints();}catch(e){message(`AI 관절 인식 실패 · 모양 기반 추정 사용 (${e.message})`);}}if(state.pipeline){state.pipeline=completeRigReview(state.pipeline,auditRig(parts(),project.rig,skeleton()));render();}draw();return true;
    }catch(e){message(e.message);toast(e.message);return false;}
  }
  async function cleanup(){
    if(state.pipeline)throw Error('검사된 원본 픽셀은 일괄 지우기로 수정하지 않습니다. 파츠를 수정한 뒤 분석·복원 재검사를 실행해주세요.');
    stop();processing=true;$('rigProjectOpen').disabled=true;const next=[];let removed=0;for(const id of ['rigClean','rigSave','rigApply','rigProjectSave','rigSpinePreview'])$(id).disabled=true;
    try{for(const l of project.source){const c=canvas(l.canvas.width,l.canvas.height),ctx=c.getContext('2d');ctx.drawImage(l.canvas,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height),r=cleanPixels(pixels.data,c.width,c.height,Number($('rigStrength').value));pixels.data.set(r.data);ctx.putImageData(pixels,0,0);removed+=r.removed;next.push({...l,canvas:c});await new Promise(r=>setTimeout(r,0));}const ref=state.reference;if(ref&&ref.width===project.rig.width&&ref.height===project.rig.height){const datas=next.map(l=>{const ctx=l.canvas.getContext('2d');return {ctx,img:ctx.getImageData(0,0,l.canvas.width,l.canvas.height)};});matchOriginal(next.map((l,i)=>({...l,width:l.canvas.width,height:l.canvas.height,data:datas[i].img.data})),{width:ref.width,height:ref.height,data:ref.getContext('2d').getImageData(0,0,ref.width,ref.height).data});datas.forEach(d=>d.ctx.putImageData(d.img,0,0));}
    project.neckGapPixels=0;
    {const layers=next.map(l=>({...metadata(l),data:pixels(l.canvas)})),reference=ref?{width:ref.width,height:ref.height,data:pixels(ref)}:null;
      project.neckGapPixels=restoreNeckFromReference(layers,project.rig.width,project.rig.height,reference);
      if($('rigSeams').checked){project.neckGapPixels+=repairNeckGap(layers,project.rig.width,project.rig.height);project.seamPixels=repairSeams(layers,project.rig.width,project.rig.height);}else project.seamPixels=0;
      layers.forEach((l,i)=>{const c=canvas(l.width,l.height);c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(l.data),l.width,l.height),0,0);next[i]={...next[i],x:l.x,y:l.y,canvas:c};});project.meta=next.map(metadata);
    }
    project.meta=next.map(metadata);project.layers=next;project.removed=removed;project.cleanVersion=(project.cleanVersion||0)+1;state.layers=next;state.view='composite';render();dirty();status();draw();}
    finally{processing=false;$('rigProjectOpen').disabled=state.busy;for(const id of ['rigClean','rigSave','rigApply','rigProjectSave','rigSpinePreview'])$(id).disabled=false;}
  }
  // Spine parts derived from the cleaned layers and the current joints; rebuilt whenever either changes.
  function parts(){
    if(!cachedParts){
      cachedParts=buildParts(project.layers.map((l,i)=>({...project.meta[i],canvas:l.canvas,data:pixels(l.canvas)})),project.rig);
      if(project.fill?.key===fillKey())for(const p of cachedParts){const img=project.fill.images[p.slot];if(p.fill&&img&&img.length===p.data.length)applyFill(p,img);}
      for(const p of cachedParts)if(!p.canvas||p.canvas.width!==p.width||p.canvas.height!==p.height){const c=canvas(p.width,p.height);c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(p.data),p.width,p.height),0,0);p.canvas=c;}
    }
    return cachedParts;
  }
  function skeleton(){if(!cached)cached=makeSkeleton(parts(),project.rig,Number($('rigAmplitude').value));return cached;}
  function triangle(ctx,img,src,dst){
    const [s0,s1,s2]=src,[d0,d1,d2]=dst,ax=s1[0]-s0[0],ay=s1[1]-s0[1],bx=s2[0]-s0[0],by=s2[1]-s0[1],det=ax*by-ay*bx;if(Math.abs(det)<.00001)return;
    const dx=d1[0]-d0[0],dy=d1[1]-d0[1],ex=d2[0]-d0[0],ey=d2[1]-d0[1],a=(dx*by-ex*ay)/det,c=(ex*ax-dx*bx)/det,b=(dy*by-ey*ay)/det,d=(ey*ax-dy*bx)/det;
    ctx.save();ctx.beginPath();const cx=(d0[0]+d1[0]+d2[0])/3,cy=(d0[1]+d1[1]+d2[1])/3;
    // Slightly overlap clipped triangles to avoid antialias seams on the shared edges.
    dst.forEach(([x,y],i)=>{const len=Math.hypot(x-cx,y-cy)||1,xx=x+(x-cx)/len*.35,yy=y+(y-cy)/len*.35;i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);});ctx.closePath();ctx.clip();ctx.transform(a,b,c,d,d0[0]-a*s0[0]-c*s0[1],d0[1]-b*s0[0]-d*s0[1]);ctx.drawImage(img,0,0);ctx.restore();
  }
  const spinePose=()=>Object.fromEntries(Object.entries(project.rig.pose||{}).map(([k,v])=>[spineName(k),v]));
  function matrices(time=null){return poseMatrices(skeleton(),time,time===null&&poseMode()?spinePose():{},$('rigAnim').value,time===null&&poseMode()?Object.fromEntries(Object.entries(facialOffsets(project.rig)).map(([id,p])=>[spineName(id),p])):{},time===null&&poseMode()?Object.fromEntries(Object.entries(project.rig.poseScales||{}).map(([id,p])=>[spineName(id),p])):{});}
  function jointPositions(time=null){const m=matrices(time),root=project.rig.points.root;return Object.fromEntries(Object.keys(project.rig.points).filter(id=>m[spineName(id)]).map(id=>{const q=m[spineName(id)];return [id,{x:root.x+q[4],y:root.y-q[5]}];}));}
  function draw(time=inspectionTime){
    if(!project)return;const c=$('rigCanvas'),ctx=c.getContext('2d'),{width,height}=project.rig,root=project.rig.points.root;
    const sk=skeleton(),mat=matrices(time),screen=[1,0,0,-1,root.x,root.y],list=parts();
    if(!viewportLock||!viewport){if(time!==null){const name=$('rigAnim').value;if(motionView?.sk!==sk||motionView.name!==name)motionView={sk,name,view:animationViewport(sk,list,project.rig,name)};viewport=motionView.view;}else viewport=paddedViewport(poseBounds(sk,list,project.rig,mat),project.rig);}
    const raster=rasterSize(viewport);if(c.width!==raster.width)c.width=raster.width;if(c.height!==raster.height)c.height=raster.height;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,c.width,c.height);ctx.setTransform(raster.scale,0,0,raster.scale,-viewport.x*raster.scale,-viewport.y*raster.scale);fitPreview();
    for(let i=list.length-1;i>=0;i--){const p=list[i];if(!p.visible||$('rigOnlyPart').checked&&p.source!==Number($('rigLayer').value))continue;const a=sk.skins[0].attachments[p.slot][p.slot];ctx.save();ctx.globalAlpha=p.opacity??1;
      if(a.type==='mesh'){
        const vertices=meshWorldVertices(a,sk,mat).map(([x,y])=>[root.x+x,root.y-y]),uv=a.uvs;
        for(let t=0;t<a.triangles.length;t+=3){const ids=a.triangles.slice(t,t+3);triangle(ctx,p.canvas,ids.map(i=>[uv[i*2]*p.canvas.width,uv[i*2+1]*p.canvas.height]),ids.map(i=>vertices[i]));}
        if($('rigShowMesh').checked||$('rigShowWeights').checked){
          const scale=viewScale(),weights=vertexWeights(a,sk,spineName(selected()));
          const visible=i=>p.data[(Math.min(p.height-1,Math.floor(uv[i*2+1]*p.height))*p.width+Math.min(p.width-1,Math.floor(uv[i*2]*p.width)))*4+3]>8;
          ctx.lineWidth=.65*scale;ctx.strokeStyle='rgba(28,117,148,.45)';
          if($('rigShowMesh').checked&&p.source===Number($('rigLayer').value)){ctx.beginPath();for(let e=0;e<a.edges.length;e+=2){const i=a.edges[e]/2,j=a.edges[e+1]/2;if(!visible(i)&&!visible(j))continue;ctx.moveTo(...vertices[i]);ctx.lineTo(...vertices[j]);}ctx.stroke();}
          if($('rigShowWeights').checked&&weights.some(w=>w>0))for(let i=0;i<vertices.length;i++){if(!visible(i))continue;ctx.fillStyle=`hsl(${Math.round(220*(1-weights[i]))} 95% 52%)`;ctx.beginPath();ctx.arc(...vertices[i],2.1*scale,0,Math.PI*2);ctx.fill();}
        }
      }else{const m=mul(screen,regionMatrix(a,mat[spineName(p.bone)]));ctx.transform(...m);ctx.drawImage(p.canvas,0,0);}ctx.restore();
    }
    const referenceMode=$('rigReferenceView').value,reference=state.reference;if(reference&&referenceMode!=='off'){ctx.save();if(referenceMode==='original'){ctx.clearRect(viewport.x,viewport.y,viewport.width,viewport.height);}ctx.globalAlpha=referenceMode==='overlay'?.5:1;ctx.drawImage(reference,0,0,width,height);ctx.restore();}
    if(time===null&&!poseMode()&&$('rigShowArmRegions').checked&&!$('rigPanelParts').hidden)for(const p of list.filter(p=>['separated-arm','separated-hand'].includes(p.role)&&p.source===Number($('rigLayer').value))){const t=canvas(p.width,p.height),tc=t.getContext('2d');tc.drawImage(p.canvas,0,0);tc.globalCompositeOperation='source-in';tc.fillStyle=(p.armSide||p.mode.slice(4))==='left'?'#f08c32':'#4c9aff';tc.fillRect(0,0,p.width,p.height);ctx.save();ctx.globalAlpha=.48;ctx.drawImage(t,p.x,p.y);ctx.restore();}
    if(handSelection){const ps=handSelection.points,scale=viewScale();ctx.save();ctx.strokeStyle=handSelection.side==='left'?'#ffae52':'#69aeff';ctx.fillStyle=handSelection.side==='left'?'#ffae5240':'#69aeff40';ctx.lineWidth=2*scale;if(ps.length){ctx.beginPath();ctx.moveTo(ps[0].x,ps[0].y);for(const p of ps.slice(1))ctx.lineTo(p.x,p.y);ctx.closePath();ctx.fill();ctx.stroke();for(const p of ps){ctx.beginPath();ctx.arc(p.x,p.y,3*scale,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.stroke();}}ctx.restore();}
    const cuff=project.rig.sleeves?.[Number($('rigLayer').value)];
    if(time===null&&!poseMode()&&!$('rigPanelParts').hidden&&cuff?.enabled&&/^arm_/.test(project.rig.modes[Number($('rigLayer').value)])){
      const {point,normal}=cuffLine(cuff),r=project.rig.height*.055,scale=viewScale();ctx.save();ctx.strokeStyle='#ffb629';ctx.lineWidth=2*scale;ctx.setLineDash([5*scale,3*scale]);ctx.beginPath();ctx.moveTo(point.x-normal.y*r,point.y+normal.x*r);ctx.lineTo(point.x+normal.y*r,point.y-normal.x*r);ctx.stroke();ctx.restore();
    }
    if($('rigShowBones').checked){const points=jointPositions(time),scale=viewScale();ctx.lineWidth=1.5*scale;ctx.font=`${11*scale}px sans-serif`;
      for(const id of Object.keys(points)){if(id==='root')continue;const p=points[id],parent=points[project.rig.parents[id]],active=id===selected();ctx.strokeStyle=active?'#e67916':'#096e65';ctx.fillStyle=active?'#ffd08c':'#a1ffdd';if(parent&&project.rig.parents[id]!=='root'){ctx.beginPath();ctx.moveTo(parent.x,parent.y);ctx.lineTo(p.x,p.y);ctx.stroke();}ctx.beginPath();ctx.arc(p.x,p.y,(active?6:4)*scale,0,Math.PI*2);ctx.fill();ctx.stroke();if(active){ctx.fillStyle='#102c33';ctx.fillText(`${project.rig.labels[id]||id}${project.rig.frame==='bust'?'':` · ${spineName(id)}`}`,p.x+10*scale,p.y-9*scale);}}
    }
    features?.overlay(ctx,time);
  }
  function updateWeightSelection(){
    if(!project)return;const id=selected(),name=project.rig.labels[id]||id,bone=spineName(id),weighted=[],fixed=[],sk=skeleton();
    for(const p of parts()){const a=sk.skins[0].attachments[p.slot][p.slot];if(a.type==='mesh'){if(vertexWeights(a,sk,bone).some(w=>w>0))weighted.push(p.name);}else if(spineName(p.bone)===bone)fixed.push(p.name);}
    $('rigWeightActive').textContent=`현재 관절: ${name}`;$('rigWeightSelection').textContent=`${name} · ${bone}`;
    $('rigWeightTargets').textContent=[weighted.length?`가중치 적용 파츠: ${weighted.join(', ')}`:'',fixed.length?`고정 연결 파츠: ${fixed.join(', ')} (메쉬 가중치 없음)`:''].filter(Boolean).join(' / ')||'직접 연결된 파츠가 없습니다. 자식 관절을 통해 움직일 수 있어요.';
  }
  function selectJoint(id,reveal=false){
    $('rigBone').value=id;$('rigShowWeights').checked=true;
    const current=Number($('rigLayer').value),belongs=i=>partBoneCandidates(project.rig,i).includes(id);
    if(!belongs(current)){const related=project.meta.findIndex((_,i)=>belongs(i));if(related>=0)$('rigLayer').value=String(related);}
    fields();binding();if(reveal){$('rigTabJoints').click();$('rigPanelJoints').parentElement.scrollTop=0;}
  }
  function fields(){if(!project)return;const id=selected(),p=project.rig.points[id];updateWeightSelection();$('rigPoseReset').disabled=!project.rig.pose[id]&&!project.rig.poseOffsets?.[id]&&!project.rig.poseScales?.[id];$('rigWeightBlend').value=project.rig.weightBlend?.[id]??1;$('rigWeightBlendValue').textContent=`${Number($('rigWeightBlend').value).toFixed(2)}배`;$('rigWeightBlend').disabled=project.rig.limbStyle!=='mesh'||! /^(elbow|wrist|knee|ankle|joint)_/.test(id);$('rigX').value=Math.round(p.x*10)/10;$('rigY').value=Math.round(p.y*10)/10;$('rigParent').value=project.rig.parents[id];$('rigAngle').value=project.rig.pose[id]||0;$('rigAngleInput').value=Math.round((project.rig.pose[id]||0)*10)/10;$('rigAngleValue').textContent=`${Math.round((project.rig.pose[id]||0)*10)/10}°`;$('rigDelete').disabled=!!boneLabels[id];$('rigUndo').disabled=!history.length;$('rigX').disabled=$('rigY').disabled=poseMode();$('rigAngle').disabled=$('rigAngleInput').disabled=$('rigAngleReset').disabled=!poseMode();transformFields();features?.controlFields();armGuideFields();draw();}
  function transformFields(){
    const r=project.rig,id=selected(),p=r.poseOffsets?.[id]||{x:0,y:0},sc=r.poseScales?.[id]||{x:1,y:1};
    $('rigSetupPosition').hidden=poseMode();$('rigPoseTransform').hidden=!poseMode();
    for(const [key,value]of Object.entries({rigPositionX:p.x,rigPositionY:p.y,rigScaleX:sc.x*100,rigScaleY:sc.y*100}))$(key).value=Math.round(value*100)/100;
    for(const axis of ['x','y']){const slider=$(`rigPositionSlider${axis.toUpperCase()}`),limit=Math.min(32768,Math.max(100,Math.ceil(Math.abs(p[axis])/100)*100));slider.min=-limit;slider.max=limit;slider.value=p[axis];slider.setAttribute('aria-valuetext',`${Math.round(p[axis]*10)/10} px`);}
  }
  function changeTransform(kind,axis,value,record=true){
    if(!project||!poseMode()||processing||!Number.isFinite(value)){fields();return;}
    const r=project.rig,id=selected();stop();if(record)remember();
    if(kind==='position'){const p={x:0,y:0,...r.poseOffsets?.[id],[axis]:Math.max(-32768,Math.min(32768,value))};setJointOffset(r,id,p.x,p.y);}
    else{const p={x:1,y:1,...r.poseScales?.[id]},next=Math.max(.05,Math.min(4,value/100)),other=axis==='x'?'y':'x';if($('rigScaleLink').checked)p[other]=Math.max(.05,Math.min(4,p[other]*next/p[axis]));p[axis]=next;setJointScale(r,id,p.x,p.y);}
    dirty();fields();
  }
  for(const [key,kind,axis]of [['rigPositionX','position','x'],['rigPositionY','position','y'],['rigScaleX','scale','x'],['rigScaleY','scale','y']]){$(key).onchange=()=>changeTransform(kind,axis,Number($(key).value));$(key).onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();changeTransform(kind,axis,Number($(key).value));}};}
  for(const axis of ['x','y']){const slider=$(`rigPositionSlider${axis.toUpperCase()}`);let editing=false;slider.oninput=()=>{changeTransform('position',axis,Number(slider.value),!editing);editing=true;};slider.onchange=slider.onblur=slider.onpointercancel=()=>{editing=false;};}
  $('rigPositionReset').onclick=()=>{stop();remember();setJointOffset(project.rig,selected(),0,0);dirty();fields();};
  $('rigScaleReset').onclick=()=>{stop();remember();setJointScale(project.rig,selected(),1,1);dirty();fields();};
  $('rigPoseTool').onchange=()=>{stop();fields();};
  function binding(){armGuideFields();armSplitFields();const i=Number($('rigLayer').value);sleeveFields();$('rigBind').value=activeBone(project.rig,project.rig.assignments[i]);$('rigDeform').value=project.rig.modes[i];influenceFields();draw();}
  function sleeveFields(){
    const i=Number($('rigLayer').value),isArm=/^arm_(left|right)$/.test(project.rig.modes[i]),cfg=project.rig.sleeves?.[i];
    $('rigSleeveTools').hidden=!isArm;$('rigSleeveEnabled').checked=!!cfg?.enabled;
    $('rigSleeveEnabled').disabled=!cfg;$('rigSleeveOffset').disabled=$('rigSleeveAngle').disabled=!cfg?.enabled;
    $('rigSleeveOffset').value=cfg?.offset||0;$('rigSleeveAngle').value=cfg?.angle||0;
    $('rigSleeveOffsetValue').textContent=`${cfg?.offset||0}px`;$('rigSleeveAngleValue').textContent=`${cfg?.angle||0}°`;
    const splitExists=cfg?.enabled&&parts().some(p=>p.source===i&&p.role==='sleeve');
    $('rigSleeveNote').textContent=cfg?.enabled&&!splitExists?'분리선이 파츠 밖에 있어요. 소매 끝 위치를 조절하거나 자동 분리를 다시 눌러주세요.':cfg?.enabled?'소매 → 상완을 따라 움직이고 어깨에서 몸통과 이어짐 / 맨팔 → 팔 관절. 안쪽 팔은 주변 피부색으로 추정해 채웁니다.':'소매가 맨팔과 섞여 있다면 자동 분리를 눌러주세요. 색이 비슷하거나 긴 소매는 원화에서 분리하는 편이 정확해요.';
  }
  $('rigSleeveAuto').onclick=()=>{
    const i=Number($('rigLayer').value),layers=project.layers.map((l,i)=>({...project.meta[i],data:pixels(l.canvas)})),shirt=layers.find(l=>/^(topwear|상의)(?:$|[_ -])/i.test(l.name));
    const cfg=suggestSleeve(layers[i],project.rig,i,shirt);if(!cfg){message('소매와 피부 경계를 확실하게 찾지 못했어요. 소매를 별도 이미지로 분리한 PSD를 사용해주세요.');return;}
    remember();project.rig.sleeves??={};project.rig.sleeves[i]=cfg;stop();dirty();binding();status();
  };
  $('rigSleeveEnabled').onchange=()=>{const cfg=project.rig.sleeves?.[Number($('rigLayer').value)];if(!cfg)return;remember();cfg.enabled=$('rigSleeveEnabled').checked;stop();dirty();binding();status();};
  let sleeveHistory=false;for(const [id,key]of [['rigSleeveOffset','offset'],['rigSleeveAngle','angle']]){
    $(id).oninput=()=>{const cfg=project.rig.sleeves?.[Number($('rigLayer').value)];if(!cfg?.enabled)return;if(!sleeveHistory){remember();sleeveHistory=true;}cfg[key]=Number($(id).value);stop();dirty();sleeveFields();influenceFields();draw();status();};
    $(id).onchange=()=>sleeveHistory=false;
  }
  function influenceFields(){
    if(!project)return;const i=Number($('rigLayer').value),candidates=partBoneCandidates(project.rig,i),allowed=project.rig.partBones?.[i]||candidates;
    updateWeightSelection();
    $('rigPartBones').replaceChildren(...candidates.map(id=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=allowed.includes(id);input.disabled=project.rig.modes[i]==='rigid';label.append(input,document.createTextNode(`${project.rig.labels[id]||id}${project.rig.frame==='bust'?'':` · ${spineName(id)}`}`));input.onchange=()=>{const chosen=candidates.filter(b=>b===id?input.checked:allowed.includes(b));if(!chosen.length){input.checked=true;message('파츠에 연결할 본을 하나 이상 남겨주세요.');return;}remember();project.rig.partBones??={};project.rig.partBones[i]=chosen;stop();dirty();influenceFields();draw();status();};return label;}));
    const matching=parts().filter(p=>p.source===i),sk=skeleton();let count=0;const used=new Set();for(const p of matching){const a=sk.skins[0].attachments[p.slot][p.slot];if(a.type!=='mesh'){used.add(spineName(p.bone));continue;}count+=a.uvs.length/2;let at=0;for(let v=0;v<a.uvs.length/2;v++){const n=a.vertices[at++];for(let j=0;j<n;j++){used.add(sk.bones[a.vertices[at]].name);at+=4;}}}
    $('rigPartSummary').textContent=`${project.meta[i].name} · ${count?`정점 ${count}개`:'고정 파츠'} · 실제 연결 본 ${used.size}개: ${[...used].join(', ')}`;
  }
  $('rigPartBonesReset').onclick=()=>{remember();if(project.rig.partBones)delete project.rig.partBones[Number($('rigLayer').value)];dirty();binding();status();};
  $('rigMeshDensity').onchange=()=>{remember();project.rig.meshDensity=$('rigMeshDensity').value;stop();dirty();binding();status();};
  function setPoint(x,y){if(!Number.isFinite(x)||!Number.isFinite(y))return;const {width,height}=project.rig;project.rig.points[selected()]={x:Math.max(0,Math.min(width,x)),y:Math.max(0,Math.min(height,y))};for(const [key,mode]of Object.entries(project.rig.ikModes||{}))if(mode==='ik')setChainMode(project.rig,key,'ik');dirty();fields();}
  const mouse=e=>viewportPoint(viewport||{x:0,y:0,...project.rig},$('rigCanvas').getBoundingClientRect(),e.clientX,e.clientY);
  $('rigCanvas').onpointerdown=e=>{if(!project||playing||processing)return;if(handSelection){const pos=mouse(e);if(handSelection.points.length<80)handSelection.points.push({x:Math.max(0,Math.min(project.rig.width,pos.x)),y:Math.max(0,Math.min(project.rig.height,pos.y))});handFields();draw();e.preventDefault();return;}if(armGuide){const pos=mouse(e),id=armGuide.ids[armGuide.step];project.rig.points[id]={x:Math.max(0,Math.min(project.rig.width,pos.x)),y:Math.max(0,Math.min(project.rig.height,pos.y))};armGuide.step++;if(armGuide.step===3){armGuide=null;$('rigArmGuideCancel').hidden=true;initializeControls(project.rig);dirty();menus(id);draw();message('어깨·팔꿈치·손목을 각각 맞췄어요. 포즈 편집에서 움직임을 확인하세요.');}else{dirty();menus(armGuide.ids[armGuide.step]);message(armGuide.step===1?'② 팔꿈치 중심을 클릭하세요.':'③ 손목 중심을 클릭하세요.');}e.preventDefault();return;}if($('rigArmPaint').checked&&!$('rigPanelParts').hidden&&project.rig.modes[Number($('rigLayer').value)]==='split_arms'&&!poseMode()){remember();armPainting=true;viewportLock=true;$('rigCanvas').setPointerCapture(e.pointerId);paintArm(mouse(e));e.preventDefault();return;}if(placing){const pos=mouse(e);placing=false;$('rigAdd').classList.remove('primary');try{remember();const between=$('rigInsertMode').value==='between',id=(between?insertJointAt:addJointAt)(project.rig,$('rigJointName').value,selected(),pos.x,pos.y);$('rigJointName').value='';dirty();menus(id);message(`'${project.rig.labels[id]}' 관절을 추가했어요. 아래 '파츠와 관절 연결'에서 이 관절로 움직일 파츠를 지정하세요.`);}catch(err){message(err.message);}return;}const pos=mouse(e),points=jointPositions(),radius=16*viewScale();let nearest=null,best=radius;for(const [id,p]of Object.entries(points)){if(id==='root')continue;const dist=Math.hypot(pos.x-p.x,pos.y-p.y);if(dist<best||(id===selected()&&dist<radius&&Math.abs(dist-best)<1)){nearest=id;best=dist;}}
    if(poseMode()){viewportLock=true;if(!features.pointerDown(e,pos,nearest))viewportLock=false;return;}if(nearest)selectJoint(nearest,true);if(!nearest)return;
    viewportLock=true;remember();drag={id:selected(),dx:project.rig.points[selected()].x-pos.x,dy:project.rig.points[selected()].y-pos.y};$('rigCanvas').setPointerCapture(e.pointerId);$('rigCanvas').focus();e.preventDefault();};
  $('rigCanvas').onpointermove=e=>{const p=mouse(e);if(armPainting){paintArm(p);return;}if(features.pointerMove(p))return;if(!drag)return;setPoint(p.x+drag.dx,p.y+drag.dy);};
  const endDrag=e=>{viewportLock=!!handSelection;if(armPainting){armPainting=false;if($('rigCanvas').hasPointerCapture(e.pointerId))$('rigCanvas').releasePointerCapture(e.pointerId);influenceFields();draw();return;}if(features.pointerEnd(e)){draw();status();return;}if(!drag)return;drag=null;if($('rigCanvas').hasPointerCapture(e.pointerId))$('rigCanvas').releasePointerCapture(e.pointerId);draw();status();};$('rigCanvas').onpointerup=endDrag;$('rigCanvas').onpointercancel=endDrag;
  $('rigCanvas').onkeydown=e=>{if(!project||processing||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();remember();const p=poseMode()?motionPoints(project.rig)[selected()]:project.rig.points[selected()],step=e.shiftKey?10:1,x=p.x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),y=p.y+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0);if(poseMode()){moveJoint(project.rig,selected(),{x,y});dirty();fields();}else setPoint(x,y);};
  $('rigX').onchange=$('rigY').onchange=()=>{remember();setPoint(Number($('rigX').value),Number($('rigY').value));};
  $('rigBone').onchange=()=>{stop();selectJoint(selected());};$('rigLayer').onchange=()=>{cancelHandSelection();cancelArmGuide();$('rigArmPaint').checked=false;$('rigBone').value=activeBone(project.rig,project.rig.assignments[Number($('rigLayer').value)]);fields();binding();};
  $('rigBind').onchange=()=>{remember();project.rig.assignments[Number($('rigLayer').value)]=$('rigBind').value;project.rig.modes[Number($('rigLayer').value)]='rigid';if(project.rig.partBones)delete project.rig.partBones[Number($('rigLayer').value)];stop();dirty();const i=$('rigLayer').value;menus();$('rigLayer').value=i;binding();};
  $('rigDeform').onchange=()=>{remember();project.rig.modes[Number($('rigLayer').value)]=$('rigDeform').value;if($('rigDeform').value==='split_arms')startArmSplit(project.rig,reviewLayers(),Number($('rigLayer').value));if($('rigDeform').value==='crossed_arms'){project.rig.assignments[Number($('rigLayer').value)]='chest';if(project.rig.sleeves)delete project.rig.sleeves[Number($('rigLayer').value)];}if(project.rig.partBones)delete project.rig.partBones[Number($('rigLayer').value)];stop();dirty();const i=$('rigLayer').value;menus();$('rigLayer').value=i;binding();};
  $('rigLimbStyle').onchange=()=>{remember();project.rig.limbStyle=$('rigLimbStyle').value;stop();dirty();fields();influenceFields();status();};
  $('rigRefineMesh').onclick=()=>{if(!project||processing)return;remember();project.rig.limbStyle='mesh';$('rigLimbStyle').value='mesh';$('rigShowMesh').checked=true;stop();dirty();fields();influenceFields();status();};
  $('rigShowMesh').onchange=$('rigShowWeights').onchange=()=>draw();
  let weightHistory=false;$('rigWeightBlend').oninput=()=>{if(!project)return;stop();if(!weightHistory){remember();weightHistory=true;}project.rig.weightBlend??={};project.rig.weightBlend[selected()]=Number($('rigWeightBlend').value);dirty();fields();influenceFields();status();};$('rigWeightBlend').onchange=()=>weightHistory=false;
  $('rigIK').onchange=()=>{remember();project.rig.ik=$('rigIK').checked;if(!project.rig.ik)for(const key of Object.keys(project.rig.ikModes||{}))setChainMode(project.rig,key,'fk');dirty();fields();};
  function motionHint(){$('rigMotionHint').textContent=`${animationDescriptions[$('rigAnim').value]||''} 재생은 저장한 포즈를 바꾸지 않아요 · AI 사용 없음.`;}
  $('rigAnim').onchange=()=>{motionHint();inspectionTime=null;$('rigScrub').value=0;$('rigScrubValue').textContent='0%';if(playing){started=performance.now();}else draw();};
  $('rigParent').onchange=()=>{try{remember();setParent(project.rig,selected(),$('rigParent').value);dirty();menus();}catch(e){message(e.message);fields();}};
  $('rigAdd').onclick=()=>{if(!project)return;if($('rigMode').value!=='setup'){$('rigMode').value='setup';fields();}stop();placing=!placing;$('rigAdd').classList.toggle('primary',placing);const name=k=>project.rig.labels[k]||k,sel=selected();if(placing&&$('rigInsertMode').value==='between'&&sel==='root'){placing=false;$('rigAdd').classList.remove('primary');message('전체 기준 위에는 넣을 수 없어요.');return;}
    message(placing?($('rigInsertMode').value==='between'?`미리보기에서 위치를 클릭하세요. ${name(project.rig.parents[sel])} → [새 관절] → ${name(sel)} 순서로 들어갑니다. (다시 누르면 취소)`:`미리보기에서 새 관절 위치를 클릭하세요. ${name(sel)} 아래에 붙습니다. (다시 누르면 취소)`):'관절 추가를 취소했어요.');};
  $('rigDelete').onclick=()=>{try{remember();deleteJoint(project.rig,selected());dirty();menus('body');}catch(e){message(e.message);}};
  $('rigUndo').onclick=undo;
  document.addEventListener('keydown',e=>{
    if(!project||!$('rigDialog').open||processing||e.defaultPrevented||e.altKey||!(e.metaKey||e.ctrlKey)||e.key.toLowerCase()!=='z')return;
    const target=e.target,type=target?.type;
    if(target?.isContentEditable||target?.tagName==='TEXTAREA'||target?.tagName==='INPUT'&&['text','number','search','url','email','tel','password'].includes(type))return;
    e.preventDefault();(e.shiftKey?redo:undo)();
  });
  $('rigReinfer').onclick=()=>{if(!project)return;remember();const fresh=applyBuiltin(project.rig.frame||'full',project.layers.map((l,i)=>({...project.meta[i],data:pixels(l.canvas)})),project.rig.width,project.rig.height).rig;for(const id of Object.keys(fresh.points))if(boneLabels[id])project.rig.points[id]=fresh.points[id];dirty();fields();status();message('관절 위치를 파츠 모양에서 다시 추정했어요. 추가 관절과 연결 설정은 유지됩니다.');};
  $('rigMode').onchange=()=>{cancelHandSelection();stop();fields();message(poseMode()?'위치·회전·크기를 입력하거나 드래그 도구를 골라 관절을 움직이세요. 편집값은 manual_pose로 저장합니다.':'관절 점을 드래그하거나 X·Y를 입력하세요. 방향키 1px / Shift+방향키 10px.');};
  let angleHistory=false;$('rigAngle').oninput=()=>{stop();if(!angleHistory){remember();angleHistory=true;}rotateJoint(project.rig,selected(),Number($('rigAngle').value));features.controlFields();$('rigPoseReset').disabled=!project.rig.pose[selected()]&&!project.rig.poseOffsets?.[selected()]&&!project.rig.poseScales?.[selected()];$('rigAngleValue').textContent=`${$('rigAngle').value}°`;$('rigAngleInput').value=$('rigAngle').value;dirty();draw();};$('rigAngle').onchange=()=>angleHistory=false;
  const setAngle=v=>{if(!Number.isFinite(v))return;stop();remember();v=Math.max(-180,Math.min(180,Math.round(v*10)/10));rotateJoint(project.rig,selected(),v);dirty();fields();};
  $('rigAngleInput').onchange=()=>setAngle(Number($('rigAngleInput').value));$('rigAngleInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();setAngle(Number($('rigAngleInput').value));}};
  $('rigAngleReset').onclick=()=>setAngle(0);
  $('rigPoseReset').onclick=()=>{stop();remember();resetJointPose(project.rig,selected());dirty();fields();message(`${project.rig.labels[selected()]||selected()}의 위치·회전·크기를 초기화했어요. 다른 관절은 유지됩니다.`);};
  $('rigSeams').onchange=()=>cleanup().catch(e=>message(e.message));$('rigClean').onclick=()=>cleanup().catch(e=>message(e.message));$('rigShowBones').onchange=()=>draw();$('rigAmplitude').oninput=()=>{dirty();if(!playing)draw();};
  const updateScrub=t=>{const duration=animationDuration(skeleton().animations[$('rigAnim').value])||1,fraction=(t%duration)/duration;$('rigScrub').value=Math.round(fraction*999);$('rigScrubValue').textContent=Math.round(fraction*100)+'%';};
  $('rigPlay').onclick=()=>{cancelArmGuide();if(playing){stop(true);draw();return;}playing=true;started=performance.now()-(inspectionTime||0)*1000/Number($('rigPlaybackSpeed').value);$('rigPlay').textContent='일시정지';const frame=now=>{inspectionTime=(now-started)/1000*Number($('rigPlaybackSpeed').value);draw();updateScrub(inspectionTime);raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);};
  $('rigScrub').oninput=()=>{if(!project)return;stop();inspectionTime=(animationDuration(skeleton().animations[$('rigAnim').value])||1)*Number($('rigScrub').value)/1000;$('rigScrubValue').textContent=Math.round(Number($('rigScrub').value)/10)+'%';draw();};
  $('rigReturnPose').onclick=()=>{stop();$('rigScrub').value=0;$('rigScrubValue').textContent='0%';draw();};
  $('rigPlaybackSpeed').onchange=()=>{if(playing)started=performance.now()-(inspectionTime||0)*1000/Number($('rigPlaybackSpeed').value);};
  $('rigReferenceView').onchange=()=>draw();$('rigDialog').onclose=()=>{stop();cancelArmGuide();};
  const filename=()=>(state.name||'character').replace(/[\\/:*?"<>|]/g,'_');
  const unityName=()=>(state.name||'').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').toLowerCase()||'character';
  $('rigAiJoints').onclick=()=>{remember();detectJoints().catch(e=>message(e.message));};
  $('rigAiFill').onclick=()=>redraw().catch(e=>message(e.message));
  $('rigSave').onclick=async()=>{if(!project)return;if(!exportAllowed(state.pipeline)){message('파츠 검사와 리깅 동작 점검을 통과한 뒤 Spine으로 내보낼 수 있어요.');return;}stop();$('rigSave').disabled=true;try{
    const list=parts(),sk=skeleton(),json=JSON.stringify(sk,null,2),name=unityName(),files={};
    // spine/: images + skeleton.json for the Spine editor (Import Data). unity/: drop straight into Assets.
    files['spine/skeleton.json']=strToU8(json);
    for(const p of list)files[`spine/images/${p.slot}.png`]=new Uint8Array(await(await canvasBlob(p.canvas)).arrayBuffer());
    const packed=packAtlas(list.map(p=>({slot:p.slot,width:p.width,height:p.height,data:p.data})),{name});
    files[`unity/${name}.json`]=strToU8(json);files[`unity/${name}.atlas.txt`]=strToU8(packed.atlas);for(const pg of packed.pages)files[`unity/${pg.file}`]=encodePNG(pg.rgba,pg.width,pg.height);
    files['parts.psd']=new Uint8Array(writePsd(psdDocument(list,project.rig.width,project.rig.height),{generateThumbnail:false}));
    files['layer-map.json']=strToU8(JSON.stringify({layers:project.meta,parts:list.map(({slot,x,y,width,height,bone,source})=>({slot,x,y,width,height,bone:spineName(bone),source:project.meta[source]?.name})),rig:project.rig},null,2));
    const ik=(sk.ik||[]).map(c=>c.name).join(', ')||'없음';
    files['사용법.txt']=strToU8(`Layer Studio Spine 리그 (Spine 4.0.64)

[Unity · spine-unity 4.0]
unity/ 폴더의 파일 3개(${name}.json, ${name}.atlas.txt, ${name}.png)를 Unity Assets에 같이 넣으면 SkeletonData가 자동 생성됩니다.
텍스처는 Premultiplied Alpha(PMA)로 저장되어 spine-unity 기본 설정 그대로 사용하면 됩니다.

[Spine 에디터에서 이어서 작업]
Spine > 데이터 가져오기 > spine/skeleton.json. 이미지 경로: ./images/
작업 후 Export(JSON, 4.0)로 다시 내보내 Unity에 넣으세요.

[구성]
파츠 ${list.length}개, 뼈대 ${sk.bones.length}개, IK: ${ik}
좌우 이름은 캐릭터 기준입니다. 화면 왼쪽 팔 = upper_arm_R / forearm_R / hand_R.
메쉬 모드는 외곽과 관절 중심으로 정점을 배치하고 가중치를 포함합니다. 파츠 분리 모드는 관절에서 잘라 겹침을 넣습니다. 접히는 부분이 어색하면 Spine에서 해당 파츠 순서(Draw Order)를 바꿔보세요.
parts.psd: 잘린 파츠를 PSD로 저장한 파일. 원화 담당자가 관절 부분을 다듬은 뒤 다시 불러올 수 있습니다.

[애니메이션]
${Object.keys(sk.animations).filter(k=>k!=='manual_pose').map(k=>`${k}: ${animationNames[k]||k}`).join('\n')}
현재 구도와 관절에 맞춘 FK 예시 모션입니다. 미리보기와 같게 하려고 이 동작들에서는 IK mix를 0으로 둡니다.
얼굴 점검은 기존 파츠의 이동·크기 변형입니다. 닫힌 눈이나 입 안 이미지를 새로 생성하지 않습니다.
manual_pose: 웹에서 맞춘 포즈.
manual_pose에는 웹에서 선택한 부위별 IK/FK와 목표 위치가 포함됩니다.
Spine에서는 해당 IK의 Mix가 1일 때 빨간 ik_ 뼈대를 움직이고, 0일 때 개별 본을 회전하세요.
`);
    download(new Blob([zipSync(files,{level:1})],{type:'application/zip'}),filename()+'-spine.zip');message(`Spine ZIP을 저장했어요. 파츠 ${list.length}개 · Unity 패키지 포함.`);
  }catch(e){message(e.message);}finally{$('rigSave').disabled=false;draw();}};
  const imageUrls=new WeakMap(),imageUrl=c=>{if(!c)return undefined;if(!imageUrls.has(c))imageUrls.set(c,c.toDataURL('image/png'));return imageUrls.get(c);};
  function currentProject(){
    if(!project)return false;const old=project.layers.map(l=>l.id),ids=state.layers.map(l=>l.id);
    if(old.length!==ids.length||ids.some(id=>!old.includes(id)))return false;
    const map=ids.map(id=>old.indexOf(id));
    if(map.some((v,i)=>v!==i)){
      project.rig.assignments=map.map(i=>project.rig.assignments[i]);project.rig.modes=map.map(i=>project.rig.modes[i]);
      for(const key of ['partBones','sleeves','armSplits'])if(project.rig[key])project.rig[key]=Object.fromEntries(map.flatMap((old,i)=>project.rig[key][old]!==undefined?[[i,project.rig[key][old]]]:[]));
      project.source=map.map(i=>project.source[i]);
    }
    const meta=state.layers.map(metadata);if(artworkChanged(project.layers,state.layers)||JSON.stringify(meta)!==JSON.stringify(project.meta)||map.some((v,i)=>v!==i)){cached=null;cachedParts=null;motionView=null;project.fill=null;}
    project.layers=state.layers;project.meta=meta;project.ids=ids.join('|');return true;
  }
  function snapshotProject(){if(!currentProject())return null;return {format:'layer-studio-rig-v2',artworkReview:state.artworkReview||null,pipeline:state.pipeline,artSource:state.artSource,artCandidate:state.artCandidate,name:state.name,syncId:project.syncId??=crypto.randomUUID(),original:imageUrl(state.reference),rig:project.rig,strength:Number($('rigStrength').value),amplitude:Number($('rigAmplitude').value),pixelsProcessed:true,seams:$('rigSeams').checked,fill:project.fill?.key===fillKey()?{armSignature:armFillSignature(project.rig),images:Object.fromEntries(Object.entries(project.fill.images).map(([k,data])=>{const part=parts().find(p=>p.slot===k);if(!part)return [k,null];const c=canvas(part.width,part.height);c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data),part.width,part.height),0,0);return [k,c.toDataURL('image/png')];}).filter(([,v])=>v))}:null,layers:project.layers.map((l,i)=>({...project.meta[i],image:imageUrl(l.canvas)}))};}
  $('rigProjectSave').onclick=()=>{const saved=snapshotProject();download(new Blob([JSON.stringify(saved)],{type:'application/json'}),filename()+'-rig-project.json');message('관절·파츠·포즈를 저장했어요. 편집 프로젝트 열기로 이어갈 수 있습니다.');};
  $('rigProjectOpen').onclick=()=>$('rigProjectInput').click();
  async function restoreProject(saved){cancelArmGuide();if(processing)throw Error('경계 처리가 끝난 뒤 열어주세요.');validateProject(saved);$('manualPartsChecked').checked=$('manualAssemblyChecked').checked=false;state.artworkReview=saved.artworkReview||null;state.pipeline=normalizeReport(saved.pipeline);state.artStamp=null;state.artCandidate=Array.isArray(saved.artCandidate)?saved.artCandidate:null;state.artSource=saved.artSource||null;let total=0;const layers=[];
    for(const l of saved.layers){const bytes=Uint8Array.from(atob(l.image.slice(22)),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));total+=bitmap.width*bitmap.height;if(total>40_000_000||bitmap.width!==l.width||bitmap.height!==l.height){bitmap.close();throw Error('이미지 크기가 프로젝트 정보와 맞지 않아요.');}const c=canvas(bitmap.width,bitmap.height);c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();layers.push({...l,id:crypto.randomUUID(),canvas:c});}
    stop();const original=canvas(saved.rig.width,saved.rig.height),ctx=original.getContext('2d');for(const l of [...layers].reverse()){if(l.visible){ctx.globalAlpha=l.opacity;ctx.drawImage(l.canvas,l.x,l.y);}}let reference=null;if(typeof saved.original==='string'&&saved.original.startsWith('data:image/png;base64,')){const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(saved.original.slice(22)),c=>c.charCodeAt(0))],{type:'image/png'}));if(bitmap.width===saved.rig.width&&bitmap.height===saved.rig.height){reference=canvas(bitmap.width,bitmap.height);reference.getContext('2d').drawImage(bitmap,0,0);}bitmap.close();}
    state.frameHint=saved.rig.frame||'auto';$('frameHint').value=state.frameHint;$('rigTemplateSelect').value=saved.rig.frame||'full';state.reference=reference;state.layers=layers;state.width=original.width;state.height=original.height;state.original=reference||original;state.name=saved.name||'관절 프로젝트';state.kind='관절 프로젝트';state.view='composite';state.selected=layers[0].id;
    project={syncId:saved.syncId||crypto.randomUUID(),ids:layers.map(l=>l.id).join('|'),source:layers,layers,meta:layers.map(metadata),rig:upgradeRig({limbStyle:'mesh',ik:true,...saved.rig}),removed:0};const split=state.pipeline||project.rig.artPrepared?{changed:false}:splitLegLayers(layers.map((l,i)=>({...project.meta[i],...l,data:pixels(l.canvas)})),project.rig);
    if(split.changed){const separated=split.layers.map(l=>{if(l.canvas)return layers[l.sourceIndex];const c=canvas(l.width,l.height);c.getContext('2d').putImageData(new ImageData(l.data,l.width,l.height),0,0);return {...l,canvas:c};});project.layers=project.source=state.layers=separated;project.meta=separated.map(metadata);project.ids=separated.map(l=>l.id).join('|');state.selected=separated[0].id;}
    if(!state.pipeline&&!project.rig.artPrepared){upgradeGarments(project.rig,project.meta);restoreArmChains(project.rig,reviewLayers());}const addedFace=!state.pipeline&&!project.rig.artPrepared&&extendHalfFace(project.rig,project.layers.map((l,i)=>({...project.meta[i],data:pixels(l.canvas)})));initializeControls(project.rig);if(!state.pipeline&&!project.rig.artPrepared&&project.rig.frame!=='bust')initSleeves(project.layers.map((l,i)=>({...project.meta[i],data:pixels(l.canvas)})),project.rig);history=[];future=[];dirty();render();$('rigStrength').value=String(saved.strength??1);$('rigAmplitude').value=String(saved.amplitude??1);$('rigMode').value='setup';$('rigSeams').checked=saved.seams!==false;menus('body');if(!$('rigDialog').open)$('rigDialog').showModal();if(!state.pipeline&&!saved.pixelsProcessed)await cleanup();if(saved.fill?.images&&(!Object.values(project.rig.armSplits||{}).some(c=>c.reconstruct)||saved.fill.armSignature===armFillSignature(project.rig))){const images={};for(const [slot,url]of Object.entries(saved.fill.images)){const part=parts().find(p=>p.slot===slot);if(!part?.fill||typeof url!=='string'||!url.startsWith('data:image/png;base64,'))continue;const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(url.slice(22)),c=>c.charCodeAt(0))],{type:'image/png'}));if(bitmap.width!==part.width||bitmap.height!==part.height){bitmap.close();throw Error('저장된 이음새 이미지 크기가 맞지 않아요.');}const c=canvas(part.width,part.height);c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();images[slot]=pixels(c);}project.fill={key:fillKey(),images};dirty();draw();}message(addedFace?'기존 상체·팔 리깅을 유지하고 얼굴 관절을 추가했어요. 얼굴 파츠를 선택해 조절할 수 있습니다.':'저장한 보정 파츠·관절·포즈를 불러왔어요.');
  }
  $('rigProjectInput').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>60*1024*1024)throw Error('편집 프로젝트는 60MB 이하로 열어주세요.');state.recoveryId=crypto.randomUUID();await restoreProject(JSON.parse(await file.text()));}catch(err){toast(err.message);}finally{e.target.value='';}};
  $('rigPsdSave').onclick=()=>{if(!currentProject()||processing)return;try{const bytes=writePsd(psdDocument(parts(),project.rig.width,project.rig.height),{generateThumbnail:false});download(new Blob([bytes],{type:'image/vnd.adobe.photoshop'}),filename()+'-parts.psd');message('보정된 소매·맨팔까지 그룹 PSD로 저장했어요.');}catch(e){message(`PSD 저장 실패: ${e.message}`);}};
  $('rigAudit').onclick=()=>{if(!currentProject()||processing)return;if(state.pipeline&&!artAllowsRig(state.pipeline)){message('파츠 구조·복원 검사를 먼저 통과해주세요.');return;}stop();const result=auditRig(parts(),project.rig,skeleton());if(state.pipeline){state.pipeline=completeRigReview(state.pipeline,result);render();}$('rigAuditSummary').textContent=`${result.parts}개 파츠 · ${result.poses}개 굽힘 시험 · 확인 항목 ${result.issues.length}개`;$('rigAuditResults').replaceChildren(...result.issues.map(issue=>{const li=document.createElement('li'),button=document.createElement('button');button.className='button subtle';button.textContent=issue.part;button.onclick=()=>{const part=parts().find(p=>p.name===issue.part);if(part){$('rigLayer').value=String(part.source);binding();$('rigTabParts').click();}};li.append(button,document.createTextNode(issue.message));return li;}));if(!result.issues.length)$('rigAuditResults').textContent='검사 항목에서 이상을 찾지 못했어요. 겹침·틈·그림 품질은 포즈를 보며 확인해주세요.';};
  $('rigApply').onclick=()=>{if(!project)return;state.layers=project.layers;state.kind='관절 편집 완료';state.view='composite';render();$('rigDialog').close();toast('보정 파츠를 적용했어요. 관절 편집은 다시 열어 이어갈 수 있습니다.');};
  $('rigAnim').replaceChildren(...Object.entries(animationNames).map(([k,v])=>new Option(v,k)));
  spinePreview=installSpinePreview({download,canSend:()=>!!project&&!processing&&!state.busy&&exportAllowed(state.pipeline),snapshot:()=>({name:state.name,projectId:project.syncId??=crypto.randomUUID(),skeleton:skeleton(),parts:parts()})});
  $('rigDialog').addEventListener('close',()=>{cancelHandSelection();cancelArmGuide();spinePreview.update();});
  features=installRigFeatures({getProject:()=>project,isBusy:()=>processing||state.busy,pixels,selected,poseMode,remember,dirty,fields,menus,draw,stop,message,selectJoint,download,beforeFace:cleanup,viewScale});
  $('rigFaceRebuild').onclick=async()=>{if(processing||state.busy)return;$('rigSeams').checked=true;await features.applyTemplate('bust');};
  $('autoRigBtn').onclick=()=>prepare({detect:false});return {prepare,snapshot:snapshotProject,restore:restoreProject,artworkChanged:()=>{if(currentProject()){project.source=state.layers.map(l=>({...l}));project.fill=null;project.hiddenKey=null;dirty();}},exportLayers:()=>currentProject()?parts():null,isProcessing:()=>processing,repair:async()=>{await prepare({detect:false});if(!project)return;$('rigSeams').checked=true;await cleanup();$('rigDialog').close();toast(`접합선 ${project.seamPixels||0}픽셀 정리 · 목 빈틈 ${project.neckGapPixels||0}픽셀 보완. 레이어 PSD·PNG에도 반영됩니다.`);},update:()=>{$('autoRigBtn').disabled=state.busy||state.layers.length<2;$('rigProjectOpen').disabled=state.busy;spinePreview.update();}};
}
export function validateProject(s){
  const finite=n=>typeof n==='number'&&Number.isFinite(n),positive=n=>Number.isInteger(n)&&n>0&&n<=8192;
  if(s?.format!=='layer-studio-rig-v2'||!Array.isArray(s.layers)||!s.layers.length||s.layers.length>100||!s.rig||!positive(s.rig.width)||!positive(s.rig.height)||s.rig.width*s.rig.height>16_000_000)throw Error('올바른 관절 편집 프로젝트가 아닙니다.');
  if(s.syncId!==undefined&&!/^[a-f0-9-]{36}$/.test(s.syncId))throw Error('연결 프로젝트 번호가 올바르지 않습니다.');
  validateArmSplits(s.rig,s.layers.length);const r=s.rig,names=Object.keys(r.points||{});if(names.length>64||!Array.isArray(r.assignments)||!Array.isArray(r.modes)||r.assignments.length!==s.layers.length||r.modes.length!==s.layers.length||!r.parents||!r.labels||!r.pose)throw Error('관절 정보가 올바르지 않습니다.');
  if(r.limbStyle!==undefined&&!['cutout','mesh'].includes(r.limbStyle)||r.ik!==undefined&&typeof r.ik!=='boolean')throw Error('리깅 방식 설정이 올바르지 않습니다.');
  for(const id of Object.keys(boneLabels))if(!r.points[id]&&!id.startsWith('face_')&&id!=='upper'&&id!=='pelvis')throw Error('기본 관절이 누락되었습니다.');
  for(const id of names){const p=r.points[id];if(!(Object.hasOwn(boneLabels,id)||/^joint_\d+$/.test(id))||!finite(p.x)||!finite(p.y)||p.x<0||p.y<0||p.x>r.width||p.y>r.height||typeof r.labels[id]!=='string'||r.labels[id].length>80||(id!=='root'&&!names.includes(r.parents[id])))throw Error('관절 좌표 또는 연결이 올바르지 않습니다.');}
  if(r.parents.root)throw Error('전체 기준의 부모는 지정할 수 없습니다.');boneOrder(r);validateControls(r);
  if(r.meshDensity!==undefined&&!['simple','balanced','fine'].includes(r.meshDensity))throw Error('메쉬 밀도를 확인해주세요.');
  if(r.partBones!==undefined){if(!r.partBones||typeof r.partBones!=='object'||Array.isArray(r.partBones))throw Error('파츠별 본 설정을 확인해주세요.');for(const [i,ids]of Object.entries(r.partBones))if(!/^\d+$/.test(i)||Number(i)>=s.layers.length||!Array.isArray(ids)||!ids.length||ids.length>names.length||ids.some(id=>!names.includes(id)))throw Error('파츠에 연결된 본을 확인해주세요.');}
  if(r.sleeves!==undefined){
    if(!r.sleeves||typeof r.sleeves!=='object'||Array.isArray(r.sleeves))throw Error('소매 분리 설정을 확인해주세요.');
    for(const [i,c]of Object.entries(r.sleeves))if(!/^\d+$/.test(i)||Number(i)>=s.layers.length||!c||typeof c.enabled!=='boolean'||!c.point||!c.normal||![c.point.x,c.point.y,c.normal.x,c.normal.y,c.offset,c.angle].every(finite)||Math.abs(c.point.x)>8192||Math.abs(c.point.y)>8192||Math.abs(Math.hypot(c.normal.x,c.normal.y)-1)>.01||Math.abs(c.offset)>80||Math.abs(c.angle)>45||![c.skin,c.cloth].every(rgb=>Array.isArray(rgb)&&rgb.length===3&&rgb.every(v=>finite(v)&&v>=0&&v<=255)))throw Error('소매 경계 정보가 올바르지 않습니다.');
  }
  if(r.weightBlend!==undefined){if(!r.weightBlend||typeof r.weightBlend!=='object'||Array.isArray(r.weightBlend))throw Error('가중치 설정을 확인해주세요.');for(const [id,v]of Object.entries(r.weightBlend))if(!names.includes(id)||!finite(v)||v<.35||v>2)throw Error('가중치 부드러움 범위를 확인해주세요.');}
  for(const [id,a]of Object.entries(r.pose))if(!names.includes(id)||!finite(a)||Math.abs(a)>180)throw Error('포즈 각도를 확인해주세요.');
  for(const [i,l]of s.layers.entries())if(typeof l.name!=='string'||typeof l.image!=='string'||!l.image.startsWith('data:image/png;base64,')||!positive(l.width)||!positive(l.height)||!finite(l.x)||!finite(l.y)||Math.abs(l.x)>8192||Math.abs(l.y)>8192||!finite(l.opacity)||l.opacity<0||l.opacity>1||typeof l.visible!=='boolean'||!names.includes(r.assignments[i])||!['split_arms','crossed_arms','face','rigid','torso','neck','bottoms','sleeve_left','sleeve_right','arm_left','arm_right','legs','feet','leg_left','leg_right','foot_left','foot_right'].includes(r.modes[i]))throw Error('파츠 정보가 올바르지 않습니다.');
  for(const key of ['strength','amplitude'])if(!finite(s[key])||s[key]<0||s[key]>2)throw Error('보정 또는 동작 설정이 올바르지 않습니다.');
}
