import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanPixels,inferRig,makeSkeleton,poseMatrices,meshWorldVertices,addJoint,setParent,deleteJoint,boneOrder} from './rig-core.js';
test('setup positions, stacking, visibility and loop survive rigging and pivot edits',()=>{
  const layers=[{name:'face',x:140,y:30,width:50,height:60},{name:'topwear',x:110,y:85,width:100,height:130},{name:'handwear-r',x:40,y:95,width:80,height:140,visible:false,opacity:.5}];
  const rig=inferRig(layers,320,480);rig.points.head={x:160,y:95};
  const sk=makeSkeleton(layers,rig),m=poseMatrices(sk);
  layers.forEach((l,i)=>{const name=`part_0${i+1}`,a=sk.skins[0].attachments[name][name],q=m[rig.assignments[i]];
    if(a.type==='mesh'){const vertices=meshWorldVertices(a,sk,m);vertices.forEach(([x,y],v)=>{assert.ok(Math.abs(x+160-(l.x+a.uvs[v*2]*l.width))<.01);assert.ok(Math.abs(480-y-(l.y+a.uvs[v*2+1]*l.height))<.01);});}
    else{assert.ok(Math.abs(q[4]+a.x+160-l.x-l.width/2)<.001);assert.ok(Math.abs(480-q[5]-a.y-l.y-l.height/2)<.001);}
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

test('elbow bending moves distal mesh but keeps the shoulder fixed; custom hierarchy rejects cycles',()=>{
 const layers=[{name:'face',x:140,y:30,width:50,height:60},{name:'topwear',x:110,y:85,width:100,height:130},{name:'handwear-r',x:40,y:95,width:80,height:140}];
 const rig=inferRig(layers,320,480),sk=makeSkeleton(layers,rig),rest=poseMatrices(sk),bent=poseMatrices(sk,null,{elbow_left:45}),mesh=sk.skins[0].attachments.part_03.part_03;
 const a=meshWorldVertices(mesh,sk,rest),b=meshWorldVertices(mesh,sk,bent);
 assert.deepEqual(rest.arm_left,bent.arm_left);assert.ok(a.some((p,i)=>Math.hypot(p[0]-b[i][0],p[1]-b[i][1])>10));
 let k=0;for(let i=0;i<mesh.uvs.length/2;i++){let sum=0;const n=mesh.vertices[k++];for(let j=0;j<n;j++){assert.ok(mesh.vertices[k]>=0);sum+=mesh.vertices[k+3];k+=4;}assert.ok(Math.abs(sum-1)<1e-8);}assert.equal(k,mesh.vertices.length);
 const custom=addJoint(rig,'소품','wrist_left');assert.ok(boneOrder(rig).indexOf(custom)>boneOrder(rig).indexOf('wrist_left'));assert.throws(()=>setParent(rig,'arm_left',custom));assert.equal(rig.parents.arm_left,'chest');rig.assignments[0]=custom;deleteJoint(rig,custom);assert.equal(rig.assignments[0],'wrist_left');
});
