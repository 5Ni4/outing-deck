import { normalized } from "./maps-import.mjs";

// Specific collections take precedence when an unfiltered card belongs to several lists.
const listPhotos = [
  ["kissaten", "cafe", ["純喫茶", "喫茶店", "レトロ喫茶"]],
  ["tea", "cafe", ["紅茶", "紅茶専門店", "ティールーム"]],
  ["wagashi", "sweet", ["和菓子", "抹茶", "甘味処"]],
  ["frozen-dessert", "sweet", ["パフェ", "かき氷", "アイス、ジェラート", "アイス", "ジェラート"]],
  ["bread", "cafe", ["クロワッサン", "ベーグル", "ベーカリー", "パン"]],
  ["sandwich", "cafe", ["サンドイッチ", "モーニング", "ブランチ"]],
  ["fried-meal", "food", ["エビフライ", "天ぷら", "とんかつ", "ファストフード"]],
  ["noodles", "food", ["そば", "うどん", "ヌードル", "ラーメン", "つけ麺"]],
  ["curry", "food", ["カレー", "スパイスカレー", "カレーライス", "辛"]],
  ["grill", "food", ["ハンバーグ", "焼き鳥・串焼き", "焼き鳥", "焼肉", "ステーキ", "肉"]],
  ["sushi", "food", ["寿司", "魚", "海鮮"]],
  ["pizza-pasta", "food", ["ピザ", "パスタ", "ナポリタン", "イタリアン"]],
  ["dim-sum", "food", ["餃子", "中華", "点心"]],
  ["japanese-meal", "food", ["和食", "おにぎり", "定食", "日本料理"]],
  ["bar", "food", ["バル", "居酒屋", "バー", "ワインバー", "酒場"]],
  ["table", "food", ["韓国料理", "異国料理", "タコス", "エスニック"]],
  ["food", "food", ["オムライス", "洋食", "洋食屋"]],
  ["cafe", "cafe", ["カフェ", "コーヒー・喫茶店", "コーヒー"]],
  ["sweet", "sweet", ["スイーツ", "パティスリー", "プリン", "チーズケーキ", "キャロットケーキ",
    "チョコレート", "ホットケーキ", "焼き菓子", "ケーキ"]],
];

const photosByList = new Map(listPhotos.flatMap(([image, category, names], rank) =>
  names.map((name) => [normalized(name), { image, category, rank }]),
));
const defaults = { cafe: "cafe", food: "food", sweet: "sweet", other: "table" };

export function cardAppearance(shop, preferredList = "") {
  const lists = shop.mapEntries ?? [];
  const preferred = lists.find(({ source }) => source === preferredList);
  let best = null;
  for (const { source } of lists) {
    const photo = photosByList.get(normalized(source));
    if (!photo) continue;
    if (source === preferredList) {
      best = { ...photo, source };
      break;
    }
    if (!best || photo.rank < best.rank) best = { ...photo, source };
  }
  const image = best?.image ?? defaults[shop.category] ?? "table";
  const category = shop.category === "other" ? best?.category ?? "other" : shop.category;
  const file = Object.hasOwn(defaults, image) ? image : "card-photos/" + image;
  return { src: "./assets/" + file + ".webp", category, list: preferred?.source ?? best?.source ?? lists[0]?.source ?? "" };
}
