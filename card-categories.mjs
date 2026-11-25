import { normalized } from "./maps-import.mjs";

// Specific collections take precedence when an unfiltered card belongs to several lists.
const listCategories = [
  ["cafe", ["純喫茶", "喫茶店", "レトロ喫茶"]],
  ["cafe", ["紅茶", "紅茶専門店", "ティールーム"]],
  ["sweet", ["和菓子", "抹茶", "甘味処"]],
  ["sweet", ["パフェ", "かき氷", "アイス、ジェラート", "アイス", "ジェラート"]],
  ["cafe", ["クロワッサン", "ベーグル", "ベーカリー", "パン"]],
  ["cafe", ["サンドイッチ", "モーニング", "ブランチ"]],
  ["food", ["エビフライ", "天ぷら", "とんかつ", "ファストフード"]],
  ["food", ["そば", "うどん", "ヌードル", "ラーメン", "つけ麺"]],
  ["food", ["カレー", "スパイスカレー", "カレーライス", "辛"]],
  ["food", ["ハンバーグ", "焼き鳥・串焼き", "焼き鳥", "焼肉", "ステーキ", "肉"]],
  ["food", ["寿司", "魚", "海鮮"]],
  ["food", ["ピザ", "パスタ", "ナポリタン", "イタリアン"]],
  ["food", ["餃子", "中華", "点心"]],
  ["food", ["和食", "おにぎり", "定食", "日本料理"]],
  ["food", ["バル", "居酒屋", "バー", "ワインバー", "酒場"]],
  ["food", ["韓国料理", "異国料理", "タコス", "エスニック"]],
  ["food", ["オムライス", "洋食", "洋食屋"]],
  ["cafe", ["カフェ", "コーヒー・喫茶店", "コーヒー"]],
  ["sweet", ["スイーツ", "パティスリー", "プリン", "チーズケーキ", "キャロットケーキ",
    "チョコレート", "ホットケーキ", "焼き菓子", "ケーキ"]],
];

const categoryByList = new Map(listCategories.flatMap(([category, names], rank) =>
  names.map((name) => [normalized(name), { category, rank }]),
));

export function cardCategory(shop, preferredList = "") {
  const lists = shop.mapEntries ?? [];
  const preferred = lists.find(({ source }) => source === preferredList);
  let best = null;
  for (const { source } of lists) {
    const match = categoryByList.get(normalized(source));
    if (!match) continue;
    if (source === preferredList) {
      best = { ...match, source };
      break;
    }
    if (!best || match.rank < best.rank) best = { ...match, source };
  }
  const category = shop.category === "other" ? best?.category ?? "other" : shop.category;
  return { category, list: preferred?.source ?? best?.source ?? lists[0]?.source ?? "" };
}
