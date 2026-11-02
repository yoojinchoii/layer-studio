export const chainDefs={arm_left:['arm_left','elbow_left','wrist_left'],arm_right:['arm_right','elbow_right','wrist_right'],leg_left:['hip_left','knee_left','ankle_left'],leg_right:['hip_right','knee_right','ankle_right']};
export const chainLabels={arm_left:'오른팔 · 화면 왼쪽',arm_right:'왼팔 · 화면 오른쪽',leg_left:'오른다리 · 화면 왼쪽',leg_right:'왼다리 · 화면 오른쪽'};
export const activeIds=rig=>Object.keys(rig.points).filter(id=>!rig.activeBones||rig.activeBones.includes(id));
export function activeBone(rig,id){const active=new Set(activeIds(rig));for(let i=0;i<64;i++){if(active.has(id))return id;id=rig.parents[id];if(!id)break;}return 'root';}
export function availableChain(rig,key){const ids=chainDefs[key],active=new Set(activeIds(rig));return !!ids&&ids.every(id=>active.has(id))&&rig.parents[ids[1]]===ids[0]&&rig.parents[ids[2]]===ids[1]&&ids.slice(1).every((id,i)=>Math.hypot(rig.points[id].x-rig.points[ids[i]].x,rig.points[id].y-rig.points[ids[i]].y)>.01);}
export const chainFor=id=>Object.keys(chainDefs).find(key=>chainDefs[key].includes(id));
export function validateControls(rig){
  const names=Object.keys(rig.points),validKeys=Object.keys(chainDefs),record=v=>v&&typeof v==='object'&&!Array.isArray(v);
  if(rig.activeBones!==undefined&&(!Array.isArray(rig.activeBones)||!rig.activeBones.includes('root')||!rig.activeBones.includes('body')||new Set(rig.activeBones).size!==rig.activeBones.length||rig.activeBones.some(id=>!names.includes(id)||id!=='root'&&!rig.activeBones.includes(rig.parents[id]))))throw Error('템플릿의 관절 범위가 올바르지 않습니다.');
  if(rig.poseOffsets!==undefined&&(!record(rig.poseOffsets)||Object.entries(rig.poseOffsets).some(([id,p])=>!names.includes(id)||!record(p)||![p.x,p.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=32768))))throw Error('얼굴 포즈 이동 값을 확인해주세요.');
  for(const key of ['ikModes','ikTargets','ikBends'])if(rig[key]!==undefined&&(!record(rig[key])||Object.keys(rig[key]).some(k=>!validKeys.includes(k))))throw Error('IK 설정이 올바르지 않습니다.');
  for(const mode of Object.values(rig.ikModes||{}))if(!['ik','fk'].includes(mode))throw Error('IK/FK 방식을 확인해주세요.');
  for(const p of Object.values(rig.ikTargets||{}))if(!record(p)||![p.x,p.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=32768))throw Error('IK 목표 좌표를 확인해주세요.');
  for(const b of Object.values(rig.ikBends||{}))if(b!==1&&b!==-1)throw Error('IK 굽힘 방향을 확인해주세요.');
}
