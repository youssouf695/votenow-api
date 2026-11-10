const {test}=require('node:test'),assert=require('node:assert/strict');
const {filters}=require('../src/services/transactionAudit');
test('transaction audit filters bind untrusted values instead of interpolating SQL',()=>{
 const input="' OR 1=1--%_",f=filters({reference:input,type:'vote',status:'success',page:'2',limit:'25'});
 assert.ok(!f.where.includes(input));assert.equal(f.values.type,'vote');assert.equal(f.page,2);assert.equal(f.values.reference,"%' OR 1=1--\\%\\_%");
});
test('transaction filters reject invalid identifiers, status, dates and excessive pagination',()=>{
 for(const q of [{event_id:'bad'},{status:'completed'},{type:'other'},{from:'2026-02-30'},{from:'2026-12-01',to:'2026-11-01'},{limit:1000},{page:-1},{anomaly:'maybe'}])assert.throws(()=>filters(q),{status:400});
});
