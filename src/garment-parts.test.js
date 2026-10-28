import test from 'node:test';
import assert from 'node:assert/strict';
import {initSleeves,separateSleeve,cuffLine} from './garment-parts.js';
import {inferRig,buildParts,makeSkeleton,poseMatrices,meshWorldVertices,splitLegLayers} from './rig-core.js';
function fixture(alpha=255){
  const skin=[210,145,100],cloth=[30,100,160];
  const image=(name,x,y,w,h,color)=>{const data=new Uint8ClampedArray(w*h*4);for(let py=0;py<h;py++)for(let px=0;px<w;px++)data.set([...color(py),alpha],(py*w+px)*4);return {name,x,y,width:w,height:h,data,visible:true,opacity:1};};
  const layers=[image('topwear',90,50,80,100,()=>cloth),image('handwear-r',50,50,24,200,y=>y<48?cloth:skin)];
  const rig=inferRig(layers,300,300);Object.assign(rig.points,{arm_left:{x:62,y:55},elbow_left:{x:62,y:145},wrist_left:{x:62,y:215}});rig.assignments[1]='arm_left';rig.modes[1]='arm_left';return {layers,rig};
}
function rgba(part,x,y){if(x<part.x||y<part.y||x>=part.x+part.width||y>=part.y+part.height)return [0,0,0,0];return Array.from(part.data.slice(((y-part.y)*part.width+x-part.x)*4,((y-part.y)*part.width+x-part.x)*4+4));}
function over(a,b){const aa=a[3]/255,ba=b[3]/255,alpha=aa+ba*(1-aa);return [...a.slice(0,3).map((v,i)=>alpha?(v*aa+b[i]*ba*(1-aa))/alpha:0),alpha*255];}
test('short sleeve follows the upper arm, blends into the torso at the shoulder, and skin keeps its own arm weights',()=>{
  const {layers,rig}=fixture();assert.equal(initSleeves(layers,rig),1);const original=layers[1].data.slice(),parts=buildParts(layers,rig),sleeve=parts.find(p=>p.role==='sleeve'),arm=parts.find(p=>p.role==='skin');
  assert.equal(parts.length,3);assert.equal(sleeve.bone,'arm_left');assert.equal(sleeve.mode,'sleeve_left');assert.equal(arm.mode,'arm_left');assert.deepEqual(layers[1].data,original);
  const sk=makeSkeleton(parts,rig),rest=poseMatrices(sk),posed=poseMatrices(sk,null,{upper_arm_R:65,forearm_R:30});assert.deepEqual(rest.torso,posed.torso);
  const mesh=sk.skins[0].attachments[arm.slot][arm.slot];let at=0;while(at<mesh.vertices.length){const n=mesh.vertices[at++];for(let j=0;j<n;j++){assert.ok(['torso','upper_arm_R','forearm_R','hand_R'].includes(sk.bones[mesh.vertices[at]].name));at+=4;}}
  assert.notDeepEqual(meshWorldVertices(mesh,sk,rest),meshWorldVertices(mesh,sk,posed));
  // Sleeve mesh: only torso + upper arm; the cuff end moves with the arm, the shoulder seam stays near the torso.
  const sm=sk.skins[0].attachments[sleeve.slot][sleeve.slot];assert.equal(sm.type,'mesh');const used=new Set();let k=0;while(k<sm.vertices.length){const n=sm.vertices[k++];for(let j=0;j<n;j++){used.add(sk.bones[sm.vertices[k]].name);k+=4;}}
  assert.ok([...used].every(b=>['torso','upper_arm_R'].includes(b)),[...used].join());assert.ok(used.has('upper_arm_R'));
  const a=meshWorldVertices(sm,sk,rest),b=meshWorldVertices(sm,sk,posed),moved=a.map((p,i)=>Math.hypot(p[0]-b[i][0],p[1]-b[i][1])),cuff=a.reduce((m,p,i)=>p[1]<a[m][1]?i:m,0),top=a.reduce((m,p,i)=>p[1]>a[m][1]?i:m,0);
  assert.ok(moved[cuff]>15,'cuff follows the arm');assert.ok(moved[top]<moved[cuff]*.5,'shoulder seam stays close to the torso');
  assert.ok(rgba(arm,62,65)[3]>0,'estimated skin extends up inside sleeve');
  for(let y=50;y<250;y++)for(let x=50;x<74;x++)assert.deepEqual(over(rgba(sleeve,x,y),rgba(arm,x,y)),rgba(layers[1],x,y),'opaque artwork at rest preserved');
});
test('nearly opaque model output still fills hidden arm and only changes near-opaque covered pixels',()=>{
  const {layers,rig}=fixture(253);initSleeves(layers,rig);const [sleeve,arm]=separateSleeve(layers[1],rig,1);assert.equal(rgba(arm,62,65)[3],255);
  for(let y=50;y<250;y++)for(let x=50;x<74;x++){const before=rgba(layers[1],x,y),after=over(rgba(sleeve,x,y),rgba(arm,x,y));assert.ok(after.every((v,i)=>Math.abs(v-before[i])<=2),'tiny model alpha differences stay below 2/255');}
});
test('saved separation is reversible, independent of pose, and respects manual boundaries',()=>{
  const {layers,rig}=fixture();initSleeves(layers,rig);const saved=JSON.parse(JSON.stringify(rig));assert.equal(initSleeves(layers,saved),0);assert.deepEqual(saved,rig);
  const a=separateSleeve(layers[1],rig,1);rig.pose.arm_left=45;assert.deepEqual(separateSleeve(layers[1],rig,1),a);
  const line=cuffLine(rig.sleeves[1]);rig.sleeves[1].offset=10;assert.equal(cuffLine(rig.sleeves[1]).point.y,line.point.y+10);assert.notDeepEqual(separateSleeve(layers[1],rig,1)[0].data,a[0].data);
  rig.sleeves[1].enabled=false;assert.equal(buildParts(layers,rig).length,2);assert.deepEqual(buildParts(layers,rig)[1].data,layers[1].data);assert.equal(initSleeves(layers,rig),0);
});
test('bare arms or colours absent from shirt are not automatically split',()=>{
  const {layers,rig}=fixture();for(let i=0;i<layers[1].data.length;i+=4)layers[1].data.set([210,145,100,255],i);assert.equal(initSleeves(layers,rig),0);
  const b=fixture();for(let i=0;i<b.layers[0].data.length;i+=4)b.layers[0].data.set([220,80,80,255],i);assert.equal(initSleeves(b.layers,b.rig),0);
});
test('splitting legs remaps existing sleeve settings by source index',()=>{
  const {layers,rig}=fixture();initSleeves(layers,rig);const config=rig.sleeves[1];const legs={name:'legwear',x:50,y:200,width:150,height:80,data:new Uint8ClampedArray(150*80*4).fill(255)};
  layers.unshift(legs);rig.modes.unshift('legs');rig.assignments.unshift('pelvis');rig.sleeves={2:config};const split=splitLegLayers(layers,rig);assert.equal(split.changed,true);const armIndex=split.layers.findIndex(l=>l.name==='handwear-r');assert.deepEqual(rig.sleeves[armIndex],config);
});

test('exported sleeve sprite keeps its arm binding when reimported',()=>{
 const {layers,rig}=fixture();initSleeves(layers,rig);const parts=buildParts(layers,rig),imported=inferRig(parts,300,300),i=parts.findIndex(p=>p.role==='sleeve');assert.equal(imported.assignments[i],'arm_left');assert.equal(imported.modes[i],'sleeve_left');
});
test('shorts follow the thighs: waistband stays on the lower body, each trouser leg moves with its own thigh',()=>{
  const block=(name,x,y,w,h,c)=>{const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++)data.set([...c,255],i*4);return {name,x,y,width:w,height:h,data,visible:true,opacity:1};};
  const layers=[block('topwear',100,40,100,90,[30,100,160]),block('legwear',105,150,90,140,[210,145,100]),block('bottomwear',100,125,100,70,[30,30,80])];
  const rig=inferRig(layers,300,300);Object.assign(rig.points,{body:{x:150,y:125},upper:{x:150,y:121},pelvis:{x:150,y:129},hip_left:{x:128,y:140},knee_left:{x:128,y:210},ankle_left:{x:128,y:280},hip_right:{x:172,y:140},knee_right:{x:172,y:210},ankle_right:{x:172,y:280}});
  assert.equal(rig.modes[2],'bottoms');assert.equal(rig.assignments[2],'pelvis');
  const parts=buildParts(layers,rig),shorts=parts.find(p=>p.source===2),sk=makeSkeleton(parts,rig),m=sk.skins[0].attachments[shorts.slot][shorts.slot];assert.equal(m.type,'mesh');
  const used=new Set();let k=0;while(k<m.vertices.length){const n=m.vertices[k++];assert.ok(n<=2);for(let j=0;j<n;j++){used.add(sk.bones[m.vertices[k]].name);k+=4;}}
  assert.ok(used.has('lower_body')&&used.has('thigh_R')&&used.has('thigh_L'),[...used].join());
  const rest=meshWorldVertices(m,sk,poseMatrices(sk)),lifted=meshWorldVertices(m,sk,poseMatrices(sk,null,{thigh_L:80})),moved=rest.map((p,i)=>Math.hypot(p[0]-lifted[i][0],p[1]-lifted[i][1]));
  const root=rig.points.root,at=(x,y)=>rest.reduce((b,p,i)=>Math.hypot(p[0]-(x-root.x),p[1]-(root.y-y))<Math.hypot(rest[b][0]-(x-root.x),rest[b][1]-(root.y-y))?i:b,0);
  assert.ok(moved[at(195,195)]>30,'lifted trouser hem follows the thigh');assert.ok(moved[at(105,195)]<1,'other trouser leg stays');assert.ok(moved[at(150,125)]<1,'waistband stays');
  rig.limbStyle='cutout';assert.equal(buildParts(layers,rig).find(p=>p.source===2).mode,'bottoms','cutout style keeps garments as meshes');
});
test('shirt bends along the spine: hem stays with the shorts, chest and painted sleeves follow their bones',()=>{
  const block=(name,x,y,w,h,c)=>{const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++)data.set([...c,255],i*4);return {name,x,y,width:w,height:h,data,visible:true,opacity:1};};
  const layers=[block('neck',140,40,20,30,[210,145,100]),block('topwear',80,60,140,90,[30,100,160]),block('bottomwear',100,140,100,50,[30,30,80])];
  const rig=inferRig(layers,300,300);Object.assign(rig.points,{neck:{x:150,y:62},head:{x:150,y:40},chest:{x:150,y:85},body:{x:150,y:140},upper:{x:150,y:136},pelvis:{x:150,y:144},arm_left:{x:100,y:68},elbow_left:{x:80,y:128},arm_right:{x:200,y:68},elbow_right:{x:220,y:128}});
  assert.deepEqual(rig.modes.slice(0,2),['neck','torso']);
  const parts=buildParts(layers,rig),sk=makeSkeleton(parts,rig),root=rig.points.root,mesh=slot=>sk.skins[0].attachments[slot][slot];
  const shirt=mesh(parts.find(p=>p.source===1).slot),rest=meshWorldVertices(shirt,sk,poseMatrices(sk)),bent=meshWorldVertices(shirt,sk,poseMatrices(sk,null,{upper_body:-20}));
  const at=(x,y)=>rest.reduce((b,p,i)=>Math.hypot(p[0]-(x-root.x),p[1]-(root.y-y))<Math.hypot(rest[b][0]-(x-root.x),rest[b][1]-(root.y-y))?i:b,0),moved=i=>Math.hypot(rest[i][0]-bent[i][0],rest[i][1]-bent[i][1]);
  assert.ok(moved(at(220,150))<2,'hem stays with the lower body');assert.ok(moved(at(183,60))>20,'shoulders follow the upper body');
  const mid=moved(at(220,140));assert.ok(mid>.5&&mid<moved(at(183,60)),'waist blends between them');
  const lifted=meshWorldVertices(shirt,sk,poseMatrices(sk,null,{upper_arm_R:60}));assert.ok(Math.hypot(...[0,1].map(k=>rest[at(81,85)][k]-lifted[at(81,85)][k]))>5,'painted sleeve follows the arm');
  assert.ok(Math.hypot(...[0,1].map(k=>rest[at(117,60)][k]-lifted[at(117,60)][k]))<.5,'collar ignores the arm');
  const neck=mesh(parts.find(p=>p.source===0).slot),nr=meshWorldVertices(neck,sk,poseMatrices(sk)),nh=meshWorldVertices(neck,sk,poseMatrices(sk,null,{head:25})),nm=nr.map((p,i)=>Math.hypot(p[0]-nh[i][0],p[1]-nh[i][1]));
  assert.ok(Math.max(...nm)>1&&Math.min(...nm)<.5,'neck top follows the head, its base stays on the chest');
});
