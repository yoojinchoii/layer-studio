import {activeIds,availableChain,independentArm} from './rig-scope.js';

export const animationNames={head_sway:'머리·목 기울이기',face_turn:'고개 좌우로 돌리기 (3D)',face_gaze:'눈동자·시선 이동',face_expression:'눈썹·눈꺼풀·입 점검',upper_sway:'상체 흔들기·호흡',upper_gesture:'양팔·어깨 점검',idle:'대기 (idle)',wave:'손 흔들기 (wave)',cheer:'환호 (cheer)',hop:'가볍게 점프 (hop)'};
export const animationDescriptions={
  head_sway:'머리·목과 머리카락을 천천히 기울여 목 경계와 연결을 확인합니다.',
  face_gaze:'분리된 눈동자를 좌우·위아래로 이동합니다. 눈꺼풀은 조금씩 따라 움직입니다.',
  face_expression:'분리된 눈썹·눈꺼풀·입의 이동과 크기를 점검하고, 가운데에서 한 번 눈을 감았다 뜹니다. 입 안을 생성하는 모션은 아닙니다.',
  upper_sway:'하단을 기준으로 상체·가슴을 흔들고 호흡합니다. 옷과 목의 연결을 확인하세요.',
  upper_gesture:'양쪽 어깨와 팔꿈치를 번갈아 움직입니다. 화면에 있는 관절만 사용합니다.',
  face_turn:'얼굴 돌리기 조종 뼈를 좌우로 옮깁니다. 코·입·눈·볼이 서로 다른 비율로 따라와 고개를 돌린 듯 보입니다(Spine transform 제약).',
  idle:'4초 동안 한 번 숨 쉬며 상체·목·머리가 차례로 따라오고, 한 번 옆을 보고 한 번 깜빡입니다. 머리 가닥·치마는 늦게 따라 흔들립니다.',wave:'손을 흔들어 어깨·팔꿈치·손목의 연결을 확인합니다.',cheer:'양팔을 들어 올리는 동작입니다.',hop:'무릎을 굽혔다가 가볍게 뛰는 동작입니다.'
};
export function availableAnimations(rig){
  const ids=new Set(activeIds(rig)),has=id=>ids.has(id),upper=rig.frame!=='bust',arms=['left','right'].some(s=>has(`arm_${s}`)&&independentArm(rig,s));
  const enabled={head_sway:has('head'),face_turn:has('face_turn')&&['face_mouth','face_eye_left','face_eye_right'].some(has),face_gaze:['left','right'].some(s=>has(`face_pupil_${s}`)),face_expression:[...ids].some(id=>/^face_(brow|lid_|mouth)/.test(id)),upper_sway:upper&&has('chest'),upper_gesture:upper&&arms,idle:true,wave:upper&&(availableChain(rig,'arm_right')||availableChain(rig,'arm_left')),cheer:upper&&arms,hop:upper&&availableChain(rig,'leg_left')&&availableChain(rig,'leg_right')};
  return Object.keys(animationNames).filter(key=>enabled[key]);
}

// Screen-space translations are converted into each parent's setup axes before baking Spine keys.
// Keep these demonstrations independent of the animator's saved manual pose.
export function demoMotionSpecs(rig,world,amplitude){
  const A=amplitude,TURN=.07,face=rig.faceGeometry?.face,fw=face?.width||rig.width*.3,fh=face?.height||rig.height*.3;
  const sin=p=>Math.sin(p*Math.PI*2),pulse=p=>(1-Math.cos(p*Math.PI*2))/2;
  // 눈 깜빡임: at에서 빠르게 감고(0.06) 잠깐 머문 뒤(0.03) 천천히 뜬다(0.08). 위 눈꺼풀이 흰자 높이의 95%만큼 내려온다(layers.js의 눈꺼풀 피부 띠와 맞춘 값).
  const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);},blink=(p,at)=>p<at?ease((p-at+.06)/.06):p<at+.03?1:1-ease((p-at-.03)/.08);
  // 대기 중 한 번 옆을 본다(p .45~.7): 눈동자가 먼저, 얼굴이 조금 늦게.
  const look=p=>ease((p-.45)/.06)*(1-ease((p-.64)/.08));
  const move=(id,dx,dy)=>{const a=-(world[rig.parents[id]]?.angle||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [dx*c+dy*s,dx*s-dy*c];};
  const out={
    // 머리카락은 머리와 같이 돌고 끝(가닥 체인)만 늦게 흔들린다: 앞머리 조종 뼈를 돌리면 피벗(머리카락 아래쪽)에서 먼 얼굴 옆 머리가 밀려 볼 윤곽이 드러난다.
    head_sway:{duration:4,spec:{neck:{rotate:p=>sin(p)*1.5*A},head:{rotate:p=>sin(p)*4*A}}},
    face_gaze:{duration:4,spec:{}},face_expression:{duration:4,spec:{}},idle_face:{duration:4,spec:{}},
    // 고개 돌리기: 조종 뼈가 얼굴 폭의 7%만큼 좌우로(레퍼 값: 눈·입 0.8 비율로 따라옴), 반 박자에 살짝 끄덕임. 머리는 살짝 기울어진다.
    face_turn:{duration:4,spec:{face_turn:{translate:p=>move('face_turn',sin(p)*fw*TURN*A,-Math.sin(p*Math.PI*4)*fh*.012*A)},head:{rotate:p=>-sin(p)*1.2*A}}},
    upper_sway:{duration:4,spec:{upper:{rotate:p=>sin(p)*2.5*A},chest:{rotate:p=>sin(p)*1.5*A,scale:p=>[1,1+pulse(p)*.015*A]},head:{rotate:p=>-sin(p)*2*A},hair:{rotate:p=>-sin(p)*1.5*A}}},
    upper_gesture:{duration:4,spec:{chest:{rotate:p=>sin(p)*1.5*A},head:{rotate:p=>-sin(p)*2*A}}}
  };
  for(const side of ['left','right']){
    const eye=rig.faceGeometry?.eyes?.[side],w=eye?.width||fw*.18,h=eye?.height||fh*.08,pupil=`face_pupil_${side}`,brow=`face_brow_${side}`;
    // 감을 때 위 속눈썹이 내려오는 거리: 위 속눈썹 아래끝 → 아래 속눈썹 위끝(재 둔 값), 없으면 흰자 높이의 95%.
    // flare 눈꺼풀 그림(얼굴 뒤)은 얼굴 눈 구멍 높이만큼 같은 박자로 내려와 구멍을 덮는다.
    const H=rig.faceGeometry?.lidDrop?.[side],measured=rig.faceGeometry?.lashDrop?.[side];
    // 속눈썹은 face-rig가 잰 거리(위 속눈썹 아래끝 → 얼굴 눈 구멍 아래끝, 눈꺼풀 높이의 30~90%)만큼. 없으면 흰자 높이의 95%
    const drop=measured??(H?H*.6:h*.95),cover=`face_lid_cover_${side}`,coverK=(H??drop)/drop;
    out.face_gaze.spec[pupil]={translate:p=>move(pupil,sin(p)*w*.07*A,sin(p*2)*h*.08*A)};
    // 고개 돌리기는 눈 전체가 0.8로 따라가므로 눈동자만 따로 앞서 가지 않는다: 완성한 눈동자·흰자 그림의 작은 흠이 눈 구멍 사이로 어긋나 보인다.
    out.idle_face.spec[pupil]={translate:p=>move(pupil,look(p)*w*.05*A,0)};
    for(const vertical of ['upper','lower']){
      const id=`face_lid_${vertical}_${side}`;
      out.face_gaze.spec[id]={translate:p=>move(id,sin(p)*w*.07*A*.45,sin(p*2)*h*.08*A*.55)};
      out.face_expression.spec[id]={translate:p=>move(id,0,vertical==='upper'?Math.max(pulse(p)*h*.16*A,blink(p,.5)*drop):-pulse(p)*h*.08*A)};
      out.idle_face.spec[id]={translate:p=>move(id,look(p)*w*.05*A*.45,blink(p,.78)*(vertical==='upper'?drop:-h*.1))};
    }
    if(rig.activeBones?.includes(cover)){
      out.face_gaze.spec[cover]={translate:p=>move(cover,sin(p)*w*.07*A*.45,sin(p*2)*h*.08*A*.55*coverK)};
      out.face_expression.spec[cover]={translate:p=>move(cover,0,Math.max(pulse(p)*h*.16*A,blink(p,.5)*drop)*coverK)};
      out.idle_face.spec[cover]={translate:p=>move(cover,look(p)*w*.05*A*.45,blink(p,.78)*drop*coverK)};
    }
    out.face_expression.spec[brow]={translate:p=>move(brow,0,-sin(p)*fh*.012*A)};
    out.idle_face.spec[brow]={translate:p=>move(brow,0,-look(p)*fh*.01*A)};
    const direction=side==='left'?-1:1,lift=p=>pulse(p)*(side==='left'?(1+sin(p))/2:(1-sin(p))/2);
    out.upper_gesture.spec[`arm_${side}`]={rotate:p=>direction*lift(p)*22*A};
    out.upper_gesture.spec[`elbow_${side}`]={rotate:p=>direction*lift(p)*16*A};
    out.upper_gesture.spec[`wrist_${side}`]={rotate:p=>-direction*lift(p)*6*A};
  }
  out.idle_face.spec.face_turn={translate:p=>move('face_turn',(look(Math.max(0,p-.02))*.45+sin(p+.1)*.12)*fw*TURN*A,(1-Math.cos(p*Math.PI*2))*fh*.008*A)};
  out.face_expression.spec.face_mouth={scale:p=>[1+pulse(p)*.06*A,1+pulse(p)*.16*A],translate:p=>move('face_mouth',0,sin(p)*fh*.004*A)};
  out.face_expression.spec.face_jaw={translate:p=>move('face_jaw',0,pulse(p)*fh*.006*A)};
  return out;
}
