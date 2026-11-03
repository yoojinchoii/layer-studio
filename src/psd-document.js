// Group only adjacent sprites. Grouping all arms together would change draw order.
export function partCategory(name){
  const n=name.toLowerCase();
  if(/hair|머리카락/.test(n))return '머리카락';
  if(/face|eye|irides|nose|mouth|ears|얼굴|눈|코|입|귀/.test(n))return '얼굴';
  if(/sleeve|topwear|bottomwear|torso|accessory|상의|하의|소매|skirt/.test(n))return '의상';
  if(/neck|목/.test(n))return '목';
  if(/handwear|arm|forearm|hand_|팔|손/.test(n))return '팔·손';
  if(/legwear|footwear|thigh|shin|foot_|shoe|다리|신발/.test(n))return '다리·발';
  return '기타';
}
export function psdDocument(layers,width,height,composite){
  const groups=[];
  for(const l of layers){
    const category=partCategory(l.name);let group=groups.at(-1);
    if(!group||group.category!==category){group={category,name:`LS · ${String(groups.length+1).padStart(2,'0')} ${category}`,opened:true,blendMode:'pass through',children:[]};groups.push(group);}
    group.children.push({name:l.name,left:l.x,top:l.y,opacity:l.opacity??1,hidden:l.visible===false,blendMode:'normal',...(l.canvas?{canvas:l.canvas}:{imageData:{width:l.width,height:l.height,data:l.data}})});
  }
  return {width,height,...(composite?{canvas:composite}:{imageData:compositePixels(layers,width,height)}),children:groups.reverse().map(({category,...g})=>({...g,children:g.children.reverse()}))};
}

export function compositePixels(layers,width,height){
  const data=new Uint8ClampedArray(width*height*4);
  for(const l of [...layers].reverse()){
    if(l.visible===false)continue;const w=l.canvas?.width||l.width,h=l.canvas?.height||l.height,src=l.data||l.canvas.getContext('2d').getImageData(0,0,w,h).data;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const gx=l.x+x,gy=l.y+y;if(gx<0||gy<0||gx>=width||gy>=height)continue;const k=(y*w+x)*4,j=(gy*width+gx)*4,a=src[k+3]/255*(l.opacity??1),b=data[j+3]/255,out=a+b*(1-a);if(!a)continue;for(let c=0;c<3;c++)data[j+c]=(src[k+c]*a+data[j+c]*b*(1-a))/out;data[j+3]=out*255;}
  }return {width,height,data};
}
