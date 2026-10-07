import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanPixels,inferRig,makeSkeleton,poseMatrices} from './rig-core.js';
test('setup positions, stacking, visibility and loop survive rigging and pivot edits',()=>{
  const layers=[{name:'face',x:140,y:30,width:50,height:60},{name:'topwear',x:110,y:85,width:100,height:130},{name:'handwear-r',x:40,y:95,width:80,height:140,visible:false,opacity:.5}];
  const rig=inferRig(layers,320,480);rig.points.head={x:160,y:95};
  const sk=makeSkeleton(layers,rig),m=poseMatrices(sk);
  layers.forEach((l,i)=>{const name=`part_0${i+1}`,a=sk.skins[0].attachments[name][name],q=m[rig.assignments[i]];
    assert.ok(Math.abs(q[4]+a.x+160-l.x-l.width/2)<.001);
    assert.ok(Math.abs(480-q[5]-a.y-l.y-l.height/2)<.001);
  });
  assert.deepEqual(sk.slots.map(s=>s.name),['part_03','part_02','part_01']);
  assert.equal(sk.slots[0].attachment,undefined);assert.equal(sk.slots[0].color,'ffffff80');
  assert.deepEqual(poseMatrices(sk,0),poseMatrices(sk,4));
  assert.notDeepEqual(poseMatrices(sk,0),poseMatrices(sk,1));
});
test('cleanup preserves source, fully opaque interiors and small facial marks',()=>{
  const pixels=new Uint8ClampedArray(40*40*4);
  for(let y=5;y<35;y++)for(let x=5;x<35;x++)pixels.set([30,60,90,255],(y*40+x)*4);
  pixels.set([255,255,255,255],0);const original=pixels.slice(),result=cleanPixels(pixels,40,40,1);
  assert.deepEqual(pixels,original);assert.equal(result.data[3],0);assert.equal(result.removed,1);
  assert.deepEqual([...result.data.slice((20*40+20)*4,(20*40+20)*4+4)],[30,60,90,255]);
  assert.deepEqual(cleanPixels(pixels,40,40,0).data,original);
  const tiny=new Uint8ClampedArray([10,20,30,255]);assert.ok(cleanPixels(tiny,1,1).data[3]>0);
});
