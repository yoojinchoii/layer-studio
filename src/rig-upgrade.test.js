import test from 'node:test';
import assert from 'node:assert/strict';
import {inferRig,buildParts,makeSkeleton,poseMatrices,meshWorldVertices,centerJoints,akimbo,spineName,animationDuration} from './rig-core.js';

const image=(name,x,y,w,h,inside=()=>true,color=[210,145,100])=>{const data=new Uint8ClampedArray(w*h*4);for(let py=0;py<h;py++)for(let px=0;px<w;px++)if(inside(px,py))data.set([...color,255],(py*w+px)*4);return {name,x,y,width:w,height:h,data,visible:true,opacity:1};};

test('joints that flare placed just outside the limb are moved to the middle of the limb cross-section',()=>{
  // 세로 팔(가로 40..64)에 팔꿈치가 왼쪽 바깥 6px에 찍힌 경우
  const arm=image('arm_r',40,50,24,200),rig=inferRig([arm],300,300);
  rig.modes[0]='arm_left';Object.assign(rig.points,{arm_left:{x:52,y:55},elbow_left:{x:34,y:145},wrist_left:{x:52,y:230}});
  centerJoints(rig,[arm]);
  assert.ok(Math.abs(rig.points.elbow_left.x-52)<2,JSON.stringify(rig.points.elbow_left));
  assert.ok(Math.abs(rig.points.wrist_left.x-52)<2,JSON.stringify(rig.points.wrist_left));
});

test('a long sleeve that covers the elbow bends with the forearm instead of staying on the upper arm',()=>{
  const sleeve=image('sleeve_r',40,50,24,190,undefined,[30,100,160]),hand=image('arm_r',40,230,24,30),rig=inferRig([sleeve,hand],300,300);
  rig.limbStyle='arms';rig.modes[0]='sleeve_left';rig.assignments[0]='arm_left';rig.modes[1]='arm_left';rig.assignments[1]='arm_left';
  Object.assign(rig.points,{arm_left:{x:52,y:55},elbow_left:{x:52,y:145},wrist_left:{x:52,y:235}});
  const parts=buildParts([sleeve,hand],rig),sk=makeSkeleton(parts,rig),p=parts.find(q=>q.slot==='sleeve_r'||q.name==='sleeve_r')||parts[0],mesh=sk.skins[0].attachments[p.slot][p.slot];
  const used=new Set();let k=0;while(k<mesh.vertices.length){const n=mesh.vertices[k++];for(let j=0;j<n;j++){used.add(sk.bones[mesh.vertices[k]].name);k+=4;}}
  assert.ok(used.has(spineName('elbow_left')),[...used].join());
  // 팔꿈치를 90° 굽히면 소매 끝동(아래쪽 정점)은 움직이고 위쪽(어깨)은 그대로
  const rest=meshWorldVertices(mesh,sk,poseMatrices(sk)),bent=meshWorldVertices(mesh,sk,poseMatrices(sk,null,{[spineName('elbow_left')]:90}));
  const low=rest.reduce((m,q,i)=>q[1]<rest[m][1]?i:m,0),high=rest.reduce((m,q,i)=>q[1]>rest[m][1]?i:m,0),d=i=>Math.hypot(rest[i][0]-bent[i][0],rest[i][1]-bent[i][1]);
  assert.ok(d(low)>30,`cuff moved ${d(low)}`);assert.ok(d(high)<1,`shoulder moved ${d(high)}`);
});

test('a hand on the hip stays on the hip in every motion except the two-arm cheer',()=>{
  const body=image('topwear',80,40,80,140,undefined,[30,100,160]),arm=image('arm_r',30,50,80,120,(x,y)=>y<70||x<40),rig=inferRig([body,arm],300,300);
  rig.modes[1]='arm_left';rig.assignments[1]='arm_left';
  Object.assign(rig.points,{arm_left:{x:95,y:60},elbow_left:{x:50,y:110},wrist_left:{x:90,y:150}});
  assert.ok(akimbo(rig,'left'));
  const sk=makeSkeleton(buildParts([body,arm],rig),rig),W=spineName('wrist_left'),A=spineName(rig.points.pelvis?'pelvis':'body');
  const local=m=>{const q=m[A],d=q[0]*q[3]-q[1]*q[2],dx=m[W][4]-q[4],dy=m[W][5]-q[5];return [(q[3]*dx-q[2]*dy)/d,(-q[1]*dx+q[0]*dy)/d];};
  const r=local(poseMatrices(sk));
  for(const name of ['idle','hop'].filter(n=>sk.animations[n])){const dur=animationDuration(sk.animations[name]);
    for(let k=0;k<8;k++){const p=local(poseMatrices(sk,dur*k/8,{},name));assert.ok(Math.hypot(p[0]-r[0],p[1]-r[1])<2,`${name} ${k}: ${p} vs ${r}`);}}
});
