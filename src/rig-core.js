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
export const boneLabels={root:'전체 기준',body:'허리 · 몸통',head:'목 · 머리',arm_left:'화면 왼쪽 어깨',arm_right:'화면 오른쪽 어깨',hair:'머리카락'};
export function inferRig(layers,width,height){
  const find=re=>layers.find(l=>re.test(l.name.toLowerCase()));
  const face=find(/^(face|얼굴)$/),shirt=find(/^(topwear|상의)$/),pants=find(/^(bottomwear|하의)$/);
  if(!face||!shirt)throw Error('얼굴(face)과 상의(topwear) 레이어가 필요해요. See-through 결과를 사용하거나 레이어 이름을 맞춰주세요.');
  const center=l=>l.x+l.width/2;
  const body={x:pants?center(pants):center(shirt),y:pants?pants.y+8:shirt.y+shirt.height*.93};
  const head={x:center(face),y:face.y+face.height*.95};
  const arms=layers.filter(l=>/handwear|^arm|팔/.test(l.name.toLowerCase()));
  const points={root:{x:width/2,y:height},body,head,
    arm_left:{x:shirt.x+shirt.width*.07,y:shirt.y+shirt.height*.14},
    arm_right:{x:shirt.x+shirt.width*.93,y:shirt.y+shirt.height*.14},
    hair:{x:head.x,y:face.y+face.height*.18}};
  for(const l of arms){const side=center(l)<head.x?'arm_left':'arm_right';points[side]={x:l.x+l.width*(side==='arm_left'?.83:.17),y:l.y+l.height*.08};}
  const assignments=layers.map(l=>{
    const n=l.name.toLowerCase();
    if(/hair|머리카락/.test(n))return 'hair';
    if(/face|eye|irides|nose|mouth|ears|얼굴|눈|코|입|귀/.test(n))return 'head';
    if(/neck|topwear|목|상의/.test(n))return 'body';
    if(/handwear|^arm|팔/.test(n))return center(l)<head.x?'arm_left':'arm_right';
    return 'root';
  });
  return {points,assignments,width,height};
}
export function makeSkeleton(layers,rig,amplitude=1){
  const parents={body:'root',head:'body',arm_left:'body',arm_right:'body',hair:'head'},p=rig.points;
  const bones=Object.keys(boneLabels).map(name=>{
    if(name==='root')return {name};
    const parent=parents[name];return {name,parent,x:round(p[name].x-p[parent].x),y:round(p[parent].y-p[name].y),length:round(rig.height*.05)};
  });
  const attachments={},slots=[];
  for(let i=layers.length-1;i>=0;i--){const l=layers[i],name=`part_${String(i+1).padStart(2,'0')}`,bone=rig.assignments[i],point=p[bone];
    const slot={name,bone};if(l.visible!==false)slot.attachment=name;
    slot.color='ffffff'+Math.round((l.opacity??1)*255).toString(16).padStart(2,'0');slots.push(slot);
    attachments[name]={[name]:{name,path:name,x:round(l.x+l.width/2-point.x),y:round(point.y-l.y-l.height/2),width:l.width,height:l.height}};
  }
  const timelines={};
  for(const [bone,degrees]of Object.entries({body:.3,head:-.65,arm_left:.75,arm_right:-.75,hair:1})){
    timelines[bone]={rotate:Array.from({length:49},(_,i)=>({time:round(i/12),value:round(Math.sin(i/48*Math.PI*2)*degrees*amplitude)}))};
  }
  timelines.body.scale=Array.from({length:49},(_,i)=>({time:round(i/12),x:1,y:round(1+(1-Math.cos(i/48*Math.PI*2))*.006*amplitude)}));
  return {skeleton:{spine:'4.0.64',x:-rig.width/2,y:0,width:rig.width,height:rig.height,images:'./images/',fps:30},bones,slots,skins:[{name:'default',attachments}],animations:{idle:{bones:timelines}}};
}
function sample(frames,t,key,defaultValue){if(!frames)return defaultValue;let a=frames[0],b=a;for(const f of frames){if(f.time<=t)a=f;if(f.time>=t){b=f;break;}b=f;}const r=b.time===a.time?0:(t-a.time)/(b.time-a.time);return (a[key]??defaultValue)*(1-r)+(b[key]??defaultValue)*r;}
export function poseMatrices(skeleton,time=null){
  const m={};for(const b of skeleton.bones){const tl=time===null?{}:skeleton.animations.idle.bones[b.name]||{},t=(time??0)%4;
    const angle=sample(tl.rotate,t,'value',0)*Math.PI/180,sx=sample(tl.scale,t,'x',1),sy=sample(tl.scale,t,'y',1);
    const a=Math.cos(angle)*sx,c=-Math.sin(angle)*sy,d=Math.cos(angle)*sy,bb=Math.sin(angle)*sx,x=b.x||0,y=b.y||0;
    if(!b.parent){m[b.name]=[a,bb,c,d,x,y];continue;}const q=m[b.parent];
    m[b.name]=[q[0]*a+q[2]*bb,q[1]*a+q[3]*bb,q[0]*c+q[2]*d,q[1]*c+q[3]*d,q[0]*x+q[2]*y+q[4],q[1]*x+q[3]*y+q[5]];
  }return m;
}
