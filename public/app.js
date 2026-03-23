// Cloudflare Worker URL (The backend API)
let API_BASE_URL = "";
console.log("App Version: 2.2 - Teacher UI & Mobile Fixes");

const state = {
  sheets: {},
  activeSheet: null,
  currentUser: null,
  principals: [],
  teachers: [],
  activeTeacher: null,
};

const elements = {
  authSection: document.getElementById("auth-section"),
  appSection: document.getElementById("app"),
  signedInUser: document.getElementById("signed-in-user"),
  signedInRole: document.getElementById("signed-in-role"),
  logout: document.getElementById("logout"),
  adminPanel: document.getElementById("admin-panel"),
  pendingPrincipals: document.getElementById("pending-principals"),
  principalDashboard: document.getElementById("principal-dashboard"),

  adminPassword: document.getElementById("admin-password"),
  adminLogin: document.getElementById("admin-login"),
  principalLoginSelect: document.getElementById("principal-login-select"),
  principalLoginPassword: document.getElementById("principal-login-password"),
  principalLogin: document.getElementById("principal-login"),
  principalSignupName: document.getElementById("principal-signup-name"),
  principalSignupPhone: document.getElementById("principal-signup-phone"),
  principalSignupEmail: document.getElementById("principal-signup-email"),
  principalSignupPassword: document.getElementById("principal-signup-password"),
  principalSignupSchool: document.getElementById("principal-signup-school"),
  principalSignup: document.getElementById("principal-signup"),

  fileInput: document.getElementById("excel-file"),
  sheetSelect: document.getElementById("sheet-select"),
  googleSheetUrl: document.getElementById("google-sheet-url"),
  loadGoogleSheet: document.getElementById("load-google-sheet"),

  teacherLoginPhone: document.getElementById("teacher-login-phone"),
  teacherLoginPassword: document.getElementById("teacher-login-password"),
  teacherLogin: document.getElementById("teacher-login"),

  teacherSelectRow: document.getElementById("teacher-select-row"),
  teacherSelect: document.getElementById("teacher-select"),
  teacherManagement: document.getElementById("teacher-management"),
  teacherClasses: document.getElementById("teacher-classes"),
  teacherPassword: document.getElementById("teacher-password"),
  studentsTable: document.getElementById("students-table"),
  sendClassMessage: document.getElementById("send-class-message"),
  messageArea: document.getElementById("message-area"),
  messageTemplate: document.getElementById("message-template"),
  templateSection: document.getElementById("template-section"),
  copyTemplate: document.getElementById("copy-template"),
  links: document.getElementById("links"),
};

const DEFAULT_TEMPLATE =
  "Dear Parents,\n" +
  "{student} (Child of {father})\n" +
  "Roll No. {roll}, Class {class}\n" +
  "Your child is absent from school today ({date}).\n" +
  "Regular attendance is very important for academic success.\n" +
  "If leave is necessary, parents must submit a signed application to the school office / class incharge.\n\n" +
  "محترم والدین،\n" +
  "\n" +
  "آپ کا بچہ آج اسکول سے غیر حاضر ہے ({dateUrdu})۔\n" +
  "باقاعدہ حاضری تعلیمی کامیابی کے لیے بہت ضروری ہے۔\n" +
  "اگر چھٹی ضروری ہو تو براہِ کرم اسکول آفس یا کلاس انچارج کو اپنے دستخط کے ساتھ درخواست جمع کروائیں۔";

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = raw.toString().replace(/[^0-9]/g, "");
  if (!digits) return null;

  if (digits.startsWith("92") && digits.length === 12) {
    return "+" + digits;
  }
  if (digits.startsWith("0") && digits.length === 11) {
    return "+92" + digits.slice(1);
  }
  if (digits.length === 10) {
    return "+92" + digits;
  }
  if (digits.length === 12 && digits.startsWith("923")) {
    return "+" + digits;
  }
  return "+" + digits;
}

function normalizeRowKeys(row) {
  const result = {};
  for (const key in row) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const normalized = key
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/['"]+/g, "");
    result[normalized] = row[key];
  }
  return result;
}

function pickField(row, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] != null && row[key] !== "") {
      return row[key];
    }
  }
  return "";
}

function makeWhatsAppLink(phone, text) {
  if (!phone) return null;
  const encoded = encodeURIComponent(text);
  return `https://wa.me/${phone.replace("+", "")}?text=${encoded}`;
}
function formatDateForMessage(date = new Date(), locale = undefined) {
  const opts = { weekday: "short", month: "short", day: "numeric", year: "numeric" };

  // Use full Urdu weekday/month names for the Urdu message.
  if (locale && locale.startsWith("ur")) {
    opts.weekday = "long";
    opts.month = "long";
  }

  return date.toLocaleDateString(locale, opts);
}
function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

function getAllowedSheetNames() {
  const sheetNames = Object.keys(state.sheets);
  const userRole = state.currentUser?.role;
  if (userRole === "admin") return [];

  // Principal can see all classes
  if (userRole === "principal") return sheetNames;

  // Teacher sees only the classes they are assigned to
  if (userRole === "teacher") {
    if (!state.activeTeacher) return [];
    const allowed = state.activeTeacher.classes
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    return sheetNames.filter((name) => allowed.includes(name));
  }

  return sheetNames;
}

function updateSheetSelectOptions() {
  const allowed = getAllowedSheetNames();
  elements.sheetSelect.innerHTML = "";

  if (!allowed.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    const userRole = state.currentUser?.role;
    emptyOption.textContent =
      userRole === "teacher"
        ? "No class available for selected teacher"
        : "No class found (check file)";
    elements.sheetSelect.appendChild(emptyOption);
    state.activeSheet = null;
    return;
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "-- Select class --";
  placeholder.disabled = true;
  placeholder.selected = true;
  elements.sheetSelect.appendChild(placeholder);

  allowed.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    elements.sheetSelect.appendChild(option);
  });

  if (allowed.includes(state.activeSheet)) {
    elements.sheetSelect.value = state.activeSheet;
  } else {
    state.activeSheet = allowed[0];
    elements.sheetSelect.value = state.activeSheet;
  }
}

function loadTeachers() {
  try {
    const raw = localStorage.getItem("attendance_teachers");
    state.teachers = raw ? JSON.parse(raw) : [];
  } catch {
    state.teachers = [];
  }
}

function saveTeachers() {
  localStorage.setItem("attendance_teachers", JSON.stringify(state.teachers));
  saveTeachersToAPI();
}

async function loadTeachersFromAPI() {
  try {
    const resp = await fetch(`${API_BASE_URL}/api/teachers`);
    const data = await resp.json();

    if (data.error) {
      console.error("Error loading teachers:", data.error);
      return;
    }

    // Merge or replace local teachers
    state.teachers = data.teachers || [];
    localStorage.setItem("attendance_teachers", JSON.stringify(state.teachers));

    // Re-link active teacher if page was refreshed
    if (state.currentUser?.role === 'teacher' && !state.activeTeacher) {
      state.activeTeacher = state.teachers.find(t => t.name === state.currentUser.name);
      if (state.activeTeacher) {
        // Now that we know the teacher, load their sheets
        loadSheetsFromAPI();
      }
    }
    render();
  } catch (err) {
    console.error("Failed to load teachers from API:", err);
  }
}

async function saveTeachersToAPI() {
  try {
    const resp = await fetch(`${API_BASE_URL}/api/teachers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teachers: state.teachers }),
    });

    if (!resp.ok) {
      console.error("Failed to save teachers:", resp.status);
    }
  } catch (err) {
    console.error("Failed to save teachers to API:", err);
  }
}

function loadPrincipals() {
  try {
    const raw = localStorage.getItem("attendance_principals");
    state.principals = raw ? JSON.parse(raw) : [];
  } catch {
    state.principals = [];
  }
}

function savePrincipals() {
  localStorage.setItem("attendance_principals", JSON.stringify(state.principals));
}

async function loadPrincipalsFromAPI() {
  try {
    const resp = await fetch(`${API_BASE_URL}/api/principals`);
    const data = await resp.json();

    if (data.error) {
      console.error("Error loading principals:", data.error);
      return;
    }

    state.principals = data.principals || [];
    localStorage.setItem("attendance_principals", JSON.stringify(state.principals));
    render();
  } catch (err) {
    console.error("Failed to load principals from API:", err);
  }
}

async function savePrincipalsToAPI() {
  try {
    const resp = await fetch(`${API_BASE_URL}/api/principals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ principals: state.principals }),
    });

    if (!resp.ok) {
      console.error("Failed to save principals:", resp.status, await resp.text());
    }
  } catch (err) {
    console.error("Failed to save principals to API:", err);
  }
}

function loadSheets() {
  try {
    const raw = localStorage.getItem("attendance_sheets");
    if (raw) {
      state.sheets = JSON.parse(raw);
    }
  } catch {
    state.sheets = {};
  }
}

function saveSheets() {
  try {
    localStorage.setItem("attendance_sheets", JSON.stringify(state.sheets));
  } catch (e) {
    console.warn("Could not save sheets to local storage (likely quota exceeded)");
  }
  saveSheetsToAPI();
}

async function loadSheetsFromAPI() {
  try {
    let principalId = null;
    if (state.currentUser?.role === 'principal') {
      principalId = state.currentUser.id;
    } else if (state.currentUser?.role === 'teacher') {
      principalId = state.activeTeacher?.principalId;
    }

    if (!principalId) return; // Can't load sheets if we don't know the principal
    const resp = await fetch(`${API_BASE_URL}/api/sheets?principalId=${encodeURIComponent(principalId)}`);
    const data = await resp.json();

    state.sheets = data.sheets || {};
    localStorage.setItem("attendance_sheets", JSON.stringify(state.sheets));
    // Update selection options based on new data
    updateSheetSelectOptions();
    render();
    
  } catch (err) {
    console.error("Failed to load sheets from API:", err);
  }
}

async function saveSheetsToAPI() {
  try {
    if (state.currentUser?.role !== 'principal') return;

    const resp = await fetch(`${API_BASE_URL}/api/sheets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheets: state.sheets, principalId: state.currentUser.id }),
    });
  } catch (err) {
    console.error("Failed to save sheets to API:", err);
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem("attendance_session");
    state.currentUser = raw ? JSON.parse(raw) : null;
  } catch {
    state.currentUser = null;
  }
}

function saveSession() {
  if (state.currentUser) {
    localStorage.setItem("attendance_session", JSON.stringify(state.currentUser));
  } else {
    localStorage.removeItem("attendance_session");
  }
}

function clearSession() {
  state.currentUser = null;
  saveSession();
}

function isPrincipalExpired(p) {
  if (!p.approved || !p.approvedAt || !p.expiresDays) return false;
  const expiresAt = p.approvedAt + p.expiresDays * 24 * 60 * 60 * 1000;
  return Date.now() > expiresAt;
}

function renderPrincipalLoginOptions() {
  const select = elements.principalLoginSelect;
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "-- Select approved principal --";
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  const approved = state.principals.filter((p) => p.approved && !isPrincipalExpired(p));
  approved.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.school})`;
    select.appendChild(opt);
  });

  select.disabled = approved.length === 0;
}

function renderPendingPrincipals() {
  const container = elements.pendingPrincipals;
  container.innerHTML = "";

  const pending = state.principals.filter((p) => !p.approved || isPrincipalExpired(p));
  if (!pending.length) {
    container.textContent = "No pending principal requests.";
    return;
  }

  pending.forEach((p) => {
    const expired = isPrincipalExpired(p);

    const row = document.createElement("div");
    row.className = "row";

    const info = document.createElement("div");
    const status = expired ? "<em>(expired)</em>" : "";
    info.innerHTML = `<strong>${p.name}</strong> ${status}<br/>` +
      `(${p.school})<br/><small>${p.phone} • ${p.email}</small>`;

    const durationSelect = document.createElement("select");
    [30, 60, 90].forEach((days) => {
      const opt = document.createElement("option");
      opt.value = days;
      opt.textContent = `${days} days`;
      durationSelect.appendChild(opt);
    });
    if (p.expiresDays) durationSelect.value = p.expiresDays;

    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "primary";
    approve.textContent = expired ? "Renew" : "Approve";
    approve.addEventListener("click", () => {
      p.approved = true;
      p.approvedAt = Date.now();
      p.expiresDays = Number(durationSelect.value);
      savePrincipals();
      render();
      alert(`${p.name} has been approved for ${p.expiresDays} days.`);
    });

    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "small";
    reject.style.marginLeft = "8px";
    reject.textContent = "Reject";
    reject.addEventListener("click", () => {
      if (!confirm(`Reject access request from '${p.name}'?`)) return;
      state.principals = state.principals.filter((x) => x.id !== p.id);
      savePrincipals();
      render();
      alert(`${p.name}'s request has been rejected.`);
    });

    row.appendChild(info);
    row.appendChild(durationSelect);
    row.appendChild(approve);
    row.appendChild(reject);
    container.appendChild(row);
  });
}

function handleAdminLogin() {
  const password = elements.adminPassword.value.trim();
  // For simplicity, this is a hard-coded admin password. Update as needed.
  if (password !== "Umar@8627") {
    alert("Invalid admin password.");
    return;
  }

  state.currentUser = { role: "admin", name: "Admin" };
  saveSession();
  render();
}

function handlePrincipalLogin() {
  const principalId = elements.principalLoginSelect.value;
  const password = elements.principalLoginPassword.value.trim();
  const principal = state.principals.find((p) => p.id === principalId);

  if (!principal) {
    alert("Please select a principal.");
    return;
  }

  // If the principal's approval period has expired, require re-approval.
  if (isPrincipalExpired(principal)) {
    principal.approved = false;
    savePrincipals();
    alert("This principal's access has expired. Please request approval again.");
    render();
    return;
  }

  if (!principal.approved) {
    alert("This principal is not yet approved.");
    return;
  }
  if (principal.password !== password) {
    alert("Incorrect password.");
    return;
  }

  state.currentUser = { role: "principal", id: principal.id, name: principal.name, school: principal.school };
  saveSession();
  loadSheetsFromAPI();
  render();
}

function handlePrincipalSignup() {
  const name = elements.principalSignupName.value.trim();
  const phone = elements.principalSignupPhone.value.trim();
  const email = elements.principalSignupEmail.value.trim();
  const password = elements.principalSignupPassword.value.trim();

  const school = elements.principalSignupSchool.value.trim();

  if (!name || !phone || !email || !password || !school) {
    alert("Please fill in name, phone, email, password, and school name.");
    return;
  }

  const existing = state.principals.find((p) => p.name === name || p.email === email);
  if (existing) {
    alert("A request with this name or email already exists.");
    return;
  }
 elements.principalSignupSchool.value = "";
  const id = `p_${Date.now()}`;
  state.principals.push({ id, name, phone, email, password, school, approved: false, approvedAt: null, expiresDays: 0 });
  savePrincipals();
  savePrincipalsToAPI();
  elements.principalSignupName.value = "";
  elements.principalSignupPhone.value = "";
  elements.principalSignupEmail.value = "";
  elements.principalSignupPassword.value = "";
  elements.principalSignupSchool.value = "";

  alert("Request submitted. Please wait for admin approval.");
  renderPrincipalLoginOptions();
}

function handleTeacherLogin() {
  const phone = elements.teacherLoginPhone.value.trim();
  const password = elements.teacherLoginPassword.value.trim();
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    setStatus("Please enter a valid phone number.", 'error');
    return;
  }

  // Find teacher in the loaded list
  const teacher = state.teachers.find(t => normalizePhone(t.phone) === normalizedPhone && t.password === password);

  if (!teacher) {
    setStatus("Invalid phone number or password.", 'error');
    return;
  }

  state.currentUser = { role: "teacher", name: teacher.name, classes: teacher.classes };
  state.activeTeacher = teacher;
  saveSession();
  loadSheetsFromAPI(); // Load sheets for this teacher's principal
  render();
}

function renderTeacherList() {
  const container = document.getElementById("teacher-list");
  container.innerHTML = "";

  if (!state.currentUser || state.currentUser.role !== "principal") {
    return;
  }

  if (!state.teachers.length) {
    container.textContent = "No teachers added yet.";
    return;
  }

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";

  const thead = document.createElement("thead");
  thead.className = "bg-indigo-600 text-white";
  thead.innerHTML =
    '<tr><th class="px-4 py-3 text-left text-xs font-bold uppercase">Name</th><th class="px-4 py-3 text-left text-xs font-bold uppercase">Phone</th><th class="px-4 py-3 text-left text-xs font-bold uppercase">Classes</th><th class="px-4 py-3 text-left text-xs font-bold uppercase">Actions</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  state.teachers.forEach((t) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = t.name;
    tr.appendChild(nameTd);

    const phoneTd = document.createElement("td");
    phoneTd.textContent = t.phone;
    tr.appendChild(phoneTd);

    const classesTd = document.createElement("td");
    classesTd.textContent = t.classes;
    tr.appendChild(classesTd);

    const actionsTd = document.createElement("td");

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.className = "small";
    editBtn.addEventListener("click", () => {
      document.getElementById("teacher-name").value = t.name;
      document.getElementById("teacher-phone").value = t.phone;
      document.getElementById("teacher-classes").value = t.classes;
      document.getElementById("teacher-password").value = t.password || "";
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.className = "small";
    deleteBtn.style.marginLeft = "8px";
    deleteBtn.addEventListener("click", () => {
      if (!confirm(`Delete teacher '${t.name}'?`)) return;
      state.teachers = state.teachers.filter((x) => x.name !== t.name);
      if (state.activeTeacher?.name === t.name) {
        state.activeTeacher = null;
      }
      saveTeachers();
      render();
    });

    actionsTd.appendChild(editBtn);
    actionsTd.appendChild(deleteBtn);
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

function parseGoogleSheetUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    // Look for /d/<id>/ in path
    const match = url.pathname.match(/\/d\/(.+?)\//);
    if (match) return match[1];

    // Try query param 'id'
    if (url.searchParams.has("id")) return url.searchParams.get("id");

    return null;
  } catch {
    return null;
  }
}

async function loadSheetsFromGoogleSheet(rawUrl) {
  const sheetId = parseGoogleSheetUrl(rawUrl);
  if (!sheetId) {
    alert("Could not parse Google Sheet ID from the link. Make sure it's a valid link.");
    return;
  }

  try {
    setStatus("Loading Google Sheet...");
    const resp = await fetch(`${API_BASE_URL}/api/google-sheet?sheetId=${encodeURIComponent(sheetId)}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    setSheets(data.sheets);
  } catch (err) {
    alert("Failed to load Google Sheet: " + err.message);
  } finally {
    setStatus("");
  }
}

function setSheets(sheets) {
  state.sheets = sheets;
  saveSheets();
  const sheetNames = Object.keys(sheets);

  if (!sheetNames.length) {
    elements.sheetSelect.innerHTML = "";
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No class found (check file)";
    elements.sheetSelect.appendChild(emptyOption);

    state.activeSheet = null;
    alert(
      "No sheets found. Make sure you uploaded a valid Excel file with at least one sheet."
    );

    render();
    return;
  }

  updateSheetSelectOptions();
  render();
}

function getActiveSheetRows() {
  if (!state.activeSheet) return [];
  return state.sheets[state.activeSheet] || [];
}

function buildStudentsTable() {
  const tbody = elements.studentsTable.querySelector("tbody");
  tbody.innerHTML = "";

  const rows = getActiveSheetRows();
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "No students found in this sheet.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((row, index) => {
    const normalizedRow = normalizeRowKeys(row);

    const roll =
      pickField(normalizedRow, [
        "roll",
        "rollnumber",
        "roll#",
      ]) || "";
    const name =
      pickField(normalizedRow, [
        "name",
        "student",
        "studentname",
      ]) || "(unknown)";
    const father =
      pickField(normalizedRow, [
        "father",
        "fathername",
        "fathersname",
      ]) || "";
    const rawPhone =
      pickField(normalizedRow, [
        "phone",
        "parentphone",
        "phonenumber",
      ]) || "";
    const phone = normalizePhone(rawPhone);

    const tr = document.createElement("tr");
    tr.className = "text-center";

    const rollTd = document.createElement("td");
    rollTd.className = "px-2 py-3 whitespace-nowrap";
    rollTd.textContent = roll;
    tr.appendChild(rollTd);

    const nameTd = document.createElement("td");
    nameTd.className = "px-2 py-3 whitespace-nowrap";
    nameTd.textContent = name;
    tr.appendChild(nameTd);

    const fatherTd = document.createElement("td");
    fatherTd.className = "px-2 py-3 whitespace-nowrap";
    fatherTd.textContent = father;
    tr.appendChild(fatherTd);

    const phoneTd = document.createElement("td");
    phoneTd.className = "px-2 py-3 whitespace-nowrap";
    phoneTd.textContent = phone || "(invalid)";
    tr.appendChild(phoneTd);

    const statusTd = document.createElement("td");
    statusTd.className = "px-2 py-3 whitespace-nowrap";
    const statusSelect = document.createElement("select");
    statusSelect.dataset.studentIndex = index;

    // Initialize status if missing
    if (typeof row._status === "undefined") {
      row._status = "present";
    }
    statusSelect.value = row._status;

    ["Present", "Absent"].forEach((label) => {
      const opt = document.createElement("option");
      opt.value = label.toLowerCase();
      opt.textContent = label;
      statusSelect.appendChild(opt);
    });

    statusTd.appendChild(statusSelect);
    tr.appendChild(statusTd);

    const actionTd = document.createElement("td");
    actionTd.className = "px-2 py-3 whitespace-nowrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "p-2 rounded-full text-white bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors";
    btn.title = "Send WhatsApp";
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M19.05 4.94A10 10 0 0 0 12 2C6.48 2 2 6.48 2 12c0 1.6.38 3.12 1.05 4.5L2 22l5.5-1.05c1.38.67 2.9 1.05 4.5 1.05h.01c5.52 0 10-4.48 10-10 0-2.76-1.12-5.26-2.95-7.06zM12 20.01c-1.42 0-2.78-.38-3.96-1.04l-.28-.17-2.96.56.57-2.9-.19-.29c-.73-1.13-1.11-2.48-1.11-3.88 0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8zm4.47-6.61c-.14-.07-1.06-.52-1.22-.58-.17-.06-.29-.09-.42.09-.12.18-.46.58-.57.7-.1.12-.2.13-.37.04-.17-.09-1-0.37-1.9-1.17-.71-.63-1.18-1.41-1.3-1.65-.12-.24-.01-.37.06-.49.07-.1.15-.25.22-.34.07-.09.1-.15.15-.25.05-.1.02-.18-.02-.26-.05-.09-1.22-2.92-1.67-3.99-.44-1.05-.88-.9-.98-.91-.1-.01-.22-.01-.34-.01s-.32.04-.49.22c-.17.18-.65.62-.65 1.51s.67 1.75.76 1.87c.09.12 1.25 1.9 3.03 2.65.43.18.76.29 1.03.37.48.15.91.13 1.25.08.38-.06 1.06-.43 1.21-.85.15-.42.15-.78.1-.85-.05-.07-.17-.12-.34-.19z"/></svg>`;
    btn.disabled = row._status !== "absent";
    btn.addEventListener("click", () => {
      const template = elements.messageTemplate.value || DEFAULT_TEMPLATE;
      const message = template
        .replace("{student}", name)
        .replace("{roll}", roll)
        .replace("{father}", father)
        .replace(
          "{class}",
          pickField(normalizedRow, ["class", "classs", "classes"]) || state.activeSheet
        )
        .replace("{date}", formatDateForMessage())
        .replace("{dateUrdu}", formatDateForMessage(undefined, "ur-PK"));
      const link = makeWhatsAppLink(phone, message);
      if (link) window.open(link, "_blank");
    });

    statusSelect.addEventListener("change", () => {
      btn.disabled = statusSelect.value !== "absent";
      row._status = statusSelect.value;
      btn.disabled = row._status !== "absent";
      saveSheets(); // Save status changes
    });

    actionTd.appendChild(btn);
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  });
}

function render() {
  const user = state.currentUser;

  // Authentication flow
  const signedIn = Boolean(user);

  if (signedIn) {
    elements.logout.classList.remove("hidden");
  } else {
    elements.logout.classList.add("hidden");
  }

  elements.authSection.classList.toggle("hidden", signedIn);
  elements.appSection.classList.toggle("hidden", !signedIn);
  if (!signedIn) {
    renderPrincipalLoginOptions();
    return;
  }

  elements.signedInUser.textContent = user.name;
  elements.signedInRole.textContent = `(${user.role})`;

  const isAdmin = user.role === "admin";
  const isPrincipal = user.role === "principal";
  const isTeacher = user.role === "teacher";

  elements.adminPanel.classList.toggle("hidden", !isAdmin);
  elements.principalDashboard.classList.toggle("hidden", isAdmin);

  // Hide/Show template section: Only Principal can see/edit the template
  if (elements.templateSection) {
    elements.templateSection.classList.toggle("hidden", !isPrincipal);
  }

  // Teacher UI
  elements.teacherSelectRow.classList.toggle("hidden", !isTeacher);
  elements.teacherManagement.classList.toggle("hidden", !isPrincipal);

  const teacherSelect = elements.teacherSelect;
  teacherSelect.innerHTML = "";

  if (isPrincipal || isTeacher) {
    const placeholder = document.createElement("option");
    placeholder.selected = true;
    placeholder.value = "";
    placeholder.textContent = "-- Select teacher --";
    placeholder.disabled = true;
    placeholder.selected = true;
    teacherSelect.appendChild(placeholder);

    state.teachers.forEach((t) => {
       const option = document.createElement("option");
      option.value = t.name;
      option.textContent = `${t.name} (${t.phone})`;
      teacherSelect.appendChild(option);
    });

    teacherSelect.disabled = state.teachers.length === 0;


    if (state.activeTeacher) {
      teacherSelect.value = state.activeTeacher.name;
     }
  } else {
    teacherSelect.disabled = true;
  }

  renderTeacherList();

  updateSheetSelectOptions();
   elements.sheetSelect.disabled = isTeacher && !state.activeTeacher;

  // Teachers should not upload sheets. Only approved principals can upload.
  elements.fileInput.disabled = isTeacher;
  elements.googleSheetUrl.disabled = isTeacher;
  elements.loadGoogleSheet.disabled = isTeacher;

  if (!elements.messageTemplate.value) {
    elements.messageTemplate.value = DEFAULT_TEMPLATE;
  }

  buildStudentsTable();
  elements.messageArea.classList.add("hidden");
  elements.links.innerHTML = "";

  renderPendingPrincipals();
}

function loadSheetsFromExcel(file) {
  const form = new FormData();
  form.append("file", file);

  // Use API_BASE_URL if set, otherwise fallback to relative path (local dev)
  const url = API_BASE_URL ? `${API_BASE_URL}/api/upload` : "/api/upload";

  fetch(url, {
    method: "POST",
    body: form,
  })
    .then(async (r) => {
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`Server returned ${r.status}: ${text}`);
      }
      const text = await r.text();
      const trimmed = text ? text.trim() : "";
      if (!trimmed) throw new Error("Server returned empty response. Check API_BASE_URL in app.js");
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(`Invalid JSON response: "${trimmed.substring(0, 50)}..."`);
      }
    })
    .then((data) => {
      if (data.error) throw new Error(data.error);
      setSheets(data.sheets);
    })
    .catch((err) => {
      console.error(err);
      alert(`Failed to load Excel (URL: ${url}): ` + err.message);
    });
}



function sendClassMessage() {
  const active = state.activeSheet;
  if (!active) return;
  const targetSheet = active;

  if (!targetSheet) {
    alert("Please select a class.");
    return;
  }

  const rows = state.sheets[targetSheet] || [];
  const template = elements.messageTemplate.value || DEFAULT_TEMPLATE;

  const links = rows
    .filter((row) => row._status === "absent") // Only include students marked as absent
    .map((row) => {
      const roll = row.Roll || row.roll || row["Roll #"] || row["roll #"] || "";
      const name =
        pickField(row, [
          "Name",
          "name",
          "Student",
          "student",
          "Student Name",
          "Student's Name",
          "students name",
        ]) || "(student)";
      const father =
        pickField(row, [
          "Father",
          "father",
          "Father's Name",
          "Father Name",
          "father name",
        ]) || "";
      const rawPhone =
        pickField(row, [
          "Phone",
          "phone",
          "ParentPhone",
          "parentPhone",
          "Parent's Phone",
          "Parent Phone",
          "Phone Number",
          "phone number",
        ]) || "";
      const phone = normalizePhone(rawPhone);
      if (!phone) return null;

      const normalizedRow = normalizeRowKeys(row);

      const message = template
        .replace("{student}", name)
        .replace("{roll}", roll)
        .replace("{father}", father)
        .replace(
          "{class}",
          pickField(normalizedRow, ["class", "classs", "classes"]) || targetSheet
        )
        .replace("{date}", formatDateForMessage())
        .replace("{dateUrdu}", formatDateForMessage(undefined, "ur-PK"));
      return { name, phone, link: makeWhatsAppLink(phone, message) };
    })
    .filter(Boolean);

  if (links.length === 0) {
    alert("No students marked as 'Absent'. Please mark students as absent first.");
    return;
  }

  elements.links.innerHTML = "";
  links.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "row";

    const label = document.createElement("span");
    label.textContent = `${entry.name} (${entry.phone})`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "small";
    btn.textContent = "Open WhatsApp";
    btn.addEventListener("click", () => {
      window.open(entry.link, "_blank");
    });

    row.appendChild(label);
    row.appendChild(btn);

    elements.links.appendChild(row);
  });

  elements.messageArea.classList.remove("hidden");
}

function init() {
  elements.fileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    loadSheetsFromExcel(file);
  });

  // Auth tab switching
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".auth-panel").forEach((panel) => panel.classList.add("hidden"));

      tab.classList.add("active");
      const panel = document.querySelector(`.auth-panel[data-panel="${tab.dataset.tab}"]`);
      if (panel) panel.classList.remove("hidden");
    });
  });

  elements.teacherLogin.addEventListener("click", () => {
    handleTeacherLogin();
  });
  elements.teacherLoginPassword.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTeacherLogin();
    }
  });

  elements.sheetSelect.addEventListener("change", (event) => {
    state.activeSheet = event.target.value;
    buildStudentsTable();
  });

  elements.loadGoogleSheet.addEventListener("click", () => {
    const raw = elements.googleSheetUrl.value.trim();
    if (!raw) {
      alert("Paste a Google Sheet link first.");
      return;
    }
    loadSheetsFromGoogleSheet(raw);
  });

  elements.teacherSelect.addEventListener("change", (event) => {
    const name = event.target.value;
     state.activeTeacher = state.teachers.find((t) => t.name === name) || null;
     console.log("Selected teacher:", state.activeTeacher);
     render();

  });

  elements.addTeacher = document.getElementById("add-teacher");
  elements.addTeacher.addEventListener("click", () => {
    const name = document.getElementById("teacher-name").value.trim();
    const phone = document.getElementById("teacher-phone").value.trim();
    const classes = document.getElementById("teacher-classes").value.trim();
    const password = document.getElementById("teacher-password").value.trim();

    if (!name || !phone || !classes || !password) {
      setStatus("Please provide teacher name, phone, password, and class list.", 'error');
      return;
    }

    const existing = state.teachers.find((t) => t.name === name);
    if (existing) {
      existing.phone = phone;
      existing.password = password;
      existing.classes = classes;
      // preserve existing principalId
    } else {
      state.teachers.push({ name, phone, classes, password, principalId: state.currentUser.id });
    }

    saveTeachers();
    render();

    document.getElementById("teacher-name").value = "";
    document.getElementById("teacher-phone").value = "";
    document.getElementById("teacher-password").value = "";
    document.getElementById("teacher-classes").value = "";
  });

  elements.sendClassMessage.addEventListener("click", () => {
    sendClassMessage();
  });

  elements.copyTemplate.addEventListener("click", () => {
    elements.messageTemplate.select();
    document.execCommand("copy");
    alert("Template copied to clipboard.");
  });

  elements.adminLogin.addEventListener("click", () => {
    handleAdminLogin();
  });

  elements.principalLogin.addEventListener("click", () => {
    handlePrincipalLogin();
  });

  elements.principalSignup.addEventListener("click", () => {
    handlePrincipalSignup();
  });

  elements.logout.addEventListener("click", () => {
    clearSession();
    render();
  });

  // Load data from local storage for a fast initial load
  loadTeachers();
  loadPrincipals();
  loadSession();
  loadSheets();

  // Restore activeTeacher if logged in as teacher to ensure sheets load correctly
  if (state.currentUser?.role === 'teacher') {
    state.activeTeacher = state.teachers.find(t => t.name === state.currentUser.name);
  }
  // Sync with the server
  loadPrincipalsFromAPI();
  loadTeachersFromAPI();
  loadSheetsFromAPI();
  render();
}

window.addEventListener("DOMContentLoaded", () => {
  init();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .catch((err) => console.error("SW registration failed", err));
  }
});
