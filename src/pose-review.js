import {mergedArmRoots,isHeadAccessory} from './part-identity.js';
import {detectFrame} from './face-rig.js';
export function reviewPose(rig,layers){
  const issues=[];
  layers.forEach((l,i)=>{
    const roots=mergedArmRoots(l,layers);
    if(roots)issues.push({kind:'merged',index:i,name:l.name,roots,fixed:['crossed_arms','split_arms'].includes(rig.modes[i]),message:rig.modes[i]==='split_arms'?`양팔 분리 초안 · 손 소속 ${Object.keys(rig.armSplits?.[i]?.hands||{}).length}/2 지정. 손이 반대 팔에 붙으면 손 테두리 지정으로 바로잡아주세요. 가려진 그림은 별도 복원이 필요합니다.`:rig.modes[i]==='crossed_arms'?'겹친 양팔을 가슴에 고정했습니다. 개별 팔 동작에는 좌우 파츠 분리와 가려진 그림 복원이 필요합니다.':'양팔이 한 파츠에 합쳐진 것으로 보입니다. 한쪽 팔로 휘게 하면 반대쪽 어깨도 끌려갑니다.'});
    if(isHeadAccessory(l.name)&&['root','chest','body'].includes(rig.assignments[i]))issues.push({kind:'headwear',index:i,name:l.name,message:'머리장식이 머리에 연결되어 있지 않습니다.'});
  });
  if(rig.frame!=='full'&&detectFrame(layers,rig.width,rig.height)==='full')issues.push({kind:'frame',name:'리깅 구도',message:'다리·신발 파츠가 있지만 전신 관절이 꺼져 있습니다. 전신으로 전환해도 얼굴 리깅은 유지됩니다.'});
  return issues;
}
// Explicit repair for saved projects. Never re-estimate unrelated joints or edit pixels.
export function repairPoseBindings(rig,layers){
  const issues=reviewPose(rig,layers);let changed=0;
  for(const issue of issues){const i=issue.index;if(issue.kind==='headwear'){rig.assignments[i]='head';rig.modes[i]='rigid';rig.partBones??={};rig.partBones[i]=['head'];changed++;}
    if(issue.kind==='merged'&&!issue.fixed){rig.assignments[i]='chest';rig.modes[i]='crossed_arms';rig.partBones??={};rig.partBones[i]=['chest'];if(rig.sleeves)delete rig.sleeves[i];changed++;}}
  return changed;
}
export function enableFullBody(rig){
  rig.frame='full';const active=new Set(rig.activeBones||Object.keys(rig.points));
  for(const id of ['pelvis','hip_left','hip_right','knee_left','knee_right','ankle_left','ankle_right']){let p=id;while(p&&rig.points[p]){active.add(p);p=rig.parents[p];}}
  rig.activeBones=[...active];return rig;
}
