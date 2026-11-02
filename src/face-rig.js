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
export function configureFace(rig,layers){
  const ls=framedLayers(layers),W=rig.width,H=rig.height,P=rig.points;
  const find=re=>ls.find(l=>re.test(l.name)),shirt=find(/topwear|상의|shirt/i),neck=find(/^(neck|목)(?:$|[_ -])/i),hair=find(/hair|머리카락/i);
  const face=find(/^(face|얼굴)(?:$|[_ -])/i)||{x:W*.25,y:H*.1,width:W*.5,height:H*.55};
  const point=(x,y)=>({x:clamp(x,0,W),y:clamp(y,0,H)}),at=(u,v)=>point(face.x+face.width*u,face.y+face.height*v),cx=face.x+face.width/2;
  const bottom=shirt?shirt.y+shirt.height:H;
  P.body=point(cx,bottom-1);rig.labels.body='흉상 기준';P.chest=point(cx,shirt?shirt.y+shirt.height*.6:H*.88);rig.parents.chest='body';
  P.neck=point(cx,neck?neck.y+neck.height*.86:face.y+face.height*1.08);P.head=at(.5,.97);P.hair=hair?point(hair.x+hair.width/2,hair.y+hair.height*.22):at(.5,.1);
  const coords={face_root:[.5,.5],face_left:[.2,.62],face_right:[.8,.62],face_nose:[.5,.59],face_jaw:[.5,.91],face_mouth:[.5,.78],face_eye_left:[.28,.4],face_eye_right:[.72,.4],face_brow_left:[.28,.29],face_brow_right:[.72,.29],face_pupil_left:[.28,.4],face_pupil_right:[.72,.4]};
  // Only expose individual eyelids/irises when the actual layers exist.
  const facial=ls.filter(l=>/eye|iris|irides|pup|brow|lash|lid|nose|mouth|lip|눈|코|입/i.test(l.name));
  const center=l=>point(l.x+l.width/2,l.y+l.height/2),side=l=>l.x+l.width/2<cx?'left':'right';
  const feature=l=>/brow|눈썹/i.test(l.name)?`face_brow_${side(l)}`:/iris|irides|pup|눈동자/i.test(l.name)?`face_pupil_${side(l)}`:/eye|lash|lid|눈/i.test(l.name)?`face_eye_${side(l)}`:/nose|코/i.test(l.name)?'face_nose':/mouth|lip|입/i.test(l.name)?'face_mouth':null;
  const bilateral=l=>/eye|iris|irides|pup|brow|lash|lid|눈/i.test(l.name)&&l.width>face.width*.55;
  const exposed=new Set(['face_root','face_left','face_right','face_nose','face_jaw']);
  for(const l of facial){const id=feature(l);if(!id)continue;exposed.add(id);if(bilateral(l))exposed.add(id.replace(/_(left|right)$/,'_left')),exposed.add(id.replace(/_(left|right)$/,'_right'));if(/pupil|brow/.test(id)){exposed.add(`face_eye_${side(l)}`);if(bilateral(l))exposed.add('face_eye_left'),exposed.add('face_eye_right');}}
  for(const [id,uv]of Object.entries(coords)){
    P[id]=at(...uv);rig.labels[id]=faceLabels[id];rig.parents[id]=id==='face_root'?'head':id==='face_mouth'?'face_jaw':/^face_eye_/.test(id)?`face_${id.endsWith('left')?'left':'right'}`:/pupil|brow/.test(id)?`face_eye_${id.endsWith('left')?'left':'right'}`:'face_root';
  }
  for(const id of exposed){const matches=facial.filter(l=>feature(l)===id&&!bilateral(l));if(matches.length){const x=Math.min(...matches.map(l=>l.x)),y=Math.min(...matches.map(l=>l.y)),r=Math.max(...matches.map(l=>l.x+l.width)),b=Math.max(...matches.map(l=>l.y+l.height));P[id]=center({x,y,width:r-x,height:b-y});}}
  rig.activeBones=['root','body','chest','neck','head','hair',...exposed];rig.faceRig=1;rig.poseOffsets={};rig.sleeves={};rig.partBones={};
  rig.assignments=layers.map((l,i)=>{
    const n=l.name,b=pixelBounds(l)||l,id=feature({...b,name:n});let bone='chest',allowed=null,mode='rigid';
    if(/hair|머리카락/i.test(n)){bone='hair';allowed=['hair','face_left','face_right'];mode='face';}
    else if(/^(neck|목)(?:$|[_ -])/i.test(n)){bone='neck';mode='neck';allowed=['chest','neck','head'];}
    else if(/^face(?:$|[_ -])|^얼굴/i.test(n)){bone='face_root';allowed=['face_root','face_left','face_right','face_nose','face_jaw'];mode='face';}
    else if(id){bone=exposed.has(id)?id:'face_root';allowed=bilateral({...b,name:n})?[id.replace(/_(left|right)$/,'_left'),id.replace(/_(left|right)$/,'_right')]:[bone];mode='face';}
    else if(/^ears?(?:$|[_ -]|[lr])|^귀/i.test(n)){bone=b.x+b.width/2<cx?'face_left':'face_right';allowed=[bone,'head'];mode='face';}
    rig.modes[i]=mode;if(allowed)rig.partBones[i]=allowed;return bone;
  });
  return rig;
}
export function faceCandidates(rig,bone){
  if(bone==='face_root')return ['face_root','face_left','face_right','face_nose','face_jaw'].filter(id=>rig.points[id]);
  if(bone==='hair')return ['hair','face_left','face_right'].filter(id=>rig.points[id]);
  if(/^face_(eye|brow|pupil)_/.test(bone))return [bone.replace(/_(left|right)$/,'_left'),bone.replace(/_(left|right)$/,'_right')].filter(id=>rig.activeBones?.includes(id));
  if(bone==='face_left'||bone==='face_right')return [bone,'head'];
  return [bone];
}
export function faceWeights(layer,rig,bone,x,y){
  const options=faceCandidates(rig,bone),requested=rig.partBones?.[layer.source],ids=options.filter(id=>!requested||requested.includes(id));
  if(!ids.length)ids.push(bone);if(ids.length===1)return [[ids[0],1]];
  const L=rig.points.face_left,R=rig.points.face_right,scale=Math.max(8,L&&R?Math.hypot(L.x-R.x,L.y-R.y)*.28:Math.min(layer.width,layer.height)*.25);
  const ranked=ids.map(id=>{const p=rig.points[id],d=Math.hypot(x-p.x,y-p.y);return [id,1/(1+(d/scale)**4)];}).sort((a,b)=>b[1]-a[1]).slice(0,3);
  // Hair has an independent anchor: cheek handles may shape edges, not pull the entire cap.
  if(bone==='hair'&&ids.includes('hair')){const others=ranked.filter(([id])=>id!=='hair'),sum=others.reduce((s,[,w])=>s+w,0);return [['hair',.85],...others.map(([id,w])=>[id,.15*w/(sum||1)])].filter(([,w])=>w>0);}
  const sum=ranked.reduce((s,[,w])=>s+w,0);return ranked.map(([id,w])=>[id,w/sum]);
}
