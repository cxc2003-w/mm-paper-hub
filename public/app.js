const searchForm = document.getElementById("search-form");
const queryInput = document.getElementById("query");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const favoritesEl = document.getElementById("favorites");
const refreshFavoritesBtn = document.getElementById("refresh-favorites");
const cardTpl = document.getElementById("paper-card");
const quickTagsEl = document.getElementById("quick-tags");
const totalBadgeEl = document.getElementById("total-badge");
const emptyTipsEl = document.getElementById("empty-tips");

let favoriteIds = new Set();
const API_BASE = location.protocol === "file:" ? "http://localhost:3000" : "";
const QUICK_TAGS = [
  "multimodal model",
  "vision language model",
  "video language model",
  "audio language model",
  "multimodal agent"
];

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function shortText(text, max = 220) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "..." : text;
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

function createPaperCard(paper, { inFavoriteList = false } = {}) {
  const frag = cardTpl.content.cloneNode(true);
  const root = frag.querySelector(".card");
  const title = frag.querySelector(".title");
  const sub = frag.querySelector(".sub");
  const summary = frag.querySelector(".summary");
  const pdf = frag.querySelector(".pdf");
  const abs = frag.querySelector(".abs");
  const saveBtn = frag.querySelector(".save");
  const removeBtn = frag.querySelector(".remove");

  title.textContent = paper.title || "(无标题)";
  sub.textContent = `${(paper.authors || []).slice(0, 3).join(", ") || "未知作者"} | ${formatDate(paper.published)}`;
  summary.textContent = shortText(paper.summary || "无摘要");
  pdf.href = paper.pdfLink || "#";
  abs.href = paper.id || "#";

  if (inFavoriteList) {
    saveBtn.classList.add("hidden");
    removeBtn.classList.remove("hidden");
  } else if (favoriteIds.has(paper.id)) {
    saveBtn.textContent = "已收藏";
    saveBtn.disabled = true;
  }

  saveBtn.addEventListener("click", async () => {
    await fetch(apiUrl("/api/favorites"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(paper)
    });
    favoriteIds.add(paper.id);
    saveBtn.textContent = "已收藏";
    saveBtn.disabled = true;
    await loadFavorites();
  });

  removeBtn.addEventListener("click", async () => {
    await fetch(apiUrl(`/api/favorites/${encodeURIComponent(paper.id)}`), {
      method: "DELETE"
    });
    favoriteIds.delete(paper.id);
    root.remove();
  });

  return frag;
}

async function loadFavorites() {
  try {
    const res = await fetch(apiUrl("/api/favorites"));
    const data = await res.json();
    const items = data.items || [];
    favoriteIds = new Set(items.map(item => item.id));

    favoritesEl.innerHTML = "";
    if (!items.length) {
      favoritesEl.innerHTML = "<p class='muted'>暂无收藏</p>";
      return;
    }
    items.forEach(item => favoritesEl.appendChild(createPaperCard(item, { inFavoriteList: true })));
  } catch (error) {
    favoritesEl.innerHTML = "<p class='muted'>收藏加载失败</p>";
  }
}

async function runSearch() {
  const q = queryInput.value.trim() || "multimodal";
  statusEl.textContent = "正在搜索...";
  totalBadgeEl.textContent = "";
  emptyTipsEl.classList.add("hidden");
  resultsEl.innerHTML = "";
  try {
    const res = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(q)}&max=20`));
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.error || "请求失败");
    }
    const papers = data.papers || [];
    statusEl.textContent = `关键词 "${q}"，共返回 ${papers.length} 篇`;
    totalBadgeEl.textContent = `${papers.length} Results`;
    if (!papers.length) {
      emptyTipsEl.classList.remove("hidden");
      return;
    }
    papers.forEach(paper => resultsEl.appendChild(createPaperCard(paper)));
  } catch (err) {
    statusEl.textContent = "搜索失败";
    emptyTipsEl.classList.remove("hidden");
    resultsEl.innerHTML = `<p class='muted'>错误：${(err && err.message) || "未知错误"}</p>`;
  }
}

searchForm.addEventListener("submit", async e => {
  e.preventDefault();
  await runSearch();
});

refreshFavoritesBtn.addEventListener("click", loadFavorites);

function renderQuickTags() {
  QUICK_TAGS.forEach(tag => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-btn";
    button.textContent = tag;
    button.addEventListener("click", async () => {
      queryInput.value = tag;
      await runSearch();
    });
    quickTagsEl.appendChild(button);
  });
}

(async function init() {
  renderQuickTags();
  queryInput.value = "multimodal model";
  await loadFavorites();
  await runSearch();
})();
