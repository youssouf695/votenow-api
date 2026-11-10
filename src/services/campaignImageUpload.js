const crypto = require('node:crypto');
const axios = require('axios');
const fail = (message, status, code) => Object.assign(new Error(message), { status, code });
const clean = value => typeof value === 'string' ? value.trim() : '';

function configuration(env = process.env) {
  let parsed = {};
  if (clean(env.CLOUDINARY_URL)) {
    try {
      const url = new URL(clean(env.CLOUDINARY_URL));
      if (url.protocol !== 'cloudinary:') throw Error();
      parsed = { cloud: url.hostname, key: decodeURIComponent(url.username), secret: decodeURIComponent(url.password) };
    } catch {
      return { ready: false, mode: null, missing: [], invalid: ['CLOUDINARY_URL'] };
    }
  }
  const cloud = clean(env.CLOUDINARY_CLOUD_NAME) || parsed.cloud || clean(env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME);
  const key = clean(env.CLOUDINARY_API_KEY) || parsed.key || '';
  const secret = clean(env.CLOUDINARY_API_SECRET) || parsed.secret || '';
  const preset = clean(env.CLOUDINARY_UPLOAD_PRESET) || clean(env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET);
  // Prefer signed uploads. An explicitly configured unsigned preset also supports
  // the existing category uploader; never downgrade after a provider rejection.
  const mode = key || secret ? 'signed' : preset ? 'unsigned' : 'signed';
  const missing = [];
  if (!cloud) missing.push('CLOUDINARY_CLOUD_NAME');
  if (mode === 'signed') {
    if (!key) missing.push('CLOUDINARY_API_KEY');
    if (!secret) missing.push('CLOUDINARY_API_SECRET');
  } else if (!preset) missing.push('CLOUDINARY_UPLOAD_PRESET');
  const invalid = cloud && !/^[a-z0-9_-]+$/i.test(cloud) ? ['CLOUDINARY_CLOUD_NAME'] : [];
  return { ready: !missing.length && !invalid.length, mode, cloud, key, secret, preset, missing, invalid };
}

function imageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP') return 'image/webp';
  return null;
}

async function upload(buffer, mimeHeader, eventId, kind) {
  const mime = imageType(buffer);
  if (!mime || mime !== mimeHeader?.split(';')[0].trim().toLowerCase()) throw fail('Choisissez une image JPEG, PNG ou WebP.',415,'IMAGE_FORMAT_INVALID');
  if (buffer.length > 5 * 1024 * 1024) throw fail('Image trop volumineuse (5 Mo maximum).',413,'IMAGE_TOO_LARGE');
  if (!['gallery','partners','applications'].includes(kind) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(eventId)) throw fail('Destination d’image invalide.',400,'IMAGE_DESTINATION_INVALID');
  const c = configuration();
  if (!c.ready) {
    console.error('[images.configuration]', { missing: c.missing, invalid: c.invalid });
    throw fail('Le service d’images n’est pas configuré sur le serveur. Contactez l’administrateur.',503,'IMAGE_SERVICE_NOT_CONFIGURED');
  }
  const folder = `votenow/${kind}/${eventId}`;
  const form = new FormData();
  form.append('file',new Blob([buffer],{type:mime}),'image');
  form.append('folder',folder);
  if (c.mode === 'signed') {
    const timestamp = Math.floor(Date.now()/1000);
    const transformation = 'c_limit,h_1600,w_1600/f_webp/fl_strip_profile';
    const signature = crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}&transformation=${transformation}${c.secret}`).digest('hex');
    for (const [key,value] of Object.entries({ timestamp, transformation, api_key:c.key, signature })) form.append(key,String(value));
  } else {
    // Unsigned uploads reject arbitrary transformations. Configure transformations
    // on the existing Cloudinary preset instead, as for category images.
    form.append('upload_preset',c.preset);
  }
  try {
    const response = await axios.post(`https://api.cloudinary.com/v1_1/${c.cloud}/image/upload`,form,{
      timeout:30000,maxRedirects:0,maxContentLength:1024*1024,maxBodyLength:6*1024*1024
    });
    const url = new URL(response.data.secure_url);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.port || !url.pathname.startsWith(`/${c.cloud}/`) || url.username || url.password) throw Error('IMAGE_RESPONSE_INVALID');
    return url.href;
  } catch (error) {
    const reference = crypto.randomUUID();
    const http = error.response?.status || null;
    const code = http === 401 || http === 403 ? 'IMAGE_PROVIDER_AUTH' : http === 400 ? 'IMAGE_PROVIDER_REQUEST' : 'IMAGE_PROVIDER_UNAVAILABLE';
    // Do not log Axios objects, credentials or provider payloads.
    console.error('[images.upload]', { reference, http, code, mode:c.mode });
    const message = http === 400 || http === 401 || http === 403
      ? 'La configuration du service d’images a été refusée. Contactez l’administrateur avec cette référence.'
      : 'Envoi de l’image impossible. Veuillez réessayer ou contacter le support avec cette référence.';
    throw Object.assign(fail(message,503,'IMAGE_UPLOAD_FAILED'),{reference});
  }
}
module.exports = { configuration, imageType, upload };
