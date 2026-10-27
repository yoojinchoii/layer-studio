// Close only small, enclosed holes at the neck/collar contact. Paint on the chest
// sprite so the infill stays with the neckline when the head or arms move.
export function repairNeckGap(layers,width,height){
  const active=layers.filter(l=>l.data&&l.visible!==false&&(l.opacity??1)>.98);
  const necks=active.filter(l=>/^(neck|목)(?:$|[_ -])/i.test(l.name));
  const shirts=active.filter(l=>/^(topwear|상의)(?:$|[_ -])/i.test(l.name));
  if(!necks.length||!shirts.length)return 0;
  const at=(l,x,y)=>{const xx=x-Math.round(l.x),yy=y-Math.round(l.y);return xx>=0&&yy>=0&&xx<l.width&&yy<l.height?(yy*l.width+xx)*4:-1;};
  const alpha=(l,x,y)=>{const k=at(l,x,y);return k<0?0:l.data[k+3];};
  const union=new Uint8Array(width*height);
  for(const l of layers)if(l.data&&l.visible!==false)for(let y=0;y<l.height;y++)for(let x=0;x<l.width;x++){
    const gx=Math.round(l.x)+x,gy=Math.round(l.y)+y;if(gx>=0&&gy>=0&&gx<width&&gy<height){const j=gy*width+gx;union[j]=Math.max(union[j],l.data[(y*l.width+x)*4+3]*(l.opacity??1));}
  }
  let changed=0;
  for(const neck of necks){
    // Derive the skin palette from the lower neck, excluding its dark outline.
    const donors=[];
    for(let y=Math.floor(neck.height*.55);y<neck.height;y++)for(let x=1;x<neck.width-1;x++){
      const k=(y*neck.width+x)*4,d=neck.data;
      if(d[k+3]<240||d[k-1]<220||d[k+7]<220)continue;
      donors.push({x:Math.round(neck.x)+x,y:Math.round(neck.y)+y,rgb:[d[k],d[k+1],d[k+2]]});
    }
    if(!donors.length)continue;
    const median=[0,1,2].map(c=>donors.map(p=>p.rgb[c]).sort((a,b)=>a-b)[Math.floor(donors.length/2)]);
    const skin=donors.filter(p=>Math.hypot(...p.rgb.map((v,c)=>v-median[c]))<45);
    if(!skin.length)continue;
    const left=Math.max(0,Math.floor(neck.x-neck.width*.35)),right=Math.min(width-1,Math.ceil(neck.x+neck.width*1.35));
    const top=Math.max(0,Math.floor(neck.y+neck.height*.55)),bottom=Math.min(height-1,Math.ceil(neck.y+neck.height*1.4));
    const visited=new Set();
    for(let sy=top;sy<=bottom;sy++)for(let sx=left;sx<=right;sx++){
      const seed=sy*width+sx;if(union[seed]>64||visited.has(seed))continue;
      const region=[seed];visited.add(seed);let enclosed=true,neckContact=false,minY=sy,maxY=sy;
      for(let n=0;n<region.length;n++){
        const j=region[n],x=j%width,y=Math.floor(j/width);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        if(x===left||x===right||y===top||y===bottom)enclosed=false;
        for(const [xx,yy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
          if(xx<left||xx>right||yy<top||yy>bottom)continue;
          const q=yy*width+xx;if(union[q]>64){if(alpha(neck,xx,yy)>64)neckContact=true;continue;}
          if(!visited.has(q)){visited.add(q);region.push(q);}
        }
      }
      if(!enclosed||!neckContact||maxY-minY+1>neck.height*.55||region.length>neck.width*neck.height*.6)continue;
      // The entire hole must fit inside the shirt crop, with opaque cloth below it.
      const shirt=shirts.find(l=>region.every(j=>at(l,j%width,Math.floor(j/width))>=0)&&region.some(j=>{
        const x=j%width,y=Math.floor(j/width);return alpha(l,x,y+1)>180;
      }));
      if(!shirt)continue;
      const patch=new Set(region);
      // Put skin behind the antialiased hole boundary, without overwriting cloth RGB.
      for(const j of region){const x=j%width,y=Math.floor(j/width);for(const [xx,yy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]])if(at(shirt,xx,yy)>=0&&alpha(shirt,xx,yy)<245)patch.add(yy*width+xx);}
      for(const j of patch){
        const x=j%width,y=Math.floor(j/width),k=at(shirt,x,y);let nearest=skin[0],distance=Infinity;
        for(const p of skin){const d=(p.x-x)**2+(p.y-y)**2;if(d<distance){distance=d;nearest=p;}}
        const a=shirt.data[k+3]/255;for(let c=0;c<3;c++)shirt.data[k+c]=Math.round(shirt.data[k+c]*a+nearest.rgb[c]*(1-a));
        shirt.data[k+3]=255;union[j]=255;changed++;
      }
    }
  }
  return changed;
}
