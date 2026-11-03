// A saved workspace can be reopened before rigging, including review candidates.
export function validateWorkspace(saved){
  const size=n=>Number.isInteger(n)&&n>0&&n<=8192;
  if(saved?.format!=='layer-studio-workspace-v1'||!size(saved.width)||!size(saved.height)||saved.width*saved.height>16_000_000||!Array.isArray(saved.layers)||!saved.layers.length||saved.layers.length>100)throw Error('올바른 편집 프로젝트가 아닙니다.');
  const image=v=>typeof v==='string'&&v.startsWith('data:image/png;base64,')&&v.length<=40_000_000;
  if(!image(saved.original)||saved.reference&&!image(saved.reference))throw Error('프로젝트의 원본 이미지가 올바르지 않습니다.');
  let pixels=0;
  for(const l of saved.layers){
    if(!l||typeof l.name!=='string'||l.name.length>200||!size(l.width)||!size(l.height)||!image(l.image)||![l.x,l.y].every(n=>Number.isInteger(n)&&Math.abs(n)<=8192)||!Number.isFinite(l.opacity)||l.opacity<0||l.opacity>1||typeof l.visible!=='boolean')throw Error('저장한 파츠의 위치·이미지 정보가 올바르지 않습니다.');
    pixels+=l.width*l.height;
  }
  if(pixels>40_000_000)throw Error('프로젝트의 전체 이미지 용량이 너무 큽니다.');
  return saved;
}
