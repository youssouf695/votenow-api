const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.JWT_SECRET='fixture-secret-for-isolated-http-tests-only';
const app=require('../src/app'),sequelize=require('../src/config/database'),models=require('../src/models'),jwt=require('jsonwebtoken'),axios=require('axios');
test('real Express routes enforce auth, expose beneficiaries and validate gallery uploads without external calls',async()=>{
 const original={user:models.User.findByPk,list:models.WithdrawalBeneficiary.findAll,event:models.Event.findOne,query:sequelize.query,post:axios.post};
 const originals=Object.fromEntries(['CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET'].map(k=>[k,process.env[k]]));
 models.User.findByPk=async id=>({id,role:id,is_verified:true});
 models.WithdrawalBeneficiary.findAll=async()=>[{id:'beneficiary',phone:'237699111222',full_name:'Beneficiary Fixture',method:'orange_money',verification_hash:'must-not-leak'}];
 models.Event.findOne=async q=>q.where.id==='11111111-1111-4111-8111-111111111111'&&q.where.organizer_id==='organizer'?{id:q.where.id}:null;
 sequelize.query=async()=>[[{hits:1,retry_after:1}],{}];
 process.env.CLOUDINARY_CLOUD_NAME='fixture-cloud';process.env.CLOUDINARY_API_KEY='fixture-api';process.env.CLOUDINARY_API_SECRET='fixture-secret';
 axios.post=async()=>({data:{secure_url:'https://res.cloudinary.com/fixture-cloud/image/upload/example.webp'}});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const headers=role=>({Authorization:`Bearer ${jwt.sign({id:role},process.env.JWT_SECRET)}`});
 try{
  let res=await fetch(`${base}/api/withdrawals/beneficiaries`);assert.equal(res.status,401);
  res=await fetch(`${base}/api/withdrawals/beneficiaries`,{headers:headers('voter')});assert.equal(res.status,403);
  res=await fetch(`${base}/api/withdrawals/beneficiaries`,{headers:headers('organizer')});assert.equal(res.status,200);const data=await res.json();assert.equal(data.limit,3);assert.equal(data.beneficiaries[0].phone,'237699111222');assert.equal(data.beneficiaries[0].verification_hash,undefined);
  const endpoint=`${base}/api/events/11111111-1111-4111-8111-111111111111/gallery-image`,png=Buffer.from([137,80,78,71,13,10,26,10,0,0]);
  res=await fetch(endpoint,{method:'POST',headers:{...headers('organizer'),'Content-Type':'image/png'},body:png});assert.equal(res.status,201);assert.equal((await res.json()).image_url,'https://res.cloudinary.com/fixture-cloud/image/upload/example.webp');
  res=await fetch(endpoint,{method:'POST',headers:{...headers('organizer'),'Content-Type':'image/png'},body:Buffer.from('not-an-image')});assert.equal(res.status,415);
  res=await fetch(endpoint,{method:'POST',headers:{...headers('voter'),'Content-Type':'image/png'},body:png});assert.equal(res.status,403);
 }finally{
  await new Promise(resolve=>server.close(resolve));models.User.findByPk=original.user;models.WithdrawalBeneficiary.findAll=original.list;models.Event.findOne=original.event;sequelize.query=original.query;axios.post=original.post;
  for(const [k,v]of Object.entries(originals))if(v===undefined)delete process.env[k];else process.env[k]=v;
  await sequelize.close();
 }
});
