// Non-destructive sleeve extraction. Source pixels remain in the editing project;
// the same derived sprites are used by the preview, Spine export and parts.psd.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const dot=(x,y,n)=>x*n.x+y*n.y;
function dominant(colors){
  const bins=new Map();for(const c of colors){const key=c.map(v=>v>>4).join(',');const b=bins.get(key)||[];b.push(c);bins.set(key,b);}
  const best=[...bins.values()].sort((a,b)=>b.length-a.length)[0];
  return best?.[0].map((_,i)=>Math.round(best.reduce((s,c)=>s+c[i],0)/best.length));
}
function armFrame(rig,index){
  const mode=rig.modes[index];if(!/^arm_(left|right)$/.test(mode))return null;
  const side=mode.slice(4),shoulder=rig.points[`arm_${side}`],elbow=rig.points[`elbow_${side}`];
  const length=Math.hypot(elbow.x-shoulder.x,elbow.y-shoulder.y);if(length<8)return null;
  const axis={x:(elbow.x-shoulder.x)/length,y:(elbow.y-shoulder.y)/length};return {side,shoulder,elbow,length,axis,across:{x:-axis.y,y:axis.x}};
}
export function suggestSleeve(layer,rig,index,shirt=null){
  const frame=armFrame(rig,index);if(!frame||!layer.data)return null;
  const {shoulder,length,axis,across}=frame,points=[],proximal=[],distal=[];
  for(let y=0;y<layer.height;y++)for(let x=0;x<layer.width;x++){
    const k=(y*layer.width+x)*4;if(layer.data[k+3]<240)continue;
    const t=dot(layer.x+x+.5-shoulder.x,layer.y+y+.5-shoulder.y,axis),u=dot(layer.x+x+.5-shoulder.x,layer.y+y+.5-shoulder.y,across),rgb=Array.from(layer.data.subarray(k,k+3));
    points.push({t,u,rgb});if(t>0&&t<length*.25)proximal.push(rgb);if(t>length*.95&&t<length*1.55)distal.push(rgb);
  }
  const cloth=dominant(proximal),skin=dominant(distal);if(!cloth||!skin||distance(cloth,skin)<65)return null;
  // Only suggest automatically when the upper-arm colour also occurs in the shirt.
  // This avoids interpreting a tattoo, glove, or a skin highlight as a sleeve.
  if(shirt){let matching=0,total=0;for(let i=0;i<shirt.data?.length;i+=16){if(shirt.data[i+3]<240)continue;total++;if(distance(cloth,Array.from(shirt.data.subarray(i,i+3)))<45)matching++;}if(matching<20||matching/total<.12)return null;}
  const bins=Array.from({length:60},()=>({skin:0,cloth:0}));
  for(const p of points){const i=Math.floor(p.t/length*50);if(i<0||i>=bins.length)continue;const ds=distance(p.rgb,skin),dc=distance(p.rgb,cloth);if(ds<60&&ds+25<dc)bins[i].skin++;else if(dc<65&&dc+25<ds)bins[i].cloth++;}
  const edge=bins.findIndex((b,i)=>i>=12&&i<=43&&[b,bins[i+1],bins[i+2]].every(q=>q.skin>=3&&q.skin/(q.skin+q.cloth)>.75));if(edge<0)return null;
  let offset=edge/50*length;
  // Fit the cuff direction from the first skin pixels in parallel strips.
  const strips=new Map();for(const p of points){if(Math.abs(p.t-offset)>length*.16||distance(p.rgb,skin)>55)continue;const k=Math.round(p.u/2),old=strips.get(k);if(!old||p.t<old.t)strips.set(k,p);}
  const samples=[...strips.values()];let slope=0;
  if(samples.length>=5){const mu=samples.reduce((s,p)=>s+p.u,0)/samples.length,mt=samples.reduce((s,p)=>s+p.t,0)/samples.length;const den=samples.reduce((s,p)=>s+(p.u-mu)**2,0);slope=clamp(samples.reduce((s,p)=>s+(p.u-mu)*(p.t-mt),0)/(den||1),-.6,.6);offset=mt-slope*mu;}
  const nx=axis.x-slope*across.x,ny=axis.y-slope*across.y,nlen=Math.hypot(nx,ny);
  return {enabled:true,point:{x:shoulder.x+axis.x*offset,y:shoulder.y+axis.y*offset},normal:{x:nx/nlen,y:ny/nlen},skin,cloth,offset:0,angle:0};
}
export function initSleeves(layers,rig){
  if(rig.sleeves!==undefined)return 0;rig.sleeves={};
  const shirt=layers.find(l=>/^(topwear|상의)(?:$|[_ -])/i.test(l.name));if(!shirt?.data)return 0;
  layers.forEach((l,i)=>{const s=suggestSleeve(l,rig,i,shirt);if(s)rig.sleeves[i]=s;});return Object.keys(rig.sleeves).length;
}
export function cuffLine(config){
  const angle=(config.angle||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),n=config.normal;
  const normal={x:n.x*c-n.y*s,y:n.x*s+n.y*c};return {normal,point:{x:config.point.x+normal.x*(config.offset||0),y:config.point.y+normal.y*(config.offset||0)}};
}
function crop(layer,data,extra){
  let x0=layer.width,y0=layer.height,x1=-1,y1=-1;
  for(let y=0;y<layer.height;y++)for(let x=0;x<layer.width;x++)if(data[(y*layer.width+x)*4+3]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  if(x1<0)return null;const width=x1-x0+1,height=y1-y0+1,out=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)out.set(data.subarray(((y0+y)*layer.width+x0)*4,((y0+y)*layer.width+x1+1)*4),y*width*4);
  return {...layer,...extra,canvas:null,x:layer.x+x0,y:layer.y+y0,width,height,data:out};
}
export function separateSleeve(layer,rig,index){
  const config=rig.sleeves?.[index],frame=armFrame(rig,index);if(!config?.enabled||!frame||!layer.data)return null;
  const {normal,point}=cuffLine(config),{shoulder,axis,across,side}=frame;
  const sleeve=new Uint8ClampedArray(layer.data.length),arm=new Uint8ClampedArray(layer.data),mask=new Uint8Array(layer.width*layer.height);
  let garmentCount=0,skinCount=0;const cross=[];
  for(let y=0;y<layer.height;y++)for(let x=0;x<layer.width;x++){
    const p=y*layer.width+x,k=p*4;if(!layer.data[k+3])continue;const gx=layer.x+x+.5,gy=layer.y+y+.5,t=dot(gx-point.x,gy-point.y,normal),rgb=Array.from(layer.data.subarray(k,k+3));
    // Keep the dark cuff outline with the garment, not on the moving skin.
    const cloth=t<0||t<2&&distance(rgb,config.skin)>distance(rgb,config.cloth);
    if(cloth){mask[p]=1;sleeve.set(layer.data.subarray(k,k+4),k);arm[k+3]=0;garmentCount++;}else {skinCount++;if(t>=5&&t<=13&&layer.data[k+3]>240&&distance(rgb,config.skin)<65)cross.push(dot(gx-shoulder.x,gy-shoulder.y,across));}
  }
  if(garmentCount<10||skinCount<10)return null;
  // An estimated, narrower skin tube sits behind the sleeve. It is only painted under
  // nearly opaque garment pixels; fuzzy outside edges retain their original alpha.
  cross.sort((a,b)=>a-b);const lo=cross[Math.floor(cross.length*.04)],hi=cross[Math.floor(cross.length*.96)];
  const radius=cross.length>=5?Math.max(2,(hi-lo)/2):Math.max(2,frame.length*.12),centre=cross.length>=5?(hi+lo)/2:0;
  const cuffT=Math.max(1,dot(point.x-shoulder.x,point.y-shoulder.y,axis));
  for(let y=0;y<layer.height;y++)for(let x=0;x<layer.width;x++){
    const p=y*layer.width+x,k=p*4;if(!mask[p]||layer.data[k+3]<245)continue;
    const gx=layer.x+x+.5,gy=layer.y+y+.5,t=dot(gx-shoulder.x,gy-shoulder.y,axis),u=dot(gx-shoulder.x,gy-shoulder.y,across)-centre*clamp(t/cuffT,0,1),r=radius*(.85+.15*clamp(t/cuffT,0,1));
    const cap=Math.hypot(u,Math.min(0,t));if(cap<=r)arm.set([...config.skin,255],k);
  }
  // The sleeve follows the upper arm; only its shoulder seam blends into the torso (see sleeve_* meshes).
  return [crop(layer,sleeve,{name:`sleeve_${side==='left'?'R':'L'}`,bone:`arm_${side}`,mode:`sleeve_${side}`,role:'sleeve'}),crop(layer,arm,{name:`${layer.name}_skin`,bone:rig.assignments[index],mode:rig.modes[index],role:'skin'})];
}
