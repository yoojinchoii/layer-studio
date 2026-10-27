// Alpha-aware convex envelope and sparse joint rows. Keeps visible pixels inside the mesh;
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
function clipToEdge(poly,a,b){
  const next=[];
  for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length],u=cross(a,b,p),v=cross(a,b,q);
    if(u>=-1e-7)next.push(p);
    if((u>=-1e-7)!==(v>=-1e-7)){const t=u/(u-v);next.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
  }
  return next;
}
// Circumscribed support polygon: use the silhouette's own longest edges and evenly spaced
// perimeter edges. Uniform world-axis support angles make a narrow diagonal limb balloon into
// a diamond, producing long triangles that collapse when a joint bends.
function envelope(hull,w,h,count){
  // A few extra real contour vertices are much safer than replacing them with a loose polygon.
  if(hull.length<=count+4)return hull;
  const edges=hull.map((a,i)=>{const b=hull[(i+1)%hull.length];return {i,a,b,length:Math.hypot(b[0]-a[0],b[1]-a[1])};}),chosen=new Set();
  // Preserve the dominant sides of long, tilted limbs.
  for(const e of [...edges].sort((a,b)=>b.length-a.length).slice(0,Math.max(4,Math.floor(count/2))))chosen.add(e.i);
  // Add support edges around the whole perimeter so curved ends stay enclosed.
  const perimeter=edges.reduce((n,e)=>n+e.length,0);let walked=0,index=0;
  for(let k=0;k<count;k++){
    const target=(k+.5)*perimeter/count;while(index<edges.length-1&&walked+edges[index].length<target)walked+=edges[index++].length;chosen.add(index);
  }
  for(const e of [...edges].sort((a,b)=>b.length-a.length))if(chosen.size<count)chosen.add(e.i);
  let poly=[[0,0],[w,0],[w,h],[0,h]];
  for(const i of [...chosen].sort((a,b)=>a-b)){poly=clipToEdge(poly,hull[i],hull[(i+1)%hull.length]);if(poly.length<3)return hull;}
  return hullOf(poly);
}
export function silhouetteTopology(layer,joints=[],density='balanced'){
  const {width:w,height:h,data}=layer;if(!data)return null;
  const profile={simple:{boundary:8,rows:[-1,0,1],cols:[0,1]},balanced:{boundary:12,rows:[-1,-.5,0,.5,1],cols:[0,1]},fine:{boundary:20,rows:[-1,-.5,0,.5,1],cols:[0,.5,1]}}[density]||{boundary:12,rows:[-1,0,1],cols:[0,.5,1]};
  const corners=[];
  for(let y=0;y<h;y++){let left=w,right=-1;for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]>8){left=Math.min(left,x);right=x;}
    if(right>=0)corners.push([left,y],[right+1,y],[left,y+1],[right+1,y+1]);}
  const hull=envelope(hullOf(corners),w,h,profile.boundary);if(hull.length<3)return null;
  const points=[...hull],inside=p=>hull.every((a,i)=>cross(a,hull[(i+1)%hull.length],p)>1e-5);
  const spacing=Math.max(1,Math.min(w,h)*.04);
  const add=(x,y)=>{const p=[x,y];if(inside(p)&&!points.some(q=>Math.hypot(x-q[0],y-q[1])<spacing))points.push(p);};
  const alpha=(x,y)=>x>=0&&x<w&&y>=0&&y<h?data[(Math.floor(y)*w+Math.floor(x))*4+3]:0;
  for(const j of joints){const {dir,p,band}=j,perp={x:-dir.y,y:dir.x};
    for(const delta of profile.rows){const cx=p.x-layer.x+dir.x*band*delta,cy=p.y-layer.y+dir.y*band*delta;let lo=Infinity,hi=-Infinity;
      for(let t=-Math.hypot(w,h);t<=Math.hypot(w,h);t+=1)if(alpha(cx+perp.x*t,cy+perp.y*t)>8){lo=Math.min(lo,t);hi=Math.max(hi,t);}
      if(hi>=lo)for(const f of profile.cols){const t=lo+(hi-lo)*f;add(cx+perp.x*t,cy+perp.y*t);}
    }
  }
  // Flat areas need no uniform grid. Only bending rows and a sparse enclosing boundary remain.
  const triangles=triangulate(points);if(!triangles.length)return null;
  return {points,triangles,hull:hull.length};
}
