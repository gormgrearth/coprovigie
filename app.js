// =========================================================
// COPROVIGIE — app.js
// Logique applicative : auth légère par code, Firestore CRUD,
// navigation entre écrans, gestion admin.
// =========================================================
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, query, where, orderBy, onSnapshot,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ---------------------------------------------------------
// INIT FIREBASE
// ---------------------------------------------------------
let app, db;
let firebaseReady = false;
try{
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  firebaseReady = !!firebaseConfig.apiKey && firebaseConfig.apiKey !== "VOTRE_API_KEY";
}catch(e){
  console.error("Firebase init error", e);
}

// ---------------------------------------------------------
// CONSTANTES
// ---------------------------------------------------------
const DEFAULT_TYPES = [
  { name: "Ascenseur",     icon: "🛗" },
  { name: "Électricité",   icon: "⚡" },
  { name: "Chauffage",     icon: "🔥" },
  { name: "Éclairage",     icon: "💡" },
  { name: "Accessibilité", icon: "♿" },
  { name: "Eau / Fuite",   icon: "💧" },
  { name: "Propreté",      icon: "🧹" },
  { name: "Sécurité",      icon: "🔒" },
];
const ICON_CHOICES = ["🛗","⚡","🔥","💡","♿","💧","🧹","🔒","🚪","🪟","🗑️","📦","🐀","🌧️","🚗","📶","🔔","🧯","🏚️","❗"];
const STATUS_LABELS = { reported: "Signalé", in_progress: "En cours", resolved: "Résolu" };

// ---------------------------------------------------------
// ETAT LOCAL (persisté dans localStorage)
// ---------------------------------------------------------
const LS_KEY = "coprovigie_session";
let state = {
  coproId: null,
  coproName: null,
  coproCode: null,
  groupId: null,    // sous-groupe sélectionné pour signaler
  pseudo: null,
  isAdmin: false,
  groups: [],
  types: [],
  reports: [],
  filter: "all",
  adminFilter: "all",
  unsubReports: null,
  unsubGroups: null,
  unsubTypes: null,
  pendingType: null, // type en cours de signalement (pour la modale)
};

function saveSession(){
  localStorage.setItem(LS_KEY, JSON.stringify({
    coproId: state.coproId,
    coproName: state.coproName,
    coproCode: state.coproCode,
    pseudo: state.pseudo,
    isAdmin: state.isAdmin,
  }));
}
function loadSession(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){ return null; }
}
function clearSession(){
  localStorage.removeItem(LS_KEY);
}

// ---------------------------------------------------------
// HELPERS DOM
// ---------------------------------------------------------
const $ = (id) => document.getElementById(id);
function show(el){ el.hidden = false; }
function hide(el){ el.hidden = true; }

function showScreen(id){
  document.querySelectorAll(".screen").forEach(s => hide(s));
  show($(id));
  window.scrollTo({ top:0, behavior:"smooth" });
}

function toast(msg, type=""){
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (type ? " toast-" + type : "");
  show(t);
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => hide(t), 3200);
}

function setBtnLoading(btn, loading){
  const spinner = btn.querySelector(".btn-spinner");
  btn.disabled = loading;
  if(spinner) spinner.hidden = !loading;
}

function normalizeCode(code){
  return (code || "").trim().toUpperCase().replace(/\s+/g, "-");
}

function formatDate(ts){
  if(!ts) return "";
  const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
  return d.toLocaleString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------------------------------------------------------
// FIRESTORE PATHS
// coprovigie/{coproId}                         -> doc copro (name, code, adminPass)
// coprovigie/{coproId}/groups/{groupId}         -> sous-groupes
// coprovigie/{coproId}/types/{typeId}           -> types d'incidents
// coprovigie/{coproId}/reports/{reportId}       -> signalements
// ---------------------------------------------------------
const coproRef    = (id) => doc(db, "coprovigie", id);
const groupsCol    = (id) => collection(db, "coprovigie", id, "groups");
const typesCol     = (id) => collection(db, "coprovigie", id, "types");
const reportsCol   = (id) => collection(db, "coprovigie", id, "reports");

// =========================================================
// NAVIGATION INITIALE
// =========================================================
document.addEventListener("DOMContentLoaded", init);

async function init(){
  bindStaticEvents();

  if(!firebaseReady){
    hide($("loader"));
    show($("app"));
    showScreen("screenWelcome");
    toast("Configuration Firebase manquante — voir firebase-config.js", "error");
    return;
  }

  const session = loadSession();
  hide($("loader"));
  show($("app"));

  if(session && session.coproId){
    try{
      const snap = await getDoc(coproRef(session.coproId));
      if(snap.exists()){
        const data = snap.data();
        // vérifie que le pseudo/role est toujours valide (le code peut avoir changé,
        // mais une session déjà ouverte reste valide tant que la copro existe)
        state.coproId = session.coproId;
        state.coproName = data.name;
        state.coproCode = data.code;
        state.pseudo = session.pseudo;
        state.isAdmin = !!session.isAdmin;
        saveSession();
        enterCoproSpace();
        return;
      }
    }catch(e){ console.error(e); }
  }
  showScreen("screenWelcome");
}

function bindStaticEvents(){
  // Welcome
  $("btnGoJoin").addEventListener("click", () => showScreen("screenJoin"));
  $("btnGoCreate").addEventListener("click", () => showScreen("screenCreate"));
  $("btnGoAdminLogin").addEventListener("click", () => showScreen("screenAdminLogin"));

  document.querySelectorAll("[data-back]").forEach(btn => {
    btn.addEventListener("click", () => showScreen(btn.dataset.back));
  });

  // Forms
  $("formJoin").addEventListener("submit", onJoinSubmit);
  $("formCreate").addEventListener("submit", onCreateSubmit);
  $("formAdminLogin").addEventListener("submit", onAdminLoginSubmit);
  $("formReport").addEventListener("submit", onReportSubmit);
  $("formAddGroup").addEventListener("submit", onAddGroup);
  $("formAddType").addEventListener("submit", onAddType);
  $("formSettingsName").addEventListener("submit", onSettingsName);
  $("formSettingsCode").addEventListener("submit", onSettingsCode);
  $("formSettingsPass").addEventListener("submit", onSettingsPass);

  // Topbar
  $("btnLogout").addEventListener("click", logout);
  $("btnAdminToggle").addEventListener("click", () => {
    populateAdminScreen();
    showScreen("screenAdmin");
  });
  $("btnBackToDash").addEventListener("click", () => showScreen("screenDashboard"));

  // Modals
  $("modalClose").addEventListener("click", () => hide($("reportModal")));
  $("reportModal").addEventListener("click", (e) => { if(e.target.id === "reportModal") hide($("reportModal")); });
  $("detailModalClose").addEventListener("click", () => hide($("detailModal")));
  $("detailModal").addEventListener("click", (e) => { if(e.target.id === "detailModal") hide($("detailModal")); });

  // Filters (dashboard)
  document.querySelectorAll("#screenDashboard .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#screenDashboard .chip").forEach(c => c.classList.remove("chip-active"));
      chip.classList.add("chip-active");
      state.filter = chip.dataset.filter;
      renderReportsList();
    });
  });
  // Filters (admin)
  document.querySelectorAll("#tabReports .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#tabReports .chip").forEach(c => c.classList.remove("chip-active"));
      chip.classList.add("chip-active");
      state.adminFilter = chip.dataset.afilter;
      renderAdminReportsList();
    });
  });

  // Admin tabs
  document.querySelectorAll(".admin-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("admin-tab-active"));
      document.querySelectorAll(".admin-tab-panel").forEach(p => hide(p));
      tab.classList.add("admin-tab-active");
      show($(tab.dataset.tab));
    });
  });

  // Group select changes which group new reports go to... actually it's a filter context
  $("groupSelect").addEventListener("change", renderReportsList);

  // populate icon select
  const iconSelect = $("newTypeIcon");
  ICON_CHOICES.forEach(ic => {
    const opt = document.createElement("option");
    opt.value = ic; opt.textContent = ic;
    iconSelect.appendChild(opt);
  });
}

// =========================================================
// CREATION COPRO
// =========================================================
async function onCreateSubmit(e){
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  const errEl = $("createError");
  hide(errEl);

  const name = $("createName").value.trim();
  const code = normalizeCode($("createCode").value);
  const adminPass = $("createAdminPass").value;
  const pseudo = $("createPseudo").value.trim();

  if(!name || !code || adminPass.length < 6 || !pseudo){
    errEl.textContent = "Merci de remplir tous les champs (mot de passe : 6 caractères min.)";
    show(errEl);
    return;
  }

  setBtnLoading(btn, true);
  try{
    // vérifie l'unicité du code
    const q = query(collection(db, "coprovigie"), where("code", "==", code));
    const existing = await getDocs(q);
    if(!existing.empty){
      errEl.textContent = "Ce code d'accès est déjà utilisé. Choisissez-en un autre.";
      show(errEl);
      setBtnLoading(btn, false);
      return;
    }

    const newCoproRef = doc(collection(db, "coprovigie"));
    await setDoc(newCoproRef, {
      name, code, adminPass,
      createdAt: serverTimestamp(),
    });

    // types par défaut
    for(const t of DEFAULT_TYPES){
      await addDoc(typesCol(newCoproRef.id), { name: t.name, icon: t.icon, createdAt: serverTimestamp() });
    }
    // un groupe par défaut
    await addDoc(groupsCol(newCoproRef.id), { name: "Bâtiment principal", createdAt: serverTimestamp() });

    state.coproId = newCoproRef.id;
    state.coproName = name;
    state.coproCode = code;
    state.pseudo = pseudo;
    state.isAdmin = true;
    saveSession();

    toast("Copropriété créée avec succès !", "success");
    enterCoproSpace();
  }catch(err){
    console.error(err);
    errEl.textContent = "Une erreur est survenue. Réessayez.";
    show(errEl);
  }finally{
    setBtnLoading(btn, false);
  }
}

// =========================================================
// REJOINDRE (résident)
// =========================================================
async function onJoinSubmit(e){
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  const errEl = $("joinError");
  hide(errEl);

  const code = normalizeCode($("joinCode").value);
  const pseudo = $("joinPseudo").value.trim();
  if(!code || !pseudo){
    errEl.textContent = "Merci de renseigner le code et votre pseudo.";
    show(errEl);
    return;
  }

  setBtnLoading(btn, true);
  try{
    const q = query(collection(db, "coprovigie"), where("code", "==", code));
    const snap = await getDocs(q);
    if(snap.empty){
      errEl.textContent = "Code d'accès introuvable. Vérifiez auprès de votre syndic.";
      show(errEl);
      setBtnLoading(btn, false);
      return;
    }
    const docSnap = snap.docs[0];
    const data = docSnap.data();

    state.coproId = docSnap.id;
    state.coproName = data.name;
    state.coproCode = data.code;
    state.pseudo = pseudo;
    state.isAdmin = false;
    saveSession();

    toast(`Bienvenue, ${pseudo} !`, "success");
    enterCoproSpace();
  }catch(err){
    console.error(err);
    errEl.textContent = "Une erreur est survenue. Réessayez.";
    show(errEl);
  }finally{
    setBtnLoading(btn, false);
  }
}

// =========================================================
// CONNEXION ADMIN (espace déjà créé)
// =========================================================
async function onAdminLoginSubmit(e){
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  const errEl = $("adminLoginError");
  hide(errEl);

  const code = normalizeCode($("adminLoginCode").value);
  const pass = $("adminLoginPass").value;

  setBtnLoading(btn, true);
  try{
    const q = query(collection(db, "coprovigie"), where("code", "==", code));
    const snap = await getDocs(q);
    if(snap.empty){
      errEl.textContent = "Copropriété introuvable pour ce code.";
      show(errEl);
      setBtnLoading(btn, false);
      return;
    }
    const docSnap = snap.docs[0];
    const data = docSnap.data();
    if(data.adminPass !== pass){
      errEl.textContent = "Mot de passe administrateur incorrect.";
      show(errEl);
      setBtnLoading(btn, false);
      return;
    }

    state.coproId = docSnap.id;
    state.coproName = data.name;
    state.coproCode = data.code;
    state.pseudo = "Administrateur";
    state.isAdmin = true;
    saveSession();

    toast("Connecté en tant qu'administrateur", "success");
    enterCoproSpace();
  }catch(err){
    console.error(err);
    errEl.textContent = "Une erreur est survenue. Réessayez.";
    show(errEl);
  }finally{
    setBtnLoading(btn, false);
  }
}

function logout(){
  if(state.unsubReports) state.unsubReports();
  if(state.unsubGroups) state.unsubGroups();
  if(state.unsubTypes) state.unsubTypes();
  clearSession();
  state = { ...state, coproId:null, coproName:null, coproCode:null, pseudo:null, isAdmin:false, groups:[], types:[], reports:[] };
  hide($("topbar"));
  hide($("btnAdminToggle"));
  showScreen("screenWelcome");
}

// =========================================================
// ENTREE DANS L'ESPACE COPRO
// =========================================================
function enterCoproSpace(){
  $("topbarCopro").textContent = state.coproName;
  $("topbarGroup").textContent = state.isAdmin ? "Administration" : `Code : ${state.coproCode}`;
  $("topbarUser").textContent = state.pseudo;
  show($("topbar"));
  if(state.isAdmin) show($("btnAdminToggle")); else hide($("btnAdminToggle"));

  listenGroups();
  listenTypes();
  listenReports();

  showScreen("screenDashboard");
}

// =========================================================
// LISTENERS TEMPS REEL
// =========================================================
function listenGroups(){
  if(state.unsubGroups) state.unsubGroups();
  const q = query(groupsCol(state.coproId), orderBy("createdAt", "asc"));
  state.unsubGroups = onSnapshot(q, (snap) => {
    state.groups = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGroupSelect();
    renderGroupsAdminList();
  }, (err) => console.error("groups listener", err));
}

function listenTypes(){
  if(state.unsubTypes) state.unsubTypes();
  const q = query(typesCol(state.coproId), orderBy("createdAt", "asc"));
  state.unsubTypes = onSnapshot(q, (snap) => {
    state.types = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTypeGrid();
    renderTypesAdminList();
  }, (err) => console.error("types listener", err));
}

function listenReports(){
  if(state.unsubReports) state.unsubReports();
  const q = query(reportsCol(state.coproId), orderBy("createdAt", "desc"));
  state.unsubReports = onSnapshot(q, (snap) => {
    state.reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderReportsList();
    renderAdminReportsList();
  }, (err) => console.error("reports listener", err));
}

// =========================================================
// RENDER: SELECT GROUPES
// =========================================================
function renderGroupSelect(){
  const sel = $("groupSelect");
  const prev = sel.value;
  sel.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "Tous les lieux";
  sel.appendChild(optAll);
  state.groups.forEach(g => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    sel.appendChild(opt);
  });
  if(prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

// =========================================================
// RENDER: GRILLE DE TYPES (boutons signalement)
// =========================================================
function renderTypeGrid(){
  const grid = $("typeGrid");
  grid.innerHTML = "";
  if(state.types.length === 0){
    grid.innerHTML = `<p class="empty-state" style="grid-column:1/-1;">Aucun type d'incident configuré. ${state.isAdmin ? "Ajoutez-en dans l'administration." : "Contactez votre administrateur."}</p>`;
    return;
  }
  state.types.forEach(t => {
    const btn = document.createElement("button");
    btn.className = "type-btn";
    btn.innerHTML = `<span class="ic">${escapeHtml(t.icon || "❗")}</span><span>${escapeHtml(t.name)}</span>`;
    btn.addEventListener("click", () => openReportModal(t));
    grid.appendChild(btn);
  });
}

// =========================================================
// MODALE: NOUVEAU SIGNALEMENT
// =========================================================
function openReportModal(type){
  state.pendingType = type;
  $("modalIcon").textContent = type.icon || "❗";
  $("reportModalTitle").textContent = type.name;
  const groupSel = $("groupSelect");
  const groupLabel = groupSel.value === "all" || !groupSel.value
    ? (state.groups[0]?.name || "Lieu non précisé")
    : groupSel.options[groupSel.selectedIndex].textContent;
  $("modalSub").textContent = `${state.coproName} · ${groupLabel}`;
  $("reportComment").value = "";
  show($("reportModal"));
  setTimeout(() => $("reportComment").focus(), 150);
}

async function onReportSubmit(e){
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  if(!state.pendingType) return;

  const groupSel = $("groupSelect");
  let groupId = groupSel.value;
  let groupName;
  if(groupId === "all" || !groupId){
    groupId = state.groups[0]?.id || null;
    groupName = state.groups[0]?.name || "Non précisé";
  }else{
    groupName = groupSel.options[groupSel.selectedIndex].textContent;
  }

  const comment = $("reportComment").value.trim();

  setBtnLoading(btn, true);
  try{
    await addDoc(reportsCol(state.coproId), {
      typeName: state.pendingType.name,
      typeIcon: state.pendingType.icon || "❗",
      groupId: groupId,
      groupName: groupName,
      comment: comment || "",
      author: state.pseudo,
      status: "reported",
      createdAt: serverTimestamp(),
    });
    hide($("reportModal"));
    toast("Signalement envoyé. Merci !", "success");
  }catch(err){
    console.error(err);
    toast("Erreur lors de l'envoi du signalement.", "error");
  }finally{
    setBtnLoading(btn, false);
  }
}

// =========================================================
// RENDER: LISTE DES SIGNALEMENTS (vue résident)
// =========================================================
function filteredReports(filter, groupFilter){
  return state.reports.filter(r => {
    if(filter !== "all" && r.status !== filter) return false;
    if(groupFilter && groupFilter !== "all" && r.groupId !== groupFilter) return false;
    return true;
  });
}

function renderReportsList(){
  const list = $("reportsList");
  const groupFilter = $("groupSelect").value;
  const reports = filteredReports(state.filter, groupFilter);

  if(reports.length === 0){
    list.innerHTML = `<p class="empty-state">Aucun signalement pour le moment. Tout va bien !</p>`;
    return;
  }
  list.innerHTML = "";
  reports.forEach(r => list.appendChild(reportCardEl(r, false)));
}

function reportCardEl(r, isAdminView){
  const card = document.createElement("button");
  card.className = "report-card";
  card.innerHTML = `
    <div class="report-ic">${escapeHtml(r.typeIcon || "❗")}</div>
    <div class="report-body">
      <div class="report-top">
        <span class="report-title">${escapeHtml(r.typeName)}</span>
        <span class="status-badge status-${r.status}">${STATUS_LABELS[r.status] || r.status}</span>
      </div>
      <div class="report-meta">${escapeHtml(r.groupName || "")} · ${formatDate(r.createdAt)}</div>
      ${r.comment ? `<div class="report-comment">${escapeHtml(r.comment)}</div>` : ""}
      <div class="report-author">Signalé par ${escapeHtml(r.author || "anonyme")}</div>
    </div>
  `;
  card.addEventListener("click", () => openDetailModal(r, isAdminView));
  return card;
}

// =========================================================
// MODALE: DETAIL SIGNALEMENT (+ changement statut si admin)
// =========================================================
function openDetailModal(r, isAdminView){
  const content = $("detailContent");
  const statusButtons = ["reported","in_progress","resolved"].map(s => `
    <button class="detail-status-btn ${s === r.status ? "active status-" + s : ""}" data-status="${s}" ${state.isAdmin ? "" : "disabled"}>
      ${STATUS_LABELS[s]}
    </button>
  `).join("");

  content.innerHTML = `
    <div class="modal-icon">${escapeHtml(r.typeIcon || "❗")}</div>
    <h3>${escapeHtml(r.typeName)}</h3>
    <p class="modal-sub">${escapeHtml(r.groupName || "")} · ${formatDate(r.createdAt)}</p>
    <div class="detail-status-row">${statusButtons}</div>
    <div class="detail-meta-block">
      <div><strong>Signalé par :</strong> ${escapeHtml(r.author || "anonyme")}</div>
      <div><strong>Date :</strong> ${formatDate(r.createdAt)}</div>
    </div>
    ${r.comment ? `<div class="detail-comment-box">${escapeHtml(r.comment)}</div>` : `<p class="settings-help">Aucun commentaire.</p>`}
    ${state.isAdmin ? `<button class="btn-outline btn-full" id="btnDeleteReport" style="margin-top:18px;border-color:var(--signal);color:var(--signal-dark);">Supprimer ce signalement</button>` : ""}
  `;

  if(state.isAdmin){
    content.querySelectorAll(".detail-status-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        try{
          await updateDoc(doc(db, "coprovigie", state.coproId, "reports", r.id), { status: btn.dataset.status });
          toast("Statut mis à jour", "success");
          hide($("detailModal"));
        }catch(e){
          console.error(e);
          toast("Erreur lors de la mise à jour", "error");
        }
      });
    });
    const delBtn = $("btnDeleteReport");
    if(delBtn){
      delBtn.addEventListener("click", async () => {
        if(!confirm("Supprimer définitivement ce signalement ?")) return;
        try{
          await deleteDoc(doc(db, "coprovigie", state.coproId, "reports", r.id));
          toast("Signalement supprimé", "success");
          hide($("detailModal"));
        }catch(e){
          console.error(e);
          toast("Erreur lors de la suppression", "error");
        }
      });
    }
  }

  show($("detailModal"));
}

// =========================================================
// ADMIN: SIGNALEMENTS
// =========================================================
function renderAdminReportsList(){
  const list = $("adminReportsList");
  if(!state.isAdmin) return;
  const reports = filteredReports(state.adminFilter, null);
  if(reports.length === 0){
    list.innerHTML = `<p class="empty-state">Aucun signalement.</p>`;
    return;
  }
  list.innerHTML = "";
  reports.forEach(r => list.appendChild(reportCardEl(r, true)));
}

function populateAdminScreen(){
  $("settingsName").value = state.coproName || "";
  $("settingsCode").value = state.coproCode || "";
  renderAdminReportsList();
  renderGroupsAdminList();
  renderTypesAdminList();
}

// =========================================================
// ADMIN: GROUPES (sous-groupes / lieux)
// =========================================================
function renderGroupsAdminList(){
  const ul = $("groupsAdminList");
  if(!ul) return;
  ul.innerHTML = "";
  if(state.groups.length === 0){
    ul.innerHTML = `<p class="empty-state">Aucun lieu défini. Ajoutez-en un ci-dessus.</p>`;
    return;
  }
  state.groups.forEach(g => {
    const li = document.createElement("li");
    li.className = "manage-item";
    li.innerHTML = `
      <span class="mi-ic">📍</span>
      <span class="mi-name">${escapeHtml(g.name)}</span>
      <button class="mi-del" data-id="${g.id}">Supprimer</button>
    `;
    li.querySelector(".mi-del").addEventListener("click", async () => {
      if(!confirm(`Supprimer "${g.name}" ? Les signalements existants conserveront ce nom.`)) return;
      try{
        await deleteDoc(doc(db, "coprovigie", state.coproId, "groups", g.id));
        toast("Lieu supprimé", "success");
      }catch(e){ console.error(e); toast("Erreur", "error"); }
    });
    ul.appendChild(li);
  });
}

async function onAddGroup(e){
  e.preventDefault();
  const input = $("newGroupName");
  const name = input.value.trim();
  if(!name) return;
  try{
    await addDoc(groupsCol(state.coproId), { name, createdAt: serverTimestamp() });
    input.value = "";
    toast("Lieu ajouté", "success");
  }catch(err){
    console.error(err);
    toast("Erreur lors de l'ajout", "error");
  }
}

// =========================================================
// ADMIN: TYPES D'INCIDENTS
// =========================================================
function renderTypesAdminList(){
  const ul = $("typesAdminList");
  if(!ul) return;
  ul.innerHTML = "";
  if(state.types.length === 0){
    ul.innerHTML = `<p class="empty-state">Aucun type défini. Ajoutez-en un ci-dessus.</p>`;
    return;
  }
  state.types.forEach(t => {
    const li = document.createElement("li");
    li.className = "manage-item";
    li.innerHTML = `
      <span class="mi-ic">${escapeHtml(t.icon || "❗")}</span>
      <span class="mi-name">${escapeHtml(t.name)}</span>
      <button class="mi-del" data-id="${t.id}">Supprimer</button>
    `;
    li.querySelector(".mi-del").addEventListener("click", async () => {
      if(!confirm(`Supprimer le type "${t.name}" ?`)) return;
      try{
        await deleteDoc(doc(db, "coprovigie", state.coproId, "types", t.id));
        toast("Type supprimé", "success");
      }catch(e){ console.error(e); toast("Erreur", "error"); }
    });
    ul.appendChild(li);
  });
}

async function onAddType(e){
  e.preventDefault();
  const nameInput = $("newTypeName");
  const iconSelect = $("newTypeIcon");
  const name = nameInput.value.trim();
  const icon = iconSelect.value || "❗";
  if(!name) return;
  try{
    await addDoc(typesCol(state.coproId), { name, icon, createdAt: serverTimestamp() });
    nameInput.value = "";
    toast("Type ajouté", "success");
  }catch(err){
    console.error(err);
    toast("Erreur lors de l'ajout", "error");
  }
}

// =========================================================
// ADMIN: REGLAGES
// =========================================================
async function onSettingsName(e){
  e.preventDefault();
  const name = $("settingsName").value.trim();
  if(!name) return;
  try{
    await updateDoc(coproRef(state.coproId), { name });
    state.coproName = name;
    $("topbarCopro").textContent = name;
    saveSession();
    toast("Nom mis à jour", "success");
  }catch(err){
    console.error(err);
    toast("Erreur", "error");
  }
}

async function onSettingsCode(e){
  e.preventDefault();
  const code = normalizeCode($("settingsCode").value);
  if(!code) return;
  try{
    // vérifie unicité
    const q = query(collection(db, "coprovigie"), where("code", "==", code));
    const snap = await getDocs(q);
    if(!snap.empty && snap.docs[0].id !== state.coproId){
      toast("Ce code est déjà utilisé par une autre copropriété.", "error");
      return;
    }
    await updateDoc(coproRef(state.coproId), { code });
    state.coproCode = code;
    saveSession();
    toast("Code d'accès mis à jour. Les sessions déjà ouvertes ne sont pas affectées.", "success");
  }catch(err){
    console.error(err);
    toast("Erreur", "error");
  }
}

async function onSettingsPass(e){
  e.preventDefault();
  const pass = $("settingsPass").value;
  if(pass.length < 6){
    toast("Le mot de passe doit faire au moins 6 caractères.", "error");
    return;
  }
  try{
    await updateDoc(coproRef(state.coproId), { adminPass: pass });
    $("settingsPass").value = "";
    toast("Mot de passe administrateur mis à jour", "success");
  }catch(err){
    console.error(err);
    toast("Erreur", "error");
  }
}
