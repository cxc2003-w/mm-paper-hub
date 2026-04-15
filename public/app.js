const searchForm = document.getElementById("search-form");
const queryInput = document.getElementById("query");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const favoritesEl = document.getElementById("favorites");
const refreshFavoritesBtn = document.getElementById("refresh-favorites");
const exportFavoritesBtn = document.getElementById("export-favorites");
const cardTpl = document.getElementById("paper-card");
const quickTagsEl = document.getElementById("quick-tags");
const totalBadgeEl = document.getElementById("total-badge");
const emptyTipsEl = document.getElementById("empty-tips");
const lastUpdatedEl = document.getElementById("last-updated");
const autoRefreshEl = document.getElementById("auto-refresh");
const sseLiveEl = document.getElementById("sse-live");
const refreshIntervalEl = document.getElementById("refresh-interval");
const liveTipEl = document.getElementById("live-tip");
const sseStatusEl = document.getElementById("sse-status");
const pageSizeEl = document.getElementById("page-size");
const sortModeEl = document.getElementById("sort-mode");
const yearFilterEl = document.getElementById("year-filter");
const authorFilterEl = document.getElementById("author-filter");
const prevPageBtn = document.getElementById("prev-page");
const nextPageBtn = document.getElementById("next-page");
const pageIndicatorEl = document.getElementById("page-indicator");
const statPageCountEl = document.getElementById("stat-page-count");
const statFavCountEl = document.getElementById("stat-fav-count");
const statQueryEl = document.getElementById("stat-query");
const themeToggleEl = document.getElementById("theme-toggle");
const activeFiltersEl = document.getElementById("active-filters");

let favoriteIds = new Set();
let favoritesCache = [];
let currentPage = 1;
let currentPapers = [];
let autoRefreshTimer = null;
let streamSource = null;
let isSearching = false;
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

function formatTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

function renderSkeletons(count = 6) {
  resultsEl.innerHTML = "";
  for (let i = 0; i < count; i += 1) {
    const block = document.createElement("div");
    block.className = "skeleton";
    resultsEl.appendChild(block);
  }
}

function renderActiveFilters() {
  const chips = [];
  const yearInput = (yearFilterEl.value || "").trim();
  const authorInput = (authorFilterEl.value || "").trim();
  if (yearInput) chips.push(`年份: ${yearInput}`);
  if (authorInput) chips.push(`作者: ${authorInput}`);
  if (sortModeEl.value === "date_desc") chips.push("排序: 最新");
  if (sortModeEl.value === "date_asc") chips.push("排序: 最早");
  if (sortModeEl.value === "title_asc") chips.push("排序: 标题");
  chips.push(`每页: ${pageSizeEl.value}`);

  activeFiltersEl.innerHTML = "";
  chips.forEach(text => {
    const chip = document.createElement("span");
    chip.className = "filter-chip";
    chip.textContent = text;
    activeFiltersEl.appendChild(chip);
  });
}

function closeRealtimeStream() {
  if (streamSource) {
    streamSource.close();
    streamSource = null;
  }
  sseStatusEl.textContent = "实时: 关闭";
  sseStatusEl.classList.remove("live");
}

function openRealtimeStream() {
  closeRealtimeStream();
  if (!sseLiveEl.checked) return;

  const q = queryInput.value.trim() || "multimodal";
  const interval = Number(refreshIntervalEl.value || 60);
  const streamUrl = apiUrl(`/api/stream?q=${encodeURIComponent(q)}&interval=${interval}`);
  sseStatusEl.textContent = "实时: 连接中";

  streamSource = new EventSource(streamUrl);
  streamSource.onopen = () => {
    sseStatusEl.textContent = "实时: 已连接";
    sseStatusEl.classList.add("live");
  };
  streamSource.onerror = () => {
    sseStatusEl.textContent = "实时: 重连中";
    sseStatusEl.classList.remove("live");
  };
  streamSource.addEventListener("snapshot", event => {
    const data = JSON.parse(event.data || "{}");
    sseStatusEl.textContent = `实时: 监控 ${data.q || q}`;
    sseStatusEl.classList.add("live");
    liveTipEl.textContent = "实时通道已建立，等待新论文";
  });
  streamSource.addEventListener("tick", event => {
    const data = JSON.parse(event.data || "{}");
    sseStatusEl.textContent = `实时: 在线 ${formatTime(data.at || Date.now())}`;
    sseStatusEl.classList.add("live");
  });
  streamSource.addEventListener("new_papers", event => {
    const data = JSON.parse(event.data || "{}");
    const papers = Array.isArray(data.papers) ? data.papers : [];
    if (!papers.length) return;

    const merged = [...papers, ...currentPapers];
    const dedup = [];
    const seen = new Set();
    merged.forEach(paper => {
      if (!paper.id || seen.has(paper.id)) return;
      seen.add(paper.id);
      dedup.push(paper);
    });
    currentPapers = dedup;
    statusEl.textContent = `实时新增 ${papers.length} 篇论文`;
    lastUpdatedEl.textContent = `更新于 ${formatTime(Date.now())}`;
    liveTipEl.textContent = `刚收到 ${papers.length} 篇新论文`;
    renderResults();
    renderActiveFilters();
  });
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
  sub.textContent = `${(paper.authors || []).slice(0, 4).join(", ") || "未知作者"} | ${formatDate(paper.published)}`;
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
    await fetch(apiUrl(`/api/favorites/${encodeURIComponent(paper.id)}`), { method: "DELETE" });
    favoriteIds.delete(paper.id);
    root.remove();
    await loadFavorites();
  });

  return frag;
}

function getFilteredAndSortedPapers(papers) {
  const yearInput = (yearFilterEl.value || "").trim();
  const authorInput = (authorFilterEl.value || "").trim().toLowerCase();
  const sortMode = sortModeEl.value;

  let list = papers.filter(paper => {
    const paperYear = String(formatDate(paper.published)).slice(0, 4);
    const matchesYear = !yearInput || paperYear === yearInput;
    const matchesAuthor =
      !authorInput || (paper.authors || []).some(name => String(name).toLowerCase().includes(authorInput));
    return matchesYear && matchesAuthor;
  });

  if (sortMode === "date_desc") list.sort((a, b) => new Date(b.published) - new Date(a.published));
  if (sortMode === "date_asc") list.sort((a, b) => new Date(a.published) - new Date(b.published));
  if (sortMode === "title_asc") list.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  return list;
}

function renderResults() {
  const list = getFilteredAndSortedPapers(currentPapers);
  resultsEl.innerHTML = "";
  emptyTipsEl.classList.add("hidden");

  if (!list.length) {
    totalBadgeEl.textContent = "0 Results";
    statPageCountEl.textContent = "0";
    emptyTipsEl.classList.remove("hidden");
    return;
  }

  list.forEach(paper => resultsEl.appendChild(createPaperCard(paper)));
  totalBadgeEl.textContent = `${list.length} Results`;
  statPageCountEl.textContent = String(list.length);
}

async function loadFavorites() {
  try {
    const res = await fetch(apiUrl("/api/favorites"));
    const data = await res.json();
    const items = data.items || [];
    favoritesCache = items;
    favoriteIds = new Set(items.map(item => item.id));
    statFavCountEl.textContent = String(items.length);

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
  if (isSearching) return;
  isSearching = true;
  const q = queryInput.value.trim() || "multimodal";
  const pageSize = Number(pageSizeEl.value || 20);
  const start = (currentPage - 1) * pageSize;

  statusEl.textContent = "正在搜索...";
  pageIndicatorEl.textContent = `第 ${currentPage} 页`;
  statQueryEl.textContent = q;
  totalBadgeEl.textContent = "";
  emptyTipsEl.classList.add("hidden");
  renderSkeletons(Math.min(pageSize, 8));

  try {
    const url = apiUrl(`/api/search?q=${encodeURIComponent(q)}&start=${start}&max=${pageSize}`);
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || "请求失败");

    currentPapers = data.papers || [];
    statusEl.textContent = `关键词 "${q}"，返回 ${currentPapers.length} 篇`;
    if (!currentPapers.length) {
      totalBadgeEl.textContent = "0 Results";
      statPageCountEl.textContent = "0";
      emptyTipsEl.classList.remove("hidden");
      return;
    }
    renderResults();
    renderActiveFilters();
    lastUpdatedEl.textContent = `更新于 ${formatTime(Date.now())}`;
  } catch (err) {
    statusEl.textContent = "搜索失败";
    statPageCountEl.textContent = "0";
    emptyTipsEl.classList.remove("hidden");
    resultsEl.innerHTML = `<p class='muted'>错误：${(err && err.message) || "未知错误"}</p>`;
  } finally {
    isSearching = false;
  }
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function setupAutoRefresh() {
  stopAutoRefresh();
  if (sseLiveEl.checked) {
    liveTipEl.textContent = "实时模式已开启（自动刷新已关闭）";
    return;
  }
  if (!autoRefreshEl.checked) {
    liveTipEl.textContent = "关闭（手动搜索）";
    return;
  }
  const seconds = Number(refreshIntervalEl.value || 60);
  liveTipEl.textContent = `开启（每 ${seconds} 秒自动刷新）`;
  autoRefreshTimer = setInterval(async () => {
    await runSearch();
    await loadFavorites();
  }, seconds * 1000);
}

function exportFavorites() {
  const blob = new Blob([JSON.stringify(favoritesCache, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "favorites.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

searchForm.addEventListener("submit", async e => {
  e.preventDefault();
  currentPage = 1;
  await runSearch();
  openRealtimeStream();
});

refreshFavoritesBtn.addEventListener("click", loadFavorites);
exportFavoritesBtn.addEventListener("click", exportFavorites);
autoRefreshEl.addEventListener("change", setupAutoRefresh);
sseLiveEl.addEventListener("change", () => {
  if (sseLiveEl.checked) {
    autoRefreshEl.checked = false;
    liveTipEl.textContent = "正在建立实时连接...";
  }
  setupAutoRefresh();
  openRealtimeStream();
});
refreshIntervalEl.addEventListener("change", () => {
  setupAutoRefresh();
  openRealtimeStream();
});
sortModeEl.addEventListener("change", () => {
  renderResults();
  renderActiveFilters();
});
yearFilterEl.addEventListener("input", () => {
  renderResults();
  renderActiveFilters();
});
authorFilterEl.addEventListener("input", () => {
  renderResults();
  renderActiveFilters();
});
pageSizeEl.addEventListener("change", async () => {
  currentPage = 1;
  renderActiveFilters();
  await runSearch();
  openRealtimeStream();
});
prevPageBtn.addEventListener("click", async () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  await runSearch();
  openRealtimeStream();
});
nextPageBtn.addEventListener("click", async () => {
  currentPage += 1;
  await runSearch();
  openRealtimeStream();
});

function renderQuickTags() {
  QUICK_TAGS.forEach(tag => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-btn";
    button.textContent = tag;
    button.addEventListener("click", async () => {
      queryInput.value = tag;
      currentPage = 1;
      await runSearch();
      openRealtimeStream();
    });
    quickTagsEl.appendChild(button);
  });
}

function applyTheme(theme) {
  const light = theme === "light";
  document.body.classList.toggle("light", light);
  localStorage.setItem("mm-theme", light ? "light" : "dark");
}

themeToggleEl.addEventListener("click", () => {
  const isLight = document.body.classList.contains("light");
  applyTheme(isLight ? "dark" : "light");
});

window.addEventListener("beforeunload", closeRealtimeStream);

(async function init() {
  applyTheme(localStorage.getItem("mm-theme") || "dark");
  renderQuickTags();
  renderActiveFilters();
  queryInput.value = "multimodal model";
  statFavCountEl.textContent = "0";
  statPageCountEl.textContent = "0";
  statQueryEl.textContent = queryInput.value;
  await loadFavorites();
  await runSearch();
  setupAutoRefresh();
  openRealtimeStream();
})();
 
