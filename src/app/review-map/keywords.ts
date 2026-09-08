export interface ReviewKeyword {
  readonly word: string;
  /** 出现过的天数（文档频次），用于节点大小和排序。 */
  readonly days: number;
}

// 只保留最高频的虚词单字，避免误杀“地图/时间/应用”这类实义词；
// 剩下的噪音组合靠“被长词包含”与出现频次排序压制。
const STOPWORD_CHARS = new Set([
  "的", "了", "呢", "吗", "吧", "啊", "呀", "哦", "嘛", "么", "之", "乎", "者",
  "是", "我", "你", "他", "她", "它", "们", "在", "有", "和", "与", "就", "都",
  "也", "又", "不", "没", "很", "此", "这", "那", "哪", "个", "被", "让", "给",
  "以", "于", "而", "及", "或", "但", "还", "再", "才", "只", "更", "最",
]);

const MIN_WORD_LENGTH = 2;
const MAX_WORD_LENGTH = 4;
const MAX_KEYWORDS = 24;
const MAX_KEYWORDS_PER_DAY = 3;

interface WordStat {
  days: number;
  freq: number;
}

function isCjk(word: string): boolean {
  return /^[\u4e00-\u9fff]+$/u.test(word);
}

function hasStopwordChar(word: string): boolean {
  for (const char of word) {
    if (STOPWORD_CHARS.has(char)) return true;
  }
  return false;
}

/**
 * 从复盘文本里提取高频关键词（无分词词典的轻量方案）：
 * 抽取连续中文片段里的 2-4 字组合，先按出现天数、再按总频次排序，
 * 最后过滤被更高频长词包含的短片段，减少重复概念。
 */
export function extractReviewKeywords(
  texts: readonly string[],
  maxKeywords = MAX_KEYWORDS,
): ReviewKeyword[] {
  const statsByWord = new Map<string, WordStat>();
  for (const text of texts) {
    // 用标点/空白/非中文字符切段，段内滑窗枚举 2-4 字组合。
    const segments = text.split(/[^\u4e00-\u9fff]+/u);
    const dayStats = new Map<string, number>();
    for (const segment of segments) {
      if (segment.length < MIN_WORD_LENGTH) continue;
      for (let length = MIN_WORD_LENGTH; length <= MAX_WORD_LENGTH; length += 1) {
        for (let start = 0; start + length <= segment.length; start += 1) {
          const word = segment.slice(start, start + length);
          if (hasStopwordChar(word)) continue;
          dayStats.set(word, (dayStats.get(word) ?? 0) + 1);
        }
      }
    }
    for (const [word, freq] of dayStats) {
      const stat = statsByWord.get(word) ?? { days: 0, freq: 0 };
      stat.days += 1;
      stat.freq += freq;
      statsByWord.set(word, stat);
    }
  }

  const candidates = [...statsByWord.entries()]
    .filter(([word]) => word.length >= MIN_WORD_LENGTH && isCjk(word))
    .sort((left, right) => {
      const byDays = right[1].days - left[1].days;
      if (byDays !== 0) return byDays;
      const byFreq = right[1].freq - left[1].freq;
      if (byFreq !== 0) return byFreq;
      if (right[0].length !== left[0].length) return right[0].length - left[0].length;
      return left[0].localeCompare(right[0]);
    });

  const picked: ReviewKeyword[] = [];
  for (const [word, stat] of candidates) {
    if (picked.length >= maxKeywords) break;
    if (picked.some((existing) => existing.word.includes(word))) continue;
    picked.push({ word, days: stat.days });
  }
  return picked;
}

/** 每天复盘的关键词（最多 maxPerDay 个），用于把日期节点连到关键词节点。 */
export function keywordsForReview(
  text: string,
  keywords: readonly ReviewKeyword[],
  maxPerDay = MAX_KEYWORDS_PER_DAY,
): string[] {
  const picked: string[] = [];
  for (const { word } of keywords) {
    if (picked.length >= maxPerDay) break;
    if (text.includes(word)) picked.push(word);
  }
  return picked;
}
