import {test} from 'node:test';import assert from 'node:assert/strict';
import {normalizeReport,artAllowsRig,exportAllowed,completeRigReview,applyArtBindings,ART_STAGES} from './art-pipeline.js';
const report=()=>({version:'art-pipeline-1',status:'art_passed',rig_allowed:true,stages:ART_STAGES.map(id=>({id,status:id==='rig'?'pending':'passed'})),analysis:{joints:{wrist_R:[900,500]}}});
test('failed artwork is never automatically delivered as a finished PSD',async()=>{
  const {psdDelivery}=await import('./art-pipeline.js');const p=report();p.stages[4].status='review';
  assert.equal(psdDelivery(p).autoDownload,false);assert.match(psdDelivery(p).suffix,/검토용/);
  assert.equal(psdDelivery({status:'art_passed'}).autoDownload,false);
  assert.equal(psdDelivery(report()).autoDownload,true);assert.equal(psdDelivery(null).autoDownload,true);
});
test('a forged pass with a failed semantic stage cannot unlock rigging',()=>{const p=report();p.stages[4].status='review';assert.equal(artAllowsRig(p),false);assert.equal(exportAllowed(p),false);});
test('art passing does not unlock export before mesh audit',()=>{assert.equal(exportAllowed(report()),false);const passed=completeRigReview(report(),{parts:10,poses:12,issues:[]});assert.equal(exportAllowed(passed),true);const bad=completeRigReview(report(),{parts:10,poses:12,issues:[{message:'mesh fold'}]});assert.equal(exportAllowed(bad),false);assert.equal(artAllowsRig(bad),true);});
test('anatomical right wrist remains right when crossing image centre; shirt only uses torso bones',()=>{const rig={width:101,height:101,points:Object.fromEntries(['wrist_left','arm_left','elbow_left','body','upper','chest'].map(k=>[k,{x:1,y:1}])),assignments:[],modes:[]};applyArtBindings(rig,[{name:'torso',art:{role:'torso',bone:'chest',mode:'torso',allowed_bones:['body','upper','chest']}}],report());assert.deepEqual(rig.points.wrist_left,{x:90,y:50});assert.deepEqual(rig.partBones[0],['body','upper','chest']);assert.deepEqual(rig.sleeves,{});});
test('unknown report formats and oversized records do not unlock',()=>{assert.equal(normalizeReport({}),null);assert.equal(artAllowsRig({...report(),version:'other'}),false);});

test('part edits invalidate a previously successful review',async()=>{const {invalidateArt}=await import('./art-pipeline.js');const p=completeRigReview(report(),{parts:1,poses:12,issues:[]});const invalid=invalidateArt(p);assert.equal(exportAllowed(invalid),false);assert.equal(artAllowsRig(invalid),false);assert.equal(invalid.stages[3].status,'pending');});

test('approved parts retain pixels through mesh generation and restrict actual exported weights',async()=>{
  const {inferRig,buildParts,makeSkeleton}=await import('./rig-core.js');
  const {auditRig}=await import('./rig-audit.js');
  const sprite=(name,x,y,w,h,art)=>({name,x,y,width:w,height:h,visible:true,opacity:1,data:new Uint8ClampedArray(w*h*4).fill(255),art});
  const layers=[sprite('hand_R',60,45,8,8,{role:'hand',bone:'wrist_left',mode:'rigid',allowed_bones:['wrist_left']}),sprite('torso',35,20,30,40,{role:'torso',bone:'chest',mode:'torso',allowed_bones:['body','upper','chest']})];
  const rig=inferRig(layers,100,100);applyArtBindings(rig,layers,report());
  const parts=buildParts(layers,rig);assert.equal(parts.length,2);assert.deepEqual(parts.map(p=>p.data),layers.map(p=>p.data));
  const sk=makeSkeleton(parts,rig),audit=auditRig(parts,rig,sk);
  assert.ok(!audit.issues.some(i=>i.message.includes('허용하지 않은')));
  assert.equal(sk.slots.find(s=>s.name==='hand_R').bone,'hand_R');
});
