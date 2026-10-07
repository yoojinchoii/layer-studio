// Pure pixel/rig operations shared by the browser and artifact verification.
const round=n=>Math.round(n*10000)/10000;
export function cleanPixels(data,w,h,strength=1){
  const out=new Uint8ClampedArray(data), n=w*h;
  if(!strength)return {data:out,removed:0};
  const visited=new Uint8Array(n),queue=new Int32Array(n);
  let removed=0;
  // Remove only detached specks; never discard the largest component or small facial layers.
  const components=[];
  for(let start=0;start<n;start++){
    if(visited[start]||data[start*4+3]<8)continue;
    let head=0,tail=1;queue[0]=start;visited[start]=1;const pixels=[];
    while(head<tail){const p=queue[head++];pixels.push(p);const x=p%w,y=Math.floor(p/w);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;
        const q=yy*w+xx;if(!visited[q]&&data[q*4+3]>=8){visited[q]=1;queue[tail++]=q;}
      }
    }components.push(pixels);
  }
  const largest=components.reduce((max,c)=>Math.max(max,c.length),0);
  if(largest>500)for(const c of components)if(c.length<=2*strength&&c.length<largest){for(const p of c)out[p*4+3]=0;removed+=c.length;}
  const source=out.slice();
  // A mild median blend retains interior pixels and reduces jagged alpha edges.
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*4,a=source[i+3];if(!a)continue;
    const alphas=[];let rr=0,gg=0,bb=0,weight=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const xx=x+dx,yy=y+dy;
      if(xx<0||yy<0||xx>=w||yy>=h){alphas.push(0);continue;}
      const j=(yy*w+xx)*4,aa=source[j+3];alphas.push(aa);
      if(aa>=220){rr+=source[j]*aa;gg+=source[j+1]*aa;bb+=source[j+2]*aa;weight+=aa;}
    }
    if(alphas.some(v=>v<255)){
      alphas.sort((a,b)=>a-b);out[i+3]=Math.round(a+(alphas[4]-a)*(.18*strength));
      if(a<180&&weight){const mix=.35*strength*(1-a/255);out[i]=source[i]*(1-mix)+rr/weight*mix;out[i+1]=source[i+1]*(1-mix)+gg/weight*mix;out[i+2]=source[i+2]*(1-mix)+bb/weight*mix;}
    }
  }
  return {data:out,removed};
}
export const boneLabels={root:'전체 기준',body:'골반',chest:'가슴',neck:'목',head:'머리',hair:'머리카락',arm_left:'왼쪽 어깨',elbow_left:'왼쪽 팔꿈치',wrist_left:'왼쪽 손목',arm_right:'오른쪽 어깨',elbow_right:'오른쪽 팔꿈치',wrist_right:'오른쪽 손목',hip_left:'왼쪽 고관절',knee_left:'왼쪽 무릎',ankle_left:'왼쪽 발목',hip_right:'오른쪽 고관절',knee_right:'오른쪽 무릎',ankle_right:'오른쪽 발목'};
const defaultParents={body:'root',chest:'body',neck:'chest',head:'neck',hair:'head',arm_left:'chest',elbow_left:'arm_left',wrist_left:'elbow_left',arm_right:'chest',elbow_right:'arm_right',wrist_right:'elbow_right',hip_left:'body',knee_left:'hip_left',ankle_left:'knee_left',hip_right:'body',knee_right:'hip_right',ankle_right:'knee_right'};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function inferRig(layers,width,height){
  const find=re=>layers.find(l=>re.test(l.name.toLowerCase())),center=l=>l.x+l.width/2;
  const face=find(/^(face|얼굴)$/),shirt=find(/^(topwear|상의)$/),pants=find(/^(bottomwear|하의)$/),legs=find(/legwear|다리/),feet=find(/footwear|신발/);
  const cx=face?center(face):width*.5,shoulderY=shirt?shirt.y+shirt.height*.14:height*.25;
  const body={x:pants?center(pants):cx,y:pants?pants.y+8:height*.48};
  const points={root:{x:width/2,y:height},body,chest:{x:cx,y:shoulderY+height*.06},neck:{x:cx,y:shirt?shirt.y:height*.2},head:{x:cx,y:face?face.y+face.height*.8:height*.16},hair:{x:cx,y:face?face.y+face.height*.18:height*.08}};
  for(const side of ['left','right']){
    const sign=side==='left'?-1:1,arm=layers.find(l=>/handwear|^arm|팔/.test(l.name.toLowerCase())&&(center(l)<cx)===(side==='left'));
    const shoulder={x:arm?arm.x+arm.width*(side==='left'?.83:.17):cx+sign*width*.09,y:arm?arm.y+arm.height*.08:shoulderY};
    const wrist={x:arm?arm.x+arm.width*(side==='left'?.13:.87):cx+sign*width*.2,y:arm?arm.y+arm.height*.79:height*.48};
    points[`arm_${side}`]=shoulder;points[`elbow_${side}`]={x:shoulder.x+(wrist.x-shoulder.x)*.51,y:shoulder.y+(wrist.y-shoulder.y)*.51};points[`wrist_${side}`]=wrist;
    const spread=pants?pants.width*.26:width*.055;
    points[`hip_${side}`]={x:body.x+sign*spread,y:body.y+height*.035};
    const ankle={x:feet?center(feet)+sign*feet.width*.33:cx+sign*width*.08,y:feet?feet.y+feet.height*.22:height*.88};
    points[`ankle_${side}`]=ankle;points[`knee_${side}`]={x:(points[`hip_${side}`].x+ankle.x)/2,y:legs?legs.y+legs.height*.49:height*.68};
  }
  const assignments=layers.map(l=>{const n=l.name.toLowerCase();if(/hair|머리카락/.test(n))return 'hair';if(/face|eye|irides|nose|mouth|ears|얼굴|눈|코|입|귀/.test(n))return 'head';if(/neck|목/.test(n))return 'neck';if(/topwear|상의/.test(n))return 'chest';if(/handwear|^arm|팔/.test(n))return center(l)<cx?'arm_left':'arm_right';if(/bottomwear|하의/.test(n))return 'body';return 'root';});
  const modes=layers.map((l,i)=>/handwear|^arm|팔/.test(l.name.toLowerCase())?assignments[i]:/legwear|다리/.test(l.name.toLowerCase())?'legs':/footwear|신발/.test(l.name.toLowerCase())?'feet':'rigid');
  return {points,assignments,modes,parents:{...defaultParents},labels:{...boneLabels},pose:{},width,height};
}
export function boneOrder(rig){
  const order=[],visiting=new Set(),done=new Set();function visit(name){if(done.has(name))return;if(!rig.points[name]||visiting.has(name))throw Error('뼈대 연결이 순환하거나 부모 관절이 없습니다.');visiting.add(name);const parent=rig.parents[name];if(parent)visit(parent);visiting.delete(name);done.add(name);order.push(name);}
  Object.keys(rig.points).forEach(visit);return order;
}
export function setParent(rig,name,parent){if(name==='root'||name===parent||!rig.points[parent])throw Error('부모 관절을 확인해주세요.');const old=rig.parents[name];rig.parents[name]=parent;try{boneOrder(rig);}catch(e){rig.parents[name]=old;throw e;}}
export function addJoint(rig,label,parent){if(Object.keys(rig.points).length>=64)throw Error('관절은 최대 64개까지 추가할 수 있어요.');let n=1;while(rig.points[`joint_${n}`])n++;const id=`joint_${n}`,p=rig.points[parent]||rig.points.body;rig.points[id]={x:clamp(p.x+30,0,rig.width),y:clamp(p.y+30,0,rig.height)};rig.parents[id]=rig.points[parent]?parent:'body';rig.labels[id]=label.trim()||`추가 관절 ${n}`;return id;}
export function deleteJoint(rig,id){if(boneLabels[id])throw Error('기본 관절은 삭제할 수 없어요.');const parent=rig.parents[id];for(const k in rig.parents)if(rig.parents[k]===id)rig.parents[k]=parent;rig.assignments=rig.assignments.map(x=>x===id?parent:x);delete rig.points[id];delete rig.parents[id];delete rig.labels[id];delete rig.pose[id];}
function chainInfo(rig,names,x,y){let best={distance:Infinity,t:0},total=0;const lengths=[];
  for(let i=0;i<names.length-1;i++){const a=rig.points[names[i]],b=rig.points[names[i+1]],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,u=clamp(((x-a.x)*dx+(y-a.y)*dy)/(len*len),0,1),distance=Math.hypot(x-a.x-u*dx,y-a.y-u*dy);if(distance<best.distance)best={distance,t:total+u*len};lengths.push(len);total+=len;}
  return {...best,lengths};
}
function weightsAt(rig,mode,bone,x,y){
  if(mode==='rigid')return [[bone,1]];
  let side=mode==='arm_left'?'left':'right',names;
  if(mode==='legs'||mode==='feet'){
    const left=['hip_left','knee_left','ankle_left'],right=['hip_right','knee_right','ankle_right'];side=chainInfo(rig,left,x,y).distance<=chainInfo(rig,right,x,y).distance?'left':'right';
    if(mode==='feet')return [[`ankle_${side}`,1]];names=side==='left'?left:right;
  }else names=[`arm_${side}`,`elbow_${side}`,`wrist_${side}`];
  const info=chainInfo(rig,names,x,y),a=info.lengths[0],b=info.lengths[1],blend=Math.max(2,Math.min(a,b)*.16),t=info.t;
  for(const [boundary,index]of [[a,0],[a+b*.88,1]])if(t<boundary+blend){if(t<=boundary-blend)return [[names[index],1]];const v=clamp((t-boundary+blend)/(2*blend),0,1);return [[names[index],1-v],[names[index+1],v]].filter(x=>x[1]>.00001);}
  return [[names[2],1]];
}
export function buildMesh(layer,rig,index,order){
  const mode=rig.modes[index],nx=mode==='legs'||mode==='feet'?10:5,ny=mode==='feet'?5:14,grid=[],lookup=new Map();
  const add=(x,y)=>{const key=`${x},${y}`;if(!lookup.has(key)){lookup.set(key,grid.length);grid.push([x,y]);}};
  for(let x=0;x<=nx;x++)add(x,0);for(let y=1;y<=ny;y++)add(nx,y);for(let x=nx-1;x>=0;x--)add(x,ny);for(let y=ny-1;y>0;y--)add(0,y);const hull=grid.length;
  for(let y=1;y<ny;y++)for(let x=1;x<nx;x++)add(x,y);
  const uvs=[],vertices=[],triangles=[];
  for(const [gx,gy]of grid){const u=gx/nx,v=gy/ny,x=layer.x+u*layer.width,y=layer.y+v*layer.height;uvs.push(round(u),round(v));const weights=weightsAt(rig,mode,rig.assignments[index],x,y);vertices.push(weights.length);for(const [bone,w]of weights){const p=rig.points[bone];vertices.push(order.indexOf(bone),round(x-p.x),round(p.y-y),w);}}
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const a=lookup.get(`${x},${y}`),b=lookup.get(`${x+1},${y}`),c=lookup.get(`${x},${y+1}`),d=lookup.get(`${x+1},${y+1}`);triangles.push(a,c,b,b,c,d);}
  const pairs=new Set(),edges=[];for(let i=0;i<triangles.length;i+=3)for(const [a,b]of [[triangles[i],triangles[i+1]],[triangles[i+1],triangles[i+2]],[triangles[i+2],triangles[i]]]){const key=`${Math.min(a,b)},${Math.max(a,b)}`;if(!pairs.has(key)){pairs.add(key);edges.push(a*2,b*2);}}
  return {type:'mesh',uvs,vertices,triangles,hull,edges,width:layer.width,height:layer.height};
}
export function makeSkeleton(layers,rig,amplitude=1){
  const p=rig.points,order=boneOrder(rig),bones=order.map(name=>{if(name==='root')return {name};const parent=rig.parents[name];return {name,parent,x:round(p[name].x-p[parent].x),y:round(p[parent].y-p[name].y),color:'74e6cfff'};});
  const attachments={},slots=[];
  for(let i=layers.length-1;i>=0;i--){const l=layers[i],name=`part_${String(i+1).padStart(2,'0')}`,bone=rig.assignments[i],point=p[bone];const slot={name,bone};if(l.visible!==false)slot.attachment=name;slot.color='ffffff'+Math.round((l.opacity??1)*255).toString(16).padStart(2,'0');slots.push(slot);
    const attachment=rig.modes[i]==='rigid'?{x:round(l.x+l.width/2-point.x),y:round(point.y-l.y-l.height/2),width:l.width,height:l.height}:buildMesh(l,rig,i,order);attachments[name]={[name]:{name,path:name,...attachment}};
  }
  const timelines={};for(const [bone,degrees]of Object.entries({chest:.3,head:-.65,arm_left:.75,arm_right:-.75,hair:1})){timelines[bone]={rotate:Array.from({length:49},(_,i)=>({time:round(i/12),value:round(Math.sin(i/48*Math.PI*2)*degrees*amplitude)}))};}
  timelines.chest.scale=Array.from({length:49},(_,i)=>({time:round(i/12),x:1,y:round(1+(1-Math.cos(i/48*Math.PI*2))*.006*amplitude)}));
  const manual={};for(const [bone,value]of Object.entries(rig.pose||{}))if(p[bone])manual[bone]={rotate:[{value}]};
  return {skeleton:{spine:'4.0.64',x:-rig.width/2,y:0,width:rig.width,height:rig.height,images:'./images/',fps:30},bones,slots,skins:[{name:'default',attachments}],animations:{idle:{bones:timelines},manual_pose:{bones:manual}}};
}
function sample(frames,t,key,def){if(!frames?.length)return def;let a=frames[0],b=a;for(const f of frames){if((f.time||0)<=t)a=f;if((f.time||0)>=t){b=f;break;}b=f;}const at=a.time||0,bt=b.time||0,r=bt===at?0:(t-at)/(bt-at);return (a[key]??def)*(1-r)+(b[key]??def)*r;}
export function poseMatrices(skeleton,time=null,pose={}){
  const m={};for(const b of skeleton.bones){const tl=time===null?{}:skeleton.animations.idle.bones[b.name]||{},t=(time??0)%4,angle=(sample(tl.rotate,t,'value',0)+(pose[b.name]||0))*Math.PI/180,sx=sample(tl.scale,t,'x',1),sy=sample(tl.scale,t,'y',1),a=Math.cos(angle)*sx,c=-Math.sin(angle)*sy,d=Math.cos(angle)*sy,bb=Math.sin(angle)*sx,x=b.x||0,y=b.y||0;
    if(!b.parent){m[b.name]=[a,bb,c,d,x,y];continue;}const q=m[b.parent];m[b.name]=[q[0]*a+q[2]*bb,q[1]*a+q[3]*bb,q[0]*c+q[2]*d,q[1]*c+q[3]*d,q[0]*x+q[2]*y+q[4],q[1]*x+q[3]*y+q[5]];
  }return m;
}
export function meshWorldVertices(attachment,skeleton,matrices){const out=[];let cursor=0;for(let i=0;i<attachment.uvs.length/2;i++){let x=0,y=0;const n=attachment.vertices[cursor++];for(let j=0;j<n;j++){const bone=skeleton.bones[attachment.vertices[cursor++]].name,lx=attachment.vertices[cursor++],ly=attachment.vertices[cursor++],w=attachment.vertices[cursor++],q=matrices[bone];x+=(q[0]*lx+q[2]*ly+q[4])*w;y+=(q[1]*lx+q[3]*ly+q[5])*w;}out.push([x,y]);}return out;}
