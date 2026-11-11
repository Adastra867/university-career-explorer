import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const digest = token => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password) {
 const salt=randomBytes(16).toString('hex');
 return salt+':'+(await derive(password,salt,64)).toString('hex');
}
export async function verifyPassword(password,encoded) {
 const [salt,hash]=encoded.split(':');
 const key=await derive(password,salt,64); const expected=Buffer.from(hash,'hex');
 return expected.length===key.length && timingSafeEqual(key,expected);
}
export const sessionToken=()=>randomBytes(32).toString('hex');
export function readCookie(req) {
 return (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('career_session='))?.slice(15) || '';
}
export function setCookie(res,token) {
 res.cookie('career_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:7*86400000});
}
export function sameOrigin(req,res,next) {
 if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
  const origin=req.get('origin');
  const expected=process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
  if (req.get('sec-fetch-site')==='cross-site' || (origin && origin!==expected)) return res.status(403).json({code:'ORIGIN_REJECTED',error:'请求来源不受信任'});
 }
 next();
}
