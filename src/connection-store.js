export const DEFAULT_SERVER='https://yoojin-choi--layer-studio-see-through-api.modal.run';
export const CONNECTION_KEY='layer-studio.connection.v1';
export function validateConnection(value){
  if(typeof value?.url!=='string'||typeof value?.token!=='string'||value.url.length>2048||value.token.length>4096)throw Error('올바른 서버 연결 정보가 아닙니다.');
  let url;try{url=new URL(value.url.trim());}catch{throw Error('올바른 서버 주소를 입력해주세요.');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('https://로 시작하는 서버 기본 주소를 입력해주세요.');
  if(/[\r\n]/.test(value.token))throw Error('접속 키를 확인해주세요.');
  return {url:url.href.replace(/\/+$/,''),token:value.token.trim()};
}
export function readConnection(storage){
  const raw=storage.getItem(CONNECTION_KEY);if(!raw)return null;
  try{if(raw.length>8192)throw Error();const value=JSON.parse(raw);if(value.version!==1)throw Error();return validateConnection(value);}catch{storage.removeItem(CONNECTION_KEY);return null;}
}
export function writeConnection(storage,config){storage.setItem(CONNECTION_KEY,JSON.stringify({version:1,...validateConnection(config)}));}
export function forgetConnection(storage){storage.removeItem(CONNECTION_KEY);}
