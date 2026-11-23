import {isHeadAccessory} from './part-identity.js';
import {hairChainIds,hairChainWeights} from './hair-chains.js';
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
  // flare가 그린 눈꺼풀(얼굴 뒤, 깜빡일 때 위 눈꺼풀 뼈를 따라 내려옴)
  if(/^eyelid(?:_|$)/.test(n))return 'lid_cover';
  if(/iris|irides|pup|눈동자|highlight/.test(n))return 'pupil';
  if(/lash|lid|눈꺼풀|속눈썹/.test(n))return /low|lower|bottom|아래/.test(n)?'lid_lower':/up|upper|top|위/.test(n)?'lid_upper':'lids';
  if(/eye|흰자|안구|눈/.test(n))return 'eye';
  if(/nose|코/.test(n))return 'nose';if(/mouth|lip|입/.test(n))return 'mouth';return null;
}
const added={face_turn:'얼굴 돌리기 (3D 조종)',face_lid_upper_left:'오른 위 눈꺼풀',face_lid_lower_left:'오른 아래 눈꺼풀',face_lid_upper_right:'왼 위 눈꺼풀',face_lid_lower_right:'왼 아래 눈꺼풀',face_lid_cover_left:'오른 눈꺼풀 그림 (감을 때 덮음)',face_lid_cover_right:'왼 눈꺼풀 그림 (감을 때 덮음)',face_hair_front:'앞머리',face_hair_back:'뒷머리'};
Object.assign(faceLabels,added);
// 이름에 좌우가 있으면(eyelash_r = 캐릭터 오른쪽 = 화면 왼쪽) 그것을 따른다: 고개를 튼 얼굴은 가까운 쪽 눈이
// 얼굴 상자 가운데선에 걸쳐, 위치로만 나누면 한 눈의 흰자·눈동자가 반대쪽 눈으로 간다.
export const nameSide=n=>{const m=String(n||'').split('/').at(-1).toLowerCase().match(/(?:^|_)(r|l)(?:_(?:upper|lower)_lid|_(?:left|right))?$/);return m?(m[1]==='r'?'left':'right'):null;};
export function configureFace(rig,layers){
  const ls=framedLayers(layers),W=rig.width,H=rig.height,P=rig.points,find=re=>ls.find(l=>re.test(l.name));
  const shirt=find(/topwear|상의|shirt/i),neck=find(/^(neck|목)(?:$|[_ -])/i),hair=find(/hair|머리카락/i),face=find(/^(face|얼굴)(?:$|[_ -])/i)||{x:W*.25,y:H*.1,width:W*.5,height:H*.55};
  const point=(x,y)=>({x:clamp(x,0,W),y:clamp(y,0,H)}),at=(u,v)=>point(face.x+face.width*u,face.y+face.height*v),cx=face.x+face.width/2,center=l=>point(l.x+l.width/2,l.y+l.height/2),side=l=>nameSide(l.name)||(l.x+l.width/2<cx?'left':'right');
  P.body=point(cx,(shirt?shirt.y+shirt.height:H)-1);rig.labels.body='흉상 기준';P.chest=point(cx,shirt?shirt.y+shirt.height*.6:H*.88);rig.parents.chest='body';
  P.neck=point(cx,neck?neck.y+neck.height*.86:face.y+face.height*1.08);P.head=at(.5,.97);P.hair=hair?point(hair.x+hair.width/2,hair.y+hair.height*.2):at(.5,.1);
  const active=new Set(['root','body','chest','neck','head']),add=(id,p,parent='face_root')=>{P[id]=p;rig.parents[id]=parent;rig.labels[id]=faceLabels[id];active.add(id);};
  add('face_root',at(.5,.5),'head');add('face_turn',at(.5,.5));add('face_left',at(.18,.62));add('face_right',at(.82,.62));add('face_nose',at(.5,.59));add('face_jaw',at(.5,.91));
  const both=l=>!nameSide(l.name)&&/^(eye|pupil|brow|lids|lid_upper|lid_lower|lid_cover)$/.test(facePartKind(l.name))&&l.width>face.width*.55&&l.x<cx&&l.x+l.width>cx;
  const lidDrop={},lashDrop={},details=ls.flatMap(l=>both(l)?[{...l,width:cx-l.x},{...l,x:cx,width:l.x+l.width-cx}]:[l]).map(l=>({...l,kind:facePartKind(l.name)})),eyeBoxes={};
  for(const which of ['left','right']){
    const local=details.filter(l=>side(l)===which),white=local.find(l=>l.kind==='eye'),iris=local.find(l=>l.kind==='pupil'),lash=local.find(l=>l.kind?.startsWith('lid')&&l.kind!=='lid_cover'),brow=local.find(l=>l.kind==='brow');
    const eye=white||iris||lash;if(!eye&&!brow)continue;
    const box=eye||brow;eyeBoxes[which]={x:box.x,y:box.y,width:box.width,height:box.height};
    add(`face_eye_${which}`,eye?center(eye):at(which==='left'?.28:.72,.4),`face_${which}`);
    if(iris)add(`face_pupil_${which}`,center(iris),`face_eye_${which}`);
    // 눈꺼풀 그림(H = 레이어 높이)은 평소 H만큼 위에 있으므로 얼굴 눈 구멍 아래끝 = y + 2H - 1.
    // 위 속눈썹은 제 아래끝이 그 구멍 아래끝(flare가 그린 감은 눈 선 자리)에 닿을 만큼 내려온다(리깅 화면은 파츠 크기만 알므로 상자로 잰다).
    const up=local.find(l=>l.kind==='lids'||l.kind==='lid_upper'),coverBox=local.find(l=>l.kind==='lid_cover');
    if(up&&coverBox){const H=coverBox.height,D=coverBox.y+2*H-1-(up.y+up.height-1);lashDrop[which]=Math.max(H*.3,Math.min(H*.9,D));}
    const coverD=local.find(l=>l.kind==='lid_cover');if(coverD){lidDrop[which]=coverD.height;add(`face_lid_cover_${which}`,point(coverD.x+coverD.width/2,coverD.y+coverD.height/2),`face_eye_${which}`);}
    if(brow)add(`face_brow_${which}`,center(brow),`face_eye_${which}`);
    for(const vertical of ['upper','lower']){
      const l=local.find(l=>l.kind===`lid_${vertical}`)||local.find(l=>l.kind==='lids');if(!l)continue;
      add(`face_lid_${vertical}_${which}`,point(l.x+l.width/2,l.y+l.height*(l.kind==='lids'?(vertical==='upper'?.15:.9):.5)),`face_eye_${which}`);
    }
  }
  for(const kind of ['nose','mouth']){const l=details.find(l=>l.kind===kind);if(l)add(`face_${kind}`,center(l));}
  // 앞·뒷머리 조종 뼈는 얼굴 기준(face_root, 수평 축) 아래: 고개 돌리기 제약의 가로 이동이 그대로 가로로 적용된다(위를 향한 head·hair 뼈 아래면 세로로 돌아간다).
  for(const which of ['front','back']){const l=ls.find(l=>/hair|머리카락/i.test(l.name)&&(/back|뒤|뒷/i.test(l.name)?'back':'front')===which);if(l)add(`face_hair_${which}`,point(l.x+l.width/2,l.y+l.height*.72),'face_root');}
  // Keep dormant schema points for older templates, but never display or bind absent facial parts.
  for(const id of Object.keys(faceLabels))if(!P[id]){P[id]=at(.5,.5);rig.parents[id]='face_root';rig.labels[id]=faceLabels[id];}
  // 눈에서 얼굴 레이어가 끝나는 곳(머리카락 밑까지 그려진 얼굴 포함)까지 가로 거리: 3/4 얼굴의 먼 쪽 눈은 얼굴 윤곽에 붙어
  // 고개를 돌릴 때 덜 움직여야 한다(rig-core faceTurnMixes). 앞머리가 얼굴 위를 덮는 그림은 얼굴이 그 밑까지 이어져 영향이 없다.
  // 픽셀이 없으면(템플릿 전용) 재지 않는다.
  const faceL=layers.find(l=>/^(face|얼굴)(?:$|[_ -])/i.test(l.name)&&l.data);
  const alpha=(l,x,y)=>{const px=Math.floor(x-l.x),py=Math.floor(y-l.y);return px<0||py<0||px>=l.width||py>=l.height?0:l.data[(py*l.width+px)*4+3];};
  // 눈 상자 밖에서부터 잰다(얼굴의 눈 자리는 구멍이라). 눈 높이 세 줄 중 가장 긴 값.
  if(faceL)for(const box of Object.values(eyeBoxes)){let best=-1;for(const f of [.3,.5,.7]){const ey=box.y+box.height*f,open=x=>alpha(faceL,x,ey)>=128;
    let l=0,r=0;while(l<W&&open(box.x-1-l))l++;while(r<W&&open(box.x+box.width+r))r++;best=Math.max(best,Math.min(l,r));}box.edge=best;}
  rig.activeBones=[...active];rig.faceRig=2;rig.faceGeometry={face,eyes:eyeBoxes,...(Object.keys(lidDrop).length?{lidDrop}:{}),...(Object.keys(lashDrop).length?{lashDrop}:{})};rig.pose={};rig.poseOffsets={};rig.sleeves={};rig.partBones={};rig.faceBindings={};
  rig.assignments=layers.map((l,i)=>{
    const b=pixelBounds(l)||l,n=l.name,kind=facePartKind(n),which=side({...b,name:n});let bone='chest',mode='rigid',allowed=null;
    if(isHeadAccessory(n)){bone='head';allowed=['head'];}
    else if(/hair|머리카락/i.test(n)){bone=/back|뒤|뒷/i.test(n)?'face_hair_back':'face_hair_front';mode='face';}
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
  if(bone==='hair'||bone.startsWith('face_hair_'))return available([bone,'head',...hairChainIds(rig,bone)]);
  const m=bone.match(/^face_(eye|lid_upper|lid_lower|lid_cover|pupil)_(left|right)$/);
  if(m){const side=m[2];return available(m[1]==='pupil'||m[1]==='lid_cover'?[bone]:[`face_eye_${side}`,`face_lid_upper_${side}`,`face_lid_lower_${side}`]);}
  if(bone==='face_left'||bone==='face_right')return available([bone,'face_root']);
  return [bone];
}
// Add facial controls to a half-body rig without replacing the torso, arms, IK or poses.
// Called once for legacy projects; later loads retain hand-edited facial points and bindings.
export function extendHalfFace(rig,layers){
  if(!['half','full'].includes(rig.frame)||rig.faceRig>=2||!layers.some(l=>/^(face|얼굴)(?:$|[_ -])/i.test(l.name)))return false;
  const face=configureFace(JSON.parse(JSON.stringify(rig)),layers),ids=Object.keys(faceLabels);
  if(new Set([...Object.keys(rig.points),...ids]).size>64)return false;
  const active=rig.activeBones||Object.keys(rig.points);
  for(const id of ids){rig.points[id]={...face.points[id]};rig.parents[id]=face.parents[id];rig.labels[id]=face.labels[id];}
  rig.activeBones=[...new Set([...active,...face.activeBones.filter(id=>id.startsWith('face_'))])];
  rig.partBones??={};rig.faceBindings??={};
  layers.forEach((l,i)=>{if(face.modes[i]!=='face')return;rig.assignments[i]=face.assignments[i];rig.modes[i]='face';rig.partBones[i]=[...face.partBones[i]];rig.faceBindings[i]=[...face.faceBindings[i]];});
  // 예전 프로젝트에서 머리카락 뼈(hair)에 포즈를 준 경우만 그 아래에 둔다. 새 리그는 face_root 아래(수평 축).
  for(const id of ['face_hair_front','face_hair_back'])if(rig.activeBones.includes(id)&&active.includes('hair')&&rig.pose?.hair)rig.parents[id]='hair';
  rig.faceGeometry=face.faceGeometry;rig.faceRig=2;return true;
}
// Lossless split: each original lash pixel belongs to exactly one exported lid sprite.
export function splitFaceLids(layer,rig){
  if(rig.faceRig<2||!layer.data)return null;
  const kind=facePartKind(layer.name),cx=rig.points.face_root.x,bounds=pixelBounds(layer)||layer;
  if(!nameSide(layer.name)&&/^(eye|pupil|brow|lids|lid_upper|lid_lower)$/.test(kind)&&bounds.width>(rig.faceGeometry?.face?.width||rig.width)*.55&&bounds.x<cx&&bounds.x+bounds.width>cx){
    const cut=clamp(Math.round(cx-layer.x),1,layer.width-1),out=[];
    for(const [side,lo,hi]of [['left',0,cut],['right',cut,layer.width]]){const width=hi-lo,data=new Uint8ClampedArray(width*layer.height*4);for(let y=0;y<layer.height;y++)data.set(layer.data.subarray((y*layer.width+lo)*4,(y*layer.width+hi)*4),y*width*4);const part={...layer,canvas:null,x:layer.x+lo,width,data,name:layer.name+'_'+side,bone:`face_${kind==='lids'?'lid_upper':kind}_${side}`,mode:'face'};out.push(...(splitFaceLids(part,rig)||[part]));}return out;
  }
  if(kind!=='lids')return null;
  const b=pixelBounds(layer)||layer,side=nameSide(layer.name)||(b.x+b.width/2<rig.points.face_root.x?'left':'right'),eye=rig.points[`face_eye_${side}`];if(!eye)return null;
  const cut=clamp(Math.round(eye.y-layer.y),1,layer.height-1),parts=[];
  for(const [kind,lo,hi]of [['upper',0,cut],['lower',cut,layer.height]]){
    if(hi<=lo)continue;const width=layer.width,height=hi-lo,data=layer.data.slice(lo*width*4,hi*width*4);if(!data.some((v,i)=>i%4===3&&v>0))continue;
    parts.push({...layer,canvas:null,name:`${layer.name}_${kind}_lid`,y:layer.y+lo,width,height,data,bone:`face_lid_${kind}_${side}`,mode:'face'});
  }return parts.length?parts:null;
}
export function faceWeights(layer,rig,bone,x,y){const weights=rawFaceWeights(layer,rig,bone,x,y),total=weights.reduce((s,[,v])=>s+v,0);return total>0?weights.map(([id,v])=>[id,v/total]):[[bone,1]];}
function rawFaceWeights(layer,rig,bone,x,y){
  // 속눈썹·눈썹·코·입 조각은 그 자리 얼굴 바탕과 같은 웨이트를 쓴다(레퍼처럼 이목구비가 얼굴과 한 몸으로 움직임).
  // 조각에 얼굴 선(볼·콧대)이 섞여 있어도 고개를 돌리거나 표정을 지을 때 얼굴과 어긋나 찢어지지 않는다.
  // 눈꺼풀·눈썹 뼈는 눈 뼈의 자식이므로 눈 몫을 자기 뼈로 바꾸면 얼굴과 같이 가면서 깜빡임·눈썹 이동만 더해진다.
  const detail=bone.match(/^face_(lid_upper|lid_lower|brow)_(left|right)$/);
  if((detail||/^face_(nose|mouth)$/.test(bone))&&rig.faceGeometry?.face){
    const fw=rig.faceGeometry.face.width;
    const all=faceCandidates(rig,'face_root'),eye=detail&&`face_eye_${detail[2]}`,swap=detail&&rig.parents[bone]===eye;
    const merged=new Map();for(const [id,w]of fieldWeights(rig,all,x,y,fw)){const to=swap&&id===eye?bone:id;merged.set(to,(merged.get(to)||0)+w);}
    if(merged.size)return [...merged].filter(([,w])=>w>0);
  }
  const requested=rig.partBones?.[layer.source],ids=faceCandidates(rig,bone).filter(id=>!requested||requested.includes(id));if(!ids.length)ids.push(bone);if(ids.length===1)return [[ids[0],1]];
  const P=rig.points,fw=rig.faceGeometry?.face?.width||Math.max(20,Math.abs(P.face_left.x-P.face_right.x)*1.5),smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  if(bone==='hair'||bone.startsWith('face_hair_')){
    // 아래로 갈수록 조종 뼈. 앞머리는 얼굴 둘레(얼굴 폭의 25% 안)도 조종 뼈를 따른다: 고개를 돌릴 때 볼 윤곽과 같은 비율로 움직여야 어긋나지 않는다.
    const fb=rig.faceGeometry?.face;let w=smooth((y-layer.y)/Math.max(1,layer.height));
    if(fb&&bone==='face_hair_front'){const dx=Math.max(fb.x-x,0,x-(fb.x+fb.width)),dy=Math.max(fb.y-y,0,y-(fb.y+fb.height));w=Math.max(w,1-smooth(Math.hypot(dx,dy)/(fb.width*.25)));}
    const base=[[ids.includes('head')?'head':bone,1-w],[bone,w]].filter(([,v])=>v>0);
    // 늘어진 가닥은 체인 마디를 따른다(사용자 예시처럼 끝으로 갈수록 늦게 흔들림)
    return (hairChainWeights(rig,bone,x,y,base)||base).filter(([id,v])=>v>0&&(ids.includes(id)||base.some(b=>b[0]===id)));}
  if(/^face_(eye|lid_)/.test(bone)){
    const which=bone.endsWith('left')?'left':'right',eye=`face_eye_${which}`,b=rig.faceGeometry?.eyes?.[which]||{x:layer.x,y:layer.y,width:layer.width,height:layer.height};
    const center=1-smooth(Math.abs(x-(b.x+b.width/2))/(b.width*.5));
    if(bone.startsWith('face_lid_')){const w=/^face_lid_(upper|cover)_/.test(bone)?1:.9*center;return [[eye,1-w],[bone,w]].filter(([id,v])=>ids.includes(id)&&v>0).map((v,i,a)=>[v[0],v[1]/a.reduce((n,q)=>n+q[1],0)]);}
    const upper=`face_lid_upper_${which}`,lower=`face_lid_lower_${which}`,id=y<P[eye].y?upper:lower,w=0;return [[eye,1-w],[id,w]].filter(([id,v])=>ids.includes(id)&&v>0);
  }
  if(bone!=='face_root'){const total=ids.length;return ids.map(id=>[id,1/total]);}
  const field=fieldWeights(rig,ids,x,y,fw);
  // 얼굴 윤곽(레이어 가장자리) 가까이는 이목구비 영향을 줄여 볼 뼈로 넘긴다: 3/4 얼굴의 먼 쪽 윤곽이 코·입을 따라 움직이면
  // 앞머리(볼과 같은 비율)와 어긋나 윤곽선이 두 줄로 보이거나 틈이 난다. 레퍼도 윤곽은 머리 쪽 뼈에 묶는다.
  const d=layer.data?edgeDistanceAt(layer,x,y):Infinity,fade=smooth(d/(fw*.1));
  if(fade>=1)return field;
  const L=P.face_left,R=P.face_right,u=L&&R&&R.x>L.x?smooth((x-L.x)/(R.x-L.x)):null,out=new Map();let moved=0;
  for(const [id,w]of field){if(/^face_(left|right|root)$/.test(id)||u===null){out.set(id,(out.get(id)||0)+w);continue;}out.set(id,(out.get(id)||0)+w*fade);moved+=w*(1-fade);}
  if(moved>0){out.set('face_left',(out.get('face_left')||0)+moved*(1-u));out.set('face_right',(out.get('face_right')||0)+moved*u);}
  return [...out].filter(([id,w])=>w>0&&ids.includes(id));
}
// 레이어 픽셀이 끝나는 곳(투명)까지 거리(px). 레이어별로 한 번만 계산한다.
const edgeCache=new WeakMap();
function edgeDistanceAt(layer,gx,gy){
  let d=edgeCache.get(layer.data);const W=layer.width,H=layer.height;
  // 바깥 윤곽까지만 잰다: 눈 구멍처럼 얼굴 안에 갇힌 빈칸은 얼굴로 본다(눈 구멍 둘레는 눈 뼈를 따라야 한다).
  if(!d){const out=new Uint8Array(W*H),q=[],push=i=>{if(!out[i]&&layer.data[i*4+3]<64){out[i]=1;q.push(i);}};
    for(let x=0;x<W;x++){push(x);push((H-1)*W+x);}for(let y=0;y<H;y++){push(y*W);push(y*W+W-1);}
    for(let k=0;k<q.length;k++){const i=q[k],x=i%W;if(x>0)push(i-1);if(x<W-1)push(i+1);if(i>=W)push(i-W);if(i<W*(H-1))push(i+W);}
    d=new Float32Array(W*H);for(let i=0;i<W*H;i++)d[i]=out[i]?0:1e6;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(!d[i])continue;let v=d[i];if(x===0||y===0||x===W-1||y===H-1)v=Math.min(v,1);if(x>0)v=Math.min(v,d[i-1]+1);if(y>0)v=Math.min(v,d[i-W]+1);if(x>0&&y>0)v=Math.min(v,d[i-W-1]+1.414);if(x<W-1&&y>0)v=Math.min(v,d[i-W+1]+1.414);d[i]=v;}
    for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const i=y*W+x;let v=d[i];if(x<W-1)v=Math.min(v,d[i+1]+1);if(y<H-1)v=Math.min(v,d[i+W]+1);if(x<W-1&&y<H-1)v=Math.min(v,d[i+W+1]+1.414);if(x>0&&y<H-1)v=Math.min(v,d[i+W-1]+1.414);d[i]=v;}
    edgeCache.set(layer.data,d);}
  const px=Math.floor(gx-layer.x),py=Math.floor(gy-layer.y);if(px<0||py<0||px>=W||py>=H)return 0;return d[py*W+px];
}
// 얼굴 바탕 메쉬의 웨이트 장(場): 기준(face_root) + 가까운 이목구비 뼈 최대 3개, 눈 구멍 둘레는 눈 뼈 100%.
function fieldWeights(rig,ids,x,y,fw){
  const P=rig.points,smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  // Compact supports, with an anchored base. Distant points never pull the entire face.
  const weights=ids.filter(id=>id!=='face_root').map(id=>{const p=P[id],feature=/eye|brow|mouth|nose/.test(id),rx=fw*(feature?.22:.48),ry=fw*(feature?.15:.4),d=Math.hypot((x-p.x)/rx,(y-p.y)/ry),w=(1-smooth(d))*(feature?.8:.5);return [id,w];}).filter(([,w])=>w>.001).sort((a,b)=>b[1]-a[1]).slice(0,3);
  // 바탕(이목구비 밖)은 기준 뼈 대신 좌우 볼 뼈에 나눠 건다: 고개를 돌릴 때 얼굴 윤곽이 앞머리(같은 0.3 비율)와 같이 움직여 틈이 안 생긴다.
  // 볼 뼈는 face_root의 자식이라 다른 모션에서는 기준 뼈와 똑같이 움직인다.
  const total=weights.reduce((s,[,w])=>s+w,0),factor=total>.9?.9/total:1,rest=1-total*factor,L=P.face_left,R=P.face_right,cheeks=L&&R&&ids.includes('face_left')&&ids.includes('face_right')&&R.x>L.x;
  const u=cheeks?smooth((x-L.x)/(R.x-L.x)):0,anchor=cheeks?[['face_left',rest*(1-u)],['face_right',rest*u]]:[['face_root',rest]];
  const merged=new Map();for(const [id,w]of [...anchor,...weights.map(([id,w])=>[id,w*factor])])merged.set(id,(merged.get(id)||0)+w);
  const base=[...merged].filter(([id,w])=>ids.includes(id)&&w>0);
  // 눈 구멍 둘레는 눈 뼈를 100% 따른다: 눈(흰자·눈동자)은 얼굴 뒤에 있어, 얼굴 구멍과 눈이 같은 양만큼 움직여야 어긋나지 않는다.
  for(const which of ['left','right']){const e=rig.faceGeometry?.eyes?.[which],id=`face_eye_${which}`;if(!e||!ids.includes(id))continue;
    const r=Math.hypot((x-(e.x+e.width/2))/(e.width/2),(y-(e.y+e.height/2))/(e.height/2)),s=1-smooth((r-1.3)/.6);if(s<=0)continue;
    const own=s+(base.find(([b])=>b===id)?.[1]||0)*(1-s),rest=base.filter(([b])=>b!==id).sort((a,b)=>b[1]-a[1]).slice(0,3),sum=rest.reduce((n,[,w])=>n+w,0)||1;
    return [...rest.map(([b,w])=>[b,w/sum*(1-own)]),[id,own]].filter(([,w])=>w>0);}
  return base;
}

// Reference lid transforms follow pupil translation partially; bake this contribution in manual_pose.
export function facialOffsets(rig){
  const offsets=Object.fromEntries(Object.entries(rig.poseOffsets||{}).map(([id,p])=>[id,{...p}]));
  if(rig.faceRig>=2)for(const side of ['left','right']){
    const pupil=offsets[`face_pupil_${side}`];if(!pupil)continue;
    for(const part of ['upper','lower']){const id=`face_lid_${part}_${side}`;if(!rig.activeBones.includes(id))continue;const own=offsets[id]||{x:0,y:0};offsets[id]={x:own.x+pupil.x*.45,y:own.y+pupil.y*.55};}
  }return offsets;
}
