import { connection } from "next/server";

import { getApplicationDatabase } from "@/core/db/application-database";
import { isBusinessDate, toShanghaiBusinessDate } from "@/core/time/business-date";
import {
  getPersonalKnowledgeSnapshot,
  getRecentLearningNotes,
} from "@/modules/personal-knowledge/query";
import { FeishuDailyImportHeaderTools } from "@/app/today/feishu-daily-import";

import { PersonalKnowledgeWorkspace } from "./personal-knowledge-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_NOTES_PAGE_SIZE = 20;

interface KnowledgePageProps {
  readonly searchParams: Promise<{ readonly date?: string | string[]; readonly notePage?: string | string[] }>;
}

function UnavailableKnowledgePage() {
  return (
    <main className="page-shell knowledge-page personal-knowledge-page">
      <section className="personal-knowledge-unavailable" role="status">
        <h1>个人知识暂时无法读取</h1>
        <p>请稍后重新加载。现有数据不会因此被修改。</p>
      </section>
    </main>
  );
}

export default async function KnowledgePage({ searchParams }: KnowledgePageProps) {
  await connection();
  const today = toShanghaiBusinessDate(new Date());
  const query = await searchParams;
  const selectedDate = query.date ?? today;
  if (typeof selectedDate !== "string" || !isBusinessDate(selectedDate) || selectedDate > today) {
    return <UnavailableKnowledgePage />;
  }
  const notePage = typeof query.notePage === "string" && /^\d+$/.test(query.notePage)
    ? Math.max(1, Number(query.notePage))
    : 1;

  try {
    const database = getApplicationDatabase();
    const initial = getPersonalKnowledgeSnapshot(database.sqlite, { businessDate: selectedDate });
    let recentNotes: Awaited<ReturnType<typeof getRecentLearningNotes>> | null = null;
    try {
      recentNotes = getRecentLearningNotes(database.sqlite, {
        page: notePage,
        pageSize: RECENT_NOTES_PAGE_SIZE,
      });
    } catch {
      recentNotes = null;
    }

    return (
      <main className="page-shell knowledge-page personal-knowledge-page">
        <div className="knowledge-feishu-tools">
          <FeishuDailyImportHeaderTools businessDate={selectedDate}>
            <span aria-hidden="true" />
          </FeishuDailyImportHeaderTools>
        </div>
        <PersonalKnowledgeWorkspace initial={initial} today={today} />
        {recentNotes ? (
          <section aria-labelledby="recent-notes-heading" className="recent-learning-notes">
            <h2 id="recent-notes-heading">全部学习记录</h2>
            <p className="recent-learning-notes-lead">共 {recentNotes.total} 条</p>
            {recentNotes.items.length === 0 ? (
              <p>暂无学习记录。</p>
            ) : (
              <ul>
                {recentNotes.items.map((note) => (
                  <li key={note.noteId}>
                    <a href={`/knowledge?date=${note.businessDate}`}>{note.businessDate}</a>
                    <div>
                      <strong>{note.title || "学习记录"}</strong>
                      <span>{note.moduleName}</span>
                      {note.snippet ? <p>{note.snippet}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {recentNotes.total > recentNotes.pageSize ? (
              <nav aria-label="学习记录分页" className="recent-learning-pager">
                {recentNotes.page > 1 ? (
                  <a
                    href={`/knowledge?date=${selectedDate}&notePage=${recentNotes.page - 1}`}
                  >
                    上一页
                  </a>
                ) : <span />}
                <span>
                  第 {recentNotes.page} / {Math.ceil(recentNotes.total / recentNotes.pageSize)} 页
                </span>
                {recentNotes.page * recentNotes.pageSize < recentNotes.total ? (
                  <a
                    href={`/knowledge?date=${selectedDate}&notePage=${recentNotes.page + 1}`}
                  >
                    下一页
                  </a>
                ) : <span />}
              </nav>
            ) : null}
          </section>
        ) : null}
      </main>
    );
  } catch {
    return <UnavailableKnowledgePage />;
  }
}
