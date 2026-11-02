import {facialOffsets} from './face-rig.js';
import {setupPose,mul} from './rig-core.js';
import {activeIds,chainDefs,availableChain,chainFor} from './rig-scope.js';
const rad=Math.PI/180,angle=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x)/rad;
export const wrapAngle=v=>((v+180)%360+360)%360-180;
// Same FK evaluation as the export, without building textures, meshes or animations per pointer event.
export function motionWorld(rig){
  const {order,world:rest}=setupPose(rig),world={},offsets=facialOffsets(rig);
  for(const id of order){
    const b=rest[id],parent=rig.parents[id],pr=parent?rest[parent]:{x:0,y:0,angle:0},r=-pr.angle*rad,dx=b.x-pr.x,dy=b.y-pr.y,off=offsets[id]||{x:0,y:0},sc=rig.poseScales?.[id]||{x:1,y:1};
    const a=(b.angle-pr.angle+(rig.pose?.[id]||0))*rad,c=Math.cos(a),sn=Math.sin(a),local=[c*sc.x,sn*sc.x,-sn*sc.y,c*sc.y,dx*Math.cos(r)-dy*Math.sin(r)+off.x,dx*Math.sin(r)+dy*Math.cos(r)+off.y];
    const m=parent?mul(world[parent].matrix,local):local;
    world[id]={...b,x:m[4],y:m[5],angle:Math.atan2(m[1],m[0])/rad,matrix:m};
  }return world;
}
export function motionPoints(rig){const world=motionWorld(rig),root=rig.points.root;return Object.fromEntries(activeIds(rig).map(id=>[id,{x:root.x+world[id].x,y:root.y-world[id].y}]));}
export function supportsIKScale(rig,key){
  for(let id=chainDefs[key]?.[1];id;id=rig.parents[id]){const p=rig.poseScales?.[id];if(p&&Math.abs(p.x-p.y)>1e-7)return false;}return true;
}
export function setChainMode(rig,key,mode){
  if(!availableChain(rig,key)||mode==='ik'&&!supportsIKScale(rig,key))return false;
  rig.ikModes??={};rig.ikTargets??={};rig.ikBends??={};
  if(mode==='ik'){
    const [a,b,c]=chainDefs[key],w=motionWorld(rig),A=w[a],B=w[b],C=w[c],cross=(B.x-A.x)*(C.y-B.y)-(B.y-A.y)*(C.x-B.x);
    rig.ikTargets[key]=motionPoints(rig)[c];rig.ikBends[key]=Math.abs(cross)>1e-6?Math.sign(cross):rig.ikBends[key]||(key==='arm_right'||key==='leg_left'?1:-1);
    rig.ik=true;
  }else delete rig.ikTargets[key];
  rig.ikModes[key]=mode;return true;
}
export function solveChain(rig,key,target){
  if(!availableChain(rig,key)||!supportsIKScale(rig,key)||![target?.x,target?.y].every(Number.isFinite))return false;
  const [a,b,c]=chainDefs[key],w=motionWorld(rig),A=w[a],B=w[b],C=w[c],l1=Math.hypot(B.x-A.x,B.y-A.y),l2=Math.hypot(C.x-B.x,C.y-B.y);
  const dx=target.x-rig.points.root.x-A.x,dy=rig.points.root.y-target.y-A.y,d=Math.hypot(dx,dy),distance=Math.max(Math.abs(l1-l2)+1e-7,Math.min(l1+l2-1e-7,d));
  const bend=rig.ikBends?.[key]||1,beta=bend*Math.acos(Math.max(-1,Math.min(1,(distance*distance-l1*l1-l2*l2)/(2*l1*l2))));
  const direction=d>1e-7?Math.atan2(dy,dx):angle(A,C)*rad,theta=direction-Math.atan2(l2*Math.sin(beta),l1+l2*Math.cos(beta));
  rig.pose??={};rig.pose[a]=wrapAngle((rig.pose[a]||0)+theta/rad-angle(A,B));
  const next=motionWorld(rig);rig.pose[b]=wrapAngle((rig.pose[b]||0)+(theta+beta)/rad-angle(next[b],next[c]));
  rig.ikTargets??={};rig.ikTargets[key]={x:target.x,y:target.y};return true;
}
export function solvePinned(rig){for(const key of Object.keys(chainDefs))if(rig.ikModes?.[key]==='ik'&&rig.ikTargets?.[key])solveChain(rig,key,rig.ikTargets[key]);}
export function rotateJoint(rig,id,value){
  const chain=chainFor(id);if(chain&&rig.ikModes?.[chain]==='ik')setChainMode(rig,chain,'fk');
  rig.pose??={};if(value)rig.pose[id]=wrapAngle(value);else delete rig.pose[id];solvePinned(rig);
}

export function initializeControls(rig){
  rig.ikModes??={};for(const key of Object.keys(chainDefs))if(availableChain(rig,key)){
    rig.ikModes[key]??='fk';if(!supportsIKScale(rig,key))setChainMode(rig,key,'fk');if(rig.ikModes[key]==='ik'&&!rig.ikTargets?.[key])setChainMode(rig,key,'ik');
  }return rig;
}

// Manual transforms use local parent axes, matching Spine translate and scale timelines.
function releaseAffectedIK(rig,id){
  for(const [key,chain]of Object.entries(chainDefs))if(rig.ikModes?.[key]==='ik'&&chain.some(b=>{for(let p=b;p;p=rig.parents[p])if(p===id)return true;return false;}))setChainMode(rig,key,'fk');
}
export function setJointOffset(rig,id,x,y){
  if(!rig.points[id]||![x,y].every(v=>Number.isFinite(v)&&Math.abs(v)<=32768))return false;
  releaseAffectedIK(rig,id);rig.poseOffsets??={};if(x||y)rig.poseOffsets[id]={x,y};else delete rig.poseOffsets[id];return true;
}
export function setJointScale(rig,id,x,y){
  if(!rig.points[id]||![x,y].every(v=>Number.isFinite(v)&&v>=.05&&v<=4))return false;
  releaseAffectedIK(rig,id);rig.poseScales??={};if(x!==1||y!==1)rig.poseScales[id]={x,y};else delete rig.poseScales[id];return true;
}
export function resetJointPose(rig,id){
  releaseAffectedIK(rig,id);for(const key of ['pose','poseOffsets','poseScales'])if(rig[key])delete rig[key][id];
}
// Invert the full parent matrix so world dragging remains exact under non-uniform scale.
export function moveJoint(rig,id,target){
  if(!rig.points[id]||![target.x,target.y].every(Number.isFinite))return;
  const w=motionWorld(rig),p=w[id],m=w[rig.parents[id]]?.matrix||[1,0,0,1,0,0],det=m[0]*m[3]-m[1]*m[2];if(Math.abs(det)<1e-8)return;
  const dx=target.x-rig.points.root.x-p.x,dy=rig.points.root.y-target.y-p.y,old=rig.poseOffsets?.[id]||{x:0,y:0};
  setJointOffset(rig,id,old.x+(m[3]*dx-m[2]*dy)/det,old.y+(-m[1]*dx+m[0]*dy)/det);
}
export function moveFaceControl(rig,id,target){if(id.startsWith('face_'))moveJoint(rig,id,target);}
