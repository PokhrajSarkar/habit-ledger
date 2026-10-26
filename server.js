"use strict";
const http=require("node:http"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const PORT=+process.env.PORT||3000,PROD=process.env.NODE_ENV==="production",TRUST=process.env.TRUST_PROXY==="1";
const BASE=(process.env.BASE_URL||`http://localhost:${PORT}`).replace(/\/+$/,"");
const PUB=path.join(__dirname,"public"),store=require("./store")(path.resolve(process.env.DATA_DIR||path.join(__dirname,"data")));
const MAIL_ON=!!(process.env.RESEND_API_KEY&&process.env.MAIL_FROM),MAIL_OK=MAIL_ON||!PROD; // outside production, emails are printed to the console
const G={id:process.env.GOOGLE_CLIENT_ID,secret:process.env.GOOGLE_CLIENT_SECRET,auth:process.env.GOOGLE_AUTH_URL||"https://accounts.google.com/o/oauth2/v2/auth",token:process.env.GOOGLE_TOKEN_URL||"https://oauth2.googleapis.com/token"};
const G_ON=!!(G.id&&G.secret),DAYS30=30*864e5,EMAIL=/^[^@\s]+@[^@\s]+\.[^@\s]+$/;
if(PROD&&(MAIL_ON||G_ON)&&!process.env.BASE_URL)console.warn("Set BASE_URL (for example https://habits.example.com). Email links and Google sign-in need it.");
if(PROD&&!MAIL_ON)console.warn("Email is not configured (RESEND_API_KEY and MAIL_FROM). Password reset and email confirmation are disabled.");
if(PROD&&!process.env.DATABASE_URL)console.warn("DATABASE_URL is not set. Using the JSON file store: run one instance only and back up DATA_DIR.");

// ---- passwords (scrypt, per-user salt, constant-time compare)
const scrypt=(pw,salt)=>new Promise((ok,no)=>crypto.scrypt(pw,salt,64,{N:16384,r:8,p:1,maxmem:64<<20},(e,k)=>e?no(e):ok(k)));
async function hash(pw){const s=crypto.randomBytes(16);return s.toString("hex")+":"+(await scrypt(pw,s)).toString("hex")}
async function verify(pw,stored){const[s,h]=stored.split(":"),k=await scrypt(pw,Buffer.from(s,"hex")),b=Buffer.from(h,"hex");return k.length===b.length&&crypto.timingSafeEqual(k,b)}
let DUMMY;hash("dummy-password").then(h=>{DUMMY=h});

// ---- cookies, sessions, tokens
const sha=s=>crypto.createHash("sha256").update(s).digest("hex"),tok=()=>crypto.randomBytes(32).toString("hex"),TOK=/^[a-f0-9]{64}$/;
const secure=req=>PROD||req.headers["x-forwarded-proto"]==="https";
const ck=(req,name,val,age,p="/")=>`${name}=${val}; HttpOnly; SameSite=Lax; Path=${p}; Max-Age=${age}${secure(req)?"; Secure":""}`;
const addCookie=(res,c)=>res.setHeader("Set-Cookie",[].concat(res.getHeader("Set-Cookie")||[],c));
async function newSession(res,req,uid){const t=tok();await store.addSession(sha(t),uid,Date.now()+DAYS30);addCookie(res,ck(req,"hl_sid",t,DAYS30/1000))}
async function auth(req){const m=/(?:^|;\s*)hl_sid=([a-f0-9]{64})/.exec(req.headers.cookie||"");if(!m)return null;const h=sha(m[1]),s=await store.getSession(h);if(!s)return null;const u=await store.userById(s.uid);return u?{u,t:h}:null}

// ---- rate limiting (in memory, per process)
const hits=new Map();
function limited(k,max,ms){const n=Date.now();let h=hits.get(k);if(!h||h.t<n){h={c:0,t:n+ms};hits.set(k,h)}return++h.c>max}
setInterval(()=>{const n=Date.now();for(const[k,h]of hits)if(h.t<n)hits.delete(k);store.prune().catch(e=>console.error("prune:",e.message))},6e4).unref();
const ip=req=>TRUST?(String(req.headers["x-forwarded-for"]||"").split(",")[0].trim()||req.socket.remoteAddress):req.socket.remoteAddress;

// ---- helpers
function send(res,code,obj){const b=JSON.stringify(obj);res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Content-Length":Buffer.byteLength(b)});res.end(b)}
const fail=(res,c,m)=>send(res,c,{error:m}),esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function body(req,max){return new Promise((ok,no)=>{if(!/^application\/json/i.test(req.headers["content-type"]||""))return no({c:415,m:"Send JSON."});let n=0;const ch=[];req.on("data",d=>{n+=d.length;if(n>max){no({c:413,m:"That request is too large."});req.destroy()}else ch.push(d)});req.on("end",()=>{try{ok(JSON.parse(Buffer.concat(ch).toString()||"{}"))}catch{no({c:400,m:"Invalid JSON."})}});req.on("error",()=>no({c:400,m:"Bad request."}))})}
const pub=u=>({name:u.name,email:u.email,verified:!!u.verified,hasPassword:!!u.pw});
const blank=()=>({habits:[],notes:{}});
function clean(s){
  if(!s||typeof s!=="object"||!Array.isArray(s.habits)||s.habits.length>40)return null;
  const dk=/^\d{4}-\d{2}-\d{2}$/,out=blank(),ids=new Set();
  for(const h of s.habits){
    if(!h||typeof h.name!=="string"||typeof h.id!=="string"||!/^[\w-]{1,32}$/.test(h.id)||ids.has(h.id))return null;
    const name=h.name.trim().slice(0,40);if(!name)return null;
    const days={};let n=0;
    if(h.days&&typeof h.days==="object")for(const k in h.days)if(dk.test(k)&&h.days[k]){days[k]=1;if(++n>3700)return null}
    ids.add(h.id);out.habits.push({id:h.id,name,ink:Number.isInteger(h.ink)&&h.ink>=0&&h.ink<=4?h.ink:0,days});
  }
  const nt=s.notes;
  if(nt&&typeof nt==="object"&&!Array.isArray(nt))for(const k of Object.keys(nt).slice(0,520))if(dk.test(k)&&typeof nt[k]==="string")out.notes[k]=nt[k].slice(0,1000);
  return out;
}

// ---- email (Resend-compatible HTTP API; printed to the console outside production when unconfigured)
async function mail(to,subject,text,html){
  if(!MAIL_ON){if(!PROD)console.log(`\n[dev email] to: ${to}\nsubject: ${subject}\n${text}\n`);return}
  const r=await fetch(process.env.MAIL_API_URL||"https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.MAIL_FROM,to:[to],subject,text,html}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error("email provider returned "+r.status);
}
const tpl=(name,intro,url,label,note)=>({text:`Hi ${name},\n\n${intro}\n\n${url}\n\n${note}\n\nHabit ledger`,html:`<div style="font-family:system-ui,sans-serif;color:#1d2733;max-width:480px"><p>Hi ${esc(name)},</p><p>${esc(intro)}</p><p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#1d2733;color:#fff;text-decoration:none;font-weight:600">${esc(label)}</a></p><p style="color:#58665f">${esc(note)}</p></div>`});
async function sendVerify(u){
  if(!MAIL_OK)return;
  try{await store.clearTokens(u.id,"verify");const t=tok();await store.addToken(sha(t),u.id,"verify",Date.now()+864e5);
    const m=tpl(u.name,"Confirm your email address to finish setting up your Habit ledger account.",`${BASE}/#verify=${t}`,"Confirm my email","This link works for 24 hours. If you didn't create an account, ignore this email.");
    await mail(u.email,"Confirm your email",m.text,m.html)}
  catch(e){console.error("verification email failed:",e.message)}
}

// ---- account API
async function register(req,res){
  if(limited("reg:"+ip(req),10,36e5))return fail(res,429,"Too many sign-ups from this network. Try again later.");
  const b=(await body(req,4096))||{},name=String(b.name||"").trim(),email=String(b.email||"").trim().toLowerCase(),pw=String(b.password||"");
  if(!name||name.length>40)return fail(res,400,"Enter your name (up to 40 characters).");
  if(email.length>254||!EMAIL.test(email))return fail(res,400,"Enter a valid email address.");
  if(pw.length<8||pw.length>128)return fail(res,400,"Use a password between 8 and 128 characters.");
  const u={id:crypto.randomUUID(),name,email,pw:await hash(pw),googleSub:null,verified:false,created:Date.now(),data:blank()};
  try{await store.createUser(u)}catch(e){if(e.dup)return fail(res,409,"An account with that email already exists. Try signing in.");throw e}
  await newSession(res,req,u.id);sendVerify(u);send(res,201,{user:pub(u),state:u.data});
}
async function login(req,res){
  const b=(await body(req,4096))||{},email=String(b.email||"").trim().toLowerCase(),pw=String(b.password||"").slice(0,128);
  if(limited("login:"+ip(req),20,9e5)||limited("loginE:"+email,8,9e5))return fail(res,429,"Too many attempts. Wait a few minutes and try again.");
  const u=await store.userByEmail(email),ok=await verify(pw,u&&u.pw?u.pw:(DUMMY||await hash("x")));
  if(!u||!u.pw||!ok)return fail(res,401,"Email or password is incorrect.");
  await newSession(res,req,u.id);send(res,200,{user:pub(u),state:u.data});
}
async function logout(req,res){const a=await auth(req);if(a)await store.delSession(a.t);addCookie(res,ck(req,"hl_sid","",0));send(res,200,{ok:true})}
async function me(req,res,a){send(res,200,{user:pub(a.u),state:a.u.data})}
async function putState(req,res,a){const s=clean(await body(req,1<<20));if(!s)return fail(res,400,"That ledger data isn't valid.");await store.updateUser(a.u.id,{data:s});send(res,200,{ok:true})}
async function delAccount(req,res,a){
  const b=(await body(req,4096))||{};
  if(limited("del:"+a.u.id,5,9e5))return fail(res,429,"Too many attempts. Wait a few minutes.");
  const ok=a.u.pw?await verify(String(b.password||"").slice(0,128),a.u.pw):String(b.confirm||"").trim().toLowerCase()===a.u.email;
  if(!ok)return fail(res,403,a.u.pw?"That password is incorrect.":"That email doesn't match your account.");
  await store.deleteUser(a.u.id);addCookie(res,ck(req,"hl_sid","",0));send(res,200,{ok:true});
}
async function forgot(req,res){
  if(!MAIL_OK)return fail(res,503,"Password reset isn't available right now.");
  const b=(await body(req,4096))||{},email=String(b.email||"").trim().toLowerCase();
  if(limited("fg:"+ip(req),10,36e5)||limited("fgE:"+email,3,36e5))return fail(res,429,"Too many reset requests. Try again later.");
  if(!EMAIL.test(email))return fail(res,400,"Enter a valid email address.");
  const u=await store.userByEmail(email);
  if(u)(async()=>{try{await store.clearTokens(u.id,"reset");const t=tok();await store.addToken(sha(t),u.id,"reset",Date.now()+36e5);
    const m=tpl(u.name,"We got a request to reset your Habit ledger password. The link works once, for one hour.",`${BASE}/#reset=${t}`,"Choose a new password","If you didn't ask for this, ignore this email. Your password won't change.");
    await mail(u.email,"Reset your password",m.text,m.html)}catch(e){console.error("reset email failed:",e.message)}})();
  send(res,200,{ok:true}); // same answer whether or not the account exists
}
async function reset(req,res){
  const b=(await body(req,4096))||{},t=String(b.token||""),pw=String(b.password||"");
  if(limited("rs:"+ip(req),10,36e5))return fail(res,429,"Too many attempts. Try again later.");
  if(pw.length<8||pw.length>128)return fail(res,400,"Use a password between 8 and 128 characters.");
  const bad="This reset link is invalid or has expired. Request a new one.",row=TOK.test(t)?await store.takeToken(sha(t),"reset"):null;
  if(!row)return fail(res,400,bad);
  const u=await store.updateUser(row.uid,{pw:await hash(pw),verified:true});
  if(!u)return fail(res,400,bad);
  await store.delSessionsOf(u.id);await newSession(res,req,u.id);send(res,200,{user:pub(u),state:u.data});
}
async function verifyEmail(req,res){
  const b=(await body(req,4096))||{},t=String(b.token||"");
  if(limited("vf:"+ip(req),20,36e5))return fail(res,429,"Too many attempts. Try again later.");
  const row=TOK.test(t)?await store.takeToken(sha(t),"verify"):null;
  if(!row)return fail(res,400,"This confirmation link is invalid or has expired. Sign in and ask for a new one.");
  await store.updateUser(row.uid,{verified:true});send(res,200,{ok:true});
}
async function resend(req,res,a){
  if(!MAIL_OK)return fail(res,503,"Email isn't available right now.");
  if(a.u.verified)return send(res,200,{ok:true,already:true});
  if(limited("rv:"+a.u.id,3,36e5))return fail(res,429,"You've asked for several emails. Check your inbox and spam folder, or try again later.");
  sendVerify(a.u);send(res,200,{ok:true});
}
const API={
  "GET /api/config":[0,async(req,res)=>send(res,200,{mail:MAIL_OK,google:G_ON})],
  "POST /api/register":[0,register],"POST /api/login":[0,login],"POST /api/logout":[0,logout],
  "POST /api/forgot":[0,forgot],"POST /api/reset":[0,reset],"POST /api/verify":[0,verifyEmail],
  "GET /api/me":[1,me],"PUT /api/state":[1,putState],"DELETE /api/account":[1,delAccount],"POST /api/resend-verification":[1,resend]
};
async function api(req,res,url){
  const r=API[req.method+" "+url.pathname];if(!r)return fail(res,404,"Not found.");
  if(req.method!=="GET"&&req.headers.origin){let bad=true;try{bad=new URL(req.headers.origin).host!==req.headers.host}catch{}if(bad)return fail(res,403,"Cross-origin request blocked.")}
  if(limited("api:"+ip(req),300,6e4))return fail(res,429,"Slow down a little.");
  let a=null;if(r[0]){a=await auth(req);if(!a)return fail(res,401,"Please sign in.")}
  await r[1](req,res,a);
}

// ---- Google sign-in (authorization-code flow; the secret and token exchange stay on the server)
function gStart(req,res){
  if(!G_ON){res.writeHead(404);return res.end()}
  const st=crypto.randomBytes(16).toString("hex");addCookie(res,ck(req,"hl_oauth",st,600,"/auth/google"));
  const q=new URLSearchParams({client_id:G.id,redirect_uri:BASE+"/auth/google/callback",response_type:"code",scope:"openid email profile",state:st,prompt:"select_account"});
  res.writeHead(302,{Location:G.auth+"?"+q,"Cache-Control":"no-store"});res.end();
}
async function gCallback(req,res,url){
  const back=h=>{res.writeHead(302,{Location:"/#"+h,"Cache-Control":"no-store"});res.end()};
  if(!G_ON){res.writeHead(404);return res.end()}
  if(limited("oa:"+ip(req),30,9e5))return back("error=google_limited");
  const m=/(?:^|;\s*)hl_oauth=([a-f0-9]{32})/.exec(req.headers.cookie||""),st=url.searchParams.get("state"),code=url.searchParams.get("code");
  addCookie(res,ck(req,"hl_oauth","",0,"/auth/google"));
  if(!m||!st||m[1]!==st)return back("error=google_state");
  if(url.searchParams.get("error")||!code)return back("error=google_cancelled");
  let p;
  try{
    const r=await fetch(G.token,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:G.id,client_secret:G.secret,redirect_uri:BASE+"/auth/google/callback",grant_type:"authorization_code"}),signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw new Error("token endpoint returned "+r.status);
    p=JSON.parse(Buffer.from(String((await r.json()).id_token).split(".")[1],"base64url").toString()); // received straight from Google over TLS
  }catch(e){console.error("google sign-in failed:",e.message);return back("error=google_failed")}
  if(!["https://accounts.google.com","accounts.google.com"].includes(p.iss)||p.aud!==G.id||!(p.exp*1000>Date.now())||p.email_verified!==true||!p.sub||!EMAIL.test(p.email||""))return back("error=google_failed");
  const email=p.email.toLowerCase(),sub=String(p.sub);
  let u=await store.userByGoogle(sub);
  if(!u){
    u=await store.userByEmail(email);
    if(u){
      // An unconfirmed password account could have been pre-registered by someone else with this email: drop its password and sessions.
      if(!u.verified){await store.delSessionsOf(u.id);u=await store.updateUser(u.id,{pw:null,googleSub:sub,verified:true})}
      else u=await store.updateUser(u.id,{googleSub:sub});
    }else{
      u={id:crypto.randomUUID(),name:String(p.name||email.split("@")[0]).trim().slice(0,40)||"Friend",email,pw:null,googleSub:sub,verified:true,created:Date.now(),data:blank()};
      try{await store.createUser(u)}catch(e){if(e.dup)return back("error=google_failed");throw e}
    }
  }
  await newSession(res,req,u.id);res.writeHead(302,{Location:"/","Cache-Control":"no-store"});res.end();
}

// ---- static files + security headers
const SEC={"X-Content-Type-Options":"nosniff","Referrer-Policy":"same-origin","X-Frame-Options":"DENY","Permissions-Policy":"camera=(), microphone=(), geolocation=()","Cross-Origin-Opener-Policy":"same-origin",
"Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"};
if(PROD)SEC["Strict-Transport-Security"]="max-age=15552000";
const MIME={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon",".txt":"text/plain; charset=utf-8"};
function serve(req,res,url){
  if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405,{Allow:"GET, HEAD"});return res.end()}
  let p;try{p=decodeURIComponent(url.pathname)}catch{res.writeHead(400);return res.end()}
  if(p==="/")p="/index.html";
  const f=path.join(PUB,path.normalize(p));
  if(!f.startsWith(PUB+path.sep)||p.split("/").some(s=>s.startsWith("."))){res.writeHead(404,{"Content-Type":"text/plain"});return res.end("Not found")}
  fs.stat(f,(e,st)=>{
    if(e||!st.isFile()){res.writeHead(404,{"Content-Type":"text/plain"});return res.end("Not found")}
    const et=`W/"${st.size}-${st.mtimeMs}"`,h={"Content-Type":MIME[path.extname(f)]||"application/octet-stream",ETag:et,"Cache-Control":f.endsWith(".html")?"no-cache":"public, max-age=300"};
    if(req.headers["if-none-match"]===et){res.writeHead(304,h);return res.end()}
    res.writeHead(200,{...h,"Content-Length":st.size});if(req.method==="HEAD")return res.end();fs.createReadStream(f).pipe(res);
  });
}
const server=http.createServer(async(req,res)=>{
  for(const k in SEC)res.setHeader(k,SEC[k]);
  try{
    const url=new URL(req.url,"http://x");
    if(url.pathname==="/healthz"){res.writeHead(200,{"Content-Type":"text/plain"});return res.end("ok")}
    if(url.pathname.startsWith("/api/"))await api(req,res,url);
    else if(req.method==="GET"&&url.pathname==="/auth/google")gStart(req,res);
    else if(req.method==="GET"&&url.pathname==="/auth/google/callback")await gCallback(req,res,url);
    else serve(req,res,url);
  }catch(e){
    if(e&&e.c)return fail(res,e.c,e.m);
    console.error(e);if(!res.headersSent)fail(res,500,"Something went wrong on our side. Try again.");else res.end();
  }
});
server.requestTimeout=15000;
server.listen(PORT,()=>console.log(`Habit ledger listening on :${PORT} (${PROD?"production":"development"}, storage: ${store.kind}, email: ${MAIL_ON?"on":PROD?"off":"console"}, google: ${G_ON?"on":"off"})`));
for(const s of["SIGINT","SIGTERM"])process.on(s,()=>{server.close();store.close().catch(e=>console.error(e)).then(()=>process.exit(0))});
