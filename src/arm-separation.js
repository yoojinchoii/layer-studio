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
function crop(l,data,side){let x0=l.width,y0=l.height,x1=-1,y1=-1;for(let y=0;y<l.height;y++)for(let x=0;x<l.width;x++)if(data[(y*l.width+x)*4+3]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}if(x1<0)return null;
 const width=x1-x0+1,height=y1-y0+1,out=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)out.set(data.subarray(((y+y0)*l.width+x0)*4,((y+y0)*l.width+x1+1)*4),y*width*4);
 return {...l,canvas:null,data:out,x:l.x+x0,y:l.y+y0,width,height,name:`handwear_${side==='left'?'R':'L'}`,bone:`arm_${side}`,mode:`arm_${side}`,role:'separated-arm',allowedBones:armIds(side)};
}
// Lossless visible-pixel ownership; never mirror one arm or invent hidden anatomy.
// Brushes override the geometric proposal. Every input pixel belongs to one side only.
export function separateArms(layer,rig,index){
 if(rig.modes[index]!=='split_arms'||!layer.data)return null;
 const cfg=rig.armSplits?.[index]||{front:'left',bias:0,strokes:[]},sides=['left','right'],chains=sides.map(s=>armIds(s).map(id=>rig.points[id]));if(chains.flat().some(p=>!p))return null;
 const owner=new Uint8Array(layer.width*layer.height),out=sides.map(()=>new Uint8ClampedArray(layer.data.length));
 for(let y=0;y<layer.height;y++)for(let x=0;x<layer.width;x++){const k=y*layer.width+x;if(!layer.data[k*4+3])continue;const p={x:layer.x+x+.5,y:layer.y+y+.5},ds=chains.map(c=>Math.min(dist(p,c[0],c[1]),dist(p,c[1],c[2])));
  ds[cfg.front==='left'?0:1]-=cfg.bias||0;owner[k]=ds[0]<=ds[1]?0:1;
 }
 for(const stroke of cfg.strokes||[]){const side=stroke.side==='left'?0:1,r=stroke.radius,x0=Math.max(0,Math.floor(stroke.x-layer.x-r)),x1=Math.min(layer.width-1,Math.ceil(stroke.x-layer.x+r)),y0=Math.max(0,Math.floor(stroke.y-layer.y-r)),y1=Math.min(layer.height-1,Math.ceil(stroke.y-layer.y+r));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(Math.hypot(layer.x+x+.5-stroke.x,layer.y+y+.5-stroke.y)<=r)owner[y*layer.width+x]=side;
 }
 for(let k=0;k<owner.length;k++)if(layer.data[k*4+3])out[owner[k]].set(layer.data.subarray(k*4,k*4+4),k*4);
 const parts=out.map((data,i)=>crop(layer,data,sides[i])).filter(Boolean);return parts.sort((a,b)=>(a.mode===`arm_${cfg.front}`?-1:1)-(b.mode===`arm_${cfg.front}`?-1:1));
}
export function validateArmSplits(rig,count){
 if(rig.armSplits===undefined)return;const obj=rig.armSplits;if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('양팔 분리 설정을 확인해주세요.');
 for(const [i,c]of Object.entries(obj)){if(!/^\d+$/.test(i)||Number(i)>=count||!c||!['left','right'].includes(c.front)||!Number.isFinite(c.bias)||Math.abs(c.bias)>80||!Array.isArray(c.strokes)||c.strokes.length>2000)throw Error('양팔 분리 설정을 확인해주세요.');for(const s of c.strokes)if(!s||!['left','right'].includes(s.side)||![s.x,s.y,s.radius].every(Number.isFinite)||s.x<0||s.y<0||s.x>rig.width||s.y>rig.height||s.radius<1||s.radius>100)throw Error('팔 영역 브러시 값을 확인해주세요.');}
}
