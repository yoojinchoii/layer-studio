import {facialOffsets} from './face-rig.js';
import {setupPose} from './rig-core.js';
import {activeIds,chainDefs,availableChain,chainFor} from './rig-scope.js';
const rad=Math.PI/180,angle=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x)/rad;
export const wrapAngle=v=>((v+180)%360+360)%360-180;
// Same FK evaluation as the export, without building textures, meshes or animations per pointer event.
export function motionWorld(rig){
  const {order,world:rest}=setupPose(rig),world={},offsets=facialOffsets(rig);
  for(const id of order){const b=rest[id],parent=rig.parents[id];if(!parent){world[id]={...b,angle:b.angle+(rig.pose?.[id]||0)};continue;}
    const offset=offsets[id]||{x:0,y:0},pr=world[parent].angle*rad;
    const ox=offset.x*Math.cos(pr)-offset.y*Math.sin(pr),oy=offset.x*Math.sin(pr)+offset.y*Math.cos(pr);
    const p=world[parent],r=(p.angle-rest[parent].angle)*rad,dx=b.x-rest[parent].x,dy=b.y-rest[parent].y;
    world[id]={x:p.x+dx*Math.cos(r)-dy*Math.sin(r)+ox,y:p.y+dx*Math.sin(r)+dy*Math.cos(r)+oy,angle:p.angle+b.angle-rest[parent].angle+(rig.pose?.[id]||0)};
  }return world;
}
export function motionPoints(rig){const world=motionWorld(rig),root=rig.points.root;return Object.fromEntries(activeIds(rig).map(id=>[id,{x:root.x+world[id].x,y:root.y-world[id].y}]));}
export function setChainMode(rig,key,mode){
  if(!availableChain(rig,key))return false;
  rig.ikModes??={};rig.ikTargets??={};rig.ikBends??={};
  if(mode==='ik'){
    const [a,b,c]=chainDefs[key],w=motionWorld(rig),A=w[a],B=w[b],C=w[c],cross=(B.x-A.x)*(C.y-B.y)-(B.y-A.y)*(C.x-B.x);
    rig.ikTargets[key]=motionPoints(rig)[c];rig.ikBends[key]=Math.abs(cross)>1e-6?Math.sign(cross):rig.ikBends[key]||(key==='arm_right'||key==='leg_left'?1:-1);
    rig.ik=true;
  }else delete rig.ikTargets[key];
  rig.ikModes[key]=mode;return true;
}
export function solveChain(rig,key,target){
  if(!availableChain(rig,key)||![target?.x,target?.y].every(Number.isFinite))return false;
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
  if(rig.faceRig>=2&&id.startsWith('face_')){if(!value)delete rig.pose[id];return;}
  const chain=chainFor(id);if(chain&&rig.ikModes?.[chain]==='ik')setChainMode(rig,chain,'fk');
  rig.pose??={};if(value)rig.pose[id]=wrapAngle(value);else delete rig.pose[id];solvePinned(rig);
}

export function initializeControls(rig){
  rig.ikModes??={};for(const key of Object.keys(chainDefs))if(availableChain(rig,key)){
    rig.ikModes[key]??='fk';if(rig.ikModes[key]==='ik'&&!rig.ikTargets?.[key])setChainMode(rig,key,'ik');
  }return rig;
}

// Target is in canvas coordinates; store translation in the posed parent's local axes.
export function moveFaceControl(rig,id,target){
  if(!id.startsWith('face_')||!rig.points[id]||![target.x,target.y].every(Number.isFinite))return;
  const w=motionWorld(rig),parent=w[rig.parents[id]],p=w[id],a=-parent.angle*rad,dx=target.x-rig.points.root.x-p.x,dy=rig.points.root.y-target.y-p.y;
  rig.poseOffsets??={};const old=rig.poseOffsets[id]||{x:0,y:0};rig.poseOffsets[id]={x:old.x+dx*Math.cos(a)-dy*Math.sin(a),y:old.y+dx*Math.sin(a)+dy*Math.cos(a)};
}
