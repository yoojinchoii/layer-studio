import test from 'node:test';
import assert from 'node:assert/strict';
import {unzlibSync} from 'fflate';
import {cleanPixels,inferRig,refineRig,splitLimb,buildParts,makeSkeleton,poseMatrices,meshWorldVertices,regionMatrix,addJoint,setParent,deleteJoint,boneOrder} from './rig-core.js';
import {packAtlas,encodePNG} from './spine-export.js';
const apply=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
const near=(a,b,eps=.01)=>Math.abs(a-b)<eps;
// Opaque test layer covering the given predicate, in image coordinates.
function layer(name,x,y,width,height,inside){const data=new Uint8ClampedArray(width*height*4);for(let py=0;py<height;py++)for(let px=0;px<width;px++)if(inside(x+px+.5,y+py+.5))data.set([200,150,120,255],(py*width+px)*4);return {name,x,y,width,height,data,opacity:1,visible:true};}
// Region image (u,v) → Spine world must equal the original image placement in setup pose.
function assertRegionsInPlace(sk,parts,rig,m){const root=rig.points.root;for(const p of parts){const a=sk.skins[0].attachments[p.slot][p.slot];if(a.type==='mesh')continue;const r=regionMatrix(a,m[sk.slots.find(s=>s.name===p.slot).bone]);
  for(const [u,v]of [[0,0],[p.width,0],[0,p.height],[p.width,p.height]]){const [x,y]=apply(r,u,v);assert.ok(near(x,p.x+u-root.x),`${p.slot} x`);assert.ok(near(y,root.y-p.y-v),`${p.slot} y`);}}}
test('setup positions, stacking, visibility and loop survive rigging with rotated bones',()=>{
  const layers=[{name:'face',x:140,y:30,width:50,height:60},{name:'topwear',x:110,y:85,width:100,height:130},{name:'handwear-r',x:40,y:95,width:80,height:140,visible:false,opacity:.5}];
  const rig=inferRig(layers,320,480);rig.points.head={x:160,y:95};
  const sk=makeSkeleton(layers,rig),m=poseMatrices(sk),root=rig.points.root;
  assertRegionsInPlace(sk,layers.slice(0,2).map((l,i)=>({...l,slot:`part_0${i+1}`})),rig,m);
  const mesh=sk.skins[0].attachments.part_03.part_03,l=layers[2];
  meshWorldVertices(mesh,sk,m).forEach(([x,y],v)=>{assert.ok(near(x+root.x,l.x+mesh.uvs[v*2]*l.width));assert.ok(near(root.y-y,l.y+mesh.uvs[v*2+1]*l.height));});
  assert.deepEqual(sk.slots.map(s=>s.name),['part_03','part_02','part_01']);
  assert.equal(sk.slots[0].attachment,undefined);assert.equal(sk.slots[0].color,'ffffff80');
  assert.deepEqual(poseMatrices(sk,0),poseMatrices(sk,4));
  assert.notDeepEqual(poseMatrices(sk,0),poseMatrices(sk,1));
  const names=new Set();for(const b of sk.bones){if(b.parent)assert.ok(names.has(b.parent),`${b.name} parent first`);names.add(b.name);}
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
test('mesh style: elbow bending moves distal mesh but keeps the shoulder fixed; custom hierarchy rejects cycles',()=>{
 const layers=[{name:'face',x:140,y:30,width:50,height:60},{name:'topwear',x:110,y:85,width:100,height:130},{name:'handwear-r',x:40,y:95,width:80,height:140}];
 const rig=inferRig(layers,320,480),sk=makeSkeleton(layers,rig),rest=poseMatrices(sk),bent=poseMatrices(sk,null,{forearm_R:45}),mesh=sk.skins[0].attachments.part_03.part_03;
 const a=meshWorldVertices(mesh,sk,rest),b=meshWorldVertices(mesh,sk,bent);
 assert.deepEqual(rest.upper_arm_R,bent.upper_arm_R);assert.ok(a.some((p,i)=>Math.hypot(p[0]-b[i][0],p[1]-b[i][1])>10));
 let k=0;for(let i=0;i<mesh.uvs.length/2;i++){let sum=0;const n=mesh.vertices[k++];for(let j=0;j<n;j++){assert.ok(mesh.vertices[k]>=0);sum+=mesh.vertices[k+3];k+=4;}assert.ok(Math.abs(sum-1)<1e-8);}assert.equal(k,mesh.vertices.length);
 const custom=addJoint(rig,'소품','wrist_left');assert.ok(boneOrder(rig).indexOf(custom)>boneOrder(rig).indexOf('wrist_left'));assert.throws(()=>setParent(rig,'arm_left',custom));assert.equal(rig.parents.arm_left,'chest');rig.assignments[0]=custom;deleteJoint(rig,custom);assert.equal(rig.assignments[0],'wrist_left');
});
// A straight vertical arm: shoulder (100,100), elbow (100,200), wrist (100,300), hand down to 340.
function armRig(){const meta=[{name:'face',x:80,y:0,width:40,height:40},{name:'handwear-r',x:90,y:90,width:20,height:250}];const rig=inferRig(meta,400,400);
  Object.assign(rig.points,{arm_left:{x:100,y:100},elbow_left:{x:100,y:200},wrist_left:{x:100,y:300}});rig.modes[1]='arm_left';return rig;}
test('cutout splits an arm into upper arm, forearm and hand with ball-joint overlap',()=>{
  const rig=armRig(),arm=layer('handwear-r',90,90,20,250,()=>true),parts=splitLimb(arm,rig,'arm_left');
  assert.deepEqual(parts.map(p=>p.name),['hand_R','forearm_R','upper_arm_R']);
  assert.deepEqual(parts.map(p=>p.bone),['wrist_left','elbow_left','arm_left']);
  const covers=(p,x,y)=>x>=p.x&&y>=p.y&&x<p.x+p.width&&y<p.y+p.height&&p.data[((y-p.y)*p.width+x-p.x)*4+3]>0;
  const [hand,fore,upper]=parts;
  assert.ok(covers(upper,100,199)&&covers(fore,100,199),'elbow pixels shared by both pieces');
  assert.ok(covers(upper,100,120)&&!covers(fore,100,120));assert.ok(covers(fore,100,250)&&!covers(upper,100,250)&&!covers(hand,100,250));
  assert.ok(covers(hand,100,330)&&!covers(fore,100,330));
  for(let y=90;y<340;y++)for(let x=90;x<110;x++)assert.ok(parts.some(p=>covers(p,x,y)),`pixel ${x},${y} kept`);
});
test('cutout legs separate by side, and rotating a joint keeps it attached',()=>{
  const meta=[{name:'face',x:180,y:0,width:40,height:40},{name:'bottomwear',x:150,y:150,width:100,height:60},{name:'legwear',x:150,y:160,width:100,height:200}];
  const rig=inferRig(meta,400,400);Object.assign(rig.points,{body:{x:200,y:160},hip_left:{x:170,y:170},knee_left:{x:170,y:260},ankle_left:{x:170,y:350},hip_right:{x:230,y:170},knee_right:{x:230,y:260},ankle_right:{x:230,y:350}});
  const legs=layer('legwear',150,160,100,200,x=>Math.abs(x-170)<12||Math.abs(x-230)<12),parts=buildParts([{...meta[0],data:null},{...meta[1],data:null},legs],rig);
  const names=parts.map(p=>p.slot);for(const n of ['thigh_R','shin_R','foot_R','thigh_L','shin_L','foot_L'])assert.ok(names.includes(n),n);
  assert.ok(parts.filter(p=>p.slot.endsWith('_R')&&p.source===2).every(p=>p.x+p.width<=200),'screen-left leg stays left');
  const sk=makeSkeleton(parts,rig),rest=poseMatrices(sk);assertRegionsInPlace(sk,parts,rig,rest);
  // Bend the knee 60°: the knee point inside the shin image must stay where the thigh puts the knee.
  const bent=poseMatrices(sk,null,{shin_R:60}),shin=parts.find(p=>p.slot==='shin_R'),a=sk.skins[0].attachments.shin_R.shin_R,root=rig.points.root;
  const [kx,ky]=apply(regionMatrix(a,bent.shin_R),170-shin.x,260-shin.y),knee=bent.shin_R;assert.ok(near(kx,knee[4])&&near(ky,knee[5]));
  assert.ok(near(rest.shin_R[4],170-root.x)&&near(rest.shin_R[5],root.y-260));
});
test('IK constraints target wrists/ankles, templates switch IK off and stay in place at time 0',()=>{
  const meta=[{name:'face',x:180,y:20,width:40,height:50},{name:'topwear',x:160,y:80,width:80,height:90},{name:'handwear-r',x:120,y:90,width:40,height:120},{name:'handwear-l',x:240,y:90,width:40,height:120},{name:'bottomwear',x:160,y:170,width:80,height:40},{name:'legwear',x:160,y:200,width:80,height:150},{name:'footwear',x:155,y:340,width:90,height:30}];
  const rig=inferRig(meta,400,400),sk=makeSkeleton(meta,rig),m=poseMatrices(sk),root=rig.points.root;
  assert.deepEqual(sk.ik.map(c=>c.name),['ik_arm_R','ik_leg_R','ik_arm_L','ik_leg_L']);
  for(const c of sk.ik){const target=m[c.target],end=c.target.replace('ik_','');assert.ok(near(target[4],m[end][4])&&near(target[5],m[end][5]),c.name);
    for(const b of c.bones)assert.ok(sk.bones.some(x=>x.name===b));}
  const wrist=rig.points.wrist_left;assert.ok(near(m.hand_R[4],wrist.x-root.x)&&near(m.hand_R[5],root.y-wrist.y));
  for(const [name,anim]of Object.entries(sk.animations)){for(const c of sk.ik)assert.deepEqual(anim.ik[c.name],[{mix:0}],name);
    for(const tl of Object.values(anim.bones))for(const frames of Object.values(tl))for(const f of frames)for(const v of Object.values(f))assert.ok(Number.isFinite(v),name);}
  for(const name of ['wave','cheer','hop'])assert.notDeepEqual(poseMatrices(sk,.3,{},name),m,name);
  rig.ik=false;assert.equal(makeSkeleton(meta,rig).ik,undefined);
});
test('joint estimation follows the actual pixels of a tilted arm',()=>{
  const meta=[{name:'face',x:180,y:0,width:40,height:40},{name:'topwear',x:170,y:60,width:60,height:100},{name:'handwear-r',x:60,y:70,width:120,height:200}];
  const rig=inferRig(meta,400,400);rig.points.chest={x:200,y:90};
  // Diagonal arm from (170,80) to (70,260), 16px thick.
  const arm=layer('handwear-r',60,70,120,200,(x,y)=>{const t=((x-170)*-100+(y-80)*180)/(100*100+180*180),d=Math.hypot(x-(170-100*t),y-(80+180*t));return t>=0&&t<=1&&d<8;});
  refineRig(rig,[{...meta[0]},{...meta[1]},arm]);
  const onLine=(p,t)=>near(p.x,170-100*t,6)&&near(p.y,80+180*t,10);
  assert.ok(onLine(rig.points.arm_left,.07),'shoulder');assert.ok(onLine(rig.points.elbow_left,.45),'elbow');assert.ok(onLine(rig.points.wrist_left,.79),'wrist');
});
test('atlas packs without overlap into a premultiplied PNG Unity can read',()=>{
  const parts=[[30,10],[12,40],[25,25],[7,3]].map(([w,h],i)=>({slot:`p${i}`,width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(0).map((_,k)=>k%4===3?128:200)}));
  const {atlas,pages}=packAtlas(parts,{name:'hero'});assert.equal(pages.length,1);const pg=pages[0];
  assert.match(atlas,/^hero\.png\nsize:\d+,\d+\nfilter:Linear,Linear\npma:true\n/);
  const boxes=[...atlas.matchAll(/^(p\d)\nbounds:(\d+),(\d+),(\d+),(\d+)$/gm)].map(m=>m.slice(2).map(Number));assert.equal(boxes.length,4);
  for(const [i,a]of boxes.entries()){assert.ok(a[0]+a[2]<=pg.width&&a[1]+a[3]<=pg.height);for(const b of boxes.slice(i+1))assert.ok(a[0]+a[2]<=b[0]||b[0]+b[2]<=a[0]||a[1]+a[3]<=b[1]||b[1]+b[3]<=a[1],'no overlap');}
  const [x,y]=boxes[0];assert.deepEqual([...pg.rgba.slice((y*pg.width+x)*4,(y*pg.width+x)*4+4)],[100,100,100,128]);
  const png=encodePNG(pg.rgba,pg.width,pg.height);assert.deepEqual([...png.slice(0,8)],[137,80,78,71,13,10,26,10]);
  const len=new DataView(png.buffer).getUint32(33),raw=unzlibSync(png.slice(41,41+len));assert.equal(raw.length,(pg.width*4+1)*pg.height);
  assert.deepEqual([...raw.slice(1,1+pg.width*4)],[...pg.rgba.slice(0,pg.width*4)]);
});
test('a joint inserted between upper body and chest carries the chest and everything above it',async()=>{
  const {insertJointAt}=await import('./rig-core.js');
  const meta=[{name:'face',x:140,y:30,width:50,height:60},{name:'topwear',x:110,y:85,width:100,height:130}];
  const rig=inferRig(meta,320,480),id=insertJointAt(rig,'허리','chest',160,230);
  assert.equal(rig.parents[id],'upper');assert.equal(rig.parents.chest,id);assert.ok(boneOrder(rig).indexOf(id)<boneOrder(rig).indexOf('chest'));
  const sk=makeSkeleton(meta,rig),rest=poseMatrices(sk),bent=poseMatrices(sk,null,{[id]:20});
  assert.notDeepEqual(rest.torso,bent.torso);assert.deepEqual(rest.upper_body,bent.upper_body);
  assert.throws(()=>insertJointAt(rig,'x','root',0,0));
});
