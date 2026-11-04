// Artwork transforms are independent of pose transforms. They bake into the
// sprite in setup coordinates, so PSD and Spine receive the same edited pixels.
export function artworkGeometry(layer, edit){
  const scale=Number(edit.scale),angle=Number(edit.angle),dx=Number(edit.dx),dy=Number(edit.dy);
  if(![scale,angle,dx,dy].every(Number.isFinite)||scale<.1||scale>4||Math.abs(angle)>180||Math.abs(dx)>8192||Math.abs(dy)>8192)throw Error('위치·크기·각도 범위를 확인해주세요.');
  const w=layer.canvas?.width??layer.width,h=layer.canvas?.height??layer.height,a=angle*Math.PI/180;
  const width=Math.max(1,Math.ceil(Math.abs(w*scale*Math.cos(a))+Math.abs(h*scale*Math.sin(a))));
  const height=Math.max(1,Math.ceil(Math.abs(w*scale*Math.sin(a))+Math.abs(h*scale*Math.cos(a))));
  if(width>8192||height>8192||width*height>16_000_000)throw Error('변환한 파츠가 너무 큽니다. 크기를 줄여주세요.');
  return {width,height,x:Math.round(layer.x+w/2+dx-width/2),y:Math.round(layer.y+h/2+dy-height/2),scale,angle:a};
}
export function artworkChanged(previous,next){
  return previous.length!==next.length||previous.some((l,i)=>l.id!==next[i]?.id||l.canvas!==next[i]?.canvas||l.x!==next[i]?.x||l.y!==next[i]?.y||l.visible!==next[i]?.visible||l.opacity!==next[i]?.opacity||l.name!==next[i]?.name);
}
const roles={torso:'옷 몸통',upper_arm:'위팔',forearm:'아래팔',hand:'손',arm:'팔 전체',neck:'목',sleeve:'소매',accessory:'장식',face:'얼굴'};
export function artworkLabel(layer){
  const a=layer.art;if(!a){const n=layer.name.toLowerCase(),names={'headwear':'모자·머리 장식','front hair':'앞머리','back hair':'뒷머리','face':'얼굴 바탕','nose':'코','mouth':'입','bottomwear':'하의'};if(names[n])return names[n];for(const [key,value]of [['eyebrow','눈썹'],['eyelash','눈꺼풀·속눈썹'],['eyewhite','눈 흰자'],['irides','눈동자'],['ears','귀'],['footwear','신발'],['legwear','다리']])if(n.startsWith(key))return `${value} · ${layer.name}`;return layer.name;}
  return `${a.side==='R'?'캐릭터 오른쪽 · ':a.side==='L'?'캐릭터 왼쪽 · ':''}${roles[a.role]||layer.name}`;
}
