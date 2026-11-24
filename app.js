const $ = (selector) => document.querySelector(selector);
const categories = { cafe: "カフェ", food: "ごはん", sweet: "スイーツ" };
const samples = [
  { id: "sample-cafe", category: "cafe", name: "喫茶ひだまり", area: "駅前", note: "窓辺の席で、ラテと焼きたてのクロワッサン。" },
  { id: "sample-food", category: "food", name: "洋食キッチン こむぎ", area: "商店街", note: "ふわとろオムライスを食べたい日に。" },
  { id: "sample-sweet", category: "sweet", name: "いちごとクリーム", area: "公園の近く", note: "いちごのショートケーキで休憩。" },
];
const sampleById = new Map(samples.map((shop) => [shop.id, shop]));
const storageKey = "outing-deck:v1";
const sharePrefix = "#deck=";
const maximumTokenLength = 7500;

const state = readState();
let activeCategory = "all";
let editingId = null;
let drawnId = null;
let shared = null;
let toastTimer;

function cleaned(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.href.length <= 600) {
      return url.href;
    }
  } catch {
    return "";
  }
  return "";
}

function cleanShop(value) {
  if (!value || typeof value !== "object") return null;
  const name = cleaned(value.name, 80);
  const id = cleaned(value.id, 90);
  if (!name || !id || !Object.hasOwn(categories, value.category)) return null;
  return {
    id, name, category: value.category,
    area: cleaned(value.area, 50),
    note: cleaned(value.note, 140),
    url: safeUrl(value.url),
  };
}

function readState() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey)) ?? {};
  } catch {
    // Start with the sample list when browser storage is unavailable or invalid.
  }
  const shops = Array.isArray(saved.shops) ? saved.shops.map(cleanShop).filter((shop) => shop && !sampleById.has(shop.id)) : [];
  const ids = new Set([...shops, ...samples].map((shop) => shop.id));
  const selected = Array.isArray(saved.selected) ? [...new Set(saved.selected.filter((id) => ids.has(id)))] : [];
  return { shops, selected, hideSamples: saved.hideSamples === true };
}

function saveState(message = "") {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    if (message) notify(message);
  } catch {
    notify("このブラウザに保存できませんでした。変更はこの画面を開いている間だけ有効です。");
  }
}

function notify(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3800);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS(svg.namespaceURI, "use");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", "#i-" + name);
  svg.append(use);
  return svg;
}

function action(label, actionName, id, className, symbol) {
  const button = element("button", className);
  button.type = "button";
  button.dataset.action = actionName;
  button.dataset.id = id;
  if (symbol) button.append(icon(symbol));
  button.append(label);
  return button;
}

function shopById(id) {
  return state.shops.find((shop) => shop.id === id) ?? sampleById.get(id);
}

function deckShops() {
  return state.selected.map(shopById).filter(Boolean);
}

function normal(value) {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP");
}

function filteredShops() {
  const shops = state.hideSamples ? state.shops : [...state.shops, ...samples];
  const words = normal($("#search").value.trim()).split(/\s+/);
  return shops.filter((shop) => {
    const searchable = normal([shop.name, shop.area, shop.note, categories[shop.category]].join(" "));
    return (activeCategory === "all" || shop.category === activeCategory)
      && words.every((word) => searchable.includes(word));
  });
}

function photo(shop) {
  const frame = element("div", "card-photo card-photo--" + shop.category);
  if (sampleById.has(shop.id)) {
    const image = element("img");
    image.src = "./assets/" + shop.category + ".webp";
    image.alt = "";
    image.width = 640;
    image.height = 426;
    frame.append(image, element("span", "sample-label", "サンプル"));
  } else {
    frame.append(icon(shop.category));
  }
  const category = element("span", "category-pill");
  category.append(icon(shop.category), categories[shop.category]);
  frame.append(category);
  return frame;
}

function areaLabel(area) {
  const line = element("p", "card-area");
  if (area) line.append(icon("pin"), area);
  return line;
}

function pickButton(shop) {
  const picked = state.selected.includes(shop.id);
  const button = action(picked ? "候補に追加済み" : "候補に入れる", "pick", shop.id, "button button-outline pick-button", picked ? "check" : "plus");
  button.setAttribute("aria-pressed", String(picked));
  return button;
}

function shopCard(shop, mode = "local") {
  const card = element("article", "shop-card");
  const body = element("div", "card-body");
  if (shop.area) body.append(areaLabel(shop.area));
  body.append(element("h3", "", shop.name));
  if (shop.note) body.append(element("p", "card-note", shop.note));
  const actions = element("div", "card-actions");
  actions.append(action("詳細を見る", mode === "shared" ? "shared-details" : "details", shop.id, "text-button"));
  if (mode === "local") actions.append(pickButton(shop));
  body.append(actions);
  card.append(photo(shop), body);
  return card;
}

function renderHome() {
  const visible = filteredShops();
  $("#shop-total").textContent = visible.length + "件";
  $("#toggle-samples").textContent = state.hideSamples ? "サンプルを表示" : "サンプルを隠す";
  $("#shop-cards").replaceChildren(...visible.map((shop) => shopCard(shop)));
  const empty = $("#empty-list");
  empty.hidden = visible.length !== 0;
  empty.replaceChildren();
  $("#shuffle").disabled = visible.length === 0;
  if (!empty.hidden) {
    const hasFilter = activeCategory !== "all" || $("#search").value.trim();
    empty.append(element("p", "", hasFilter ? "条件に合うお店がありません。" : "気になるお店を1枚追加してみよう。"));
    empty.append(hasFilter
      ? action("絞り込みをリセット", "reset-filter", "", "button button-outline")
      : action("お店を追加", "add", "", "button button-primary", "plus"));
  }
}

function renderDeck() {
  const shops = deckShops();
  $("#deck-count").textContent = shops.length;
  $("#deck-description").textContent = shops.length
    ? shops.length + "件のお店が候補に入っています。"
    : "お店リストの「候補に入れる」を押すと、ここにカードが並びます。";
  const nodes = shops.map((shop) => {
    const item = element("li", "deck-item");
    const label = element("div");
    label.append(element("strong", "", shop.name));
    label.append(element("small", "", [categories[shop.category], shop.area].filter(Boolean).join(" · ")));
    const remove = action("", "remove-pick", shop.id, "icon-button", "close");
    remove.setAttribute("aria-label", shop.name + "をデッキから外す");
    item.append(icon(shop.category), label, remove);
    return item;
  });
  $("#deck-list").replaceChildren(...nodes);
  $("#draw-deck").disabled = shops.length === 0;
  $("#share-deck").disabled = shops.length === 0;
  $("#share-box").hidden = true;
  $("#share-note").textContent = "リンクを知っている人に、選んだお店の情報とメモが表示されます。";
}

function renderDraw() {
  const shop = shopById(drawnId);
  if (!shop) return;
  $("#draw-content").replaceChildren(shopCard(shop));
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function openEditor(shop) {
  if (shop && sampleById.has(shop.id)) return;
  const form = $("#shop-form");
  form.reset();
  editingId = shop?.id ?? null;
  $("#editor-title").textContent = shop ? "お店を編集" : "お店を追加";
  $("#editor-error").hidden = true;
  for (const field of ["name", "category", "area", "url", "note"]) {
    if (shop) form.elements.namedItem(field).value = shop[field] ?? "";
  }
  openDialog($("#editor"));
  form.elements.namedItem("name").focus();
}

function resetFilters() {
  activeCategory = "all";
  $("#search").value = "";
  document.querySelectorAll("[data-category]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.category === "all"));
  });
}

function openDetails(shop, fromShare) {
  if (!shop) return;
  $("#details-title").textContent = shop.name;
  const content = $("#details-content");
  const isSample = sampleById.has(shop.id);
  content.replaceChildren(photo(shop));
  if (shop.area) content.append(areaLabel(shop.area));
  if (shop.note) content.append(element("p", "card-note", shop.note));

  const actions = element("div", "dialog-actions");
  if (!isSample && !fromShare) {
    actions.append(action("削除", "delete", shop.id, "text-button danger-button"));
    actions.append(action("編集", "edit", shop.id, "button button-outline", "edit"));
  }
  if (!isSample) {
    const label = shop.url ? "お店のリンクを開く" : "Google マップで検索";
    const link = element("a", "button button-primary");
    link.append(icon("pin"), label);
    link.href = shop.url || "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([shop.name, shop.area].filter(Boolean).join(" "));
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    actions.append(link);
  }
  content.append(actions);
  openDialog($("#details"));
}

function togglePick(id) {
  if (!shopById(id)) return;
  state.selected = state.selected.includes(id) ? state.selected.filter((selected) => selected !== id) : [...state.selected, id];
  saveState(state.selected.includes(id) ? "今日のデッキに追加しました。" : "今日のデッキから外しました。");
  renderHome();
  renderDeck();
  if ($("#draw").open) renderDraw();
}

let drawSource = "list";
function drawOne(source) {
  const deck = source === "deck";
  const shops = deck ? deckShops() : filteredShops();
  if (!shops.length) return;
  const candidates = shops.length > 1 ? shops.filter((shop) => shop.id !== drawnId) : shops;
  drawSource = source;
  drawnId = candidates[Math.floor(Math.random() * candidates.length)].id;
  $("#draw-again").disabled = shops.length < 2;
  renderDraw();
  openDialog($("#draw"));
}

function encodeDeck(shops) {
  const payload = shops.map((shop) => sampleById.has(shop.id)
    ? [shop.id]
    : [shop.id, shop.name, shop.category, shop.area, shop.note, shop.url]);
  const bytes = new TextEncoder().encode(JSON.stringify([1, payload]));
  // Convert each byte independently so even a large local deck can be checked without a call-stack overflow.
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeDeck(token) {
  if (!token || token.length > maximumTokenLength || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const binary = atob(token.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const [version, rows] = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (version !== 1 || !Array.isArray(rows) || rows.length === 0) return null;
    const shops = rows.map((row) => {
      if (!Array.isArray(row)) return null;
      const [id, name, category, area, note, url] = row;
      if (row.length === 1) return sampleById.get(id) ?? null;
      if (sampleById.has(id)) return null;
      return cleanShop({ id, name, category, area, note, url });
    });
    const ids = new Set(shops.map((shop) => shop?.id));
    return shops.every(Boolean) && ids.size === shops.length ? shops : null;
  } catch {
    return null;
  }
}

async function copyDeck() {
  const shops = deckShops();
  if (!shops.length) return;
  const token = encodeDeck(shops);
  const note = $("#share-note");
  const input = $("#share-url");
  $("#share-box").hidden = false;
  input.hidden = token.length > maximumTokenLength;
  if (input.hidden) {
    note.textContent = "共有リンクが長すぎます。候補を減らしてからもう一度お試しください。";
    return;
  }

  const url = new URL(location.href);
  url.search = "";
  url.hash = sharePrefix + token;
  input.value = url.href;
  try {
    await navigator.clipboard.writeText(url.href);
    note.textContent = "コピーしました。選んだお店の情報とメモがリンク先に表示されます。";
  } catch {
    input.focus();
    input.select();
    note.textContent = "選択したリンクをコピーして送ってください。お店の情報とメモが表示されます。";
  }
}

function showLocation() {
  const wantsShare = location.hash.startsWith(sharePrefix);
  shared = wantsShare ? decodeDeck(location.hash.slice(sharePrefix.length)) : null;
  $("#shared-view").hidden = !wantsShare;
  $("#home-view").hidden = wantsShare;
  $("#shared-count").textContent = shared ? shared.length + "件のお店が候補に入っています。" : "共有リンクが無効か、途中で切れています。";
  $("#import-deck").hidden = !shared;
  $("#shared-cards").replaceChildren(...(shared ?? []).map((shop) => shopCard(shop, "shared")));
  if (!wantsShare) renderHome();
}

function importShared() {
  if (!shared) return;
  const matches = (left, right) => normal(left.name) === normal(right.name)
    && normal(left.area) === normal(right.area)
    && left.url === right.url;
  let added = 0;
  for (const shop of shared) {
    if (sampleById.has(shop.id)) {
      state.hideSamples = false;
      continue;
    }
    const sameId = shopById(shop.id);
    if ((sameId && matches(sameId, shop)) || state.shops.some((saved) => matches(saved, shop))) continue;
    state.shops.push({ ...shop, id: sameId ? crypto.randomUUID() : shop.id });
    added++;
  }
  resetFilters();
  saveState(added ? added + "件を自分のお店リストに保存しました。" : "自分のお店リストを開きました。");
  history.replaceState(null, "", location.pathname);
  showLocation();
  $("#collection-title").scrollIntoView({ block: "start" });
}

$("#shop-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const shop = cleanShop({ ...data, id: editingId ?? crypto.randomUUID() });
  if (!shop || (data.url.trim() && !shop.url)) {
    const error = $("#editor-error");
    error.textContent = !shop ? "店名を入力してください。" : "リンクは http:// または https:// ではじめてください。";
    error.hidden = false;
    event.currentTarget.elements.namedItem(!shop ? "name" : "url").focus();
    return;
  }
  const currentIndex = state.shops.findIndex(({ id }) => id === editingId);
  if (currentIndex >= 0) state.shops[currentIndex] = shop;
  else state.shops.unshift(shop);
  resetFilters();
  saveState(currentIndex >= 0 ? "お店の情報を更新しました。" : "お店を追加しました。");
  $("#editor").close();
  renderHome();
  renderDeck();
  if ($("#draw").open) renderDraw();
});

$("#add-shop").addEventListener("click", () => openEditor());
$("#open-deck").addEventListener("click", () => openDialog($("#deck")));
$("#shuffle").addEventListener("click", () => drawOne("list"));
$("#draw-deck").addEventListener("click", () => drawOne("deck"));
$("#draw-again").addEventListener("click", () => drawOne(drawSource));
$("#share-deck").addEventListener("click", copyDeck);
$("#import-deck").addEventListener("click", importShared);
$("#search").addEventListener("input", renderHome);
$("#toggle-samples").addEventListener("click", () => {
  state.hideSamples = !state.hideSamples;
  saveState();
  renderHome();
});
window.addEventListener("hashchange", showLocation);

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const { action: command, id, category } = button.dataset;
  if (button.hasAttribute("data-close")) {
    button.closest("dialog").close();
    return;
  }
  if (category) {
    activeCategory = category;
    document.querySelectorAll("[data-category]").forEach((filter) => {
      filter.setAttribute("aria-pressed", String(filter === button));
    });
    renderHome();
    return;
  }
  if (command === "reset-filter") {
    resetFilters();
    renderHome();
    $("#search").focus();
  }
  if (command === "add") openEditor();
  if (command === "details") openDetails(shopById(id), false);
  if (command === "shared-details") openDetails(shared?.find((shop) => shop.id === id), true);
  if (command === "edit") {
    $("#details").close();
    openEditor(shopById(id));
  }
  if (command === "delete") {
    const shop = shopById(id);
    if (!shop || sampleById.has(id) || !confirm("「" + shop.name + "」をお店リストから削除しますか？")) return;
    state.shops = state.shops.filter((value) => value.id !== id);
    state.selected = state.selected.filter((selected) => selected !== id);
    $("#details").close();
    if ($("#draw").open && drawnId === id) $("#draw").close();
    saveState("お店を削除しました。");
    renderHome();
    renderDeck();
  }
  if (command === "pick" || command === "remove-pick") {
    const context = button.closest("#draw") ?? button.closest("#deck") ?? $("#shop-cards");
    togglePick(id);
    const next = [...context.querySelectorAll("[data-action]")].find((item) => item.dataset.action === command && item.dataset.id === id);
    (next ?? context.querySelector("button:not(:disabled)"))?.focus();
  }
});

showLocation();
renderDeck();
