import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot, arrayUnion
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
let henchmanCountGlobal = 0;

// Firestoreチャットの既読カウント
let chatRenderedCount = 0;

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

// ===== チャット描画 =====

function addMsgDOM(name, text, type) {
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
  // ⑥ 投票結果などの改行を<br>で表示
  if (text.includes("\n")) {
    text.split("\n").forEach((line, i) => {
      if (i > 0) bubble.appendChild(document.createElement("br"));
      bubble.appendChild(document.createTextNode(line));
    });
  } else {
    bubble.textContent = text;
  }
  div.appendChild(bubble);
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// Firestoreのチャットログを差分描画
function renderChatLog(chatLog) {
  if (!chatLog) return;
  for (let i = chatRenderedCount; i < chatLog.length; i++) {
    const e = chatLog[i];
    if (e.type === "system") addMsgDOM("", e.text, "system");
    else if (e.type === "win") addMsgDOM("", e.text, "win");
    else addMsgDOM(e.name, e.text, e.name === myName ? "me" : "other");
  }
  chatRenderedCount = chatLog.length;
}

// 個人向けメッセージ（Firestoreに書かない）
function localSys(text) { addMsgDOM("", text, "system"); }

// Firestoreに全員向けシステムメッセージを書き込む
async function pushSys(text) {
  const ref = doc(db, "rooms", currentRoom);
  await updateDoc(ref, { chatLog: arrayUnion({ type: "system", text }) });
}

window.sendChat = async function () {
  const input = document.getElementById("msgInput");
  const text = input.value.trim();
  if (!text || !currentRoom) return;
  input.value = "";
  const ref = doc(db, "rooms", currentRoom);
  await updateDoc(ref, { chatLog: arrayUnion({ name: myName, text, type: "user" }) });
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
  document.getElementById("lobbyArea").style.display = "none";
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
  document.getElementById("lobbyArea").style.display = "none";
  subscribeRoom();
};

// ===== ゲーム開始 =====

window.startGame = async function () {
  document.getElementById("startBtn").style.display = "none";
  document.getElementById("replayWait").textContent = "";

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

  // ⑦ chatLogを新配列でリセット（arrayUnionではなく[]で上書き）
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

    updatePlayers(data.players);

    // ① ホストのみスタートボタン表示（lobbyフェーズ中）
    if (data.phase === "lobby" && data.host === myName) {
      document.getElementById("startBtn").style.display = "block";
    }

    // Firestoreチャット差分描画
    renderChatLog(data.chatLog);

    if (data.phase === "lobby") return;

    const phaseKey = data.phase + "_" + (data.runoff ? data.runoff.length : 0);
    if (phaseKey !== lastPhase) {
      lastPhase = phaseKey;
      if (data.phase === "night")      handleNight(data);
      if (data.phase === "henchman")   handleHenchman(data);
      if (data.phase === "discussion") handleDiscussion(data);
      if (data.phase === "vote")       handleVote(data);
      if (data.phase === "result")     handleResult(data);
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

  // ② 役職を常時表示
  document.getElementById("roleMsg").textContent = `役職：【${getRoleLabel(role)}】`;

  // 個人向け夜ログをローカルチャットに表示
  localSys(`🎭 あなたの役職：【${getRoleLabel(role)}】`);
  localSys(`🌙 あなたは ${wakeTime} 時に起きました`);

  if (others.length > 0) localSys(`👥 同時に起きた人：${others.join(", ")}`);

  // ⑤ チーズ情報は全員に表示（手下も含む）
  if (role === "thief") {
    localSys("🧀 あなたはチーズを食べました");
  } else {
    const cheese = wakeTime < eatTime ? "残っていました🧀" : "残っていませんでした";
    localSys(`🧀 チーズは${cheese}`);
  }

  if (others.includes(thief)) localSys(`⚠️ ${thief} がチーズを食べました`);

  // ねぼすけ能力：一人で起きたとき別の人の起床時刻がわかる
  if (role === "sleepy" && others.length === 0) {
    const targets = data.players.filter(p => p !== myName);
    const target = targets[Math.floor(Math.random() * targets.length)];
    localSys(`🔍 ${target} は ${data.wakeTimes[target]} 時に起きました`);
  }

  // ①③ 手下選択フェーズへ（ドロボーが遷移させる）
  // 非ドロボーには「チーズドロボーが手下を選んでいます」をローカル表示
  if (role !== "thief") {
    setTimeout(() => {
      localSys("⏳ チーズドロボーが手下を選んでいます...");
    }, 1000);
  }

  setTimeout(async () => {
    if (role === "thief") {
      const ref = doc(db, "rooms", currentRoom);
      await updateDoc(ref, { phase: "henchman" });
    }
  }, 4000);
}

// ===== 手下選択 =====

function handleHenchman(data) {
  const role = data.roles[myName];
  const playerCount = data.players.length;
  henchmanCountGlobal = 0;
  if (playerCount >= 5 && playerCount <= 7) henchmanCountGlobal = 1;
  if (playerCount >= 8) henchmanCountGlobal = 2;

  if (role !== "thief") {
    // ドロボー以外は待機（夜フェーズでメッセージ済み）
    return;
  }

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

  // ② チーズドロボーのログ：手下を発表
  if (role === "thief") {
    if (data.henchmen && data.henchmen.length > 0) {
      localSys(`🤝 ${data.henchmen.join(", ")} を手下にしました`);
      document.getElementById("teamMsg").textContent = `🤝 手下：${data.henchmen.join(", ")}`;
    }
  }
  // ③ 手下のログ：誰のドロボーになったか
  else if (data.henchmen && data.henchmen.includes(myName)) {
    let thief;
    for (let p in data.roles) { if (data.roles[p] === "thief") thief = p; }
    const others = data.henchmen.filter(p => p !== myName);
    localSys(`🤝 あなたは ${thief} の手下になりました` + (others.length > 0 ? `　仲間：${others.join(", ")}` : ""));
    document.getElementById("teamMsg").textContent =
      `🤝 ドロボー：${thief}` + (others.length > 0 ? `　仲間：${others.join(", ")}` : "");
  }

  // ④ 全員向け：議論フェーズ開始をFirestoreに書き込む（ホストのみ）
  if (data.host === myName) {
    pushSys("━━ 議論フェーズ　誰がチーズドロボーか話し合ってください ━━");
  }

  // タイマー
  if (timerInterval) clearInterval(timerInterval);
  const total = 180;
  let remaining = total;
  const bar = document.getElementById("timerBar");
  const fill = document.getElementById("timerFill");
  const sec = document.getElementById("timerSec");
  bar.classList.add("active");
  document.getElementById("timerLabel").textContent = "議論中";

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
  document.getElementById("voteLabel").textContent =
    isRunoff ? "🔁 決選投票：投票先を選んでください" : "投票先を選んでください";

  const candidates = isRunoff
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

  // ④ 自分の投票先をローカルチャットに表示
  localSys(`🗳 あなたは「${target}」に投票しました`);

  const ref = doc(db, "rooms", currentRoom);
  const snap = await getDoc(ref);
  let votes = snap.data().votes || {};
  votes[myName] = target;
  await updateDoc(ref, { votes });

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

  // 結果確定（ホストのみFirestoreに書き込み）
  if (data.host === myName) {
    const executed = targets[0];
    const executedRole = data.roles[executed];
    const executedLabel = getRoleLabel(executedRole);
    const isThiefTeam = executedRole === "thief" || executedRole === "henchman";
    const winText = isThiefTeam ? "🧀 チーズドロボーチームの勝利！！" : "😴 ねぼすけチームの勝利！！";

    // ⑥ 投票結果を1行ずつ別エントリで書き込む（縦並び）
    const resultEntries = [{ type: "system", text: "━━ 投票結果 ━━" }];
    for (let voter in data.votes) {
      resultEntries.push({ type: "system", text: `${voter}　▶　${data.votes[voter]}` });
    }
    resultEntries.push({ type: "system", text: `最多票：${executed}（${executedLabel}）` });
    resultEntries.push({ type: "win", text: winText });

    const ref = doc(db, "rooms", currentRoom);
    // arrayUnionは同じオブジェクトの重複を避けるので1件ずつpush
    let chatLog = (await getDoc(ref)).data().chatLog || [];
    chatLog = chatLog.concat(resultEntries);
    await updateDoc(ref, { chatLog });

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
  await startGame();
};

// ===== UIリセット =====

function resetGameUI() {
  // ⑦ チャットDOMとカウンタをリセット（startGameがchatLogを[]で上書きするのと連動）
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
