import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {makePreviewArchive} from './spine-preview.js';
test('preview preserves edited pose and straight-alpha image without external work',()=>{
  const skeleton={skeleton:{spine:'4.0.64'},animations:{manual_pose:{bones:{forearm_R:{rotate:[{value:30}]}}}}};
  const data=new Uint8ClampedArray([90,160,200,128]);
  const parts=[{slot:'part_01',width:1,height:1,data}];
  const zip=unzipSync(makePreviewArchive({name:'테스트',skeleton,parts}));
  assert.deepEqual(Object.keys(zip).sort(),['images/part_01.png','preview.json','skeleton.json']);
  assert.deepEqual(JSON.parse(strFromU8(zip['skeleton.json'])),skeleton);
  assert.equal(JSON.parse(strFromU8(zip['preview.json'])).format,'layer-studio-spine-preview-v1');
  assert.deepEqual([...data],[90,160,200,128]);
  assert.throws(()=>makePreviewArchive({skeleton,parts:[{...parts[0],slot:'../escape'}]}));
});
