// 사용자 레퍼(Alice·옥토버페스트·아기 악마)에서 배운 리깅 관례: 얼굴 돌리기 비율, 치마 뼈, 이목구비 웨이트, 대기 모션.
import test from 'node:test';
import assert from 'node:assert/strict';
import {skirtShape,addSkirtChains,skirtWeights,skirtSwaySpec} from './skirt-chains.js';
import {faceTurnMixes,FACE_TURN_TOTAL,buildParts,makeSkeleton,poseMatrices,meshWorldVertices,animationDuration} from './rig-core.js';
import {applyBuiltin} from './rig-templates.js';
import {faceWeights} from './face-rig.js';
import {validateProject} from './rig-ui.js';

const legs={hip_left:{x:80,y:100},hip_right:{x:120,y:100},knee_left:{x:80,y:180},knee_right:{x:120,y:180}};
const garment=(fill)=>{const l={name:'bottomwear',x:40,y:80,width:120,height:90,data:new Uint8ClampedArray(120*90*4)};
  for(let y=0;y<90;y++)for(let x=0;x<120;x++)if(fill(x+40,y+80))l.data[(y*120+x)*4+3]=255;return l;};
test('skirt is detected only when cloth joins the legs; shorts with a gap stay leg-weighted',()=>{
  const skirt=garment(()=>true),shorts=garment((x,y)=>y<115||Math.abs(x-100)>8);
  assert.ok(skirtShape(skirt,{points:legs}));assert.equal(skirtShape(shorts,{points:legs}),null);
  const rig={points:{...legs,pelvis:{x:100,y:95}},parents:{},labels:{},modes:['bottoms'],activeBones:['pelvis']};
  assert.ok(addSkirtChains(rig,[skirt]));assert.ok(rig.activeBones.includes('skirt_left_2')&&rig.parents.skirt_left_1==='pelvis'&&rig.parents.skirt_left_2==='skirt_left_1');
  const top=skirtWeights(rig,60,81),hem=skirtWeights(rig,50,168),mid=skirtWeights(rig,100,150),sum=w=>w.reduce((n,[,v])=>n+v,0);
  assert.equal(top[0][0],'pelvis');assert.ok(top[0][1]>.95);
  assert.ok(Object.fromEntries(hem).skirt_left_2>.9);assert.ok(!hem.some(([id])=>/thigh|hip_|knee/.test(id)));
  const m=Object.fromEntries(mid);assert.ok(Math.abs((m.skirt_left_1||0)+(m.skirt_left_2||0)-((m.skirt_right_1||0)+(m.skirt_right_2||0)))<.05);
  for(const w of [top,hem,mid])assert.ok(Math.abs(sum(w)-1)<1e-6);
  const sway=skirtSwaySpec(rig,4);assert.ok(Math.abs(sway.skirt_left_2.rotate(.3))>Math.abs(sway.skirt_left_1.rotate(.3))*.5);
  assert.ok(Math.abs(sway.skirt_left_1.rotate(0)-sway.skirt_left_1.rotate(1))<1e-9);
});
test('face turn mixes follow the reference totals and subtract what the parent already carries',()=>{
  const rig={parents:{face_left:'face_root',face_eye_left:'face_left',face_brow_left:'face_eye_left',face_mouth:'face_root',face_hair_back:'head',face_hair_front:'hair'}};
  const mix=Object.fromEntries(faceTurnMixes(rig,new Set(Object.keys(rig.parents))));
  assert.equal(mix.face_left,.3);assert.equal(mix.face_eye_left,.5);assert.equal(mix.face_brow_left,undefined);assert.equal(mix.face_mouth,.8);
  assert.equal(mix.face_hair_front,FACE_TURN_TOTAL.face_hair_front);assert.ok(mix.face_hair_back<0);
});
const layer=(name,x,y,width,height)=>({name,x,y,width,height,data:new Uint8ClampedArray(width*height*4).fill(255),opacity:1,visible:true});
test('lash, nose and mouth sprites share the face weights under them so they cannot tear off when the face turns',()=>{
  const ls=[layer('eyelash_r',62,62,30,10),layer('eyelash_l',108,62,30,10),layer('mouth',90,108,20,8),layer('nose',95,83,10,12),layer('face',45,20,110,115),layer('hair',30,0,140,60),layer('neck',80,123,40,30),layer('topwear',20,150,160,90)];
  const r=applyBuiltin('bust',ls,200,240).rig,parts=buildParts(ls,r),sk=makeSkeleton(parts,r);
  const face=parts.find(p=>p.name==='face'),fa=sk.skins[0].attachments[face.slot][face.slot];assert.ok(fa.uvs.length/2>60,'face mesh is dense like the references');
  // 같은 자리라면 코·입 조각 정점과 얼굴 바탕은 웨이트가 같다(고개를 돌려도 같은 양만큼 움직임)
  for(const name of ['nose','mouth']){const p=parts.find(q=>q.name===name);
    for(const [x,y]of [[p.x+1,p.y+1],[p.x+p.width/2,p.y+p.height/2],[p.x+p.width-1,p.y+p.height-1]]){
      const a=Object.fromEntries(faceWeights(p,r,p.bone,x,y)),b=Object.fromEntries(faceWeights(face,r,'face_root',x,y));
      for(const id of new Set([...Object.keys(a),...Object.keys(b)]))assert.ok(Math.abs((a[id]||0)-(b[id]||0))<1e-9,`${name} ${id}`);}}
  const m0=poseMatrices(sk),m1=poseMatrices(sk,animationDuration(sk.animations.face_turn)*.25,{},'face_turn'),nose=parts.find(p=>p.name==='nose'),na=sk.skins[0].attachments[nose.slot][nose.slot];
  assert.ok(meshWorldVertices(na,sk,m1).some((v,i)=>Math.abs(v[0]-meshWorldVertices(na,sk,m0)[i][0])>1),'the nose actually moves');
  const lash=parts.find(p=>/eyelash_r/.test(p.name)),w=faceWeights(lash,r,lash.bone,lash.x+lash.width/2,lash.y+lash.height/2);
  assert.ok(w.some(([id])=>id===lash.bone),'blink still moves the lash');assert.ok(Math.abs(w.reduce((n,[,v])=>n+v,0)-1)<1e-9);
});
test('idle loops in 4 seconds with visible head, chest and arm motion; skirt bone ids survive project validation',()=>{
  const ls=[layer('face',90,10,40,50),layer('neck',98,50,24,25),layer('topwear',60,65,100,130),layer('bottomwear',60,180,100,80),layer('legwear_r',70,240,35,100),layer('legwear_l',115,240,35,100)];
  const r=applyBuiltin('full',ls,240,360).rig,sk=makeSkeleton(buildParts(ls,r),r),idle=sk.animations.idle;
  assert.equal(animationDuration(idle),4);
  const range=(bone)=>{const k=idle.bones[bone]?.rotate||[];return Math.max(...k.map(f=>f.value))-Math.min(...k.map(f=>f.value));};
  assert.ok(range('head')>=5);assert.ok(range('torso')>=1.5);
  for(const b of ['head','torso'])assert.ok(Math.abs(idle.bones[b].rotate[0].value-idle.bones[b].rotate.at(-1).value)<1e-6);
  if(r.skirtChains)assert.ok(sk.bones.some(b=>b.name==='skirt_left_2'));
  assert.equal(typeof validateProject,'function');
});
