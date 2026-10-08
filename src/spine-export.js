// Spine 4.0 atlas packing and a minimal PNG encoder, so the web app can hand Unity a ready
// skeleton.json + .atlas.txt + premultiplied .png without a round trip through the Spine editor.
import {zlibSync,strToU8} from 'fflate';
const CRC=new Uint32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=CRC[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function concat(chunks){const out=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let o=0;for(const c of chunks){out.set(c,o);o+=c.length;}return out;}
// Canvas PNG export un-premultiplies colours, so PMA pages are encoded directly from the byte buffer.
export function encodePNG(rgba,width,height){
  const stride=width*4,raw=new Uint8Array((stride+1)*height);for(let y=0;y<height;y++)raw.set(rgba.subarray(y*stride,(y+1)*stride),y*(stride+1)+1);
  const chunk=(type,data)=>{const out=new Uint8Array(12+data.length),dv=new DataView(out.buffer);dv.setUint32(0,data.length);out.set(strToU8(type),4);out.set(data,8);dv.setUint32(8+data.length,crc32(out.subarray(4,8+data.length)));return out;};
  const ihdr=new Uint8Array(13),dv=new DataView(ihdr.buffer);dv.setUint32(0,width);dv.setUint32(4,height);ihdr.set([8,6,0,0,0],8);
  return concat([new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlibSync(raw,{level:6})),chunk('IEND',new Uint8Array(0))]);
}
// Shelf packer. parts: [{slot,width,height,data(straight RGBA)}] → pages with premultiplied pixels + atlas text.
export function packAtlas(parts,{name='character',padding=2,maxSize=4096}={}){
  const items=parts.filter(p=>p.width>0&&p.height>0);
  for(const p of items)if(p.width+padding*2>maxSize||p.height+padding*2>maxSize)throw Error(`${p.slot} 파츠가 아틀라스 최대 크기(${maxSize}px)보다 큽니다.`);
  const area=items.reduce((n,p)=>n+(p.width+padding)*(p.height+padding),0),widest=items.reduce((n,p)=>Math.max(n,p.width+padding*2),1);
  const pageWidth=Math.min(maxSize,Math.max(widest,Math.ceil(Math.sqrt(area)*1.15)));
  const pages=[];let page=null,x=0,y=0,shelf=0;
  const newPage=()=>{page={regions:[],width:0,height:0};pages.push(page);x=padding;y=padding;shelf=0;};newPage();
  for(const p of [...items].sort((a,b)=>b.height-a.height||b.width-a.width)){
    if(x+p.width+padding>pageWidth){x=padding;y+=shelf+padding;shelf=0;}
    if(y+p.height+padding>maxSize){newPage();}
    page.regions.push({part:p,x,y});page.width=Math.max(page.width,x+p.width+padding);page.height=Math.max(page.height,y+p.height+padding);
    x+=p.width+padding;shelf=Math.max(shelf,p.height);
  }
  const lines=[],files=[];
  pages.forEach((pg,index)=>{
    const file=index?`${name}_${index+1}.png`:`${name}.png`,rgba=new Uint8Array(pg.width*pg.height*4);
    for(const {part,x,y}of pg.regions)for(let row=0;row<part.height;row++)for(let col=0;col<part.width;col++){
      const s=(row*part.width+col)*4,d=((y+row)*pg.width+x+col)*4,a=part.data[s+3];
      rgba[d]=Math.round(part.data[s]*a/255);rgba[d+1]=Math.round(part.data[s+1]*a/255);rgba[d+2]=Math.round(part.data[s+2]*a/255);rgba[d+3]=a;
    }
    if(index)lines.push('');lines.push(file,`size:${pg.width},${pg.height}`,'filter:Linear,Linear','pma:true');
    for(const {part,x,y}of pg.regions)lines.push(part.slot,`bounds:${x},${y},${part.width},${part.height}`);
    files.push({file,width:pg.width,height:pg.height,rgba});
  });
  return {atlas:lines.join('\n')+'\n',pages:files};
}
