// FaceRig reference: separate head/face controls, local sprite influences, sparse facial meshes.
export const faceLabels={face_root:'얼굴 전체',face_left:'오른 볼 (화면 왼쪽)',face_right:'왼 볼 (화면 오른쪽)',face_nose:'코',face_jaw:'턱',face_mouth:'입',face_eye_left:'오른 눈 (화면 왼쪽)',face_eye_right:'왼 눈 (화면 오른쪽)',face_brow_left:'오른 눈썹 (화면 왼쪽)',face_brow_right:'왼 눈썹 (화면 오른쪽)',face_pupil_left:'오른 눈동자 (화면 왼쪽)',face_pupil_right:'왼 눈동자 (화면 오른쪽)'};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function pixelBounds(l){
  if(!l.data)return {x:l.x,y:l.y,width:l.width,height:l.height};let x0=l.width,y0=l.height,x1=-1,y1=-1;
  for(let y=0;y<l.height;y++)for(let x=0;x<l.width;x++)if(l.data[(y*l.width+x)*4+3]>32){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  return x1<0?null:{x:l.x+x0,y:l.y+y0,width:x1-x0+1,height:y1-y0+1};
}
export function framedLayers(layers){return layers.map(l=>{const b=pixelBounds(l);return b?{...l,...b,data:undefined}:null;}).filter(Boolean);}
export function detectFrame(layers,width,height){
  const ls=framedLayers(layers),has=re=>ls.some(l=>re.test(l.name));
  if(has(/bottomwear|legwear|footwear|^(thigh|shin|foot|shoe)_[rl]|하의|다리|신발/i))return 'full';
  const face=ls.find(l=>/^(face|얼굴)(?:$|[_ -])/i.test(l.name));
  if(face&&face.height/height>.34)return 'bust';
  if(has(/handwear|^(arm|upper_arm|forearm|hand)[_ -]|팔/i))return 'half';
  return face?'bust':'full';
}
// The reference uses translation controls for eyes/lids/face planes, not independent rotations.
export function facePartKind(name){
  const n=name.split('/').at(-1).toLowerCase();
  if(/brow|눈썹/.test(n))return 'brow';
  if(/iris|irides|pup|눈동자|highlight/.test(n))return 'pupil';
  if(/lash|lid|눈꺼풀|속눈썹/.test(n))return /low|lower|bottom|아래/.test(n)?'lid_lower':/up|upper|top|위/.test(n)?'lid_upper':'lids';
  if(/eye|흰자|안구|눈/.test(n))return 'eye';
  if(/nose|코/.test(n))return 'nose';if(/mouth|lip|입/.test(n))return 'mouth';return null;
}
const added={face_lid_upper_left:'오른 위 눈꺼풀',face_lid_lower_left:'오른 아래 눈꺼풀',face_lid_upper_right:'왼 위 눈꺼풀',face_lid_lower_right:'왼 아래 눈꺼풀',face_hair_front:'앞머리',face_hair_back:'뒷머리'};
Object.assign(faceLabels,added);
export function configureFace(rig,layers){
  const ls=framedLayers(layers),W=rig.width,H=rig.height,P=rig.points,find=re=>ls.find(l=>re.test(l.name));
  const shirt=find(/topwear|상의|shirt/i),neck=find(/^(neck|목)(?:$|[_ -])/i),hair=find(/hair|머리카락/i),face=find(/^(face|얼굴)(?:$|[_ -])/i)||{x:W*.25,y:H*.1,width:W*.5,height:H*.55};
  const point=(x,y)=>({x:clamp(x,0,W),y:clamp(y,0,H)}),at=(u,v)=>point(face.x+face.width*u,face.y+face.height*v),cx=face.x+face.width/2,center=l=>point(l.x+l.width/2,l.y+l.height/2),side=l=>l.x+l.width/2<cx?'left':'right';
  P.body=point(cx,(shirt?shirt.y+shirt.height:H)-1);rig.labels.body='흉상 기준';P.chest=point(cx,shirt?shirt.y+shirt.height*.6:H*.88);rig.parents.chest='body';
  P.neck=point(cx,neck?neck.y+neck.height*.86:face.y+face.height*1.08);P.head=at(.5,.97);P.hair=hair?point(hair.x+hair.width/2,hair.y+hair.height*.2):at(.5,.1);
  const active=new Set(['root','body','chest','neck','head']),add=(id,p,parent='face_root')=>{P[id]=p;rig.parents[id]=parent;rig.labels[id]=faceLabels[id];active.add(id);};
  add('face_root',at(.5,.5),'head');add('face_left',at(.18,.62));add('face_right',at(.82,.62));add('face_nose',at(.5,.59));add('face_jaw',at(.5,.91));
  const both=l=>/^(eye|pupil|brow|lids|lid_upper|lid_lower)$/.test(facePartKind(l.name))&&l.width>face.width*.55&&l.x<cx&&l.x+l.width>cx;
  const details=ls.flatMap(l=>both(l)?[{...l,width:cx-l.x},{...l,x:cx,width:l.x+l.width-cx}]:[l]).map(l=>({...l,kind:facePartKind(l.name)})),eyeBoxes={};
  for(const which of ['left','right']){
    const local=details.filter(l=>side(l)===which),white=local.find(l=>l.kind==='eye'),iris=local.find(l=>l.kind==='pupil'),lash=local.find(l=>l.kind?.startsWith('lid')),brow=local.find(l=>l.kind==='brow');
    const eye=white||iris||lash;if(!eye&&!brow)continue;
    const box=eye||brow;eyeBoxes[which]={x:box.x,y:box.y,width:box.width,height:box.height};
    add(`face_eye_${which}`,eye?center(eye):at(which==='left'?.28:.72,.4),`face_${which}`);
    if(iris)add(`face_pupil_${which}`,center(iris),`face_eye_${which}`);
    if(brow)add(`face_brow_${which}`,center(brow),`face_eye_${which}`);
    for(const vertical of ['upper','lower']){
      const l=local.find(l=>l.kind===`lid_${vertical}`)||local.find(l=>l.kind==='lids');if(!l)continue;
      add(`face_lid_${vertical}_${which}`,point(l.x+l.width/2,l.y+l.height*(l.kind==='lids'?(vertical==='upper'?.15:.9):.5)),`face_eye_${which}`);
    }
  }
  for(const kind of ['nose','mouth']){const l=details.find(l=>l.kind===kind);if(l)add(`face_${kind}`,center(l));}
  for(const which of ['front','back']){const l=ls.find(l=>/hair|머리카락/i.test(l.name)&&(/back|뒤|뒷/i.test(l.name)?'back':'front')===which);if(l)add(`face_hair_${which}`,point(l.x+l.width/2,l.y+l.height*.72),'head');}
  // Keep dormant schema points for older templates, but never display or bind absent facial parts.
  for(const id of Object.keys(faceLabels))if(!P[id]){P[id]=at(.5,.5);rig.parents[id]='face_root';rig.labels[id]=faceLabels[id];}
  rig.activeBones=[...active];rig.faceRig=2;rig.faceGeometry={face,eyes:eyeBoxes};rig.pose={};rig.poseOffsets={};rig.sleeves={};rig.partBones={};rig.faceBindings={};
  rig.assignments=layers.map((l,i)=>{
    const b=pixelBounds(l)||l,n=l.name,kind=facePartKind(n),which=side(b);let bone='chest',mode='rigid',allowed=null;
    if(/hair|머리카락/i.test(n)){bone=/back|뒤|뒷/i.test(n)?'face_hair_back':'face_hair_front';mode='face';}
    else if(/^(neck|목)(?:$|[_ -])/i.test(n)){bone='neck';mode='neck';allowed=['chest','neck','head'];}
    else if(/^(face|얼굴)(?:$|[_ -])/i.test(n)){bone='face_root';mode='face';}
    else if(kind){bone=kind==='nose'||kind==='mouth'?`face_${kind}`:`face_${kind==='lids'?'lid_upper':kind}_${which}`;mode='face';}
    else if(/^ears?(?:$|[_ -]|[lr])|^귀/i.test(n)){bone=`face_${which}`;mode='face';}
    if(!active.has(bone))bone='face_root';rig.modes[i]=mode;if(mode==='face'){allowed=faceCandidates(rig,bone);if(both({...b,name:n})){const pair=bone.replace(/_(left|right)$/,bone.endsWith('left')?'_right':'_left');allowed=[...new Set([...allowed,...faceCandidates(rig,pair)])];}rig.faceBindings[i]=allowed;}
    if(allowed)rig.partBones[i]=allowed;return bone;
  });return rig;
}
export function faceCandidates(rig,bone,index){
  if(index!==undefined&&rig.faceBindings?.[index])return rig.faceBindings[index].filter(id=>rig.points[id]&&rig.activeBones.includes(id));
  const available=ids=>ids.filter(id=>rig.points[id]&&(!rig.activeBones||rig.activeBones.includes(id)));
  if(bone==='face_root')return available(['face_root','face_left','face_right','face_nose','face_jaw','face_mouth','face_eye_left','face_eye_right','face_brow_left','face_brow_right']);
  if(bone==='hair'||bone.startsWith('face_hair_'))return available([bone,'head']);
  const m=bone.match(/^face_(eye|lid_upper|lid_lower|pupil)_(left|right)$/);
  if(m){const side=m[2];return available(m[1]==='pupil'?[bone]:[`face_eye_${side}`,`face_lid_upper_${side}`,`face_lid_lower_${side}`]);}
  if(bone==='face_left'||bone==='face_right')return available([bone,'face_root']);
  return [bone];
}
// Lossless split: each original lash pixel belongs to exactly one exported lid sprite.
export function splitFaceLids(layer,rig){
  if(rig.faceRig<2||!layer.data)return null;
  const kind=facePartKind(layer.name),cx=rig.points.face_root.x,bounds=pixelBounds(layer)||layer;
  if(/^(eye|pupil|brow|lids|lid_upper|lid_lower)$/.test(kind)&&bounds.width>(rig.faceGeometry?.face?.width||rig.width)*.55&&bounds.x<cx&&bounds.x+bounds.width>cx){
    const cut=clamp(Math.round(cx-layer.x),1,layer.width-1),out=[];
    for(const [side,lo,hi]of [['left',0,cut],['right',cut,layer.width]]){const width=hi-lo,data=new Uint8ClampedArray(width*layer.height*4);for(let y=0;y<layer.height;y++)data.set(layer.data.subarray((y*layer.width+lo)*4,(y*layer.width+hi)*4),y*width*4);const part={...layer,canvas:null,x:layer.x+lo,width,data,name:layer.name+'_'+side,bone:`face_${kind==='lids'?'lid_upper':kind}_${side}`,mode:'face'};out.push(...(splitFaceLids(part,rig)||[part]));}return out;
  }
  if(kind!=='lids')return null;
  const b=pixelBounds(layer)||layer,side=b.x+b.width/2<rig.points.face_root.x?'left':'right',eye=rig.points[`face_eye_${side}`];if(!eye)return null;
  const cut=clamp(Math.round(eye.y-layer.y),1,layer.height-1),parts=[];
  for(const [kind,lo,hi]of [['upper',0,cut],['lower',cut,layer.height]]){
    if(hi<=lo)continue;const width=layer.width,height=hi-lo,data=layer.data.slice(lo*width*4,hi*width*4);if(!data.some((v,i)=>i%4===3&&v>0))continue;
    parts.push({...layer,canvas:null,name:`${layer.name}_${kind}_lid`,y:layer.y+lo,width,height,data,bone:`face_lid_${kind}_${side}`,mode:'face'});
  }return parts.length?parts:null;
}
export function faceWeights(layer,rig,bone,x,y){const weights=rawFaceWeights(layer,rig,bone,x,y),total=weights.reduce((s,[,v])=>s+v,0);return total>0?weights.map(([id,v])=>[id,v/total]):[[bone,1]];}
function rawFaceWeights(layer,rig,bone,x,y){
  const requested=rig.partBones?.[layer.source],ids=faceCandidates(rig,bone).filter(id=>!requested||requested.includes(id));if(!ids.length)ids.push(bone);if(ids.length===1)return [[ids[0],1]];
  const P=rig.points,fw=rig.faceGeometry?.face?.width||Math.max(20,Math.abs(P.face_left.x-P.face_right.x)*1.5),smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  if(bone==='hair'||bone.startsWith('face_hair_')){const w=smooth((y-layer.y)/Math.max(1,layer.height));return [[ids.includes('head')?'head':bone,1-w],[bone,w]].filter(([,v])=>v>0);}
  if(/^face_(eye|lid_)/.test(bone)){
    const which=bone.endsWith('left')?'left':'right',eye=`face_eye_${which}`,b=rig.faceGeometry?.eyes?.[which]||{x:layer.x,y:layer.y,width:layer.width,height:layer.height};
    const center=1-smooth(Math.abs(x-(b.x+b.width/2))/(b.width*.5));
    if(bone.startsWith('face_lid_')){const w=.9*center;return [[eye,1-w],[bone,w]].filter(([id,v])=>ids.includes(id)&&v>0).map((v,i,a)=>[v[0],v[1]/a.reduce((n,q)=>n+q[1],0)]);}
    const upper=`face_lid_upper_${which}`,lower=`face_lid_lower_${which}`,id=y<P[eye].y?upper:lower,w=ids.includes(id)?.25*center:0;return [[eye,1-w],[id,w]].filter(([id,v])=>ids.includes(id)&&v>0);
  }
  if(bone!=='face_root'){const total=ids.length;return ids.map(id=>[id,1/total]);}
  // Compact supports, with an anchored base. Distant points never pull the entire face.
  const weights=ids.filter(id=>id!=='face_root').map(id=>{const p=P[id],feature=/eye|brow|mouth|nose/.test(id),rx=fw*(feature?.22:.48),ry=fw*(feature?.15:.4),d=Math.hypot((x-p.x)/rx,(y-p.y)/ry),w=(1-smooth(d))*(feature?.8:.5);return [id,w];}).filter(([,w])=>w>.001).sort((a,b)=>b[1]-a[1]).slice(0,3);
  const total=weights.reduce((s,[,w])=>s+w,0),factor=total>.9?.9/total:1;return [['face_root',1-total*factor],...weights.map(([id,w])=>[id,w*factor])].filter(([id,w])=>ids.includes(id)&&w>0);
}

// Reference lid transforms follow pupil translation partially; bake this contribution in manual_pose.
export function facialOffsets(rig){
  const offsets=Object.fromEntries(Object.entries(rig.poseOffsets||{}).map(([id,p])=>[id,{...p}]));
  if(rig.faceRig>=2)for(const side of ['left','right']){
    const pupil=offsets[`face_pupil_${side}`];if(!pupil)continue;
    for(const part of ['upper','lower']){const id=`face_lid_${part}_${side}`;if(!rig.activeBones.includes(id))continue;const own=offsets[id]||{x:0,y:0};offsets[id]={x:own.x+pupil.x*.45,y:own.y+pupil.y*.55};}
  }return offsets;
}
