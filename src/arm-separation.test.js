import test from 'node:test';import assert from 'node:assert/strict';
import {applyBuiltin} from './rig-templates.js';import {restoreArmChains,startArmSplit,separateArms,validateArmSplits} from './arm-separation.js';import {buildParts,makeSkeleton,poseMatrices,meshWorldVertices} from './rig-core.js';import {validateProject} from './rig-ui.js';
const layer=(name,x,y,width,height,mask=()=>true)=>({name,x,y,width,height,visible:true,opacity:1,data:Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===3?(mask((i>>2)%width,Math.floor((i>>2)/width))?255:0):140+i%3*20)});
const fixture=()=>[layer('face',70,5,60,60),layer('topwear',50,80,100,100),layer('handwear',20,85,160,80,(x,y)=>x<35||x>125||y>45)];
test('merged arms retain both chains on new and legacy rigs without resetting existing edited joints',()=>{const ls=fixture(),r=applyBuiltin('half',ls,200,250).rig;for(const id of ['elbow_left','wrist_left','elbow_right','wrist_right'])assert.ok(r.activeBones.includes(id));r.activeBones=r.activeBones.filter(id=>!['elbow_right','wrist_right'].includes(id));r.points.elbow_left={x:37,y:150};r.pose.head=10;const before=structuredClone(r);assert.equal(restoreArmChains(r,ls),1);assert.deepEqual(r.points.elbow_left,before.points.elbow_left);assert.deepEqual(r.pose,before.pose);const saved=JSON.stringify(r);assert.equal(restoreArmChains(r,ls),0);assert.equal(JSON.stringify(r),saved);});
test('visible ownership is lossless, brush overrides only its footprint, and split meshes never weight the other arm',()=>{
 const ls=fixture(),r=applyBuiltin('half',ls,200,250).rig;startArmSplit(r,ls,2);r.points.arm_left={x:35,y:100};r.points.elbow_left={x:40,y:145};r.points.wrist_left={x:160,y:145};r.points.arm_right={x:165,y:100};r.points.elbow_right={x:160,y:155};r.points.wrist_right={x:40,y:135};
 const original=ls[2].data.slice(),visible=original.map((v,i)=>original[(i>>2)*4+3]?v:0),combine=ps=>{const data=new Uint8ClampedArray(original.length);for(const p of ps)for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){const k=(y*p.width+x)*4;if(!p.data[k+3])continue;const target=((p.y-ls[2].y+y)*ls[2].width+p.x-ls[2].x+x)*4;assert.equal(data[target+3],0,'no duplicated pixel');data.set(p.data.subarray(k,k+4),target);}return data;};
 assert.deepEqual(combine(separateArms(ls[2],r,2)),visible);r.armSplits[2].strokes.push({x:100,y:145,radius:5,side:'right'});const ps=separateArms(ls[2],r,2);assert.deepEqual(combine(ps),visible);assert.deepEqual(ls[2].data,original);
 const right=ps.find(p=>p.mode==='arm_right');assert.ok(right.data[((145-right.y)*right.width+100-right.x)*4+3]);
 const parts=buildParts(ls,r),sk=makeSkeleton(parts,r),rest=poseMatrices(sk),turned=poseMatrices(sk,null,{upper_arm_L:20});for(const p of parts.filter(p=>p.source===2)){const a=sk.skins[0].attachments[p.slot][p.slot];let k=0;while(k<a.vertices.length){const n=a.vertices[k++];let sum=0;for(let j=0;j<n;j++){const name=sk.bones[a.vertices[k]].name;assert.ok((p.mode==='arm_left'?['upper_arm_R','forearm_R','hand_R']:['upper_arm_L','forearm_L','hand_L']).includes(name));sum+=a.vertices[k+3];k+=4;}assert.ok(Math.abs(sum-1)<.001);}const v0=meshWorldVertices(a,sk,rest),v1=meshWorldVertices(a,sk,turned);if(p.mode==='arm_left')assert.deepEqual(v0,v1);else assert.notDeepEqual(v0,v1);}
 const project={format:'layer-studio-rig-v2',rig:r,strength:1,amplitude:1,layers:ls.map(({data,...l})=>({...l,image:'data:image/png;base64,AA=='}))};assert.doesNotThrow(()=>validateProject(structuredClone(project)));const reloaded=JSON.parse(JSON.stringify(r));assert.deepEqual(combine(separateArms(ls[2],reloaded,2)),visible);reloaded.armSplits[2].strokes[0].radius=Infinity;assert.throws(()=>validateArmSplits(reloaded,ls.length));
});

test('explicit crossed hand outline overrides the nearer opposite arm and binds only to its own wrist',async()=>{
 const {setHandOutline}=await import('./arm-separation.js');const ls=fixture(),r=applyBuiltin('half',ls,200,250).rig;
 startArmSplit(r,ls,2);r.points.arm_left={x:35,y:90};r.points.elbow_left={x:35,y:155};r.points.wrist_left={x:90,y:145};r.points.arm_right={x:165,y:90};r.points.elbow_right={x:165,y:155};r.points.wrist_right={x:50,y:145};
 const polygon=[{x:145,y:132},{x:175,y:132},{x:175,y:155},{x:145,y:155}];
 const raw=ls[2].data.slice();setHandOutline(r,ls,2,'left',polygon);r.armSplits[2].strokes.push({side:'right',x:160,y:145,radius:30});
 const ps=separateArms(ls[2],r,2),hand=ps.find(p=>p.name==='hand_R');assert.equal(hand.bone,'wrist_left');assert.equal(hand.mode,'rigid');
 const pixels=new Uint8Array(ls[2].width*ls[2].height);for(const p of ps)for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){const k=(y*p.width+x)*4;if(!p.data[k+3])continue;const i=(p.y-ls[2].y+y)*ls[2].width+p.x-ls[2].x+x;pixels[i]++;assert.deepEqual(p.data.slice(k,k+4),raw.slice(i*4,i*4+4));}
 for(let i=0;i<pixels.length;i++)assert.equal(pixels[i],raw[i*4+3]?1:0);
 const parts=buildParts(ls,r),sk=makeSkeleton(parts,r),h=parts.find(p=>p.name==='hand_R');assert.equal(h.bone,'wrist_left');assert.equal(sk.slots.find(s=>s.name===h.slot).bone,'hand_R');
 const saved=JSON.parse(JSON.stringify(r));validateArmSplits(saved,ls.length);assert.deepEqual(separateArms(ls[2],saved,2),ps);
 const before=JSON.stringify(r);assert.throws(()=>setHandOutline(r,ls,2,'right',[{x:0,y:0},{x:5,y:0},{x:5,y:5}]));assert.equal(JSON.stringify(r),before);
 saved.armSplits[2].hands.left[0].x=Infinity;assert.throws(()=>validateArmSplits(saved,ls.length));
});

test('reconstruction completes each arm as one masked sprite beneath its hand, and survives save/reload',async()=>{
 const {setHandOutline}=await import('./arm-separation.js');const {armFillSignature}=await import('./arm-reconstruction.js');
 const ls=fixture(),r=applyBuiltin('half',ls,200,250).rig;startArmSplit(r,ls,2);
 r.points.arm_left={x:35,y:95};r.points.elbow_left={x:40,y:150};r.points.wrist_left={x:150,y:150};r.points.arm_right={x:165,y:95};r.points.elbow_right={x:160,y:155};r.points.wrist_right={x:50,y:140};
 setHandOutline(r,ls,2,'left',[{x:145,y:130},{x:178,y:130},{x:178,y:155},{x:145,y:155}]);
 setHandOutline(r,ls,2,'right',[{x:22,y:130},{x:55,y:130},{x:55,y:155},{x:22,y:155}]);
 const before=separateArms(ls[2],r,2),key=armFillSignature(r);r.armSplits[2].reconstruct=true;
 const after=separateArms(ls[2],r,2),supports=after.filter(p=>p.reconstruction);
 assert.equal(supports.length,2);assert.equal(after.length,4);assert.notEqual(armFillSignature(r),key);
 assert.deepEqual(after.filter(p=>p.role==='separated-hand'),before.filter(p=>p.role==='separated-hand'),'hand pixels and ownership unchanged');
 assert.ok(after.slice(0,2).every(p=>p.role==='separated-hand'),'both hands above both arms');
 for(const p of supports){assert.equal(p.fill.length,p.width*p.height);assert.ok(p.fill.some((v,i)=>v&&p.data[i*4+3]>0),'inpaint has actual alpha to restore');assert.deepEqual(p.allowedBones,p.armSide==='left'?['arm_left','elbow_left','wrist_left']:['arm_right','elbow_right','wrist_right']);}
 const copy=JSON.parse(JSON.stringify(r));validateArmSplits(copy,ls.length);assert.deepEqual(separateArms(ls[2],copy,2),after);
 copy.armSplits[2].hands.left[0].x++;assert.notEqual(armFillSignature(copy),armFillSignature(r));
 copy.armSplits[2].widthScale=Infinity;assert.throws(()=>validateArmSplits(copy,ls.length));
});

test('an occluded one-pixel strip does not become a one-pixel forearm',async()=>{
 const {reconstructArm}=await import('./arm-reconstruction.js');const l=layer('arm',0,0,160,140,()=>false),visible=new Uint8ClampedArray(l.data.length);
 for(let x=25;x<125;x++)visible.set([160,95,60,255],(100*160+x)*4);
 const p=reconstructArm(l,visible,[{x:130,y:20},{x:130,y:100},{x:25,y:100}]);
 let thickness=0;for(let y=0;y<140;y++)if(p.data[(y*160+75)*4+3]>128)thickness++;
 assert.ok(thickness>=20,`hidden forearm thickness: ${thickness}`);
});
