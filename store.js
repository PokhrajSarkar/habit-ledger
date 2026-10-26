"use strict";
// Storage backends with one async interface. JSON file by default; Postgres when DATABASE_URL is set.
const fs=require("node:fs"),path=require("node:path");

function jsonStore(dir){
  const FILE=path.join(dir,"db.json");
  fs.mkdirSync(dir,{recursive:true});
  let db={users:{},emails:{},sessions:{},tokens:{}};
  try{db=Object.assign(db,JSON.parse(fs.readFileSync(FILE,"utf8")))}catch(e){if(e.code!=="ENOENT"){console.error("Cannot read database:",e.message);process.exit(1)}}
  let dirty=false,writing=false;
  const save=()=>{dirty=true;if(!writing)flush()};
  function flush(){writing=true;dirty=false;const t=FILE+".tmp";fs.writeFile(t,JSON.stringify(db),e=>{if(e){console.error(e);writing=false;return}fs.rename(t,FILE,e2=>{if(e2)console.error(e2);writing=false;if(dirty)flush()})})}
  const drop=(o,fn)=>{let n=0;for(const k in o)if(fn(o[k])){delete o[k];n++}return n};
  return{
    kind:"file",
    async userByEmail(e){return db.users[db.emails[e]]||null},
    async userById(id){return db.users[id]||null},
    async userByGoogle(sub){for(const k in db.users)if(db.users[k].googleSub===sub)return db.users[k];return null},
    async createUser(u){if(db.emails[u.email]){const e=new Error("duplicate email");e.dup=true;throw e}db.users[u.id]=u;db.emails[u.email]=u.id;save();return u},
    async updateUser(id,p){const u=db.users[id];if(!u)return null;Object.assign(u,p);save();return u},
    async deleteUser(id){const u=db.users[id];if(!u)return;delete db.emails[u.email];delete db.users[id];drop(db.sessions,s=>s.uid===id);drop(db.tokens,t=>t.uid===id);save()},
    async addSession(h,uid,exp){db.sessions[h]={uid,exp};save()},
    async getSession(h){const s=db.sessions[h];return s&&s.exp>Date.now()?s:null},
    async delSession(h){delete db.sessions[h];save()},
    async delSessionsOf(uid){if(drop(db.sessions,s=>s.uid===uid))save()},
    async addToken(h,uid,purpose,exp){db.tokens[h]={uid,purpose,exp};save()},
    async takeToken(h,purpose){const t=db.tokens[h];if(!t||t.purpose!==purpose)return null;delete db.tokens[h];save();return t.exp>Date.now()?{uid:t.uid}:null},
    async clearTokens(uid,purpose){if(drop(db.tokens,t=>t.uid===uid&&t.purpose===purpose))save()},
    async prune(){const n=Date.now();if(drop(db.sessions,s=>s.exp<n)+drop(db.tokens,t=>t.exp<n))save()},
    async close(){fs.writeFileSync(FILE+".tmp",JSON.stringify(db));fs.renameSync(FILE+".tmp",FILE)}
  };
}

function pgStore(url){
  const {Pool}=require("pg");
  const pool=new Pool({connectionString:url,max:10,ssl:process.env.PGSSL==="require"?{rejectUnauthorized:false}:undefined});
  pool.on("error",e=>console.error("Postgres idle client error:",e.message));
  const ready=pool.query(`
    CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,name text NOT NULL,email text UNIQUE NOT NULL,pw text,google_sub text UNIQUE,verified boolean NOT NULL DEFAULT false,created bigint NOT NULL,data jsonb NOT NULL DEFAULT '{"habits":[],"notes":{}}');
    CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,exp bigint NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS tokens(token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,purpose text NOT NULL,exp bigint NOT NULL);
    CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id);`);
  ready.catch(e=>{console.error("Database unavailable:",e.message);process.exit(1)});
  const q=async(t,v)=>{await ready;return pool.query(t,v)};
  const row=r=>r&&{id:r.id,name:r.name,email:r.email,pw:r.pw,googleSub:r.google_sub,verified:r.verified,created:+r.created,data:r.data};
  const COL={pw:"pw",verified:"verified",googleSub:"google_sub",data:"data",name:"name"};
  return{
    kind:"postgres",
    async userByEmail(e){return row((await q("SELECT * FROM users WHERE email=$1",[e])).rows[0])||null},
    async userById(id){return row((await q("SELECT * FROM users WHERE id=$1",[id])).rows[0])||null},
    async userByGoogle(s){return row((await q("SELECT * FROM users WHERE google_sub=$1",[s])).rows[0])||null},
    async createUser(u){
      try{await q("INSERT INTO users(id,name,email,pw,google_sub,verified,created,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[u.id,u.name,u.email,u.pw,u.googleSub,u.verified,u.created,u.data])}
      catch(e){if(e.code==="23505"){const d=new Error("duplicate email");d.dup=true;throw d}throw e}
      return u;
    },
    async updateUser(id,p){
      const ks=Object.keys(p).filter(k=>COL[k]);if(!ks.length)return this.userById(id);
      const r=await q(`UPDATE users SET ${ks.map((k,i)=>COL[k]+"=$"+(i+2)).join(",")} WHERE id=$1 RETURNING *`,[id,...ks.map(k=>p[k])]);
      return row(r.rows[0])||null;
    },
    async deleteUser(id){await q("DELETE FROM users WHERE id=$1",[id])},
    async addSession(h,uid,exp){await q("INSERT INTO sessions(token_hash,user_id,exp) VALUES($1,$2,$3)",[h,uid,exp])},
    async getSession(h){const r=(await q("SELECT user_id,exp FROM sessions WHERE token_hash=$1 AND exp>$2",[h,Date.now()])).rows[0];return r?{uid:r.user_id,exp:+r.exp}:null},
    async delSession(h){await q("DELETE FROM sessions WHERE token_hash=$1",[h])},
    async delSessionsOf(uid){await q("DELETE FROM sessions WHERE user_id=$1",[uid])},
    async addToken(h,uid,purpose,exp){await q("INSERT INTO tokens(token_hash,user_id,purpose,exp) VALUES($1,$2,$3,$4) ON CONFLICT (token_hash) DO NOTHING",[h,uid,purpose,exp])},
    async takeToken(h,purpose){const r=(await q("DELETE FROM tokens WHERE token_hash=$1 AND purpose=$2 RETURNING user_id,exp",[h,purpose])).rows[0];return r&&+r.exp>Date.now()?{uid:r.user_id}:null},
    async clearTokens(uid,purpose){await q("DELETE FROM tokens WHERE user_id=$1 AND purpose=$2",[uid,purpose])},
    async prune(){const n=Date.now();await q("DELETE FROM sessions WHERE exp<$1",[n]);await q("DELETE FROM tokens WHERE exp<$1",[n])},
    async close(){await pool.end()}
  };
}

module.exports=dir=>process.env.DATABASE_URL?pgStore(process.env.DATABASE_URL):jsonStore(dir);
