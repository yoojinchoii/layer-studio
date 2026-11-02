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

// Restore missing exposed neck/chest from the aligned input, never synthesize skin colours.
// Grows only the connected skin component under the existing neck; clothing and transparent
// exterior stop the flood. The repaired neck may need a larger crop than the server returned.
export function restoreNeckFromReference(layers,width,height,reference){
  if(!reference?.data||reference.width!==width||reference.height!==height)return 0;
  const necks=layers.filter(l=>/^(neck|목)(?:$|[_ -])/i.test(l.name)&&l.visible!==false&&l.data),shirt=layers.find(l=>/^(topwear|상의)(?:$|[_ -])/i.test(l.name)&&l.visible!==false&&l.data);
  if(!shirt||!necks.length)return 0;
  const coverage=new Uint8Array(width*height);
  for(const l of layers)if(l.data&&l.visible!==false)for(let y=0;y<l.height;y++)for(let x=0;x<l.width;x++){const gx=Math.round(l.x)+x,gy=Math.round(l.y)+y;if(gx>=0&&gx<width&&gy>=0&&gy<height)coverage[gy*width+gx]=Math.max(coverage[gy*width+gx],l.data[(y*l.width+x)*4+3]*(l.opacity??1));}
  const src=reference.data,warm=k=>src[k+3]>32&&src[k]>src[k+1]*1.025&&src[k]>src[k+2]+12&&src[k+1]>45;
  let changed=0;
  for(const neck of necks){
    const nx=Math.round(neck.x),ny=Math.round(neck.y),left=Math.max(0,Math.floor(nx-neck.width*.7)),right=Math.min(width-1,Math.ceil(nx+neck.width*1.7)),top=Math.max(0,Math.floor(ny+neck.height*.25)),bottom=Math.min(height-1,shirt.y+shirt.height-1,Math.ceil(Math.max(ny+neck.height+Math.max(neck.height,shirt.height*.6),shirt.y+shirt.height*.7)));
    const seen=new Uint8Array(width*height),queue=[];
    for(let y=Math.max(top,ny);y<Math.min(bottom,ny+neck.height);y++)for(let x=nx;x<nx+neck.width;x++){const i=(y-ny)*neck.width+x-nx,g=y*width+x;if(x<0||x>=width||y<0||y>=height||neck.data[i*4+3]<200||!warm(g*4))continue;seen[g]=1;queue.push(g);}
    const patch=[];
    for(let n=0;n<queue.length;n++){
      const g=queue[n],x=g%width,y=Math.floor(g/width);if(coverage[g]<245&&src[g*4+3]>coverage[g]+8)patch.push(g);
      for(const [xx,yy]of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){if(xx<left||xx>right||yy<top||yy>bottom)continue;const j=yy*width+xx;if(!seen[j]&&warm(j*4)){seen[j]=1;queue.push(j);}}
    }
    if(!patch.length)continue;
    let x0=nx,y0=ny,x1=nx+neck.width,y1=ny+neck.height;for(const g of patch){const x=g%width,y=Math.floor(g/width);x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
    const w=x1-x0,h=y1-y0,data=new Uint8ClampedArray(w*h*4);
    for(let y=0;y<neck.height;y++)data.set(neck.data.subarray(y*neck.width*4,(y+1)*neck.width*4),((ny-y0+y)*w+nx-x0)*4);
    for(const g of patch){const k=((Math.floor(g/width)-y0)*w+g%width-x0)*4;data.set(src.subarray(g*4,g*4+4),k);coverage[g]=src[g*4+3];changed++;}
    Object.assign(neck,{x:x0,y:y0,width:w,height:h,data});
  }return changed;
}
