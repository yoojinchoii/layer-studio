import test from 'node:test';
import assert from 'node:assert/strict';
import {artworkGeometry,artworkChanged,artworkLabel} from './artwork-model.js';
test('setup artwork rotation preserves centre and contains every corner',()=>{
 const l={x:30,y:50,width:80,height:40};
 for(const angle of [-180,-90,-31,0,47,90,180]){
  const g=artworkGeometry(l,{angle,scale:1.3,dx:-10,dy:20});
  assert.ok(Math.abs(g.x+g.width/2-60)<=.5);assert.ok(Math.abs(g.y+g.height/2-90)<=.5);
  for(const x of [-40,40])for(const y of [-20,20]){
   assert.ok(Math.abs(1.3*(x*Math.cos(g.angle)-y*Math.sin(g.angle)))<=g.width/2+1e-8);
   assert.ok(Math.abs(1.3*(x*Math.sin(g.angle)+y*Math.cos(g.angle)))<=g.height/2+1e-8);
  }
 }
 assert.throws(()=>artworkGeometry(l,{angle:0,scale:NaN,dx:0,dy:0}));
});
test('same-size replacement and reordering invalidate cached mesh artwork',()=>{
 const a={id:'a',canvas:{},x:0,y:0},b={id:'b',canvas:{},x:2,y:3};
 assert.equal(artworkChanged([a,b],[{...a},b]),false);
 assert.equal(artworkChanged([a,b],[{...a,canvas:{}},b]),true);
 assert.equal(artworkChanged([a,b],[b,a]),true);
 assert.equal(artworkChanged([a],[{...a,x:1}]),true);
 assert.match(artworkLabel({name:'hand_R',art:{role:'hand',side:'R'}}),/캐릭터 오른쪽/);
});
