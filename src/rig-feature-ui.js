import {activeIds,chainDefs,chainLabels,chainFor,availableChain} from './rig-scope.js';
import {motionPoints,setChainMode,solveChain,solvePinned,rotateJoint,wrapAngle} from './rig-motion.js';
import {templateKinds,applyBuiltin,applyRigTemplate,createRigTemplate,readTemplates,saveTemplate,templateStorageKey,validateTemplate} from './rig-templates.js';
import {initSleeves} from './garment-parts.js';

export function installRigFeatures({getProject,isBusy,pixels,selected,poseMode,remember,dirty,fields,menus,draw,stop,message,selectJoint,download}){
  const $=id=>document.getElementById(id),rig=()=>getProject()?.rig;
  const controls={arm_left:'rigControlArmLeft',arm_right:'rigControlArmRight',leg_left:'rigControlLegLeft',leg_right:'rigControlLegRight'};
  let drag=null,templates=readTemplates(localStorage);
  const scale=()=>rig().width/Math.max(200,$('rigCanvas').getBoundingClientRect().width);
  function controlFields(){
    const r=rig();if(!r)return;
    for(const [key,id]of Object.entries(controls)){$(id).disabled=!availableChain(r,key);$(id).value=r.ikModes?.[key]||'fk';}
    const key=chainFor(selected()),ik=key&&availableChain(r,key)&&r.ikModes?.[key]==='ik';$('rigBendFlip').disabled=!ik||!poseMode();
    $('rigControlNote').textContent=ik?'손·발은 고정한 채 팔꿈치·무릎의 굽힘 방향을 바꿀 수 있어요. 각도를 직접 수정하면 해당 부위만 FK로 전환됩니다.':'회전은 자식 관절에도 전달됩니다. 회색 부위는 관절이 없거나 중간에 추가 본이 있어 2관절 IK를 사용할 수 없어요.';
    $('rigGestureHint').textContent=poseMode()?'주황 손잡이: 회전 · 파란 사각점: IK 이동':'점을 끌어 이동 · 방향키 1px · Shift 10px';
  }
  for(const [key,id]of Object.entries(controls))$(id).onchange=()=>{
    if(!rig()||isBusy())return;stop();remember();if(!setChainMode(rig(),key,$(id).value))return;
    $('rigMode').value='pose';$('rigIK').checked=rig().ik!==false;dirty();fields();message(`${chainLabels[key]} · ${$(id).value.toUpperCase()}로 전환했어요. 현재 포즈는 유지됩니다.`);
  };
  $('rigBendFlip').onclick=()=>{const r=rig(),key=chainFor(selected());if(!r||isBusy()||!key||r.ikModes?.[key]!=='ik')return;remember();r.ikBends??={};r.ikBends[key]=-(r.ikBends[key]||1);solveChain(r,key,r.ikTargets?.[key]||motionPoints(r)[chainDefs[key][2]]);dirty();fields();};
  function overlay(ctx,time){
    if(time!==null||!poseMode()||!rig()||!$('rigShowBones').checked)return;const r=rig(),points=motionPoints(r),s=scale();ctx.save();
    for(const [key,ids]of Object.entries(chainDefs))if(availableChain(r,key)&&r.ikModes?.[key]==='ik'){
      const p=points[ids[2]];ctx.fillStyle='#e0f7ff';ctx.strokeStyle='#0575bf';ctx.lineWidth=2*s;ctx.fillRect(p.x-7*s,p.y-7*s,14*s,14*s);ctx.strokeRect(p.x-7*s,p.y-7*s,14*s,14*s);
    }
    const p=points[selected()];if(p){ctx.strokeStyle='#cb6a00';ctx.fillStyle='#ffe0a0';ctx.lineWidth=1.5*s;ctx.setLineDash([3*s,3*s]);ctx.beginPath();ctx.arc(p.x,p.y,32*s,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+32*s,p.y);ctx.stroke();ctx.beginPath();ctx.arc(p.x+32*s,p.y,6*s,0,Math.PI*2);ctx.fill();ctx.stroke();}
    ctx.restore();
  }
  function pointerDown(e,pos,nearest){
    const r=rig();if(!r||!poseMode()||isBusy())return false;stop();const points=motionPoints(r),p=points[selected()],s=scale();
    const handle=p&&Math.hypot(pos.x-p.x-32*s,pos.y-p.y)<11*s;
    if(!handle&&!nearest)return false;const id=handle?selected():nearest;selectJoint(id,true);const key=chainFor(id),ik=!handle&&key&&r.ikModes?.[key]==='ik'&&chainDefs[key][2]===id;
    const pivot=points[id];remember();drag={id,key,ik,pivot,startPose:r.pose[id]||0,angle:Math.hypot(pos.x-pivot.x,pos.y-pivot.y)>4*s?Math.atan2(pos.y-pivot.y,pos.x-pivot.x):null};
    $('rigCanvas').setPointerCapture(e.pointerId);$('rigCanvas').focus();e.preventDefault();return true;
  }
  function pointerMove(pos){
    if(!drag)return false;const r=rig();
    if(drag.ik){solveChain(r,drag.key,pos);solvePinned(r);}else{
      const a=Math.atan2(pos.y-drag.pivot.y,pos.x-drag.pivot.x);if(Math.hypot(pos.x-drag.pivot.x,pos.y-drag.pivot.y)<4*scale())return true;
      if(drag.angle===null){drag.angle=a;return true;}
      rotateJoint(r,drag.id,wrapAngle(drag.startPose-(a-drag.angle)*180/Math.PI));
    }dirty();fields();return true;
  }
  function pointerEnd(e){if(!drag)return false;drag=null;if($('rigCanvas').hasPointerCapture(e.pointerId))$('rigCanvas').releasePointerCapture(e.pointerId);return true;}
  function templateMenu(value=$('rigTemplateSelect').value){
    $('rigTemplateSelect').replaceChildren(...Object.entries(templateKinds).map(([key,name])=>new Option(name,key)),...templates.map((t,i)=>new Option(`내 템플릿 · ${t.name}`,`custom:${i}`)));
    if([...$('rigTemplateSelect').options].some(o=>o.value===value))$('rigTemplateSelect').value=value;
    $('rigTemplateDelete').disabled=!$('rigTemplateSelect').value.startsWith('custom:');
  }
  const sourceLayers=()=>getProject().layers.map((l,i)=>({...getProject().meta[i],data:pixels(l.canvas)}));
  const report=text=>{$('rigTemplateReport').textContent=text;message(text);};
  $('rigTemplateSelect').onchange=()=>{$('rigTemplateDelete').disabled=!$('rigTemplateSelect').value.startsWith('custom:');};
  $('rigTemplateApply').onclick=()=>{
    if(!rig()||isBusy())return;try{stop();const value=$('rigTemplateSelect').value,layers=sourceLayers(),result=value.startsWith('custom:')?applyRigTemplate(templates[Number(value.slice(7))],layers,rig().width,rig().height):applyBuiltin(value,layers,rig().width,rig().height);
      initSleeves(layers,result.rig);for(const [key,mode]of Object.entries(result.rig.ikModes))if(mode==='ik')setChainMode(result.rig,key,'ik');
      remember();getProject().rig=result.rig;dirty();$('rigMode').value='setup';menus('head');draw();
      report(`${activeIds(result.rig).length-1}개 관절 · 파츠 ${result.matched}개 연결 · 메쉬·가중치 재계산 완료.${result.unmatched.length?` 자동 연결을 확인할 항목: ${result.unmatched.join(', ')}`:' 관절 위치를 확인하고 필요한 점만 옮겨주세요.'}`);
    }catch(e){report(e.message);}
  };
  const currentTemplate=()=>createRigTemplate(rig(),getProject().meta,$('rigTemplateName').value||'내 리깅');
  $('rigTemplateSave').onclick=()=>{if(!rig()||isBusy())return;try{const t=currentTemplate();templates=saveTemplate(localStorage,t);templateMenu(`custom:${templates.findIndex(x=>x.name===t.name)}`);report(`‘${t.name}’ 저장 완료. 다른 파츠 이미지를 열고 이 템플릿을 적용하세요. 같은 이름은 갱신됩니다.`);}catch(e){report(`저장 실패: ${e.message} 템플릿 파일 저장도 사용할 수 있어요.`);}};
  $('rigTemplateExport').onclick=()=>{if(!rig()||isBusy())return;try{const t=currentTemplate();download(new Blob([JSON.stringify(t,null,2)],{type:'application/json'}),`${t.name.replace(/[^\p{L}\p{N}_-]/gu,'_')}-rig-template.json`);report('이미지 없이 리깅 규칙만 템플릿 파일로 저장했어요.');}catch(e){report(e.message);}};
  $('rigTemplateImport').onclick=()=>$('rigTemplateInput').click();
  $('rigTemplateInput').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>200_000)throw Error('템플릿 파일은 200KB 이하로 열어주세요.');const t=validateTemplate(JSON.parse(await file.text()));templates=saveTemplate(localStorage,t);templateMenu(`custom:${templates.findIndex(x=>x.name===t.name)}`);$('rigTemplateName').value=t.name;report(`‘${t.name}’을 불러왔어요. 현재 이미지에 자동 맞춤을 눌러 적용하세요.`);}catch(e){report(e.message);}finally{$('rigTemplateInput').value='';}};
  $('rigTemplateDelete').onclick=()=>{const value=$('rigTemplateSelect').value;if(!value.startsWith('custom:'))return;try{const next=templates.filter((_,i)=>i!==Number(value.slice(7)));localStorage.setItem(templateStorageKey,JSON.stringify(next));templates=next;templateMenu('full');report('선택한 내 템플릿을 삭제했어요. 현재 리깅은 유지됩니다.');}catch(e){report(e.message);}};
  templateMenu();return {controlFields,overlay,pointerDown,pointerMove,pointerEnd};
}
