import test from 'node:test';
import assert from 'node:assert/strict';
import {CONNECTION_KEY,validateConnection,readConnection,writeConnection,forgetConnection} from './connection-store.js';
test('saved connection survives a new reader, then forget removes only its own key',()=>{
  const values=new Map([['other','keep']]);const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const config={url:'https://example.modal.run/',token:'test-key'};writeConnection(storage,config);assert.deepEqual(readConnection(storage),{url:'https://example.modal.run',token:'test-key'});forgetConnection(storage);assert.equal(readConnection(storage),null);assert.equal(values.get('other'),'keep');
  values.set(CONNECTION_KEY,'broken');assert.equal(readConnection(storage),null);assert.equal(values.has(CONNECTION_KEY),false);
});
test('unsafe URLs, header injection and unsupported saved versions cannot auto-connect',()=>{
  for(const url of ['http://example.com','https://user:pass@example.com','https://example.com/?key=secret','https://example.com/#token'])assert.throws(()=>validateConnection({url,token:'key'}));
  assert.throws(()=>validateConnection({url:'https://example.com',token:'key\r\nX-Test: yes'}));
  assert.equal(readConnection({getItem:()=>JSON.stringify({version:2,url:'https://example.com',token:'key'}),removeItem:()=>{}}),null);
});
