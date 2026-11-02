import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBuiltin} from './rig-templates.js';
import {motionWorld,motionPoints,moveJoint,setJointOffset,setJointScale,resetJointPose,rotateJoint,setChainMode,solveChain,initializeControls} from './rig-motion.js';
import {buildParts,makeSkeleton,poseMatrices,spineName,meshWorldVertices} from './rig-core.js';
import {validateProject} from './rig-ui.js';
const layer=(name,x,y,width,height)=>({name,x,y,width,height,opacity:1,visible:true,data:new Uint8ClampedArray(width*height*4).fill(255)});
const layers=()=>[layer('face',70,10,60,75),layer('neck',90,80,20,30),layer('topwear',45,100,110,100),layer('handwear-r',20,100,25,95),layer('handwear-l',155,100,25,95),layer('legwear',65,195,70,100),layer('eyewhite-r',80,40,15,10),layer('irides-r',84,41,6,8),layer('eyelash-r',79,38,17,14)];
const near=(a,b,tol=.004)=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<tol,`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
test('position, rotation and non-uniform scales agree in preview and Spine export, including translated descendants',()=>{
 for(const frame of ['full','bust']){
  const ls=layers(),r=applyBuiltin(frame,ls,200,300).rig;
  rotateJoint(r,'chest',14);setJointScale(r,'chest',1.3,.8);setJointOffset(r,'head',7,-4);rotateJoint(r,'head',-9);setJointScale(r,'head',.9,1.2);
  const id=frame==='bust'?'face_pupil_left':'wrist_left',old=motionPoints(r)[id];moveJoint(r,id,{x:old.x+8,y:old.y-5});near(motionPoints(r)[id],{x:old.x+8,y:old.y-5});
  const parts=buildParts(ls,r),sk=makeSkeleton(parts,r),m=poseMatrices(sk,0,{},'manual_pose'),w=motionWorld(r),preview=poseMatrices(sk,null,Object.fromEntries(Object.entries(r.pose).map(([id,v])=>[spineName(id),v])),'idle',Object.fromEntries(Object.entries(r.poseOffsets).map(([id,v])=>[spineName(id),v])),Object.fromEntries(Object.entries(r.poseScales).map(([id,v])=>[spineName(id),v])));
  for(const [id,p]of Object.entries(motionPoints(r)))near(p,{x:r.points.root.x+m[spineName(id)][4],y:r.points.root.y-m[spineName(id)][5]});
  for(const part of parts){const a=sk.skins[0].attachments[part.slot][part.slot];if(a.type!=='mesh')continue;const verts=meshWorldVertices(a,sk,m),pure=meshWorldVertices(a,sk,Object.fromEntries(Object.entries(w).map(([id,p])=>[spineName(id),p.matrix])));verts.forEach((v,i)=>near({x:v[0],y:v[1]},{x:pure[i][0],y:pure[i][1]}));}
  assert.deepEqual(sk.animations.manual_pose.bones.head.scale,[{x:.9,y:1.2}]);assert.deepEqual(sk.animations.manual_pose.bones.head.translate,[{x:7,y:-4}]);
  // Browsers receive derived eyelid-follow offsets; ordinary bones use identical scale matrices.
  for(const id of ['torso','head'])m[id].forEach((v,i)=>assert.ok(Math.abs(v-preview[id][i])<.001));
 }
});
test('a selected joint reset clears only its transform values; save/load retains scales and rejects invalid transforms',()=>{
 const ls=layers(),r=applyBuiltin('bust',ls,200,300).rig;
 setJointOffset(r,'face_nose',5,3);setJointScale(r,'face_nose',1.1,.9);rotateJoint(r,'face_nose',12);setJointOffset(r,'face_mouth',2,-3);setJointScale(r,'face_mouth',1.25,1.1);
 const saved={format:'layer-studio-rig-v2',rig:r,layers:ls.map(l=>({...l,data:undefined,image:'data:image/png;base64,AA=='})),strength:1,amplitude:1};assert.doesNotThrow(()=>validateProject(JSON.parse(JSON.stringify(saved))));
 const other=JSON.stringify({position:r.poseOffsets.face_mouth,scale:r.poseScales.face_mouth});resetJointPose(r,'face_nose');assert.equal(r.pose.face_nose,undefined);assert.equal(r.poseOffsets.face_nose,undefined);assert.equal(r.poseScales.face_nose,undefined);assert.equal(JSON.stringify({position:r.poseOffsets.face_mouth,scale:r.poseScales.face_mouth}),other);
 for(const x of [0,-1,NaN,Infinity,5]){const before=JSON.stringify(r);assert.equal(setJointScale(r,'head',x,1),false);assert.equal(JSON.stringify(r),before);}
 r.poseScales.head={x:0,y:1};assert.throws(()=>validateProject(saved));
});
test('manual transforms release affected IK without clearing other limbs; uniform scaled IK still reaches its target',()=>{
 const r=applyBuiltin('full',layers(),200,300).rig;setChainMode(r,'arm_left','ik');setChainMode(r,'arm_right','ik');setJointOffset(r,'elbow_left',2,3);assert.equal(r.ikModes.arm_left,'fk');assert.equal(r.ikModes.arm_right,'ik');
 setJointScale(r,'chest',1.2,.8);assert.equal(r.ikModes.arm_right,'fk');assert.equal(setChainMode(r,'arm_right','ik'),false);
 r.ikModes.arm_right='ik';initializeControls(r);assert.equal(r.ikModes.arm_right,'fk');
 setJointScale(r,'chest',1.2,1.2);assert.equal(setChainMode(r,'arm_right','ik'),true);const a=motionPoints(r).arm_right,target={x:a.x+25,y:a.y+40};solveChain(r,'arm_right',target);near(motionPoints(r).wrist_right,target);
});
