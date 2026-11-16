import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebaseConfig.js";

const $ = (s) => document.querySelector(s);
const content = $("#content");
const pages = {home:"Trang chủ",assistant:"Trợ lý học tập",quiz:"Tạo câu hỏi",todo:"To-do",pomodoro:"Pomodoro",note:"Note"};
const GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
let current="home", user=null, auth=null, db=null, modal=null;
let tasks=[], note="", chat=[], quiz=null, answers={}, submitted=false;
let timerSeconds=1500, timerId=null;

const firebaseConfigured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_");
if (firebaseConfigured) {
  const app=initializeApp(firebaseConfig); auth=getAuth(app); db=getFirestore(app);
  onAuthStateChanged(auth, async (u)=>{ user=u; updateAuth(); if(user) await loadData(); render(); });
}
function updateAuth(){ $("#authBtn").textContent=user?(user.displayName||user.email||"Tài khoản"):"Đăng nhập"; }
function toast(s){ const el=$("#notice"); el.textContent=s; el.classList.remove("d-none"); setTimeout(()=>el.classList.add("d-none"),3000); }
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
async function loadData(){
  try { const snap=await getDoc(doc(db,"users",user.uid,"scholarLite","data")); if(snap.exists()){const d=snap.data();tasks=d.tasks||[];note=d.note||"";} }
  catch(e){console.warn(e);toast("Không thể tải dữ liệu Firebase.");}
}
async function saveData(){
  if(!user||!db)return;
  try{await setDoc(doc(db,"users",user.uid,"scholarLite","data"),{tasks,note,updatedAt:new Date().toISOString()},{merge:true});}
  catch(e){toast("Không lưu được dữ liệu: "+e.message);}
}
function go(p){if(!pages[p])return;current=p;closeSidebar();render();scrollTo({top:0,behavior:"smooth"});}
function closeSidebar(){$("#sidebar").classList.remove("open");$("#backdrop").classList.remove("show");}
document.addEventListener("click",e=>{const a=e.target.closest("[data-page]");if(a){e.preventDefault();go(a.dataset.page);}});
$("#sidebarToggle").onclick=()=>{$("#sidebar").classList.add("open");$("#backdrop").classList.add("show");};
$("#sidebarClose").onclick=closeSidebar; $("#backdrop").onclick=closeSidebar;
function openAuth(){if(!modal)modal=new bootstrap.Modal($("#authModal"));modal.show();}
$("#authBtn").onclick=()=>{if(user){signOut(auth);}else openAuth();};
$("#settingsBtn").onclick=()=>user?toast("Đã đăng nhập: "+(user.email||"")):openAuth();
$("#emailForm").onsubmit=async e=>{e.preventDefault();if(!auth){$("#authMessage").textContent="Hãy cấu hình Firebase trước.";return;}try{await signInWithEmailAndPassword(auth,$("#email").value.trim(),$("#password").value);modal.hide();}catch(x){$("#authMessage").textContent=x.message;}};
$("#registerBtn").onclick=async()=>{if(!auth){$("#authMessage").textContent="Hãy cấu hình Firebase trước.";return;}try{await createUserWithEmailAndPassword(auth,$("#email").value.trim(),$("#password").value);modal.hide();}catch(x){$("#authMessage").textContent=x.message;}};
$("#googleBtn").onclick=async()=>{if(!auth){$("#authMessage").textContent="Hãy cấu hình Firebase trước.";return;}try{await signInWithPopup(auth,new GoogleAuthProvider());modal.hide();}catch(x){$("#authMessage").textContent=x.message;}};

function render(){
 document.title=pages[current]+" · Scholar Lite";
 document.querySelectorAll("#topNav [data-page]").forEach(a=>a.classList.toggle("active",a.dataset.page===current));
 if(current==="home") content.innerHTML=`<section class="hero mb-4"><p class="text-primary fw-semibold">KHÔNG GIAN HỌC TẬP CỦA BẠN</p><h1 class="display-5 fw-bold">Học tập gọn nhẹ hơn.</h1><p class="lead text-secondary">Hỏi bài, tạo trắc nghiệm, quản lý công việc, tập trung và ghi chú trong một nơi.</p><button class="btn btn-primary me-2" data-page="assistant">Bắt đầu học</button><button class="btn btn-outline-primary" data-page="todo">Xem To-do</button></section><div class="row g-3">${["assistant","quiz","todo","pomodoro","note"].map(p=>`<div class="col-md-6 col-lg-4"><div class="app-card feature-card"><h5>${pages[p]}</h5><p class="text-secondary">Mở công cụ ${pages[p].toLowerCase()}.</p><button class="btn btn-sm btn-outline-primary" data-page="${p}">Mở công cụ</button></div></div>`).join("")}</div>`;
 if(current==="assistant") content.innerHTML=`<h1 class="h3 mb-3">Trợ lý học tập</h1><div class="app-card"><div id="chatLog" class="chat-log mb-3">${chat.map(m=>`<div class="chat-message ${m.role}"><strong>${m.role==="user"?"Bạn":"Gemini"}</strong><div>${esc(m.text).replace(/\n/g,"<br>")}</div></div>`).join("")}</div><textarea id="prompt" class="form-control mb-3" rows="4" placeholder="Nhập câu hỏi hoặc nội dung bài học..."></textarea><button class="btn btn-primary" id="askBtn">Gửi câu hỏi</button> <button class="btn btn-outline-secondary" id="clearChat">Xóa hội thoại</button><p class="small text-muted mt-3">Cấu hình Gemini API key trong js/firebaseConfig.js. Không đưa key lên website công khai.</p></div>`;
 if(current==="quiz") content.innerHTML=`<h1 class="h3 mb-3">Tạo câu hỏi</h1><div class="app-card mb-3"><div class="row g-3"><div class="col-md-6"><label class="form-label">Môn học *</label><input id="subject" class="form-control" placeholder="Toán, Vật lý, Tiếng Anh..."></div><div class="col-md-6"><label class="form-label">Chủ đề</label><input id="topic" class="form-control" placeholder="Hàm số, Dao động..."></div><div class="col-md-6"><label class="form-label">Số câu</label><select id="count" class="form-select"><option>5</option><option>10</option><option>15</option></select></div><div class="col-md-6"><label class="form-label">Độ khó</label><select id="difficulty" class="form-select"><option>Dễ</option><option selected>Trung bình</option><option>Khó</option></select></div></div><button class="btn btn-primary mt-3" id="generate">Tạo quiz</button><div id="quizError" class="text-danger small mt-2"></div></div><div id="quizArea"></div>`;
 if(current==="todo") content.innerHTML=`<h1 class="h3 mb-3">To-do</h1><div class="app-card"><form id="taskForm" class="d-flex gap-2 mb-3"><input id="taskInput" class="form-control" placeholder="Thêm công việc..." required><button class="btn btn-primary">Thêm</button></form><ul class="list-group">${tasks.map((t,i)=>`<li class="list-group-item d-flex align-items-center gap-2"><input class="form-check-input task-check" type="checkbox" data-i="${i}" ${t.done?"checked":""}><span class="flex-grow-1 ${t.done?"task-done":""}">${esc(t.text)}</span><button class="btn btn-sm btn-outline-danger task-del" data-i="${i}">Xóa</button></li>`).join("")}</ul></div>`;
 if(current==="pomodoro") content.innerHTML=`<h1 class="h3 mb-3">Pomodoro</h1><div class="app-card text-center"><div class="timer mb-3" id="timerDisplay">${formatTime(timerSeconds)}</div><button class="btn btn-primary" id="timerStart">Bắt đầu</button> <button class="btn btn-outline-secondary" id="timerReset">Đặt lại</button><p class="text-muted mt-3">Phiên tập trung 25 phút</p></div>`;
 if(current==="note") content.innerHTML=`<h1 class="h3 mb-3">Note</h1><div class="app-card"><textarea id="noteArea" class="form-control note-area mb-3" placeholder="Ghi chú của bạn...">${esc(note)}</textarea><button class="btn btn-primary" id="saveNote">Lưu ghi chú</button></div>`;
 if(current==="assistant"){
   $("#askBtn").onclick=askGemini; $("#prompt").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();askGemini();}};
   $("#clearChat").onclick=()=>{chat=[];render();};
 }
 if(current==="quiz") $("#generate").onclick=generateQuiz;
 if(current==="todo"){
   $("#taskForm").onsubmit=e=>{e.preventDefault();const v=$("#taskInput").value.trim();if(v){tasks.push({text:v,done:false});saveData();render();}};
   document.querySelectorAll(".task-check").forEach(el=>el.onchange=()=>{tasks[Number(el.dataset.i)].done=el.checked;saveData();render();});
   document.querySelectorAll(".task-del").forEach(el=>el.onclick=()=>{tasks.splice(Number(el.dataset.i),1);saveData();render();});
 }
 if(current==="note") $("#saveNote").onclick=()=>{note=$("#noteArea").value;saveData();toast("Đã lưu ghi chú.");};
 if(current==="pomodoro"){
   $("#timerStart").onclick=()=>{if(timerId){clearInterval(timerId);timerId=null;$("#timerStart").textContent="Tiếp tục";return;}$("#timerStart").textContent="Tạm dừng";timerId=setInterval(()=>{timerSeconds=Math.max(0,timerSeconds-1);$("#timerDisplay").textContent=formatTime(timerSeconds);if(!timerSeconds){clearInterval(timerId);timerId=null;toast("Hoàn thành phiên Pomodoro!");$("#timerStart").textContent="Bắt đầu";}},1000);};
   $("#timerReset").onclick=()=>{clearInterval(timerId);timerId=null;timerSeconds=1500;$("#timerDisplay").textContent=formatTime(timerSeconds);$("#timerStart").textContent="Bắt đầu";};
 }
 if(current==="quiz"&&quiz) renderQuiz();
}
function formatTime(s){return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");}
async function callGemini(prompt,systemInstruction,maxOutputTokens=700){
 let error;
 for(let attempt=1;attempt<=2;attempt++){
  let response;
  try{
   response=await fetch("/api/gemini",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({prompt,systemInstruction,maxOutputTokens})
   });
  }catch(e){
   error=Error("Không kết nối được máy chủ Scholar Lite. Hãy triển khai ứng dụng cùng thư mục /api trên Vercel; chạy bằng python http.server sẽ không có API backend.");
   if(attempt===1){await new Promise(r=>setTimeout(r,400));continue;}
   break;
  }
  const data=await response.json().catch(()=>({}));
  if(response.ok&&typeof data.text==="string"&&data.text.trim())return data.text.trim();
  error=Error(data.error||("Máy chủ trả về HTTP "+response.status));
  if(![429,500,502,503,504].includes(response.status)||attempt===2)break;
  await new Promise(r=>setTimeout(r,700));
 }
 const message=error?.message||"Không thể kết nối Gemini."; 
 if(/quota|rate.?limit|resource_exhausted/i.test(message))throw Error("Gemini đang giới hạn lượt gọi API hoặc đã hết quota.");
 if(/api.?key|permission|unauthorized|forbidden/i.test(message))throw Error("Gemini API key không hợp lệ hoặc chưa được cấp quyền.");
 throw Error(message);
}
async function askGemini(){
 const prompt=$("#prompt").value.trim();if(!prompt)return;
 chat.push({role:"user",text:prompt});$("#prompt").value="";render();
 const btn=$("#askBtn");if(btn){btn.disabled=true;btn.textContent="Đang trả lời...";}
 try{const context=chat.slice(-5).map(m=>(m.role==="user"?"Người học: ":"Trợ lý: ")+m.text.slice(0,1200)).join("\n\n");const answer=await callGemini(context,"Bạn là trợ lý học tập. Trả lời tiếng Việt chính xác, trực tiếp và súc tích.",700);chat.push({role:"model",text:answer});}
 catch(e){chat.push({role:"model",text:"Lỗi: "+e.message});}
 render();
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
 area.innerHTML=`<div class="app-card"><h2 class="h5">${esc(quiz.title||"Bộ câu hỏi")}</h2>${quiz.questions.map((q,i)=>`<div class="border-top py-3"><p><strong>${i+1}. ${esc(q.question)}</strong></p>${q.options.map((o,j)=>`<label class="d-block mb-2"><input type="radio" name="q${i}" value="${j}" ${answers[i]===j?"checked":""} ${submitted?"disabled":""}> ${esc(o)} ${submitted&&j===q.answer?'<span class="text-success">✓ Đáp án</span>':""}</label>`).join("")}${submitted?'<p class="small text-secondary">'+esc(q.explanation||"")+'</p>':""}</div>`).join("")}<button class="btn btn-primary" id="submitQuiz" ${submitted?"disabled":""}>Nộp bài</button>${submitted?`<div class="alert alert-info mt-3">Điểm: ${quiz.questions.filter((q,i)=>answers[i]===q.answer).length}/${quiz.questions.length}</div><button class="btn btn-outline-primary" id="newQuiz">Tạo bộ khác</button>`:""}</div>`;
 quiz.questions.forEach((q,i)=>area.querySelectorAll(`input[name="q${i}"]`).forEach(r=>r.onchange=()=>answers[i]=Number(r.value)));
 $("#submitQuiz").onclick=()=>{if(Object.keys(answers).length!==quiz.questions.length){toast("Hãy trả lời tất cả câu hỏi.");return;}submitted=true;renderQuiz();};
 if(submitted)$("#newQuiz").onclick=()=>{quiz=null;render();};
}
render();
