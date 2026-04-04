import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAO5TuFOawHyQAA5hkKAPO5s8JdUZW1SfI",
  authDomain: "who-ate--the-cheese.firebaseapp.com",
  projectId: "who-ate--the-cheese",
  storageBucket: "who-ate--the-cheese.firebasestorage.app",
  messagingSenderId: "135374886454",
  appId: "1:135374886454:web:4706ba7fae4329bc872a97",
  measurementId: "G-VNB5SEETWX"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentRoom = null;
let myName = null;

// ③ 人数別役職内訳
function getRoleBreakdown(playerCount) {
  let henchmen = 0;
  if (playerCount >= 5 && playerCount <= 7) henchmen = 1;
  if (playerCount >= 8) henchmen = 2;
  return { thieves: 1, henchmen, sleepy: playerCount - 1 - henchmen };
}

function getRoleLabel(role) {
  if (role === "thief") return "チーズドロボー";
  if (role === "henchman") return "手下";
  return "ねぼすけ";
}

window.createRoom = async function () {
  myName = document.getElementById("name").value;
  const room = document.getElementById("room").value;
  const ref = doc(db, "rooms", room);
  await setDoc(ref, { players: [myName], phase: "lobby" });
  currentRoom = room;
  hideLobbyUI();
  document.getElementById("startBtn").style.display = "block";
  subscribeRoom();
};

window.joinRoom = async function () {
  myName = document.getElementById("name").value;
  const room = document.getElementById("room").value;
  const ref = doc(db, "rooms", room);
  const snap = await getDoc(ref);
  if (!snap.exists()) { alert("ルームがありません"); return; }
  let players = snap.data().players;
  if (players.includes(myName)) { alert("その名前は使われています"); return; }
  players.push(myName);
  await updateDoc(ref, { players });
  currentRoom = room;
  hideLobbyUI();
  document.getElementById("startBtn").style.display = "block";
  subscribeRoom();
};

function hideLobbyUI() {
  document.getElementById("name").style.display = "none";
  document.getElementById("room").style.display = "none";
  document.getElementById("createBtn").style.display = "none";
  document.getElementById("joinBtn").style.display = "none";
}

window.startGame = async function () {
  document.getElementById("startBtn").style.display = "none";

  const ref = doc(db, "rooms", currentRoom);
  const snap = await getDoc(ref);
  const players = snap.data().players;

  let henchmanCount = 0;
  if (players.length >= 5 && players.length <= 7) henchmanCount = 1;
  if (players.length >= 8) henchmanCount = 2;

  let thiefIndex = Math.floor(Math.random() * players.length);

  let nonThiefIndices = players.map((_, i) => i).filter(i => i !== thiefIndex);
  for (let i = nonThiefIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nonThiefIndices[i], nonThiefIndices[j]] = [nonThiefIndices[j], nonThiefIndices[i]];
  }
  const henchmanIndices = new Set(nonThiefIndices.slice(0, henchmanCount));

  let roles = {};
  players.forEach((p, i) => {
    if (i === thiefIndex) roles[p] = "thief";
    else if (henchmanIndices.has(i)) roles[p] = "henchman";
    else roles[p] = "sleepy";
  });

  let wakeTimes = {};
  players.forEach(p => { wakeTimes[p] = Math.floor(Math.random() * 6) + 1; });
  let eatTime = wakeTimes[players[thiefIndex]];

  await updateDoc(ref, {
    roles, wakeTimes, eatTime, votes: {},
    henchmen: players.filter((_, i) => henchmanIndices.has(i)),
    phase: "night"
  });
};

function subscribeRoom() {
  const ref = doc(db, "rooms", currentRoom);
  onSnapshot(ref, (snap) => {
    const data = snap.data();
    updatePlayers(data.players);
    if (data.phase === "lobby") return;
    if (data.phase === "night") runNight(data);
    if (data.phase === "henchman") runHenchman(data);
    if (data.phase === "discussion") runDiscussion(data);
    if (data.phase === "vote") runVote(data);
    if (data.phase === "result") runResult(data);
  });
}

// ③ プレイヤー一行表示 + 人数 + 役職内訳
function updatePlayers(players) {
  const el = document.getElementById("players");
  const bd = getRoleBreakdown(players.length);
  let bdParts = [`ドロボー×${bd.thieves}`];
  if (bd.henchmen > 0) bdParts.push(`手下×${bd.henchmen}`);
  bdParts.push(`ねぼすけ×${bd.sleepy}`);
  el.innerHTML =
    `<span class="player-count">${players.length}人</span>` +
    `<span class="player-names">${players.join("　")}</span>` +
    `<span class="role-breakdown">（${bdParts.join(" / ")}）</span>`;
}

function runNight(data) {
  const role = data.roles[myName];
  const wakeTime = data.wakeTimes[myName];
  const eatTime = data.eatTime;

  let same = [];
  for (let p in data.wakeTimes) {
    if (data.wakeTimes[p] === wakeTime) same.push(p);
  }
  const others = same.filter(p => p !== myName);

  let thief = null;
  for (let p in data.roles) { if (data.roles[p] === "thief") thief = p; }

  let cheese = wakeTime < eatTime ? "残っていました" : "残っていませんでした";
  let msg = "あなたは " + wakeTime + " 時に起きました。";
  if (others.length > 0) msg += " 同時に起きた人：" + others.join(", ") + "。";
  if (role !== "thief") msg += " チーズは" + cheese;
  if (role === "thief") msg += " あなたはチーズを食べました";
  if (others.includes(thief)) msg += " " + thief + "がチーズを食べました";

  if (role === "sleepy" && others.length === 0) {
    let targets = data.players.filter(p => p !== myName);
    let target = targets[Math.floor(Math.random() * targets.length)];
    msg += " " + target + "は" + data.wakeTimes[target] + "時に起きました。";
  }

  document.getElementById("night").textContent = msg;

  setTimeout(async () => {
    if (role === "thief") {
      const ref = doc(db, "rooms", currentRoom);
      await updateDoc(ref, { phase: "henchman" });
    }
  }, 4000);
}

function runHenchman(data) {
  document.getElementById("startBtn").style.display = "none";
  const area = document.getElementById("henchmanArea");
  area.innerHTML = "";
  const role = data.roles[myName];
  const playerCount = data.players.length;
  let henchmanCount = 0;
  if (playerCount >= 5 && playerCount <= 7) henchmanCount = 1;
  if (playerCount >= 8) henchmanCount = 2;

  if (role !== "thief") {
    area.textContent = "チーズドロボーが手下を選んでいます";
    return;
  }

  if (henchmanCount === 0) {
    area.textContent = "この人数では手下はいません";
    setTimeout(async () => {
      const ref = doc(db, "rooms", currentRoom);
      await updateDoc(ref, { henchmen: [], phase: "discussion" });
    }, 2000);
    return;
  }

  const title = document.createElement("p");
  title.textContent = "手下を" + henchmanCount + "人選んでください";
  area.appendChild(title);

  data.players.filter(p => p !== myName).forEach(p => {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = p;
    cb.onchange = () => {
      const checked = document.querySelectorAll("#henchmanArea input:checked");
      if (checked.length > henchmanCount) cb.checked = false;
    };
    label.appendChild(cb);
    label.append(" " + p);
    area.appendChild(label);
    area.appendChild(document.createElement("br"));
  });

  const btn = document.createElement("button");
  btn.textContent = "手下決定";
  btn.onclick = () => submitHenchmen(henchmanCount);
  area.appendChild(btn);
}

window.submitHenchmen = async function (henchmanCount) {
  const checks = document.querySelectorAll("#henchmanArea input:checked");
  if (checks.length !== henchmanCount) { alert("手下は" + henchmanCount + "人選んでください"); return; }
  let henchmen = [];
  checks.forEach(c => henchmen.push(c.value));
  document.getElementById("henchmanArea").style.display = "none";
  const ref = doc(db, "rooms", currentRoom);
  await updateDoc(ref, { henchmen, phase: "discussion" });
};

function runDiscussion(data) {
  document.getElementById("henchmanArea").style.display = "none";
  const role = data.roles[myName];
  const team = document.getElementById("team");
  team.textContent = "";

  if (role === "thief") {
    if (data.henchmen && data.henchmen.length > 0) {
      team.textContent = data.henchmen.join(", ") + " を手下にしました";
    }
  } else if (data.henchmen && data.henchmen.includes(myName)) {
    let thief;
    for (let p in data.roles) { if (data.roles[p] === "thief") thief = p; }
    let others = data.henchmen.filter(p => p !== myName);
    let msg = "あなたはチーズドロボーの手下になりました ";
    msg += "ドロボー：" + thief;
    if (others.length > 0) msg += " 仲間の手下：" + others.join(", ");
    team.textContent = msg;
  }

  let time = 180;
  const timer = setInterval(() => {
    document.getElementById("discussion").textContent = "議論中 残り" + time + "秒";
    time--;
    if (time < 0) {
      clearInterval(timer);
      if (role === "thief") startVote();
    }
  }, 1000);
}

async function startVote() {
  const ref = doc(db, "rooms", currentRoom);
  await updateDoc(ref, { phase: "vote", runoff: [] });
}

function runVote(data) {
  const area = document.getElementById("voteArea");
  area.innerHTML = "";

  if (data.votes && data.votes[myName]) {
    area.textContent = "投票済みです";
    return;
  }

  document.getElementById("vote").textContent = "投票してください";

  let candidates = (data.runoff && data.runoff.length > 0)
    ? data.runoff
    : data.players.filter(p => p !== myName);

  candidates.forEach(p => {
    const btn = document.createElement("button");
    btn.textContent = p;
    btn.onclick = () => submitVote(p);
    area.appendChild(btn);
    area.appendChild(document.createElement("br"));
  });
}

window.submitVote = async function (target) {
  const ref = doc(db, "rooms", currentRoom);
  const snap = await getDoc(ref);
  let votes = snap.data().votes || {};
  votes[myName] = target;
  await updateDoc(ref, { votes });
  document.getElementById("voteArea").innerHTML = "投票済みです";
  checkVotes();
};

async function checkVotes() {
  const ref = doc(db, "rooms", currentRoom);
  const snap = await getDoc(ref);
  const data = snap.data();
  if (Object.keys(data.votes).length === data.players.length) {
    await updateDoc(ref, { phase: "result" });
  }
}

function runResult(data) {
  document.getElementById("discussion").style.display = "none";
  document.getElementById("vote").style.display = "none";
  document.getElementById("voteArea").style.display = "none";

  let count = {};
  for (let p in data.votes) {
    let t = data.votes[p];
    count[t] = (count[t] || 0) + 1;
  }

  let max = 0;
  let targets = [];
  for (let p in count) {
    if (count[p] > max) { max = count[p]; targets = [p]; }
    else if (count[p] === max) { targets.push(p); }
  }

  const ref = doc(db, "rooms", currentRoom);

  if (targets.length > 1) {
    document.getElementById("result").textContent = "同票のため決選投票を行います";
    document.getElementById("voteArea").innerHTML = "";
    updateDoc(ref, { votes: {}, runoff: targets, phase: "vote" });
    return;
  }

  let executed = targets[0];
  let executedRole = data.roles[executed];
  let executedLabel = getRoleLabel(executedRole);

  // ① 投票ログ
  let voteLines = [];
  for (let voter in data.votes) {
    voteLines.push(`${voter}　＞　${data.votes[voter]}`);
  }

  // チーズドロボーチームが処刑されたか
  const isThiefTeam = executedRole === "thief" || executedRole === "henchman";
  const winMsg = isThiefTeam
    ? '<span class="win-sleepy">ねぼすけチームの勝利！！</span>'
    : '<span class="win-thief">チーズドロボーチームの勝利！！</span>';

  let html = '<div class="vote-log">';
  voteLines.forEach(line => { html += `<div>${line}</div>`; });
  html += '</div>';
  html += `<div class="executed-info">最多票は<strong>${executed}</strong>。</div>`;
  html += `<div class="executed-info"><strong>${executed}</strong>は「${executedLabel}」なので、${winMsg}</div>`;

  // ② もう一回ボタン
  html += '<button id="replayBtn" onclick="replayGame()">もう一回</button>';

  document.getElementById("result").innerHTML = html;
}

// ② もう一回
window.replayGame = async function () {
  const ref = doc(db, "rooms", currentRoom);

  // UIリセット
  ["night", "team", "discussion", "vote"].forEach(id => {
    const el = document.getElementById(id);
    el.style.display = "";
    el.textContent = "";
  });
  ["henchmanArea", "voteArea"].forEach(id => {
    const el = document.getElementById(id);
    el.style.display = "";
    el.innerHTML = "";
  });
  document.getElementById("result").innerHTML = "";
  document.getElementById("startBtn").style.display = "block";

  await updateDoc(ref, {
    phase: "lobby",
    roles: {},
    wakeTimes: {},
    eatTime: null,
    votes: {},
    henchmen: [],
    runoff: []
  });
};
