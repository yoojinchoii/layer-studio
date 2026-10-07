import {cleanPixels,inferRig,makeSkeleton,poseMatrices,boneLabels,meshWorldVertices,addJoint,deleteJoint,setParent,boneOrder} from './rig-core.js';
import {zipSync,strToU8} from 'fflate';
export function installRigUI({state,canvas,canvasBlob,download,toast,render}){
  const $=id=>document.getElementById(id);let project=null,playing=false,processing=false,raf=0,started=0,cached=null,drag=null,history=[];
  const metadata=l=>({name:l.name,x:l.x,y:l.y,width:l.canvas.width,height:l.canvas.height,opacity:l.opacity,visible:l.visible});
  const stop=()=>{playing=false;cancelAnimationFrame(raf);$('rigPlay').textContent='대기 모션 재생';};
  const message=text=>{$('rigStatus').textContent=text;};
  const dirty=()=>{cached=null;};
  const remember=()=>{history.push(JSON.stringify(project.rig));if(history.length>40)history.shift();$('rigUndo').disabled=false;};
  const poseMode=()=>$('rigMode').value==='pose';
  const selected=()=>$('rigBone').value;
  const status=()=>message(`${project.layers.length}개 파츠 · ${Object.keys(project.rig.points).length}개 관절 · 작은 점 ${project.removed}px 정리`);
  function menus(id=selected()||'body'){
    const opts=()=>boneOrder(project.rig).filter(k=>k!=='root').map(k=>new Option(project.rig.labels[k]||k,k));
    $('rigBone').replaceChildren(...opts());$('rigBone').value=project.rig.points[id]?id:'body';
    $('rigParent').replaceChildren(new Option('전체 기준','root'),...opts());
    $('rigBind').replaceChildren(new Option('전체 기준','root'),...opts());
    $('rigLayer').replaceChildren(...project.meta.map((l,i)=>new Option(l.name,String(i))));fields();binding();status();
  }
  async function prepare(){
    if(state.busy||processing)return;if(state.layers.length<2){toast('먼저 AI로 파츠를 분리하거나 레이어 PSD를 불러와주세요.');return;}
    try{
      // Retain edits when reopening the same project; discard only on a real layer/source change.
      const same=project&&project.ids===state.layers.map(l=>l.id).join('|');
      if(!same){const source=state.layers.map(l=>({...l})),meta=source.map(metadata);project={ids:state.layers.map(l=>l.id).join('|'),source,layers:source,rig:inferRig(meta,state.width,state.height),meta,removed:0};history=[];$('rigStrength').value='1';$('rigAmplitude').value='1';}
      else{project.meta=state.layers.map(metadata);const ids=project.source.map(l=>l.id);project.source=state.layers.map(l=>({...l,canvas:project.source[ids.indexOf(l.id)]?.canvas||l.canvas}));project.layers=project.layers.map((l,i)=>({...l,...project.meta[i]}));}
      dirty();$('rigMode').value='setup';menus();$('rigDialog').showModal();if(!same){message('경계를 정리하고 있어요…');await new Promise(r=>setTimeout(r,30));await cleanup();}draw();
    }catch(e){message(e.message);toast(e.message);}
  }
  async function cleanup(){
    stop();processing=true;$('rigProjectOpen').disabled=true;const next=[];let removed=0;for(const id of ['rigClean','rigSave','rigApply','rigProjectSave'])$(id).disabled=true;
    try{for(const l of project.source){const c=canvas(l.canvas.width,l.canvas.height),ctx=c.getContext('2d');ctx.drawImage(l.canvas,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height),r=cleanPixels(pixels.data,c.width,c.height,Number($('rigStrength').value));pixels.data.set(r.data);ctx.putImageData(pixels,0,0);removed+=r.removed;next.push({...l,canvas:c});await new Promise(r=>setTimeout(r,0));}project.layers=next;project.removed=removed;status();draw();}
    finally{processing=false;$('rigProjectOpen').disabled=state.busy;for(const id of ['rigClean','rigSave','rigApply','rigProjectSave'])$(id).disabled=false;}
  }
  function skeleton(){if(!cached)cached=makeSkeleton(project.meta,project.rig,Number($('rigAmplitude').value));return cached;}
  function triangle(ctx,img,src,dst){
    const [s0,s1,s2]=src,[d0,d1,d2]=dst,ax=s1[0]-s0[0],ay=s1[1]-s0[1],bx=s2[0]-s0[0],by=s2[1]-s0[1],det=ax*by-ay*bx;if(Math.abs(det)<.00001)return;
    const dx=d1[0]-d0[0],dy=d1[1]-d0[1],ex=d2[0]-d0[0],ey=d2[1]-d0[1],a=(dx*by-ex*ay)/det,c=(ex*ax-dx*bx)/det,b=(dy*by-ey*ay)/det,d=(ey*ax-dy*bx)/det;
    ctx.save();ctx.beginPath();const cx=(d0[0]+d1[0]+d2[0])/3,cy=(d0[1]+d1[1]+d2[1])/3;
    // Slightly overlap clipped triangles to avoid antialias seams on the shared edges.
    dst.forEach(([x,y],i)=>{const len=Math.hypot(x-cx,y-cy)||1,xx=x+(x-cx)/len*.35,yy=y+(y-cy)/len*.35;i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);});ctx.closePath();ctx.clip();ctx.transform(a,b,c,d,d0[0]-a*s0[0]-c*s0[1],d0[1]-b*s0[0]-d*s0[1]);ctx.drawImage(img,0,0);ctx.restore();
  }
  function matrices(time=null){return poseMatrices(skeleton(),time,time===null&&poseMode()?project.rig.pose:{});}
  function jointPositions(time=null){const m=matrices(time);return Object.fromEntries(Object.entries(m).map(([k,q])=>[k,{x:project.rig.width/2+q[4],y:project.rig.height-q[5]}]));}
  function draw(time=null){
    if(!project)return;const c=$('rigCanvas'),ctx=c.getContext('2d'),{width,height}=project.rig;if(c.width!==width)c.width=width;if(c.height!==height)c.height=height;ctx.clearRect(0,0,width,height);
    const sk=skeleton(),mat=matrices(time);
    for(let i=project.layers.length-1;i>=0;i--){const l=project.layers[i];if(!l.visible)continue;const name=`part_${String(i+1).padStart(2,'0')}`,a=sk.skins[0].attachments[name][name];ctx.save();ctx.globalAlpha=l.opacity;
      if(a.type==='mesh'){
        const vertices=meshWorldVertices(a,sk,mat).map(([x,y])=>[width/2+x,height-y]),uv=a.uvs;
        for(let t=0;t<a.triangles.length;t+=3){const ids=a.triangles.slice(t,t+3);triangle(ctx,l.canvas,ids.map(i=>[uv[i*2]*l.canvas.width,uv[i*2+1]*l.canvas.height]),ids.map(i=>vertices[i]));}
      }else{const bone=project.rig.assignments[i],p=project.rig.points[bone],q=mat[bone];ctx.translate(width/2,height);ctx.transform(q[0],-q[1],-q[2],q[3],q[4],-q[5]);ctx.drawImage(l.canvas,l.x-p.x,l.y-p.y);}ctx.restore();
    }
    if($('rigShowBones').checked){const points=jointPositions(time),scale=width/Math.max(200,c.getBoundingClientRect().width);ctx.lineWidth=1.5*scale;ctx.font=`${11*scale}px sans-serif`;
      for(const b of sk.bones){if(b.name==='root')continue;const p=points[b.name],parent=points[b.parent],active=b.name===selected();ctx.strokeStyle=active?'#e67916':'#096e65';ctx.fillStyle=active?'#ffd08c':'#a1ffdd';if(b.parent!=='root'){ctx.beginPath();ctx.moveTo(parent.x,parent.y);ctx.lineTo(p.x,p.y);ctx.stroke();}ctx.beginPath();ctx.arc(p.x,p.y,(active?6:4)*scale,0,Math.PI*2);ctx.fill();ctx.stroke();if(active){ctx.fillStyle='#102c33';ctx.fillText(project.rig.labels[b.name]||b.name,p.x+10*scale,p.y-9*scale);}}
    }
  }
  function fields(){if(!project)return;const id=selected(),p=project.rig.points[id];$('rigX').value=Math.round(p.x*10)/10;$('rigY').value=Math.round(p.y*10)/10;$('rigParent').value=project.rig.parents[id];$('rigAngle').value=project.rig.pose[id]||0;$('rigAngleValue').textContent=`${project.rig.pose[id]||0}°`;$('rigDelete').disabled=!!boneLabels[id];$('rigUndo').disabled=!history.length;$('rigX').disabled=$('rigY').disabled=poseMode();$('rigAngle').disabled=!poseMode();draw();}
  function binding(){const i=Number($('rigLayer').value);$('rigBind').value=project.rig.assignments[i];$('rigDeform').value=project.rig.modes[i];}
  function setPoint(x,y){if(!Number.isFinite(x)||!Number.isFinite(y))return;const {width,height}=project.rig;project.rig.points[selected()]={x:Math.max(0,Math.min(width,x)),y:Math.max(0,Math.min(height,y))};dirty();fields();}
  const mouse=e=>{const r=$('rigCanvas').getBoundingClientRect();return {x:(e.clientX-r.left)/r.width*project.rig.width,y:(e.clientY-r.top)/r.height*project.rig.height};};
  $('rigCanvas').onpointerdown=e=>{if(!project||playing)return;const pos=mouse(e),points=jointPositions(),radius=16*project.rig.width/$('rigCanvas').getBoundingClientRect().width;let nearest=null,best=radius;for(const [id,p]of Object.entries(points)){if(id==='root')continue;const dist=Math.hypot(pos.x-p.x,pos.y-p.y);if(dist<best){nearest=id;best=dist;}}
    if(nearest){$('rigBone').value=nearest;fields();}if(poseMode()){if(nearest)message('각도 슬라이더로 선택한 관절을 굽혀보세요.');return;}if(!nearest)return;
    remember();drag={id:selected(),dx:project.rig.points[selected()].x-pos.x,dy:project.rig.points[selected()].y-pos.y};$('rigCanvas').setPointerCapture(e.pointerId);$('rigCanvas').focus();e.preventDefault();};
  $('rigCanvas').onpointermove=e=>{if(!drag)return;const p=mouse(e);setPoint(p.x+drag.dx,p.y+drag.dy);};
  const endDrag=e=>{if(!drag)return;drag=null;if($('rigCanvas').hasPointerCapture(e.pointerId))$('rigCanvas').releasePointerCapture(e.pointerId);status();};$('rigCanvas').onpointerup=endDrag;$('rigCanvas').onpointercancel=endDrag;
  $('rigCanvas').onkeydown=e=>{if(!project||poseMode()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();remember();const p=project.rig.points[selected()],step=e.shiftKey?10:1;setPoint(p.x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),p.y+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0));};
  $('rigX').onchange=$('rigY').onchange=()=>{remember();setPoint(Number($('rigX').value),Number($('rigY').value));};
  $('rigBone').onchange=()=>{stop();fields();};$('rigLayer').onchange=binding;
  $('rigBind').onchange=()=>{remember();project.rig.assignments[Number($('rigLayer').value)]=$('rigBind').value;project.rig.modes[Number($('rigLayer').value)]='rigid';binding();stop();dirty();draw();};
  $('rigDeform').onchange=()=>{remember();project.rig.modes[Number($('rigLayer').value)]=$('rigDeform').value;stop();dirty();draw();};
  $('rigParent').onchange=()=>{try{remember();setParent(project.rig,selected(),$('rigParent').value);dirty();menus();}catch(e){message(e.message);fields();}};
  $('rigAdd').onclick=()=>{try{remember();const id=addJoint(project.rig,$('rigJointName').value,selected());$('rigJointName').value='';dirty();menus(id);}catch(e){message(e.message);}};
  $('rigDelete').onclick=()=>{try{remember();deleteJoint(project.rig,selected());dirty();menus('body');}catch(e){message(e.message);}};
  $('rigUndo').onclick=()=>{if(!history.length)return;project.rig=JSON.parse(history.pop());dirty();menus();};
  $('rigMode').onchange=()=>{stop();fields();message(poseMode()?'관절을 선택하고 각도를 조절하세요. 저장하면 manual_pose 동작에 포함됩니다.':'관절 점을 드래그하거나 X·Y를 입력하세요. 방향키 1px / Shift+방향키 10px.');};
  let angleHistory=false;$('rigAngle').oninput=()=>{stop();if(!angleHistory){remember();angleHistory=true;}project.rig.pose[selected()]=Number($('rigAngle').value);$('rigAngleValue').textContent=`${$('rigAngle').value}°`;dirty();draw();};$('rigAngle').onchange=()=>angleHistory=false;
  $('rigPoseReset').onclick=()=>{remember();project.rig.pose={};dirty();fields();};
  $('rigClean').onclick=()=>cleanup().catch(e=>message(e.message));$('rigShowBones').onchange=()=>draw();$('rigAmplitude').oninput=()=>{dirty();if(!playing)draw();};
  $('rigPlay').onclick=()=>{if(playing){stop();draw();return;}playing=true;started=performance.now();$('rigPlay').textContent='정지 · 관절 편집';const frame=now=>{draw((now-started)/1000);raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);};$('rigDialog').onclose=stop;
  $('rigSave').onclick=async()=>{if(!project)return;stop();$('rigSave').disabled=true;try{
    const files={'skeleton.json':strToU8(JSON.stringify(skeleton(),null,2))};for(const [i,l]of project.layers.entries())files[`images/part_${String(i+1).padStart(2,'0')}.png`]=new Uint8Array(await(await canvasBlob(l.canvas)).arrayBuffer());
    files['layer-map.json']=strToU8(JSON.stringify({layers:project.meta,rig:project.rig},null,2));
    files['사용법.txt']=strToU8('Layer Studio 관절 리그\nZIP을 모두 풀고 Spine 메뉴 > 데이터 가져오기 > skeleton.json을 여세요. 이미지 경로: ./images/\n애니메이션: idle(대기), manual_pose(수동 포즈).\n팔·다리의 자동 변형은 위치로 추정한 격자 메쉬와 웨이트입니다. 큰 각도에서는 찌그러질 수 있어요. Spine Professional에서 웨이트를 추가 편집할 수 있습니다. IK·가려진 부위 재생성은 포함되지 않습니다.\n관절 편집을 웹앱에서 이어가려면 별도의 편집 프로젝트 JSON도 저장하세요.\n');
    download(new Blob([zipSync(files,{level:1})],{type:'application/zip'}),filename()+'-spine.zip');message('Spine ZIP을 저장했어요. 수동 포즈는 manual_pose로 포함됩니다.');
  }catch(e){message(e.message);}finally{$('rigSave').disabled=false;draw();}};
  const filename=()=>(state.name||'character').replace(/[\\/:*?"<>|]/g,'_');
  $('rigProjectSave').onclick=()=>{const saved={format:'layer-studio-rig-v2',name:state.name,rig:project.rig,strength:Number($('rigStrength').value),amplitude:Number($('rigAmplitude').value),layers:project.source.map((l,i)=>({...project.meta[i],image:l.canvas.toDataURL('image/png')}))};download(new Blob([JSON.stringify(saved)],{type:'application/json'}),filename()+'-rig-project.json');message('관절·파츠·포즈를 저장했어요. 편집 프로젝트 열기로 이어갈 수 있습니다.');};
  $('rigProjectOpen').onclick=()=>$('rigProjectInput').click();
  $('rigProjectInput').onchange=async e=>{if(processing){toast('경계 처리가 끝난 뒤 열어주세요.');e.target.value='';return;}try{const file=e.target.files[0];if(!file)return;if(file.size>60*1024*1024)throw Error('편집 프로젝트는 60MB 이하로 열어주세요.');const saved=JSON.parse(await file.text());validateProject(saved);let total=0;const layers=[];
    for(const l of saved.layers){const bytes=Uint8Array.from(atob(l.image.slice(22)),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));total+=bitmap.width*bitmap.height;if(total>40_000_000||bitmap.width!==l.width||bitmap.height!==l.height){bitmap.close();throw Error('이미지 크기가 프로젝트 정보와 맞지 않아요.');}const c=canvas(bitmap.width,bitmap.height);c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();layers.push({...l,id:crypto.randomUUID(),canvas:c});}
    stop();const original=canvas(saved.rig.width,saved.rig.height),ctx=original.getContext('2d');for(const l of [...layers].reverse()){if(l.visible){ctx.globalAlpha=l.opacity;ctx.drawImage(l.canvas,l.x,l.y);}}state.layers=layers;state.width=original.width;state.height=original.height;state.original=original;state.name=saved.name||'관절 프로젝트';state.kind='관절 프로젝트';state.view='composite';state.selected=layers[0].id;
    project={ids:layers.map(l=>l.id).join('|'),source:layers,layers,meta:layers.map(metadata),rig:saved.rig,removed:0};history=[];dirty();render();$('rigStrength').value=String(saved.strength??1);$('rigAmplitude').value=String(saved.amplitude??1);$('rigMode').value='setup';menus('body');$('rigDialog').showModal();await cleanup();message('저장한 관절과 포즈를 불러왔어요.');
  }catch(err){toast(err.message);}finally{e.target.value='';}};
  $('rigApply').onclick=()=>{if(!project)return;state.layers=project.layers;state.kind='관절 편집 완료';state.view='composite';render();$('rigDialog').close();toast('보정 파츠를 적용했어요. 관절 편집은 다시 열어 이어갈 수 있습니다.');};
  $('autoRigBtn').onclick=prepare;return {prepare,update:()=>{$('autoRigBtn').disabled=state.busy||state.layers.length<2;$('rigProjectOpen').disabled=state.busy;}};
}
function validateProject(s){
  const finite=n=>typeof n==='number'&&Number.isFinite(n),positive=n=>Number.isInteger(n)&&n>0&&n<=8192;
  if(s?.format!=='layer-studio-rig-v2'||!Array.isArray(s.layers)||!s.layers.length||s.layers.length>100||!s.rig||!positive(s.rig.width)||!positive(s.rig.height)||s.rig.width*s.rig.height>16_000_000)throw Error('올바른 관절 편집 프로젝트가 아닙니다.');
  const r=s.rig,names=Object.keys(r.points||{});if(names.length>64||!Array.isArray(r.assignments)||!Array.isArray(r.modes)||r.assignments.length!==s.layers.length||r.modes.length!==s.layers.length||!r.parents||!r.labels||!r.pose)throw Error('관절 정보가 올바르지 않습니다.');
  for(const id of Object.keys(boneLabels))if(!r.points[id])throw Error('기본 관절이 누락되었습니다.');
  for(const id of names){const p=r.points[id];if(!/^(root|body|chest|neck|head|hair|arm_left|arm_right|elbow_left|elbow_right|wrist_left|wrist_right|hip_left|hip_right|knee_left|knee_right|ankle_left|ankle_right|joint_\d+)$/.test(id)||!finite(p.x)||!finite(p.y)||p.x<0||p.y<0||p.x>r.width||p.y>r.height||typeof r.labels[id]!=='string'||r.labels[id].length>80||(id!=='root'&&!names.includes(r.parents[id])))throw Error('관절 좌표 또는 연결이 올바르지 않습니다.');}
  if(r.parents.root)throw Error('전체 기준의 부모는 지정할 수 없습니다.');boneOrder(r);
  for(const [id,a]of Object.entries(r.pose))if(!names.includes(id)||!finite(a)||Math.abs(a)>180)throw Error('포즈 각도를 확인해주세요.');
  for(const [i,l]of s.layers.entries())if(typeof l.name!=='string'||typeof l.image!=='string'||!l.image.startsWith('data:image/png;base64,')||!positive(l.width)||!positive(l.height)||!finite(l.x)||!finite(l.y)||Math.abs(l.x)>8192||Math.abs(l.y)>8192||!finite(l.opacity)||l.opacity<0||l.opacity>1||typeof l.visible!=='boolean'||!names.includes(r.assignments[i])||!['rigid','arm_left','arm_right','legs','feet'].includes(r.modes[i]))throw Error('파츠 정보가 올바르지 않습니다.');
  for(const key of ['strength','amplitude'])if(!finite(s[key])||s[key]<0||s[key]>2)throw Error('보정 또는 동작 설정이 올바르지 않습니다.');
}
