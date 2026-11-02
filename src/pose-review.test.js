import test from 'node:test';
import assert from 'node:assert/strict';
import {mergedArmRoots} from './part-identity.js';
import {reviewPose,repairPoseBindings,enableFullBody} from './pose-review.js';
import {applyBuiltin,createRigTemplate,applyRigTemplate} from './rig-templates.js';
import {inferRig,buildParts,makeSkeleton,poseMatrices,regionMatrix,meshWorldVertices} from './rig-core.js';
import {availableChain} from './rig-scope.js';
import {validateProject} from './rig-ui.js';
const layer=(name,x,y,width,height,mask=()=>true)=>({name,x,y,width,height,visible:true,opacity:1,data:Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===3?(mask((i>>2)%width,Math.floor((i>>2)/width))?255:0):170)});
const fixture=()=>[layer('headwear',38,0,90,35),layer('face',55,10,70,80),layer('irides-r',64,40,10,10),layer('topwear',50,90,100,100),layer('handwear',20,95,160,80,(x,y)=>(x<35||x>125)||y>45),layer('legwear_R',60,190,25,90),layer('legwear_L',110,190,25,90)];
test('anatomical side labels survive crossing the centre and unequal shoulder heights',()=>{
 const ls=[layer('face',70,0,60,60),layer('topwear',65,65,70,90),layer('handwear_R',110,80,40,100),layer('handwear-L',25,65,50,125)];const r=inferRig(ls,200,300);
 assert.equal(r.assignments[2],'arm_left');assert.equal(r.assignments[3],'arm_right');assert.equal(r.modes[2],'arm_left');assert.ok(r.points.arm_left.x>r.points.arm_right.x);assert.notEqual(r.points.arm_left.y,r.points.arm_right.y);
});
test('two-root connected arm masks are flagged; a single bent arm and named separate arms are not',()=>{
 const ls=fixture();assert.ok(mergedArmRoots(ls[4],ls));assert.equal(mergedArmRoots({...ls[4],name:'handwear_R'},ls),null);
 const bent=layer('handwear',20,95,160,80,(x,y)=>x<30||y>55);assert.equal(mergedArmRoots(bent,[...ls.slice(0,4),bent]),null);
 const r=applyBuiltin('full',ls,200,300).rig;assert.equal(r.modes[4],'crossed_arms');assert.equal(r.assignments[0],'head');assert.equal(availableChain(r,'arm_left'),false);
 const ps=buildParts(ls,r),sk=makeSkeleton(ps,r);assert.ok(sk.animations.face_gaze);assert.equal(sk.animations.cheer,undefined);assert.equal(sk.animations.upper_gesture,undefined);
 assert.ok(!Object.keys(sk.animations.idle.bones).some(b=>/upper_arm|forearm/.test(b)));
 const arm=ps.find(p=>p.source===4),hat=ps.find(p=>p.source===0);assert.equal(arm.bone,'chest');assert.equal(arm.mode,'rigid');assert.equal(ps.filter(p=>p.source===4).length,1);assert.deepEqual(arm.data,ls[4].data);
 const rest=poseMatrices(sk),headTurn=poseMatrices(sk,null,{head:20}),armTurn=poseMatrices(sk,null,{upper_arm_R:60});assert.notDeepEqual(regionMatrix(sk.skins[0].attachments[hat.slot][hat.slot],headTurn.head),regionMatrix(sk.skins[0].attachments[hat.slot][hat.slot],rest.head));assert.deepEqual(regionMatrix(sk.skins[0].attachments[arm.slot][arm.slot],armTurn.torso),regionMatrix(sk.skins[0].attachments[arm.slot][arm.slot],rest.torso));
 const shirt=ps.find(p=>p.source===3),a=sk.skins[0].attachments[shirt.slot][shirt.slot];assert.deepEqual(meshWorldVertices(a,sk,armTurn),meshWorldVertices(a,sk,rest));
});
test('explicit legacy repair preserves edited joints and poses, persists, and keeps face controls when enabling legs',()=>{
 const ls=fixture(),r=applyBuiltin('half',ls,200,300).rig;r.assignments[0]='root';r.assignments[4]='arm_left';r.modes[4]='arm_left';r.pose.head=5;r.points.face_root.x+=2;r.sleeves={};
 const before=JSON.parse(JSON.stringify(r)),pixels=ls.map(l=>l.data.slice());assert.equal(reviewPose(r,ls).length,3);assert.equal(repairPoseBindings(r,ls),2);assert.equal(repairPoseBindings(r,ls),0);enableFullBody(r);
 assert.deepEqual(r.points,before.points);assert.deepEqual(r.pose,before.pose);assert.ok(r.activeBones.includes('face_root')&&r.activeBones.includes('ankle_left'));assert.ok(availableChain(r,'leg_left'));ls.forEach((l,i)=>assert.deepEqual(l.data,pixels[i]));
 const saved={format:'layer-studio-rig-v2',rig:r,strength:1,amplitude:1,layers:ls.map(({data,...l})=>({...l,image:'data:image/png;base64,AA=='}))};assert.doesNotThrow(()=>validateProject(JSON.parse(JSON.stringify(saved))));
 const t=createRigTemplate(r,ls,'비스듬한 전신'),next=applyRigTemplate(t,ls,200,300).rig;assert.equal(next.modes[4],'crossed_arms');assert.equal(next.assignments[0],'head');assert.ok(next.activeBones.includes('face_root'));
});
