// ○×勝ち残りクイズ（データは内部で読み込む。利用者画面には編集項目を出さない）
let allQuestions = [];
let game = null;        // ローカル/ホスト側のゲーム状態
let guest = null;       // ゲスト側の状態
let timerId = null;
let net = { peer:null, code:null, isHost:false, conns:new Map(), hostConn:null, nextPid:2, started:false };

const $ = s => document.querySelector(s);
const screens = ["title","game","result","howto"];
function goto(name){
  screens.forEach(n=>$("#screen-"+n).classList.toggle("active", n===name));
  window.scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>goto(b.dataset.goto)));
function shuffle(a){ const x=[...a]; for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];} return x; }
function myName(){ return ($("#player-name").value.trim()||"挑戦者").slice(0,12); }

// ---------- データ読み込み（内部処理のみ） ----------
function parseData(text){
  const rows=[]; let row=[], cur="", inQ=false;
  text=text.replace(/^\uFEFF/,"");
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(inQ){ if(c==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else inQ=false; } else cur+=c; }
    else{ if(c==='"') inQ=true; else if(c===','){row.push(cur);cur="";} else if(c==='\n'){row.push(cur);rows.push(row);row=[];cur="";} else if(c!=='\r') cur+=c; }
  }
  if(cur!==""||row.length){ row.push(cur); rows.push(row); }
  const out=[];
  rows.forEach((r,idx)=>{ if(r.length<2) return; const q=(r[0]||"").trim(), a=parseInt((r[1]||"").trim(),10);
    if(idx===0&&(a!==1&&a!==2)) return; if(!q||(a!==1&&a!==2)) return; out.push({q,a}); });
  return out;
}
async function loadQuestions(){
  try{
    const res=await fetch("questions.csv",{cache:"no-store"});
    if(res.ok){ const p=parseData(await res.text()); if(p.length){ allQuestions=p; return; } }
    throw new Error("load");
  }catch(e){
    allQuestions=[{q:"アメリカの首都はニューヨークである",a:2},{q:"自由の女神はフランスからアメリカへ贈られたものである",a:1},{q:"アメリカの国旗の星の数は51個である",a:2},{q:"ハワイはアメリカの50番目の州である",a:1},{q:"ラスベガスはネバダ州にある",a:1}];
  }
}

// ---------- 野球場風3D（Three.js / ローポリ） ----------
const Stadium = {
  ok:false, people:new Map(), targets:new Map(), falling:new Set(),
  init(){
    if(this.ok || typeof THREE==="undefined") { if(typeof THREE==="undefined") $("#stadium-fallback").classList.remove("hidden"), $("#stadium-3d").classList.add("hidden"); return; }
    try{
      const wrap=$("#stadium-3d"); const W=wrap.clientWidth||800, H=wrap.clientHeight||420;
      this.scene=new THREE.Scene(); this.scene.background=new THREE.Color(0x87ceeb);
      this.scene.fog=new THREE.Fog(0x87ceeb,70,140);
      this.camera=new THREE.PerspectiveCamera(50,W/H,0.1,300);
      this.camera.position.set(0,27,38); this.camera.lookAt(0,0,-3);
      this.renderer=new THREE.WebGLRenderer({antialias:true});
      this.renderer.setSize(W,H); this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
      wrap.appendChild(this.renderer.domElement);
      this.scene.add(new THREE.AmbientLight(0xffffff,0.75));
      const sun=new THREE.DirectionalLight(0xffffff,0.7); sun.position.set(20,35,15); this.scene.add(sun);
      this.buildField();
      this.ok=true;
      const loop=()=>{ requestAnimationFrame(loop); this.tick(); this.renderer.render(this.scene,this.camera); };
      loop();
      addEventListener("resize",()=>{ const w=wrap.clientWidth,h=wrap.clientHeight; if(!w) return; this.camera.aspect=w/h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w,h); });
    }catch(e){ $("#stadium-fallback").classList.remove("hidden"); $("#stadium-3d").classList.add("hidden"); }
  },
  mat(c){ return new THREE.MeshLambertMaterial({color:c}); },
  box(w,h,d,c,x,y,z,ry=0){ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),this.mat(c)); m.position.set(x,y,z); m.rotation.y=ry; this.scene.add(m); return m; },
  textPlane(text,color,bg,w,h){
    const cv=document.createElement("canvas"); cv.width=256; cv.height=256; const g=cv.getContext("2d");
    g.fillStyle=bg; g.fillRect(0,0,256,256); g.fillStyle=color; g.font="bold 190px sans-serif"; g.textAlign="center"; g.textBaseline="middle"; g.fillText(text,128,138);
    const tex=new THREE.CanvasTexture(cv);
    return new THREE.Mesh(new THREE.PlaneGeometry(w,h), new THREE.MeshBasicMaterial({map:tex,transparent:false}));
  },
  buildField(){
    // 芝生（外野フェアグラウンド風の扇形を円で代用）＋内野
    const grass=new THREE.Mesh(new THREE.CircleGeometry(46,40),this.mat(0x2e9e4f)); grass.rotation.x=-Math.PI/2; grass.position.y=0; this.scene.add(grass);
    const dirt=new THREE.Mesh(new THREE.CircleGeometry(13,4),this.mat(0xc68b4e)); dirt.rotation.x=-Math.PI/2; dirt.rotation.z=Math.PI/4; dirt.position.set(0,0.02,10); dirt.scale.set(1,1.35,1); this.scene.add(dirt);
    const mound=new THREE.Mesh(new THREE.CylinderGeometry(2.2,2.6,0.5,14),this.mat(0xc68b4e)); mound.position.set(0,0.25,7); this.scene.add(mound);
    [[0,17],[ -7,10],[0,3],[7,10]].forEach(([x,z])=>this.box(1.2,0.18,1.2,0xffffff,x,0.1,z)); // 塁
    // ○ゾーン（レフト）／×ゾーン（ライト）
    const maruZone=new THREE.Mesh(new THREE.CircleGeometry(9,24),new THREE.MeshBasicMaterial({color:0x2563eb,transparent:true,opacity:0.4})); maruZone.rotation.x=-Math.PI/2; maruZone.position.set(-16,0.04,-7); this.scene.add(maruZone);
    const batsuZone=new THREE.Mesh(new THREE.CircleGeometry(9,24),new THREE.MeshBasicMaterial({color:0xdc2626,transparent:true,opacity:0.4})); batsuZone.rotation.x=-Math.PI/2; batsuZone.position.set(16,0.04,-7); this.scene.add(batsuZone);
    const maruSign=this.textPlane("○","#ffffff","#2563eb",7,7); maruSign.position.set(-16,5,-14); this.scene.add(maruSign);
    const batsuSign=this.textPlane("×","#ffffff","#dc2626",7,7); batsuSign.position.set(16,5,-14); this.scene.add(batsuSign);
    // 外野フェンス＋スタンド（段々のボックス）＋照明塔＋ファウルポール＋スコアボード
    for(let i=0;i<26;i++){ const a=Math.PI*(0.08+0.84*i/25); const x=Math.cos(a)*-42, z=-Math.sin(a)*30+6; this.box(4.4,2.4,0.6,0x166534,x,1.2,z, -a+Math.PI/2); }
    const standCols=[0x1e3a8a,0x2563eb,0x1e40af];
    for(let r=0;r<3;r++){ for(let i=0;i<20;i++){ const a=Math.PI*(0.06+0.88*i/19); const rad=47+r*4; const x=Math.cos(a)*-rad, z=-Math.sin(a)*(33+r*3)+8; this.box(5.4,3.4,3.4,standCols[r],x,2+r*3.2,z,-a+Math.PI/2); } }
    [-38,38].forEach(x=>{ const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.35,17,8),this.mat(0xfacc15)); pole.position.set(x,8.5,-16); this.scene.add(pole); });
    [-30,30].forEach(x=>{ const t=new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.6,20,8),this.mat(0x9ca3af)); t.position.set(x,10,-24); this.scene.add(t); this.box(5,2.4,0.6,0xfef9c3,x,20.5,-24); });
    this.box(20,7,1,0x111827,0,7.5,-31);
    const board=this.textPlane("★","#facc15","#111827",5,5); board.position.set(-7,7.5,-30.4); this.scene.add(board);
    const board2=this.textPlane("★","#facc15","#111827",5,5); board2.position.set(7,7.5,-30.4); this.scene.add(board2);
  },
  startPos(i){ const col=i%10, rowi=Math.floor(i/10); return {x:(col-4.5)*2.4, z:13-rowi*2.6}; },
  zonePos(pid,zone){ let h=0; const s=String(pid); for(const ch of s) h=(h*31+ch.charCodeAt(0))%997; const a=(h%360)*Math.PI/180, r=2+(h%55)/10; const cx=zone===1?-16:16; return {x:cx+Math.cos(a)*r, z:-7+Math.sin(a)*r*0.8}; },
  syncParticipants(list){
    if(!this.ok) return;
    const seen=new Set();
    list.forEach((p,i)=>{
      seen.add(p.pid);
      if(!this.people.has(p.pid)){
        const grp=new THREE.Group();
        const colors=[0xef4444,0x3b82f6,0xf59e0b,0x10b981,0x8b5cf6,0xec4899,0xffffff,0x111827];
        const body=new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.55,1.25,7),this.mat(p.you?0xfacc15:colors[i%colors.length])); body.position.y=1.05; grp.add(body);
        const head=new THREE.Mesh(new THREE.SphereGeometry(0.42,8,7),this.mat(0xfcd9b8)); head.position.y=2.0; grp.add(head);
        const cap=new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.45,0.22,8),this.mat(p.you?0xd92323:0x1e3a8a)); cap.position.y=2.32; grp.add(cap);
        const legL=new THREE.Mesh(new THREE.BoxGeometry(0.26,0.55,0.26),this.mat(0x374151)); legL.position.set(-0.2,0.28,0); grp.add(legL);
        const legR=legL.clone(); legR.position.x=0.2; grp.add(legR);
        grp.userData={legL,legR,phase:Math.random()*6};
        const sp=this.startPos(this.people.size); grp.position.set(sp.x,0,sp.z);
        this.scene.add(grp); this.people.set(p.pid,grp); this.targets.set(p.pid,{x:sp.x,z:sp.z});
      }
      const grp=this.people.get(p.pid);
      if(p.alive){ grp.visible=true; if(this.falling.has(p.pid)){ this.falling.delete(p.pid); grp.rotation.x=0; } }
    });
    this.people.forEach((grp,pid)=>{ if(!seen.has(pid)){ this.scene.remove(grp); this.people.delete(pid); this.targets.delete(pid); } });
  },
  toStart(list){ if(!this.ok) return; list.forEach((p,i)=>{ if(p.alive) this.targets.set(p.pid,this.startPos(i)); }); },
  move(pid,zone){ if(!this.ok) return; this.targets.set(pid,this.zonePos(pid,zone)); if(!$("#stadium-fallback").classList.contains("hidden")){} 
    // フォールバック表示も更新
    const el=zone===1?$("#people-maru"):$("#people-batsu"); if(el) el.textContent+="🧑";
  },
  fall(pid){ if(!this.ok) return; this.falling.add(pid); const grp=this.people.get(pid); if(grp) grp.userData.fallStart=Date.now(); },
  tick(){
    if(!this.ok) return; const now=Date.now();
    this.people.forEach((grp,pid)=>{
      const t=this.targets.get(pid); if(!t) return;
      const dx=t.x-grp.position.x, dz=t.z-grp.position.z, dist=Math.hypot(dx,dz);
      if(dist>0.08){ const sp=0.16; grp.position.x+=dx/dist*Math.min(sp,dist); grp.position.z+=dz/dist*Math.min(sp,dist);
        grp.rotation.y=Math.atan2(dx,dz);
        const bob=Math.abs(Math.sin(now/90+grp.userData.phase))*0.14; grp.position.y=bob;
        grp.userData.legL.rotation.x=Math.sin(now/90+grp.userData.phase)*0.7; grp.userData.legR.rotation.x=-Math.sin(now/90+grp.userData.phase)*0.7;
      } else { grp.position.y=0; grp.userData.legL.rotation.x=0; grp.userData.legR.rotation.x=0; }
      if(this.falling.has(pid)){ const k=Math.min(1,(now-(grp.userData.fallStart||now))/600); grp.rotation.x=-k*Math.PI/2*0.92; grp.position.y=-k*0.25; }
    });
  }
};

// ---------- 共通ゲーム表示 ----------
function participantsForView(){ return game ? game.participants : (guest ? guest.participants : []); }
function renderParticipants(){
  const grid=$("#participants-grid"); grid.innerHTML="";
  participantsForView().forEach(p=>{
    const d=document.createElement("div");
    d.className="person"+(p.you?" you":"")+(p.kind==="remote"?" remote":"")+(!p.alive?" dead":"");
    d.textContent=p.you?"★":(p.kind==="remote"?"◆":(p.alive?"🧑":"✕"));
    d.title=p.name+(p.alive?"（生存）":"（脱落）");
    grid.appendChild(d);
  });
  const alive=participantsForView().filter(p=>p.alive).length;
  $("#alive-count").textContent=alive;
  Stadium.syncParticipants(participantsForView());
}
function setHud(name, alive){ $("#hud-name").textContent=name; $("#hud-status").textContent=alive?"生存中":"脱落"; }
function startTimer(seconds, onTimeout){
  stopTimer(); const bar=$("#timer-bar"), txt=$("#timer-text");
  const useTimer = game ? game.useTimer : true;
  if(!useTimer){ bar.style.width="100%"; txt.textContent="∞"; return; }
  const started=Date.now(); bar.style.width="100%"; txt.textContent=seconds;
  timerId=setInterval(()=>{ const left=seconds-(Date.now()-started)/1000;
    bar.style.width=Math.max(0,left/seconds*100)+"%"; txt.textContent=Math.max(0,Math.ceil(left));
    if(left<=0){ stopTimer(); onTimeout&&onTimeout(); } },100);
}
function stopTimer(){ if(timerId){ clearInterval(timerId); timerId=null; } }
function showQuestion(idx,total,q){
  $("#q-num").textContent=idx+1; $("#q-total").textContent=total; $("#question-text").textContent=q;
  $("#choice-area").classList.remove("hidden"); $("#reveal-area").classList.add("hidden");
  $("#btn-maru").classList.remove("selected"); $("#btn-batsu").classList.remove("selected");
  $("#people-maru").textContent=""; $("#people-batsu").textContent=""; $("#wait-text").textContent="";
  Stadium.toStart(participantsForView());
}

// ---------- ローカル／ホスト側ロジック ----------
function makeCpu(i){ return {pid:"cpu"+i, name:"CPU "+(i+1), kind:"cpu", alive:true, skill:0.55+Math.random()*0.32}; }
function startLocalGame(){
  if(!allQuestions.length){ alert("問題データが読み込めていません。少し待ってからもう一度お試しください。"); return; }
  const mode=$("#mode-select").value;
  const participants=[{pid:"you", name:myName(), kind:"you", you:true, alive:true}];
  if(mode==="tournament") for(let i=0;i<49;i++) participants.push(makeCpu(i));
  game={ mode, participants, questions: $("#order-select").value==="shuffle"?shuffle(allQuestions):[...allQuestions],
         idx:0, survived:0, picks:{}, myPick:null, useTimer:$("#timer-check").checked, resolving:false };
  beginGameScreen();
}
function beginGameScreen(){
  setHud(myName(), true); goto("game"); Stadium.init(); renderParticipants(); hostNextQuestion();
}
function hostNextQuestion(){
  if(game.idx>=game.questions.length) return hostFinish(true,"全問勝ち残り！");
  game.picks={}; game.myPick=null; game.resolving=false;
  const cur=game.questions[game.idx];
  showQuestion(game.idx, game.questions.length, cur.q);
  netBroadcast({t:"question", idx:game.idx, total:game.questions.length, q:cur.q});
  startTimer(10, ()=>{ // 時間切れ：未回答の人間はランダム
    if(game.myPick===null) recordPick("you", Math.random()<0.5?1:2, true);
    resolveIfReady(true);
  });
}
function recordPick(pid, choice, timedOut=false){
  game.picks[pid]=choice;
  const p=game.participants.find(x=>x.pid===pid);
  if(p) Stadium.move(pid, choice);
  if(pid==="you"){ game.myPick=choice; $("#btn-maru").classList.toggle("selected",choice===1); $("#btn-batsu").classList.toggle("selected",choice===2); }
}
function aliveHumansAnswered(){
  return game.participants.filter(p=>p.alive&&(p.kind==="you"||p.kind==="remote")).every(p=>game.picks[p.pid]!==undefined);
}
function resolveIfReady(force=false){
  if(game.resolving) return;
  if(!force && !aliveHumansAnswered()) { $("#wait-text").textContent="相手の回答を待っています…"; return; }
  game.resolving=true; stopTimer();
  // 未回答のリモートはランダム扱い
  game.participants.forEach(p=>{ if(p.alive&&p.kind==="remote"&&game.picks[p.pid]===undefined) recordPick(p.pid, Math.random()<0.5?1:2, true); });
  const cur=game.questions[game.idx];
  game.participants.forEach(p=>{ if(p.alive&&p.kind==="cpu"){ const correct=Math.random()<p.skill; recordPick(p.pid, correct?cur.a:(cur.a===1?2:1)); } });
  setTimeout(()=>applyReveal(), 1100); // 人が走って移動する演出を見せる
}
function applyReveal(){
  const cur=game.questions[game.idx];
  const you=game.participants[0];
  let deadNames=[];
  game.participants.forEach(p=>{ if(p.alive&&game.picks[p.pid]!==cur.a){ p.alive=false; Stadium.fall(p.pid); if(p.kind!=="you") deadNames.push(p.name); } });
  const youCorrect=game.picks["you"]===cur.a;
  if(youCorrect) game.survived++;
  const ra=$("#reveal-answer"); ra.textContent="正解は "+(cur.a===1?"○":"×")+" ！"; ra.className="reveal-answer "+(youCorrect?"ok":"ng");
  $("#reveal-result").innerHTML=youCorrect?"🎉 <b>正解！勝ち残りです！</b>":"💥 <b>残念…不正解。ここで脱落です。</b>";
  const alive=game.participants.filter(p=>p.alive);
  $("#reveal-survivors").textContent="この問題で "+deadNames.length+" 人が脱落。勝ち残りは "+alive.length+" 人です。";
  $("#choice-area").classList.add("hidden"); $("#reveal-area").classList.remove("hidden");
  $("#next-btn").textContent=!you.alive?"結果を見る ▶":(alive.length===1&&game.mode!=="solo"?"優勝結果を見る ▶":"次の問題へ ▶");
  setHud(you.name, you.alive); renderParticipants();
  netBroadcast({t:"reveal", answer:cur.a, picks:game.picks, alive:game.participants.map(p=>({pid:p.pid,alive:p.alive})), youCorrectMap:Object.fromEntries(game.participants.filter(p=>p.kind==="remote").map(p=>[p.pid, game.picks[p.pid]===cur.a])), survivedNote:$("#reveal-survivors").textContent});
}
$("#btn-maru").addEventListener("click",()=>onChoice(1));
$("#btn-batsu").addEventListener("click",()=>onChoice(2));
function onChoice(choice){
  if(guest && !game){ // ゲスト側
    if(guest.myPick!==null||!guest.alive) return;
    guest.myPick=choice; $("#btn-maru").classList.toggle("selected",choice===1); $("#btn-batsu").classList.toggle("selected",choice===2);
    Stadium.move(guest.myPid, choice);
    if(net.hostConn&&net.hostConn.open) net.hostConn.send({t:"answer", choice});
    $("#wait-text").textContent="回答を送りました。正解発表を待っています…";
    return;
  }
  if(!game||game.myPick!==null||game.resolving) return;
  recordPick("you", choice);
  if(game.mode==="online"){ netBroadcast({t:"picks", picks:{you:choice}}); resolveIfReady(false); }
  else resolveIfReady(true);
}
$("#next-btn").addEventListener("click",()=>{
  if(guest && !game) return; // ゲストはホストの進行に従う
  const you=game.participants[0]; const alive=game.participants.filter(p=>p.alive);
  if(!you.alive) return hostFinish(false);
  if(game.mode!=="solo"&&alive.length===1) return hostFinish(true,"最後の1人まで勝ち残り！");
  game.idx++; hostNextQuestion();
});
function hostFinish(won, reason=""){
  stopTimer();
  const you=game.participants[0];
  showResult(won, reason, you.name, game.survived, game.idx+1, game.participants.filter(p=>p.alive).length, game.mode);
  netBroadcast({t:"result", wonMap:Object.fromEntries(game.participants.map(p=>[p.pid, p.alive&&won])), reason,
    stats:{survived:game.survived, played:game.idx+1, alive:game.participants.filter(p=>p.alive).length}});
  net.started=false;
}
function showResult(won, reason, name, survived, played, aliveCount, mode){
  $("#result-emoji").textContent=won?"🗽🏆":"😢";
  $("#result-title").textContent=won?"優勝！アメリカ行き決定！":"脱落…";
  $("#result-detail").textContent=won?(reason+" おめでとうございます、"+name+"さん！最後まで勝ち残りました。"):("お疲れさまでした、"+name+"さん。またニューヨークで会いましょう！");
  $("#result-stats").innerHTML="<div>勝ち残った問題<br>"+survived+" 問</div><div>挑戦した問題<br>"+played+" 問</div><div>残り勝ち残り<br>"+aliveCount+" 人</div><div>モード<br>"+(mode==="online"?"オンライン":mode==="tournament"?"大会（50人）":"1人")+"</div>";
  goto("result");
}

// ---------- モード切替UI ----------
$("#mode-select").addEventListener("change",e=>{
  const online=e.target.value==="online";
  $("#offline-options").classList.toggle("hidden",online);
  $("#online-options").classList.toggle("hidden",!online);
});
$("#start-btn").addEventListener("click", startLocalGame);

// ---------- オンライン対戦（WebRTC / PeerJS Cloud は接続の取り次ぎのみ） ----------
// 方針：このサイト自身は通信を中継・保存しない。ブラウザ同士が直接通信し、
// 送るのは回答(1/2)・進行・勝敗のみ。自由入力チャットは設けない。
const PEER_PREFIX="ultraquiz-marubatsu-";
function randomCode(){ const s="ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let c=""; for(let i=0;i<4;i++) c+=s[Math.floor(Math.random()*s.length)]; return c; }
function peerAvailable(){ return typeof Peer!=="undefined"; }

$("#create-room-btn").addEventListener("click",()=>{
  if(!peerAvailable()){ alert("オンライン機能の読み込みに失敗しました。通信環境を確認して再読み込みしてください。"); return; }
  if(net.peer) { net.peer.destroy(); net.conns.clear(); }
  net.code=randomCode(); net.isHost=true; net.started=false; net.nextPid=2;
  net.peer=new Peer(PEER_PREFIX+net.code);
  net.peer.on("open",()=>{
    $("#room-code").textContent=net.code; $("#host-lobby").classList.remove("hidden");
    $("#lobby-members").textContent="現在の参加者：あなた（"+myName()+"） 1人";
  });
  net.peer.on("error",e=>{ alert("部屋の作成に失敗しました（"+e.type+"）。少し待ってからもう一度お試しください。"); });
  net.peer.on("connection",conn=>{
    conn.on("data",msg=>{
      if(!msg||typeof msg!=="object") return;
      if(msg.t==="join"&&!net.started){
        conn._name=String(msg.name||"ゲスト").slice(0,12);
        const pid="p"+(net.nextPid++);
        conn._pid=pid; net.conns.set(pid,conn);
        conn.send({t:"welcome", pid, name:myName()});
        broadcastLobby();
      }
      if(msg.t==="answer"&&game&&conn._pid){
        if(game.picks[conn._pid]===undefined){ recordPick(conn._pid, msg.choice===1?1:2); netBroadcast({t:"picks", picks:{[conn._pid]:msg.choice===1?1:2}}); resolveIfReady(false); }
      }
    });
    conn.on("close",()=>{ if(conn._pid) net.conns.delete(conn._pid); broadcastLobby(); });
  });
});
function lobbyPlayers(){
  const list=[{pid:"you", name:myName(), kind:"you"}];
  net.conns.forEach((conn,pid)=>list.push({pid, name:conn._name||("ゲスト "+pid.slice(1)), kind:"remote"}));
  return list;
}
function broadcastLobby(){
  const players=lobbyPlayers();
  $("#lobby-members").textContent="現在の参加者："+players.map(p=>p.name).join("、")+"（"+players.length+"人）";
  netBroadcast({t:"lobby", players:players.map(p=>({pid:p.pid,name:p.name,kind:p.kind==="you"?"remote":p.kind}))});
}
function netBroadcast(obj){ net.conns.forEach(c=>{ try{ c.open&&c.send(obj); }catch(e){} }); }

$("#start-online-btn").addEventListener("click",()=>{
  if(!allQuestions.length){ alert("問題データが読み込めていません。少し待ってからもう一度お試しください。"); return; }
  // 参加者名を join 時に受け取るため、conn._name を使う（下記の join ハンドラで保存）
  const participants=[{pid:"you", name:myName(), kind:"you", you:true, alive:true}];
  net.conns.forEach((conn,pid)=>participants.push({pid, name:conn._name||("ゲスト "+pid.slice(1)), kind:"remote", alive:true}));
  const target=parseInt($("#fill-select").value,10)||20;
  let ci=0; while(participants.length<target) participants.push(makeCpu(ci++)); // 人が足りない分はCPUで補う
  game={ mode:"online", participants, questions:shuffle(allQuestions), idx:0, survived:0, picks:{}, myPick:null, useTimer:true, resolving:false };
  net.started=true;
  netBroadcast({t:"start", players:participants.map(p=>({pid:p.pid,name:p.name,kind:p.kind,alive:true})), total:game.questions.length});
  beginGameScreen();
});

// ゲスト
$("#join-room-btn").addEventListener("click",()=>{
  if(!peerAvailable()){ alert("オンライン機能の読み込みに失敗しました。再読み込みしてください。"); return; }
  const code=($("#join-code").value.trim().toUpperCase());
  if(code.length<4){ $("#guest-status").textContent="部屋コードを入力してください。"; return; }
  $("#guest-status").textContent="接続中…";
  if(net.peer) net.peer.destroy();
  net.isHost=false; net.peer=new Peer();
  net.peer.on("open",()=>{
    const conn=net.peer.connect(PEER_PREFIX+code,{reliable:true});
    net.hostConn=conn;
    conn.on("open",()=>{ conn.send({t:"join", name:myName()}); $("#guest-status").textContent="参加しました。ホストが開始するまでお待ちください。"; });
    conn.on("data",onGuestMessage);
    conn.on("close",()=>{ $("#guest-status").textContent="ホストとの接続が切れました。"; });
  });
  net.peer.on("error",e=>{ $("#guest-status").textContent="接続に失敗しました。部屋コードを確認してください（"+e.type+"）。"; });
});
function onGuestMessage(msg){
  if(!msg||typeof msg!=="object") return;
  if(msg.t==="welcome"){ guest={ myPid:msg.pid, participants:[], idx:0, myPick:null, alive:true }; }
  if(msg.t==="lobby"&&guest){ /* ロビー表示は簡易 */ $("#guest-status").textContent="ロビー参加中："+msg.players.length+"人。開始をお待ちください。"; }
  if(msg.t==="start"){
    guest.participants=msg.players.map(p=>({...p, you:p.pid===guest.myPid, kind:p.pid===guest.myPid?"you":(p.kind==="cpu"?"cpu":"remote")}));
    guest.myPick=null; guest.alive=true;
    setHud(myName(),true); goto("game"); Stadium.init(); renderParticipants();
    $("#next-btn").style.display="none";
  }
  if(msg.t==="question"&&guest){ guest.myPick=null; guest.idx=msg.idx; showQuestion(msg.idx,msg.total,msg.q); startTimer(10,null); }
  if(msg.t==="picks"&&guest){ Object.entries(msg.picks||{}).forEach(([pid,ch])=>Stadium.move(pid,ch)); }
  if(msg.t==="reveal"&&guest){
    stopTimer();
    (msg.alive||[]).forEach(a=>{ const p=guest.participants.find(x=>x.pid===a.pid); if(p){ if(p.alive&&!a.alive) Stadium.fall(a.pid); p.alive=a.alive; } });
    Object.entries(msg.picks||{}).forEach(([pid,ch])=>Stadium.move(pid,ch));
    const mine=msg.picks&&msg.picks[guest.myPid]; const correct=mine===msg.answer;
    if(guest.participants.find(p=>p.pid===guest.myPid)) guest.alive=guest.participants.find(p=>p.pid===guest.myPid).alive;
    const ra=$("#reveal-answer"); ra.textContent="正解は "+(msg.answer===1?"○":"×")+" ！"; ra.className="reveal-answer "+(correct?"ok":"ng");
    $("#reveal-result").innerHTML=correct?"🎉 <b>正解！勝ち残りです！</b>":"💥 <b>残念…不正解。ここで脱落です。</b>";
    $("#reveal-survivors").textContent=msg.survivedNote||"";
    $("#choice-area").classList.add("hidden"); $("#reveal-area").classList.remove("hidden"); $("#next-btn").style.display="none";
    setHud(myName(), guest.alive); renderParticipants();
  }
  if(msg.t==="result"&&guest){
    const won=msg.wonMap?!!msg.wonMap[guest.myPid]:false;
    showResult(won, msg.reason||"", myName(), msg.stats?msg.stats.survived:0, msg.stats?msg.stats.played:0, msg.stats?msg.stats.alive:0, "online");
    $("#next-btn").style.display="";
  }
}
loadQuestions();
