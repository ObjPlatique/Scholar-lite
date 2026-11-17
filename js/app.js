import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebaseConfig.js";

const $ = (s) => document.querySelector(s);
const content = $("#content");
const pages = {home:"Trang chủ",assistant:"Trợ lý học tập",quiz:"Tạo câu hỏi",todo:"To-do",pomodoro:"Pomodoro",note:"Note",schedule:"Thời gian biểu"};
const GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
let current="home", user=null, auth=null, db=null, modal=null;
let tasks=[], note="", notes=[], activeNoteId=null, chat=[], chatThreads=[], activeChatId=null, quiz=null, answers={}, submitted=false;
const weekdayNames=["Thứ Hai","Thứ Ba","Thứ Tư","Thứ Năm","Thứ Sáu","Thứ Bảy","Chủ Nhật"];
let timetable=[];
try { const saved=JSON.parse(localStorage.getItem("scholar-lite-timetable")||"[]"); if(Array.isArray(saved)) timetable=saved; } catch {}
const pomodoroDefaults={focus:25,shortBreak:5,longBreak:15};
let pomodoroDurations={...pomodoroDefaults};
try {
  const storedPomodoro=JSON.parse(localStorage.getItem("scholar-lite-pomodoro")||"null");
  if(storedPomodoro) for(const key of Object.keys(pomodoroDefaults)) {
    const value=Number(storedPomodoro[key]);
    if(Number.isInteger(value)&&value>=1&&value<=180) pomodoroDurations[key]=value;
  }
} catch {}
let timerMode="focus", timerSeconds=pomodoroDurations.focus*60, timerId=null;

const themeStorageKey = "scholar-lite-theme";
function applyTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.setAttribute("data-bs-theme", dark ? "dark" : "light");
  const button = $("#themeToggle");
  if (button) {
    button.textContent = dark ? "☀" : "☾";
    button.setAttribute("aria-label", dark ? "Bật giao diện sáng" : "Bật giao diện tối");
    button.title = dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối";
  }
}
const savedTheme = localStorage.getItem(themeStorageKey);
applyTheme(savedTheme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
$("#themeToggle").addEventListener("click", () => {
  const nextTheme = document.documentElement.getAttribute("data-bs-theme") === "dark" ? "light" : "dark";
  localStorage.setItem(themeStorageKey, nextTheme);
  applyTheme(nextTheme);
});

const firebaseConfigured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_");
if (firebaseConfigured) {
  const app=initializeApp(firebaseConfig); auth=getAuth(app); db=getFirestore(app);
  onAuthStateChanged(auth, async (u)=>{ user=u; updateAuth(); if(user){await loadData();await loadChatHistory();}else{chatThreads=[];activeChatId=null;chat=[];} render(); });
}
function updateAuth(){ $("#authBtn").textContent=user?(user.displayName||user.email||"Tài khoản"):"Đăng nhập"; }
function toast(s){ const el=$("#notice"); el.textContent=s; el.classList.remove("d-none"); setTimeout(()=>el.classList.add("d-none"),3000); }
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function renderMarkdown(source) {
  const raw = String(source ?? "");
  const html = window.marked ? marked.parse(raw, { gfm: true, breaks: true }) : esc(raw).replaceAll("\n", "<br>");
  return window.DOMPurify ? DOMPurify.sanitize(html) : esc(raw).replaceAll("\n", "<br>");
}
function renderMath(root) {
  if (!root || !window.renderMathInElement) return;
  renderMathInElement(root, {delimiters:[
    {left:"$",right:"$",display:true}, {left:"\\[",right:"\\]",display:true},
    {left:"$",right:"$",display:false}, {left:"\\(",right:"\\)",display:false}
  ],throwOnError:false,strict:"ignore"});
}

async function loadData(){
  try {
    const snap=await getDoc(doc(db,"users",user.uid,"scholarLite","data"));
    let migrateLocalSchedule=false;
    if(snap.exists()){
      const d=snap.data();
      tasks=d.tasks||[];
      note=d.note||"";
      if(Array.isArray(d.timetable)){
        timetable=d.timetable.filter(item=>item&&typeof item.title==="string"&&Number.isInteger(Number(item.day))&&Number(item.day)>=0&&Number(item.day)<=6&&/^([01]\d|2[0-3]):[0-5]\d$/.test(item.start)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(item.end)&&item.end>item.start)
          .map((item,index)=>({id:String(item.id||("event-"+index)),title:item.title.slice(0,80),day:Number(item.day),start:item.start,end:item.end}));
        localStorage.setItem("scholar-lite-timetable",JSON.stringify(timetable));
        localStorage.setItem("scholar-lite-timetable-owner",user.uid);
      } else {
        // Migrate browser-only events only when they are not already associated with another account.
        const localOwner=localStorage.getItem("scholar-lite-timetable-owner");
        try {
          const localSchedule=JSON.parse(localStorage.getItem("scholar-lite-timetable")||"[]");
          timetable=localOwner&&localOwner!==user.uid?[]:(Array.isArray(localSchedule)?localSchedule:[]);
        } catch { timetable=[]; }
        migrateLocalSchedule=true;
      }
      if(Array.isArray(d.notes)){
        notes=d.notes.map((item,index)=>({
          id:item.id||("note-"+index),
          title:item.title||"Ghi chú không có tiêu đề",
          content:item.content||"",
          updatedAt:item.updatedAt||""
        }));
      } else if(note.trim()) {
        notes=[{id:"legacy-note",title:"Ghi chú của tôi",content:note,updatedAt:""}];
      }
      activeNoteId=notes[0]?.id||null;
    } else {
      const localOwner=localStorage.getItem("scholar-lite-timetable-owner");
      try {
        const localSchedule=JSON.parse(localStorage.getItem("scholar-lite-timetable")||"[]");
        timetable=localOwner&&localOwner!==user.uid?[]:(Array.isArray(localSchedule)?localSchedule:[]);
      } catch { timetable=[]; }
      migrateLocalSchedule=true;
    }
    if(migrateLocalSchedule){
      const saved=await saveData();
      if(saved&&timetable.length) toast("Đã chuyển thời gian biểu cũ lên Firebase.");
    }
  }
  catch(e){console.warn(e);toast("Không thể tải dữ liệu Firebase.");}
}
async function saveData(){
  if(!user||!db)return;
  try{
    await setDoc(doc(db,"users",user.uid,"scholarLite","data"),{tasks,note,notes,timetable,updatedAt:new Date().toISOString()},{merge:true});
    localStorage.setItem("scholar-lite-timetable",JSON.stringify(timetable));
    localStorage.setItem("scholar-lite-timetable-owner",user.uid);
    return true;
  } catch(e){
    console.warn("Firestore save failed:",e);
    toast("Không lưu được dữ liệu Firebase. Vui lòng kiểm tra kết nối và quyền Firestore.");
    return false;
  }
}

function chatCollectionRef(){
  return collection(db,"users",user.uid,"scholarLite","data","chats");
}
async function loadChatHistory(){
  if(!user||!db)return;
  try{
    const snapshot=await getDocs(chatCollectionRef());
    chatThreads=snapshot.docs.map(item=>({id:item.id,...item.data()}))
      .sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
    const selected=chatThreads.find(item=>item.id===activeChatId)||chatThreads[0]||null;
    activeChatId=selected?.id||null;
    chat=selected?.messages||[];
  }catch(e){
    console.warn(e);
    toast("Không thể tải lịch sử trò chuyện.");
  }
}
async function persistCurrentChat(){
  if(!user||!db||!activeChatId||!chat.length)return;
  const existing=chatThreads.find(item=>item.id===activeChatId);
  const firstUser=chat.find(item=>item.role==="user");
  const title=existing?.title||((firstUser?.text||"Cuộc trò chuyện mới").replace(/\s+/g," ").slice(0,48));
  const updatedAt=new Date().toISOString();
  const record={title,messages:chat.slice(-60),updatedAt};
  try{
    await setDoc(doc(chatCollectionRef(),activeChatId),record,{merge:true});
    const index=chatThreads.findIndex(item=>item.id===activeChatId);
    const entry={id:activeChatId,...record};
    if(index>=0)chatThreads[index]=entry;else chatThreads.unshift(entry);
    chatThreads.sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
    updateChatHistoryList();
  }catch(e){
    console.warn(e);
    toast("Không lưu được lịch sử chat: "+e.message);
  }
}
function createChat(){
  const id=globalThis.crypto?.randomUUID?.()||("chat-"+Date.now()+"-"+Math.random().toString(36).slice(2));
  activeChatId=id;
  chat=[];
  render();
  $("#prompt")?.focus();
}
async function selectChat(id){
  const selected=chatThreads.find(item=>item.id===id);
  if(!selected)return;
  activeChatId=id;
  chat=Array.isArray(selected.messages)?selected.messages:[];
  render();
}
async function deleteCurrentChat(){
  if(!activeChatId||!confirm("Xóa cuộc trò chuyện này?"))return;
  const id=activeChatId;
  if(user&&db){
    try{await deleteDoc(doc(chatCollectionRef(),id));}
    catch(e){toast("Không thể xóa cuộc trò chuyện: "+e.message);return;}
  }
  chatThreads=chatThreads.filter(item=>item.id!==id);
  const next=chatThreads[0]||null;
  activeChatId=next?.id||null;
  chat=next?.messages||[];
  render();
  toast("Đã xóa cuộc trò chuyện.");
}
function updateChatHistoryList(){
  const list=$("#chatHistoryList");
  if(!list)return;
  list.innerHTML=chatThreads.length?chatThreads.map(item=>`<button type="button" class="chat-history-item ${item.id===activeChatId?"active":""}" data-chat-id="${esc(item.id)}"><span class="chat-history-title">${esc(item.title||"Cuộc trò chuyện")}</span><small>${esc((item.updatedAt||"").slice(0,16).replace("T"," "))}</small></button>`).join(""):'<p class="small text-secondary mb-0">Chưa có lịch sử chat.</p>';
  list.querySelectorAll("[data-chat-id]").forEach(button=>button.onclick=()=>selectChat(button.dataset.chatId));
}

function go(p){if(!pages[p])return;current=p;closeSidebar();render();scrollTo({top:0,behavior:"smooth"});}
function closeSidebar(){$("#sidebar").classList.remove("open");$("#backdrop").classList.remove("show");}
document.addEventListener("click",e=>{const a=e.target.closest("[data-page]");if(a){e.preventDefault();go(a.dataset.page);}});
$("#sidebarToggle").onclick=()=>{$("#sidebar").classList.add("open");$("#backdrop").classList.add("show");};
$("#sidebarClose").onclick=closeSidebar; $("#backdrop").onclick=closeSidebar;
function openAuth(){if(!modal)modal=new bootstrap.Modal($("#authModal"));modal.show();}
$("#authBtn").onclick=()=>{if(user){signOut(auth);}else openAuth();};

$("#emailForm").onsubmit=async e=>{e.preventDefault();if(!auth){$("#authMessage").textContent="Hãy cấu hình Firebase trước.";return;}try{await signInWithEmailAndPassword(auth,$("#email").value.trim(),$("#password").value);modal.hide();}catch(x){$("#authMessage").textContent=x.message;}};
$("#registerBtn").onclick=async()=>{if(!auth){$("#authMessage").textContent="Hãy cấu hình Firebase trước.";return;}try{await createUserWithEmailAndPassword(auth,$("#email").value.trim(),$("#password").value);modal.hide();}catch(x){$("#authMessage").textContent=x.message;}};
$("#googleBtn").onclick=async()=>{if(!auth){$("#authMessage").textContent="Hãy cấu hình Firebase trước.";return;}try{await signInWithPopup(auth,new GoogleAuthProvider());modal.hide();}catch(x){$("#authMessage").textContent=x.message;}};

function render(){
 document.title=pages[current]+" · Scholar Lite";
 document.querySelectorAll("#topNav [data-page]").forEach(a=>a.classList.toggle("active",a.dataset.page===current));
 if(current==="home") content.innerHTML=`<section class="hero mb-4"><p class="text-primary fw-semibold">KHÔNG GIAN HỌC TẬP CỦA BẠN</p><h1 class="display-5 fw-bold">Học tập gọn nhẹ hơn.</h1><p class="lead text-secondary">Hỏi bài, tạo trắc nghiệm, quản lý công việc, tập trung và ghi chú trong một nơi.</p><button class="btn btn-primary me-2" data-page="assistant">Bắt đầu học</button><button class="btn btn-outline-primary" data-page="todo">Xem To-do</button></section><div class="app-card live-clock-card mb-4"><div class="row align-items-center g-3"><div class="col-md-7"><div class="small text-secondary text-uppercase fw-semibold">Ngày và giờ hiện tại</div><div class="live-clock-time" id="homeClock">--:--:--</div><div class="text-secondary" id="homeDate">Đang tải ngày...</div></div><div class="col-md-5 text-md-end"><div class="small text-secondary mb-2">Lịch học của bạn</div><button class="btn btn-outline-primary" data-page="schedule">Mở thời gian biểu →</button></div></div></div><div class="row g-3">${["assistant","quiz","todo","pomodoro","note","schedule"].map(p=>`<div class="col-md-6 col-lg-4"><div class="app-card feature-card"><h5>${pages[p]}</h5><p class="text-secondary">Mở công cụ ${pages[p].toLowerCase()}.</p><button class="btn btn-sm btn-outline-primary" data-page="${p}">Mở công cụ</button></div></div>`).join("")}</div>`;
 if(current==="assistant") content.innerHTML=`<h1 class="h3 mb-3">Trợ lý học tập</h1><div class="row g-3"><div class="col-lg-4"><div class="app-card chat-history-panel"><div class="d-flex justify-content-between align-items-center gap-2 mb-3"><h2 class="h6 mb-0">Lịch sử chat</h2><button class="btn btn-sm btn-primary" id="newChat">＋ Chat mới</button></div><div id="chatHistoryList" class="chat-history-list"></div>${user?"":'<p class="small text-secondary mt-3 mb-0">Đăng nhập để đồng bộ và lưu lịch sử chat trên các thiết bị.</p>'}</div></div><div class="col-lg-8"><div class="app-card"><div id="chatLog" class="chat-log mb-3">${chat.map(m=>`<div class="chat-message ${m.role}"><strong>${m.role==="user"?"Bạn":"Gemini"}</strong><div class="markdown-body">${renderMarkdown(m.text)}</div></div>`).join("")}</div><textarea id="prompt" class="form-control mb-3" rows="4" placeholder="Nhập câu hỏi hoặc nội dung bài học..."></textarea><button class="btn btn-primary" id="askBtn">Gửi câu hỏi</button> <button class="btn btn-outline-danger" id="deleteChat">Xóa hội thoại</button><p class="small text-muted mt-3">Phản hồi được hiển thị dần khi Gemini tạo nội dung.</p></div></div></div>`;
 if(current==="quiz") content.innerHTML=`<h1 class="h3 mb-3">Tạo câu hỏi</h1><div class="app-card mb-3"><div class="row g-3"><div class="col-md-6"><label class="form-label">Môn học *</label><input id="subject" class="form-control" placeholder="Toán, Vật lý, Tiếng Anh..."></div><div class="col-md-6"><label class="form-label">Chủ đề</label><input id="topic" class="form-control" placeholder="Hàm số, Dao động..."></div><div class="col-md-6"><label class="form-label">Số câu</label><select id="count" class="form-select"><option>5</option><option>10</option><option>15</option></select></div><div class="col-md-6"><label class="form-label">Độ khó</label><select id="difficulty" class="form-select"><option>Dễ</option><option selected>Trung bình</option><option>Khó</option></select></div></div><button class="btn btn-primary mt-3" id="generate">Tạo quiz</button><div id="quizError" class="text-danger small mt-2"></div></div><div id="quizArea"></div>`;
 if(current==="todo") content.innerHTML=`<h1 class="h3 mb-3">To-do</h1><div class="app-card"><form id="taskForm" class="d-flex gap-2 mb-3"><input id="taskInput" class="form-control" placeholder="Thêm công việc..." required><button class="btn btn-primary">Thêm</button></form><ul class="list-group">${tasks.map((t,i)=>`<li class="list-group-item d-flex align-items-center gap-2"><input class="form-check-input task-check" type="checkbox" data-i="${i}" ${t.done?"checked":""}><span class="flex-grow-1 ${t.done?"task-done":""}">${esc(t.text)}</span><button class="btn btn-sm btn-outline-danger task-del" data-i="${i}">Xóa</button></li>`).join("")}</ul></div>`;
 if(current==="pomodoro") content.innerHTML=`<h1 class="h3 mb-3">Pomodoro</h1>
   <div class="row g-3">
     <div class="col-lg-7"><div class="app-card text-center h-100">
       <div class="btn-group flex-wrap mb-4" role="group" aria-label="Chọn chế độ Pomodoro">
         <button class="btn ${timerMode==="focus"?"btn-primary":"btn-outline-primary"}" data-timer-mode="focus">Tập trung</button>
         <button class="btn ${timerMode==="shortBreak"?"btn-primary":"btn-outline-primary"}" data-timer-mode="shortBreak">Nghỉ ngắn</button>
         <button class="btn ${timerMode==="longBreak"?"btn-primary":"btn-outline-primary"}" data-timer-mode="longBreak">Nghỉ dài</button>
       </div>
       <div class="timer mb-3" id="timerDisplay">${formatTime(timerSeconds)}</div>
       <p class="text-secondary mb-3" id="timerModeLabel">${pomodoroModeLabel(timerMode)}</p>
       <button class="btn btn-primary" id="timerStart">${timerId?"Tạm dừng":"Bắt đầu"}</button>
       <button class="btn btn-outline-secondary" id="timerReset">Đặt lại</button>
     </div></div>
     <div class="col-lg-5"><div class="app-card h-100">
       <h2 class="h5 mb-3">Tùy chỉnh thời gian</h2>
       <form id="pomodoroSettings" class="d-grid gap-3">
         <div><label class="form-label" for="focusMinutes">Tập trung (phút)</label><input class="form-control" type="number" id="focusMinutes" min="1" max="180" required value="${pomodoroDurations.focus}"></div>
         <div><label class="form-label" for="shortBreakMinutes">Nghỉ ngắn (phút)</label><input class="form-control" type="number" id="shortBreakMinutes" min="1" max="180" required value="${pomodoroDurations.shortBreak}"></div>
         <div><label class="form-label" for="longBreakMinutes">Nghỉ dài (phút)</label><input class="form-control" type="number" id="longBreakMinutes" min="1" max="180" required value="${pomodoroDurations.longBreak}"></div>
         <button class="btn btn-outline-primary" type="submit">Lưu thiết lập</button>
         <p class="small text-secondary mb-0">Mỗi chế độ có thể đặt từ 1 đến 180 phút. Thiết lập được lưu trên trình duyệt này.</p>
       </form>
     </div></div>
   </div>`;
 if(current==="schedule") {
    const days=weekdayNames.map((name,day)=>({name,day,items:timetable.filter(item=>Number(item.day)===day).sort((a,b)=>a.start.localeCompare(b.start))}));
    content.innerHTML=`<div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"><div><h1 class="h3 mb-1">Thời gian biểu</h1><p class="text-secondary mb-0">Lập kế hoạch học tập theo từng ngày trong tuần.</p></div><span class="badge text-bg-light border">${timetable.length} hoạt động</span></div>
      <div class="app-card mb-3"><h2 class="h5 mb-3">＋ Thêm hoạt động</h2>
        <form id="scheduleForm" class="row g-3 align-items-end">
          <div class="col-md-4"><label class="form-label" for="scheduleTitle">Tên hoạt động</label><input class="form-control" id="scheduleTitle" maxlength="80" placeholder="Ví dụ: Toán THPTQG" required></div>
          <div class="col-md-2"><label class="form-label" for="scheduleDay">Ngày</label><select class="form-select" id="scheduleDay">${weekdayNames.map((name,index)=>`<option value="${index}">${name}</option>`).join("")}</select></div>
          <div class="col-6 col-md-2"><label class="form-label" for="scheduleStart">Bắt đầu</label><input class="form-control" type="time" id="scheduleStart" value="08:00" required></div>
          <div class="col-6 col-md-2"><label class="form-label" for="scheduleEnd">Kết thúc</label><input class="form-control" type="time" id="scheduleEnd" value="09:00" required></div>
          <div class="col-md-2"><button class="btn btn-primary w-100" type="submit">Thêm lịch</button></div>
        </form>
      </div>
      <div class="schedule-grid">${days.map(day=>`<section class="app-card schedule-day"><div class="d-flex justify-content-between align-items-center mb-3"><h2 class="h6 mb-0">${day.name}</h2><span class="small text-secondary">${day.items.length} mục</span></div>${day.items.length?day.items.map(item=>`<div class="schedule-event"><div class="d-flex justify-content-between align-items-start gap-2"><div class="min-w-0"><div class="fw-semibold">${esc(item.title)}</div><div class="small text-secondary">${esc(item.start)} – ${esc(item.end)}</div></div><button class="btn btn-sm btn-outline-danger schedule-delete" data-id="${esc(item.id)}" aria-label="Xóa ${esc(item.title)}">×</button></div></div>`).join(""):'<p class="small text-secondary mb-0">Chưa có hoạt động.</p>'}</section>`).join("")}</div>
      <p class="small text-secondary mt-3">${user?"Thời gian biểu được đồng bộ với tài khoản Firebase của bạn.":"Lịch hiện được lưu trên thiết bị này. Đăng nhập để đồng bộ giữa các thiết bị."}</p>`;
  }
  if(current==="schedule"){
    $("#scheduleForm").onsubmit=e=>{
      e.preventDefault();
      const title=$("#scheduleTitle").value.trim(),day=Number($("#scheduleDay").value),start=$("#scheduleStart").value,end=$("#scheduleEnd").value;
      if(!title){toast("Vui lòng nhập tên hoạt động.");return;}
      if(!start||!end||end<=start){toast("Giờ kết thúc phải sau giờ bắt đầu.");return;}
      timetable.push({id:globalThis.crypto?.randomUUID?.()||("event-"+Date.now()+"-"+Math.random().toString(36).slice(2)),title,day,start,end});
      localStorage.setItem("scholar-lite-timetable",JSON.stringify(timetable));
      render();
      if(user&&db) { const saved=await saveData(); if(saved) toast("Đã thêm và đồng bộ hoạt động lên Firebase."); }
      else toast("Đã thêm hoạt động trên thiết bị. Đăng nhập để đồng bộ Firebase.");
    };
    document.querySelectorAll(".schedule-delete").forEach(button=>button.onclick=()=>{
      timetable=timetable.filter(item=>item.id!==button.dataset.id);
      localStorage.setItem("scholar-lite-timetable",JSON.stringify(timetable));
      render();
      if(user&&db) { const saved=await saveData(); if(saved) toast("Đã xóa và đồng bộ thay đổi lên Firebase."); }
      else toast("Đã xóa hoạt động trên thiết bị.");
    });
  }
  if(current==="note") {
   const activeNote=notes.find(item=>item.id===activeNoteId)||null;
   content.innerHTML=`<div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"><div><h1 class="h3 mb-1">Ghi chú</h1><p class="text-secondary mb-0 small">${notes.length} ghi chú</p></div><button class="btn btn-primary" id="addNote">＋ Thêm note</button></div>
   <div class="row g-3">
     <div class="col-md-4 col-lg-3"><div class="app-card h-100"><h2 class="h6 mb-3">Danh sách note</h2><div id="noteList" class="d-grid gap-2">${notes.length?notes.map(item=>`<button type="button" class="note-list-item text-start ${item.id===activeNoteId?"active":""}" data-note-id="${esc(item.id)}"><span class="d-block fw-semibold text-truncate">${esc(item.title||"Chưa đặt tiêu đề")}</span><small class="note-preview">${esc(item.content||"Chưa có nội dung").slice(0,65)}</small></button>`).join(""):'<p class="text-secondary small mb-0">Chưa có ghi chú. Hãy tạo note đầu tiên.</p>'}</div></div></div>
     <div class="col-md-8 col-lg-9"><div class="app-card">
       ${activeNote? `<label class="form-label" for="noteTitle">Tiêu đề</label><input id="noteTitle" class="form-control mb-3" maxlength="100" value="${esc(activeNote.title)}" placeholder="Tên ghi chú">
       <label class="form-label" for="noteArea">Nội dung</label><textarea id="noteArea" class="form-control note-area mb-3" placeholder="Viết ghi chú bằng Markdown và LaTeX...">${esc(activeNote.content)}</textarea>
       <div class="note-preview-panel mb-3"><div class="d-flex justify-content-between align-items-center mb-2"><strong class="small">Xem trước</strong><span class="small text-secondary">Markdown · LaTeX</span></div><div id="notePreview" class="markdown-body"></div></div>
       <div class="d-flex flex-wrap gap-2"><button class="btn btn-primary" id="saveNote">Lưu ghi chú</button><button class="btn btn-outline-danger" id="deleteNote">Xóa note</button></div>`:'<div class="text-center py-5"><p class="text-secondary mb-3">Chọn một ghi chú hoặc tạo note mới để bắt đầu.</p><button class="btn btn-primary" id="emptyAddNote">＋ Tạo note đầu tiên</button></div>'}
     </div></div>
   </div>`;
 }
 if(current==="assistant"){
   updateChatHistoryList();
   $("#newChat").onclick=createChat;
   $("#askBtn").onclick=askGemini; $("#prompt").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();askGemini();}};
   $("#deleteChat").onclick=deleteCurrentChat;
 }
 if(current==="quiz") $("#generate").onclick=generateQuiz;
 if(current==="todo"){
   $("#taskForm").onsubmit=e=>{e.preventDefault();const v=$("#taskInput").value.trim();if(v){tasks.push({text:v,done:false});saveData();render();}};
   document.querySelectorAll(".task-check").forEach(el=>el.onchange=()=>{tasks[Number(el.dataset.i)].done=el.checked;saveData();render();});
   document.querySelectorAll(".task-del").forEach(el=>el.onclick=()=>{tasks.splice(Number(el.dataset.i),1);saveData();render();});
 }
 if(current==="note") {
   $("#addNote").onclick=()=>createNote();
   $("#emptyAddNote")?.addEventListener("click",()=>createNote());
   document.querySelectorAll("[data-note-id]").forEach(button=>button.onclick=()=>{
     activeNoteId=button.dataset.noteId;
     render();
   });
   if($("#noteArea")) { const updateNotePreview=()=>{ const preview=$("#notePreview"); if(preview){preview.innerHTML=renderMarkdown($("#noteArea").value);renderMath(preview);} }; updateNotePreview(); $("#noteArea").addEventListener("input",updateNotePreview); }
   if($("#saveNote")) $("#saveNote").onclick=()=>{
     const selected=notes.find(item=>item.id===activeNoteId);
     if(!selected)return;
     selected.title=$("#noteTitle").value.trim()||"Chưa đặt tiêu đề";
     selected.content=$("#noteArea").value;
     selected.updatedAt=new Date().toISOString();
     note=selected.content;
     saveData();
     toast("Đã lưu ghi chú.");
     render();
   };
   if($("#deleteNote")) $("#deleteNote").onclick=()=>{
     if(!confirm("Bạn có chắc muốn xóa ghi chú này?"))return;
     notes=notes.filter(item=>item.id!==activeNoteId);
     activeNoteId=notes[0]?.id||null;
     note=notes.find(item=>item.id===activeNoteId)?.content||"";
     saveData();
     render();
     toast("Đã xóa ghi chú.");
   };
 }
 if(current==="pomodoro"){
   document.querySelectorAll("[data-timer-mode]").forEach(button=>button.onclick=()=>selectPomodoroMode(button.dataset.timerMode));
   $("#timerStart").onclick=()=>{
     if(timerId){clearInterval(timerId);timerId=null;$("#timerStart").textContent="Tiếp tục";return;}
     if(timerSeconds<=0) timerSeconds=pomodoroDurations[timerMode]*60;
     $("#timerStart").textContent="Tạm dừng";
     timerId=setInterval(()=>{
       timerSeconds=Math.max(0,timerSeconds-1);
       $("#timerDisplay").textContent=formatTime(timerSeconds);
       if(!timerSeconds){
         clearInterval(timerId);timerId=null;
         $("#timerStart").textContent="Bắt đầu";
         toast(timerMode==="focus"?"Hoàn thành phiên tập trung! Đã đến giờ nghỉ.":"Đã hết giờ nghỉ. Sẵn sàng tập trung trở lại!");
       }
     },1000);
   };
   $("#timerReset").onclick=()=>{
     clearInterval(timerId);timerId=null;
     timerSeconds=pomodoroDurations[timerMode]*60;
     $("#timerDisplay").textContent=formatTime(timerSeconds);
     $("#timerStart").textContent="Bắt đầu";
   };
   $("#pomodoroSettings").onsubmit=e=>{
     e.preventDefault();
     const next={
       focus:Number($("#focusMinutes").value),
       shortBreak:Number($("#shortBreakMinutes").value),
       longBreak:Number($("#longBreakMinutes").value)
     };
     if(Object.values(next).some(value=>!Number.isInteger(value)||value<1||value>180)){
       toast("Vui lòng nhập thời gian từ 1 đến 180 phút.");return;
     }
     pomodoroDurations=next;
     localStorage.setItem("scholar-lite-pomodoro",JSON.stringify(pomodoroDurations));
     clearInterval(timerId);timerId=null;
     timerSeconds=pomodoroDurations[timerMode]*60;
     $("#timerDisplay").textContent=formatTime(timerSeconds);
     $("#timerStart").textContent="Bắt đầu";
     toast("Đã lưu thiết lập Pomodoro.");
   };
 }
 if(current==="quiz"&&quiz) renderQuiz();
}
function createNote(){
  const id=(globalThis.crypto?.randomUUID?.()||("note-"+Date.now()+"-"+Math.random().toString(36).slice(2)));
  const item={id,title:"Ghi chú mới",content:"",updatedAt:new Date().toISOString()};
  notes.unshift(item);
  activeNoteId=id;
  note="";
  saveData();
  render();
  $("#noteTitle")?.focus();
}
function updateHomeClock(){
  const clock=$("#homeClock"),date=$("#homeDate");
  if(!clock||!date)return;
  const now=new Date();
  clock.textContent=new Intl.DateTimeFormat("vi-VN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(now);
  date.textContent=new Intl.DateTimeFormat("vi-VN",{weekday:"long",day:"2-digit",month:"long",year:"numeric"}).format(now);
}
setInterval(updateHomeClock,1000);
function formatTime(s){return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");}
function pomodoroModeLabel(mode){
  return ({focus:"Thời gian tập trung",shortBreak:"Thời gian nghỉ ngắn",longBreak:"Thời gian nghỉ dài"})[mode]||"Pomodoro";
}
function selectPomodoroMode(mode){
  if(!Object.prototype.hasOwnProperty.call(pomodoroDefaults,mode)) return;
  clearInterval(timerId);timerId=null;
  timerMode=mode;
  timerSeconds=pomodoroDurations[mode]*60;
  render();
}
let isAsking = false;

async function callGemini(prompt,systemInstruction,maxOutputTokens=700,onChunk=()=>{}){
 let lastError;
 for(let attempt=0;attempt<2;attempt++){
  let response;
  try{
   response=await fetch("/api/gemini",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({prompt,systemInstruction,maxOutputTokens})
   });
  }catch(e){
   throw Error("Không kết nối được máy chủ Scholar Lite. Hãy kiểm tra kết nối mạng hoặc cấu hình Vercel.");
  }

  if(!response.ok){
   const data=await response.json().catch(()=>({}));
   lastError=Error(data.error||("Máy chủ trả về HTTP "+response.status));
   // Retry only temporary server/rate-limit errors, never auth or request errors.
   if(attempt===0&&[429,500,502,503,504].includes(response.status)){
    await new Promise(r=>setTimeout(r,900));
    continue;
   }
   if(response.status===401||response.status===403)throw Error("Gemini API key không hợp lệ hoặc chưa được cấp quyền.");
   throw lastError;
  }

  if(!response.body)throw Error("Trình duyệt không hỗ trợ nhận phản hồi dạng luồng.");
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let buffer="",fullText="";
  try{
   while(true){
    const {value,done}=await reader.read();
    if(done)break;
    buffer+=decoder.decode(value,{stream:true});
    const events=buffer.split(/\r?\n\r?\n/);
    buffer=events.pop()||"";
    for(const eventText of events){
     const dataLine=eventText.split(/\r?\n/).find(line=>line.startsWith("data:"));
     if(!dataLine)continue;
     let event;
     try{event=JSON.parse(dataLine.slice(5).trim());}catch{continue;}
     if(event.error)throw Error(event.error);
     if(typeof event.text==="string"&&event.text){
      fullText+=event.text;
      onChunk(event.text);
     }
    }
   }
   buffer+=decoder.decode();
   if(buffer.trim()){
    const dataLine=buffer.split(/\r?\n/).find(line=>line.startsWith("data:"));
    if(dataLine){
     const event=JSON.parse(dataLine.slice(5).trim());
     if(event.error)throw Error(event.error);
     if(typeof event.text==="string"){fullText+=event.text;onChunk(event.text);}
    }
   }
  }catch(e){
   try{await reader.cancel();}catch{}
   throw e;
  }
  if(!fullText.trim())throw Error("Gemini chưa trả về nội dung. Hãy thử lại.");
  return fullText.trim();
 }
 throw lastError||Error("Không thể kết nối Gemini.");
}
function updateChatLog(){
 const log=$("#chatLog");
 if(!log)return;
 log.innerHTML=chat.map(m=>`<div class="chat-message ${m.role}"><strong>${m.role==="user"?"Bạn":"Gemini"}</strong><div>${esc(m.text).replace(/\n/g,"<br>")}</div></div>`).join("");
 renderMath(log);
 log.scrollTop=log.scrollHeight;
}
async function askGemini(){
 if(isAsking)return;
 const input=$("#prompt"),prompt=input.value.trim();if(!prompt)return;
 if(!activeChatId) activeChatId=globalThis.crypto?.randomUUID?.()||("chat-"+Date.now()+"-"+Math.random().toString(36).slice(2));
 isAsking=true;
 chat.push({role:"user",text:prompt});
 input.value="";
 const context=chat.slice(-6).map(m=>(m.role==="user"?"Người học: ":"Trợ lý: ")+m.text.slice(0,1200)).join("\n\n");
 const answerIndex=chat.length;
 chat.push({role:"model",text:""});
 render();
 const btn=$("#askBtn");if(btn){btn.disabled=true;btn.textContent="Đang tạo câu trả lời...";}
 try{
  await callGemini(context,"Bạn là trợ lý học tập. Trả lời tiếng Việt chính xác, trực tiếp và súc tích. Ưu tiên câu trả lời ngắn gọn, có cấu trúc; chỉ giải thích dài khi người học yêu cầu.",550,chunk=>{
   chat[answerIndex].text+=chunk;
   updateChatLog();
  });
 }catch(e){
  chat[answerIndex].text="Lỗi: "+e.message;
  updateChatLog();
 }finally{
  isAsking=false;
  await persistCurrentChat();
  render();
 }
}
async function generateQuiz(){
 const subject=$("#subject").value.trim(),topic=$("#topic").value.trim(),count=Number($("#count").value),difficulty=$("#difficulty").value;
 const err=$("#quizError"),btn=$("#generate");err.textContent="";if(!subject){err.textContent="Vui lòng nhập môn học.";return;}
 btn.disabled=true;btn.textContent="Đang tạo...";
 try{
  const prompt=`Tạo ${count} câu trắc nghiệm tiếng Việt về ${subject}; chủ đề: ${topic||"kiến thức cốt lõi"}; độ khó: ${difficulty}. Mỗi câu có 4 lựa chọn, một đáp án đúng. Chỉ trả JSON: {"title":"...","questions":[{"question":"...","options":["A","B","C","D"],"answer":0,"explanation":"..."}]}.`;
  const raw=await callGemini(prompt,"Tạo câu hỏi ngắn, chính xác. Chỉ trả JSON hợp lệ, không markdown.",Math.min(2800,300+count*165));
  const clean=raw.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();quiz=JSON.parse(clean);if(!Array.isArray(quiz.questions)||quiz.questions.length!==count)throw Error("Số câu trả về không đúng yêu cầu.");
  quiz.questions.forEach((q,i)=>{if(typeof q.question!=="string"||!Array.isArray(q.options)||q.options.length!==4||!Number.isInteger(q.answer)||q.answer<0||q.answer>3)throw Error("Câu "+(i+1)+" không hợp lệ.");});
  answers={};submitted=false;renderQuiz();
 }catch(e){err.textContent=e.message;}finally{btn.disabled=false;btn.textContent="Tạo quiz";}
}
function renderQuiz(){
 const area=$("#quizArea");if(!area||!quiz)return;
 area.innerHTML=`<div class="app-card"><h2 class="h5">${esc(quiz.title||"Bộ câu hỏi")}</h2>${quiz.questions.map((q,i)=>`<div class="border-top py-3"><div class="markdown-body mb-2"><strong>${i+1}.</strong>${renderMarkdown(q.question)}</div>${q.options.map((o,j)=>`<label class="d-block mb-2"><input type="radio" name="q${i}" value="${j}" ${answers[i]===j?"checked":""} ${submitted?"disabled":""}> <span class="markdown-body d-inline">${renderMarkdown(o)}</span> ${submitted&&j===q.answer?'<span class="text-success">✓ Đáp án</span>':""}</label>`).join("")}${submitted?'<p class="small text-secondary">'+esc(q.explanation||"")+'</p>':""}</div>`).join("")}<button class="btn btn-primary" id="submitQuiz" ${submitted?"disabled":""}>Nộp bài</button>${submitted?`<div class="alert alert-info mt-3">Điểm: ${quiz.questions.filter((q,i)=>answers[i]===q.answer).length}/${quiz.questions.length}</div><button class="btn btn-outline-primary" id="newQuiz">Tạo bộ khác</button>`:""}</div>`;
 renderMath(area);
 quiz.questions.forEach((q,i)=>area.querySelectorAll(`input[name="q${i}"]`).forEach(r=>r.onchange=()=>answers[i]=Number(r.value)));
 $("#submitQuiz").onclick=()=>{if(Object.keys(answers).length!==quiz.questions.length){toast("Hãy trả lời tất cả câu hỏi.");return;}submitted=true;renderQuiz();};
 if(submitted)$("#newQuiz").onclick=()=>{quiz=null;render();};
}
render();
updateHomeClock();
