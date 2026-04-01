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

const app=initializeApp(firebaseConfig);
const db=getFirestore(app);

let currentRoom=null;
let myName=null;

window.createRoom=async function(){

myName=document.getElementById("name").value;
const room=document.getElementById("room").value;

const ref=doc(db,"rooms",room);

await setDoc(ref,{
players:[myName],
phase:"lobby"
});

currentRoom=room;

hideLobbyUI();

document.getElementById("startBtn").style.display="block";

subscribeRoom();

}

window.joinRoom=async function(){

myName=document.getElementById("name").value;
const room=document.getElementById("room").value;

const ref=doc(db,"rooms",room);

const snap=await getDoc(ref);

if(!snap.exists()){
alert("ルームがありません");
return;
}

let players=snap.data().players;

if(players.includes(myName)){
alert("その名前は使われています");
return;
}

players.push(myName);

await updateDoc(ref,{players});

currentRoom=room;

hideLobbyUI();

document.getElementById("startBtn").style.display="block";

subscribeRoom();

}

function hideLobbyUI(){

document.getElementById("name").style.display="none";
document.getElementById("room").style.display="none";
document.getElementById("createBtn").style.display="none";
document.getElementById("joinBtn").style.display="none";

}

window.startGame=async function(){

document.getElementById("startBtn").style.display="none";

const ref=doc(db,"rooms",currentRoom);
const snap=await getDoc(ref);

const players=snap.data().players;

let roles={};

let thiefIndex=Math.floor(Math.random()*players.length);

players.forEach((p,i)=>{

if(i===thiefIndex){
roles[p]="thief";
}else{
roles[p]="sleepy";
}

});

let wakeTimes={};

players.forEach(p=>{
wakeTimes[p]=Math.floor(Math.random()*6)+1;
});

let eatTime=wakeTimes[players[thiefIndex]];

await updateDoc(ref,{
roles,
wakeTimes,
eatTime,
votes:{},
phase:"night"
});

}

function subscribeRoom(){

const ref=doc(db,"rooms",currentRoom);

onSnapshot(ref,(snap)=>{

const data=snap.data();

updatePlayers(data.players);

if(data.phase==="night") runNight(data);
if(data.phase==="henchman") runHenchman(data);
if(data.phase==="discussion") runDiscussion(data);
if(data.phase==="vote") runVote(data);
if(data.phase==="result") runResult(data);

});

}

function updatePlayers(players){

const list=document.getElementById("players");
list.innerHTML="";

players.forEach(p=>{
const li=document.createElement("li");
li.textContent=p;
list.appendChild(li);
});

}

function runNight(data){

const role=data.roles[myName];
const wakeTime=data.wakeTimes[myName];
const eatTime=data.eatTime;

let same=[];

for(let p in data.wakeTimes){
if(data.wakeTimes[p]===wakeTime) same.push(p);
}

const others=same.filter(p=>p!==myName);

let thief=null;

for(let p in data.roles){
if(data.roles[p]==="thief") thief=p;
}

let cheese=wakeTime<eatTime?"残っていました":"残っていませんでした";

let msg="あなたは "+wakeTime+" 時に起きました。";

if(others.length>0){
msg+=" 同時に起きた人："+others.join(", ")+"。";
}

if(role!=="thief"){
msg+=" チーズは"+cheese;
}

if(role==="thief"){
msg+=" あなたはチーズを食べました";
}

if(others.includes(thief)){
msg+=" "+thief+"がチーズを食べました";
}

// ねぼすけ能力
if(role==="sleepy" && others.length===0){

  let targets=data.players.filter(p=>p!==myName);
  
  let target=targets[Math.floor(Math.random()*targets.length)];
  
  let time=data.wakeTimes[target];
  
  msg+=" "+target+"は"+time+"時に起きました。";
  
  }
  
document.getElementById("night").textContent=msg;

setTimeout(async ()=>{

if(role==="thief"){

const ref=doc(db,"rooms",currentRoom);

await updateDoc(ref,{phase:"henchman"});

}

},4000);

}

function runHenchman(data){

document.getElementById("startBtn").style.display="none";

const area=document.getElementById("henchmanArea");
area.innerHTML="";

const role=data.roles[myName];

const playerCount=data.players.length;

let henchmanCount=0;

if(playerCount<=4){
henchmanCount=0;
}else if(playerCount<=5){
henchmanCount=1;
}else{
henchmanCount=2;
}

if(role!=="thief"){

area.textContent="チーズドロボーが手下を選んでいます";
return;

}

if(henchmanCount===0){

area.textContent="この人数では手下はいません";

setTimeout(async()=>{

const ref=doc(db,"rooms",currentRoom);

await updateDoc(ref,{
henchmen:[],
phase:"discussion"
});

},2000);

return;

}

const title=document.createElement("p");
title.textContent="手下を"+henchmanCount+"人選んでください";
area.appendChild(title);

data.players.filter(p=>p!==myName).forEach(p=>{

const label=document.createElement("label");

const cb=document.createElement("input");
cb.type="checkbox";
cb.value=p;

cb.onchange=()=>{

const checked=document.querySelectorAll("#henchmanArea input:checked");

if(checked.length>henchmanCount){
cb.checked=false;
}

};

label.appendChild(cb);
label.append(" "+p);

area.appendChild(label);
area.appendChild(document.createElement("br"));

});

const btn=document.createElement("button");
btn.textContent="手下決定";

btn.onclick=()=>submitHenchmen(henchmanCount);

area.appendChild(btn);

}

window.submitHenchmen=async function(henchmanCount){

const checks=document.querySelectorAll("#henchmanArea input:checked");

if(checks.length!==henchmanCount){

alert("手下は"+henchmanCount+"人選んでください");
return;

}

let henchmen=[];

checks.forEach(c=>henchmen.push(c.value));

document.getElementById("henchmanArea").style.display="none";

const ref=doc(db,"rooms",currentRoom);

await updateDoc(ref,{
henchmen,
phase:"discussion"
});

}

function runDiscussion(data){

  document.getElementById("henchmanArea").style.display="none";
  
  const role=data.roles[myName];
  
  const team=document.getElementById("team");
  
  team.textContent="";
  
  if(role==="thief"){
  team.textContent=data.henchmen.join(", ")+" を手下にしました";
  }
  
  else if(data.henchmen.includes(myName)){
  
  let thief;
  
  for(let p in data.roles){
  if(data.roles[p]==="thief") thief=p;
  }
  
  let others=data.henchmen.filter(p=>p!==myName);
  
  let msg="あなたはチーズドロボーの手下になりました ";
  msg+="ドロボー："+thief;
  
  if(others.length>0){
  msg+=" 仲間の手下："+others.join(", ");
  }
  
  team.textContent=msg;
  
  }
  
  let time=180;
  
  const timer=setInterval(()=>{
  
  document.getElementById("discussion").textContent=
  "議論中 残り"+time+"秒";
  
  time--;
  
  if(time<0){
  
  clearInterval(timer);
  
  if(role==="thief"){
  startVote();
  }
  
  }
  
  },1000);
  
  }

async function startVote(){

const ref=doc(db,"rooms",currentRoom);

await updateDoc(ref,{phase:"vote"});

}

function runVote(data){

const area=document.getElementById("voteArea");

if(data.votes && data.votes[myName]){

area.innerHTML="投票済みです";

return;

}

area.innerHTML="";

document.getElementById("vote").textContent="投票してください";

data.players.filter(p=>p!==myName).forEach(p=>{

const btn=document.createElement("button");

btn.textContent=p;

btn.onclick=()=>submitVote(p);

area.appendChild(btn);
area.appendChild(document.createElement("br"));

});

}

window.submitVote=async function(target){

const ref=doc(db,"rooms",currentRoom);
const snap=await getDoc(ref);

let votes=snap.data().votes||{};

votes[myName]=target;

await updateDoc(ref,{votes});

document.getElementById("voteArea").innerHTML="投票済みです";

checkVotes();

}

async function checkVotes(){

const ref=doc(db,"rooms",currentRoom);
const snap=await getDoc(ref);

const data=snap.data();

if(Object.keys(data.votes).length===data.players.length){

await updateDoc(ref,{phase:"result"});

}

}

function runResult(data){

document.getElementById("discussion").style.display="none";
document.getElementById("vote").style.display="none";
document.getElementById("voteArea").style.display="none";

let count={};

for(let p in data.votes){

let t=data.votes[p];

count[t]=(count[t]||0)+1;

}

let max=0;
let executed=null;

for(let p in count){

if(count[p]>max){

max=count[p];
executed=p;

}

}

let thief;

for(let p in data.roles){
if(data.roles[p]==="thief") thief=p;
}

let msg="処刑："+executed+" ";

msg+=executed===thief?"ねぼすけ勝利":"ドロボー勝利";

document.getElementById("result").textContent=msg;

}
