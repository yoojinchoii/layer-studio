import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaveQueue} from './project-store.js';
test('a slow or failed write cannot reorder or block later recovery snapshots',async()=>{
 const writes=[];let release;const gate=new Promise(r=>release=r),save=createSaveQueue(async r=>{if(r===1){await gate;throw Error('quota');}writes.push(r);});
 const first=save(1),caught=assert.rejects(first,/quota/),second=save(2),third=save(3);release();await Promise.all([caught,second,third]);assert.deepEqual(writes,[2,3]);
});
