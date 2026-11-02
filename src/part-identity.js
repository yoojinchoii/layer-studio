// Semantic side labels take precedence over screen position: a bent/crossed hand
// can be on the other side of the image without changing its anatomical identity.
export function namedSide(name){const n=name.toLowerCase().replace(/[ -]+/g,'_'),m=n.match(/(?:^|_)(r|l|right|left)(?:_\d+)?$/);return m?(['r','right'].includes(m[1])?'left':'right'):null;}
export const isArmPart=name=>/^(handwear|arm)(?:$|[_ -])|^팔/i.test(name);
export const isHeadAccessory=name=>/^(headwear|hat|helmet|headband|head[_ -]?accessor(?:y|ies)|hair[_ -]?(?:accessor(?:y|ies)|ornament)|모자|머리장식|머리 장식|머리띠)(?:$|[_ -])/i.test(name);
// Conservative two-root test for an unsided arm mask. Two separated upper roots
// straddling the torso plus a lower bridge indicate unresolved/overlapping arms.
// This is a review signal, not semantic segmentation or hidden-pixel reconstruction.
export function mergedArmRoots(layer,layers){
  if(!isArmPart(layer.name)||namedSide(layer.name)||!layer.data)return null;
  const torso=layers.find(l=>/^(topwear|상의|shirt)(?:$|[_ -])/i.test(l.name));if(!torso)return null;
  const W=layer.width,H=layer.height,a=(x,y)=>layer.data[(y*W+x)*4+3]>64;
  let y0=H,y1=-1;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(a(x,y)){y0=Math.min(y0,y);y1=Math.max(y1,y);}if(y1-y0<12)return null;
  const end=Math.min(H,y0+Math.ceil((y1-y0)*.36)),cols=new Float64Array(W);let total=0;
  for(let y=y0;y<end;y++)for(let x=0;x<W;x++)if(a(x,y)){cols[x]++;total++;}
  const runs=[];let run=null;for(let x=0;x<=W;x++){if(x<W&&cols[x]>=2){if(!run)run={lo:x,hi:x,n:0};run.hi=x;run.n+=cols[x];}else if(run){runs.push(run);run=null;}}
  const roots=runs.filter(r=>r.n>Math.max(12,total*.13));if(roots.length!==2)return null;
  const [left,right]=roots,cx=torso.x+torso.width/2,lx=layer.x+(left.lo+left.hi)/2,rx=layer.x+(right.lo+right.hi)/2;
  if(!(lx<cx-torso.width*.15&&rx>cx+torso.width*.15&&rx-lx>torso.width*.5&&right.lo-left.hi>Math.max(3,torso.width*.08)))return null;
  let bridge=0;for(let y=end;y<=y1;y++)if(a(Math.floor((left.hi+right.lo)/2),y))bridge++;
  if(bridge<3)return null;
  const centre=r=>{let sx=0,sy=0,n=0;for(let y=y0;y<end;y++)for(let x=r.lo;x<=r.hi;x++)if(a(x,y)){sx+=layer.x+x+.5;sy+=layer.y+y+.5;n++;}return {x:sx/n,y:sy/n};};
  return {left:centre(left),right:centre(right)};
}
