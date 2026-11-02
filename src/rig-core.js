import {faceLabels,faceCandidates,faceWeights,splitFaceLids,facialOffsets} from './face-rig.js';
import {activeIds,activeBone,chainDefs,availableChain} from './rig-scope.js';
import {separateSleeve} from './garment-parts.js';
import {silhouetteTopology} from './mesh-topology.js';
import {availableAnimations,demoMotionSpecs} from './rig-demo-motions.js';
export {animationNames,animationDescriptions,availableAnimations} from './rig-demo-motions.js';
// Pure pixel/rig operations shared by the browser and artifact verification.
const round=n=>Math.round(n*10000)/10000;
const D2R=Math.PI/180;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const norm=a=>{a=((a+180)%360+360)%360-180;return a===-180?180:a;};
const unit=(x,y)=>{const l=Math.hypot(x,y);return l>1e-6?{x:x/l,y:y/l}:null;};
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
// Internal joint ids keep screen sides (left = screen left). Spine names use the character's side,
// so the screen-left arm becomes the character's right arm (_R), matching See-through labels.
export const boneLabels={...faceLabels,root:'전체 기준',body:'허리 (상·하체 기준)',upper:'상체',pelvis:'하체',chest:'가슴',neck:'목',head:'머리',hair:'머리카락',arm_left:'오른 어깨 (화면 왼쪽)',elbow_left:'오른 팔꿈치 (화면 왼쪽)',wrist_left:'오른 손목 (화면 왼쪽)',arm_right:'왼 어깨 (화면 오른쪽)',elbow_right:'왼 팔꿈치 (화면 오른쪽)',wrist_right:'왼 손목 (화면 오른쪽)',hip_left:'오른 고관절 (화면 왼쪽)',knee_left:'오른 무릎 (화면 왼쪽)',ankle_left:'오른 발목 (화면 왼쪽)',hip_right:'왼 고관절 (화면 오른쪽)',knee_right:'왼 무릎 (화면 오른쪽)',ankle_right:'왼 발목 (화면 오른쪽)'};
export const spineNames={root:'root',body:'hip',upper:'upper_body',pelvis:'lower_body',chest:'torso',neck:'neck',head:'head',hair:'hair',arm_left:'upper_arm_R',elbow_left:'forearm_R',wrist_left:'hand_R',hip_left:'thigh_R',knee_left:'shin_R',ankle_left:'foot_R',arm_right:'upper_arm_L',elbow_right:'forearm_L',wrist_right:'hand_L',hip_right:'thigh_L',knee_right:'shin_L',ankle_right:'foot_L'};
export const spineName=id=>spineNames[id]||id;
const defaultParents={body:'root',upper:'body',pelvis:'body',chest:'upper',neck:'chest',head:'neck',hair:'head',arm_left:'chest',elbow_left:'arm_left',wrist_left:'elbow_left',arm_right:'chest',elbow_right:'arm_right',wrist_right:'elbow_right',hip_left:'pelvis',knee_left:'hip_left',ankle_left:'knee_left',hip_right:'pelvis',knee_right:'hip_right',ankle_right:'knee_right'};
const partBones={upper_arm:'arm',forearm:'elbow',hand:'wrist',thigh:'hip',shin:'knee',foot:'ankle',shoe:'ankle'};
export function inferRig(layers,width,height){
  const find=re=>layers.find(l=>re.test(l.name.toLowerCase())),center=l=>l.x+l.width/2;
  const face=find(/^(face|얼굴)$/),shirt=find(/^(topwear|상의)$/),pants=find(/^(bottomwear|하의)$/),legs=find(/legwear|다리/),feet=find(/footwear|신발/);
  const cx=face?center(face):width*.5,shoulderY=shirt?shirt.y+shirt.height*.14:height*.25;
  const body={x:pants?center(pants):cx,y:pants?pants.y+8:height*.48};
  const points={root:{x:width/2,y:height},body,upper:{x:body.x,y:body.y-height*.015},pelvis:{x:body.x,y:body.y+height*.015},chest:{x:cx,y:shoulderY+height*.06},neck:{x:cx,y:shirt?shirt.y:height*.2},head:{x:cx,y:face?face.y+face.height*.8:height*.16},hair:{x:cx,y:face?face.y+face.height*.18:height*.08}};
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
  const assignments=layers.map(l=>{const n=l.name.toLowerCase(),part=n.match(/^(upper_arm|forearm|hand|thigh|shin|foot|shoe)_([rl])(?:_\d+)?$/);
    if(part)return `${partBones[part[1]]}_${part[2]==='r'?'left':'right'}`;
    const lower=n.match(/^(legwear|footwear)_([rl])$/);if(lower)return `${lower[1]==='legwear'?'hip':'ankle'}_${lower[2]==='r'?'left':'right'}`;
    if(/hair|머리카락/.test(n))return 'hair';if(/face|eye|irides|nose|mouth|ears|얼굴|눈|코|입|귀/.test(n))return 'head';if(/neck|목/.test(n))return 'neck';if(/^sleeve_[rl]$/.test(n))return n.endsWith('_r')?'arm_left':'arm_right';if(/topwear|상의/.test(n))return 'chest';if(/handwear|^arm|팔/.test(n))return center(l)<cx?'arm_left':'arm_right';if(/bottomwear|하의|skirt|치마/.test(n))return 'pelvis';return 'root';});
  const modes=layers.map((l,i)=>{const n=l.name.toLowerCase(),lower=n.match(/^(legwear|footwear)_([rl])$/);if(lower)return `${lower[1]==='legwear'?'leg':'foot'}_${lower[2]==='r'?'left':'right'}`;if(/^sleeve_[rl]$/.test(n))return n.endsWith('_r')?'sleeve_left':'sleeve_right';if(/^(upper_arm|forearm|hand|thigh|shin|foot|shoe)_[rl]/.test(n))return 'rigid';if(/bottomwear|하의|skirt|치마/.test(n))return 'bottoms';if(/topwear|상의/.test(n)&&assignments[i]==='chest')return 'torso';if(/^(neck|목)$/.test(n))return 'neck';return /handwear|^arm|팔/.test(n)?assignments[i]:/legwear|다리/.test(n)?'legs':/footwear|신발/.test(n)?'feet':'rigid';});
  return {points,assignments,modes,parents:{...defaultParents},labels:{...boneLabels},pose:{},width,height,garments:2,limbStyle:'mesh',weightBlend:{},partBones:{},meshDensity:'balanced',ik:true};
}
// Pixel statistics for opaque pixels of a layer, in image coordinates (pixel centres).
function opaquePoints(layer,keep=()=>true,stride=1){
  const pts=[];for(let y=0;y<layer.height;y+=stride)for(let x=0;x<layer.width;x+=stride){if(layer.data[(y*layer.width+x)*4+3]<128)continue;const px=layer.x+x+.5,py=layer.y+y+.5;if(keep(px,py))pts.push([px,py]);}
  return pts;
}
function principalAxis(pts){
  let mx=0,my=0;for(const [x,y]of pts){mx+=x;my+=y;}mx/=pts.length;my/=pts.length;
  let xx=0,yy=0,xy=0;for(const [x,y]of pts){xx+=(x-mx)**2;yy+=(y-my)**2;xy+=(x-mx)*(y-my);}
  const t=.5*Math.atan2(2*xy,xx-yy),dir={x:Math.cos(t),y:Math.sin(t)};let lo=Infinity,hi=-Infinity;
  for(const [x,y]of pts){const s=(x-mx)*dir.x+(y-my)*dir.y;lo=Math.min(lo,s);hi=Math.max(hi,s);}
  return {mx,my,dir,lo,hi};
}
// Centroid of the cross-section at fraction f between two axis ends, so joints sit mid-limb.
function sliceAt(pts,axis,from,f){
  const sgn=from==='lo'?1:-1,start=from==='lo'?axis.lo:axis.hi,len=axis.hi-axis.lo,t=start+sgn*f*len,band=len*.03+1;let sx=0,sy=0,n=0;
  for(const [x,y]of pts){const s=(x-axis.mx)*axis.dir.x+(y-axis.my)*axis.dir.y;if(Math.abs(s-t)<=band){sx+=x;sy+=y;n++;}}
  return n?{x:sx/n,y:sy/n}:{x:axis.mx+axis.dir.x*t,y:axis.my+axis.dir.y*t};
}
// Re-estimate limb joints from the actual arm/leg/shoe pixels (bounding boxes alone miss bent or tilted limbs).
export function refineRig(rig,layers){
  const P=rig.points,set=(id,p)=>{if(P[id]&&p)P[id]={x:clamp(p.x,0,rig.width),y:clamp(p.y,0,rig.height)};};
  const sideOf=x=>x<P.body.x?'left':'right';
  for(const pass of ['limbs','feet'])layers.forEach((l,i)=>{const mode=rig.modes[i];if(!l.data)return;
    if(pass==='limbs'&&(mode==='arm_left'||mode==='arm_right')){
      const side=mode.slice(4),pts=opaquePoints(l,()=>true,2);if(pts.length<20)return;const axis=principalAxis(pts),c=P.chest;
      const lo={x:axis.mx+axis.dir.x*axis.lo,y:axis.my+axis.dir.y*axis.lo},hi={x:axis.mx+axis.dir.x*axis.hi,y:axis.my+axis.dir.y*axis.hi};
      const from=Math.hypot(lo.x-c.x,lo.y-c.y)<=Math.hypot(hi.x-c.x,hi.y-c.y)?'lo':'hi';
      set(`arm_${side}`,sliceAt(pts,axis,from,.07));set(`elbow_${side}`,sliceAt(pts,axis,from,.45));set(`wrist_${side}`,sliceAt(pts,axis,from,.79));
    }
    if(pass==='limbs'&&(mode==='legs'||mode.startsWith('leg_')))for(const side of mode==='legs'?['left','right']:[mode.slice(4)]){
      const pts=opaquePoints(l,x=>mode!=='legs'||sideOf(x)===side,2);if(pts.length<20)continue;const axis=principalAxis(pts),from=axis.my+axis.dir.y*axis.lo<axis.my+axis.dir.y*axis.hi?'lo':'hi';
      set(`hip_${side}`,sliceAt(pts,axis,from,.05));set(`knee_${side}`,sliceAt(pts,axis,from,.5));set(`ankle_${side}`,sliceAt(pts,axis,from,.97));
    }
    if(pass==='feet'&&(mode==='feet'||mode.startsWith('foot_')))for(const side of mode==='feet'?['left','right']:[mode.slice(5)]){
      const pts=opaquePoints(l,x=>mode!=='feet'||sideOf(x)===side,1);if(pts.length<20)continue;let top=Infinity,bottom=-Infinity;for(const [,y]of pts){top=Math.min(top,y);bottom=Math.max(bottom,y);}
      const y=top+(bottom-top)*.35,band=pts.filter(p=>Math.abs(p[1]-y)<=Math.max(2,(bottom-top)*.05));if(!band.length)continue;
      set(`ankle_${side}`,{x:band.reduce((s,p)=>s+p[0],0)/band.length,y});
    }
  });
  centerJoints(rig,layers);attachProps(rig,layers);
  return rig;
}
export function boneOrder(rig){
  const order=[],visiting=new Set(),done=new Set();function visit(name){if(done.has(name))return;if(!rig.points[name]||visiting.has(name))throw Error('뼈대 연결이 순환하거나 부모 관절이 없습니다.');visiting.add(name);const parent=rig.parents[name];if(parent)visit(parent);visiting.delete(name);done.add(name);order.push(name);}
  Object.keys(rig.points).forEach(visit);return order;
}
export function setParent(rig,name,parent){if(name==='root'||name===parent||!rig.points[parent])throw Error('부모 관절을 확인해주세요.');const old=rig.parents[name];rig.parents[name]=parent;try{boneOrder(rig);}catch(e){rig.parents[name]=old;throw e;}}
export function addJoint(rig,label,parent){if(Object.keys(rig.points).length>=64)throw Error('관절은 최대 64개까지 추가할 수 있어요.');let n=1;while(rig.points[`joint_${n}`])n++;const id=`joint_${n}`,p=rig.points[parent]||rig.points.body;rig.points[id]={x:clamp(p.x+30,0,rig.width),y:clamp(p.y+30,0,rig.height)};rig.parents[id]=rig.points[parent]?parent:'body';rig.labels[id]=label.trim()||`추가 관절 ${n}`;if(rig.activeBones)rig.activeBones.push(id);return id;}
export function deleteJoint(rig,id){if(boneLabels[id])throw Error('기본 관절은 삭제할 수 없어요.');const parent=rig.parents[id];for(const k in rig.parents)if(rig.parents[k]===id)rig.parents[k]=parent;rig.assignments=rig.assignments.map(x=>x===id?parent:x);if(rig.activeBones)rig.activeBones=rig.activeBones.filter(b=>b!==id);delete rig.points[id];delete rig.parents[id];delete rig.labels[id];delete rig.pose[id];if(rig.poseOffsets)delete rig.poseOffsets[id];if(rig.poseScales)delete rig.poseScales[id];if(rig.weightBlend)delete rig.weightBlend[id];if(rig.partBones)for(const k of Object.keys(rig.partBones)){rig.partBones[k]=rig.partBones[k].filter(b=>b!==id);if(!rig.partBones[k].length)delete rig.partBones[k];}}
// Setup pose: every limb bone points at its next joint so Spine shows real bone lengths and IK can bend them.
function nextJoint(id){const m=id.match(/^(arm|elbow|hip|knee)_(left|right)$/);if(m)return `${{arm:'elbow',elbow:'wrist',hip:'knee',knee:'ankle'}[m[1]]}_${m[2]}`;return {body:'chest',upper:'chest',chest:'neck',neck:'head'}[id];}
export function setupPose(rig){
  const P=rig.points,root=P.root,order=boneOrder(rig),world={},s=rig.height/768;
  const at=id=>({x:P[id].x-root.x,y:root.y-P[id].y});
  for(const id of order){
    // Point at the mapped next joint while it is still a direct child, else at the only child.
    const kids=order.filter(k=>rig.parents[k]===id),mapped=nextJoint(id),next=mapped&&rig.parents[mapped]===id?mapped:kids.length===1?kids[0]:null;
    const pos=at(id);let angle=0,length=0;
    if(id!=='root'){
      const parent=world[rig.parents[id]],to=next&&P[next]?at(next):null,dir=to&&unit(to.x-pos.x,to.y-pos.y);
      if(dir){angle=Math.atan2(dir.y,dir.x)/D2R;length=Math.hypot(to.x-pos.x,to.y-pos.y);}
      else if(id==='pelvis'){angle=-90;const hips=['hip_left','hip_right'].filter(h=>P[h]);length=Math.max(10*s,hips.length?hips.reduce((n,h)=>n+P[h].y,0)/hips.length-P.pelvis.y:30*s);}
      else if(id.startsWith('face_')){angle=0;length=0;}
      else if(id==='head'||id==='hair'){angle=90;length=id==='head'&&P.hair?Math.max(10*s,Math.hypot(P.hair.x-P.head.x,P.hair.y-P.head.y)*1.6):20*s;}
      else{angle=parent.angle;length=Math.max(10*s,parent.length*.45);}
    }
    world[id]={...pos,angle,length};
  }
  return {order,world};
}
function toLocal(world,id,x,y){const q=world[id],r=-q.angle*D2R,dx=x-q.x,dy=y-q.y;return [dx*Math.cos(r)-dy*Math.sin(r),dx*Math.sin(r)+dy*Math.cos(r)];}
// Approximate half thickness of a limb at a joint, measured across the limb direction.
function halfWidth(layer,joint,dir){
  const alpha=(x,y)=>{const px=Math.floor(x-layer.x),py=Math.floor(y-layer.y);return px<0||py<0||px>=layer.width||py>=layer.height?0:layer.data[(py*layer.width+px)*4+3];};
  if(alpha(joint.x,joint.y)<64)return null;const perp={x:-dir.y,y:dir.x},max=Math.hypot(layer.width,layer.height),reach=sign=>{let k=0;while(k<max&&alpha(joint.x+perp.x*sign*(k+1),joint.y+perp.y*sign*(k+1))>=64)k++;return k;};
  return (reach(1)+reach(-1))/2;
}
// Chamfer distance (px) from each pixel to the nearest transparent pixel of a layer.
const edgeCache=new WeakMap();
function edgeDistance(layer){if(edgeCache.has(layer.data))return edgeCache.get(layer.data);const W=layer.width,H=layer.height,d=new Float32Array(W*H);
  for(let i=0;i<W*H;i++)d[i]=layer.data[i*4+3]<64?0:1e6;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(!d[i])continue;let v=d[i];if(x>0)v=Math.min(v,d[i-1]+1);if(y>0)v=Math.min(v,d[i-W]+1);if(x>0&&y>0)v=Math.min(v,d[i-W-1]+1.414);if(x<W-1&&y>0)v=Math.min(v,d[i-W+1]+1.414);if(x===0||y===0||x===W-1||y===H-1)v=Math.min(v,1);d[i]=v;}
  for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const i=y*W+x;let v=d[i];if(x<W-1)v=Math.min(v,d[i+1]+1);if(y<H-1)v=Math.min(v,d[i+W]+1);if(x<W-1&&y<H-1)v=Math.min(v,d[i+W+1]+1.414);if(x>0&&y<H-1)v=Math.min(v,d[i+W-1]+1.414);d[i]=v;}
  edgeCache.set(layer.data,d);return d;}
const LIMBS={arm:{joints:['arm','elbow','wrist'],names:['upper_arm','forearm','hand']},leg:{joints:['hip','knee','ankle'],names:['thigh','shin','foot']},feet:{joints:['ankle'],names:['shoe']}};
// Cut one limb layer into rigid pieces on the plane through each joint. Every piece then gets a round
// cap the width of the limb at that joint, so bending shows a continuous silhouette instead of a gap.
// The cap of the front (distal) piece fades out, softening the seam. Cap pixels are flagged in `fill`
// so the server can redraw them (the original pixels there belong to the neighbouring piece).
export function splitLimb(layer,rig,mode){
  const kind=mode==='arm_left'||mode==='arm_right'?'arm':mode==='legs'||mode.startsWith('leg_')?'leg':mode==='feet'||mode.startsWith('foot_')?'feet':null;if(!kind||!layer.data)return null;
  const P=rig.points,{joints,names}=LIMBS[kind],sides=mode.endsWith('_left')?['left']:mode.endsWith('_right')?['right']:['left','right'],W=layer.width,H=layer.height;
  const chains=[];
  for(const side of sides){
    const ids=joints.map(j=>`${j}_${side}`);if(ids.some(id=>!P[id]))return null;const pts=ids.map(id=>P[id]);
    const guide=kind==='feet'?[P[`knee_${side}`]||{x:pts[0].x,y:pts[0].y-1},pts[0]]:pts,chain={side,ids,pts,guide,planes:[],radii:[]};
    if(kind!=='feet'){
      const d0=unit(pts[1].x-pts[0].x,pts[1].y-pts[0].y)||{x:0,y:1},d1=unit(pts[2].x-pts[1].x,pts[2].y-pts[1].y)||d0,n1=unit(d0.x+d1.x,d0.y+d1.y)||d1;
      const shortest=Math.min(Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y),Math.hypot(pts[2].x-pts[1].x,pts[2].y-pts[1].y));
      chain.planes=[[pts[1],n1],[pts[2],d1]];
      chain.radii=chain.planes.map(([j,n])=>{const h=halfWidth(layer,j,n);return clamp(h===null?shortest*.12:h,3,Math.max(3,shortest*.45));});
    }
    chains.push(chain);
  }
  const owner=new Int16Array(W*H).fill(-1),segOf=new Int8Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=y*W+x;if(!layer.data[i*4+3])continue;const px=layer.x+x+.5,py=layer.y+y+.5;
    let ci=0;if(chains.length>1){let best=Infinity;chains.forEach((c,k)=>{const d=chainInfo(c.guide,px,py).distance;if(d<best){best=d;ci=k;}});}
    const c=chains[ci];owner[i]=ci;if(kind==='feet')continue;
    const side=([j,n])=>(px-j.x)*n.x+(py-j.y)*n.y;segOf[i]=side(c.planes[0])<0?0:side(c.planes[1])<0?1:2;
  }
  const parts=[];
  chains.forEach((c,ci)=>{for(let seg=joints.length-1;seg>=0;seg--){
    const data=new Uint8ClampedArray(W*H*4),cov=new Float32Array(W*H),fill=new Uint8Array(W*H);let any=false;
    for(let i=0;i<W*H;i++)if(owner[i]===ci&&segOf[i]===seg){data.set(layer.data.subarray(i*4,i*4+4),i*4);any=true;}
    if(!any)continue;
    // Root end of the limb (shoulder/hip): fade the outline into the body so a raised arm shows no hard sleeve edge.
    if(seg===0&&kind!=='feet'){const j=c.pts[0],d=unit(c.pts[1].x-j.x,c.pts[1].y-j.y);if(d){const dist=edgeDistance(layer),f=Math.max(4,c.radii[0]*.35);
      for(let i=0;i<W*H;i++){if(!data[i*4+3])continue;const x=i%W,y=(i-x)/W,along=(layer.x+x+.5-j.x)*d.x+(layer.y+y+.5-j.y)*d.y;if(along>=0)continue;
        const t=clamp(dist[i]/f,0,1),edge=t*t*(3-2*t),w=clamp(-along/f,0,1);data[i*4+3]=Math.round(data[i*4+3]*(1-w+w*edge));}}}
    // Caps: [plane index, keep the side beyond (+1) or before (-1) the plane, fade?]
    const caps=kind==='feet'?[]:[[seg-1,-1,true],[seg,1,false]].filter(([k])=>k>=0&&k<c.planes.length);
    for(const [k,dir,fade]of caps){const [j,n]=c.planes[k],r=c.radii[k];
      for(let y=Math.max(0,Math.floor(j.y-layer.y-r-1));y<=Math.min(H-1,Math.ceil(j.y-layer.y+r+1));y++)for(let x=Math.max(0,Math.floor(j.x-layer.x-r-1));x<=Math.min(W-1,Math.ceil(j.x-layer.x+r+1));x++){
        // Caps stay inside the limb's original silhouette: nothing hidden exists outside it.
        const i=y*W+x;if(owner[i]!==ci||segOf[i]===seg)continue;const px=layer.x+x+.5,py=layer.y+y+.5,along=((px-j.x)*n.x+(py-j.y)*n.y)*dir;if(along<0)continue;
        let a=clamp(r-Math.hypot(px-j.x,py-j.y)+.5,0,1);if(fade){const t=along/r;a*=1-clamp((t-.3)/.7,0,1)**2*(3-2*clamp((t-.3)/.7,0,1));}
        a*=layer.data[i*4+3]/255;if(a<=cov[i])continue;cov[i]=a;fill[i]=1;
        data.set([layer.data[i*4],layer.data[i*4+1],layer.data[i*4+2],Math.round(a*255)],i*4);
      }}
    let x0=W,y0=H,x1=-1,y1=-1;for(let i=0;i<W*H;i++)if(data[i*4+3]||fill[i]){const x=i%W,y=(i-x)/W;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    const w=x1-x0+1,h=y1-y0+1,crop=new Uint8ClampedArray(w*h*4),cropFill=new Uint8Array(w*h),cropCov=new Float32Array(w*h);
    for(let y=0;y<h;y++){crop.set(data.subarray(((y+y0)*W+x0)*4,((y+y0)*W+x1+1)*4),y*w*4);cropFill.set(fill.subarray((y+y0)*W+x0,(y+y0)*W+x1+1),y*w);cropCov.set(cov.subarray((y+y0)*W+x0,(y+y0)*W+x1+1),y*w);}
    const part={name:`${names[seg]}_${c.side==='left'?'R':'L'}`,x:layer.x+x0,y:layer.y+y0,width:w,height:h,data:crop,bone:c.ids[seg],mode:'rigid',opacity:layer.opacity??1,visible:layer.visible!==false};
    if(cropFill.some(v=>v)){part.fill=cropFill;part.cov=cropCov;}
    parts.push(part);
  }});
  return parts;
}
// Paint server-redrawn colours into the cap pixels; caps then become full round ends.
export function applyFill(part,rgba){for(let i=0;i<part.fill.length;i++)if(part.fill[i]){part.data[i*4]=rgba[i*4];part.data[i*4+1]=rgba[i*4+1];part.data[i*4+2]=rgba[i*4+2];}return part;}
// COCO-17 keypoints from the pose model → joints. COCO "left" is the character's left = screen right.
const COCO={arm:[5,6],elbow:[7,8],wrist:[9,10],hip:[11,12],knee:[13,14],ankle:[15,16]};
export function applyPose(rig,keypoints,minScore=.3){
  if(!Array.isArray(keypoints)||keypoints.length<17)return 0;let n=0;
  for(const [joint,[l,r]]of Object.entries(COCO))for(const [side,k]of [['right',l],['left',r]]){const [x,y,s]=keypoints[k];const id=`${joint}_${side}`;
    if(rig.points[id]&&s>=minScore&&x>=0&&y>=0&&x<=rig.width&&y<=rig.height){rig.points[id]={x,y};n++;}}
  return n;
}
// Move each limb joint to the middle of the limb's cross-section (keypoints often sit near an edge).
export function centerJoints(rig,layers){
  const P=rig.points,limb={arm_left:['arm','elbow','wrist'],arm_right:['arm','elbow','wrist'],legs:['hip','knee','ankle']};
  layers.forEach((l,i)=>{const mode=rig.modes[i],chain=limb[mode];if(!chain||!l.data)return;
    for(const side of mode==='legs'?['left','right']:[mode.slice(4)]){const ids=chain.map(j=>`${j}_${side}`);if(ids.some(id=>!P[id]))continue;
      for(const k of [1,2]){const a=P[ids[k-1]],b=P[ids[k]],c=P[ids[k+1]]||b,d0=unit(b.x-a.x,b.y-a.y),d1=unit(c.x-b.x,c.y-b.y)||d0;if(!d0)continue;const n=unit(d0.x+d1.x,d0.y+d1.y)||d0,perp={x:-n.y,y:n.x};
        const alpha=(x,y)=>{const px=Math.floor(x-l.x),py=Math.floor(y-l.y);return px<0||py<0||px>=l.width||py>=l.height?0:l.data[(py*l.width+px)*4+3];};
        if(alpha(b.x,b.y)<64)continue;const reach=s=>{let t=0;while(t<400&&alpha(b.x+perp.x*s*(t+1),b.y+perp.y*s*(t+1))>=64)t++;return t;},shift=(reach(1)-reach(-1))/2;
        P[ids[k]]={x:clamp(b.x+perp.x*shift,0,rig.width),y:clamp(b.y+perp.y*shift,0,rig.height)};}}
  });
}
// Held props (objects, weapons) follow the nearest hand instead of staying on the root.
export function attachProps(rig,layers){
  layers.forEach((l,i)=>{if(!/^(objects?|weapon|props?|소품|무기)/i.test(l.name)||rig.assignments[i]!=='root')return;let best=Infinity,hand=null;
    for(const id of ['wrist_left','wrist_right']){const p=rig.points[id];if(!p)continue;const dx=Math.max(l.x-p.x,0,p.x-l.x-l.width),dy=Math.max(l.y-p.y,0,p.y-l.y-l.height),d=Math.hypot(dx,dy);if(d<best){best=d;hand=id;}}
    if(hand&&best<rig.height*.12)rig.assignments[i]=hand;});
}
const slug=s=>String(s).replace(/[^\p{L}\p{N}_-]+/gu,'_').replace(/^_+|_+$/g,'').slice(0,60)||'part';
// Layers (front-to-back, with RGBA data) become Spine parts: limbs are cut at joints in cutout style.
export function buildParts(layers,rig){
  const cutout=(rig.limbStyle??'cutout')==='cutout',parts=[],used=new Map();
  const facialLayers=layers.map((l,i)=>rig.faceRig>=2&&rig.modes[i]==='face'?splitFaceLids(l,rig):null);
  const separatedLayers=layers.map((l,i)=>facialLayers[i]||separateSleeve(l,rig,i)||[l]);
  // A shirt torso must not be weighted as an integrated sleeve when that sleeve is
  // already supplied by a separate sprite (including sleeves extracted from arm layers).
  const detachedSleeves=[...new Set(separatedLayers.flatMap((ls,i)=>ls.map(l=>l.mode||rig.modes[i]).filter(m=>/^sleeve_(left|right)$/.test(m)).map(m=>m.slice(7))))];
  layers.forEach((original,i)=>{
    const facial=!!facialLayers[i];
    for(const l of separatedLayers[i]){
      const mode=facial||l.role==='sleeve'?l.mode:rig.modes[i],bone=facial||l.role==='sleeve'?l.bone:rig.assignments[i];
      const garment=mode==='face'||mode==='bottoms'||mode==='torso'||mode==='neck'||mode.startsWith('sleeve_'),split=cutout&&!garment&&mode!=='rigid'?splitLimb(l,rig,mode):null;
      const sides=!cutout&&(mode==='legs'||mode==='feet')&&l.data?splitMeshSides(l,rig,mode):null;
      if(sides?.length)parts.push(...sides.map(p=>({...p,source:i})));
      else if(split?.length)parts.push(...split.map(p=>({...p,source:i})));
      else parts.push({...l,source:i,bone,mode:cutout&&!garment?'rigid':mode,...(mode==='torso'?{detachedSleeves}: {})});
    }
  });
  for(const p of parts){p.bone=activeBone(rig,p.bone);const base=slug(p.name),n=(used.get(base)||0)+1;used.set(base,n);p.slot=n>1?`${base}_${n}`:base;}
  return parts;
}
function chainInfo(pts,x,y){let best={distance:Infinity,t:0},total=0;const lengths=[];
  for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,u=clamp(((x-a.x)*dx+(y-a.y)*dy)/(len*len),0,1),distance=Math.hypot(x-a.x-u*dx,y-a.y-u*dy);if(distance<best.distance)best={distance,t:total+u*len};lengths.push(len);total+=len;}
  return {...best,lengths};
}
// Keep the two legs in separate attachments: triangles and influences cannot bridge across them.
function splitMeshSides(layer,rig,mode){
  const chains=['left','right'].map(side=>['hip','knee','ankle'].map(j=>rig.points[`${j}_${side}`]));
  const owners=[[],[]];
  for(let y=0;y<layer.height;y++)for(let x=0;x<layer.width;x++){
    const i=y*layer.width+x;if(!layer.data[i*4+3])continue;
    const gx=layer.x+x+.5,gy=layer.y+y+.5;
    owners[chainInfo(chains[0],gx,gy).distance<=chainInfo(chains[1],gx,gy).distance?0:1].push(i);
  }
  return owners.flatMap((indices,k)=>{
    if(!indices.length)return [];let x0=layer.width,y0=layer.height,x1=0,y1=0;
    for(const i of indices){const x=i%layer.width,y=Math.floor(i/layer.width);x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    const width=x1-x0+1,height=y1-y0+1,data=new Uint8ClampedArray(width*height*4);
    for(const i of indices){const x=i%layer.width-x0,y=Math.floor(i/layer.width)-y0;data.set(layer.data.subarray(i*4,i*4+4),(y*width+x)*4);}
    const side=k?'right':'left';return [{...layer,canvas:null,name:`${layer.name}_${k?'L':'R'}`,x:layer.x+x0,y:layer.y+y0,width,height,data,mode:`${mode==='legs'?'leg':'foot'}_${side}`,bone:`${mode==='legs'?'hip':'ankle'}_${side}`}];
  });
}
function meshChain(rig,mode,x,y){
  let side=mode.endsWith('_left')?'left':'right';
  // Sleeve: torso side of the shoulder → upper arm.
  if(mode.startsWith('sleeve_'))return [rig.parents[`arm_${side}`]||'chest',`arm_${side}`];
  if(mode==='bottoms'||mode==='legs'||mode==='feet')side=chainInfo(['hip_left','knee_left','ankle_left'].map(id=>rig.points[id]),x,y).distance<=chainInfo(['hip_right','knee_right','ankle_right'].map(id=>rig.points[id]),x,y).distance?'left':'right';
  if(mode==='feet'||mode.startsWith('foot_'))return [`ankle_${side}`];
  const ids=(mode==='bottoms'||mode==='legs'||mode.startsWith('leg_')?['hip','knee','ankle']:['arm','elbow','wrist']).map(j=>`${j}_${side}`),out=[ids[0]];
  for(let i=1;i<ids.length;i++){
    const between=[];let parent=rig.parents[ids[i]];
    while(parent&&parent!==ids[i-1]&&between.length<64){between.push(parent);parent=rig.parents[parent];}
    if(parent===ids[i-1])out.push(...between.reverse());out.push(ids[i]);
  }
  // Bottoms: waistband on the hip's parent (lower body), each trouser leg on its thigh → shin.
  // Bare limbs likewise start on the torso side, so shoulders and hips stretch instead of breaking.
  const parent=rig.parents[ids[0]];if(mode==='bottoms')out.unshift(parent||'pelvis');else if(parent&&rig.points[parent])out.unshift(parent);
  return out;
}
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
export function partBoneCandidates(rig,index,mode=rig.modes[index],bone=rig.assignments[index]){return [...new Set(rawBoneCandidates(rig,index,mode,bone).map(id=>activeBone(rig,id)))];}
function rawBoneCandidates(rig,index,mode=rig.modes[index],bone=rig.assignments[index]){
  if(mode==='face')return faceCandidates(rig,bone,index);
  if(mode==='rigid')return [bone];
  if(mode==='torso'||mode==='neck'){const names=spineGuide({},rig,mode).names;return mode==='torso'?[...names,...['arm_left','arm_right'].filter(id=>rig.points[id])]:names;}
  if(mode==='bottoms')return [...new Set(['left','right'].flatMap(s=>{const h=rig.points[`hip_${s}`];return h?meshChain(rig,mode,h.x,h.y):[];}))];
  const p=rig.points[bone]||{x:0,y:0};return [...new Set(meshChain(rig,mode,p.x,p.y))];
}
function weightGuide(layer,rig,mode,bone,x,y){
  if(mode==='face'||mode==='rigid')return {names:[bone],joints:[]};
  if(mode==='torso'||mode==='neck')return spineGuide(layer,rig,mode);
  const names=meshChain(rig,mode,x,y),points=names.map(id=>rig.points[id]),joints=[];
  for(let i=1;i<names.length;i++){
    const prev=points[i-1],p=points[i],next=points[i+1];
    const incoming=unit(p.x-prev.x,p.y-prev.y)||{x:0,y:1},outgoing=next&&unit(next.x-p.x,next.y-p.y);
    let dir=outgoing?(unit(incoming.x+outgoing.x,incoming.y+outgoing.y)||incoming):incoming;
    // A sleeve blends across the shoulder along the arm, not along the chest→shoulder line.
    if(mode.startsWith('sleeve_')){const e=rig.points[`elbow_${mode.slice(7)}`];dir=e&&unit(e.x-p.x,e.y-p.y)||dir;}
    // Trouser legs blend across the hip along the thigh; the short pelvis→hip offset must not cap the band.
    const garmentHip=mode==='bottoms'&&i===1,limbRoot=i===1&&!mode.startsWith('sleeve_')&&!garmentHip;if((garmentHip||limbRoot)&&next)dir=unit(next.x-p.x,next.y-p.y)||dir;
    const len=(garmentHip||limbRoot)&&next?Math.hypot(next.x-p.x,next.y-p.y):Math.hypot(p.x-prev.x,p.y-prev.y),after=next?Math.hypot(next.x-p.x,next.y-p.y):len;
    const maxBand=Math.max(1,Math.min(len,after)*.3);
    const thickness=layer.data?halfWidth(layer,p,dir):null;
    const blend=clamp(Number(rig.weightBlend?.[names[i]])||1,.35,2);
    // The whole waist is wider than one trouser leg, so a garment hip uses a thigh-length band instead.
    const band=clamp((garmentHip?len*.18:thickness===null?Math.min(len,after)*.12:Math.max(2,thickness)*1.25)*blend,1,maxBand);
    // Shoulder / hip: most of the blend sits on the torso side, so the limb itself still rotates fully.
    joints.push({id:names[i],p,dir,band,shift:limbRoot?-band*.5:0});
  }
  const requested=rig.partBones?.[layer.source],allowed=Array.isArray(requested)?names.filter(n=>requested.includes(n)):names;
  return {names,joints,allowed:allowed.length?allowed:names,points};
}
// Shirts and necks bend along the spine: lower body → waist → chest (→ neck → head).
function spineGuide(layer,rig,mode){
  const P=rig.points,names=[];let n=mode==='neck'?'head':'chest';
  while(n&&n!=='body'&&n!=='root'&&names.length<64){names.unshift(n);if(mode==='neck'&&n===(rig.parents.neck||'chest'))break;n=rig.parents[n];}
  if(mode==='torso')names.unshift(P.pelvis?'pelvis':'body');
  if(mode==='neck'&&names[0]==='neck')names.unshift(rig.parents.neck||'chest');
  const valid=names.filter(id=>P[id]),top=P.neck||P.head,base=P.body||P.pelvis,up=top&&base&&unit(top.x-base.x,top.y-base.y)||{x:0,y:-1},torsoLen=top&&base?Math.hypot(top.x-base.x,top.y-base.y):rig.height*.25,joints=[];
  for(let i=1;i<valid.length;i++){
    const id=valid[i],p=id==='upper'&&P.body?P.body:P[id],prev=P[valid[i-1]],gap=Math.max(4,Math.hypot(p.x-prev.x,p.y-prev.y));
    const blend=clamp(Number(rig.weightBlend?.[id])||1,.35,2);
    // The waist gets a wide band (body → hem); chest / neck / head bands follow their bone spacing.
    const band=clamp((i===1&&mode==='torso'?torsoLen*.14:gap*.35)*blend,2,torsoLen*.3);
    joints.push({id,p,dir:up,band,shift:mode==='neck'&&id==='head'?-band*.3:0});
  }
  const options=mode==='torso'?[...valid,...['arm_left','arm_right'].filter(id=>P[id])]:valid,requested=rig.partBones?.[layer.source],allowed=Array.isArray(requested)?options.filter(v=>requested.includes(v)):options;
  return {names:valid,joints,allowed:allowed.length?allowed:valid,points:valid.map(id=>P[id])};
}
// Sleeves painted into the shirt follow the upper arm; the armpit side stays on the torso.
function shirtArm(rig,x,y,detachedSleeves=[]){
  let best=null;
  for(const side of ['left','right']){
    if(detachedSleeves.includes(side))continue;
    const A=rig.points[`arm_${side}`],E=rig.points[`elbow_${side}`],C=rig.points.chest;if(!A||!E||!C)continue;
    const len=Math.hypot(E.x-A.x,E.y-A.y);if(len<4)continue;const d={x:(E.x-A.x)/len,y:(E.y-A.y)/len};let o={x:-d.y,y:d.x};if(o.x*(A.x-C.x)+o.y*(A.y-C.y)<0)o={x:-o.x,y:-o.y};
    const r=len*.2,blend=clamp(Number(rig.weightBlend?.[`arm_${side}`])||1,.35,2),t=(x-A.x)*d.x+(y-A.y)*d.y,u=(x-A.x)*o.x+(y-A.y)*o.y;
    // Only the sleeve: past ~¾ of the upper arm the shirt is torso again.
    const w=smooth((t+r*.3*blend)/(r*blend))*smooth((u+r*1.5)/(r*.6))*(1-smooth((t-len*.75)/(len*.2)));if(w>.005&&(!best||w>best[1]))best=[`arm_${side}`,w];
  }
  return best;
}
function shirtWeights(guide,weights,x,y,rig,detachedSleeves){
  const arm=shirtArm(rig,x,y,detachedSleeves);if(!arm||guide.allowed&&!guide.allowed.includes(arm[0]))return weights;
  const main=weights.reduce((a,b)=>b[1]>a[1]?b:a);return [[main[0],1-arm[1]],arm].filter(([,w])=>w>=.005);
}
function guideWeights(guide,x,y){
  const weights=[];let remaining=1;
  for(let i=0;i<guide.joints.length;i++){
    const {p,dir,band,shift=0}=guide.joints[i],t=smooth((((x-p.x)*dir.x+(y-p.y)*dir.y-shift)/band+1)/2);
    weights.push([guide.names[i],remaining*(1-t)]);remaining*=t;
  }
  weights.push([guide.names.at(-1),remaining]);
  // Each vertex blends at most two neighbouring bones of this sprite's chain.
  let primary=0;for(let i=1;i<weights.length;i++)if(weights[i][1]>weights[primary][1])primary=i;
  const neighbour=primary===0?1:primary===weights.length-1?primary-1:weights[primary-1][1]>weights[primary+1][1]?primary-1:primary+1;
  let kept=weights.filter(([id,w],i)=>(i===primary||i===neighbour)&&w>=.005&&(!guide.allowed||guide.allowed.includes(id)));
  if(!kept.length){const choices=guide.names.map((id,i)=>({id,p:guide.points?.[i]})).filter(v=>!guide.allowed||guide.allowed.includes(v.id));choices.sort((a,b)=>Math.hypot(x-a.p.x,y-a.p.y)-Math.hypot(x-b.p.x,y-b.p.y));kept=[[choices[0].id,1]];}
  const total=kept.reduce((n,[,w])=>n+w,0);
  return kept.map(([id,w])=>[id,w/total]);
}
// Interior columns through both hips and the crotch, so each trouser leg can bend on its own.
function crotchPoints(layer,rig){
  const L=rig.points.hip_left,R=rig.points.hip_right;if(!L||!R)return [];const mid=(L.x+R.x)/2,out=[];
  const rows=Math.max(3,Math.ceil(layer.height/16));
  for(let r=0;r<=rows;r++)for(const x of [L.x,(L.x+mid)/2,mid,(R.x+mid)/2,R.x])out.push([x-layer.x,clamp(layer.height*r/rows,.5,layer.height-.5)]);
  return out;
}
// Near the crotch the two trouser legs meet: fade thigh influence back to the waist bone there,
// so lifting one leg stretches the seam instead of dragging the other side along.
function crotchWeights(rig,guide,weights,x){
  const L=rig.points.hip_left,R=rig.points.hip_right,waist=guide.names[0],thigh=guide.names[1];if(!L||!R||weights.some(([id])=>id!==waist&&id!==thigh))return weights;
  const half=Math.abs(R.x-L.x)/2;if(half<1)return weights;const f=smooth(Math.abs(x-(L.x+R.x)/2)/(half*.7));
  const w=(weights.find(([id])=>id===thigh)?.[1]||0)*f;if(guide.allowed&&!guide.allowed.includes(waist))return weights;
  return [[waist,1-w],[thigh,w]].filter(([,v])=>v>=.005);
}
// Joint-aligned rows and columns put vertices at the pivots and both sides of each blend band.
function meshAxis(size,offset,joints,key){
  const anchors=[0,size];
  for(const j of joints)for(const delta of [-1,-.5,0,.5,1])anchors.push(clamp(j.p[key]-offset+delta*j.band,0,size));
  const count=clamp(Math.ceil(size/18),4,16),values=[...anchors];
  for(let i=1;i<count;i++){const v=size*i/count;if(!anchors.some(a=>Math.abs(a-v)<1.5))values.push(v);}
  const sorted=[...new Set(values.map(round))].sort((a,b)=>a-b).filter((v,i,a)=>i===0||v-a[i-1]>.05);
  return sorted.length<=40?sorted:Array.from({length:40},(_,i)=>sorted[Math.round(i*(sorted.length-1)/39)]);
}
export function buildMesh(layer,rig,mode,bone,setup){
  const guide=weightGuide(layer,rig,mode,bone,layer.x+layer.width/2,layer.y+layer.height/2);
  if(mode==='torso')for(const side of ['left','right']){if(layer.detachedSleeves?.includes(side))continue;const A=rig.points[`arm_${side}`],E=rig.points[`elbow_${side}`];const d=A&&E&&unit(E.x-A.x,E.y-A.y);if(d)guide.joints=[...guide.joints,{id:`arm_${side}`,p:A,dir:d,band:Math.hypot(E.x-A.x,E.y-A.y)*.2}];}
  if(mode==='bottoms')guide.joints=['left','right'].flatMap(s=>{const h=rig.points[`hip_${s}`];return h?weightGuide(layer,rig,mode,bone,h.x,h.y).joints:[];});
  const extra=mode==='face'?faceCandidates(rig,bone).flatMap(id=>{const p=rig.points[id],r=Math.min(layer.width,layer.height)*(/eye|brow|mouth|nose/.test(id)?.06:.12);return [[p.x-layer.x,p.y-layer.y],...[[r,0],[-r,0],[0,r],[0,-r]].map(([dx,dy])=>[p.x-layer.x+dx,p.y-layer.y+dy])];}):mode==='bottoms'?crotchPoints(layer,rig):[];
  const topology=silhouetteTopology(layer,guide.joints,rig.meshDensity,extra);
  const xs=meshAxis(layer.width,layer.x,guide.joints,'x'),ys=meshAxis(layer.height,layer.y,guide.joints,'y');
  const nx=xs.length-1,ny=ys.length-1,grid=[],lookup=new Map(),root=rig.points.root;
  const add=(x,y)=>{const key=`${x},${y}`;if(!lookup.has(key)){lookup.set(key,grid.length);grid.push([x,y]);}};
  for(let x=0;x<=nx;x++)add(x,0);for(let y=1;y<=ny;y++)add(nx,y);for(let x=nx-1;x>=0;x--)add(x,ny);for(let y=ny-1;y>0;y--)add(0,y);let hull=grid.length;
  for(let y=1;y<ny;y++)for(let x=1;x<nx;x++)add(x,y);
  const coords=topology?.points||grid.map(([x,y])=>[xs[x],ys[y]]),uvs=[],vertices=[],triangles=topology?.triangles||[];
  if(topology)hull=topology.hull;
  for(const [lx0,ly0]of coords){const x=layer.x+lx0,y=layer.y+ly0;uvs.push(lx0/layer.width,ly0/layer.height);
    const g=mode==='bottoms'||mode==='legs'||mode==='feet'?weightGuide(layer,rig,mode,bone,x,y):guide;
    const weights=mode==='face'?faceWeights(layer,rig,bone,x,y):mode==='bottoms'?crotchWeights(rig,g,guideWeights(g,x,y),x):mode==='torso'?shirtWeights(g,guideWeights({...g,joints:g.joints.filter(j=>!/^arm_/.test(j.id))},x,y),x,y,rig,layer.detachedSleeves):guideWeights(g,x,y);const bound=new Map();for(const [id,w]of weights){const b=activeBone(rig,id);bound.set(b,(bound.get(b)||0)+w);}vertices.push(bound.size);
    for(const [b,w]of bound){const [lx,ly]=toLocal(setup.world,b,x-root.x,root.y-y);vertices.push(setup.order.indexOf(b),round(lx),round(ly),w);}}
  if(!topology)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const a=lookup.get(`${x},${y}`),b=lookup.get(`${x+1},${y}`),c=lookup.get(`${x},${y+1}`),d=lookup.get(`${x+1},${y+1}`);triangles.push(a,c,b,b,c,d);}
  const pairs=new Set(),edges=[];for(let i=0;i<triangles.length;i+=3)for(const [a,b]of [[triangles[i],triangles[i+1]],[triangles[i+1],triangles[i+2]],[triangles[i+2],triangles[i]]]){const key=`${Math.min(a,b)},${Math.max(a,b)}`;if(!pairs.has(key)){pairs.add(key);edges.push(a*2,b*2);}}
  return {type:'mesh',uvs,vertices,triangles,hull,edges,width:layer.width,height:layer.height};
}
export function vertexWeights(attachment,skeleton,boneName){
  const values=[];let cursor=0;for(let i=0;i<attachment.uvs.length/2;i++){let weight=0;const count=attachment.vertices[cursor++];for(let j=0;j<count;j++){const index=attachment.vertices[cursor++];cursor+=2;const w=attachment.vertices[cursor++];if(skeleton.bones[index].name===boneName)weight+=w;}values.push(weight);}return values;
}
// Template motions are plain FK keys sampled at 15 fps; every IK constraint is keyed to mix 0 so the
// result in Spine matches the browser preview. New animations made in Spine can use the IK as usual.
function templateAnimations(rig,ikNames,amplitude){
  const P=rig.points,active=new Set(activeIds(rig)),s=rig.height/768,A=amplitude,sin=(p,k=1,ph=0)=>Math.sin((p*k+ph)*2*Math.PI),out={};
  const make=(duration,spec)=>{
    const frames=Math.max(1,Math.round(duration*15)),times=Array.from({length:frames+1},(_,i)=>i/frames),bones={};
    for(const [id,tl]of Object.entries(spec)){if(!active.has(id))continue;const o={};
      if(tl.rotate)o.rotate=times.map(p=>({time:round(p*duration),value:round(tl.rotate(p))}));
      for(const key of ['translate','scale'])if(tl[key])o[key]=times.map(p=>{const [x,y]=tl[key](p);return {time:round(p*duration),x:round(x),y:round(y)};});
      bones[spineName(id)]=o;}
    const anim={bones};if(ikNames.length)anim.ik=Object.fromEntries(ikNames.map(n=>[n,[{mix:0}]]));return anim;
  };
  // o = +1 rotates the screen-right limb outward/up (counter-clockwise); the screen-left limb mirrors it.
  const each=(fn)=>Object.assign({},...[['left',-1],['right',1]].map(([side,o])=>fn(side,o)));
  out.idle=make(4,{chest:{rotate:p=>sin(p)*.3*A,scale:p=>[1,1+(1-Math.cos(p*2*Math.PI))*.006*A]},head:{rotate:p=>-sin(p,1,-.08)*.65*A},hair:{rotate:p=>sin(p,1,-.15)*A},
    ...each((side,o)=>({[`arm_${side}`]:{rotate:p=>-o*sin(p)*.75*A},[`elbow_${side}`]:{rotate:p=>-o*sin(p,1,-.1)*1.2*A}}))});
  // Template motions stay small: a starting point the animator exaggerates, not a finished take.
  out.wave=make(1.6,{chest:{rotate:p=>sin(p)*.8},head:{rotate:p=>sin(p,1,.25)*1.5},hair:{rotate:p=>-sin(p,1,.1)*1.2},
    arm_right:{rotate:p=>40+sin(p)*3},elbow_right:{rotate:p=>25+sin(p,2)*12},wrist_right:{rotate:p=>sin(p,2,-.12)*6},arm_left:{rotate:p=>sin(p)*1}});
  out.cheer=make(1.2,{body:{translate:p=>[0,(1-Math.cos(p*4*Math.PI))*1.5*s]},head:{rotate:p=>sin(p)*2},hair:{rotate:p=>-sin(p,2,.1)*1.5},
    ...each((side,o)=>({[`arm_${side}`]:{rotate:p=>o*(30+sin(p,2)*5)},[`elbow_${side}`]:{rotate:p=>o*(10+sin(p,2,.08)*5)}}))});
  // Hop: crouch → jump → land. The body dip matches how much the bent legs shorten, so feet stay on the ground.
  const crouch=p=>p<.2?Math.sin(Math.PI*p/.2):p>=.75?Math.sin(Math.PI*(p-.75)/.25)*.7:0,air=p=>p>=.2&&p<.75?Math.sin(Math.PI*(p-.2)/.55):0,theta=9;
  const leg=side=>P[`hip_${side}`]&&P[`knee_${side}`]&&P[`ankle_${side}`]?Math.hypot(P[`knee_${side}`].x-P[`hip_${side}`].x,P[`knee_${side}`].y-P[`hip_${side}`].y)+Math.hypot(P[`ankle_${side}`].x-P[`knee_${side}`].x,P[`ankle_${side}`].y-P[`knee_${side}`].y):0;
  const legLength=(leg('left')+leg('right'))/2;
  out.hop=make(1,{body:{translate:p=>[0,-legLength*(1-Math.cos(theta*crouch(p)*D2R))+air(p)*16*s]},head:{rotate:p=>-crouch(p)*1.5},hair:{rotate:p=>air(p)*3-crouch(p)*1.5},
    ...each((side,o)=>({[`hip_${side}`]:{rotate:p=>o*theta*crouch(p)},[`knee_${side}`]:{rotate:p=>-o*2*theta*crouch(p)},[`ankle_${side}`]:{rotate:p=>o*theta*crouch(p)},
      [`arm_${side}`]:{rotate:p=>o*(14*air(p)-4*crouch(p))},[`elbow_${side}`]:{rotate:p=>o*6*air(p)}}))});
  for(const [key,{duration,spec}]of Object.entries(demoMotionSpecs(rig,setupPose(rig).world,A)))out[key]=make(duration,spec);
  return Object.fromEntries(availableAnimations(rig).map(key=>[key,out[key]]));
}
export function makeSkeleton(parts,rig,amplitude=1){
  const P=rig.points,root=P.root,setup=setupPose(rig),world=setup.world,active=new Set(activeIds(rig)),order=setup.order.filter(id=>active.has(id));setup.order=order;
  const bones=order.map(id=>{if(id==='root')return {name:'root'};const parent=rig.parents[id],[x,y]=toLocal(world,parent,world[id].x,world[id].y);
    return {name:spineName(id),parent:spineName(parent),length:round(world[id].length),rotation:round(norm(world[id].angle-world[parent].angle)),x:round(x),y:round(y),color:'74e6cfff'};});
  const ik=[],ikKeys=new Map();
  if(rig.ik!==false)for(const side of ['left','right'])for(const [kind,a,b,c,holder]of [['arm','arm','elbow','wrist','chest'],['leg','hip','knee','ankle','root']]){
    const key=`${kind}_${side}`,[ia,ib,ic]=[a,b,c].map(j=>`${j}_${side}`);if(!availableChain(rig,key)||!active.has(holder))continue;
    const target=`ik_${spineName(ic)}`,[x,y]=toLocal(world,holder,world[ic].x,world[ic].y),wa=world[ia],wb=world[ib],wc=world[ic];
    bones.push({name:target,parent:spineName(holder),x:round(x),y:round(y),color:'ff3f00ff'});
    const cross=(wb.x-wa.x)*(wc.y-wb.y)-(wb.y-wa.y)*(wc.x-wb.x),fallback=kind==='arm'?side==='right':side==='left';
    const name=`ik_${kind}_${side==='left'?'R':'L'}`;ikKeys.set(name,key);ik.push({name,order:ik.length,bones:[spineName(ia),spineName(ib)],target,mix:rig.ikModes?.[key]==='fk'?0:1,bendPositive:Math.abs(cross)>1?cross>0:fallback});
  }
  const attachments={},slots=[];
  for(let i=parts.length-1;i>=0;i--){const l=parts[i],name=l.slot??`part_${String(i+1).padStart(2,'0')}`,bone=activeBone(rig,l.bone??rig.assignments[i]),mode=l.mode??rig.modes[i];
    const slot={name,bone:spineName(bone)};if(l.visible!==false)slot.attachment=name;slot.color='ffffff'+Math.round((l.opacity??1)*255).toString(16).padStart(2,'0');slots.push(slot);
    let attachment;
    if(mode==='rigid'){const [x,y]=toLocal(world,bone,l.x+l.width/2-root.x,root.y-l.y-l.height/2),rotation=round(norm(-world[bone].angle));attachment={x:round(x),y:round(y),width:l.width,height:l.height};if(rotation)attachment.rotation=rotation;}
    else attachment=buildMesh(l,rig,mode,bone,setup);
    attachments[name]={[name]:{name,path:name,...attachment}};
  }
  const ikNames=ik.map(c=>c.name),animations=templateAnimations(rig,ikNames,amplitude),manual={};
  for(const [id,value]of Object.entries(rig.pose||{}))if(active.has(id))manual[spineName(id)]={rotate:[{value}]};
  for(const [id,p]of Object.entries(facialOffsets(rig)))if(active.has(id))(manual[spineName(id)]??={}).translate=[{x:p.x,y:p.y}];
  for(const [id,p]of Object.entries(rig.poseScales||{}))if(active.has(id))(manual[spineName(id)]??={}).scale=[{x:p.x,y:p.y}];
  animations.manual_pose={bones:manual};if(ikNames.length)animations.manual_pose.ik=Object.fromEntries(ikNames.map(n=>[n,[{mix:0}]]));
  const skeleton={skeleton:{spine:'4.0.64',x:-rig.width/2,y:0,width:rig.width,height:rig.height,images:'./images/',fps:30},bones,slots};
  if(ik.length)skeleton.ik=ik;
  const validNames=new Set(bones.map(b=>b.name));for(const anim of Object.values(animations))for(const name of Object.keys(anim.bones||{}))if(!validNames.has(name))delete anim.bones[name];
  // IK edits are also baked into FK rotations. Target keys let Spine retain the selected IK mode.
  const posed=poseMatrices({...skeleton,animations},0,{},'manual_pose');
  for(const constraint of ik){const key=ikKeys.get(constraint.name);if(rig.ikModes?.[key]!=='ik')continue;
    const target=bones.find(b=>b.name===constraint.target),parent=posed[target.parent],end=posed[spineName(chainDefs[key][2])],dx=end[4]-parent[4],dy=end[5]-parent[5],det=parent[0]*parent[3]-parent[1]*parent[2];
    manual[target.name]={translate:[{x:round((parent[3]*dx-parent[2]*dy)/det-target.x),y:round((-parent[1]*dx+parent[0]*dy)/det-target.y)}]};
    animations.manual_pose.ik[constraint.name]=[{mix:1,bendPositive:(rig.ikBends?.[key]||1)>0}];
  }
  return {...skeleton,skins:[{name:'default',attachments}],animations};
}
function sample(frames,t,key,def){if(!frames?.length)return def;let a=frames[0],b=a;for(const f of frames){if((f.time||0)<=t)a=f;if((f.time||0)>=t){b=f;break;}b=f;}const at=a.time||0,bt=b.time||0,r=bt===at?0:(t-at)/(bt-at);return (a[key]??def)*(1-r)+(b[key]??def)*r;}
export function animationDuration(animation){let d=0;for(const tl of Object.values(animation?.bones||{}))for(const frames of Object.values(tl))for(const f of frames)d=Math.max(d,f.time||0);return d;}
// World matrices [a,b,c,d,x,y] per bone (Spine coordinates, y up). Pose angles are keyed by Spine bone name.
export function poseMatrices(skeleton,time=null,pose={},animation='idle',offsets={},scales={}){
  const anim=time===null?null:skeleton.animations[animation],duration=animationDuration(anim),t=duration?(time%duration):0,m={};
  for(const b of skeleton.bones){const tl=anim?.bones[b.name]||{},angle=((b.rotation||0)+sample(tl.rotate,t,'value',0)+(pose[b.name]||0))*D2R,sx=sample(tl.scale,t,'x',1)*(scales[b.name]?.x??1),sy=sample(tl.scale,t,'y',1)*(scales[b.name]?.y??1),a=Math.cos(angle)*sx,c=-Math.sin(angle)*sy,d=Math.cos(angle)*sy,bb=Math.sin(angle)*sx,x=(b.x||0)+sample(tl.translate,t,'x',0)+(offsets[b.name]?.x||0),y=(b.y||0)+sample(tl.translate,t,'y',0)+(offsets[b.name]?.y||0);
    if(!b.parent){m[b.name]=[a,bb,c,d,x,y];continue;}const q=m[b.parent];m[b.name]=[q[0]*a+q[2]*bb,q[1]*a+q[3]*bb,q[0]*c+q[2]*d,q[1]*c+q[3]*d,q[0]*x+q[2]*y+q[4],q[1]*x+q[3]*y+q[5]];
  }return m;
}
export const mul=(m,n)=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
// Maps region image pixels (y down, origin top-left) to Spine world coordinates.
export function regionMatrix(attachment,bone){const r=(attachment.rotation||0)*D2R,c=Math.cos(r),s=Math.sin(r);return mul(bone,mul([c,s,-s,c,attachment.x||0,attachment.y||0],[1,0,0,-1,-attachment.width/2,attachment.height/2]));}
export function meshWorldVertices(attachment,skeleton,matrices){const out=[];let cursor=0;for(let i=0;i<attachment.uvs.length/2;i++){let x=0,y=0;const n=attachment.vertices[cursor++];for(let j=0;j<n;j++){const bone=skeleton.bones[attachment.vertices[cursor++]].name,lx=attachment.vertices[cursor++],ly=attachment.vertices[cursor++],w=attachment.vertices[cursor++],q=matrices[bone];x+=(q[0]*lx+q[2]*ly+q[4])*w;y+=(q[1]*lx+q[3]*ly+q[5])*w;}out.push([x,y]);}return out;}
// Pixels of each layer that are hidden behind the layers in front of it (front-to-back order).
// See-through invents these areas and often draws outlines there; they get redrawn as plain fill.
export function hiddenMasks(layers,width,height,threshold=230){
  const cover=new Uint8Array(width*height),masks=[];
  for(const l of layers){
    const mask=new Uint8Array(l.width*l.height);let count=0;
    if(l.data&&l.visible!==false){
      for(let y=0;y<l.height;y++)for(let x=0;x<l.width;x++){const gx=l.x+x,gy=l.y+y;if(gx<0||gy<0||gx>=width||gy>=height)continue;const i=y*l.width+x,a=l.data[i*4+3];if(!a)continue;
        const g=gy*width+gx;if(cover[g]>=threshold){mask[i]=1;count++;}}
      for(let y=0;y<l.height;y++)for(let x=0;x<l.width;x++){const gx=l.x+x,gy=l.y+y;if(gx<0||gy<0||gx>=width||gy>=height)continue;const a=l.data[(y*l.width+x)*4+3]*(l.opacity??1),g=gy*width+gx;cover[g]=255-Math.round((255-cover[g])*(255-a)/255);}
    }
    masks.push({mask,count});
  }
  return masks;
}
// Visible pixels take the original artwork's colour. See-through sometimes paints lines or colour
// shifts on visible areas (e.g. an outline along a layer edge); the original image is ground truth.
// Layers are front-to-back; `original` is RGBA at the same size as the canvas.
export function matchOriginal(layers,original){
  const {width,height,data:ref}=original,cover=new Uint8Array(width*height);let changed=0;
  for(const l of layers){if(!l.data||l.visible===false)continue;const op=l.opacity??1;
    for(let y=0;y<l.height;y++)for(let x=0;x<l.width;x++){const gx=l.x+x,gy=l.y+y;if(gx<0||gy<0||gx>=width||gy>=height)continue;const i=(y*l.width+x)*4,a=l.data[i+3];if(!a)continue;
      const g=gy*width+gx,vis=(255-cover[g])/255,w=clamp((vis-.5)/.4,0,1)*(ref[g*4+3]/255);
      if(w>0){for(let k=0;k<3;k++)l.data[i+k]=Math.round(l.data[i+k]*(1-w)+ref[g*4+k]*w);changed++;}
      cover[g]=255-Math.round((255-cover[g])*(255-a*op)/255);}}
  return changed;
}
// Older projects had no separate upper/lower body bones: insert them under the waist.
export function upgradeRig(rig){
  const P=rig.points;if(!P?.body||P.upper&&P.pelvis)return rig;const h=rig.height||768;
  if(!P.upper){P.upper={x:P.body.x,y:Math.max(0,P.body.y-h*.015)};rig.parents.upper='body';rig.labels.upper=boneLabels.upper;for(const k in rig.parents)if(k!=='upper'&&k!=='pelvis'&&rig.parents[k]==='body'&&!/^hip_/.test(k))rig.parents[k]='upper';}
  if(!P.pelvis){P.pelvis={x:P.body.x,y:Math.min(h,P.body.y+h*.015)};rig.parents.pelvis='body';rig.labels.pelvis=boneLabels.pelvis;for(const k of ['hip_left','hip_right'])if(rig.parents[k]==='body')rig.parents[k]='pelvis';rig.assignments=rig.assignments.map(a=>a==='body'?'pelvis':a);}
  return rig;
}
// A joint the user placed on the canvas.
// Older projects pinned bottoms to the pelvis; make them follow the legs once (later manual choices stick).
export function upgradeGarments(rig,layers){
  const version=rig.garments||0;if(version>=2)return rig;rig.garments=2;
  layers.forEach((l,i)=>{if(rig.modes[i]!=='rigid')return;const n=(l.name||'').toLowerCase();
    if(version<1&&/bottomwear|하의|skirt|치마/.test(n)&&/^(pelvis|body|root)$/.test(rig.assignments[i])){rig.modes[i]='bottoms';rig.assignments[i]=rig.points.pelvis?'pelvis':rig.assignments[i];}
    else if(/^(topwear|상의)/.test(n)&&rig.assignments[i]==='chest')rig.modes[i]='torso';
    else if(/^(neck|목)$/.test(n)&&rig.assignments[i]==='neck')rig.modes[i]='neck';});
  return rig;
}
export function addJointAt(rig,label,parent,x,y){const id=addJoint(rig,label,parent);rig.points[id]={x:clamp(x,0,rig.width),y:clamp(y,0,rig.height)};return id;}
// Insert a joint between `child` and its current parent (e.g. upper body → [waist] → chest).
export function insertJointAt(rig,label,child,x,y){if(child==='root'||!rig.points[child])throw Error('사이에 넣을 관절을 선택해주세요.');const parent=rig.parents[child],id=addJointAt(rig,label,parent,x,y);rig.parents[child]=id;return id;}

// Repair dark part-edge lines at hidden overlaps and visible internal contacts. The composite
// silhouette and facial features stay protected; fill comes from the same part, never the neighbour.
export function repairSeams(layers,width,height){
  const masks=hiddenMasks(layers,width,height,220),union=new Uint8ClampedArray(width*height*4);let changed=0;
  for(const l of layers)if(l.data&&l.visible!==false)for(let y=0;y<l.height;y++)for(let x=0;x<l.width;x++){
    const gx=Math.round(l.x+x),gy=Math.round(l.y+y);if(gx>=0&&gy>=0&&gx<width&&gy<height){const g=(gy*width+gx)*4+3;union[g]=Math.max(union[g],l.data[(y*l.width+x)*4+3]*(l.opacity??1));}}
  const outer=edgeDistance({width,height,data:union});
  const necks=layers.filter(l=>l.data&&l.visible!==false&&/^(neck|목)(?:$|[_ -])/i.test(l.name));
  const onNeck=(x,y)=>necks.some(l=>{const xx=Math.floor(x-l.x),yy=Math.floor(y-l.y);return xx>=0&&yy>=0&&xx<l.width&&yy<l.height&&l.data[(yy*l.width+xx)*4+3]>64;});
  layers.forEach((l,index)=>{
    if(!l.data||l.visible===false||/eye|irides|mouth|nose|brow|눈|입|코/i.test(l.name))return;
    const src=l.data.slice(),edge=edgeDistance({...l,data:src}),mask=masks[index].mask;
    const lum=i=>src[i*4]*.2126+src[i*4+1]*.7152+src[i*4+2]*.0722;
    const radius=Math.max(3,Math.min(12,Math.round(Math.min(l.width,l.height)*.06)));
    const surface=/topwear|bottomwear|handwear|legwear|footwear|neck|arm|leg|foot|shoe|상의|하의|팔|다리|신발|목/i.test(l.name),face=/^(face|얼굴)$/i.test(l.name);
    for(let y=0;y<l.height;y++)for(let x=0;x<l.width;x++){const i=y*l.width+x,gx=Math.round(l.x+x),gy=Math.round(l.y+y);
      const interior=gx>=0&&gy>=0&&gx<width&&gy<height&&outer[gy*width+gx]>radius;
      // The neck is often narrower than twice the generic silhouette guard. At a verified
      // neck overlap, protect only the actual exterior pixel, not a wide band on either side.
      // See-through also includes the exposed chest skin in the topwear layer.
      const neckContact=/^(topwear|상의)(?:$|[_ -])/i.test(l.name)&&onNeck(gx,gy)&&gx>=0&&gy>=0&&gx<width&&gy<height&&outer[gy*width+gx]>1;
      const contact=neckContact||interior&&(surface||face&&y>l.height*.65&&onNeck(gx,gy));
      if((!mask[i]&&!contact)||src[i*4+3]<8||edge[i]>radius)continue;
      let best=-1,score=Infinity;const dark=lum(i);
      for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
        const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=l.width||yy>=l.height)continue;const j=yy*l.width+xx,d=dx*dx+dy*dy;
        if(d>radius*radius||src[j*4+3]<240||edge[j]<Math.min(radius*.6,edge[i]+1.5)||lum(j)<dark+25)continue;
        const q=d+Math.max(0,radius-edge[j])*2;if(q<score){score=q;best=j;}
      }
      if(best>=0){for(let k=0;k<3;k++)l.data[i*4+k]=src[best*4+k];changed++;}
    }
  });return changed;
}

export function splitLegLayers(layers,rig){
  const out=[],assignments=[],modes=[];let changed=false;
  layers.forEach((l,i)=>{
    const mode=rig.modes[i],sides=(mode==='legs'||mode==='feet')&&l.data?splitMeshSides(l,rig,mode):null;
    if(sides?.length===2){changed=true;for(const p of sides){out.push({...p,id:l.id?`${l.id}_${p.mode.endsWith('_left')?'R':'L'}`:undefined,sourceIndex:i});assignments.push(p.bone);modes.push(p.mode);}}
    else {out.push({...l,sourceIndex:i});assignments.push(rig.assignments[i]);modes.push(mode);}
  });
  if(changed){if(rig.sleeves)rig.sleeves=Object.fromEntries(out.flatMap((l,i)=>rig.sleeves[l.sourceIndex]?[[i,rig.sleeves[l.sourceIndex]]]:[]));const previous=rig.partBones||{};rig.partBones=Object.fromEntries(out.flatMap((l,i)=>previous[l.sourceIndex]?[[i,[...previous[l.sourceIndex]]]]:[]));rig.assignments=assignments;rig.modes=modes;}
  return {layers:out,changed};
}
