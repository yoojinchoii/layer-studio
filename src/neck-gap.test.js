import test from 'node:test';
import assert from 'node:assert/strict';
import {repairNeckGap,restoreNeckFromReference} from './neck-gap.js';
const layer=(name,x,y,width,height,shape,color)=>{const data=new Uint8ClampedArray(width*height*4);for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++)if(shape(xx,yy))data.set([...color,255],(yy*width+xx)*4);return {name,x,y,width,height,data};};
const fixture=()=>[
  layer('neck',30,10,20,30,(x,y)=>y<25,[240,190,155]),
  layer('topwear',15,25,50,45,(x,y)=>y>=15||x<15||x>=35,[30,130,140])
];
test('fills an enclosed collar gap on the chest sprite, preserves opaque art and is idempotent',()=>{
  const [neck,shirt]=fixture(),before=shirt.data.slice(),neckBefore=neck.data.slice();
  assert.ok(repairNeckGap([neck,shirt],80,80)>0);
  for(let y=35;y<40;y++)for(let x=30;x<50;x++)assert.deepEqual([...shirt.data.slice(((y-25)*50+x-15)*4,((y-25)*50+x-15)*4+4)],[240,190,155,255]);
  for(let k=0;k<before.length;k+=4)if(before[k+3]===255)assert.deepEqual(shirt.data.slice(k,k+4),before.slice(k,k+4));
  assert.deepEqual(neck.data,neckBefore);
  assert.equal(repairNeckGap([neck,shirt],80,80),0);
});
test('does not bridge open background, fill other holes, or reconstruct hidden/transparent parts',()=>{
  for(const modify of [
    ([n,s])=>{s.visible=false;},([n])=>{n.visible=false;},([n])=>{n.opacity=.5;},
    ([n,s])=>{for(let x=0;x<16;x++)s.data[(12*50+x)*4+3]=0;},
    ([n,s])=>{n.y-=20;}
  ]){const layers=fixture();modify(layers);const before=layers.map(l=>l.data.slice());assert.equal(repairNeckGap(layers,80,80),0);layers.forEach((l,i)=>assert.deepEqual(l.data,before[i]));}
});
test('does not recolor the opaque collar; underpaints its antialiased inner edge',()=>{
  const [n,s]=fixture(),k=(14*50+25)*4;s.data.set([30,130,140,100],k);
  assert.ok(repairNeckGap([n,s],80,80)>0);assert.equal(s.data[k+3],255);
  assert.ok(s.data[k]>100);assert.deepEqual([...s.data.slice((15*50+25)*4,(15*50+25)*4+4)],[30,130,140,255]);
});
test('restores a large open collar from connected original skin, expands the crop, leaves clothing and exterior unchanged',()=>{
 const neck=layer('neck',30,10,20,15,()=>true,[240,190,155]),shirt=layer('topwear',10,40,60,35,(x,y)=>y>18||x<10||x>50,[30,130,140]);
 const ref=layer('original',0,0,80,80,(x,y)=>x>=20&&x<60&&y>=10&&y<60,[240,190,155]);
 for(let y=25;y<60;y++)for(let x=20;x<60;x++)ref.data[(y*80+x)*4+1]=180+y%12;
 const before=shirt.data.slice(),ls=[neck,shirt];assert.ok(restoreNeckFromReference(ls,80,80,ref)>800);
 assert.ok(neck.height>40);assert.ok(neck.x<30);
 for(let y=25;y<59;y++)for(let x=25;x<55;x++){const k=((y-neck.y)*neck.width+x-neck.x)*4;assert.deepEqual(neck.data.slice(k,k+4),ref.data.slice((y*80+x)*4,(y*80+x)*4+4));}
 assert.deepEqual(shirt.data,before);assert.equal(restoreNeckFromReference(ls,80,80,ref),0);
 for(let y=0;y<neck.height;y++)for(let x=0;x<neck.width;x++)if(neck.data[(y*neck.width+x)*4+3])assert.ok(ref.data[((y+neck.y)*80+x+neck.x)*4+3]>0);
 assert.equal(restoreNeckFromReference(ls,80,80,null),0);assert.equal(restoreNeckFromReference(ls,80,80,{...ref,width:70}),0);
});
