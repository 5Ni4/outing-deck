import { isSameMapPlace, loadTakeoutCsv, mapLink, normalized, planTakeout } from "./maps-import.mjs";
import { cardCategory } from "./card-categories.mjs";

const $ = (selector) => document.querySelector(selector);
const categories = { cafe: "カフェ", food: "ごはん", sweet: "スイーツ", other: "未分類" };
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
let visibleLimit = 48;
let editingId = null;
let drawnId = null;
let shared = null;
let toastTimer;
let mapImport = null;
let fileRead = 0;

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
  const name = cleaned(value.name, 256);
  const id = cleaned(value.id, 90);
  if (!name || !id || !Object.hasOwn(categories, value.category)) return null;
  const mapEntries = Array.isArray(value.mapEntries) ? value.mapEntries.filter((entry) =>
    entry && typeof entry.source === "string" && typeof entry.key === "string" && typeof entry.note === "string",
  ).map((entry) => ({
    source: cleaned(entry.source, 120),
    key: cleaned(entry.key, 1600),
    note: cleaned(entry.note, 2000),
  })) : [];
  return {
    id, name, category: value.category,
    area: cleaned(value.area, 50),
    note: cleaned(value.note, 140),
    url: safeUrl(value.url),
    mapUrl: mapLink(value.mapUrl),
    mapEntries,
    mapKeys: Array.isArray(value.mapKeys) ? value.mapKeys.filter((key) => typeof key === "string" && key.length <= 1200) : [],
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
  const trash = Array.isArray(saved.trash) ? saved.trash.map(cleanShop).filter((shop) => shop && !sampleById.has(shop.id)) : [];
  const mapLists = Array.isArray(saved.mapLists) ? saved.mapLists.map((name) => cleaned(name, 120)).filter(Boolean) : [];
  const ids = new Set([...shops, ...samples].map((shop) => shop.id));
  const selected = Array.isArray(saved.selected) ? [...new Set(saved.selected.filter((id) => ids.has(id)))] : [];
  return { shops, selected, trash, mapLists, hideSamples: saved.hideSamples === true };
}

function saveState(message = "") {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    if (message) notify(message);
  } catch {
    notify("このブラウザに保存できませんでした。変更はこの画面を開いている間だけ有効です。");
  }
}

function replaceStoredState(next) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    return false;
  }
  Object.assign(state, next);
  return true;
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
  const source = $("#maps-list-filter").value;
  return shops.filter((shop) => {
    if (source && !shop.mapEntries?.some((entry) => entry.source === source)) return false;
    const { category } = cardCategory(shop, source);
    if (activeCategory !== "all" && category !== activeCategory) return false;
    const lists = shop.mapEntries?.map((entry) => entry.source) ?? [];
    const searchable = normal([shop.name, shop.area, shop.note, categories[category], ...lists].join(" "));
    return words.every((word) => searchable.includes(word));
  });
}

function cardBadges(shop, preferredList) {
  const { category, list } = cardCategory(shop, preferredList);
  const badge = element("span", "category-pill category-pill--" + category);
  badge.append(icon(category === "other" ? "pin" : category), element("span", "", list || categories[category]));
  const labels = element("div", "card-labels");
  labels.append(badge);
  if (sampleById.has(shop.id)) labels.append(element("span", "sample-label", "サンプル"));
  return labels;
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

function shopCard(shop, { mode = "local", list = "" } = {}) {
  const card = element("article", "shop-card");
  const body = element("div", "card-body");
  body.append(cardBadges(shop, list), element("h3", "", shop.name));
  if (shop.area) body.append(areaLabel(shop.area));
  if (shop.note) body.append(element("p", "card-note", shop.note));
  const actions = element("div", "card-actions");
  actions.append(action("詳細を見る", mode === "shared" ? "shared-details" : "details", shop.id, "text-button"));
  if (mode === "local") actions.append(pickButton(shop));
  body.append(actions);
  card.append(body);
  return card;
}

function renderHome() {
  const listFilter = $("#maps-list-filter");
  const previousSource = listFilter.value;
  if (listFilter.options.length !== state.mapLists.length + 1
    || state.mapLists.some((name, index) => listFilter.options[index + 1]?.value !== name)) {
    listFilter.replaceChildren(new Option("すべてのリスト", ""), ...state.mapLists.map((name) => new Option(name, name)));
    listFilter.value = state.mapLists.includes(previousSource) ? previousSource : "";
  }
  listFilter.hidden = state.mapLists.length === 0;
  $('[data-category="other"]').hidden = activeCategory !== "other"
    && !state.shops.some((shop) => cardCategory(shop, listFilter.value).category === "other");
  const visible = filteredShops();
  $("#shop-total").textContent = visible.length + "件";
  $("#toggle-samples").textContent = state.hideSamples ? "サンプルを表示" : "サンプルを隠す";
  $("#shop-cards").replaceChildren(...visible.slice(0, visibleLimit).map((shop) =>
    shopCard(shop, { list: listFilter.value }),
  ));
  $("#show-more").hidden = visible.length <= visibleLimit;
  const empty = $("#empty-list");
  empty.hidden = visible.length !== 0;
  empty.replaceChildren();
  $("#shuffle").disabled = visible.length === 0;
  if (!empty.hidden) {
    const hasFilter = activeCategory !== "all" || listFilter.value || $("#search").value.trim();
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
    const { category, list } = cardCategory(shop);
    label.append(element("strong", "", shop.name));
    label.append(element("small", "", [list || categories[category], shop.area].filter(Boolean).join(" · ")));
    const remove = action("", "remove-pick", shop.id, "icon-button", "close");
    remove.setAttribute("aria-label", shop.name + "をデッキから外す");
    item.append(icon(category === "other" ? "pin" : category), label, remove);
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
  $("#draw-content").replaceChildren(shopCard(shop, { list: $("#maps-list-filter").value }));
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
  visibleLimit = 48;
  $("#maps-list-filter").value = "";
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
  content.replaceChildren();
  if (!shop.mapEntries?.length) content.append(cardBadges(shop));
  if (shop.area) content.append(areaLabel(shop.area));
  if (shop.note) content.append(element("p", "card-note", shop.note));
  if (!fromShare && shop.mapEntries?.length) {
    const sources = element("div", "maps-sources");
    sources.append(element("p", "muted", shop.mapEntries.map((entry) => entry.source).join(" / ")));
    const notes = shop.mapEntries.filter((entry) => entry.note);
    if (notes.length) {
      const privateNotes = element("details");
      privateNotes.append(element("summary", "", "Google マップのメモ（自分用）"));
      for (const { source, note } of notes) {
        privateNotes.append(element("strong", "", source), element("p", "card-note", note));
      }
      sources.append(privateNotes);
    }
    content.append(sources);
  }

  const actions = element("div", "dialog-actions");
  if (!isSample && !fromShare) {
    actions.append(action("削除", "delete", shop.id, "text-button danger-button"));
    actions.append(action("編集", "edit", shop.id, "button button-outline", "edit"));
  }
  if (!isSample) {
    const links = [];
    if (shop.url && shop.url !== shop.mapUrl) links.push(["お店のリンクを開く", shop.url]);
    if (shop.mapUrl) links.push(["Google マップで開く", shop.mapUrl]);
    if (!links.length) links.push(["Google マップで検索", "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([shop.name, shop.area].filter(Boolean).join(" "))]);
    for (const [label, url] of links) {
      const link = element("a", "button button-primary");
      link.append(icon("pin"), label);
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      actions.append(link);
    }
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
    : [shop.id, shop.name, shop.category, shop.area, shop.note, shop.url, shop.mapUrl || ""]);
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
      const [id, name, category, area, note, url, mapUrl] = row;
      if (row.length === 1) return sampleById.get(id) ?? null;
      if (sampleById.has(id)) return null;
      return cleanShop({ id, name, category, area, note, url, mapUrl });
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
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  const wantsShare = location.hash.startsWith(sharePrefix);
  shared = wantsShare ? decodeDeck(location.hash.slice(sharePrefix.length)) : null;
  $("#shared-view").hidden = !wantsShare;
  $("#home-view").hidden = wantsShare;
  $("#shared-count").textContent = shared ? shared.length + "件のお店が候補に入っています。" : "共有リンクが無効か、途中で切れています。";
  $("#import-deck").hidden = !shared;
  $("#shared-cards").replaceChildren(...(shared ?? []).map((shop) => shopCard(shop, { mode: "shared" })));
  if (!wantsShare) renderHome();
}

function importShared() {
  if (!shared) return;
  const matches = (left, right) => isSameMapPlace(left, right) || (normal(left.name) === normal(right.name)
    && normal(left.area) === normal(right.area)
    && left.url === right.url
    && left.mapUrl === right.mapUrl);
  let added = 0;
  for (const shop of shared) {
    if (sampleById.has(shop.id)) {
      state.hideSamples = false;
      continue;
    }
    if (state.trash.some((removed) => removed.id === shop.id || matches(removed, shop))) continue;
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

function renderTrash() {
  $("#trash-description").textContent = state.trash.length
    ? "復元するとお店リストに戻ります。今日のデッキにはもう一度追加できます。"
    : "ゴミ箱は空です。";
  const items = state.trash.map((shop) => {
    const row = element("li", "trash-item");
    const label = element("div");
    label.append(element("strong", "", shop.name));
    if (shop.area) label.append(element("p", "muted", shop.area));
    const restore = action("復元", "restore", shop.id, "button button-outline");
    restore.setAttribute("aria-label", shop.name + "を復元");
    row.append(label, restore);
    return row;
  });
  $("#trash-list").replaceChildren(...items);
}

function restoreShop(id) {
  const shop = state.trash.find((value) => value.id === id);
  if (!shop) return;
  if (!replaceStoredState({
    ...state, shops: [shop, ...state.shops], trash: state.trash.filter((value) => value.id !== id),
  })) {
    $("#trash-description").textContent = "復元できませんでした。ブラウザの保存領域を確認してください。";
    return;
  }
  renderHome();
  renderTrash();
  ($("#trash-list button") ?? $("#trash [data-close]")).focus();
  notify("お店リストに戻しました。");
}

const importLabels = { new: "新規", existing: "既存", review: "要確認", invalid: "対象外", removed: "ゴミ箱" };

function mapsError(message = "") {
  $("#maps-error").textContent = message;
  $("#maps-error").hidden = !message;
}

function clearMapsPreview() {
  fileRead++;
  mapImport = null;
  $("#maps-preview").hidden = true;
  $("#maps-apply-missing").checked = false;
  $("#preview-maps").disabled = false;
  mapsError();
}

function renderMapsPreview(focusIndex) {
  if (!mapImport) return;
  const { plan, choices } = mapImport;
  const counts = Object.fromEntries(Object.keys(importLabels).map((key) => [key, 0]));
  const rows = plan.results.map(({ row, label, possible, canAdd, hasRemovedName }) => {
    counts[label]++;
    const item = element("li", "import-row");
    item.append(element("span", "import-status import-status--" + label, importLabels[label]));
    const body = element("div", "import-row-body");
    body.append(element("strong", "", row.name || "名前のない項目"));
    if (label === "invalid") body.append(element("p", "muted", row.reason));
    if (label === "removed") body.append(element("p", "muted", "復元はゴミ箱からできます。"));
    if (hasRemovedName) body.append(element("p", "muted", "同名のお店がゴミ箱にあります。"));
    if (possible) {
      const link = element("a", "review-map-link", "取り込む場所をマップで確認");
      link.href = row.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const select = element("select");
      select.setAttribute("aria-label", (row.name || "項目") + "の取り込み方法");
      select.dataset.rowIndex = row.index;
      select.append(new Option("見送る", ""));
      if (canAdd) select.append(new Option("別店舗として追加", "new"));
      for (const candidate of possible) {
        const hint = candidate.area || candidate.mapUrl || candidate.url || "場所の登録なし";
        select.append(new Option(candidate.name + " に紐づける · " + hint, candidate.id));
      }
      select.value = choices.get(row.index) ?? "";
      body.append(link, select);
    }
    item.append(body);
    return item;
  });
  $("#maps-rows").replaceChildren(...rows);
  $("#maps-rows").hidden = !rows.length;
  const totals = Object.entries(counts).map(([key, count]) => importLabels[key] + " " + count + "件");
  $("#maps-summary").textContent = totals.join("  ·  ");
  $("#maps-review-help").hidden = !counts.review;
  const showMissing = plan.missing.length > 0;
  $("#maps-missing").hidden = !showMissing;
  $("#maps-missing-label").textContent = "リストから外れた可能性のあるお店 " + plan.missing.length + "件";
  $("#maps-missing-rows").replaceChildren(...plan.missing.map((shop) => element("li", "", shop.name)));
  const remove = $("#maps-apply-missing");
  remove.disabled = !plan.canRemoveMissing;
  if (remove.disabled) remove.checked = false;
  $("#maps-missing-help").textContent = plan.canRemoveMissing
    ? "カードと今日のデッキは残ります。"
    : "要確認・対象外の行があるため、この回はリストから外せません。";
  $("#apply-maps").disabled = !plan.changes.size && !remove.checked;
  $("#maps-preview").hidden = false;
  if (focusIndex !== undefined) $("[data-row-index='" + focusIndex + "']")?.focus();
}

function refreshMapsPlan() {
  mapImport.plan = planTakeout(mapImport.rows, state, mapImport.source, mapImport.choices);
}

$("#open-maps-import").addEventListener("click", () => {
  $("#maps-form").reset();
  clearMapsPreview();
  $("#maps-suggested-sources").replaceChildren(...state.mapLists.map((name) => new Option(name)));
  openDialog($("#maps-import"));
});
$("#maps-import").addEventListener("close", clearMapsPreview);
$("#maps-file").addEventListener("change", () => {
  clearMapsPreview();
  const file = $("#maps-file").files[0];
  if (file) $("#maps-source").value = file.name.replace(/\.csv$/i, "").slice(0, 120);
});
$("#maps-source").addEventListener("input", clearMapsPreview);
$("#maps-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMapsPreview();
  const file = $("#maps-file").files[0];
  const name = $("#maps-source").value.trim();
  if (!file || !/\.csv$/i.test(file.name) || file.size > 1_048_576 || !name) {
    mapsError("1 MBまでのCSVを選び、リスト名を入力してください。");
    return;
  }
  const ticket = fileRead;
  $("#preview-maps").disabled = true;
  try {
    const csv = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    if (ticket !== fileRead || !$("#maps-import").open) return;
    const rows = loadTakeoutCsv(csv);
    const current = readState();
    Object.assign(state, current);
    const source = state.mapLists.find((list) => normalized(list) === normalized(name)) ?? name;
    mapImport = { rows, source, choices: new Map(), baseline: JSON.stringify(current) };
    refreshMapsPlan();
    renderMapsPreview();
    $("#maps-preview-title").focus();
  } catch (error) {
    if (ticket === fileRead) mapsError(error instanceof TypeError ? "UTF-8のCSVを読み込めませんでした。" : error.message);
  } finally {
    if (ticket === fileRead) $("#preview-maps").disabled = false;
  }
});
$("#maps-rows").addEventListener("change", (event) => {
  const { rowIndex } = event.target.dataset;
  if (rowIndex === undefined || !mapImport) return;
  mapImport.choices.set(Number(rowIndex), event.target.value);
  refreshMapsPlan();
  renderMapsPreview(rowIndex);
});
$("#maps-apply-missing").addEventListener("change", (event) => {
  if (mapImport) $("#apply-maps").disabled = !mapImport.plan.changes.size && !event.target.checked;
});
$("#apply-maps").addEventListener("click", () => {
  if (!mapImport) return;
  const current = readState();
  if (JSON.stringify(current) !== mapImport.baseline) {
    Object.assign(state, current);
    mapImport.baseline = JSON.stringify(current);
    mapImport.choices.clear();
    $("#maps-apply-missing").checked = false;
    refreshMapsPlan();
    renderMapsPreview();
    renderHome();
    renderDeck();
    mapsError("別の画面でリストが更新されました。差分を確認し直してください。");
    return;
  }
  const { plan, source } = mapImport;
  const shops = new Map(state.shops.map((shop) => [shop.id, shop]));
  for (const [id, shop] of plan.changes) {
    const savedId = shops.has(id) ? id : crypto.randomUUID();
    shops.set(savedId, { ...shop, id: savedId });
  }
  if (plan.canRemoveMissing && $("#maps-apply-missing").checked) {
    for (const shop of plan.missing) {
      shops.set(shop.id, { ...shop, mapEntries: shop.mapEntries.filter((entry) => entry.source !== source) });
    }
  }
  const mapLists = state.mapLists.includes(source) ? state.mapLists : [...state.mapLists, source];
  if (!replaceStoredState({ ...state, shops: [...shops.values()], mapLists })) {
    mapsError("ブラウザに保存できませんでした。リストは更新されていません。");
    return;
  }
  resetFilters();
  $("#maps-import").close();
  renderHome();
  $("#maps-list-filter").value = source;
  renderHome();
  renderDeck();
  $("#collection-title").scrollIntoView({ block: "start" });
  notify("「" + source + "」を更新しました。");
});
$("#open-trash").addEventListener("click", () => {
  renderTrash();
  openDialog($("#trash"));
});

$("#shop-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const original = editingId ? shopById(editingId) : null;
  const shop = cleanShop({ ...original, ...data, id: editingId ?? crypto.randomUUID() });
  if (!shop || (data.url.trim() && !shop.url)) {
    const error = $("#editor-error");
    error.textContent = !shop ? "店名を入力してください。" : "リンクは http:// または https:// ではじめてください。";
    error.hidden = false;
    event.currentTarget.elements.namedItem(!shop ? "name" : "url").focus();
    return;
  }
  const place = { url: shop.url };
  const activeMatch = state.shops.some((saved) => saved.id !== shop.id && isSameMapPlace(saved, place));
  const trashMatch = state.trash.some((saved) => isSameMapPlace(saved, place));
  if ((activeMatch || trashMatch) && original?.url !== shop.url) {
    const error = $("#editor-error");
    error.textContent = activeMatch ? "同じ店舗を登録済みです。既存のカードを使ってください。"
      : "このお店はゴミ箱にあります。復元してください。";
    error.hidden = false;
    event.currentTarget.elements.namedItem("url").focus();
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
$("#search").addEventListener("input", () => {
  visibleLimit = 48;
  renderHome();
});
$("#maps-list-filter").addEventListener("change", () => {
  visibleLimit = 48;
  renderHome();
});
$("#show-more").addEventListener("click", () => {
  const firstNew = visibleLimit;
  visibleLimit += 48;
  renderHome();
  $("#shop-cards").children[firstNew]?.querySelector("button").focus();
});
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
    visibleLimit = 48;
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
  if (command === "restore") restoreShop(id);
  if (command === "delete") {
    const shop = shopById(id);
    if (!shop || sampleById.has(id) || !confirm("「" + shop.name + "」をゴミ箱に移しますか？ 今日のデッキからも外れます。")) return;
    if (!replaceStoredState({
      ...state,
      shops: state.shops.filter((value) => value.id !== id),
      selected: state.selected.filter((selected) => selected !== id),
      trash: [shop, ...state.trash],
    })) {
      notify("ゴミ箱へ移せませんでした。ブラウザの保存領域を確認してください。");
      return;
    }
    $("#details").close();
    if ($("#draw").open && drawnId === id) $("#draw").close();
    notify("ゴミ箱に移しました。");
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
