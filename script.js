// Client-only implementation using @google/genai via ESM on CDN.
// For GitHub Pages, we import from esm.run which bundles the official SDK for browsers.

import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// UI elements
const fileInput = document.getElementById("fileInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const preview = document.getElementById("preview");
const previewImg = document.getElementById("previewImg");
const resultSection = document.getElementById("resultSection");
const tagsContainer = document.getElementById("tagsContainer");
const statusEl = document.getElementById("status");
const recommendationEl = document.getElementById("recommendation");
const rawJsonEl = document.getElementById("rawJson");
const apiKeyInput = document.getElementById("apiKey");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const manualBtn = document.getElementById("manualBtn");
const manualModal = document.getElementById("manualModal");
const manualAnalyzeBtn = document.getElementById("manualAnalyzeBtn");
const helpBtn = document.getElementById("helpBtn");
const helpModal = document.getElementById("helpModal");
const resetBtn = document.getElementById("resetBtn");
const toasts = document.getElementById("toasts");

// Persist API key in localStorage (user provided)
const KEY_STORAGE = "gemini_api_key";
apiKeyInput.value = localStorage.getItem(KEY_STORAGE) || "";
saveKeyBtn.addEventListener("click", () => {
  localStorage.setItem(KEY_STORAGE, apiKeyInput.value.trim());
  saveKeyBtn.textContent = "Сохранено";
  setTimeout(() => (saveKeyBtn.textContent = "Сохранить ключ"), 1200);
});

// Generate simple favicon + icon at runtime
(function generateIcons() {
  const sizes = [32, 192, 512];
  sizes.forEach((s) => {
    const canvas = document.createElement("canvas");
    canvas.width = s; canvas.height = s;
    const ctx = canvas.getContext("2d");
    // background
    ctx.fillStyle = "#1b1b1b"; ctx.fillRect(0,0,s,s);
    // gradient hexagon-ish badge
    const grad = ctx.createLinearGradient(0,0,s,s);
    grad.addColorStop(0, "#7c7cff");
    grad.addColorStop(1, "#b49bff");
    ctx.fillStyle = grad;
    const r = s*0.36;
    const cx = s/2, cy = s/2;
    ctx.beginPath();
    for (let i=0;i<6;i++) {
      const ang = Math.PI/3*i - Math.PI/6;
      const x = cx + r*Math.cos(ang);
      const y = cy + r*Math.sin(ang);
      i===0? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.fill();
    // star glyph
    ctx.fillStyle = "#ffb400";
    drawStar(ctx, cx, cy, 5, s*0.14, s*0.06);

    const url = canvas.toDataURL("image/png");
    const link = document.createElement("link");
    link.rel = s===32? "icon" : "apple-touch-icon";
    link.sizes = `${s}x${s}`;
    link.href = url;
    document.head.appendChild(link);
  });
  function drawStar(ctx, cx, cy, spikes, outerR, innerR){
    let rot = Math.PI/2*3, x = cx, y = cy;
    ctx.beginPath(); ctx.moveTo(cx, cy-outerR);
    for (let i=0; i<spikes; i++){
      x = cx + Math.cos(rot)*outerR; y = cy + Math.sin(rot)*outerR; ctx.lineTo(x,y); rot += Math.PI/spikes;
      x = cx + Math.cos(rot)*innerR; y = cy + Math.sin(rot)*innerR; ctx.lineTo(x,y); rot += Math.PI/spikes;
    }
    ctx.lineTo(cx, cy-outerR); ctx.closePath(); ctx.fill();
  }
})();

// ===== Deterministic 5★ rules based on the provided table =====
const FIVE_STAR_RULES = {
  "crowd-control": ["dp-recovery","melee","vanguard","summon","supporter","fast-redeploy","specialist","slow"],
  "debuff": ["aoe","supporter","fast-redeploy","melee","specialist"],
  "support": ["dp-recovery","vanguard","survival","supporter"],
  "shift": ["defense","defender","dps","slow"],
  "nuker": ["ranged","sniper","aoe","caster"],
  "specialist": ["survival","slow"],
  "summon": ["supporter"],
  // bottom blue rows
  "slow": ["caster + dps","aoe","sniper","dps","melee","guard","caster","healing"],
  "dps": ["defense","defender","supporter","healing","aoe + melee","aoe + guard","aoe"],
  "defense": ["survival","guard","aoe","ranged","caster"],
  "survival": ["defender","supporter","ranged","sniper"],
  "healing": ["caster","dp-recovery","vanguard","supporter"],
  "ranged": ["dp-recovery","vanguard"]
};

function normalizeTag(t) { return String(t).trim().toLowerCase(); }

function evaluateFiveStar(userTags) {
  const tagsNorm = (userTags||[]).map(normalizeTag);
  // Senior Operator сам по себе гарантирует 5★
  if (tagsNorm.includes("senior operator")) {
    return {
      fiveStarPossible: true,
      recommendedTags: ["Senior Operator"],
      allPairs: [["Senior Operator"]]
    };
  }
  const pairs = [];
  for (const [primary, partners] of Object.entries(FIVE_STAR_RULES)) {
    if (!tagsNorm.includes(primary)) continue;
    for (const p of partners) {
      if (tagsNorm.includes(p)) {
        pairs.push([primary, p]);
      }
    }
  }
  return {
    fiveStarPossible: pairs.length > 0,
    recommendedTags: pairs[0] ? pairs[0].map(x => deslugify(x)) : [],
    allPairs: pairs.map(([a,b]) => [deslugify(a), deslugify(b)])
  };
}

function deslugify(s){
  // restore nice case for known tokens
  const map = {
    "dp-recovery":"DP-Recovery","fast-redeploy":"Fast-Redeploy","crowd-control":"Crowd-Control","aoe":"AoE","dps":"DPS"
  };
  return map[s] || s.split(" ").map(w => w[0]? w[0].toUpperCase()+w.slice(1) : w).join(" ");
}

// Helpers
function setLoading(isLoading) {
  analyzeBtn.disabled = isLoading || !fileInput.files?.length;
  statusEl.textContent = isLoading ? "Обработка изображения в Gemini…" : "";
}

// Toasts
function showToast({ title = "Сообщение", message = "", type = "warn", timeout = 2800 } = {}) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<div class="title">${title}</div><div class="msg">${message}</div>`;
  const close = document.createElement("button");
  close.className = "close"; close.textContent = "×";
  close.addEventListener("click", () => toasts.removeChild(el));
  el.appendChild(close);
  toasts.appendChild(el);
  if (timeout) setTimeout(() => { el.isConnected && toasts.removeChild(el); }, timeout);
}

function extIsRare(tag) {
  // minimal heuristic: tags that are typically rarer in recruitment
  const rareSet = new Set([
    "Senior Operator","Top Operator","Crowd-Control","Fast-Redeploy","Summon","Nuker","Shift","Robot","Starter"
  ].map(t => t.toLowerCase()));
  return rareSet.has(String(tag).toLowerCase());
}

function renderTags(tags) {
  tagsContainer.innerHTML = "";
  (tags || []).forEach(tag => {
    const span = document.createElement("span");
    span.className = `tag ${extIsRare(tag) ? "rare" : "common"}`;
    span.textContent = tag;
    tagsContainer.appendChild(span);
  });
}

function buildResultBlock(data) {
  recommendationEl.innerHTML = "";
  const box = document.createElement("div");
  box.className = "notice " + (data.fiveStarPossible ? "ok" : "bad");

  const header = document.createElement("h4");
  header.textContent = data.fiveStarPossible ? "⭐ Шанс на 5★ оператора" : "❌ 5★ оператор недоступен";
  box.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "kv";

  const k1 = document.createElement("div"); k1.className = "k"; k1.textContent = "Распознано тегов";
  const v1 = document.createElement("div"); v1.textContent = String((data.tags||[]).length);
  grid.appendChild(k1); grid.appendChild(v1);

  const k2 = document.createElement("div"); k2.className = "k"; k2.textContent = "Рекомендуемые теги";
  const v2 = document.createElement("div"); v2.textContent = (data.recommendedTags||[]).join(", ") || "—";
  grid.appendChild(k2); grid.appendChild(v2);

  // 6★ tip if Top Operator present
  const hasTop = (data.tags||[]).some(t => String(t).toLowerCase() === "top operator");
  if (hasTop) {
    const k3 = document.createElement("div"); k3.className = "k"; k3.textContent = "Важный тег";
    const v3 = document.createElement("div"); v3.innerHTML = "<b>Top Operator</b> — это гарант 6★. Используйте другой ресурс и уделите внимание этому тегу.";
    grid.appendChild(k3); grid.appendChild(v3);
  }

  box.appendChild(grid);
  recommendationEl.appendChild(box);
}

// File handling
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) { analyzeBtn.disabled = true; preview.classList.add("hidden"); return; }
  analyzeBtn.disabled = false;
  const reader = new FileReader();
  reader.onload = () => {
    previewImg.src = reader.result;
    preview.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

analyzeBtn.addEventListener("click", async () => {
  const apiKey = (apiKeyInput.value || localStorage.getItem(KEY_STORAGE) || "").trim();
  if (!apiKey) { showToast({ title: "Нужен API ключ", message: "Введите и сохраните Gemini API Key.", type: "warn" }); return; }
  const file = fileInput.files?.[0];
  if (!file) return;
  setLoading(true);
  try {
    const base64Data = await toBase64Raw(file);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = "You are an expert in Arknights recruitment tag recognition. Analyze this image and LIST ONLY the visible recruitment tags. Respond strictly as JSON: {tags:[...]}";
    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { mimeType: file.type, data: base64Data } }
    ]);
    const text = result.response.text();
    let data;
    try { data = JSON.parse(safeJson(text)); } catch (e) {
      // try to extract JSON substring
      const match = text.match(/\{[\s\S]*\}/);
      data = match ? JSON.parse(safeJson(match[0])) : { tags: [] };
    }
    resultSection.classList.remove("hidden");
    renderTags(data.tags || []);
    const evalRes = evaluateFiveStar(data.tags || []);
    buildResultBlock({ tags: data.tags || [], fiveStarPossible: evalRes.fiveStarPossible, recommendedTags: evalRes.recommendedTags });
    rawJsonEl.textContent = JSON.stringify({ input: data, evaluation: evalRes }, null, 2);
    statusEl.textContent = "Готово.";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "";
    showToast({ title: "Ошибка", message: "Не удалось выполнить запрос к Gemini.", type: "error" });
  } finally {
    setLoading(false);
  }
});

async function toBase64Raw(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return String(dataUrl).split(",")[1];
}

// Manual modal events
manualBtn.addEventListener("click", () => {
  manualModal.classList.remove("hidden");
});
document.addEventListener("click", (e) => {
  const target = e.target;
  if (target && target.dataset && target.dataset.close) {
    const id = target.dataset.close;
    document.getElementById(id)?.classList.add("hidden");
  }
});
// Esc closes any open modal
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    [manualModal, helpModal].forEach(m => m.classList.add("hidden"));
  }
});
helpBtn.addEventListener("click", () => helpModal.classList.remove("hidden"));

// Toggle chip selection
document.addEventListener("click", (e) => {
  const target = e.target;
  if (target && target.classList && target.classList.contains("chip")) {
    target.classList.toggle("selected");
  }
});

function getSelectedTags() {
  return Array.from(manualModal.querySelectorAll(".chip.selected")).map(b => b.dataset.tag);
}

manualAnalyzeBtn.addEventListener("click", async () => {
  const apiKey = (apiKeyInput.value || localStorage.getItem(KEY_STORAGE) || "").trim();
  // API key не обязателен для ручного расчёта — оставим уведомление только если пусто и пользователь попытается OCR.
  const selected = getSelectedTags();
  if (!selected.length) { showToast({ title: "Нет тегов", message: "Выберите хотя бы один тег.", type: "warn" }); return; }
  statusEl.textContent = "Проверка тегов…";
  try {
    const evalRes = evaluateFiveStar(selected);
    resultSection.classList.remove("hidden");
    renderTags(selected);
    buildResultBlock({ tags: selected, fiveStarPossible: evalRes.fiveStarPossible, recommendedTags: evalRes.recommendedTags });
    rawJsonEl.textContent = JSON.stringify({ input: { tags: selected }, evaluation: evalRes }, null, 2);
  } finally {
    manualModal.classList.add("hidden");
    statusEl.textContent = "Готово.";
  }
});

// Reset
resetBtn.addEventListener("click", () => {
  fileInput.value = "";
  previewImg.src = "";
  preview.classList.add("hidden");
  analyzeBtn.disabled = true;
  resultSection.classList.add("hidden");
  tagsContainer.innerHTML = "";
  recommendationEl.innerHTML = "";
  statusEl.textContent = "";
  rawJsonEl.textContent = "";
  showToast({ title: "Сброшено", message: "Изображение и результаты очищены.", type: "success" });
});

function safeJson(str){
  // Remove trailing code fences or markdown artifacts
  return str
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}


