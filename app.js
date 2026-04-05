import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot, arrayUnion, serverTimestamp
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
let hasVoted = false;
let timerInterval = null;
let lastPhase = null;
let lastRunoffLength = 0;
let henchmanCountGlobal = 0;

// ===== ユーティリティ =====

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

// ===== チャット =====

function addChat(name, text, type = "other") {
  // type: "me" | "other" | "system" | "win"
  const log = document.getElementById("chatLog");
  const div = document.createElement("div");
  div.className = "msg " + (type === "win" ? "system win" : type);

  if (type !== "system" && type !== "win") {
    const nameEl = document.createElement("div");
    nameEl.className = "msg-name";
    nameEl.textContent = name;
    div.appendChild(nameEl);
  }

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = text;
  div.appendChild(bubble);
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function sysMsg(text) { addChat("", text, "system"); }
function winMsg(text) { addChat("", text, "win"); }

// Firestoreのchatログを購読して表示（既読管理はインデックスで）
let chatRenderedCount = 0;

function renderChatLog(chatLog) {
  if (!chatLog) return;
  for (let i = chatRenderedCount; i < chatLog.length; i++) {
    const entry = chatLog[i];
    if (entry.type === "system") { sysMsg(entry.text); }
    else if (entry.type === "win") { winMsg(entry.text); }
    else {
      const type = entry.name === myName ? "me" : "other";
      addChat(entry.name, entry.text, type);
    }
  }
  chatRenderedCount = chatLog.length;
}

async function pushChat(entry) {
  const ref = doc(db, "rooms", currentRoom);
  await updateDoc(ref, { chatLog: arrayUnion(entry) });
}

window.sendChat = async function () {
  const input = document.getElementById("msgInput");
  const text = input.value.trim();
  if (!text || !currentRoom) return;
  input.value = "";
  await pushChat({ name: myName, text, type: "user" });
};

// ===== ロビー =====

window.createRoom = async function () {
  myName = document.getElementById("nameInput").value.trim();
  const room = document.getElementById("roomInput").value.trim();
  if (!myName || !room) return;
  const ref = doc(db, "rooms", room);
  await setDoc(ref, {
    players: [myName], phase: "lobby", host: myName,
    chatLog: [{ type: "system", text: `ルーム「${room}」が作成されました` }]
  });
  currentRoom = room;
  hideLobbyUI();
  subscribeRoom();
};

window.joinRoom = async function () {
  myName = document.getElementById("nameInput").value.trim();
  const room = document.getElementById("roomInput").value.trim();
  if (!myName || !room) return;
  const ref = doc(db, "rooms", room);
  const snap = await getDoc(ref);
  if (!snap.exists()) { alert("ルームがありません"); return; }
  let players = snap.data().players;
  if (players.includes(myName)) { alert("その名前は使われています"); return; }
  players.push(myName);
  await updateDoc(ref, {
    players,
    chatLog: arrayUnion({ type: "system", text: `${myName} が参加しました` })
  });
  currentRoom = room;
  hideLobbyUI();
  subscribeRoom();
};

function hideLobbyUI() {
  document.getElementById("lobbyArea").style.display = "none";
}

// ===== ゲーム開始 =====

window.startGame = async function () {
  document.getElementById("startBtn").style.display = "none";
  document.getElementById("actionArea").querySelector("#replayWait").textContent = "";

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
  const eatTime = wakeTimes[players[thiefIndex]];

  await updateDoc(ref, {
    roles, wakeTimes, eatTime, votes: {},
    henchmen: players.filter((_, i) => henchmanIndices.has(i)),
    phase: "night", runoff: [],
    chatLog: [{ type: "system", text: "━━ ゲーム開始！夜のフェーズ ━━" }]
  });
};

// ===== 購読 =====

function subscribeRoom() {
  const ref = doc(db, "rooms", currentRoom);
  onSnapshot(ref, (snap) => {
    const data = snap.data();

    // プレイヤー表示
    updatePlayers(data.players);

    // ① ホストのみスタートボタン表示（lobbyフェーズ中）
    if (data.phase === "lobby" && data.host === myName) {
      document.getElementById("startBtn").style.display = "block";
    }

    // チャットログ同期（差分のみ）
    renderChatLog(data.chatLog);

    if (data.phase === "lobby") return;

    // フェーズ変化時のみ各関数を呼ぶ（runoffの変化も検知）
    const phaseKey = data.phase + "_" + (data.runoff ? data.runoff.length : 0);
    if (phaseKey !== lastPhase) {
      lastPhase = phaseKey;
      if (data.phase === "night") handleNight(data);
      if (data.phase === "henchman") handleHenchman(data);
      if (data.phase === "discussion") handleDiscussion(data);
      if (data.phase === "vote") handleVote(data);
      if (data.phase === "result") handleResult(data);
    }
  });
}

// ===== プレイヤー表示 =====

function updatePlayers(players) {
  const el = document.getElementById("players");
  const bd = getRoleBreakdown(players.length);
  let bdParts = [`ドロボー×${bd.thieves}`];
  if (bd.henchmen > 0) bdParts.push(`手下×${bd.henchmen}`);
  bdParts.push(`ねぼすけ×${bd.sleepy}`);
  el.innerHTML =
    `<span class="player-count">${players.length}人</span>` +
    `<span class="player-names">　${players.join("　")}</span>` +
    `<span class="role-breakdown">　（${bdParts.join(" / ")}）</span>`;
}

// ===== 夜 =====

function handleNight(data) {
  // UIリセット
  resetGameUI();

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

  let cheese = wakeTime < eatTime ? "残っていました🧀" : "残っていませんでした";
  // ② 役職表示を更新（ゲーム中ずっと表示）
  document.getElementById("roleMsg").textContent = `役職：【${getRoleLabel(data.roles[myName])}】`;
  let lines = [`あなたは ${wakeTime} 時に起きました。`];
  if (others.length > 0) lines.push(`同時に起きた人：${others.join(", ")}`);
  if (role !== "thief") lines.push(`チーズは${cheese}`);
  if (role === "thief") lines.push("あなたはチーズを食べました🧀");
  if (others.includes(thief)) lines.push(`${thief} がチーズを食べました`);
  if (role === "sleepy" && others.length === 0) {
    let targets = data.players.filter(p => p !== myName);
    let target = targets[Math.floor(Math.random() * targets.length)];
    lines.push(`${target} は ${data.wakeTimes[target]} 時に起きました。`);
  }

  const nightEl = document.getElementById("nightMsg");
  nightEl.className = "private";
  nightEl.textContent = lines.join("\n");

  // ③ 役職＋夜情報を個人チャットに追加（Firestoreには書かない個人情報）
  // renderChatLog と競合しないよう nightChatDone フラグで1回だけ実行
  if (!window._nightChatDone) {
    window._nightChatDone = true;
    addChat("", `🎭 あなたの役職：【${getRoleLabel(role)}】`, "system");
    lines.forEach(line => addChat("", "🌙 " + line, "system"));
    setTimeout(() => {
      addChat("", "━━ 議論フェーズ開始 ━━", "system");
    }, 4000);
  }

  setTimeout(async () => {
    if (role === "thief") {
      const ref = doc(db, "rooms", currentRoom);
      await updateDoc(ref, { phase: "henchman" });
    }
  }, 4000);
}

// ===== 手下 =====

function handleHenchman(data) {
  const role = data.roles[myName];
  const playerCount = data.players.length;
  henchmanCountGlobal = 0;
  if (playerCount >= 5 && playerCount <= 7) henchmanCountGlobal = 1;
  if (playerCount >= 8) henchmanCountGlobal = 2;

  if (role !== "thief") return; // ドロボー以外は待つだけ（チャットに表示済み）

  if (henchmanCountGlobal === 0) {
    setTimeout(async () => {
      const ref = doc(db, "rooms", currentRoom);
      await updateDoc(ref, { henchmen: [], phase: "discussion" });
    }, 500);
    return;
  }

  const section = document.getElementById("henchmanSection");
  section.classList.add("active");
  document.getElementById("henchmanTitle").textContent = `手下を ${henchmanCountGlobal} 人選んでください`;

  const checks = document.getElementById("henchmanChecks");
  checks.innerHTML = "";
  data.players.filter(p => p !== myName).forEach(p => {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = p;
    cb.onchange = () => {
      const checked = document.querySelectorAll("#henchmanChecks input:checked");
      if (checked.length > henchmanCountGlobal) cb.checked = false;
    };
    label.appendChild(cb);
    label.append(" " + p);
    checks.appendChild(label);
  });
}

window.submitHenchmen = async function () {
  const checks = document.querySelectorAll("#henchmanChecks input:checked");
  if (checks.length !== henchmanCountGlobal) {
    alert(`手下は ${henchmanCountGlobal} 人選んでください`);
    return;
  }
  let henchmen = [];
  checks.forEach(c => henchmen.push(c.value));
  document.getElementById("henchmanSection").classList.remove("active");

  const ref = doc(db, "rooms", currentRoom);
  await updateDoc(ref, { henchmen, phase: "discussion" });
};

// ===== 議論 =====

function handleDiscussion(data) {
  document.getElementById("henchmanSection").classList.remove("active");

  const role = data.roles[myName];

  // チームinfo（自分だけ）
  let teamText = "";
  if (role === "thief" && data.henchmen && data.henchmen.length > 0) {
    teamText = `🤝 手下：${data.henchmen.join(", ")}`;
  } else if (data.henchmen && data.henchmen.includes(myName)) {
    let thief;
    for (let p in data.roles) { if (data.roles[p] === "thief") thief = p; }
    let others = data.henchmen.filter(p => p !== myName);
    teamText = `🤝 ドロボー：${thief}` + (others.length > 0 ? `　仲間：${others.join(", ")}` : "");
  }
  if (teamText) {
    const teamEl = document.getElementById("teamMsg");
    teamEl.textContent = teamText;
  }

  // タイマー（議論180秒）
  if (timerInterval) clearInterval(timerInterval);
  const total = 180;
  let remaining = total;
  const bar = document.getElementById("timerBar");
  const fill = document.getElementById("timerFill");
  const sec = document.getElementById("timerSec");
  const label = document.getElementById("timerLabel");
  bar.classList.add("active");
  label.textContent = "議論中";

  timerInterval = setInterval(() => {
    remaining--;
    sec.textContent = remaining + "s";
    fill.style.width = (remaining / total * 100) + "%";
    if (remaining <= 30) fill.style.background = "var(--accent)";

    if (remaining <= 0) {
      clearInterval(timerInterval);
      bar.classList.remove("active");
      if (role === "thief") startVote();
    }
  }, 1000);
  sec.textContent = remaining + "s";
}

// ===== 投票 =====

async function startVote() {
  hasVoted = false;
  const ref = doc(db, "rooms", currentRoom);
  await updateDoc(ref, {
    phase: "vote", runoff: [],
    chatLog: arrayUnion({ type: "system", text: "━━ 投票フェーズ ━━" })
  });
}

function handleVote(data) {
  if (timerInterval) { clearInterval(timerInterval); }
  document.getElementById("timerBar").classList.remove("active");

  const section = document.getElementById("voteSection");
  section.classList.add("active");

  const votedMsg = document.getElementById("votedMsg");
  const btns = document.getElementById("voteButtons");

  if (hasVoted) {
    btns.style.display = "none";
    votedMsg.style.display = "block";
    return;
  }

  btns.style.display = "flex";
  votedMsg.style.display = "none";
  btns.innerHTML = "";

  const isRunoff = data.runoff && data.runoff.length > 0;
  const voteLabel = document.getElementById("voteLabel");
  voteLabel.textContent = isRunoff ? "🔁 決選投票：投票先を選んでください" : "投票先を選んでください";

  let candidates = isRunoff
    ? data.runoff.filter(p => p !== myName)
    : data.players.filter(p => p !== myName);

  candidates.forEach(p => {
    const btn = document.createElement("button");
    btn.textContent = p;
    btn.onclick = () => submitVote(p);
    btns.appendChild(btn);
  });
}

window.submitVote = async function (target) {
  hasVoted = true;
  document.getElementById("voteButtons").style.display = "none";
  document.getElementById("votedMsg").style.display = "block";

  // ④ 自分の投票先をローカルのチャットに表示
  addChat("", `🗳 あなたは「${target}」に投票しました`, "system");

  const ref = doc(db, "rooms", currentRoom);
  const snap = await getDoc(ref);
  let votes = snap.data().votes || {};
  votes[myName] = target;
  await updateDoc(ref, { votes });

  // 全員投票済みチェック
  const data2 = (await getDoc(ref)).data();
  if (Object.keys(data2.votes).length === data2.players.length) {
    await updateDoc(ref, { phase: "result" });
  }
};

// ===== 結果 =====

async function handleResult(data) {
  document.getElementById("voteSection").classList.remove("active");
  if (timerInterval) clearInterval(timerInterval);
  document.getElementById("timerBar").classList.remove("active");

  let count = {};
  for (let p in data.votes) {
    let t = data.votes[p];
    count[t] = (count[t] || 0) + 1;
  }

  let max = 0, targets = [];
  for (let p in count) {
    if (count[p] > max) { max = count[p]; targets = [p]; }
    else if (count[p] === max) targets.push(p);
  }

  // 決選投票
  if (targets.length > 1) {
    hasVoted = false;
    const ref = doc(db, "rooms", currentRoom);
    await updateDoc(ref, {
      votes: {}, runoff: targets, phase: "vote",
      chatLog: arrayUnion({ type: "system", text: `同票（${targets.join("、")}）のため決選投票を行います` })
    });
    return;
  }

  // 結果確定：投票ログをチャットに流す（ホストのみ書き込み）
  if (data.host === myName) {
    let logLines = [];
    for (let voter in data.votes) {
      logLines.push(`${voter}　▶　${data.votes[voter]}`);
    }
    const executed = targets[0];
    const executedRole = data.roles[executed];
    const executedLabel = getRoleLabel(executedRole);
    const isThiefTeam = executedRole === "thief" || executedRole === "henchman";
    const winText = isThiefTeam
      ? "🧀 チーズドロボーチームの勝利！！"
      : "😴 ねぼすけチームの勝利！！";

    const ref = doc(db, "rooms", currentRoom);
    await updateDoc(ref, {
      chatLog: arrayUnion(
        { type: "system", text: "━━ 投票結果 ━━" },
        { type: "system", text: logLines.join("\n") },
        { type: "system", text: `最多票：${executed}（${executedLabel}）` },
        { type: "win",    text: winText }
      )
    });

    // もう一回ボタン表示
    document.getElementById("startBtn").style.display = "block";
    document.getElementById("startBtn").textContent = "もう一回";
    document.getElementById("startBtn").onclick = replayGame;
  } else {
    document.getElementById("replayWait").textContent = "ホストがもう一回を押すのを待っています…";
  }
}

// ===== もう一回 =====

window.replayGame = async function () {
  resetGameUI();
  document.getElementById("startBtn").textContent = "ゲーム開始";
  document.getElementById("startBtn").onclick = startGame;
  document.getElementById("replayWait").textContent = "";
  await startGame();
};

// ===== UIリセット =====

function resetGameUI() {
  window._nightChatDone = false;
  chatRenderedCount = 0;
  lastPhase = null;
  document.getElementById("chatLog").innerHTML = "";
  document.getElementById("roleMsg").textContent = "";
  document.getElementById("nightMsg").textContent = "";
  document.getElementById("nightMsg").className = "";
  document.getElementById("teamMsg").textContent = "";
  document.getElementById("timerBar").classList.remove("active");
  document.getElementById("henchmanSection").classList.remove("active");
  document.getElementById("voteSection").classList.remove("active");
  document.getElementById("voteButtons").innerHTML = "";
  document.getElementById("votedMsg").style.display = "none";
  document.getElementById("voteButtons").style.display = "flex";
  document.getElementById("replayWait").textContent = "";
  hasVoted = false;
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}
