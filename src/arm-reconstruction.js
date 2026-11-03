// Reconstruct support beneath visible pieces, never re-use the occluding hand as skin.
// This is an anatomical draft. AI inpainting supplies texture inside its mask.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function reconstructArm(layer,visible,chain,widthScale=1){
 const {width:W,height:H}=layer,N=W*H,coverage=new Float32Array(N),data=new Uint8ClampedArray(N*4),fill=new Uint8Array(N);
 for(let s=0;s<2;s++){
  const a=chain[s],b=chain[s+1],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<2)continue;
  // Estimate thickness from perpendicular cross sections of owned, visible skin.
  const samples=[];
  for(const t of [.25,.4,.6,.8]){const cx=a.x+dx*t,cy=a.y+dy*t;let negative=0,positive=0;
   for(const sign of [-1,1]){let run=0;for(let d=0;d<len*.3;d++){const x=Math.floor(cx-dy/len*d*sign-layer.x),y=Math.floor(cy+dx/len*d*sign-layer.y);if(x<0||y<0||x>=W||y>=H||visible[(y*W+x)*4+3]<128)break;run=d;}if(sign<0)negative=run;else positive=run;}
   if(negative>2&&positive>2)samples.push(Math.min(negative,positive));
  }
  // An occluded forearm often contains only a thin visible strip. Its width is not
  // the limb's thickness; use the upper-arm length as a conservative lower bound.
  const upperLength=Math.hypot(chain[1].x-chain[0].x,chain[1].y-chain[0].y);
  const minimum=Math.max(2,Math.min(len,upperLength)*.18);
  samples.sort((a,b)=>a-b);const radius=clamp(samples.length?samples[Math.floor(samples.length/2)]:minimum,minimum,Math.max(minimum,len*.23))*widthScale;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const px=layer.x+x+.5,py=layer.y+y+.5,t=clamp(((px-a.x)*dx+(py-a.y)*dy)/(len*len),0,1),r=radius*(s===1?1-t*.25:1),d=Math.hypot(px-a.x-t*dx,py-a.y-t*dy);coverage[y*W+x]=Math.max(coverage[y*W+x],clamp(r+.5-d,0,1));}
 }
 // Nearest owned pixel is only a preview colour, not a claimed AI reconstruction.
 const nearest=new Int32Array(N).fill(-1),queue=new Int32Array(N);let tail=0;
 for(let i=0;i<N;i++)if(visible[i*4+3]>128){nearest[i]=i;queue[tail++]=i;}
 if(!tail)return null;
 for(let head=0;head<tail;head++){const i=queue[head],x=i%W;for(const j of [x>0?i-1:-1,x<W-1?i+1:-1,i-W,i+W])if(j>=0&&j<N&&nearest[j]===-1){nearest[j]=nearest[i];queue[tail++]=j;}}
 for(let i=0;i<N;i++){
  if(coverage[i]>0){const k=nearest[i]*4;data.set(visible.subarray(k,k+3),i*4);data[i*4+3]=Math.round(coverage[i]*255);if(visible[i*4+3]<250)fill[i]=1;}
  if(visible[i*4+3]){for(let c=0;c<3;c++)data[i*4+c]=visible[i*4+c];data[i*4+3]=Math.max(data[i*4+3],visible[i*4+3]);}
 }
 return fill.some(Boolean)?{data,fill}:null;
}
export function armFillSignature(rig){return JSON.stringify([4,rig.points,rig.limbStyle,rig.modes,rig.sleeves,rig.armSplits]);}
