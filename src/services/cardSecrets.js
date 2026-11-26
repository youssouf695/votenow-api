const crypto=require('node:crypto');
const argon2=require('argon2');

function key(name) {
  const value=process.env[name]||'';
  if(!/^[0-9a-f]{64}$/i.test(value))throw Object.assign(new Error('Sécurité Card indisponible.'),{status:503});
  return Buffer.from(value,'hex');
}
const hmac=(name,value)=>crypto.createHmac('sha256',key(name)).update(value).digest('hex');
function checkConfiguration() {
  const values=['CARD_NUMBER_KEY','CARD_LOOKUP_KEY','CARD_PIN_PEPPER','CARD_OTP_KEY'].map(name=>key(name).toString('hex'));
  if(new Set(values).size!==values.length)throw Object.assign(new Error('Sécurité Card indisponible.'),{status:503});
}
function checksum(body) {
  const sum=[...body].reduce((total,digit,i)=>total+Number(digit)*(i%2===0?3:1),0);
  return String((10-sum%10)%10);
}
function number() {
  const body=Array.from({length:15},()=>crypto.randomInt(10)).join('');
  return body+checksum(body);
}
function seal(value,id) {
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key('CARD_NUMBER_KEY'),iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext=Buffer.concat([cipher.update(value,'ascii'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64');
}
function unseal(value,id) {
  const buffer=Buffer.from(value,'base64');
  const cipher=crypto.createDecipheriv('aes-256-gcm',key('CARD_NUMBER_KEY'),buffer.subarray(0,12));
  cipher.setAAD(Buffer.from(id));
  cipher.setAuthTag(buffer.subarray(12,28));
  return Buffer.concat([cipher.update(buffer.subarray(28)),cipher.final()]).toString('ascii');
}
function validPin(pin) {
  if(typeof pin!=='string'||!/^\d{6}$/.test(pin)||/^(\d)\1{5}$|^(\d{2})\2{2}$|^(\d{3})\3$/.test(pin))return false;
  return !'012345678901234'.includes(pin)&&!'987654321098765'.includes(pin)&&
    !['121212','112233','123123','123321','696969','159357','147258','258369','654321'].includes(pin);
}
const pinMaterial=pin=>hmac('CARD_PIN_PEPPER',pin);
const hashPin=pin=>argon2.hash(pinMaterial(pin),{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
const verifyPin=(hash,pin)=>typeof pin==='string'&&/^\d{6}$/.test(pin)?argon2.verify(hash,pinMaterial(pin)):false;
const lookup=value=>hmac('CARD_LOOKUP_KEY',value);
const digest=fields=>hmac('CARD_OTP_KEY',JSON.stringify(fields));
function equal(first,second) {
  return typeof first==='string'&&first.length===second.length&&crypto.timingSafeEqual(Buffer.from(first),Buffer.from(second));
}
module.exports={number,checksum,seal,unseal,lookup,validPin,hashPin,verifyPin,digest,equal,checkConfiguration};
