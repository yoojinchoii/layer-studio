import test from 'node:test';
import assert from 'node:assert/strict';
import {inferRig,buildParts,makeSkeleton} from './rig-core.js';
import {auditRig} from './rig-audit.js';
const layer=(name,visible=true)=>({name,x:20,y:20,width:10,height:20,data:new Uint8ClampedArray(800).fill(255),visible,opacity:1});
test('audit catches clothing on arm bones and visible empty sprites without changing the rig',()=>{
 const layers=[layer('topwear'),layer('empty'),layer('hidden',false)];layers[1].data.fill(0);layers[2].data.fill(0);const rig=inferRig(layers,100,150);rig.assignments[0]='arm_left';const before=JSON.stringify(rig),parts=buildParts(layers,rig),report=auditRig(parts,rig,makeSkeleton(parts,rig));assert.ok(report.issues.some(i=>i.part==='topwear'));assert.ok(report.issues.some(i=>i.part==='empty'));assert.ok(!report.issues.some(i=>i.part==='hidden'));assert.equal(JSON.stringify(rig),before);assert.equal(report.poses,12);
});
