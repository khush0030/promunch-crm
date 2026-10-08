// Mint a short-lived read-only dashboard session (owner-approved, memory browser-check-test-login).
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.argv[2],'utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^"|"$/g,'')]}));
const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY, anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const r = await fetch(`${url}/auth/v1/admin/generate_link`, {method:'POST', headers:{apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json'}, body: JSON.stringify({type:'magiclink', email:'kmutha@vippysoya.com'})});
if (!r.ok) { console.error("generate_link", r.status, (await r.text()).slice(0,120)); process.exit(1); }
const j = await r.json(); const tok = j.hashed_token || j.properties?.hashed_token;
const v = await fetch(`${url}/auth/v1/verify`, {method:'POST', headers:{apikey:anon,'Content-Type':'application/json'}, body: JSON.stringify({type:'magiclink', token_hash: tok})});
if (!v.ok) { console.error("verify", v.status, (await v.text()).slice(0,120)); process.exit(1); }
const s = await v.json(); if (!s.access_token) { console.error('fail', JSON.stringify(s).slice(0,300)); process.exit(1); }
const ref = new URL(url).hostname.split('.')[0];
const val = 'base64-' + Buffer.from(JSON.stringify(s)).toString('base64url');
const cookies = []; const N = 3180;
if (val.length <= N) cookies.push({name:`sb-${ref}-auth-token`, value: val});
else for (let i=0;i*N<val.length;i++) cookies.push({name:`sb-${ref}-auth-token.${i}`, value: val.slice(i*N,(i+1)*N)});
fs.writeFileSync(process.argv[3], JSON.stringify({ uid: s.user.id, cookies: cookies.map(c=>({...c, domain:'localhost', path:'/', sameSite:'Lax'})) }));
console.log('ok', cookies.length, 'cookie(s)');
