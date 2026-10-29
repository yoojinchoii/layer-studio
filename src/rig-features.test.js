import test from 'node:test';
import assert from 'node:assert/strict';
import {inferRig,makeSkeleton,poseMatrices,spineName,buildParts,meshWorldVertices,addJointAt} from './rig-core.js';
import {motionPoints,setChainMode,solveChain,rotateJoint,solvePinned} from './rig-motion.js';
import {activeIds,availableChain,validateControls,chainDefs} from './rig-scope.js';
import {applyBuiltin,createRigTemplate,applyRigTemplate,validateTemplate,saveTemplate,readTemplates} from './rig-templates.js';
import {validateProject} from './rig-ui.js';
const meta=[{name:'face',x:90,y:10,width:40,height:50},{name:'neck',x:98,y:50,width:24,height:25},{name:'topwear',x:60,y:65,width:100,height:130},{name:'handwear-r',x:20,y:70,width:45,height:130},{name:'handwear-l',x:165,y:70,width:45,height:130},{name:'bottomwear',x:65,y:180,width:90,height:50},{name:'legwear',x:65,y:210,width:90,height:130}];
const layers=()=>meta.map(l=>({...l,visible:true,opacity:1,data:new Uint8ClampedArray(l.width*l.height*4).fill(255)}));
const base=()=>inferRig(meta,240,360),near=(a,b,tol=.002)=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<tol,`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
test('IK/FK switching preserves an asymmetric posed arm; drag reaches target, opposite limb remains unchanged',()=>{
  const r=base();r.pose={chest:12,arm_left:23,elbow_left:45,wrist_left:-20};const before=motionPoints(r);assert.ok(setChainMode(r,'arm_left','ik'));assert.deepEqual(motionPoints(r),before);
  const target={x:before.arm_left.x-40,y:before.arm_left.y+45};solveChain(r,'arm_left',target);const after=motionPoints(r);near(after.wrist_left,target);near(after.wrist_right,before.wrist_right);
  setChainMode(r,'arm_left','fk');assert.deepEqual(motionPoints(r),after);
  const sk=makeSkeleton([],r),m=poseMatrices(sk,null,Object.fromEntries(Object.entries(r.pose).map(([id,v])=>[spineName(id),v])));
  for(const [id,p]of Object.entries(after))near(p,{x:r.points.root.x+m[spineName(id)][4],y:r.points.root.y-m[spineName(id)][5]});
});
test('pinned IK survives torso rotation; bending direction changes elbow without moving hand; unreachable target keeps lengths',()=>{
  const r=base();setChainMode(r,'arm_right','ik');const a=motionPoints(r).arm_right,target={x:a.x+30,y:a.y+50};solveChain(r,'arm_right',target);
  rotateJoint(r,'chest',8);near(motionPoints(r).wrist_right,target);
  const elbow=motionPoints(r).elbow_right;r.ikBends.arm_right*=-1;solvePinned(r);near(motionPoints(r).wrist_right,target);assert.ok(Math.hypot(elbow.x-motionPoints(r).elbow_right.x,elbow.y-motionPoints(r).elbow_right.y)>10);
  solveChain(r,'arm_right',{x:2000,y:2000});const p=motionPoints(r);for(const [a,b]of [['arm_right','elbow_right'],['elbow_right','wrist_right']])assert.ok(Math.abs(Math.hypot(p[b].x-p[a].x,p[b].y-p[a].y)-Math.hypot(r.points[b].x-r.points[a].x,r.points[b].y-r.points[a].y))<.001);
  rotateJoint(r,'elbow_right',10);assert.equal(r.ikModes.arm_right,'fk');assert.equal(r.ikTargets.arm_right,undefined);
});
test('Spine export stores independent chain modes and target keys at the posed wrist',()=>{
  const r=base();setChainMode(r,'arm_left','ik');setChainMode(r,'arm_right','fk');const a=motionPoints(r).arm_left;solveChain(r,'arm_left',{x:a.x-25,y:a.y+70});
  const sk=makeSkeleton([],r),animation=sk.animations.manual_pose;
  assert.equal(animation.ik.ik_arm_R[0].mix,1);assert.equal(animation.ik.ik_arm_L[0].mix,0);
  assert.equal(sk.ik.find(c=>c.name==='ik_arm_L').mix,0);
  const m=poseMatrices(sk,0,{},'manual_pose');near({x:m.ik_hand_R[4],y:m.ik_hand_R[5]},{x:m.hand_R[4],y:m.hand_R[5]});
  assert.ok(Object.values(sk.animations.idle.ik).every(t=>t[0].mix===0));
});
test('full, half and bust export only active bones; meshes retain normalized valid weights and setup pixels',()=>{
  for(const frame of ['full','half','bust']){
    const ls=layers(),{rig:r}=applyBuiltin(frame,ls,240,360),parts=buildParts(ls,r),sk=makeSkeleton(parts,r),m=poseMatrices(sk),names=new Set(sk.bones.map(b=>b.name));validateControls(r);
    if(frame!=='full')assert.ok(!names.has('thigh_R')&&!names.has('shin_L'));
    if(frame==='bust')assert.ok(!names.has('forearm_R')&&!names.has('hand_L')&&!sk.ik);
    for(const b of sk.bones)if(b.parent)assert.ok(names.has(b.parent));
    for(const anim of Object.values(sk.animations))for(const n of Object.keys(anim.bones))assert.ok(names.has(n));
    for(const part of parts){const a=sk.skins[0].attachments[part.slot][part.slot];if(a.type!=='mesh')continue;let k=0;for(let v=0;v<a.uvs.length/2;v++){let total=0;const n=a.vertices[k++];for(let i=0;i<n;i++){assert.ok(sk.bones[a.vertices[k]]);total+=a.vertices[k+3];k+=4;}assert.ok(Math.abs(total-1)<1e-6);}
      meshWorldVertices(a,sk,m).forEach(([x,y],i)=>near({x:x+r.points.root.x,y:r.points.root.y-y},{x:part.x+a.uvs[i*2]*part.width,y:part.y+a.uvs[i*2+1]*part.height},.02));
    }
  }
});
test('cropped half does not create wrist targets; a custom inserted elbow chain safely uses FK',()=>{
  const ls=layers();ls[3].height=290;ls[3].data=null;const {rig:r}=applyBuiltin('half',ls,240,360);assert.ok(!activeIds(r).includes('wrist_left'));assert.equal(availableChain(r,'arm_left'),false);
  const full=base(),id=addJointAt(full,'추가 관절','arm_left',80,100);full.parents.elbow_left=id;assert.equal(setChainMode(full,'arm_left','ik'),false);
});
test('custom template maps reordered, resized parts, custom bones and per-sprite rules without old images or poses',()=>{
  const ls=layers(),{rig:r}=applyBuiltin('full',ls,240,360);r.points.head.x+=7;r.pose.head=30;r.partBones[2]=['chest'];r.weightBlend.elbow_left=1.3;
  const id=addJointAt(r,'머리 장식','head',100,20);r.assignments[0]=id;
  const t=createRigTemplate(r,ls,'내 전신');assert.ok(!JSON.stringify(t).includes('data:image'));assert.equal(t.pose,undefined);
  const newLayers=[...ls].reverse().map(l=>({...l,data:null,x:l.x*2,y:l.y*2,width:l.width*2,height:l.height*2})),result=applyRigTemplate(JSON.parse(JSON.stringify(t)),newLayers,480,720),out=result.rig;
  assert.deepEqual(out.pose,{});assert.equal(result.unmatched.length,0);assert.ok(activeIds(out).includes(id));assert.equal(out.assignments[newLayers.findIndex(l=>l.name==='face')],id);assert.equal(out.parents[id],'head');
  near(out.points.head,{x:r.points.head.x*2,y:r.points.head.y*2});assert.deepEqual(out.partBones[newLayers.findIndex(l=>l.name==='topwear')],['chest']);assert.equal(out.weightBlend.elbow_left,1.3);
  validateControls(out);assert.doesNotThrow(()=>makeSkeleton(buildParts(newLayers,out),out));
});
test('template import rejects cycles and invalid numbers; library stores only validated templates and survives a new reader',()=>{
  const r=base(),t=createRigTemplate(r,meta,'내 템플릿');const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  saveTemplate(storage,t);assert.deepEqual(readTemplates(storage),[t]);saveTemplate(storage,{...t,meshDensity:'simple'});assert.equal(readTemplates(storage).length,1);
  const bad=JSON.parse(JSON.stringify(t));bad.joints.head.parent='hair';assert.throws(()=>validateTemplate(bad));bad.joints.head.parent='neck';bad.joints.head.x=Infinity;assert.throws(()=>validateTemplate(bad));
  assert.throws(()=>validateControls({...r,ikTargets:{arm_left:{x:NaN,y:1}}}));
});
test('legacy and scoped projects roundtrip through project validation with IK controls intact',()=>{
  for(const frame of ['full','half','bust']){
    const ls=layers(),{rig:r}=applyBuiltin(frame,ls,240,360);if(availableChain(r,'arm_left')){setChainMode(r,'arm_left','ik');const p=motionPoints(r).arm_left;solveChain(r,'arm_left',{x:p.x-20,y:p.y+40});}
    const saved={format:'layer-studio-rig-v2',rig:r,strength:1,amplitude:1,layers:ls.map(({data,...l})=>({...l,image:'data:image/png;base64,test'}))};
    assert.doesNotThrow(()=>validateProject(JSON.parse(JSON.stringify(saved))));const restored=JSON.parse(JSON.stringify(saved)).rig;assert.deepEqual(makeSkeleton(buildParts(ls,restored),restored),makeSkeleton(buildParts(ls,r),r));
    if(frame==='full'){delete saved.rig.activeBones;delete saved.rig.ikModes;delete saved.rig.ikTargets;delete saved.rig.ikBends;assert.doesNotThrow(()=>validateProject(saved));}
  }
});
