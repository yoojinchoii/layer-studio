import {reconstructArm} from './arm-reconstruction.js';
import {mergedArmRoots} from './part-identity.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const armIds=side=>['arm','elbow','wrist'].map(j=>`${j}_${side}`);
export function mergedArmIndices(rig,layers){return layers.flatMap((l,i)=>['crossed_arms','split_arms'].includes(rig.modes[i])||mergedArmRoots(l,layers)?[i]:[]);}
// Keep both anatomical chains even when segmentation returned one shared sprite.
// Only missing/inactive joints are seeded on migration; hand-adjusted active joints survive.
export function restoreArmChains(rig,layers,{refit=false}={}){
 let changed=0;const active=new Set(rig.activeBones||Object.keys(rig.points));
 for(const i of mergedArmIndices(rig,layers)){
  const l=layers[i],roots=mergedArmRoots(l,layers)||{left:rig.points.arm_left,right:rig.points.arm_right};
  for(const side of ['left','right']){const ids=armIds(side),missing=ids.some(id=>!active.has(id)),root=roots[side],opposite=roots[side==='left'?'right':'left'];
   if(missing||refit){
    rig.points[ids[0]]={...root};rig.points[ids[1]]={x:root.x,y:clamp(l.y+l.height*.84,0,rig.height)};rig.points[ids[2]]={x:opposite.x,y:clamp(l.y+l.height*(side==='left'?.55:.42),0,rig.height)};changed++;
   }
   rig.parents[ids[0]]??='chest';rig.parents[ids[1]]??=ids[0];rig.parents[ids[2]]??=ids[1];for(const id of ids)active.add(id);
  }
 }
 if(rig.activeBones)rig.activeBones=[...active];return changed;
}
export function startArmSplit(rig,layers,index){
 if(!mergedArmIndices(rig,layers).includes(index))return false;restoreArmChains(rig,layers);
 rig.armSplits??={};rig.armSplits[index]??={front:'left',bias:0,strokes:[]};rig.modes[index]='split_arms';rig.assignments[index]='chest';
 if(rig.sleeves)delete rig.sleeves[index];if(rig.partBones)delete rig.partBones[index];return true;
}
function dist(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
function crop(l,data,side,hand=false,fill=null){let x0=l.width,y0=l.height,x1=-1,y1=-1;for(let y=0;y<l.height;y++)for(let x=0;x<l.width;x++)if(data[(y*l.width+x)*4+3]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}if(x1<0)return null;
 const width=x1-x0+1,height=y1-y0+1,out=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)out.set(data.subarray(((y+y0)*l.width+x0)*4,((y+y0)*l.width+x1+1)*4),y*width*4);
 const mask=fill?new Uint8Array(width*height):null;if(mask)for(let y=0;y<height;y++)mask.set(fill.subarray((y+y0)*l.width+x0,(y+y0)*l.width+x1+1),y*width);
 return {...l,canvas:null,data:out,...(mask?{fill:mask}:{}),x:l.x+x0,y:l.y+y0,width,height,name:`${hand?'hand':'handwear'}_${side==='left'?'R':'L'}`,bone:`${hand?'wrist':'arm'}_${side}`,mode:hand?'rigid':`arm_${side}`,role:hand?'separated-hand':'separated-arm',armSide:side,allowedBones:hand?[`wrist_${side}`]:armIds(side)};
}
// Lossless visible-pixel ownership; never mirror one arm or invent hidden anatomy.
// Brushes override the geometric proposal. Every input pixel belongs to one side only.
export function separateArms(layer,rig,index){
 if(rig.modes[index]!=='split_arms'||!layer.data)return null;
 const cfg=rig.armSplits?.[index]||{front:'left',bias:0,strokes:[]},sides=['left','right'],chains=sides.map(s=>armIds(s).map(id=>rig.points[id]));if(chains.flat().some(p=>!p))return null;
 const owner=new Uint8Array(layer.width*layer.height),out=Array.from({length:4},()=>new Uint8ClampedArray(layer.data.length));
 for(let y=0;y<layer.height;y++)for(let x=0;x<layer.width;x++){const k=y*layer.width+x;if(!layer.data[k*4+3])continue;const p={x:layer.x+x+.5,y:layer.y+y+.5},ds=chains.map(c=>Math.min(dist(p,c[0],c[1]),dist(p,c[1],c[2])));
  ds[cfg.front==='left'?0:1]-=cfg.bias||0;owner[k]=ds[0]<=ds[1]?0:1;
 }
 for(const stroke of cfg.strokes||[]){const side=stroke.side==='left'?0:1,r=stroke.radius,x0=Math.max(0,Math.floor(stroke.x-layer.x-r)),x1=Math.min(layer.width-1,Math.ceil(stroke.x-layer.x+r)),y0=Math.max(0,Math.floor(stroke.y-layer.y-r)),y1=Math.min(layer.height-1,Math.ceil(stroke.y-layer.y+r));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(Math.hypot(layer.x+x+.5-stroke.x,layer.y+y+.5-stroke.y)<=r)owner[y*layer.width+x]=side;
 }
 // Explicit hand outlines outrank distance and brushes; wrists own these sprites.
 for(let k=0;k<owner.length;k++)if(layer.data[k*4+3]){const p={x:layer.x+k%layer.width+.5,y:layer.y+Math.floor(k/layer.width)+.5};
  let target=owner[k];for(const side of [cfg.front==='left'?'right':'left',cfg.front])if(cfg.hands?.[side]&&insidePolygon(p,cfg.hands[side]))target=2+sides.indexOf(side);
  out[target].set(layer.data.subarray(k*4,k*4+4),k*4);
 }
 // Contact shadows and antialias fringes belong to the occlusion, not the arm.
 // Remove a small halo only when reconstruction is enabled; the support below is inpainted.
 if(cfg.reconstruct&&sides.every(s=>cfg.hands?.[s])){
  const r=Math.max(2,Math.min(5,Math.ceil(Math.min(layer.width,layer.height)*.025)));
  for(let i=0;i<owner.length;i++)if(out[2][i*4+3]||out[3][i*4+3]){const x=i%layer.width,y=Math.floor(i/layer.width);
   for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const xx=x+dx,yy=y+dy;if(dx*dx+dy*dy>r*r||xx<0||yy<0||xx>=layer.width||yy>=layer.height)continue;const k=(yy*layer.width+xx)*4;out[0][k+3]=out[1][k+3]=0;}
  }
 }
 const parts=out.map((data,i)=>crop(layer,data,sides[i%2],i>=2)).filter(Boolean);
 // All hands are above all arms. Crossed hands can cover the opposite upper arm.
 parts.sort((a,b)=>(a.role==='separated-hand'?0:1)-(b.role==='separated-hand'?0:1)||(a.armSide===cfg.front?-1:1)-(b.armSide===cfg.front?-1:1));
 if(cfg.reconstruct&&sides.every(s=>cfg.hands?.[s]))for(let i=0;i<2;i++){
  const restored=reconstructArm(layer,out[i],chains[i],cfg.widthScale||1);if(!restored)continue;
  const p=crop(layer,restored.data,sides[i],false,restored.fill);if(p){p.name+='_hidden';p.reconstruction=true;parts.push(p);}
 }
 return parts;
}
export function insidePolygon(p,points){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
export function setHandOutline(rig,layers,index,side,points){
 if(!['left','right'].includes(side)||!Array.isArray(points)||points.length<3||points.length>80||points.some(p=>!p||![p.x,p.y].every(Number.isFinite)||p.x<0||p.y<0||p.x>rig.width||p.y>rig.height))throw Error('손의 테두리를 3점 이상 지정해주세요.');
 const l=layers[index];if(!l?.data)throw Error('분리할 파츠를 선택해주세요.');let pixels=0;
 for(let y=0;y<l.height;y++)for(let x=0;x<l.width;x++)if(l.data[(y*l.width+x)*4+3]&&insidePolygon({x:l.x+x+.5,y:l.y+y+.5},points))pixels++;
 if(!pixels)throw Error('선택 영역 안에 이 파츠의 그림이 없어요. 손의 테두리를 다시 지정해주세요.');
 if(!startArmSplit(rig,layers,index))throw Error('양팔이 합쳐진 파츠를 선택해주세요.');
 const c=rig.armSplits[index];c.hands??={};c.hands[side]=points.map(p=>({...p}));return pixels;
}
export function validateArmSplits(rig,count){
 if(rig.armSplits===undefined)return;const obj=rig.armSplits;if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('양팔 분리 설정을 확인해주세요.');
 for(const [i,c]of Object.entries(obj)){if(!/^\d+$/.test(i)||Number(i)>=count||!c||!['left','right'].includes(c.front)||!Number.isFinite(c.bias)||Math.abs(c.bias)>80||!Array.isArray(c.strokes)||c.strokes.length>2000)throw Error('양팔 분리 설정을 확인해주세요.');if(c.reconstruct!==undefined&&typeof c.reconstruct!=='boolean'||c.widthScale!==undefined&&(!Number.isFinite(c.widthScale)||c.widthScale<.5||c.widthScale>2))throw Error('팔 복원 설정을 확인해주세요.');if(c.hands!==undefined){if(!c.hands||typeof c.hands!=='object'||Array.isArray(c.hands))throw Error('손 영역을 확인해주세요.');for(const [side,ps]of Object.entries(c.hands))if(!['left','right'].includes(side)||!Array.isArray(ps)||ps.length<3||ps.length>80||ps.some(p=>!p||![p.x,p.y].every(Number.isFinite)||p.x<0||p.y<0||p.x>rig.width||p.y>rig.height))throw Error('손 영역을 확인해주세요.');}for(const s of c.strokes)if(!s||!['left','right'].includes(s.side)||![s.x,s.y,s.radius].every(Number.isFinite)||s.x<0||s.y<0||s.x>rig.width||s.y>rig.height||s.radius<1||s.radius>100)throw Error('팔 영역 브러시 값을 확인해주세요.');}
}
