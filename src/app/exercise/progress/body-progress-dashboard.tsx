"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import type { ExerciseMuscleProgress, MuscleKey } from "@/modules/manual-exercise/training-metrics";

import styles from "./body-progress-dashboard.module.css";

const PROFILE_KEY = "life-pivot:exercise:bmi-profile:v1";

interface BodyProgressDashboardProps {
  readonly muscles: readonly ExerciseMuscleProgress[];
  readonly storage?: Pick<Storage, "getItem" | "setItem"> | null;
}

function scoreColor(progress: ExerciseMuscleProgress): string {
  if (progress.confidence === "none") return "rgba(121, 139, 130, 0.28)";
  if (progress.overallScore >= 75) return "#3f8f6c";
  if (progress.overallScore >= 50) return "#70aa8a";
  if (progress.overallScore >= 25) return "#c59c58";
  return "#9aa69f";
}

function scoreStyle(progress: ExerciseMuscleProgress): CSSProperties {
  return { "--muscle-fill": scoreColor(progress) } as CSSProperties;
}

function formatChange(value: number | null): string {
  if (value === null) return "数据不足";
  if (value === 0) return "持平";
  return `${value > 0 ? "+" : ""}${value}%`;
}

function confidenceLabel(value: ExerciseMuscleProgress["confidence"]): string {
  return { none: "暂无记录", limited: "样本较少", good: "趋势可参考" }[value];
}

function bmiCategory(value: number): string {
  if (value < 18.5) return "偏低范围";
  if (value < 25) return "常规范围";
  if (value < 30) return "超重范围";
  return "肥胖范围";
}

interface BodyHotspot {
  readonly key: MuscleKey;
  readonly side: "front" | "back";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotate?: number;
  readonly radius?: string;
  readonly clipPath?: string;
}

const BODY_HOTSPOTS: readonly BodyHotspot[] = [
  { key: "shoulders", side: "front", x: 18.8, y: 17.8, width: 5.5, height: 8.8, rotate: 12, radius: "62% 38% 48% 52%" },
  { key: "shoulders", side: "front", x: 32.9, y: 17.8, width: 5.5, height: 8.8, rotate: -12, radius: "38% 62% 52% 48%" },
  { key: "chest", side: "front", x: 23.0, y: 20.3, width: 5.2, height: 10.4, radius: "55% 42% 48% 62%" },
  { key: "chest", side: "front", x: 28.3, y: 20.3, width: 5.2, height: 10.4, radius: "42% 55% 62% 48%" },
  { key: "biceps", side: "front", x: 18.9, y: 25.1, width: 4.2, height: 13.6, rotate: 10 },
  { key: "biceps", side: "front", x: 34.2, y: 25.1, width: 4.2, height: 13.6, rotate: -10 },
  { key: "forearms", side: "front", x: 14.6, y: 38.2, width: 4.7, height: 15.0, rotate: 18 },
  { key: "forearms", side: "front", x: 38.0, y: 38.2, width: 4.7, height: 15.0, rotate: -18 },
  { key: "core", side: "front", x: 23.1, y: 29.7, width: 9.4, height: 20.1, radius: "32% 32% 45% 45%" },
  { key: "quadriceps", side: "front", x: 21.3, y: 49.4, width: 5.3, height: 18.0, rotate: 2, radius: "42% 42% 52% 52%" },
  { key: "quadriceps", side: "front", x: 29.1, y: 49.4, width: 5.3, height: 18.0, rotate: -2, radius: "42% 42% 52% 52%" },
  { key: "calves", side: "front", x: 21.6, y: 69.1, width: 4.4, height: 17.8, rotate: 2 },
  { key: "calves", side: "front", x: 29.8, y: 69.1, width: 4.4, height: 17.8, rotate: -2 },
  { key: "shoulders", side: "back", x: 62.5, y: 17.8, width: 5.6, height: 8.8, rotate: 12, radius: "62% 38% 48% 52%" },
  { key: "shoulders", side: "back", x: 76.0, y: 17.8, width: 5.6, height: 8.8, rotate: -12, radius: "38% 62% 52% 48%" },
  { key: "back", side: "back", x: 65.8, y: 18.8, width: 12.3, height: 26.4, clipPath: "polygon(18% 0, 50% 10%, 82% 0, 100% 34%, 78% 100%, 50% 84%, 22% 100%, 0 34%)" },
  { key: "triceps", side: "back", x: 61.8, y: 25.0, width: 4.3, height: 13.7, rotate: 10 },
  { key: "triceps", side: "back", x: 78.0, y: 25.0, width: 4.3, height: 13.7, rotate: -10 },
  { key: "forearms", side: "back", x: 57.6, y: 38.3, width: 4.7, height: 15.0, rotate: 18 },
  { key: "forearms", side: "back", x: 81.8, y: 38.3, width: 4.7, height: 15.0, rotate: -18 },
  { key: "glutes", side: "back", x: 66.2, y: 44.9, width: 5.7, height: 11.2, radius: "58% 42% 52% 48%" },
  { key: "glutes", side: "back", x: 72.1, y: 44.9, width: 5.7, height: 11.2, radius: "42% 58% 48% 52%" },
  { key: "hamstrings", side: "back", x: 65.4, y: 54.6, width: 5.2, height: 17.2, rotate: 2 },
  { key: "hamstrings", side: "back", x: 73.3, y: 54.6, width: 5.2, height: 17.2, rotate: -2 },
  { key: "calves", side: "back", x: 65.7, y: 70.4, width: 4.6, height: 17.6, rotate: 2 },
  { key: "calves", side: "back", x: 73.9, y: 70.4, width: 4.6, height: 17.6, rotate: -2 },
];

function BodyImageMap({
  muscles,
  selected,
  onSelect,
}: {
  readonly muscles: ReadonlyMap<MuscleKey, ExerciseMuscleProgress>;
  readonly selected: MuscleKey;
  readonly onSelect: (key: MuscleKey) => void;
}) {
  return (
    <figure className={styles.bodyMap}>
      <div aria-hidden="true" className={styles.bodyLabels}><span>正面</span><span>背面</span></div>
      <div className={styles.bodyStage}>
        <Image
          alt="医学训练假人正面与背面肌群进步图"
          className={styles.bodyImage}
          height={1024}
          sizes="(max-width: 900px) 100vw, 48vw"
          src="/assets/exercise/muscle-body-map-v2.png"
          width={1536}
        />
        {BODY_HOTSPOTS.map((hotspot, index) => {
          const progress = muscles.get(hotspot.key);
          if (!progress) return null;
          const hotspotStyle = {
            ...scoreStyle(progress),
            left: `${hotspot.x}%`,
            top: `${hotspot.y}%`,
            width: `${hotspot.width}%`,
            height: `${hotspot.height}%`,
            borderRadius: hotspot.radius,
            clipPath: hotspot.clipPath,
            transform: `rotate(${hotspot.rotate ?? 0}deg)`,
          } as CSSProperties;
          return (
            <button
              aria-label={`${progress.label}，综合训练指数 ${progress.overallScore}`}
              aria-pressed={selected === hotspot.key}
              className={`${styles.muscleHotspot}${selected === hotspot.key ? ` ${styles.selected}` : ""}`}
              key={`${hotspot.side}-${hotspot.key}-${index}`}
              onClick={() => onSelect(hotspot.key)}
              style={hotspotStyle}
              type="button"
            />
          );
        })}
      </div>
    </figure>
  );
}

function Meter({ label, value, unavailable = false }: { label: string; value: number; unavailable?: boolean }) {
  return (
    <div className={styles.meterRow}>
      <div><span>{label}</span><strong>{unavailable ? "—" : value}</strong></div>
      <div aria-label={`${label}${unavailable ? "数据不足" : ` ${value} 分`}`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={unavailable ? 0 : value} className={styles.meter} role="meter">
        <i style={{ width: `${unavailable ? 0 : value}%` }} />
      </div>
    </div>
  );
}

export function BodyProgressDashboard({ muscles, storage: providedStorage }: BodyProgressDashboardProps) {
  const muscleMap = useMemo(() => new Map(muscles.map((muscle) => [muscle.key, muscle])), [muscles]);
  const initialKey = muscles.find((muscle) => muscle.recentSets > 0)?.key ?? muscles[0]?.key ?? "shoulders";
  const [selectedKey, setSelectedKey] = useState<MuscleKey>(initialKey);
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const selected = muscleMap.get(selectedKey) ?? muscles[0];

  useEffect(() => {
    const storage = providedStorage === undefined ? window.localStorage : providedStorage;
    if (!storage) {
      setProfileLoaded(true);
      return;
    }
    try {
      const saved = JSON.parse(storage.getItem(PROFILE_KEY) ?? "null") as { heightCm?: unknown; weightKg?: unknown } | null;
      if (typeof saved?.heightCm === "number") setHeightCm(String(saved.heightCm));
      if (typeof saved?.weightKg === "number") setWeightKg(String(saved.weightKg));
    } catch {
      // Corrupt optional profile data should never block the training dashboard.
    }
    setProfileLoaded(true);
  }, [providedStorage]);

  useEffect(() => {
    if (!profileLoaded) return;
    const storage = providedStorage === undefined ? window.localStorage : providedStorage;
    if (!storage) return;
    const height = Number(heightCm);
    const weight = Number(weightKg);
    if (!Number.isFinite(height) || !Number.isFinite(weight) || height <= 0 || weight <= 0) return;
    try {
      storage.setItem(PROFILE_KEY, JSON.stringify({ heightCm: height, weightKg: weight }));
    } catch {
      // Calculating BMI remains available even if optional persistence is unavailable.
    }
  }, [heightCm, profileLoaded, providedStorage, weightKg]);

  const height = Number(heightCm);
  const weight = Number(weightKg);
  const bmi = height >= 100 && height <= 250 && weight >= 25 && weight <= 400
    ? Math.round(weight / ((height / 100) ** 2) * 10) / 10
    : null;

  if (!selected) return null;

  return (
    <section aria-labelledby="body-progress-heading" className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <p>最近 28 天</p>
          <h2 id="body-progress-heading">全身训练进步</h2>
        </div>
        <span>点击肌群查看力量与增肌刺激</span>
      </header>

      <div className={styles.mainGrid}>
        <div className={styles.figures}>
          <BodyImageMap muscles={muscleMap} onSelect={setSelectedKey} selected={selectedKey} />
        </div>

        <article aria-label={`${selected.label}进步详情`} className={styles.detail}>
          <header>
            <div><p>当前肌群</p><h3>{selected.label}</h3></div>
            <span data-confidence={selected.confidence}>{confidenceLabel(selected.confidence)}</span>
          </header>
          <div className={styles.scoreHero}>
            <strong>{selected.overallScore}</strong><span>/ 100 综合训练指数</span>
          </div>
          <Meter label="增肌刺激" value={selected.hypertrophyScore} />
          <Meter label="力量趋势" unavailable={selected.strengthScore === null} value={selected.strengthScore ?? 0} />
          <dl className={styles.facts}>
            <div><dt>28 天有效组</dt><dd>{selected.recentSets} 组</dd></div>
            <div><dt>训练次数</dt><dd>{selected.recentSessions} 次</dd></div>
            <div><dt>估算 1RM</dt><dd>{selected.bestE1rmKg === null ? "—" : `${selected.bestE1rmKg} kg`}</dd></div>
            <div><dt>力量变化</dt><dd>{formatChange(selected.strengthChangePercent)}</dd></div>
            <div><dt>负重容量</dt><dd>{selected.recentLoadVolumeKg === null ? "—" : `${selected.recentLoadVolumeKg} kg`}</dd></div>
            <div><dt>最近训练</dt><dd>{selected.lastTrainedAt ?? "—"}</dd></div>
          </dl>
          <p className={styles.actions}>
            {selected.actions.length > 0 ? selected.actions.join(" · ") : "还没有能关联到这个部位的动作"}
          </p>
        </article>
      </div>

      <div className={styles.lowerGrid}>
        <section aria-labelledby="bmi-heading" className={styles.bmiCard}>
          <div><p>身体指标</p><h3 id="bmi-heading">我的 BMI</h3></div>
          <div className={styles.bmiInputs}>
            <label>身高（cm）<input inputMode="decimal" max="250" min="100" onChange={(event) => setHeightCm(event.target.value)} type="number" value={heightCm} /></label>
            <label>体重（kg）<input inputMode="decimal" max="400" min="25" onChange={(event) => setWeightKg(event.target.value)} step="0.1" type="number" value={weightKg} /></label>
          </div>
          <output aria-live="polite" className={styles.bmiOutput}>
            {bmi === null ? <span>填写身高和体重后自动计算</span> : <><strong>{bmi}</strong><span>{bmiCategory(bmi)}</span></>}
          </output>
          <p className={styles.disclaimer}>BMI = kg ÷ m²，只是成人筛查指标，无法区分肌肉与脂肪，不参与训练进步评分。</p>
        </section>

        <details className={styles.algorithm}>
          <summary>查看评分算法</summary>
          <div>
            <p><strong>增肌刺激：</strong>周有效组数 60% + 负重容量趋势 25% + 每周频率 15%。主肌群计 1 组，辅助肌群计 0.5 组；默认目标为每肌群每周 10 组，达到后封顶。</p>
            <p><strong>力量趋势：</strong>同一动作的估算 1RM 变化 70% + 阻力重量变化 20% + 频率 10%。估算 1RM 只使用 1–10 次组，不能替代真实极限测试。</p>
            <p>这是训练日志趋势，不是实际肌肉增长率或医疗诊断。</p>
          </div>
        </details>
      </div>
    </section>
  );
}
