import type { DomainSubnavItem } from "@/app/_components/domain-subnav";

export const exerciseNavigationItems = [
  { key: "today", label: "今日训练", href: "/exercise" },
  { key: "trends", label: "成长曲线", href: "/exercise/trends" },
  { key: "template", label: "训练日模板", href: "/exercise/template" },
  { key: "history", label: "训练历史", href: "/exercise/history" },
  { key: "updates", label: "模板更新记录", href: "/exercise/updates" },
  { key: "progress", label: "进步可视化", href: "/exercise/progress" },
] as const satisfies readonly DomainSubnavItem[];
