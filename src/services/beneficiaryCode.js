const crypto=require('node:crypto');
const env=require('../config/env');
function key(){const value=(process.env.WITHDRAWAL_OTP_SECRET||env.jwt.secret||'').trim();if(value.length<32)throw Object.assign(new Error('La confirmation par email est temporairement indisponible.'),{status:503,code:'BENEFICIARY_OTP_NOT_CONFIGURED'});return value;}
function digest(beneficiary,code,email){return crypto.createHmac('sha256',key()).update(JSON.stringify(['withdrawal-beneficiary',beneficiary.id,beneficiary.phone,beneficiary.full_name,beneficiary.method,beneficiary.verification_id,email.toLowerCase().trim(),code])).digest('hex');}
function matches(beneficiary,code,email){if(!/^[0-9]{6}$/.test(code)||!/^([a-f0-9]{64})$/.test(beneficiary.verification_hash||''))return false;return crypto.timingSafeEqual(Buffer.from(digest(beneficiary,code,email),'hex'),Buffer.from(beneficiary.verification_hash,'hex'));}
module.exports={digest,matches,checkConfiguration:key,generate:()=>crypto.randomInt(100000,1000000).toString()};
