// Alpha-aware convex envelope and sparse joint rows. Keeps all painted pixels inside the mesh;
// concave gaps stay transparent instead of being cut through by a coarse outline approximation.
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function hullOf(points){
  const p=[...new Map(points.map(p=>[p.join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const half=arr=>{const h=[];for(const q of arr){while(h.length>1&&cross(h.at(-2),h.at(-1),q)<=0)h.pop();h.push(q);}return h;};
  return [...half(p).slice(0,-1),...half([...p].reverse()).slice(0,-1)];
}
function circle(a,b,c){
  const d=2*cross(a,b,c);if(Math.abs(d)<1e-8)return null;
  const ax=a[0],ay=a[1],bx=b[0],by=b[1],cx=c[0],cy=c[1],aa=ax*ax+ay*ay,bb=bx*bx+by*by,cc=cx*cx+cy*cy;
  const x=(aa*(by-cy)+bb*(cy-ay)+cc*(ay-by))/d,y=(aa*(cx-bx)+bb*(ax-cx)+cc*(bx-ax))/d;
  return {x,y,r:(x-ax)**2+(y-ay)**2};
}
function triangulate(points){
  const n=points.length,m=Math.max(1,...points.flat())*16,all=[...points,[-m,-m],[3*m,-m],[-m,3*m]];
  let tris=[[n,n+1,n+2]];
  for(let i=0;i<n;i++){
    const edges=new Map(),keep=[];
    for(const t of tris){const c=circle(...t.map(k=>all[k]));if(c&&(all[i][0]-c.x)**2+(all[i][1]-c.y)**2<=c.r+1e-6){
      for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(',');if(edges.has(key))edges.delete(key);else edges.set(key,[a,b]);}
    }else keep.push(t);}
    for(const [a,b]of edges.values())if(Math.abs(cross(all[a],all[b],all[i]))>1e-7)keep.push(cross(all[a],all[b],all[i])>0?[a,b,i]:[b,a,i]);
    tris=keep;
  }
  // Spine's image-space winding is clockwise (image y points down).
  return tris.filter(t=>t.every(k=>k<n)).flatMap(([a,b,c])=>[a,c,b]);
}
export function silhouetteTopology(layer,joints=[]){
  const {width:w,height:h,data}=layer;if(!data)return null;
  const corners=[];
  for(let y=0;y<h;y++){let left=w,right=-1;for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]>0){left=Math.min(left,x);right=x;}
    if(right>=0)corners.push([left,y],[right+1,y],[left,y+1],[right+1,y+1]);}
  const hull=hullOf(corners);if(hull.length<3)return null;
  const points=[...hull],inside=p=>hull.every((a,i)=>cross(a,hull[(i+1)%hull.length],p)>1e-5);
  const add=(x,y)=>{const p=[x,y];if(inside(p)&&!points.some(q=>Math.hypot(x-q[0],y-q[1])<.8))points.push(p);};
  const alpha=(x,y)=>x>=0&&x<w&&y>=0&&y<h?data[(Math.floor(y)*w+Math.floor(x))*4+3]:0;
  for(const j of joints){const {dir,p,band}=j,perp={x:-dir.y,y:dir.x};
    for(const delta of [-1,-.5,0,.5,1]){const cx=p.x-layer.x+dir.x*band*delta,cy=p.y-layer.y+dir.y*band*delta;let lo=Infinity,hi=-Infinity;
      for(let t=-Math.hypot(w,h);t<=Math.hypot(w,h);t+=1)if(alpha(cx+perp.x*t,cy+perp.y*t)>8){lo=Math.min(lo,t);hi=Math.max(hi,t);}
      if(hi>=lo)for(const f of [0,.25,.5,.75,1]){const t=lo+(hi-lo)*f;add(cx+perp.x*t,cy+perp.y*t);}
    }
  }
  const step=Math.max(8,Math.max(w,h)/9);
  for(let y=step/2;y<h;y+=step)for(let x=step/2;x<w;x+=step)if(alpha(x,y)>8&&!points.some(p=>Math.hypot(x-p[0],y-p[1])<step*.65))add(x,y);
  const triangles=triangulate(points);if(!triangles.length)return null;
  return {points,triangles,hull:hull.length};
}
