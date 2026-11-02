import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBuiltin,createRigTemplate,applyRigTemplate,validateTemplate} from './rig-templates.js';
import {detectFrame,pixelBounds} from './face-rig.js';
import {buildParts,makeSkeleton,poseMatrices,meshWorldVertices,spineName} from './rig-core.js';
import {motionPoints,moveFaceControl,rotateJoint} from './rig-motion.js';
import {validateControls} from './rig-scope.js';
const layer=(name,x,y,width,height)=>({name,x,y,width,height,data:new Uint8ClampedArray(width*height*4).fill(255),opacity:1,visible:true});
const layers=()=>[layer('eyes',60,65,80,12),layer('irides',65,68,70,5),layer('mouth',90,108,20,8),layer('nose',95,83,10,12),layer('face',45,20,110,115),layer('hair',30,0,140,115),layer('neck',80,123,40,42),layer('topwear',20,155,160,85)];
const near=(a,b)=>assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<.003,`${a} != ${b}`);
test('bust uses face rig, no shoulders/hips/limb IK, and frame detection uses opaque bounds',()=>{
 const ls=layers(),r=applyBuiltin('bust',ls,200,240).rig;validateControls(r);
 assert.equal(detectFrame(ls,200,240),'bust');assert.equal(detectFrame([...ls,layer('legwear',50,220,100,20)],200,240),'full');
 assert.equal(r.parents.chest,'body');assert.ok(!r.activeBones.some(x=>/^(arm|elbow|wrist|hip|knee|ankle|pelvis)/.test(x)));assert.ok(r.activeBones.includes('face_eye_left')&&r.activeBones.includes('face_eye_right'));
 const packed=layer('face',0,0,200,240);packed.data.fill(0);for(let y=20;y<135;y++)for(let x=45;x<155;x++)packed.data[(y*200+x)*4+3]=255;
 assert.deepEqual(pixelBounds(packed),{x:45,y:20,width:110,height:115});assert.equal(detectFrame([packed],200,240),'bust');
});
test('face vertices reconstruct source positions, weights are local and bounded, no clothing movement from face controls',()=>{
 const ls=layers(),r=applyBuiltin('bust',ls,200,240).rig,parts=buildParts(ls,r),sk=makeSkeleton(parts,r),rest=poseMatrices(sk);
 assert.equal(sk.ik,undefined);
 for(const part of parts){const a=sk.skins[0].attachments[part.slot][part.slot];if(a.type!=='mesh')continue;assert.ok(a.uvs.length/2<85);const vertices=meshWorldVertices(a,sk,rest);let k=0;
  for(let i=0;i<vertices.length;i++){near(vertices[i],[part.x+a.uvs[2*i]*part.width-r.points.root.x,r.points.root.y-part.y-a.uvs[2*i+1]*part.height]);let total=0,n=a.vertices[k++];assert.ok(n<=4);for(let j=0;j<n;j++){const name=sk.bones[a.vertices[k]].name;assert.ok(!/arm|forearm|hand|thigh|shin|foot|lower_body/.test(name));total+=a.vertices[k+3];k+=4;}assert.ok(Math.abs(total-1)<1e-6);}
 }
 const before=motionPoints(r);r.pose.head=15;const p=motionPoints(r).face_left;moveFaceControl(r,'face_left',{x:p.x+5,y:p.y+3});const after=motionPoints(r);near([after.chest.x,after.chest.y],[before.chest.x,before.chest.y]);
 const exported=makeSkeleton(parts,r),posed=poseMatrices(exported,0,{},'manual_pose');for(const [id,p]of Object.entries(after))near([p.x,p.y],[r.points.root.x+posed[spineName(id)][4],r.points.root.y-posed[spineName(id)][5]]);
 const face=parts.find(p=>p.name==='face'),a=exported.skins[0].attachments[face.slot][face.slot];assert.notDeepEqual(meshWorldVertices(a,exported,posed),meshWorldVertices(a,exported,poseMatrices(exported)));
 assert.equal(exported.slots.find(s=>s.name==='topwear').bone,'torso');
});
test('combined eye layer has separate left/right weights; absent facial parts do not invent eye or mouth controls',()=>{
 const ls=layers(),r=applyBuiltin('bust',ls,200,240).rig,parts=buildParts(ls,r),sk=makeSkeleton(parts,r);const names=new Set();for(const part of parts.filter(p=>p.name.startsWith('eyes'))){const a=sk.skins[0].attachments[part.slot][part.slot];let k=0;
 for(let i=0;i<a.uvs.length/2;i++){const n=a.vertices[k++];for(let j=0;j<n;j++){names.add(sk.bones[a.vertices[k]].name);k+=4;}}}
 assert.deepEqual([...names].sort(),['face_eye_left','face_eye_right']);
 const baked=applyBuiltin('bust',ls.filter(l=>['face','hair','neck','topwear'].includes(l.name)),200,240).rig;
 assert.ok(!baked.activeBones.some(id=>/eye|brow|pupil|mouth/.test(id)));
});
test('facial template roundtrip, scaled retargeting and translated pose validation',()=>{
 const ls=layers(),r=applyBuiltin('bust',ls,200,240).rig,t=validateTemplate(createRigTemplate(r,ls,'얼굴'));const scaled=ls.map(l=>layer(l.name,l.x*2,l.y*2,l.width*2,l.height*2));
 const next=applyRigTemplate(t,scaled,400,480).rig;validateControls(next);near([next.points.face_nose.x,next.points.face_nose.y],[r.points.face_nose.x*2,r.points.face_nose.y*2]);
 next.poseOffsets={face_nose:{x:4,y:2}};validateControls(next);next.poseOffsets.face_nose.x=NaN;assert.throws(()=>validateControls(next));
});
test('separate brows, whites, pupils and lossless upper/lower lids; pupil follows locally in preview and export',()=>{
 const ls=[layer('eyebrow-r',58,53,30,5),layer('eyelash-r',56,64,32,20),layer('irides-r',66,69,10,12),layer('eyewhite-r',59,66,27,16),...layers().filter(l=>!['eyes','irides'].includes(l.name))];
 const r=applyBuiltin('bust',ls,200,240).rig,parts=buildParts(ls,r),lids=parts.filter(p=>p.source===1);
 assert.equal(lids.length,2);assert.equal(lids[0].bone,'face_lid_upper_left');assert.equal(lids[1].bone,'face_lid_lower_left');
 assert.deepEqual(new Uint8ClampedArray([...lids[0].data,...lids[1].data]),ls[1].data);
 assert.equal(parts.find(p=>p.name==='eyebrow-r').bone,'face_brow_left');assert.equal(parts.find(p=>p.name==='irides-r').bone,'face_pupil_left');assert.equal(parts.find(p=>p.name==='eyewhite-r').bone,'face_eye_left');
 const before=motionPoints(r),p=before.face_pupil_left;moveFaceControl(r,'face_pupil_left',{x:p.x+4,y:p.y+2});const after=motionPoints(r);
 near([after.face_pupil_left.x,after.face_pupil_left.y],[p.x+4,p.y+2]);
 near([after.face_lid_upper_left.x-before.face_lid_upper_left.x,after.face_lid_upper_left.y-before.face_lid_upper_left.y],[1.8,1.1]);
 for(const id of ['face_brow_left','face_eye_left','face_mouth','face_nose','chest','face_hair_front'])near([after[id].x,after[id].y],[before[id].x,before[id].y]);
 rotateJoint(r,'face_nose',20);assert.equal(r.pose.face_nose,20);rotateJoint(r,'head',10);assert.equal(r.pose.head,10);
 const sk=makeSkeleton(parts,r),world=poseMatrices(sk,0,{},'manual_pose');for(const [id,p]of Object.entries(motionPoints(r)))near([p.x,p.y],[r.points.root.x+world[spineName(id)][4],r.points.root.y-world[spineName(id)][5]]);
});
