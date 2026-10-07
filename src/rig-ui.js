import {cleanPixels,inferRig,makeSkeleton,poseMatrices,boneLabels} from './rig-core.js';
import {zipSync,strToU8} from 'fflate';
export function installRigUI({state,canvas,canvasBlob,download,toast,render}){
  const $=id=>document.getElementById(id);let project=null,playing=false,raf=0,started=0;
  const metadata=l=>({name:l.name,x:l.x,y:l.y,width:l.canvas.width,height:l.canvas.height,opacity:l.opacity,visible:l.visible});
  const stop=()=>{playing=false;cancelAnimationFrame(raf);$('rigPlay').textContent='대기 모션 재생';};
  async function prepare(){
    if(state.busy)return;
    if(state.layers.length<2){toast('먼저 AI로 파츠를 분리하거나 레이어 PSD를 불러와주세요.');return;}
    try{
      const source=state.layers.map(l=>({...l})),meta=source.map(metadata),rig=inferRig(meta,state.width,state.height);
      project={source,layers:source,rig,meta,removed:0};
      $('rigBone').replaceChildren(...Object.entries(boneLabels).filter(([k])=>k!=='root').map(([value,label])=>new Option(label,value)));
      $('rigLayer').replaceChildren(...meta.map((l,i)=>new Option(l.name,String(i))));
      $('rigBind').replaceChildren(...Object.entries(boneLabels).map(([value,label])=>new Option(label,value)));
      $('rigStrength').value='1';$('rigAmplitude').value='1';$('rigStatus').textContent='경계를 정리하고 있어요…';$('rigDialog').showModal();
      await new Promise(r=>setTimeout(r,30));await cleanup();updateFields();updateBinding();
    }catch(e){project=null;toast(e.message);}
  }
  async function cleanup(){
    stop();const next=[];let removed=0;$('rigClean').disabled=true;$('rigSave').disabled=true;$('rigApply').disabled=true;
    try{for(const l of project.source){const c=canvas(l.canvas.width,l.canvas.height),ctx=c.getContext('2d');ctx.drawImage(l.canvas,0,0);
      const pixels=ctx.getImageData(0,0,c.width,c.height),result=cleanPixels(pixels.data,c.width,c.height,Number($('rigStrength').value));pixels.data.set(result.data);ctx.putImageData(pixels,0,0);removed+=result.removed;next.push({...l,canvas:c});await new Promise(r=>setTimeout(r,0));}
      project.layers=next;project.removed=removed;$('rigStatus').textContent=`${next.length}개 파츠 · 작은 점 ${removed}px 정리 · 6개 뼈대 · 4초 대기 동작`;draw();
    }finally{$('rigClean').disabled=false;$('rigSave').disabled=false;$('rigApply').disabled=false;}
  }
  function skeleton(){return makeSkeleton(project.meta,project.rig,Number($('rigAmplitude').value));}
  function draw(time=null){
    if(!project)return;const c=$('rigCanvas'),ctx=c.getContext('2d'),{width,height}=project.rig;c.width=width;c.height=height;
    const sk=skeleton(),mat=poseMatrices(sk,time);
    for(let i=project.layers.length-1;i>=0;i--){const l=project.layers[i];if(!l.visible)continue;const bone=project.rig.assignments[i],p=project.rig.points[bone],q=mat[bone];
      ctx.save();ctx.translate(width/2,height);ctx.transform(q[0],-q[1],-q[2],q[3],q[4],-q[5]);ctx.globalAlpha=l.opacity;ctx.drawImage(l.canvas,l.x-p.x,l.y-p.y);ctx.restore();}
    if($('rigShowBones').checked&&time===null){ctx.strokeStyle='#036f61';ctx.fillStyle='#74e6cf';ctx.lineWidth=2;
      for(const b of sk.bones){const p=project.rig.points[b.name];if(b.parent&&b.parent!=='root'){const parent=project.rig.points[b.parent];ctx.beginPath();ctx.moveTo(parent.x,parent.y);ctx.lineTo(p.x,p.y);ctx.stroke();}
        if(b.name!=='root'){ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill();ctx.stroke();}}
      const p=project.rig.points[$('rigBone').value];ctx.strokeStyle='#e58121';ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x,p.y,10,0,Math.PI*2);ctx.stroke();
    }
  }
  function updateFields(){if(!project)return;const p=project.rig.points[$('rigBone').value];$('rigX').value=Math.round(p.x);$('rigY').value=Math.round(p.y);draw();}
  function updateBinding(){$('rigBind').value=project.rig.assignments[Number($('rigLayer').value)];}
  function setPoint(x,y){const {width,height}=project.rig;if(!Number.isFinite(x)||!Number.isFinite(y))return;stop();project.rig.points[$('rigBone').value]={x:Math.max(0,Math.min(width,x)),y:Math.max(0,Math.min(height,y))};updateFields();}
  $('rigCanvas').onclick=e=>{if(!project||playing)return;const r=e.currentTarget.getBoundingClientRect();setPoint((e.clientX-r.left)/r.width*project.rig.width,(e.clientY-r.top)/r.height*project.rig.height);};
  $('rigX').onchange=$('rigY').onchange=()=>setPoint(Number($('rigX').value),Number($('rigY').value));
  $('rigBone').onchange=()=>{stop();updateFields();};$('rigLayer').onchange=updateBinding;
  $('rigBind').onchange=()=>{project.rig.assignments[Number($('rigLayer').value)]=$('rigBind').value;stop();draw();};
  $('rigClean').onclick=()=>cleanup().catch(e=>toast(e.message));$('rigShowBones').onchange=()=>{stop();draw();};$('rigAmplitude').oninput=()=>{if(!playing)draw();};
  $('rigPlay').onclick=()=>{if(playing){stop();draw();return;}playing=true;started=performance.now();$('rigPlay').textContent='정지 · 관절 편집';const frame=now=>{draw((now-started)/1000);raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);};
  $('rigDialog').onclose=stop;
  $('rigSave').onclick=async()=>{
    if(!project)return;stop();$('rigSave').disabled=true;
    try{const files={'skeleton.json':strToU8(JSON.stringify(skeleton(),null,2))};for(const [i,l]of project.layers.entries())files[`images/part_${String(i+1).padStart(2,'0')}.png`]=new Uint8Array(await(await canvasBlob(l.canvas)).arrayBuffer());
      files['layer-map.json']=strToU8(JSON.stringify({layers:project.meta.map((l,i)=>({...l,path:`images/part_${String(i+1).padStart(2,'0')}.png`,bone:project.rig.assignments[i]})),points:project.rig.points},null,2));
      files['사용법.txt']=strToU8('Layer Studio 자동 보정 · 기본 리그\n\n1. ZIP 전체를 압축 해제하세요.\n2. Spine 4.0 이상: Spine 메뉴 → 데이터 가져오기(Import Data) → skeleton.json.\n3. 이미지가 안 보이면 이미지 경로를 함께 들어 있는 images 폴더로 지정하세요.\n4. 애니메이션 모드에서 idle을 재생하세요.\n\n6개 기본 뼈대와 4초 대기 동작입니다. 다리는 고정되어 있고 팔꿈치·무릎 분할, IK, 메쉬 웨이트는 포함하지 않습니다.\n정면 전신 캐릭터용 위치 추정이므로 다른 포즈는 관절과 파츠 연결을 확인하세요.\n경계 처리는 작은 고립 점 제거·알파 경계 다듬기·반투명 경계 색상 보정입니다. 가려진 부위를 새로 그리는 기능은 아닙니다.\n');
      download(new Blob([zipSync(files,{level:1})],{type:'application/zip'}),(state.name||'character').replace(/[\\/:*?"<>|]/g,'_')+'-spine.zip');
      toast('뼈대·대기 동작·보정 PNG를 담은 Spine ZIP을 저장했어요.');
    }catch(e){toast(e.message);}finally{$('rigSave').disabled=false;draw();}
  };
  $('rigApply').onclick=()=>{if(!project)return;state.layers=project.layers;state.kind='경계 보정 완료';state.view='composite';render();$('rigDialog').close();toast('보정 파츠를 적용했어요. PSD 저장으로 보관할 수 있어요.');};
  $('autoRigBtn').onclick=prepare;
  return {prepare,update:()=>{$('autoRigBtn').disabled=state.busy||state.layers.length<2;}};
}
