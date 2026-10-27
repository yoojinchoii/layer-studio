import {poseMatrices,meshWorldVertices} from './rig-core.js';
export function auditRig(parts,rig,sk){
  const issues=[],seen=new Set(),add=(part,message)=>{const key=part+'|'+message;if(!seen.has(key)){seen.add(key);issues.push({part,message});}};
  const rest=poseMatrices(sk),poseIds=sk.bones.map(b=>b.name).filter(n=>/^(upper_arm|forearm|shin)_[RL]$/.test(n));
  const poses=poseIds.flatMap(id=>[-60,60].map(angle=>poseMatrices(sk,null,{[id]:angle})));
  const area=(v,t,k)=>{const [a,b,c]=t.slice(k,k+3).map(i=>v[i]);return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);};
  for(const p of parts){if(p.visible===false)continue;
    if(p.data&&!p.data.some((v,i)=>i%4===3&&v>8)){add(p.name,'보이는 픽셀이 없는 빈 파츠');continue;}
    if(/topwear|sleeve|상의|소매/i.test(p.name)&&/arm|elbow|wrist/.test(p.bone))add(p.name,'의상이 팔 본에 연결되어 함께 움직입니다.');
    const a=sk.skins[0].attachments[p.slot]?.[p.slot];if(a?.type!=='mesh')continue;
    let invalid=false,cursor=0;for(let v=0;v<a.uvs.length/2;v++){let sum=0;const n=a.vertices[cursor++];for(let j=0;j<n;j++){const bi=a.vertices[cursor];if(!sk.bones[bi]){invalid=true;add(p.name,'존재하지 않는 본 연결');}sum+=a.vertices[cursor+3];cursor+=4;}if(!Number.isFinite(sum)||Math.abs(sum-1)>.001)add(p.name,'정점의 가중치 합이 100%가 아닙니다.');}
    if(invalid)continue;
    const v0=meshWorldVertices(a,sk,rest);
    for(const pose of poses){const v1=meshWorldVertices(a,sk,pose);let unstable=0,painted=0;
      for(let k=0;k<a.triangles.length;k+=3){const ids=a.triangles.slice(k,k+3);const u=ids.reduce((s,i)=>s+a.uvs[i*2],0)/3,w=ids.reduce((s,i)=>s+a.uvs[i*2+1],0)/3;
        if(p.data?.[(Math.min(p.height-1,Math.floor(w*p.height))*p.width+Math.min(p.width-1,Math.floor(u*p.width)))*4+3]<32)continue;
        const base=area(v0,a.triangles,k);if(Math.abs(base)<.1)continue;painted++;const ratio=area(v1,a.triangles,k)/base;if(!Number.isFinite(ratio)||ratio<.05||ratio>6)unstable++;}
      if(unstable&&unstable/Math.max(1,painted)>.08){add(p.name,'±60° 굽힘 시험에서 메쉬가 뒤집히거나 심하게 눌립니다. 관절 위치·부드러움을 확인하세요.');break;}
    }
  }
  for(const [i,cfg]of Object.entries(rig.sleeves||{}))if(cfg.enabled&&parts.some(p=>p.source===Number(i)&&p.role==='skin'))add(parts.find(p=>p.source===Number(i)&&p.role==='skin').name,'소매 안쪽 피부는 추정한 그림입니다. 팔을 크게 들 때 모양을 확인하세요.');
  return {issues,poses:poses.length,parts:parts.length};
}
