import { describe, expect, it } from "vitest";

import { extractReviewKeywords, keywordsForReview } from "./keywords";

describe("extractReviewKeywords", () => {
  it("ranks words that appear on more days first and drops stopword fragments", () => {
    const keywords = extractReviewKeywords([
      "复盘地图让我看见了自己的坚持，星图很有成就感",
      "继续打磨复盘地图，星图节点可以拖拽",
      "今天主要在写复盘地图的热力日历",
    ]);
    expect(keywords[0]?.word).toBe("复盘地图");
    expect(keywords[0]?.days).toBe(3);
    expect(keywords.every(({ word }) => !/[的了是在]/u.test(word))).toBe(true);
  });

  it("filters short or contained fragments to avoid duplicate concepts", () => {
    const keywords = extractReviewKeywords([
      "复盘地图复盘地图复盘地图",
    ], 6);
    const words = keywords.map(({ word }) => word);
    expect(words).toContain("复盘地图");
    // “复盘”被“复盘地图”包含，不应重复出现
    expect(words).not.toContain("复盘");
  });

  it("returns nothing for empty or punctuation-only text", () => {
    expect(extractReviewKeywords(["", "。！？ 123 abc"])).toEqual([]);
  });
});

describe("keywordsForReview", () => {
  it("picks at most the requested keywords present in the text", () => {
    const keywords = extractReviewKeywords([
      "复盘地图与星图节点",
      "热力日历的坚持",
    ], 10);
    const picked = keywordsForReview("今天完成了复盘地图的星图节点", keywords, 2);
    expect(picked).toHaveLength(2);
    expect(picked).toContain("复盘地图");
  });
});
