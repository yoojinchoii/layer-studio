import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBuiltin} from './rig-templates.js';
import {availableAnimations} from './rig-demo-motions.js';
import {buildParts,makeSkeleton,poseMatrices,meshWorldVertices,animationDuration,spineName} from './rig-core.js';
const layer=(name,x,y,width,height)=>({name,x,y,width,height,data:new Uint8ClampedArray(width*height*4).fill(255),opacity:1,visible:true});
const face=()=>[layer('eyewhite-r',58,48,28,15),layer('irides-r',68,49,10,12),layer('eyebrow-r',58,40,28,5),layer('eyelash-r',56,46,32,20),layer('mouth',88,100,24,8),layer('face',45,12,110,120),layer('front hair',35,0,130,115),layer('neck',80,125,40,40),layer('topwear',25,155,150,85)];
const demos=['head_sway','face_gaze','face_expression','upper_sway','upper_gesture'];
test('face demos move the intended features, leave clothes fixed and preserve the saved pose',()=>{
 const ls=face(),r=applyBuiltin('bust',ls,200,240).rig;r.pose.head=12;r.poseOffsets={face_mouth:{x:2,y:1}};r.poseScales={head:{x:1.1,y:1.1}};
 const before=JSON.stringify(r),parts=buildParts(ls,r),sk=makeSkeleton(parts,r),rest=poseMatrices(sk),gaze=poseMatrices(sk,1,{},'face_gaze');
 assert.deepEqual(availableAnimations(r),['head_sway','face_gaze','face_expression','idle']);
 // A quarter-cycle gaze goes horizontally right, even when parent setup axes are rotated.
 assert.ok(gaze.face_pupil_left[4]>rest.face_pupil_left[4]+1);
 assert.ok(Math.abs(gaze.face_pupil_left[5]-rest.face_pupil_left[5])<.005);
 const pupil=parts.find(p=>p.name==='irides-r'),a=sk.skins[0].attachments[pupil.slot][pupil.slot];assert.notDeepEqual(meshWorldVertices(a,sk,gaze),meshWorldVertices(a,sk,rest));
 for(const name of ['face_gaze','face_expression'])assert.deepEqual(poseMatrices(sk,1,{},name).torso,rest.torso);
 const expr=poseMatrices(sk,2,{},'face_expression');assert.notDeepEqual(expr.face_mouth,rest.face_mouth);
 assert.equal(JSON.stringify(r),before);assert.deepEqual(sk.animations.manual_pose.bones.head.scale,[{x:1.1,y:1.1}]);
});
test('partial-body demo keys loop continuously, use only active bones and scale down to rest',()=>{
 const ls=[...face(),layer('handwear-r',5,120,20,100),layer('handwear-l',175,120,20,100)];
 for(const frame of ['bust','half']){
  const r=applyBuiltin(frame,ls,200,240).rig,sk=makeSkeleton([],r),zero=makeSkeleton([],r,0),rest=poseMatrices(zero),valid=new Set(sk.bones.map(b=>b.name));
  for(const name of demos.filter(n=>sk.animations[n])){
   const anim=sk.animations[name];assert.equal(animationDuration(anim),4);
   for(const [bone,timelines]of Object.entries(anim.bones)){
    assert.ok(valid.has(bone));assert.ok(!/thigh|shin|foot/.test(bone));
    for(const keys of Object.values(timelines))for(const field of Object.keys(keys[0]).filter(k=>k!=='time')){
     assert.ok(Math.abs(keys[0][field]-keys.at(-1)[field])<.0001);
     assert.ok(keys.every(k=>Number.isFinite(k[field])));
    }
   }
   assert.notDeepEqual(poseMatrices(sk,1,{},name),poseMatrices(sk));
   assert.deepEqual(poseMatrices(zero,1,{},name),rest);
   for(const frames of Object.values(anim.ik||{}))assert.equal(frames[0].mix,0);
  }
  if(frame==='half'){
   assert.ok(sk.animations.upper_sway&&sk.animations.upper_gesture);assert.equal(sk.animations.hop,undefined);
   assert.notDeepEqual(poseMatrices(sk,1,{},'upper_gesture')[spineName('elbow_left')],poseMatrices(sk)[spineName('elbow_left')]);
  }
 }
});
test('missing facial parts and cropped wrists do not offer misleading demos',()=>{
 const baked=applyBuiltin('bust',face().filter(l=>['face','front hair','neck','topwear'].includes(l.name)),200,240).rig;
 assert.deepEqual(availableAnimations(baked),['head_sway','idle']);
 const half=applyBuiltin('half',[...face(),layer('handwear-l',175,120,20,120)],200,240).rig;
 assert.ok(availableAnimations(half).includes('upper_gesture'));assert.ok(!availableAnimations(half).includes('wave'));
});
