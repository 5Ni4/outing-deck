export function normalized(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ja-JP");
}

const googleDomains = new Set(["google.com", "google.co.jp", "google.co.uk", "google.com.au", "google.ca", "google.de", "google.fr", "google.it", "google.es", "google.com.tw", "google.co.kr"]);

export function mapLink(value) {
  try {
    const url = new URL(value);
    const { hostname, pathname } = url;
    const base = hostname.replace(/^(?:www|maps)\./, "");
    const isShort = (hostname === "maps.app.goo.gl" && /^\/[\w-]+\/?$/.test(pathname))
      || (hostname === "goo.gl" && /^\/maps\/[\w-]+\/?$/.test(pathname));
    const isRoot = /^\/maps\/?$/.test(pathname) || (hostname.startsWith("maps.") && pathname === "/");
    const hasQuery = ["q", "query", "cid", "ludocid", "query_place_id"].some((key) => !!url.searchParams.get(key));
    const isMaps = googleDomains.has(base) && (/^\/maps\/(?:place|search)(?:\/|$)/.test(pathname)
      || (isRoot && hasQuery));
    if (url.username || url.password || url.port || !["http:", "https:"].includes(url.protocol) || !(isMaps || isShort)) return "";
    url.protocol = "https:";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|entry$|g_ep$|g_st$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href.length <= 1200 ? url.href : "";
  } catch {
    return "";
  }
}

export function placeKeys(value) {
  const link = mapLink(value);
  if (!link) return [];
  const url = new URL(link);
  const keys = new Set();
  const place = url.searchParams.get("query_place_id") || url.searchParams.get("q")?.match(/^place_id:([\w-]+)$/)?.[1];
  if (place && /^[\w-]{6,200}$/.test(place)) keys.add("place:" + place);
  for (const name of ["cid", "ludocid"]) {
    const cid = url.searchParams.get(name);
    if (/^\d{1,20}$/.test(cid ?? "")) keys.add("cid:" + BigInt(cid));
  }
  const feature = url.pathname.match(/!1s0x[\da-f]+(?::|%3a)0x([\da-f]{1,16})(?=[!\/]|$)/i);
  if (feature) keys.add("cid:" + BigInt("0x" + feature[1]));
  if (url.hostname === "maps.app.goo.gl" || url.hostname === "goo.gl") {
    keys.add("short:" + url.hostname + url.pathname.replace(/\/$/, ""));
  }
  return [...keys];
}

function parseCsv(value) {
  const rows = [];
  let cells = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  for (let index = 0; index < value.length; index++) {
    const ch = value[index];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (value[index + 1] === '"') {
        cell += '"';
        index++;
      } else {
        quoted = false;
        closed = true;
      }
      continue;
    }
    if (ch === "," || ch === "\r" || ch === "\n") {
      cells.push(cell);
      cell = "";
      closed = false;
      if (ch === ",") continue;
      if (ch === "\r" && value[index + 1] === "\n") index++;
      rows.push(cells);
      cells = [];
      continue;
    }
    if (ch === '"' && cell === "" && !closed) {
      quoted = true;
      continue;
    }
    if (closed || ch === '"') throw new Error("CSVの引用符を読み取れません。Google Takeoutの元ファイルを選んでください。");
    cell += ch;
  }
  if (quoted) throw new Error("CSVの引用符が閉じていません。もう一度書き出してください。");
  if (cells.length || cell || closed) rows.push([...cells, cell]);
  return rows;
}

const headerFields = {
  name: ["title", "タイトル", "名称", "名前"],
  url: ["url", "item_content_url", "リンク", "場所のurl", "アイテムのurl", "項目のurl"],
  note: ["note", "メモ", "注記"],
};

export function loadTakeoutCsv(text) {
  if (text.includes("\ufffd") || text.includes("\u0000")) throw new Error("UTF-8のCSVを選んでください。");
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  let offset = 0;
  for (const line of source.split("\n", 30)) {
    let headings = [];
    try {
      headings = (parseCsv(line)[0] ?? []).map(normalized);
    } catch {
      // The optional collection description is free text before the header.
    }
    const columns = Object.fromEntries(Object.entries(headerFields).map(([field, names]) => [field, headings.findIndex((column) => names.includes(column))]));
    if (columns.name >= 0 && columns.url >= 0) {
      const rows = parseCsv(source.slice(offset + line.length + 1)).filter((row) => row.some((cell) => cell.trim()));
      if (rows.length > 1000) throw new Error("1つのリストにつき1,000件まで取り込めます。");
      return rows.map((cells, index) => {
        const name = cells[columns.name]?.trim() ?? "";
        const url = mapLink(cells[columns.url]);
        const note = cells[columns.note]?.trim() ?? "";
        const valid = name.length > 0 && name.length <= 256 && !!url && cells.length <= headings.length;
        return {
          index, name, url, note: note.slice(0, 2000), valid,
          reason: cells.length > headings.length ? "列数が見出しと合いません"
            : !url ? "Google マップの店舗リンクがありません" : "店名が空欄か、長すぎます",
        };
      });
    }
    offset += line.length + 1;
  }
  throw new Error("「タイトル」と「URL」列が見つかりません。Google Takeoutの「保存済み」CSVを選んでください。");
}

function listKey(row) {
  return normalized(row.name) + "\u0000" + row.url;
}

function track(index, key, id) {
  if (!index.has(key)) index.set(key, new Set());
  index.get(key).add(id);
}

function keysFor(shop) {
  return [...new Set([...(shop.mapKeys ?? []), ...placeKeys(shop.mapUrl), ...placeKeys(shop.url)])];
}

export function isSameMapPlace(left, right) {
  const rightKeys = new Set(keysFor(right));
  return keysFor(left).some((key) => rightKeys.has(key));
}

function mapEntry(row, source) {
  return { source, key: listKey(row), note: row.note };
}

export function planTakeout(rows, state, source, choices) {
  const places = new Map();
  const names = new Map();
  const removedNames = new Set();
  const importedRows = new Map();
  const active = new Map(state.shops.map((shop) => [shop.id, shop]));
  const archived = new Map(state.trash.map((shop) => [shop.id, shop]));
  const touched = new Set();
  const changes = new Map();

  function indexShop(shop, removed) {
    for (const key of keysFor(shop)) track(places, key, shop.id);
    for (const entry of shop.mapEntries ?? []) {
      if (entry.source === source) track(importedRows, entry.key, shop.id);
    }
    const name = normalized(shop.name);
    if (removed) removedNames.add(name);
    else track(names, name, shop.id);
  }

  for (const shop of active.values()) indexShop(shop, false);
  for (const shop of archived.values()) indexShop(shop, true);

  const results = rows.map((row) => {
    if (!row.valid) return { row, label: "invalid" };
    const keys = placeKeys(row.url);
    const exact = new Set(importedRows.get(listKey(row)));
    for (const key of keys) {
      for (const id of places.get(key) ?? []) exact.add(id);
    }
    if ([...exact].some((id) => archived.has(id))) return { row, label: "removed" };
    const name = normalized(row.name);
    const possible = exact.size ? [...exact] : [...(names.get(name) ?? [])];
    const hasRemovedName = !exact.size && removedNames.has(name);
    const choice = choices.get(row.index);
    let id;

    if (exact.size === 1) id = possible[0];
    else if ((possible.length || hasRemovedName) && !(choice === "new" && !exact.size)) {
      if (!possible.includes(choice)) return { row, label: "review", canAdd: !exact.size, hasRemovedName, possible: possible.map((candidate) => active.get(candidate)) };
      id = choice;
    }

    const isNew = !id;
    if (isNew) {
      id = "incoming:" + row.index;
      while (active.has(id) || archived.has(id)) id += ":";
    }
    const shop = active.get(id) ?? { id, name: row.name, category: "other", area: "", note: "", url: "" };
    const updated = {
      ...shop,
      mapUrl: row.url,
      mapKeys: [...new Set([...keysFor(shop), ...keys])],
      mapEntries: [...(shop.mapEntries ?? []).filter((entry) => entry.source !== source), mapEntry(row, source)],
    };
    active.set(id, updated);
    indexShop(updated, false);
    touched.add(id);
    changes.set(id, updated);
    return {
      row, label: isNew ? "new" : "existing", canAdd: !exact.size, hasRemovedName,
      possible: exact.size !== 1 && (possible.length || hasRemovedName) ? possible.map((candidate) => active.get(candidate)) : null,
    };
  });

  const missing = state.shops.filter((shop) => !touched.has(shop.id) && shop.mapEntries?.some((entry) => entry.source === source));
  const canRemoveMissing = missing.length > 0 && results.every(({ label }) => !["invalid", "review"].includes(label));
  return { results, changes, missing, canRemoveMissing };
}
