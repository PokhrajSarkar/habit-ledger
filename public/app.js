(function(){
"use strict";
var $=function(s){return document.querySelector(s)};
var INK=["#2f6b4f","#2d5fa3","#8f6012","#9b3a2e","#5b4a8a"];
var DAY=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var today=new Date();today.setHours(0,0,0,0);
function pad(n){return n<10?"0"+n:""+n}
function key(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
function add(d,n){var x=new Date(d);x.setDate(x.getDate()+n);return x}
function monday(d){return add(d,-((d.getDay()+6)%7))}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
var D={habits:[],notes:{}},S={weeks:53,ink:0,ask:null};
var STARTERS=["Read 20 pages","Run 5 km","Lights out by 23:00","Write morning pages","No phone in the first hour","Drink 2 litres of water","Stretch for 10 minutes"];
function rng(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function seed(){
  var spec=[["Read 20 pages",.5,0],["Run 5 km",.34,1],["Lights out by 23:00",.55,2],["Write morning pages",.42,3],["No phone in the first hour",.3,4]];
  return{notes:{},habits:spec.map(function(s,i){var r=rng(97+i*31),days={};
    for(var n=365;n>=1;n--){var d=add(today,-n),p=s[1]+.38*(1-n/365)-((d.getDay()===0||d.getDay()===6)&&i===3?.15:0);if(r()<p)days[key(d)]=1}
    return{id:"h"+i,name:s[0],ink:s[2],days:days}})}
}

function streak(h){var d=h.days[key(today)]?today:add(today,-1),n=0;while(h.days[key(d)]){n++;d=add(d,-1)}return n}
function best(h){var b=0,c=0;for(var i=420;i>=0;i--){if(h.days[key(add(today,-i))]){c++;if(c>b)b=c}else c=0}return b}
function rate(h){var n=0;for(var i=0;i<30;i++)if(h.days[key(add(today,-i))])n++;return Math.round(n/30*100)}
function yearN(h){var n=0;for(var i=0;i<365;i++)if(h.days[key(add(today,-i))])n++;return n}
function toast(m){var t=$("#toast");t.textContent=m;t.classList.add("on");clearTimeout(toast.h);toast.h=setTimeout(function(){t.classList.remove("on")},1700)}
function strip(h){
  var start=add(monday(today),-(S.weeks-1)*7),o="",w,r,d,k;
  for(w=0;w<S.weeks;w++)for(r=0;r<7;r++){d=add(start,w*7+r);
    if(d>today){o+='<i class="c fut"></i>';continue}
    k=key(d);o+='<i class="c'+(h.days[k]?" on":"")+(k===key(today)?" now":"")+'" style="--w:'+w+'" data-h="'+h.id+'" data-d="'+k+'" title="'+DAY[(d.getDay()+6)%7]+" "+d.getDate()+" "+MON[d.getMonth()]+(h.days[k]?" · posted":" · not posted")+'"></i>'}
  return o}
function render(){
  $("#sheet").style.setProperty("--cs",S.weeks===53?"8px":"14px");
  $("#dt").textContent=today.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"});
  var mos="",start=add(monday(today),-(S.weeks-1)*7),pm=-1,w,m;
  var cs=S.weeks===53?10:16;$("#mos").style.gridTemplateColumns="repeat("+S.weeks+","+(cs-2)+"px)";
  for(w=0;w<S.weeks;w++){m=add(start,w*7).getMonth();mos+=(m!==pm?'<i style="grid-column:'+(w+1)+'/span 3">'+MON[m]+"</i>":"");pm=m}
  $("#mos").innerHTML=mos;
  var posted=0,tot=0;
  $("#rows").innerHTML=D.habits.length?D.habits.map(function(h){var on=!!h.days[key(today)];if(on)posted++;var y=yearN(h);tot+=y;
    return'<div class="row" style="--hc:'+INK[h.ink]+'"><button class="post'+(on?" on":"")+'" data-post="'+h.id+'" aria-pressed="'+on+'">'+(on?"Posted":"Post today")+'</button><div class="nm"><b>'+esc(h.name)+'</b><span>Best '+best(h)+' · '+y+' this year · <button class="rm'+(S.ask===h.id?" ask":"")+'" data-rm="'+h.id+'">'+(S.ask===h.id?"Confirm remove":"Remove")+'</button></span></div><div class="strip"><div class="grid">'+strip(h)+'</div></div><div class="fig"><b>'+streak(h)+'</b><small>days</small></div><div class="fig"><b>'+rate(h)+'%</b><small>posted</small></div></div>'}).join(""):'<div class="empty"><b>Your ledger is empty.</b>Pick a starter below or add your own habit.<br><button class="lnk" data-demo="1">Explore with a sample year</button></div>';
  $("#qa").innerHTML=D.habits.length<6?STARTERS.filter(function(s){return!D.habits.some(function(h){return h.name===s})}).map(function(s){return'<button class="chip" data-st="'+esc(s)+'">'+esc(s)+'</button>'}).join(""):"";
  $("#cap").innerHTML=(S.user?"Hi "+esc(S.user.name.split(" ")[0])+". ":"")+"<b>"+posted+" of "+D.habits.length+"</b> posted today";
  $("#tot").innerHTML="<span>Entries in the last 365 days</span><span>"+tot.toLocaleString()+"</span>";
}
function toggle(id,k){var h=D.habits.filter(function(x){return x.id===id})[0];if(!h)return;if(h.days[k])delete h.days[k];else h.days[k]=1;persist();render();return h.days[k]}
$("#rows").addEventListener("click",function(e){
  var p=e.target.closest("[data-post]"),c=e.target.closest("[data-d]"),r=e.target.closest("[data-rm]"),dm=e.target.closest("[data-demo]");
  if(dm){D=seed();persist();render();toast("Sample year loaded")}
  else if(p){var v=toggle(p.dataset.post,key(today));if(v)celebrate(p.dataset.post);else toast("Voided today's entry")}
  else if(c){var v2=toggle(c.dataset.h,c.dataset.d);toast(v2?"Posted "+c.dataset.d:"Voided "+c.dataset.d)}
  else if(r){if(S.ask===r.dataset.rm){D.habits=D.habits.filter(function(x){return x.id!==S.ask});S.ask=null;persist();toast("Habit removed")}else S.ask=r.dataset.rm;render()}
});
document.addEventListener("click",function(e){if(S.ask&&!e.target.closest("[data-rm]")){S.ask=null;render()}});
$("#seg").addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;S.weeks=+b.dataset.w;[].forEach.call(document.querySelectorAll("#seg button"),function(x){x.classList.toggle("on",x===b)});render()});
// modals
var last=null;
function open(id,f){last=document.activeElement;$(id).classList.add("on");if(f)$(f).focus()}
function close(){[].forEach.call(document.querySelectorAll(".mask"),function(m){m.classList.remove("on")});if(last)last.focus()}
[].forEach.call(document.querySelectorAll("[data-x]"),function(b){b.addEventListener("click",close)});
[].forEach.call(document.querySelectorAll(".mask"),function(m){m.addEventListener("click",function(e){if(e.target===m)close()})});
document.addEventListener("keydown",function(e){if(e.key==="Escape")close()});
$("#hs").innerHTML=INK.map(function(c,i){return'<button data-i="'+i+'" aria-label="Ink '+(i+1)+'"><i style="background:'+c+'"></i></button>'}).join("");
function paintInk(){[].forEach.call(document.querySelectorAll("#hs button"),function(b){b.classList.toggle("on",+b.dataset.i===S.ink)})}
$("#hs").addEventListener("click",function(e){var b=e.target.closest("button");if(b){S.ink=+b.dataset.i;paintInk()}});
$("#add").addEventListener("click",function(){$("#hn").value="";$("#he").hidden=true;S.ink=D.habits.length%INK.length;paintInk();open("#m1","#hn")});
function addHabit(){
  var n=$("#hn").value.trim(),e=$("#he");
  if(D.habits.length>=40){e.textContent="You can track up to 40 habits. Remove one to add another.";e.hidden=false;return}
  if(!n){e.textContent="Enter a habit name to continue.";e.hidden=false;return}
  if(D.habits.some(function(h){return h.name.toLowerCase()===n.toLowerCase()})){e.textContent="You already have a habit with that name. Choose a different one.";e.hidden=false;return}
  D.habits.push({id:"h"+Date.now(),name:n,ink:S.ink,days:{}});persist();render();close();toast("Added to ledger")}
$("#hok").addEventListener("click",addHabit);
$("#hn").addEventListener("keydown",function(e){if(e.key==="Enter")addHabit()});
$("#rev").addEventListener("click",function(){
  var wk=key(monday(today)),days=[],i;for(i=6;i>=0;i--)days.push(add(today,-i));
  $("#rs").textContent=days[0].getDate()+" "+MON[days[0].getMonth()]+" to "+days[6].getDate()+" "+MON[days[6].getMonth()]+". Dots show the days you posted.";
  var rows=D.habits.map(function(h){var n=0,c=days.map(function(d){var o=h.days[key(d)];if(o)n++;return'<td style="--hc:'+INK[h.ink]+'"><i class="'+(o?"on":"")+'"></i></td>'}).join("");return{h:h,n:n,html:"<tr><td>"+esc(h.name)+"</td>"+c+'<td class="n">'+n+"/7</td></tr>"}});
  var head="<tr><th></th>"+days.map(function(d){return"<th>"+DAY[(d.getDay()+6)%7].charAt(0)+"</th>"}).join("")+"<th></th></tr>";
  var sum="";if(rows.length){var s=rows.slice().sort(function(a,b){return b.n-a.n});sum='<p class="s" style="margin-bottom:24px"><b>Most consistent:</b> '+esc(s[0].h.name)+" ("+s[0].n+"/7). <b>Needs attention:</b> "+esc(s[s.length-1].h.name)+" ("+s[s.length-1].n+"/7).</p>"}
  $("#rt").innerHTML=rows.length?'<table class="rv">'+head+rows.map(function(r){return r.html}).join("")+"</table>"+sum:'<p class="s">Add a habit first, then come back for your review.</p>';
  $("#rn").value=D.notes[wk]||"";open("#m2","#rn")});
$("#rok").addEventListener("click",function(){D.notes[key(monday(today))]=$("#rn").value.trim();persist();toast("Note saved")});

// ---- server sync
function api(m,u,b){return fetch(u,{method:m,headers:b?{"Content-Type":"application/json"}:{},body:b?JSON.stringify(b):undefined,credentials:"same-origin"}).then(function(r){return r.json().catch(function(){return{}}).then(function(j){if(!r.ok){var e=new Error(j.error||"Something went wrong. Try again.");e.status=r.status;throw e}return j})},function(){var e=new Error("Can't reach the server. Check your connection and try again.");e.status=0;throw e})}
var st=null,pending=false;
function setSave(t){$("#sv").textContent=t}
function persist(){if(!S.user)return;pending=true;setSave("Saving…");clearTimeout(st);st=setTimeout(push,400)}
function push(){clearTimeout(st);pending=false;return api("PUT","/api/state",{habits:D.habits,notes:D.notes}).then(function(){if(!pending)setSave("All changes saved")}).catch(function(e){if(e.status===401){showAuth("Your session expired. Sign in again to keep your ledger.");return}pending=true;setSave("Not saved yet. Retrying…");st=setTimeout(push,4000)})}
document.addEventListener("visibilitychange",function(){
  if(document.visibilityState==="hidden"&&pending&&S.user){clearTimeout(st);pending=false;try{fetch("/api/state",{method:"PUT",keepalive:true,credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({habits:D.habits,notes:D.notes})})}catch(e){}}
  if(document.visibilityState==="visible"&&S.user){var n=new Date();n.setHours(0,0,0,0);if(+n!==+today){today=n;render()}}
});
// ---- fun: stamps and confetti
function stamp(t){var s=document.createElement("div");s.className="stamp";s.textContent=t;document.body.appendChild(s);setTimeout(function(){s.remove()},2000)}
function confetti(){
  if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  var c=document.createElement("canvas"),x=c.getContext("2d"),W=c.width=innerWidth,H=c.height=innerHeight,cols=INK.concat(["#c0432d","#1d2733"]),P=[],i;
  c.style.cssText="position:fixed;inset:0;pointer-events:none;z-index:40";document.body.appendChild(c);
  for(i=0;i<110;i++)P.push({x:W/2+(Math.random()-.5)*160,y:H*.55,vx:(Math.random()-.5)*14,vy:-Math.random()*16-4,s:5+Math.random()*7,c:cols[i%cols.length],r:Math.random()*6,vr:(Math.random()-.5)*.4});
  var t0=performance.now();
  (function f(t){var k=t-t0;x.clearRect(0,0,W,H);P.forEach(function(p){p.vy+=.45;p.x+=p.vx;p.y+=p.vy;p.vx*=.99;p.r+=p.vr;x.save();x.translate(p.x,p.y);x.rotate(p.r);x.fillStyle=p.c;x.globalAlpha=Math.max(0,1-k/2200);x.fillRect(-p.s/2,-p.s/4,p.s,p.s/2);x.restore()});if(k<2200)requestAnimationFrame(f);else c.remove()})(t0);
}
var MS=[3,7,14,30,60,100,200,365];
function celebrate(id){
  var h=D.habits.filter(function(x){return x.id===id})[0],s=streak(h),all=D.habits.every(function(x){return x.days[key(today)]});
  if(MS.indexOf(s)>-1){stamp(s+"-day run");confetti();toast(h.name+": "+s+" days in a row")}
  else if(all&&D.habits.length>1){stamp("Books balanced");confetti();toast("Everything is posted for today")}
  else toast("Posted")
}
$("#qa").addEventListener("click",function(e){var b=e.target.closest("[data-st]");if(!b)return;var nm=b.dataset.st;if(D.habits.length>=40)return toast("You can track up to 40 habits.");if(!D.habits.some(function(h){return h.name===nm}))D.habits.push({id:"h"+Date.now(),name:nm,ink:D.habits.length%INK.length,days:{}});persist();render();toast("Added: "+nm)});
// ---- accounts
var CFG={mail:false,google:false},mode="login",rtok=null;
var MODES={
  login:{h:"Welcome back",d:"Pick up your streaks where you left them.",b:"Sign in",name:0,email:1,pw:1,meter:0,tabs:1,ext:1,fg:1,back:0},
  register:{h:"Open your ledger",d:"One account, every habit, on any device.",b:"Open my ledger",name:1,email:1,pw:1,meter:1,tabs:1,ext:1,fg:0,back:0},
  forgot:{h:"Reset your password",d:"Enter your email and we will send a link that works for one hour.",b:"Send reset link",name:0,email:1,pw:0,meter:0,tabs:0,ext:0,fg:0,back:1},
  reset:{h:"Choose a new password",d:"Use at least 8 characters. You will be signed in afterward.",b:"Set new password",name:0,email:0,pw:1,meter:1,tabs:0,ext:0,fg:0,back:1}
};
function fail(m){var e=$("#fm");e.textContent=m||"";e.hidden=!m}
function note(m){var e=$("#fo");e.textContent=m||"";e.hidden=!m}
function setMode(m,msg,ok){
  mode=m;var c=MODES[m];
  [].forEach.call(document.querySelectorAll("#am button"),function(b){var on=b.dataset.m===m;b.classList.toggle("on",on);b.setAttribute("aria-selected",on)});
  $("#am").hidden=!c.tabs;$("#nf").hidden=!c.name;$("#ef").hidden=!c.email;$("#pf").hidden=!c.pw;$("#sm").hidden=!c.meter;
  $("#ex").hidden=!c.ext;$("#gg").hidden=!CFG.google;$("#or").hidden=!CFG.google;
  $("#fg").hidden=!(c.fg&&CFG.mail);$("#bk").hidden=!c.back;
  $("#fp").autocomplete=m==="login"?"current-password":"new-password";$("#pl").textContent=m==="reset"?"New password":"Password";
  $("#fs").textContent=c.b;$("#ah").textContent=c.h;$("#ad").textContent=c.d;fail(msg);note(ok);
  $(c.name?"#fn":c.email?"#fe":"#fp").focus();
}
function showAuth(msg){S.user=null;D={habits:[],notes:{}};pending=false;clearTimeout(st);$("#app").hidden=true;$("#auth").hidden=false;close();$("#af").reset();setMode("login",msg)}
function startApp(r,isNew){
  S.user=r.user;D=r.state||{habits:[],notes:{}};D.notes=D.notes||{};
  $("#auth").hidden=true;$("#app").hidden=false;$("#who").textContent=r.user.name;$("#vb").hidden=!(CFG.mail&&!r.user.verified);setSave("All changes saved");render();
  document.body.classList.add("intro");setTimeout(function(){document.body.classList.remove("intro")},1800);window.scrollTo(0,0);
  if(isNew)toast("Welcome, "+r.user.name.split(" ")[0]+". Pick a few habits to start.");
}
$("#am").addEventListener("click",function(e){var b=e.target.closest("button");if(b)setMode(b.dataset.m)});
$("#af").addEventListener("click",function(e){var b=e.target.closest("[data-m]");if(b&&b.closest("p"))setMode(b.dataset.m)});
$("#tg").addEventListener("click",function(){var f=$("#fp"),h=f.type==="password";f.type=h?"text":"password";this.textContent=h?"Hide":"Show";this.setAttribute("aria-pressed",h)});
$("#fp").addEventListener("input",function(){
  var p=this.value,s=0;if(p.length>=8)s++;if(p.length>=12)s++;if(/[a-z]/.test(p)&&/[A-Z]/.test(p))s++;if(/\d/.test(p)&&/[^A-Za-z0-9]/.test(p))s++;if(p.length<8)s=0;
  [].forEach.call(document.querySelectorAll("#smb i"),function(i,k){i.className=k<s?"on s"+s:""});
  $("#sml").textContent=!p?"At least 8 characters":p.length<8?"Too short":["","Weak","Okay","Good","Strong"][s]||"Weak";
});
$("#af").addEventListener("submit",function(e){
  e.preventDefault();
  var n=$("#fn").value.trim(),em=$("#fe").value.trim(),pw=$("#fp").value,err="",url,body,m=mode;
  if(m==="register"&&!n)err="Enter your name.";
  else if(m!=="reset"&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em))err="Enter a valid email address.";
  else if(m!=="forgot"&&!pw)err=m==="reset"?"Enter a new password.":"Enter your password.";
  else if((m==="register"||m==="reset")&&pw.length<8)err="Use at least 8 characters for your password.";
  if(err)return fail(err);
  if(m==="login"){url="/api/login";body={email:em,password:pw}}
  else if(m==="register"){url="/api/register";body={name:n,email:em,password:pw}}
  else if(m==="forgot"){url="/api/forgot";body={email:em}}
  else{url="/api/reset";body={token:rtok,password:pw}}
  var b=$("#fs"),label=b.textContent;b.disabled=true;b.textContent="Working…";fail("");note("");
  api("POST",url,body).then(function(r){
    if(m==="forgot"){note("If an account exists for that email, a reset link is on its way. It works for one hour. Check your spam folder too.");return}
    $("#fp").value="";startApp(r,m==="register");if(m==="reset")toast("Password updated. You are signed in.")
  }).catch(function(x){fail(x.message)}).then(function(){b.disabled=false;b.textContent=label});
});
$("#out").addEventListener("click",function(){var go=function(){showAuth()};(pending?push():Promise.resolve()).then(function(){return api("POST","/api/logout")}).then(go,go)});
$("#rv").addEventListener("click",function(){api("POST","/api/resend-verification").then(function(){toast("Confirmation email sent")},function(x){toast(x.message)})});
$("#del").addEventListener("click",function(){
  var pw=S.user.hasPassword,i=$("#dp");i.value="";i.type=pw?"password":"text";i.autocomplete=pw?"current-password":"off";
  $("#dls").textContent=pw?"Password":"Type your email to confirm";$("#de").hidden=true;open("#m3","#dp");
});
$("#dok").addEventListener("click",function(){
  var pw=S.user.hasPassword,v=$("#dp").value,e=$("#de");
  if(!v){e.textContent=pw?"Enter your password to confirm.":"Type your email to confirm.";e.hidden=false;return}
  api("DELETE","/api/account",pw?{password:v}:{confirm:v}).then(function(){close();showAuth();toast("Your account was deleted")}).catch(function(x){e.textContent=x.message;e.hidden=false});
});
(function(){
  var g=$("#dn"),h="";for(var i=0;i<28;i++)h+='<button class="dc" aria-label="Day '+(i+1)+'" aria-pressed="false"></button>';g.innerHTML=h;
  g.addEventListener("click",function(e){
    var b=e.target.closest("button");if(!b)return;var on=b.classList.toggle("on");b.setAttribute("aria-pressed",on);
    var m=0,c=0;[].forEach.call(g.children,function(x){if(x.classList.contains("on")){c++;if(c>m)m=c}else c=0});
    $("#dl").textContent=m===0?"Select a square to post your first day.":m<7?"Run of "+m+(m===1?" day.":" days. Keep going."):"Run of "+m+" days. That is how a streak starts.";
    if(on&&m===7){stamp("7-day run");confetti()}
  });
})();
function readHash(){
  var s=location.hash.slice(1),m=/^(reset|verify)=([a-f0-9]{64})$/.exec(s),e=/^error=(\w+)$/.exec(s);
  if(m||e)history.replaceState(null,"",location.pathname+location.search);
  return{k:m&&m[1],t:m&&m[2],e:e&&e[1]}
}
function gmsg(c){return c==="google_cancelled"?"Google sign-in was cancelled.":c==="google_limited"?"Too many Google sign-in attempts. Try again in a few minutes.":"Google sign-in did not complete. Try again or use your email."}
var H=readHash(),vmsg="";
api("GET","/api/config").then(function(c){CFG=c},function(){}).then(function(){
  if(H.k==="verify")return api("POST","/api/verify",{token:H.t}).then(function(){vmsg="Email confirmed. Thank you."},function(x){vmsg=x.message});
}).then(function(){
  if(H.k==="reset"){rtok=H.t;showAuth();setMode("reset");return}
  return api("GET","/api/me").then(function(r){startApp(r);if(vmsg)toast(vmsg)},function(x){showAuth(x.status===401?(H.e?gmsg(H.e):""):x.message);if(vmsg)toast(vmsg)});
});
})();
