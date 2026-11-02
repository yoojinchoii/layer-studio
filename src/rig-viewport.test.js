import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBuiltin} from './rig-templates.js';
import {buildParts,makeSkeleton,poseMatrices} from './rig-core.js';
import {poseBounds,paddedViewport,animationViewport,viewportPoint,rasterSize} from './rig-viewport.js';
const layer=(name,x,y,width,height)=>({name,x,y,width,height,data:new Uint8ClampedArray(width*height*4).fill(255),opacity:1,visible:true});
const fixture=()=>{const ls=[layer('face',80,0,40,60),layer('neck',90,55,20,25),layer('topwear',60,70,80,100),layer('handwear-r',35,75,22,150),layer('handwear-l',143,75,22,150)],rig=applyBuiltin('half',ls,200,230).rig,parts=buildParts(ls,rig);return {rig,parts,sk:makeSkeleton(parts,rig)};};
const inside=(view,b)=>{assert.ok(view.x<=b.left&&view.y<=b.top&&view.x+view.width>=b.right&&view.y+view.height>=b.bottom);};
test('fixed animation viewport contains all transformed sprite corners and mesh vertices throughout waving and cheering',()=>{
 const {rig,parts,sk}=fixture();
 for(const name of ['wave','cheer']){const view=animationViewport(sk,parts,rig,name);assert.ok(view.width>rig.width);
  for(let i=0;i<150;i++)inside(view,poseBounds(sk,parts,rig,poseMatrices(sk,i*.013,{},name)));
 }
});
test('manual off-canvas poses stay visible and pointer coordinates roundtrip with negative view origins and zoom',()=>{
 const {rig,parts,sk}=fixture(),m=poseMatrices(sk,null,{},'idle',{head:{x:-280,y:160}},{head:{x:2,y:1.5}}),b=poseBounds(sk,parts,rig,m),v=paddedViewport(b,rig);inside(v,b);assert.ok(v.x<0&&v.y<0);
 const point={x:-130,y:85};for(const zoom of [.5,1,2]){const rect={left:25,top:40,width:v.width*zoom,height:v.height*zoom},q=viewportPoint(v,rect,25+(point.x-v.x)*zoom,40+(point.y-v.y)*zoom);assert.ok(Math.hypot(q.x-point.x,q.y-point.y)<1e-8);}
 const raster=rasterSize({width:80000,height:50000});assert.ok(raster.width<=8192&&raster.height<=8192&&raster.width*raster.height<16_020_000);
});
