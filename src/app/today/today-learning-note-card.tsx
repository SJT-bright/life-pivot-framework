"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

import {
  usePersonalKnowledgeSubmission,
  type UsePersonalKnowledgeSubmissionOptions,
} from "@/app/knowledge/use-personal-knowledge-submission";
import type { PersonalKnowledgeSnapshot } from "@/modules/personal-knowledge/contracts";

interface TodayLearningNoteCardProps extends UsePersonalKnowledgeSubmissionOptions {
  readonly businessDate: string;
  readonly initial: PersonalKnowledgeSnapshot;
}

function defaultId(): string {
  return `daily-note-${crypto.randomUUID()}`;
}

export function TodayLearningNoteCard({
  businessDate,
  initial,
  request,
  storage,
  createId = defaultId,
  now,
}: TodayLearningNoteCardProps) {
  const submission = usePersonalKnowledgeSubmission({ request, storage, createId, now });
  const modules = useMemo(
    () => initial.modules.filter((module) => module.status !== "archived"),
    [initial.modules],
  );
  const [moduleId, setModuleId] = useState(modules[0]?.moduleId ?? "");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState("");
  const [personalUnderstanding, setPersonalUnderstanding] = useState("");
  const [openQuestions, setOpenQuestions] = useState("");
  const [application, setApplication] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    if (!moduleId || !title.trim() || !content.trim()) return;
    const snapshot = await submission.submit({
      type: "save-daily-learning-note",
      noteId: createId(),
      businessDate,
      title,
      moduleId,
      content,
      source,
      personalUnderstanding,
      openQuestions,
      application,
      expectedNoteRevision: 0,
    }, businessDate);
    if (snapshot) {
      setSaved(true);
      setTitle("");
      setContent("");
      setSource("");
      setPersonalUnderstanding("");
      setOpenQuestions("");
      setApplication("");
    }
  }

  return (
    <section className="today-learning-note-card" aria-labelledby="today-learning-note-heading">
      <div className="today-card-heading-row">
        <div>
          <h2 id="today-learning-note-heading">正式每日学习</h2>
        </div>
        <Link href={`/knowledge?date=${businessDate}`}>打开知识体系</Link>
      </div>

      {modules.length === 0 ? (
        <p>请先在知识体系中创建一个知识模块，再保存正式学习记录。</p>
      ) : (
        <form onSubmit={submit}>
          <label>
            所属知识模块
            <select value={moduleId} onChange={(event) => setModuleId(event.currentTarget.value)}>
              {modules.map((module) => (
                <option key={module.moduleId} value={module.moduleId}>{module.name}</option>
              ))}
            </select>
          </label>
          <label>
            学习标题
            <input value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
          </label>
          <label>
            学习内容
            <textarea value={content} onChange={(event) => setContent(event.currentTarget.value)} />
          </label>
          <details>
            <summary>补充来源、理解与实践</summary>
            <label>来源<input value={source} onChange={(event) => setSource(event.currentTarget.value)} /></label>
            <label>个人理解<textarea value={personalUnderstanding} onChange={(event) => setPersonalUnderstanding(event.currentTarget.value)} /></label>
            <label>未解问题<textarea value={openQuestions} onChange={(event) => setOpenQuestions(event.currentTarget.value)} /></label>
            <label>实际运用<textarea value={application} onChange={(event) => setApplication(event.currentTarget.value)} /></label>
          </details>
          <button disabled={!submission.canWrite || !moduleId || !title.trim() || !content.trim()} type="submit">
            保存正式学习记录
          </button>
        </form>
      )}

      {saved ? <p role="status">已保存到每日学习</p> : null}
      {submission.status === "uncertain" ? (
        <div role="alert">
          <p>结果尚未确认，请只重试原提交。</p>
          <button onClick={() => void submission.retry()} type="button">重试原提交</button>
        </div>
      ) : null}
      {submission.status === "reload-required" ? <p role="alert">数据已变化，请刷新页面后继续。</p> : null}
      {submission.status === "unavailable" ? <p role="alert">本地恢复存储不可用，当前无法安全提交。</p> : null}
    </section>
  );
}
