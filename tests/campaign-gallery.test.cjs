const {test}=require('node:test'),assert=require('node:assert/strict');
const {settings}=require('../src/services/campaignSettings');
test('gallery persists ordered HTTPS images, captions and sound triggers',()=>{
 const gallery=[{image_url:'https://example.invalid/a.jpg',caption:' Première '},{image_url:'https://example.invalid/b.webp',caption:''}];
 const result=settings({template_id:'cinema',gallery,sound:'sparkle',sound_entry:false,sound_selection:true,sound_success:false,show_gallery:false});
 assert.deepEqual(result.gallery,[{...gallery[0],caption:'Première'},gallery[1]]);assert.equal(result.sound_entry,false);assert.equal(result.sound_selection,true);assert.equal(result.sound_success,false);assert.equal(result.show_gallery,false);
});
test('gallery rejects excessive, malformed, unsafe and credential-bearing images',()=>{
 for(const gallery of [Array(31).fill({image_url:'https://example.invalid/a'}),[null],[{image_url:'javascript:alert(1)'}],[{image_url:'http://example.invalid/a'}],[{image_url:'https://a:b@example.invalid/a'}],[{image_url:''}],[{image_url:'https://example.invalid/a',caption:'a'.repeat(201)}]])assert.throws(()=>settings({template_id:'cinema',gallery}),e=>e.status===400);
});
test('existing presentation without gallery remains compatible and sound flags validate types',()=>{
 const result=settings({template_id:'cinema'});assert.deepEqual(result.gallery,[]);assert.equal(result.show_gallery,true);
 for(const key of ['sound_entry','sound_selection','sound_success'])assert.throws(()=>settings({template_id:'cinema',[key]:'false'}),e=>e.status===400);
});
