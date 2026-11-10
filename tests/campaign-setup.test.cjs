const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {normalize,validateThrough}=require('../src/services/campaignSetup');
const group=()=>({id:crypto.randomUUID(),name:'Groupe'}),candidate=category_id=>({id:crypto.randomUUID(),name:'Candidate',category_id,number:null});
const data=()=>({basics:{title:'Nouvelle campagne',vote_price_fcfa:100},categories:[],candidates:[],content:{partners:[]}});
test('partial drafts retain blank names but are rejected when completing their stage',()=>{
 const d=data();d.categories=[{id:crypto.randomUUID(),name:''}];const normalized=normalize(d);assert.equal(normalized.categories[0].name,'');assert.doesNotThrow(()=>validateThrough(normalized,1));assert.throws(()=>validateThrough(normalized,2),{status:400});
});
test('two active candidates are required in every category, not only across the campaign',()=>{
 const d=data(),a=group(),b={...group(),name:'Autre groupe'};d.categories=[a,b];d.candidates=[candidate(a.id),candidate(a.id),candidate(b.id)];assert.throws(()=>validateThrough(normalize(d),3),{status:400});d.candidates.push(candidate(b.id));assert.doesNotThrow(()=>validateThrough(normalize(d),3));d.candidates[3].is_active=false;assert.throws(()=>validateThrough(normalize(d),3),{status:400});
});
test('uncategorized campaigns, amount floor, names and dates follow real model constraints',()=>{
 const d=data();d.candidates=[candidate(null),candidate(null)];assert.doesNotThrow(()=>validateThrough(normalize(d),4));d.basics.vote_price_fcfa=99;assert.throws(()=>validateThrough(normalize(d),1),{status:400});d.basics.vote_price_fcfa=100;d.basics.title='ab';assert.throws(()=>validateThrough(normalize(d),1),{status:400});d.basics.title='Campagne';d.basics.starts_at='2027-01-02T12:00:00Z';d.basics.ends_at='2027-01-01T12:00:00Z';assert.throws(()=>validateThrough(normalize(d),1),{status:400});
});
test('candidate numbers, ownership references, image URLs and partner URLs are checked',()=>{
 const d=data();d.candidates=[{...candidate(null),number:1},{...candidate(null),number:1}];assert.throws(()=>validateThrough(normalize(d),3),{status:400});d.candidates[1].number=2;d.candidates[0].photo_url='javascript:alert(1)';assert.throws(()=>validateThrough(normalize(d),3),{status:400});d.candidates[0].photo_url='';d.content.partners=[{name:'Partenaire',website:'http://example.org'}];assert.throws(()=>validateThrough(normalize(d),4),{status:400});
});
