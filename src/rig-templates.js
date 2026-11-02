import {restoreArmChains} from './arm-separation.js';
import {configureFace,extendHalfFace} from './face-rig.js';
import {inferRig,refineRig,boneOrder,boneLabels} from './rig-core.js';
import {activeIds,chainDefs,availableChain,validateControls} from './rig-scope.js';
export const templateKinds={full:'전신',half:'반신',bust:'흉상 · 얼굴 전용'};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),copy=v=>JSON.parse(JSON.stringify(v));
const key=name=>name.trim().toLowerCase().replace(/[ _-]+/g,'_');
function bounds(layers,width,height){const list=layers.filter(l=>l.visible!==false);if(!list.length)return {x:0,y:0,width,height};const x=Math.min(...list.map(l=>l.x)),y=Math.min(...list.map(l=>l.y));return {x,y,width:Math.max(1,Math.max(...list.map(l=>l.x+l.width))-x),height:Math.max(1,Math.max(...list.map(l=>l.y+l.height))-y)};}
function parts(layers,rig){const seen=new Map();return layers.map((l,i)=>{const role=`${rig.assignments[i]}:${rig.modes[i]}`,ordinal=seen.get(role)||0;seen.set(role,ordinal+1);return {name:key(l.name),role,ordinal,rect:{x:l.x,y:l.y,width:l.width,height:l.height}};});}
function fitPartial(rig,layers,kind){
  if(kind==='full')return;
  const box=bounds(layers,rig.width,rig.height),shirt=layers.find(l=>/^(topwear|상의)/i.test(l.name)),face=layers.find(l=>/^(face|얼굴)$/i.test(l.name)),neck=layers.find(l=>/^(neck|목)$/i.test(l.name)),P=rig.points;
  const bottom=shirt?shirt.y+shirt.height:box.y+box.height,cx=face?face.x+face.width/2:shirt?shirt.x+shirt.width/2:box.x+box.width/2;
  P.body={x:cx,y:bottom-1};P.pelvis={x:cx,y:bottom-1};P.upper={x:cx,y:bottom-Math.max(2,(shirt?.height||box.height)*.12)};
  P.chest={x:cx,y:shirt?shirt.y+shirt.height*.32:box.y+box.height*.8};
  if(neck)P.neck={x:neck.x+neck.width/2,y:neck.y+neck.height*.9};
  if(face){P.head={x:face.x+face.width/2,y:face.y+face.height*.9};P.hair={x:face.x+face.width/2,y:face.y+face.height*.15};}
  // A bust has shoulder handles, but no fabricated elbows, wrists or legs.
  if(kind==='bust'&&shirt)for(const side of ['left','right'])P[`arm_${side}`]={x:shirt.x+shirt.width*(side==='left'?.16:.84),y:shirt.y+shirt.height*.25};
}
function scopedBones(rig,layers,kind){
  if(kind==='full')return Object.keys(rig.points);
  const active=new Set(['root','body','upper','pelvis','chest','neck','head','hair','arm_left','arm_right']);
  if(kind==='half')for(const side of ['left','right']){
    const matching=layers.filter((l,i)=>rig.assignments[i]===`arm_${side}`||rig.modes[i]===`arm_${side}`||rig.assignments[i]===`elbow_${side}`||rig.assignments[i]===`wrist_${side}`);
    if(!matching.length)continue;
    const box=bounds(matching,rig.width,rig.height),torso=layers.find(l=>/^(topwear|상의)/i.test(l.name));
    if(box.height>Math.max(8,(torso?.height||rig.height)*.25))active.add(`elbow_${side}`);
    const cut=box.y+box.height>=rig.height-3;
    if(active.has(`elbow_${side}`)&&(!cut||matching.some(l=>/^(hand|손)[_-]/i.test(l.name))))active.add(`wrist_${side}`);
  }
  return [...active];
}
export function applyBuiltin(kind,layers,width,height){
  if(!templateKinds[kind])throw Error('템플릿 종류를 확인해주세요.');
  const rig=inferRig(layers,width,height);fitPartial(rig,layers,kind);refineRig(rig,layers);
  if(kind==='bust')fitPartial(rig,layers,kind);
  rig.frame=kind;rig.activeBones=scopedBones(rig,layers,kind);if(kind==='bust')configureFace(rig,layers);rig.pose={};rig.ikModes=Object.fromEntries(Object.keys(chainDefs).filter(key=>availableChain(rig,key)).map(key=>[key,'fk']));rig.ikTargets={};rig.ikBends={};
  extendHalfFace(rig,layers);restoreArmChains(rig,layers);
  // No remote AI or old mesh transfer: every derived mesh uses the destination pixels.
  return {rig,matched:layers.length,unmatched:[]};
}
export function createRigTemplate(rig,layers,name){
  name=name.trim();if(!name||name.length>80)throw Error('템플릿 이름을 1~80자로 입력해주세요.');
  const defaults=inferRig(layers,rig.width,rig.height),descriptors=parts(layers,defaults),box=bounds(layers,rig.width,rig.height),joints={};
  for(const id of activeIds(rig)){
    let i=rig.assignments.findIndex(b=>b===id);
    if(i<0){const chain=Object.values(chainDefs).find(ids=>ids.includes(id));if(chain)i=rig.assignments.findIndex(b=>chain.includes(b));}
    if(i<0&&['body','upper','pelvis','chest'].includes(id))i=layers.findIndex(l=>/^(topwear|상의)/i.test(l.name));
    if(i<0&&id==='hair')i=layers.findIndex(l=>/hair|머리카락/i.test(l.name));
    const rect=i<0?box:descriptors[i].rect,p=rig.points[id];
    joints[id]={parent:rig.parents[id]||null,label:rig.labels[id]||id,x:(p.x-rect.x)/rect.width,y:(p.y-rect.y)/rect.height,gx:(p.x-box.x)/box.width,gy:(p.y-box.y)/box.height,anchor:i<0?null:descriptors[i]};
  }
  const result={format:'layer-studio-template-v1',name,frame:rig.frame||'full',joints,
    rules:descriptors.map((anchor,i)=>({anchor,bone:rig.assignments[i],mode:rig.modes[i],allowed:rig.partBones?.[i]||null})),
    weightBlend:copy(rig.weightBlend||{}),meshDensity:rig.meshDensity||'balanced',limbStyle:rig.limbStyle||'mesh',ikModes:copy(rig.ikModes||{})};
  validateTemplate(result);return result;
}
const modes=['split_arms','crossed_arms','face','rigid','torso','neck','bottoms','sleeve_left','sleeve_right','arm_left','arm_right','legs','feet','leg_left','leg_right','foot_left','foot_right'];
export function validateTemplate(t){
  const record=v=>v&&typeof v==='object'&&!Array.isArray(v),num=v=>Number.isFinite(v)&&Math.abs(v)<=100;
  if(!record(t)||t.format!=='layer-studio-template-v1'||typeof t.name!=='string'||!t.name.trim()||t.name.length>80||!templateKinds[t.frame]||!record(t.joints)||!Array.isArray(t.rules)||t.rules.length>100)throw Error('올바른 리깅 템플릿 파일이 아닙니다.');
  const ids=Object.keys(t.joints);if(ids.length>64||!ids.includes('root')||!ids.includes('body'))throw Error('템플릿의 기본 뼈대를 확인해주세요.');
  const known=id=>Object.hasOwn(boneLabels,id)||/^joint_\d+$/.test(id);
  const anchor=a=>a===null||record(a)&&typeof a.name==='string'&&a.name.length<=200&&typeof a.role==='string'&&a.role.length<=100&&Number.isInteger(a.ordinal)&&a.ordinal>=0&&a.ordinal<100;
  for(const [id,p]of Object.entries(t.joints))if(!known(id)||!record(p)||![p.x,p.y,p.gx,p.gy].every(num)||typeof p.label!=='string'||p.label.length>80||!anchor(p.anchor)||(id==='root'?p.parent!==null:!ids.includes(p.parent)))throw Error('템플릿 관절 정보가 올바르지 않습니다.');
  boneOrder({points:t.joints,parents:Object.fromEntries(ids.filter(id=>id!=='root').map(id=>[id,t.joints[id].parent]))});
  for(const r of t.rules)if(!record(r)||!anchor(r.anchor)||r.anchor===null||!known(r.bone)||!modes.includes(r.mode)||r.allowed!==null&&(!Array.isArray(r.allowed)||!r.allowed.length||r.allowed.length>64||r.allowed.some(id=>!known(id))))throw Error('템플릿 파츠 연결을 확인해주세요.');
  if(!['simple','balanced','fine'].includes(t.meshDensity)||!['mesh','cutout'].includes(t.limbStyle)||!record(t.weightBlend)||Object.entries(t.weightBlend).some(([id,v])=>!known(id)||!Number.isFinite(v)||v<.35||v>2))throw Error('템플릿 가중치 설정을 확인해주세요.');
  validateControls({points:t.joints,parents:{},ikModes:t.ikModes});return t;
}
export function applyRigTemplate(template,layers,width,height){
  const t=validateTemplate(template),{rig}=applyBuiltin(t.frame,layers,width,height),defaults=inferRig(layers,width,height),descriptors=parts(layers,defaults),box=bounds(layers,width,height),unmatched=[];
  const match=a=>a?descriptors.findIndex(d=>d.name===a.name&&d.ordinal===a.ordinal):-1;
  const find=a=>{const exact=match(a);return exact>=0?exact:a?descriptors.findIndex(d=>d.role===a.role&&d.ordinal===a.ordinal):-1;};
  for(const [id,p]of Object.entries(t.joints)){
    const index=find(p.anchor),rect=index<0?box:descriptors[index].rect;
    if(p.anchor&&index<0)unmatched.push(p.label);
    rig.points[id]={x:clamp(rect.x+(index<0?p.gx:p.x)*rect.width,0,width),y:clamp(rect.y+(index<0?p.gy:p.y)*rect.height,0,height)};
    if(p.parent)rig.parents[id]=p.parent;rig.labels[id]=p.label;
  }
  rig.points.root={x:width/2,y:height};rig.activeBones=Object.keys(t.joints);rig.partBones={};let matched=0;
  // Match rules by destination identity, never by the source array index.
  const used=new Set();for(const r of t.rules){const i=find(r.anchor);if(i<0||used.has(i)){unmatched.push(r.anchor.name);continue;}used.add(i);matched++;
    if(rig.points[r.bone])rig.assignments[i]=r.bone;rig.modes[i]=r.mode;if(r.allowed)rig.partBones[i]=r.allowed.filter(id=>rig.points[id]);if(!rig.partBones[i]?.length)delete rig.partBones[i];
  }
  rig.weightBlend=copy(t.weightBlend);rig.meshDensity=t.meshDensity;rig.limbStyle=t.limbStyle;rig.ikModes=Object.fromEntries(Object.keys(chainDefs).filter(key=>availableChain(rig,key)).map(key=>[key,'fk']));
  for(const [key,mode]of Object.entries(t.ikModes||{}))if(availableChain(rig,key))rig.ikModes[key]=mode;
  if(t.frame==='half'&&!Object.keys(t.joints).some(id=>id.startsWith('face_'))){delete rig.faceRig;extendHalfFace(rig,layers);}
  restoreArmChains(rig,layers);boneOrder(rig);validateControls(rig);return {rig,matched,unmatched:[...new Set(unmatched)]};
}
export const templateStorageKey='layer-studio-rig-templates-v1';
export function readTemplates(storage){try{const list=JSON.parse(storage.getItem(templateStorageKey)||'[]');return Array.isArray(list)?list.slice(0,20).filter(t=>{try{validateTemplate(t);return true;}catch{return false;}}):[];}catch{return [];}}
export function saveTemplate(storage,template){validateTemplate(template);const list=readTemplates(storage).filter(t=>t.name!==template.name);if(list.length>=20)throw Error('내 템플릿은 최대 20개예요. 사용하지 않는 템플릿을 삭제해주세요.');list.push(template);storage.setItem(templateStorageKey,JSON.stringify(list));return list;}
