// Inspect the exact canvases exported to PSD; no re-segmentation or GPU request.
export function installPartInspector({state,select}){
  const dialog=document.createElement('dialog');dialog.className='part-inspector';
  dialog.setAttribute('aria-label','실제 파츠 그림 확인');
  const heading=document.createElement('div');heading.className='dialog-heading';
  const title=document.createElement('h2');title.textContent='파츠 펼쳐보기';
  const close=document.createElement('button');close.className='button outlined';close.textContent='닫기';close.onclick=()=>dialog.close();
  heading.append(title,close);
  const note=document.createElement('p');note.className='field-note';note.textContent='PSD에 저장되는 실제 그림입니다. 합성에 가려진 구멍·손 자국·옷 잔여물도 여기서 확인할 수 있어요. 확대 보기에는 AI 사용량이 들지 않습니다.';
  const layout=document.createElement('div');layout.className='part-inspector-layout';
  const list=document.createElement('div');list.className='part-inspector-list';list.setAttribute('aria-label','파츠 목록');
  const detail=document.createElement('section');detail.className='part-inspector-detail';
  const name=document.createElement('h3');const info=document.createElement('p');info.className='field-note';
  const image=document.createElement('img');image.className='part-inspector-image';
  const backgrounds=document.createElement('div');backgrounds.className='layer-actions';
  for(const [label,bg] of [['격자','checker'],['밝은 배경','light'],['어두운 배경','dark']]){
    const b=document.createElement('button');b.className='button outlined';b.textContent=label;b.onclick=()=>image.dataset.background=bg;backgrounds.append(b);
  }
  detail.append(name,info,image,backgrounds);layout.append(list,detail);dialog.append(heading,note,layout);document.body.append(dialog);
  function show(layer){
    select(layer.id);name.textContent=layer.name;image.src=layer.canvas.toDataURL('image/png');image.alt=layer.name+' 독립 파츠';
    const a=layer.art;info.textContent=`${layer.canvas.width} × ${layer.canvas.height}px · 위치 ${layer.x}, ${layer.y}${a?` · ${a.role} / ${a.side}`:''}`;
    for(const b of list.children)b.setAttribute('aria-pressed',String(b.dataset.id===layer.id));
  }
  return {open(){
    if(!state.layers.length)return;
    list.replaceChildren();
    for(const layer of state.layers){
      const b=document.createElement('button');b.className='part-inspector-item';b.dataset.id=layer.id;
      const thumb=document.createElement('img');thumb.src=layer.canvas.toDataURL('image/png');thumb.alt='';
      const label=document.createElement('span');label.textContent=layer.name;b.append(thumb,label);b.onclick=()=>show(layer);list.append(b);
    }
    show(state.layers.find(l=>l.id===state.selected)||state.layers[0]);dialog.showModal();
  }};
}
