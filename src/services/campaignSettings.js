const crypto = require('node:crypto');
const templates = require('../config/templates.json');
function invalid(message) { return Object.assign(new Error(message), { status: 400 }); }
function text(value, max, label, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw invalid(`${label} invalide`);
  return value.trim();
}
function safeUrl(value, label) {
  if (!value) return null;
  if (typeof value !== 'string' || value.length > 2048) throw invalid(`${label} invalide`);
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) throw Error(); return url.href; }
  catch { throw invalid(`${label} : adresse HTTPS requise`); }
}
function settings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Présentation invalide');
  const template = templates.find(t => t.id === input.template_id);
  if (!template) throw invalid('Modèle de campagne inconnu');
  const result = { version: 1, template_id: template.id };
  for (const key of ['background','text','accent']) {
    const value = input[key] || template[key];
    if (typeof value !== 'string' || !/^#[a-f0-9]{6}$/i.test(value)) throw invalid('Couleur invalide');
    result[key] = value;
  }
  for (const [key, allowed, fallback] of [
    ['shape',['square','rounded','round','portrait','arch','landscape'],template.shape],
    ['font',['sans','serif'],template.font],
    ['shadow',['none','soft','dramatic','glow'],template.shadow||'soft'],
    ['hero_layout',['overlay-left','overlay-center','split'],template.hero_layout],
    ['card_style',['minimal','poster','detailed'],template.card_style],
    ['podium_style',['steps','spotlight','editorial'],template.podium_style],
    ['cover_position',['top','center','bottom'],template.cover_position],
    ['decoration',['plain','glow','mesh','confetti','lattice'],template.decoration||'glow'],
    ['sound',['none','calm','bright','soft','sparkle','fanfare','marimba','pulse','chime','celebrate'],'none'],
  ]) { const value=input[key] || fallback; if (!allowed.includes(value)) throw invalid(`${key} invalide`); result[key]=value; }
  for (const key of ['show_ranking','show_counts']) { if (input[key] !== undefined && typeof input[key] !== 'boolean') throw invalid(`${key} invalide`); result[key] = input[key] !== false; }
  for(const key of ['show_podium','show_leader','show_categories','show_slogan','show_category_labels','show_vote_button','show_share_button','show_candidate_number','show_hero_stats']) {
    if(input[key]!==undefined&&typeof input[key]!=='boolean')throw invalid(`${key} invalide`);
    result[key]=typeof input[key]==='boolean'?input[key]:template[key]!==false;
  }
  const overlay=input.hero_overlay??template.hero_overlay;
  if(!Number.isInteger(overlay)||overlay<35||overlay>85)throw invalid('Opacité de couverture invalide');
  result.hero_overlay=overlay;
  result.header_text = text(input.header_text ?? '', 240, 'Texte d’accueil');
  result.footer_text = text(input.footer_text ?? '', 500, 'Pied de page');
  if (input.gallery !== undefined && (!Array.isArray(input.gallery) || input.gallery.length > 30)) throw invalid('Maximum 30 images dans la galerie');
  result.gallery = (input.gallery || []).map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid('Image de galerie invalide');
    const image_url = safeUrl(row.image_url, 'Image de galerie');
    if (!image_url) throw invalid('Image de galerie requise');
    return { image_url, caption: text(row.caption ?? '', 200, 'Légende') };
  });
  if (input.show_gallery !== undefined && typeof input.show_gallery !== 'boolean') throw invalid('show_gallery invalide');
  result.show_gallery = input.show_gallery !== false;
  for (const key of ['sound_entry','sound_selection','sound_success']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw invalid(`${key} invalide`);
    result[key] = input[key] !== false;
  }
  return result;
}
function categories(input) {
  if (!Array.isArray(input) || input.length > 100) throw invalid('Maximum 100 catégories');
  const names=new Set(), ids=new Set();
  return input.map((row,index) => {
    const name=text(row.name,100,'Nom de catégorie',true);
    if (names.has(name.toLowerCase())) throw invalid('Catégorie dupliquée'); names.add(name.toLowerCase());
    const id=row.id || crypto.randomUUID();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) || ids.has(id)) throw invalid('Identifiant catégorie invalide'); ids.add(id);
    return {id,name,position:index};
  });
}
function partners(input) {
  if (!Array.isArray(input) || input.length > 100) throw invalid('Maximum 100 partenaires');
  return input.map(row=>({name:text(row.name,150,'Nom partenaire',true),logo_url:safeUrl(row.logo_url,'Logo'),website:safeUrl(row.website,'Site partenaire'),contact:text(row.contact ?? '',200,'Contact partenaire')}));
}
module.exports={settings,categories,partners,safeUrl};

