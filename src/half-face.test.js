import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBuiltin,createRigTemplate,applyRigTemplate} from './rig-templates.js';
import {extendHalfFace} from './face-rig.js';
import {inferRig,buildParts,makeSkeleton,poseMatrices,meshWorldVertices,spineName} from './rig-core.js';
import {availableAnimations} from './rig-demo-motions.js';
import {validateProject} from './rig-ui.js';
const layer=(name,x,y,width,height)=>({name,x,y,width,height,data:new Uint8ClampedArray(width*height*4).fill(255),opacity:1,visible:true});
const layers=()=>[layer('front hair',35,0,130,105),layer('eyebrow-r',58,40,28,5),layer('eyelash-r',56,46,32,20),layer('irides-r',68,49,10,12),layer('eyewhite-r',58,48,28,15),layer('mouth',88,100,24,8),layer('face',45,12,110,120),layer('neck',80,125,40,40),layer('topwear',25,155,150,85),layer('handwear-r',5,135,20,95),layer('handwear-l',175,135,20,95)];
function legacy(ls){const r=applyBuiltin('half',ls,200,250).rig,base=inferRig(ls,200,250);for(const id of Object.keys(r.points))if(id.startsWith('face_')){delete r.points[id];delete r.parents[id];delete r.labels[id];}r.activeBones=r.activeBones.filter(id=>!id.startsWith('face_'));r.assignments=base.assignments;r.modes=base.modes;delete r.faceRig;delete r.faceGeometry;delete r.faceBindings;r.partBones={};return r;}
test('legacy half-body gains face controls without resetting body/arm transforms, weights, sleeves or IK',()=>{
 const ls=layers(),r=legacy(ls);r.pose.elbow_left=25;r.poseOffsets={chest:{x:3,y:2}};r.poseScales={arm_right:{x:1.1,y:1.1}};r.partBones[8]=['chest'];r.sleeves={};r.ikModes.arm_left='fk';
 const before=JSON.parse(JSON.stringify(r)),sk0=makeSkeleton(buildParts(ls,r),r),m0=poseMatrices(sk0,0,{},'manual_pose');assert.equal(extendHalfFace(r,ls),true);
 for(const key of ['pose','poseOffsets','poseScales','sleeves','ikModes','ikTargets','ikBends'])assert.deepEqual(r[key],before[key]);
 for(const id of Object.keys(before.points)){assert.deepEqual(r.points[id],before.points[id]);assert.equal(r.parents[id],before.parents[id]);}
 for(const i of [7,8,9,10]){assert.equal(r.assignments[i],before.assignments[i]);assert.equal(r.modes[i],before.modes[i]);assert.deepEqual(r.partBones[i],before.partBones[i]);}
 const sk=makeSkeleton(buildParts(ls,r),r),m=poseMatrices(sk,0,{},'manual_pose');for(const id of ['body','chest','arm_left','elbow_left','wrist_left','arm_right'])assert.deepEqual(m[spineName(id)],m0[spineName(id)]);
 r.points.face_mouth.x+=2;const edited=JSON.stringify(r);assert.equal(extendHalfFace(r,ls),false);assert.equal(JSON.stringify(r),edited);
 const saved={format:'layer-studio-rig-v2',rig:r,strength:1,amplitude:1,layers:ls.map(({data,...l})=>({...l,image:'data:image/png;base64,AA=='}))};assert.doesNotThrow(()=>validateProject(JSON.parse(JSON.stringify(saved))));
});
test('new half-body exports face and arm motions together; face edits do not pull the shirt or arms',()=>{
 const ls=layers(),r=applyBuiltin('half',ls,200,250).rig,parts=buildParts(ls,r),sk=makeSkeleton(parts,r);
 assert.ok(r.activeBones.includes('wrist_left')&&r.activeBones.includes('face_pupil_left'));
 assert.equal(parts.filter(p=>p.source===2).length,2);assert.ok(parts.filter(p=>p.source===2).every(p=>p.mode==='face'));
 for(const name of ['face_gaze','face_expression','upper_sway','upper_gesture'])assert.ok(availableAnimations(r).includes(name)&&sk.animations[name]);
 const rest=poseMatrices(sk),gaze=poseMatrices(sk,1,{},'face_gaze');assert.notDeepEqual(rest.face_pupil_left,gaze.face_pupil_left);assert.deepEqual(rest.torso,gaze.torso);assert.deepEqual(rest.upper_arm_R,gaze.upper_arm_R);
 const shirt=parts.find(p=>p.source===8),a=sk.skins[0].attachments[shirt.slot][shirt.slot];assert.deepEqual(meshWorldVertices(a,sk,rest),meshWorldVertices(a,sk,gaze));
});
test('old half-body templates gain facial bindings and new templates retain edited face points',()=>{
 const ls=layers(),old=createRigTemplate(legacy(ls),ls,'기존 상반신'),migrated=applyRigTemplate(old,ls,200,250).rig;assert.ok(migrated.activeBones.includes('face_mouth'));assert.equal(migrated.modes[5],'face');
 migrated.points.face_mouth.x+=4;const t=createRigTemplate(migrated,ls,'상체와 얼굴'),next=applyRigTemplate(t,ls,200,250).rig;assert.ok(Math.abs(next.points.face_mouth.x-migrated.points.face_mouth.x)<.001);assert.ok(availableAnimations(next).includes('face_gaze'));
});
