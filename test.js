"use strict";
// End-to-end checks. Boots the server against fake email and Google endpoints.
// Uses the JSON file store by default; set DATABASE_URL (a scratch database!) to run the same checks on Postgres.
const {spawn}=require("node:child_process"),http=require("node:http"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const R=()=>4000+Math.floor(Math.random()*5000),PORT=R(),MP=PORT+1,GP=PORT+2,BASE=`http://127.0.0.1:${PORT}`;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hl-")),mails=[],codes=new Map();
let pass=0,bad=0;const ok=(n,c)=>{c?pass++:bad++;console.log((c?"  ok   ":"  FAIL ")+n)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const readBody=req=>new Promise(r=>{let s="";req.on("data",d=>s+=d);req.on("end",()=>r(s))});
const mailSrv=http.createServer(async(req,res)=>{mails.push(JSON.parse(await readBody(req)));res.writeHead(200,{"Content-Type":"application/json"});res.end("{}")}).listen(MP);
const jwt=p=>["e30",Buffer.from(JSON.stringify(p)).toString("base64url"),"sig"].join(".");
const gSrv=http.createServer(async(req,res)=>{
  const f=new URLSearchParams(await readBody(req)),p=codes.get(f.get("code"));
  if(!p||f.get("client_secret")!=="shh"||f.get("client_id")!=="test-client"){res.writeHead(400);return res.end("{}")}
  res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({id_token:jwt(p)}));
}).listen(GP);
const srv=spawn("node",["server.js"],{env:{...process.env,PORT,DATA_DIR:dir,NODE_ENV:"test",BASE_URL:BASE,RESEND_API_KEY:"k",MAIL_FROM:"Habit ledger <no-reply@example.com>",MAIL_API_URL:`http://127.0.0.1:${MP}/emails`,GOOGLE_CLIENT_ID:"test-client",GOOGLE_CLIENT_SECRET:"shh",GOOGLE_AUTH_URL:`http://127.0.0.1:${GP}/auth`,GOOGLE_TOKEN_URL:`http://127.0.0.1:${GP}/token`},stdio:"inherit"});
async function call(m,p,b,ck,h){const r=await fetch(BASE+p,{method:m,headers:{...(b?{"Content-Type":"application/json"}:{}),...(ck?{Cookie:ck}:{}),...h},body:b?JSON.stringify(b):undefined,redirect:"manual"});
  const sc=r.headers.get("set-cookie");let j={};try{j=await r.json()}catch{}return{s:r.status,j,ck:sc?sc.split(";")[0]:null,raw:sc}}
async function mailTo(to,kind){for(let i=0;i<30;i++){const m=[...mails].reverse().find(x=>x.to[0]===to&&new RegExp("#"+kind+"=").test(x.text));if(m)return/#\w+=([a-f0-9]{64})/.exec(m.text)[1];await sleep(100)}return null}
let n=0;
async function google(profile){
  const a=await fetch(BASE+"/auth/google",{redirect:"manual"}),loc=new URL(a.headers.get("location")),state=loc.searchParams.get("state"),oc=a.headers.get("set-cookie").split(";")[0],code="c"+(++n);
  codes.set(code,{iss:"https://accounts.google.com",aud:"test-client",exp:Math.floor(Date.now()/1000)+3600,email_verified:true,...profile});
  const c=await fetch(`${BASE}/auth/google/callback?code=${code}&state=${state}`,{redirect:"manual",headers:{Cookie:oc}});
  const sid=c.headers.getSetCookie().map(x=>x.split(";")[0]).find(x=>x.startsWith("hl_sid=")&&x.length>10);
  return{loc:c.headers.get("location"),ck:sid||null,authLoc:loc};
}
(async()=>{
  for(let i=0;i<60;i++){try{if((await fetch(BASE+"/healthz")).ok)break}catch{}await sleep(100)}
  const u={name:"Maya Rao",email:"Maya@Example.com",password:"correct horse 9"};
  ok("config reports email and Google enabled",JSON.stringify((await call("GET","/api/config")).j)==='{"mail":true,"google":true}');
  // --- accounts
  let r=await call("POST","/api/register",u);const ck=r.ck;
  ok("register creates an unverified account",r.s===201&&r.j.user.email==="maya@example.com"&&r.j.user.verified===false);
  ok("session cookie is HttpOnly + SameSite",/HttpOnly/.test(r.raw)&&/SameSite=Lax/.test(r.raw));
  ok("password is never returned",!JSON.stringify(r.j).includes("correct horse"));
  ok("duplicate email rejected (409)",(await call("POST","/api/register",u)).s===409);
  ok("short password rejected (400)",(await call("POST","/api/register",{...u,email:"b@example.com",password:"short"})).s===400);
  ok("bad email rejected (400)",(await call("POST","/api/register",{...u,email:"nope"})).s===400);
  ok("/api/me needs a session",(await call("GET","/api/me")).s===401&&(await call("GET","/api/me",null,ck)).j.user.name==="Maya Rao");
  const st={habits:[{id:"h1",name:"Read 20 pages",ink:2,days:{"2026-10-25":1,"2026-10-26":1,"bogus":1}}],notes:{"2026-10-19":"good week"}};
  ok("save state (200)",(await call("PUT","/api/state",st,ck)).s===200);
  const back=(await call("GET","/api/me",null,ck)).j.state;
  ok("state round-trips and bad keys are stripped",back.habits[0].days["2026-10-26"]===1&&!("bogus" in back.habits[0].days)&&back.notes["2026-10-19"]==="good week");
  ok("invalid state rejected (400)",(await call("PUT","/api/state",{habits:"x"},ck)).s===400);
  ok("state without a session is 401",(await call("PUT","/api/state",st)).s===401);
  ok("cross-origin write blocked (403)",(await call("PUT","/api/state",st,ck,{Origin:"https://evil.example"})).s===403);
  ok("non-JSON body rejected (415)",(await fetch(BASE+"/api/login",{method:"POST",headers:{"Content-Type":"text/plain"},body:"x"})).status===415);
  // --- email confirmation
  const vt=await mailTo("maya@example.com","verify");
  ok("registration sends a confirmation email with a one-time link",!!vt);
  ok("a bad confirmation token is rejected",(await call("POST","/api/verify",{token:"0".repeat(64)})).s===400);
  ok("confirmation link verifies the account",(await call("POST","/api/verify",{token:vt})).s===200&&(await call("GET","/api/me",null,ck)).j.user.verified===true);
  ok("confirmation link works only once",(await call("POST","/api/verify",{token:vt})).s===400);
  ok("resend needs a session",(await call("POST","/api/resend-verification",{})).s===401);
  ok("resend on a verified account is a no-op",(await call("POST","/api/resend-verification",{},ck)).j.already===true);
  // --- password reset
  const before=mails.length;
  ok("forgot answers 200 for an unknown email",(await call("POST","/api/forgot",{email:"ghost@example.com"})).s===200);
  await sleep(300);ok("...and sends no email",mails.length===before);
  ok("forgot answers 200 for a real email",(await call("POST","/api/forgot",{email:"maya@example.com"})).s===200);
  const rt=await mailTo("maya@example.com","reset");ok("reset email contains a one-time link",!!rt);
  ok("bad reset token rejected (400)",(await call("POST","/api/reset",{token:"f".repeat(64),password:"brand new pw 1"})).s===400);
  ok("short new password rejected and does not burn the token",(await call("POST","/api/reset",{token:rt,password:"short"})).s===400);
  r=await call("POST","/api/reset",{token:rt,password:"brand new pw 1"});
  ok("reset sets the password and signs the user in",r.s===200&&!!r.ck&&r.j.state.habits.length===1);
  const ck2=r.ck;
  ok("reset signs out older sessions",(await call("GET","/api/me",null,ck)).s===401&&(await call("GET","/api/me",null,ck2)).s===200);
  ok("reset link works only once",(await call("POST","/api/reset",{token:rt,password:"another pw 123"})).s===400);
  ok("old password no longer works",(await call("POST","/api/login",{email:u.email,password:u.password})).s===401);
  r=await call("POST","/api/login",{email:"MAYA@example.com",password:"brand new pw 1"});
  ok("new password works (email is case-insensitive)",r.s===200);
  ok("logout clears the session",(await call("POST","/api/logout",{},r.ck)).s===200&&(await call("GET","/api/me",null,r.ck)).s===401);
  ok("wrong and unknown logins give the same error",(await call("POST","/api/login",{email:u.email,password:"nope-nope-1"})).j.error==="Email or password is incorrect."&&(await call("POST","/api/login",{email:"ghost@example.com",password:"nope-nope-1"})).j.error==="Email or password is incorrect.");
  // --- Google
  let g=await google({sub:"g-100",email:"Sam@Example.com",name:"Sam Lee"});
  ok("Google start redirects to the provider with client id, state and callback",g.authLoc.searchParams.get("client_id")==="test-client"&&g.authLoc.searchParams.get("redirect_uri")===BASE+"/auth/google/callback"&&g.authLoc.searchParams.get("state").length===32);
  let me=g.ck&&(await call("GET","/api/me",null,g.ck)).j;
  ok("new Google user is created, verified, with no password",g.loc==="/"&&me.user.email==="sam@example.com"&&me.user.verified===true&&me.user.hasPassword===false);
  ok("Google user can save data",(await call("PUT","/api/state",st,g.ck)).s===200);
  g=await google({sub:"g-100",email:"sam@example.com",name:"Sam Lee"});
  ok("same Google account signs back into the same ledger",(await call("GET","/api/me",null,g.ck)).j.state.habits.length===1);
  ok("password login is refused for a Google-only account",(await call("POST","/api/login",{email:"sam@example.com",password:"anything-at-all"})).s===401);
  const sg=g.ck;
  ok("Google-only account can be deleted by typing its email",(await call("DELETE","/api/account",{confirm:"wrong@example.com"},sg)).s===403&&(await call("DELETE","/api/account",{confirm:"SAM@example.com"},sg)).s===200);
  // state / error handling
  const a=await fetch(BASE+"/auth/google",{redirect:"manual"});
  let c=await fetch(`${BASE}/auth/google/callback?code=zzz&state=${"a".repeat(32)}`,{redirect:"manual",headers:{Cookie:a.headers.get("set-cookie").split(";")[0]}});
  ok("callback with a mismatched state is rejected",c.headers.get("location")==="/#error=google_state"&&!c.headers.getSetCookie().some(x=>/^hl_sid=[a-f0-9]{64}/.test(x)));
  c=await fetch(`${BASE}/auth/google/callback?code=zzz&state=${"a".repeat(32)}`,{redirect:"manual"});
  ok("callback without the state cookie is rejected",c.headers.get("location")==="/#error=google_state");
  g=await google({sub:"g-200",email:"unverified@example.com",email_verified:false});
  ok("Google emails that are not verified are refused",g.ck===null&&g.loc==="/#error=google_failed");
  g=await google({sub:"g-300",email:"x@example.com",aud:"someone-else"});
  ok("tokens for a different client id are refused",g.ck===null&&g.loc==="/#error=google_failed");
  // linking
  r=await call("POST","/api/register",{name:"Ben",email:"ben@example.com",password:"ben's password 1"});
  const bt=await mailTo("ben@example.com","verify");await call("POST","/api/verify",{token:bt});
  g=await google({sub:"g-400",email:"ben@example.com",name:"Ben"});
  ok("Google links to an existing verified account and keeps its password",(await call("GET","/api/me",null,g.ck)).j.user.hasPassword===true&&(await call("POST","/api/login",{email:"ben@example.com",password:"ben's password 1"})).s===200);
  // pre-hijack protection
  r=await call("POST","/api/register",{name:"Victim",email:"victim@example.com",password:"attacker knows this 1"});const hj=r.ck;
  await call("PUT","/api/state",st,hj);
  g=await google({sub:"g-500",email:"victim@example.com",name:"Victim"});
  ok("Google sign-in into an unconfirmed password account removes that password",(await call("POST","/api/login",{email:"victim@example.com",password:"attacker knows this 1"})).s===401);
  ok("...and signs out the sessions created with it",(await call("GET","/api/me",null,hj)).s===401&&(await call("GET","/api/me",null,g.ck)).j.user.verified===true);
  // --- resend limit, headers, static
  r=await call("POST","/api/register",{name:"Cy",email:"cy@example.com",password:"cy password 12"});let last;
  for(let i=0;i<4;i++)last=await call("POST","/api/resend-verification",{},r.ck);
  ok("resend is rate limited (429)",last.s===429);
  const idx=await fetch(BASE+"/"),csp=idx.headers.get("content-security-policy")||"";
  ok("index served with strict CSP + nosniff",idx.status===200&&/script-src 'self';/.test(csp)&&!/script-src[^;]*unsafe/.test(csp)&&idx.headers.get("x-content-type-options")==="nosniff");
  ok("static assets served",(await fetch(BASE+"/app.js")).status===200&&(await fetch(BASE+"/style.css")).status===200);
  ok("path traversal and dotfiles blocked",(await fetch(BASE+"/%2e%2e/server.js")).status===404&&(await fetch(BASE+"/..%2fserver.js")).status===404&&(await fetch(BASE+"/.env")).status===404);
  // --- delete + brute force
  r=await call("POST","/api/login",{email:"ben@example.com",password:"ben's password 1"});
  ok("delete needs the right password (403)",(await call("DELETE","/api/account",{password:"nope-nope-nope"},r.ck)).s===403);
  ok("delete works and the account is gone",(await call("DELETE","/api/account",{password:"ben's password 1"},r.ck)).s===200&&(await call("POST","/api/login",{email:"ben@example.com",password:"ben's password 1"})).s===401);
  let lim=false;for(let i=0;i<12;i++)if((await call("POST","/api/login",{email:"brute@example.com",password:"guess-"+i})).s===429)lim=true;
  ok("repeated bad logins are rate limited (429)",lim);
  if(!process.env.DATABASE_URL){const disk=fs.readFileSync(path.join(dir,"db.json"),"utf8");
    ok("database holds no plaintext passwords or raw tokens",!/correct horse|brand new pw|attacker knows/.test(disk)&&!disk.includes(rt)&&!disk.includes(vt))}
  srv.kill("SIGTERM");mailSrv.close();gSrv.close();console.log(`\n${pass} passed, ${bad} failed`);process.exit(bad?1:0);
})().catch(e=>{console.error(e);srv.kill();process.exit(1)});
