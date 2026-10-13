import {installSpinePreview} from './spine-preview.js';
import {cleanPixels,inferRig,refineRig,buildParts,applyPose,applyFill,hiddenMasks,matchOriginal,centerJoints,attachProps,makeSkeleton,poseMatrices,boneLabels,meshWorldVertices,vertexWeights,regionMatrix,mul,spineName,animationNames,addJoint,addJointAt,insertJointAt,upgradeRig,deleteJoint,setParent,boneOrder} from './rig-core.js';
import {packAtlas,encodePNG} from './spine-export.js';
import {zipSync,strToU8} from 'fflate';
import {writePsd} from 'ag-psd';
export function installRigUI({state,canvas,canvasBlob,download,toast,render}){
  const $=id=>document.getElementById(id);let placing=false,project=null,playing=false,processing=false,raf=0,started=0,cached=null,cachedParts=null,drag=null,history=[];
  const metadata=l=>({name:l.name,x:l.x,y:l.y,width:l.canvas.width,height:l.canvas.height,opacity:l.opacity,visible:l.visible});
  const pixelCache=new WeakMap(),pixels=c=>{if(!pixelCache.has(c))pixelCache.set(c,c.getContext('2d').getImageData(0,0,c.width,c.height).data);return pixelCache.get(c);};
  const stop=()=>{playing=false;cancelAnimationFrame(raf);$('rigPlay').textContent='모션 재생';};
  const message=text=>{$('rigStatus').textContent=text;};
  const dirty=()=>{cached=null;cachedParts=null;};
  const assist=()=>state.server?.rigAssist?state.server:null;
  const fillKey=()=>JSON.stringify([project.hiddenKey,project.rig.points,project.rig.limbStyle,project.rig.modes,$('rigStrength').value,project.removed]);
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
  async function redraw(){if(!assist())throw Error('다시 그리기는 서버 연결 후 사용할 수 있어요.');await redrawHidden();const key=fillKey();if(project.fill?.key===key)return;cachedParts=null;const todo=parts().filter(p=>p.fill);if(!todo.length){draw();message('가려진 부분을 AI로 다시 그렸어요.');return;}message(`AI가 관절 이음새 ${todo.length}곳을 다시 그리는 중…`);
    const items=[];for(const p of todo)items.push({image:await b64(await canvasBlob(p.canvas)),mask:await b64(await canvasBlob(maskCanvas(p.fill,p.width,p.height)))});
    const res=await call('/api/inpaint',JSON.stringify({items}),'application/json'),images={};
    for(const [k,p]of todo.entries()){const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(res.images[k]),c=>c.charCodeAt(0))],{type:'image/png'}));const c=canvas(p.width,p.height);c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();images[p.slot]=c.getContext('2d').getImageData(0,0,p.width,p.height).data;}
    project.fill={key,images};dirty();draw();status();message('가려진 부분과 관절 이음새를 AI로 다시 그렸어요.');}
  const remember=()=>{history.push(JSON.stringify(project.rig));if(history.length>40)history.shift();$('rigUndo').disabled=false;};
  const poseMode=()=>$('rigMode').value==='pose';
  const selected=()=>$('rigBone').value;
  const status=()=>{const n=parts().length,meshes=Object.values(skeleton().skins[0].attachments).map(a=>Object.values(a)[0]).filter(a=>a.type==='mesh'),vertices=meshes.reduce((n,a)=>n+a.uvs.length/2,0);message(`Spine 파츠 ${n}개 · 메쉬 ${meshes.length}개 / 정점 ${vertices}개 · 관절 ${Object.keys(project.rig.points).length}개. ${meshes.length?'가중치 포함: Spine에서 다시 붙일 필요 없어요.':'파츠 회전 방식입니다. 메쉬·가중치 적용으로 전환하세요.'}`);};
  function menus(id=selected()||'body'){
    const opts=()=>boneOrder(project.rig).filter(k=>k!=='root').map(k=>new Option(project.rig.labels[k]||k,k));
    $('rigBone').replaceChildren(...opts());$('rigBone').value=project.rig.points[id]?id:'body';
    $('rigParent').replaceChildren(new Option('전체 기준','root'),...opts());
    $('rigBind').replaceChildren(new Option('전체 기준','root'),...opts());
    $('rigLayer').replaceChildren(...project.meta.map((l,i)=>new Option(l.name,String(i))));
    $('rigLimbStyle').value=project.rig.limbStyle??'cutout';$('rigIK').checked=project.rig.ik!==false;fields();binding();status();
  }
  async function prepare(){
    if(state.busy||processing)return;if(state.layers.length<2){toast('먼저 AI로 파츠를 분리하거나 레이어 PSD를 불러와주세요.');return;}
    try{
      // Retain edits when reopening the same project; discard only on a real layer/source change.
      const same=project&&project.ids===state.layers.map(l=>l.id).join('|');
      if(!same){const source=state.layers.map(l=>({...l})),meta=source.map(metadata),rig=inferRig(meta,state.width,state.height);
        refineRig(rig,source.map((l,i)=>({...meta[i],data:pixels(l.canvas)})));
        project={ids:state.layers.map(l=>l.id).join('|'),source,layers:source,rig,meta,removed:0};history=[];$('rigStrength').value='1';$('rigAmplitude').value='1';}
      else{project.meta=state.layers.map(metadata);const ids=project.source.map(l=>l.id);project.source=state.layers.map(l=>({...l,canvas:project.source[ids.indexOf(l.id)]?.canvas||l.canvas}));project.layers=project.layers.map((l,i)=>({...l,...project.meta[i]}));}
      dirty();$('rigMode').value='setup';menus();$('rigDialog').showModal();if(!same){message('경계를 정리하고 있어요…');await new Promise(r=>setTimeout(r,30));await cleanup();try{await detectJoints();}catch(e){message(`AI 관절 인식 실패 · 모양 기반 추정 사용 (${e.message})`);}}draw();
    }catch(e){message(e.message);toast(e.message);}
  }
  async function cleanup(){
    stop();processing=true;$('rigProjectOpen').disabled=true;const next=[];let removed=0;for(const id of ['rigClean','rigSave','rigApply','rigProjectSave','rigSpinePreview'])$(id).disabled=true;
    try{for(const l of project.source){const c=canvas(l.canvas.width,l.canvas.height),ctx=c.getContext('2d');ctx.drawImage(l.canvas,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height),r=cleanPixels(pixels.data,c.width,c.height,Number($('rigStrength').value));pixels.data.set(r.data);ctx.putImageData(pixels,0,0);removed+=r.removed;next.push({...l,canvas:c});await new Promise(r=>setTimeout(r,0));}const ref=state.reference;if(ref&&ref.width===project.rig.width&&ref.height===project.rig.height){const datas=next.map(l=>{const ctx=l.canvas.getContext('2d');return {ctx,img:ctx.getImageData(0,0,l.canvas.width,l.canvas.height)};});matchOriginal(next.map((l,i)=>({...l,width:l.canvas.width,height:l.canvas.height,data:datas[i].img.data})),{width:ref.width,height:ref.height,data:ref.getContext('2d').getImageData(0,0,ref.width,ref.height).data});datas.forEach(d=>d.ctx.putImageData(d.img,0,0));}
    project.layers=next;project.removed=removed;project.cleanVersion=(project.cleanVersion||0)+1;dirty();status();draw();}
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
  function matrices(time=null){return poseMatrices(skeleton(),time,time===null&&poseMode()?spinePose():{},$('rigAnim').value);}
  function jointPositions(time=null){const m=matrices(time),root=project.rig.points.root;return Object.fromEntries(Object.keys(project.rig.points).filter(id=>m[spineName(id)]).map(id=>{const q=m[spineName(id)];return [id,{x:root.x+q[4],y:root.y-q[5]}];}));}
  function draw(time=null){
    if(!project)return;const c=$('rigCanvas'),ctx=c.getContext('2d'),{width,height}=project.rig,root=project.rig.points.root;if(c.width!==width)c.width=width;if(c.height!==height)c.height=height;ctx.clearRect(0,0,width,height);
    const sk=skeleton(),mat=matrices(time),screen=[1,0,0,-1,root.x,root.y],list=parts();
    for(let i=list.length-1;i>=0;i--){const p=list[i];if(!p.visible)continue;const a=sk.skins[0].attachments[p.slot][p.slot];ctx.save();ctx.globalAlpha=p.opacity??1;
      if(a.type==='mesh'){
        const vertices=meshWorldVertices(a,sk,mat).map(([x,y])=>[root.x+x,root.y-y]),uv=a.uvs;
        for(let t=0;t<a.triangles.length;t+=3){const ids=a.triangles.slice(t,t+3);triangle(ctx,p.canvas,ids.map(i=>[uv[i*2]*p.canvas.width,uv[i*2+1]*p.canvas.height]),ids.map(i=>vertices[i]));}
        if($('rigShowMesh').checked||$('rigShowWeights').checked){
          const scale=width/Math.max(200,c.getBoundingClientRect().width),weights=vertexWeights(a,sk,spineName(selected()));
          const visible=i=>p.data[(Math.min(p.height-1,Math.floor(uv[i*2+1]*p.height))*p.width+Math.min(p.width-1,Math.floor(uv[i*2]*p.width)))*4+3]>8;
          ctx.lineWidth=.65*scale;ctx.strokeStyle='rgba(28,117,148,.45)';
          if($('rigShowMesh').checked){ctx.beginPath();for(let e=0;e<a.edges.length;e+=2){const i=a.edges[e]/2,j=a.edges[e+1]/2;if(!visible(i)&&!visible(j))continue;ctx.moveTo(...vertices[i]);ctx.lineTo(...vertices[j]);}ctx.stroke();}
          if($('rigShowWeights').checked)for(let i=0;i<vertices.length;i++){if(!visible(i))continue;ctx.fillStyle=`hsl(${Math.round(220*(1-weights[i]))} 95% 52%)`;ctx.beginPath();ctx.arc(...vertices[i],2.1*scale,0,Math.PI*2);ctx.fill();}
        }
      }else{const m=mul(screen,regionMatrix(a,mat[spineName(p.bone)]));ctx.transform(...m);ctx.drawImage(p.canvas,0,0);}ctx.restore();
    }
    if($('rigShowBones').checked){const points=jointPositions(time),scale=width/Math.max(200,c.getBoundingClientRect().width);ctx.lineWidth=1.5*scale;ctx.font=`${11*scale}px sans-serif`;
      for(const id of Object.keys(points)){if(id==='root')continue;const p=points[id],parent=points[project.rig.parents[id]],active=id===selected();ctx.strokeStyle=active?'#e67916':'#096e65';ctx.fillStyle=active?'#ffd08c':'#a1ffdd';if(parent&&project.rig.parents[id]!=='root'){ctx.beginPath();ctx.moveTo(parent.x,parent.y);ctx.lineTo(p.x,p.y);ctx.stroke();}ctx.beginPath();ctx.arc(p.x,p.y,(active?6:4)*scale,0,Math.PI*2);ctx.fill();ctx.stroke();if(active){ctx.fillStyle='#102c33';ctx.fillText(`${project.rig.labels[id]||id} · ${spineName(id)}`,p.x+10*scale,p.y-9*scale);}}
    }
  }
  function fields(){if(!project)return;const id=selected(),p=project.rig.points[id];$('rigWeightBlend').value=project.rig.weightBlend?.[id]??1;$('rigWeightBlendValue').textContent=`${Number($('rigWeightBlend').value).toFixed(2)}배`;$('rigWeightBlend').disabled=project.rig.limbStyle!=='mesh'||! /^(elbow|wrist|knee|ankle|joint)_/.test(id);$('rigX').value=Math.round(p.x*10)/10;$('rigY').value=Math.round(p.y*10)/10;$('rigParent').value=project.rig.parents[id];$('rigAngle').value=project.rig.pose[id]||0;$('rigAngleInput').value=project.rig.pose[id]||0;$('rigAngleValue').textContent=`${project.rig.pose[id]||0}°`;$('rigDelete').disabled=!!boneLabels[id];$('rigUndo').disabled=!history.length;$('rigX').disabled=$('rigY').disabled=poseMode();$('rigAngle').disabled=$('rigAngleInput').disabled=$('rigAngleReset').disabled=!poseMode();draw();}
  function binding(){const i=Number($('rigLayer').value);$('rigBind').value=project.rig.assignments[i];$('rigDeform').value=project.rig.modes[i];}
  function setPoint(x,y){if(!Number.isFinite(x)||!Number.isFinite(y))return;const {width,height}=project.rig;project.rig.points[selected()]={x:Math.max(0,Math.min(width,x)),y:Math.max(0,Math.min(height,y))};dirty();fields();}
  const mouse=e=>{const r=$('rigCanvas').getBoundingClientRect();return {x:(e.clientX-r.left)/r.width*project.rig.width,y:(e.clientY-r.top)/r.height*project.rig.height};};
  $('rigCanvas').onpointerdown=e=>{if(!project||playing)return;if(placing){const pos=mouse(e);placing=false;$('rigAdd').classList.remove('primary');try{remember();const between=$('rigInsertMode').value==='between',id=(between?insertJointAt:addJointAt)(project.rig,$('rigJointName').value,selected(),pos.x,pos.y);$('rigJointName').value='';dirty();menus(id);message(`'${project.rig.labels[id]}' 관절을 추가했어요. 아래 '파츠와 관절 연결'에서 이 관절로 움직일 파츠를 지정하세요.`);}catch(err){message(err.message);}return;}const pos=mouse(e),points=jointPositions(),radius=16*project.rig.width/$('rigCanvas').getBoundingClientRect().width;let nearest=null,best=radius;for(const [id,p]of Object.entries(points)){if(id==='root')continue;const dist=Math.hypot(pos.x-p.x,pos.y-p.y);if(dist<best){nearest=id;best=dist;}}
    if(nearest){$('rigBone').value=nearest;fields();}if(poseMode()){if(nearest)message('각도 슬라이더로 선택한 관절을 굽혀보세요.');return;}if(!nearest)return;
    remember();drag={id:selected(),dx:project.rig.points[selected()].x-pos.x,dy:project.rig.points[selected()].y-pos.y};$('rigCanvas').setPointerCapture(e.pointerId);$('rigCanvas').focus();e.preventDefault();};
  $('rigCanvas').onpointermove=e=>{if(!drag)return;const p=mouse(e);setPoint(p.x+drag.dx,p.y+drag.dy);};
  const endDrag=e=>{if(!drag)return;drag=null;if($('rigCanvas').hasPointerCapture(e.pointerId))$('rigCanvas').releasePointerCapture(e.pointerId);status();};$('rigCanvas').onpointerup=endDrag;$('rigCanvas').onpointercancel=endDrag;
  $('rigCanvas').onkeydown=e=>{if(!project||poseMode()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();remember();const p=project.rig.points[selected()],step=e.shiftKey?10:1;setPoint(p.x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),p.y+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0));};
  $('rigX').onchange=$('rigY').onchange=()=>{remember();setPoint(Number($('rigX').value),Number($('rigY').value));};
  $('rigBone').onchange=()=>{stop();fields();};$('rigLayer').onchange=binding;
  $('rigBind').onchange=()=>{remember();project.rig.assignments[Number($('rigLayer').value)]=$('rigBind').value;project.rig.modes[Number($('rigLayer').value)]='rigid';binding();stop();dirty();draw();status();};
  $('rigDeform').onchange=()=>{remember();project.rig.modes[Number($('rigLayer').value)]=$('rigDeform').value;stop();dirty();draw();status();};
  $('rigLimbStyle').onchange=()=>{remember();project.rig.limbStyle=$('rigLimbStyle').value;stop();dirty();fields();status();};
  $('rigRefineMesh').onclick=()=>{if(!project||processing)return;remember();project.rig.limbStyle='mesh';$('rigLimbStyle').value='mesh';$('rigShowMesh').checked=true;stop();dirty();fields();status();};
  $('rigShowMesh').onchange=$('rigShowWeights').onchange=()=>draw();
  let weightHistory=false;$('rigWeightBlend').oninput=()=>{if(!project)return;stop();if(!weightHistory){remember();weightHistory=true;}project.rig.weightBlend??={};project.rig.weightBlend[selected()]=Number($('rigWeightBlend').value);dirty();fields();status();};$('rigWeightBlend').onchange=()=>weightHistory=false;
  $('rigIK').onchange=()=>{remember();project.rig.ik=$('rigIK').checked;dirty();};
  $('rigAnim').onchange=()=>{if(playing){started=performance.now();}else draw();};
  $('rigParent').onchange=()=>{try{remember();setParent(project.rig,selected(),$('rigParent').value);dirty();menus();}catch(e){message(e.message);fields();}};
  $('rigAdd').onclick=()=>{if(!project)return;if($('rigMode').value!=='setup'){$('rigMode').value='setup';fields();}stop();placing=!placing;$('rigAdd').classList.toggle('primary',placing);const name=k=>project.rig.labels[k]||k,sel=selected();if(placing&&$('rigInsertMode').value==='between'&&sel==='root'){placing=false;$('rigAdd').classList.remove('primary');message('전체 기준 위에는 넣을 수 없어요.');return;}
    message(placing?($('rigInsertMode').value==='between'?`미리보기에서 위치를 클릭하세요. ${name(project.rig.parents[sel])} → [새 관절] → ${name(sel)} 순서로 들어갑니다. (다시 누르면 취소)`:`미리보기에서 새 관절 위치를 클릭하세요. ${name(sel)} 아래에 붙습니다. (다시 누르면 취소)`):'관절 추가를 취소했어요.');};
  $('rigDelete').onclick=()=>{try{remember();deleteJoint(project.rig,selected());dirty();menus('body');}catch(e){message(e.message);}};
  $('rigUndo').onclick=()=>{if(!history.length)return;project.rig=JSON.parse(history.pop());dirty();menus();};
  $('rigReinfer').onclick=()=>{if(!project)return;remember();const fresh=inferRig(project.meta,project.rig.width,project.rig.height);refineRig(fresh,project.layers.map((l,i)=>({...project.meta[i],data:pixels(l.canvas)})));for(const id of Object.keys(fresh.points))if(boneLabels[id])project.rig.points[id]=fresh.points[id];dirty();fields();status();message('관절 위치를 파츠 모양에서 다시 추정했어요. 추가 관절과 연결 설정은 유지됩니다.');};
  $('rigMode').onchange=()=>{stop();fields();message(poseMode()?'관절을 선택하고 각도를 조절하세요. 저장하면 manual_pose 동작에 포함됩니다.':'관절 점을 드래그하거나 X·Y를 입력하세요. 방향키 1px / Shift+방향키 10px.');};
  let angleHistory=false;$('rigAngle').oninput=()=>{stop();if(!angleHistory){remember();angleHistory=true;}project.rig.pose[selected()]=Number($('rigAngle').value);$('rigAngleValue').textContent=`${$('rigAngle').value}°`;$('rigAngleInput').value=$('rigAngle').value;dirty();draw();};$('rigAngle').onchange=()=>angleHistory=false;
  const setAngle=v=>{if(!Number.isFinite(v))return;stop();remember();v=Math.max(-180,Math.min(180,Math.round(v*10)/10));if(v)project.rig.pose[selected()]=v;else delete project.rig.pose[selected()];dirty();fields();};
  $('rigAngleInput').onchange=()=>setAngle(Number($('rigAngleInput').value));$('rigAngleInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();setAngle(Number($('rigAngleInput').value));}};
  $('rigAngleReset').onclick=()=>setAngle(0);
  $('rigPoseReset').onclick=()=>{remember();project.rig.pose={};dirty();fields();};
  $('rigClean').onclick=()=>cleanup().catch(e=>message(e.message));$('rigShowBones').onchange=()=>draw();$('rigAmplitude').oninput=()=>{dirty();if(!playing)draw();};
  $('rigPlay').onclick=()=>{if(playing){stop();draw();return;}playing=true;started=performance.now();$('rigPlay').textContent='정지 · 관절 편집';const frame=now=>{draw((now-started)/1000);raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);};$('rigDialog').onclose=stop;
  const filename=()=>(state.name||'character').replace(/[\\/:*?"<>|]/g,'_');
  const unityName=()=>(state.name||'').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').toLowerCase()||'character';
  $('rigAiJoints').onclick=()=>{remember();detectJoints().catch(e=>message(e.message));};
  $('rigAiFill').onclick=()=>redraw().catch(e=>message(e.message));
  $('rigSave').onclick=async()=>{if(!project)return;stop();$('rigSave').disabled=true;try{
    if(assist())try{await redraw();}catch(e){message(`이음새 다시 그리기 실패 · 원본 픽셀로 저장 (${e.message})`);}
    const list=parts(),sk=skeleton(),json=JSON.stringify(sk,null,2),name=unityName(),files={};
    // spine/: images + skeleton.json for the Spine editor (Import Data). unity/: drop straight into Assets.
    files['spine/skeleton.json']=strToU8(json);
    for(const p of list)files[`spine/images/${p.slot}.png`]=new Uint8Array(await(await canvasBlob(p.canvas)).arrayBuffer());
    const packed=packAtlas(list.map(p=>({slot:p.slot,width:p.width,height:p.height,data:p.data})),{name});
    files[`unity/${name}.json`]=strToU8(json);files[`unity/${name}.atlas.txt`]=strToU8(packed.atlas);for(const pg of packed.pages)files[`unity/${pg.file}`]=encodePNG(pg.rgba,pg.width,pg.height);
    files['parts.psd']=new Uint8Array(writePsd({width:project.rig.width,height:project.rig.height,children:[...list].reverse().map(p=>({name:p.slot,canvas:p.canvas,left:p.x,top:p.y,opacity:p.opacity??1,hidden:p.visible===false,blendMode:'normal'}))},{generateThumbnail:false}));
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
팔·다리는 관절에서 잘라 겹침(볼 조인트)을 넣었습니다. 접히는 부분이 어색하면 Spine에서 해당 파츠 순서(Draw Order)를 바꿔보세요.
parts.psd: 잘린 파츠를 PSD로 저장한 파일. 원화 담당자가 관절 부분을 다듬은 뒤 다시 불러올 수 있습니다.

[애니메이션]
idle, wave, cheer, hop: 자동 생성된 FK 템플릿. 미리보기와 같게 하려고 이 동작들에서는 IK mix를 0으로 둡니다.
manual_pose: 웹에서 맞춘 포즈.
새 애니메이션을 Spine에서 만들 때는 빨간 ik_ 뼈대를 움직여 IK로 팔·다리를 조작할 수 있습니다.
`);
    download(new Blob([zipSync(files,{level:1})],{type:'application/zip'}),filename()+'-spine.zip');message(`Spine ZIP을 저장했어요. 파츠 ${list.length}개 · Unity 패키지 포함.`);
  }catch(e){message(e.message);}finally{$('rigSave').disabled=false;draw();}};
  $('rigProjectSave').onclick=()=>{const saved={format:'layer-studio-rig-v2',name:state.name,original:state.reference?.toDataURL('image/png'),rig:project.rig,strength:Number($('rigStrength').value),amplitude:Number($('rigAmplitude').value),layers:project.source.map((l,i)=>({...project.meta[i],image:l.canvas.toDataURL('image/png')}))};download(new Blob([JSON.stringify(saved)],{type:'application/json'}),filename()+'-rig-project.json');message('관절·파츠·포즈를 저장했어요. 편집 프로젝트 열기로 이어갈 수 있습니다.');};
  $('rigProjectOpen').onclick=()=>$('rigProjectInput').click();
  $('rigProjectInput').onchange=async e=>{if(processing){toast('경계 처리가 끝난 뒤 열어주세요.');e.target.value='';return;}try{const file=e.target.files[0];if(!file)return;if(file.size>60*1024*1024)throw Error('편집 프로젝트는 60MB 이하로 열어주세요.');const saved=JSON.parse(await file.text());validateProject(saved);let total=0;const layers=[];
    for(const l of saved.layers){const bytes=Uint8Array.from(atob(l.image.slice(22)),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));total+=bitmap.width*bitmap.height;if(total>40_000_000||bitmap.width!==l.width||bitmap.height!==l.height){bitmap.close();throw Error('이미지 크기가 프로젝트 정보와 맞지 않아요.');}const c=canvas(bitmap.width,bitmap.height);c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();layers.push({...l,id:crypto.randomUUID(),canvas:c});}
    stop();const original=canvas(saved.rig.width,saved.rig.height),ctx=original.getContext('2d');for(const l of [...layers].reverse()){if(l.visible){ctx.globalAlpha=l.opacity;ctx.drawImage(l.canvas,l.x,l.y);}}let reference=null;if(typeof saved.original==='string'&&saved.original.startsWith('data:image/png;base64,')){const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(saved.original.slice(22)),c=>c.charCodeAt(0))],{type:'image/png'}));if(bitmap.width===saved.rig.width&&bitmap.height===saved.rig.height){reference=canvas(bitmap.width,bitmap.height);reference.getContext('2d').drawImage(bitmap,0,0);}bitmap.close();}
    state.reference=reference;state.layers=layers;state.width=original.width;state.height=original.height;state.original=reference||original;state.name=saved.name||'관절 프로젝트';state.kind='관절 프로젝트';state.view='composite';state.selected=layers[0].id;
    project={ids:layers.map(l=>l.id).join('|'),source:layers,layers,meta:layers.map(metadata),rig:upgradeRig({limbStyle:'mesh',ik:true,...saved.rig}),removed:0};history=[];dirty();render();$('rigStrength').value=String(saved.strength??1);$('rigAmplitude').value=String(saved.amplitude??1);$('rigMode').value='setup';menus('body');$('rigDialog').showModal();await cleanup();message('저장한 관절과 포즈를 불러왔어요.');
  }catch(err){toast(err.message);}finally{e.target.value='';}};
  $('rigApply').onclick=()=>{if(!project)return;state.layers=project.layers;state.kind='관절 편집 완료';state.view='composite';render();$('rigDialog').close();toast('보정 파츠를 적용했어요. 관절 편집은 다시 열어 이어갈 수 있습니다.');};
  $('rigAnim').replaceChildren(...Object.entries(animationNames).map(([k,v])=>new Option(v,k)));
  const spinePreview=installSpinePreview({download,canSend:()=>!!project&&!processing&&!state.busy,snapshot:()=>({name:state.name,skeleton:skeleton(),parts:parts()})});
  $('rigDialog').addEventListener('close',()=>spinePreview.update());
  $('autoRigBtn').onclick=prepare;return {prepare,update:()=>{$('autoRigBtn').disabled=state.busy||state.layers.length<2;$('rigProjectOpen').disabled=state.busy;spinePreview.update();}};
}
function validateProject(s){
  const finite=n=>typeof n==='number'&&Number.isFinite(n),positive=n=>Number.isInteger(n)&&n>0&&n<=8192;
  if(s?.format!=='layer-studio-rig-v2'||!Array.isArray(s.layers)||!s.layers.length||s.layers.length>100||!s.rig||!positive(s.rig.width)||!positive(s.rig.height)||s.rig.width*s.rig.height>16_000_000)throw Error('올바른 관절 편집 프로젝트가 아닙니다.');
  const r=s.rig,names=Object.keys(r.points||{});if(names.length>64||!Array.isArray(r.assignments)||!Array.isArray(r.modes)||r.assignments.length!==s.layers.length||r.modes.length!==s.layers.length||!r.parents||!r.labels||!r.pose)throw Error('관절 정보가 올바르지 않습니다.');
  if(r.limbStyle!==undefined&&!['cutout','mesh'].includes(r.limbStyle)||r.ik!==undefined&&typeof r.ik!=='boolean')throw Error('리깅 방식 설정이 올바르지 않습니다.');
  for(const id of Object.keys(boneLabels))if(!r.points[id]&&id!=='upper'&&id!=='pelvis')throw Error('기본 관절이 누락되었습니다.');
  for(const id of names){const p=r.points[id];if(!/^(root|body|upper|pelvis|chest|neck|head|hair|arm_left|arm_right|elbow_left|elbow_right|wrist_left|wrist_right|hip_left|hip_right|knee_left|knee_right|ankle_left|ankle_right|joint_\d+)$/.test(id)||!finite(p.x)||!finite(p.y)||p.x<0||p.y<0||p.x>r.width||p.y>r.height||typeof r.labels[id]!=='string'||r.labels[id].length>80||(id!=='root'&&!names.includes(r.parents[id])))throw Error('관절 좌표 또는 연결이 올바르지 않습니다.');}
  if(r.parents.root)throw Error('전체 기준의 부모는 지정할 수 없습니다.');boneOrder(r);
  if(r.weightBlend!==undefined){if(!r.weightBlend||typeof r.weightBlend!=='object'||Array.isArray(r.weightBlend))throw Error('가중치 설정을 확인해주세요.');for(const [id,v]of Object.entries(r.weightBlend))if(!names.includes(id)||!finite(v)||v<.35||v>2)throw Error('가중치 부드러움 범위를 확인해주세요.');}
  for(const [id,a]of Object.entries(r.pose))if(!names.includes(id)||!finite(a)||Math.abs(a)>180)throw Error('포즈 각도를 확인해주세요.');
  for(const [i,l]of s.layers.entries())if(typeof l.name!=='string'||typeof l.image!=='string'||!l.image.startsWith('data:image/png;base64,')||!positive(l.width)||!positive(l.height)||!finite(l.x)||!finite(l.y)||Math.abs(l.x)>8192||Math.abs(l.y)>8192||!finite(l.opacity)||l.opacity<0||l.opacity>1||typeof l.visible!=='boolean'||!names.includes(r.assignments[i])||!['rigid','arm_left','arm_right','legs','feet'].includes(r.modes[i]))throw Error('파츠 정보가 올바르지 않습니다.');
  for(const key of ['strength','amplitude'])if(!finite(s[key])||s[key]<0||s[key]>2)throw Error('보정 또는 동작 설정이 올바르지 않습니다.');
}
