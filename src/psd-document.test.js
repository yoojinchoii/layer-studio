import test from 'node:test';
import assert from 'node:assert/strict';
import {readPsd,writePsd,initializeCanvas} from 'ag-psd';
import {psdDocument,compositePixels} from './psd-document.js';
initializeCanvas(()=>{throw Error('Unexpected canvas');},(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}));
const layer=(name,rgb,x=1,opacity=1,visible=true)=>({name,x,y:1,width:2,height:2,data:new Uint8ClampedArray(Array(4).fill([...rgb,255]).flat()),opacity,visible});
test('grouped PSD roundtrip preserves names, draw order, offsets, opacity and pixels',()=>{
 const layers=[layer('front hair',[30,50,10]),layer('face',[250,180,150],2,.5),layer('topwear',[20,130,120]),layer('handwear-r_skin',[250,180,150]),layer('sleeve_R',[20,130,120]),layer('back hair',[30,50,10],0,1,false)];
 const doc=psdDocument(layers,5,5),psd=readPsd(writePsd(doc,{generateThumbnail:false}),{useImageData:true,skipThumbnail:true});
 const flat=nodes=>nodes.flatMap(n=>n.children?flat(n.children):[n]);const out=flat(psd.children).reverse();assert.equal(out.length,layers.length);
 out.forEach((l,i)=>{assert.equal(l.name,layers[i].name);assert.equal(l.left,layers[i].x);assert.equal(l.top,layers[i].y);assert.ok(Math.abs((l.opacity??1)-layers[i].opacity)<.005);assert.equal(!!l.hidden,!layers[i].visible);assert.deepEqual(l.imageData.data,layers[i].data);});
 const expected=compositePixels(layers,5,5).data;assert.ok(psd.imageData.data.every((v,i)=>Math.abs(v-expected[i])<=1),'PSD merged preview alpha quantization is at most one level');assert.ok(psd.children.every(g=>g.name.startsWith('LS · ')));
});
