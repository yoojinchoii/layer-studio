import {meshWorldVertices,regionMatrix,poseMatrices,animationDuration,spineName} from './rig-core.js';

// Include the original workspace plus all transformed sprite geometry, not just bone endpoints.
export function poseBounds(skeleton,parts,rig,matrices){
  let left=0,top=0,right=rig.width,bottom=rig.height;
  const include=(x,y)=>{x+=rig.points.root.x;y=rig.points.root.y-y;if(!Number.isFinite(x)||!Number.isFinite(y))return;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);};
  for(const p of parts){if(p.visible===false||p.opacity===0)continue;const a=skeleton.skins[0].attachments[p.slot][p.slot];
    if(a.type==='mesh'){for(const [x,y]of meshWorldVertices(a,skeleton,matrices))include(x,y);}
    else{const m=regionMatrix(a,matrices[spineName(p.bone)]);for(const [x,y]of [[0,0],[p.width,0],[p.width,p.height],[0,p.height]])include(m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]);}
  }
  for(const m of Object.values(matrices))include(m[4],m[5]);
  return {left,top,right,bottom};
}
export function paddedViewport(bounds,rig){const pad=Math.max(40,Math.max(rig.width,rig.height)*.06),x=Math.floor(bounds.left-pad),y=Math.floor(bounds.top-pad);return {x,y,width:Math.ceil(bounds.right+pad)-x,height:Math.ceil(bounds.bottom+pad)-y};}
export function animationViewport(skeleton,parts,rig,name){
  const duration=animationDuration(skeleton.animations[name]),steps=Math.max(1,Math.ceil(duration*30));let bounds={left:0,top:0,right:rig.width,bottom:rig.height};
  for(let i=0;i<=steps;i++){const b=poseBounds(skeleton,parts,rig,poseMatrices(skeleton,duration*i/steps,{},name));bounds={left:Math.min(bounds.left,b.left),top:Math.min(bounds.top,b.top),right:Math.max(bounds.right,b.right),bottom:Math.max(bounds.bottom,b.bottom)};}
  return paddedViewport(bounds,rig);
}
export function viewportPoint(view,rect,clientX,clientY){return {x:view.x+(clientX-rect.left)/rect.width*view.width,y:view.y+(clientY-rect.top)/rect.height*view.height};}
export function rasterSize(view){const scale=Math.min(1,8192/Math.max(view.width,view.height),Math.sqrt(16_000_000/(view.width*view.height)));return {scale,width:Math.ceil(view.width*scale),height:Math.ceil(view.height*scale)};}
