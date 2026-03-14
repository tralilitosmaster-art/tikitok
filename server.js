
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

const USERS = path.join(__dirname,'users.json');
const VIDEOS = path.join(__dirname,'videos.json');
const COMMENTS = path.join(__dirname,'comments.json');

function readJSON(file){
  if(!fs.existsSync(file)) fs.writeFileSync(file,"[]");
  try{ return JSON.parse(fs.readFileSync(file)); }catch(e){ return []; }
}

function writeJSON(file,data){
  fs.writeFileSync(file,JSON.stringify(data,null,2));
}

function id(){
  return Date.now().toString(36)+Math.random().toString(36).slice(2);
}

function send(res,code,data,type="application/json"){
  res.writeHead(code,{"Content-Type":type});
  res.end(type==="application/json"?JSON.stringify(data):data);
}

function parse(req){
  return new Promise(r=>{
    let b="";
    req.on("data",c=>b+=c);
    req.on("end",()=>{
      try{ r(JSON.parse(b||"{}")) }catch(e){ r({}) }
    });
  });
}

const server=http.createServer(async (req,res)=>{

  const u=url.parse(req.url,true);

  if(req.method==="GET" && (u.pathname==="/"||u.pathname==="/index.html")){
    return send(res,200,fs.readFileSync(path.join(__dirname,"index.html")),"text/html");
  }

  if(req.method==="GET" && u.pathname.startsWith("/video/")){
    const file=path.join(__dirname,path.basename(u.pathname.replace("/video/","")));
    if(fs.existsSync(file)){
      res.writeHead(200,{"Content-Type":"video/mp4"});
      fs.createReadStream(file).pipe(res);
    }else send(res,404,"not found","text/plain");
    return;
  }

  if(u.pathname==="/api/login" && req.method==="POST"){
    const b=await parse(req);
    if(!b.nickname || b.nickname.length<2) return send(res,400,{error:"bad nickname"});
    const users=readJSON(USERS);
    let user=users.find(x=>x.nickname===b.nickname);
    if(!user){
      user={id:id(),nickname:b.nickname,joinDate:new Date().toISOString()};
      users.push(user);
      writeJSON(USERS,users);
    }
    return send(res,200,{ok:true,user});
  }

  if(u.pathname==="/api/feed"){
    const vids=readJSON(VIDEOS);
    vids.sort((a,b)=> (b.likes + b.views) - (a.likes + a.views));
    return send(res,200,{ok:true,items:vids});
  }

  if(u.pathname==="/api/like" && req.method==="POST"){
    const b=await parse(req);
    const vids=readJSON(VIDEOS);
    const v=vids.find(x=>x.id===b.videoId);
    if(v){ v.likes++; writeJSON(VIDEOS,vids); }
    return send(res,200,{ok:true});
  }

  if(u.pathname==="/api/view" && req.method==="POST"){
    const b=await parse(req);
    const vids=readJSON(VIDEOS);
    const v=vids.find(x=>x.id===b.videoId);
    if(v){ v.views++; writeJSON(VIDEOS,vids); }
    return send(res,200,{ok:true});
  }

  if(u.pathname==="/api/comment" && req.method==="POST"){
    const b=await parse(req);
    const com=readJSON(COMMENTS);
    const c={id:id(),videoId:b.videoId,user:b.user,text:b.text,date:new Date().toISOString()};
    com.push(c);
    writeJSON(COMMENTS,com);
    return send(res,200,{ok:true});
  }

  if(u.pathname==="/api/comments"){
    const com=readJSON(COMMENTS).filter(x=>x.videoId===u.query.videoId);
    return send(res,200,{ok:true,comments:com});
  }

  send(res,404,{error:"not found"});
});

server.listen(PORT,()=>console.log("Tikitok PRIVATE PRO running on "+PORT));
