// アメリカ横断ウルトラクイズ風 ○×勝ち残りクイズ
// 問題データ: questions.csv （question,answer / ○=1, ×=2）
// GitHub Pages では同じフォルダの questions.csv を fetch して読み込みます。
const LS_KEY = "ultraquiz_questions_csv_v1";
let allQuestions = [];       // {q, a} a:1=○ 2=×
let game = null;
let timerId = null;

const $ = s => document.querySelector(s);
const screens = ["title","game","result","editor","howto"];
function goto(name){
  screens.forEach(n=>$("#screen-"+n).classList.toggle("active", n===name));
  window.scrollTo({top:0,behavior:"smooth"});
  if(name==="editor") renderEditor();
}
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>goto(b.dataset.goto)));

// ---------- CSV ----------
function parseCSV(text){
  const rows=[]; let row=[], cur="", inQ=false;
  text = text.replace(/^\uFEFF/,"");
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inQ){
      if(c==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else inQ=false; }
      else cur+=c;
    }else{
      if(c==='"') inQ=true;
      else if(c===','){ row.push(cur); cur=""; }
      else if(c==='\n'){ row.push(cur); rows.push(row); row=[]; cur=""; }
      else if(c!=='\r') cur+=c;
    }
  }
  if(cur!==""||row.length){ row.push(cur); rows.push(row); }
  const out=[];
  rows.forEach((r,idx)=>{
    if(r.length<2) return;
    const q=(r[0]||"").trim(), a=parseInt((r[1]||"").trim(),10);
    if(idx===0 && (a!==1&&a!==2)) return; // header
    if(!q || (a!==1&&a!==2)) return;
    out.push({q,a});
  });
  return out;
}
function toCSV(list){
  const esc=s=> /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  return "question,answer\n"+list.map(x=>esc(x.q)+","+x.a).join("\n")+"\n";
}
async function loadQuestions(){
  const saved = localStorage.getItem(LS_KEY);
  if(saved){ const p=parseCSV(saved); if(p.length){ allQuestions=p; updateBadge("保存済みの問題 "+p.length+" 問"); return; } }
  try{
    const res = await fetch("questions.csv",{cache:"no-store"});
    if(!res.ok) throw new Error(res.status);
    const p = parseCSV(await res.text());
    if(p.length){ allQuestions=p; updateBadge("questions.csv から "+p.length+" 問を読み込み"); return; }
    throw new Error("empty");
  }catch(e){
    // file:// 等で fetch できない場合の内蔵サンプル
    allQuestions = [
      {q:"アメリカの首都はニューヨークである",a:2},
      {q:"自由の女神はフランスからアメリカへ贈られたものである",a:1},
      {q:"アメリカの国旗の星の数は51個である",a:2},
      {q:"ハワイはアメリカの50番目の州である",a:1},
      {q:"ラスベガスはネバダ州にある",a:1},
    ];
    updateBadge("内蔵サンプル "+allQuestions.length+" 問（questions.csv が読めませんでした）");
  }
}
function updateBadge(t){ $("#qcount-badge").textContent=t; }

// ---------- Game ----------
function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }

function startGame(){
  if(!allQuestions.length){ alert("問題がありません。「問題を編集」からCSVを読み込んでください。"); return; }
  const mode = $("#mode-select").value;
  const totalCpu = mode==="tournament" ? 49 : 0;
  const participants = [{name:$("#player-name").value.trim()||"挑戦者", you:true, alive:true, skill:1}];
  for(let i=0;i<totalCpu;i++) participants.push({name:"挑戦者"+(i+2), you:false, alive:true, skill:0.55+Math.random()*0.32});
  let qs = $("#order-select").value==="shuffle" ? shuffle(allQuestions) : [...allQuestions];
  game = {mode, participants, questions:qs, idx:0, survived:0, picked:null, useTimer:$("#timer-check").checked};
  $("#hud-name").textContent = participants[0].name;
  $("#q-total").textContent = qs.length;
  goto("game");
  renderParticipants(); nextQuestion();
}
$("#start-btn").addEventListener("click", startGame);

function aliveList(){ return game.participants.filter(p=>p.alive); }

function nextQuestion(){
  if(game.idx>=game.questions.length){ return finish(true,"全問勝ち残り！"); }
  game.picked=null;
  const cur = game.questions[game.idx];
  $("#q-num").textContent = game.idx+1;
  $("#alive-count").textContent = aliveList().length;
  $("#question-text").textContent = cur.q;
  $("#choice-area").classList.remove("hidden");
  $("#reveal-area").classList.add("hidden");
  $("#btn-maru").classList.remove("selected"); $("#btn-batsu").classList.remove("selected");
  $("#people-maru").textContent=""; $("#people-batsu").textContent="";
  $("#you-marker").className="you-marker"; $("#you-marker").style.display="";
  startTimer();
}
function startTimer(){
  stopTimer();
  const bar=$("#timer-bar"), txt=$("#timer-text");
  if(!game.useTimer){ bar.style.width="100%"; txt.textContent="∞"; return; }
  let remain=10; bar.style.width="100%"; txt.textContent=remain;
  const started=Date.now();
  timerId=setInterval(()=>{
    const left=10-(Date.now()-started)/1000;
    bar.style.width=Math.max(0,left*10)+"%"; txt.textContent=Math.max(0,Math.ceil(left));
    if(left<=0){ stopTimer(); if(game.picked===null) pick(Math.random()<0.5?1:2,true); }
  },100);
}
function stopTimer(){ if(timerId){clearInterval(timerId); timerId=null;} }

function pick(choice, timedOut=false){
  if(game.picked!==null) return;
  stopTimer();
  game.picked=choice;
  $("#btn-maru").classList.toggle("selected", choice===1);
  $("#btn-batsu").classList.toggle("selected", choice===2);
  $("#you-marker").className = "you-marker " + (choice===1?"in-maru":"in-batsu");

  const cur = game.questions[game.idx];
  // CPUの回答を決める
  const cpuPicks = new Map();
  game.participants.forEach(p=>{
    if(p.you || !p.alive) return;
    const correct = Math.random() < p.skill;
    cpuPicks.set(p, correct ? cur.a : (cur.a===1?2:1));
  });
  const countIn = (zone)=>{
    let n = (game.picked===zone?1:0);
    cpuPicks.forEach(v=>{ if(v===zone) n++; });
    return n;
  };
  $("#people-maru").textContent = "🧑".repeat(Math.min(30,countIn(1))) + (countIn(1)>30?"…":"");
  $("#people-batsu").textContent = "🧑".repeat(Math.min(30,countIn(2))) + (countIn(2)>30?"…":"");

  // 正解発表
  const you = game.participants[0];
  const youCorrect = game.picked===cur.a;
  let cpuDead=0;
  game.participants.forEach(p=>{
    if(p.you) return;
    if(p.alive && cpuPicks.get(p)!==cur.a){ p.alive=false; cpuDead++; }
  });
  if(youCorrect){ game.survived++; } else { you.alive=false; }

  const ra=$("#reveal-answer");
  ra.textContent = "正解は " + (cur.a===1?"○":"×") + " ！";
  ra.className = "reveal-answer " + (youCorrect?"ok":"ng");
  $("#reveal-result").innerHTML = youCorrect
    ? "🎉 <b>正解！勝ち残りです！</b>" + (timedOut?"（時間切れのためランダム選択でした）":"")
    : "💥 <b>残念…不正解。ここで脱落です。</b>" + (timedOut?"（時間切れのためランダム選択でした）":"");
  $("#reveal-survivors").textContent = game.mode==="tournament"
    ? "この問題で "+cpuDead+" 人が脱落。勝ち残りは "+aliveList().length+" 人です。"
    : "現在 "+game.survived+" 問勝ち残り中。";
  $("#choice-area").classList.add("hidden");
  $("#reveal-area").classList.remove("hidden");
  $("#alive-count").textContent = aliveList().length;
  $("#hud-status").textContent = you.alive?"生存中":"脱落";
  $("#hud-status").className = you.alive?"alive":"dead";
  renderParticipants(true);
  $("#next-btn").textContent = !you.alive ? "結果を見る ▶" :
    (game.mode==="tournament" && aliveList().length===1) ? "優勝結果を見る ▶" : "次の問題へ ▶";
}
$("#btn-maru").addEventListener("click",()=>pick(1));
$("#btn-batsu").addEventListener("click",()=>pick(2));
$("#next-btn").addEventListener("click",()=>{
  const you = game.participants[0];
  if(!you.alive) return finish(false);
  if(game.mode==="tournament" && aliveList().length===1) return finish(true,"最後の1人まで勝ち残り！");
  game.idx++; nextQuestion();
});
function renderParticipants(reveal=false){
  const grid=$("#participants-grid"); grid.innerHTML="";
  game.participants.forEach(p=>{
    const d=document.createElement("div");
    d.className="person"+(p.you?" you":"")+(!p.alive?" dead":"");
    d.textContent=p.you?"★":(p.alive?"🧑":"✕");
    d.title=p.name+(p.alive?"（生存）":"（脱落）");
    grid.appendChild(d);
  });
}
function finish(won, reason=""){
  stopTimer();
  const you = game.participants[0];
  $("#result-emoji").textContent = won ? "🗽🏆" : "😢";
  $("#result-title").textContent = won ? "優勝！アメリカ行き決定！" : "脱落… 第"+(game.idx+1)+"問で敗退";
  $("#result-detail").textContent = won
    ? (reason+" おめでとうございます、"+you.name+"さん！最後まで勝ち残りました。")
    : ("お疲れさまでした、"+you.name+"さん。正解は積み重ねが大事。またニューヨークで会いましょう！");
  $("#result-stats").innerHTML =
    "<div>勝ち残った問題<br>"+game.survived+" 問</div>"+
    "<div>挑戦した問題<br>"+(game.idx+1)+" 問</div>"+
    "<div>残り勝ち残り<br>"+aliveList().length+" 人</div>"+
    "<div>モード<br>"+(game.mode==="tournament"?"大会（50人）":"1人")+"</div>";
  goto("result");
}

// ---------- Editor ----------
function renderEditor(){
  const list=$("#editor-list"); list.innerHTML="";
  allQuestions.forEach((item,i)=>{
    const row=document.createElement("div"); row.className="editor-row";
    const ta=document.createElement("textarea"); ta.value=item.q;
    ta.addEventListener("change",()=>{ item.q=ta.value.trim(); saveEdited(); });
    const sel=document.createElement("select");
    sel.innerHTML='<option value="1">○ （1）</option><option value="2">× （2）</option>';
    sel.value=String(item.a);
    sel.addEventListener("change",()=>{ item.a=parseInt(sel.value,10); saveEdited(); });
    const del=document.createElement("button"); del.textContent="🗑"; del.title="削除";
    del.addEventListener("click",()=>{ allQuestions.splice(i,1); saveEdited(); renderEditor(); });
    row.append(ta,sel,del); list.appendChild(row);
  });
  $("#editor-status").textContent="現在の問題数："+allQuestions.length+" 問";
}
function saveEdited(){ localStorage.setItem(LS_KEY, toCSV(allQuestions)); updateBadge("保存済みの問題 "+allQuestions.length+" 問"); }
$("#add-question").addEventListener("click",()=>{ allQuestions.push({q:"新しい問題をここに入力",a:1}); saveEdited(); renderEditor(); });
$("#reset-csv").addEventListener("click",()=>{ if(confirm("ブラウザに保存した編集を消して、questions.csv の内容に戻しますか？")){ localStorage.removeItem(LS_KEY); loadQuestions().then(()=>{ renderEditor(); alert("初期問題に戻しました"); }); }});
$("#download-csv").addEventListener("click",()=>{
  const blob=new Blob([toCSV(allQuestions)],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="questions.csv"; a.click(); URL.revokeObjectURL(a.href);
});
$("#csv-file").addEventListener("change", async e=>{
  const f=e.target.files[0]; if(!f) return;
  const parsed=parseCSV(await f.text());
  if(!parsed.length){ alert("読み込める問題がありませんでした。形式（question,answer / ○=1 ×=2）を確認してください。"); return; }
  allQuestions=parsed; saveEdited(); renderEditor();
  alert(parsed.length+" 問を読み込みました");
});

loadQuestions();
