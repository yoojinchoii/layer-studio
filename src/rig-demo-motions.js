import {activeIds,availableChain,independentArm} from './rig-scope.js';

export const animationNames={head_sway:'머리·목 기울이기',face_gaze:'눈동자·시선 이동',face_expression:'눈썹·눈꺼풀·입 점검',upper_sway:'상체 흔들기·호흡',upper_gesture:'양팔·어깨 점검',idle:'대기 (idle)',wave:'손 흔들기 (wave)',cheer:'환호 (cheer)',hop:'가볍게 점프 (hop)'};
export const animationDescriptions={
  head_sway:'머리·목과 머리카락을 천천히 기울여 목 경계와 연결을 확인합니다.',
  face_gaze:'분리된 눈동자를 좌우·위아래로 이동합니다. 눈꺼풀은 조금씩 따라 움직입니다.',
  face_expression:'분리된 눈썹·눈꺼풀·입의 이동과 크기를 점검하고, 가운데에서 한 번 눈을 감았다 뜹니다. 입 안을 생성하는 모션은 아닙니다.',
  upper_sway:'하단을 기준으로 상체·가슴을 흔들고 호흡합니다. 옷과 목의 연결을 확인하세요.',
  upper_gesture:'양쪽 어깨와 팔꿈치를 번갈아 움직입니다. 화면에 있는 관절만 사용합니다.',
  idle:'작은 호흡과 흔들림을 반복하고 한 번 눈을 깜빡입니다.',wave:'손을 흔들어 어깨·팔꿈치·손목의 연결을 확인합니다.',cheer:'양팔을 들어 올리는 동작입니다.',hop:'무릎을 굽혔다가 가볍게 뛰는 동작입니다.'
};
export function availableAnimations(rig){
  const ids=new Set(activeIds(rig)),has=id=>ids.has(id),upper=rig.frame!=='bust',arms=['left','right'].some(s=>has(`arm_${s}`)&&independentArm(rig,s));
  const enabled={head_sway:has('head'),face_gaze:['left','right'].some(s=>has(`face_pupil_${s}`)),face_expression:[...ids].some(id=>/^face_(brow|lid_|mouth)/.test(id)),upper_sway:upper&&has('chest'),upper_gesture:upper&&arms,idle:true,wave:upper&&availableChain(rig,'arm_right'),cheer:upper&&arms,hop:upper&&availableChain(rig,'leg_left')&&availableChain(rig,'leg_right')};
  return Object.keys(animationNames).filter(key=>enabled[key]);
}

// Screen-space translations are converted into each parent's setup axes before baking Spine keys.
// Keep these demonstrations independent of the animator's saved manual pose.
export function demoMotionSpecs(rig,world,amplitude){
  const A=amplitude,face=rig.faceGeometry?.face,fw=face?.width||rig.width*.3,fh=face?.height||rig.height*.3;
  const sin=p=>Math.sin(p*Math.PI*2),pulse=p=>(1-Math.cos(p*Math.PI*2))/2;
  // 눈 깜빡임: at에서 빠르게 감고(0.06) 잠깐 머문 뒤(0.03) 천천히 뜬다(0.08). 위 눈꺼풀이 흰자 높이의 95%만큼 내려온다(layers.js의 눈꺼풀 피부 띠와 맞춘 값).
  const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);},blink=(p,at)=>p<at?ease((p-at+.06)/.06):p<at+.03?1:1-ease((p-at-.03)/.08);
  const move=(id,dx,dy)=>{const a=-(world[rig.parents[id]]?.angle||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [dx*c+dy*s,dx*s-dy*c];};
  const out={
    head_sway:{duration:4,spec:{neck:{rotate:p=>sin(p)*1.5*A},head:{rotate:p=>sin(p)*4*A},hair:{rotate:p=>-sin(p)*1.5*A},face_hair_front:{rotate:p=>-sin(p)*1.5*A},face_hair_back:{rotate:p=>-sin(p)*A}}},
    face_gaze:{duration:4,spec:{}},face_expression:{duration:4,spec:{}},idle_face:{duration:4,spec:{}},
    upper_sway:{duration:4,spec:{upper:{rotate:p=>sin(p)*2.5*A},chest:{rotate:p=>sin(p)*1.5*A,scale:p=>[1,1+pulse(p)*.015*A]},head:{rotate:p=>-sin(p)*2*A},hair:{rotate:p=>-sin(p)*1.5*A}}},
    upper_gesture:{duration:4,spec:{chest:{rotate:p=>sin(p)*1.5*A},head:{rotate:p=>-sin(p)*2*A}}}
  };
  for(const side of ['left','right']){
    const eye=rig.faceGeometry?.eyes?.[side],w=eye?.width||fw*.18,h=eye?.height||fh*.08,pupil=`face_pupil_${side}`,brow=`face_brow_${side}`;
    out.face_gaze.spec[pupil]={translate:p=>move(pupil,sin(p)*w*.07*A,sin(p*2)*h*.08*A)};
    for(const vertical of ['upper','lower']){
      const id=`face_lid_${vertical}_${side}`;
      out.face_gaze.spec[id]={translate:p=>move(id,sin(p)*w*.07*A*.45,sin(p*2)*h*.08*A*.55)};
      out.face_expression.spec[id]={translate:p=>move(id,0,vertical==='upper'?Math.max(pulse(p)*h*.16*A,blink(p,.5)*h*.95):-pulse(p)*h*.08*A)};
      out.idle_face.spec[id]={translate:p=>move(id,0,blink(p,.82)*h*(vertical==='upper'?.95:-.1))};
    }
    out.face_expression.spec[brow]={translate:p=>move(brow,0,-sin(p)*fh*.012*A)};
    const direction=side==='left'?-1:1,lift=p=>pulse(p)*(side==='left'?(1+sin(p))/2:(1-sin(p))/2);
    out.upper_gesture.spec[`arm_${side}`]={rotate:p=>direction*lift(p)*22*A};
    out.upper_gesture.spec[`elbow_${side}`]={rotate:p=>direction*lift(p)*16*A};
    out.upper_gesture.spec[`wrist_${side}`]={rotate:p=>-direction*lift(p)*6*A};
  }
  out.face_expression.spec.face_mouth={scale:p=>[1+pulse(p)*.06*A,1+pulse(p)*.16*A],translate:p=>move('face_mouth',0,sin(p)*fh*.004*A)};
  out.face_expression.spec.face_jaw={translate:p=>move('face_jaw',0,pulse(p)*fh*.006*A)};
  return out;
}
