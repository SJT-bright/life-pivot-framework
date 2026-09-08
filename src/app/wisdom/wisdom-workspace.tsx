"use client";

import { useEffect, useRef, useState } from "react";

import {
  clearLocalDraft,
  readLocalDraft,
  scheduleDraftWrite,
} from "@/app/accumulation/local-draft";
import type { WisdomReminder } from "@/modules/wisdom-reminders/contracts";

export interface WisdomWorkspaceProps {
  readonly initial: readonly WisdomReminder[];
  readonly request?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly createId?: () => string;
}

interface AddDraft {
  content: string;
  context: string;
}

const ADD_DRAFT_KEY = "wisdom-add-draft";

function newestFirst(items: readonly WisdomReminder[]): WisdomReminder[] {
  return [...items].sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt)
    || right.updatedAt.localeCompare(left.updatedAt)
    || right.id.localeCompare(left.id)
  ));
}

function isReminder(value: unknown): value is WisdomReminder {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && typeof record.content === "string"
    && typeof record.context === "string"
    && typeof record.revision === "number";
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function WisdomWorkspace({
  initial,
  request = fetch,
  createId = () => `wisdom-${crypto.randomUUID()}`,
}: WisdomWorkspaceProps) {
  const [reminders, setReminders] = useState<readonly WisdomReminder[]>(
    () => newestFirst(initial),
  );
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<AddDraft>(() => {
    const draft = readLocalDraft<AddDraft>(ADD_DRAFT_KEY);
    return draft && typeof draft.content === "string" && typeof draft.context === "string"
      ? draft
      : { content: "", context: "" };
  });
  const [draftRestored, setDraftRestored] = useState(() => {
    const draft = readLocalDraft<AddDraft>(ADD_DRAFT_KEY);
    return Boolean(draft && (draft.content?.trim() || draft.context?.trim()));
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editContext, setEditContext] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const addContentRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => scheduleDraftWrite(ADD_DRAFT_KEY, addDraft), [addDraft]);

  async function execute(command: unknown, purpose: string): Promise<boolean> {
    setSaving(true);
    setStatus(null);
    try {
      const response = await request("/api/v1/wisdom-reminders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `${purpose}-${crypto.randomUUID()}`,
        },
        body: JSON.stringify(command),
      });
      const payload = await response.json() as { result?: unknown; message?: string };
      if (!response.ok || !isReminder(payload.result)) {
        setStatus(payload.message ?? "保存失败，请再试一次。");
        return false;
      }
      const saved = payload.result;
      setReminders((current) => {
        if (saved.archivedAt !== null) {
          return current.filter((item) => item.id !== saved.id);
        }
        const rest = current.filter((item) => item.id !== saved.id);
        return newestFirst([saved, ...rest]);
      });
      return true;
    } catch {
      setStatus("没有收到本地服务的回应，请确认软件仍在运行后重试。");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submitAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = addDraft.content.trim();
    if (!content) {
      setStatus("先写下这句话本身。");
      return;
    }
    const saved = await execute({
      type: "create-wisdom-reminder",
      reminderId: createId(),
      content,
      context: addDraft.context.trim(),
    }, "wisdom-create");
    if (!saved) return;
    clearLocalDraft(ADD_DRAFT_KEY);
    setAddDraft({ content: "", context: "" });
    setDraftRestored(false);
    setStatus("已记下这条提醒。");
  }

  function beginEdit(reminder: WisdomReminder) {
    setEditingId(reminder.id);
    setEditContent(reminder.content);
    setEditContext(reminder.context);
    setConfirmingDeleteId(null);
  }

  async function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reminder = reminders.find((item) => item.id === editingId);
    if (!reminder) return;
    const content = editContent.trim();
    if (!content) {
      setStatus("提醒内容不能为空。");
      return;
    }
    const saved = await execute({
      type: "update-wisdom-reminder",
      reminderId: reminder.id,
      content,
      context: editContext.trim(),
      expectedRevision: reminder.revision,
    }, "wisdom-update");
    if (!saved) return;
    setEditingId(null);
    setStatus("已更新这条提醒。");
  }

  async function remove(reminder: WisdomReminder) {
    const saved = await execute({
      type: "archive-wisdom-reminder",
      reminderId: reminder.id,
      expectedRevision: reminder.revision,
    }, "wisdom-archive");
    if (!saved) return;
    setConfirmingDeleteId(null);
    setStatus("已删除这条提醒。");
  }

  return (
    <section aria-label="提醒库" className="wisdom-workspace">
      <details
        className="wisdom-add"
        onToggle={(event) => {
          const details = event.currentTarget;
          setAddOpen(details.open);
          if (details.open) window.setTimeout(() => addContentRef.current?.focus(), 0);
        }}
        open={draftRestored || addOpen || undefined}
      >
        <summary>
          {addOpen ? "收起添加提醒" : draftRestored ? "＋ 继续写提醒（有草稿）" : "＋ 添加提醒"}
        </summary>
        <form className="wisdom-add-form" onSubmit={submitAdd}>
          <label htmlFor="wisdom-add-content">提醒内容（一句话）</label>
          <textarea
            aria-label="提醒内容"
            id="wisdom-add-content"
            maxLength={500}
            onChange={(event) => setAddDraft((current) => ({ ...current, content: event.target.value }))}
            placeholder="例如：先处理情绪，再处理事情。"
            ref={addContentRef}
            rows={3}
            value={addDraft.content}
          />
          <label htmlFor="wisdom-add-context">来源 / 为什么有用（可选）</label>
          <input
            aria-label="来源或为什么有用"
            id="wisdom-add-context"
            maxLength={2000}
            onChange={(event) => setAddDraft((current) => ({ ...current, context: event.target.value }))}
            placeholder="例如：某次访谈里听到的；以后遇事先停三秒"
            value={addDraft.context}
          />
          <button disabled={saving || addDraft.content.trim().length === 0} type="submit">
            {saving ? "正在保存" : "记下这条提醒"}
          </button>
          {draftRestored ? (
            <p className="wisdom-draft-note" role="status">已恢复上次未保存的草稿；保存后自动清除。</p>
          ) : null}
        </form>
      </details>

      {status ? <p aria-live="polite" className="wisdom-status" role="status">{status}</p> : null}

      {reminders.length === 0 ? (
        <p className="wisdom-empty">还没有提醒。点上面的「＋ 添加提醒」，把那句有用的话记下来。</p>
      ) : (
        <ul className="wisdom-list">
          {reminders.map((reminder) => (
            <li className="wisdom-card" key={reminder.id}>
              {editingId === reminder.id ? (
                <form className="wisdom-edit-form" onSubmit={submitEdit}>
                  <textarea
                    aria-label={`编辑提醒：${reminder.content}`}
                    maxLength={500}
                    onChange={(event) => setEditContent(event.target.value)}
                    rows={3}
                    value={editContent}
                  />
                  <input
                    aria-label={`编辑来源：${reminder.content}`}
                    maxLength={2000}
                    onChange={(event) => setEditContext(event.target.value)}
                    placeholder="来源 / 为什么有用（可选）"
                    value={editContext}
                  />
                  <div className="wisdom-card-actions">
                    <button disabled={saving} type="submit">保存修改</button>
                    <button disabled={saving} onClick={() => setEditingId(null)} type="button">取消</button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="wisdom-content">{reminder.content}</p>
                  {reminder.context ? <p className="wisdom-context">{reminder.context}</p> : null}
                  <div className="wisdom-card-actions">
                    <time dateTime={reminder.createdAt}>{formatDate(reminder.createdAt)} 记</time>
                    <button disabled={saving} onClick={() => beginEdit(reminder)} type="button">编辑</button>
                    {confirmingDeleteId === reminder.id ? (
                      <>
                        <button
                          className="wisdom-delete-confirm"
                          disabled={saving}
                          onClick={() => void remove(reminder)}
                          type="button"
                        >
                          确认删除
                        </button>
                        <button disabled={saving} onClick={() => setConfirmingDeleteId(null)} type="button">再想想</button>
                      </>
                    ) : (
                      <button
                        disabled={saving}
                        onClick={() => setConfirmingDeleteId(reminder.id)}
                        type="button"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
