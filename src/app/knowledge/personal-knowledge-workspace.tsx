"use client";

import { useMemo, useState, type FormEvent } from "react";

import type {
  DailyLearningNote,
  PersonalKnowledgeCommand,
  PersonalKnowledgeModule,
  PersonalKnowledgeSnapshot,
} from "@/modules/personal-knowledge/contracts";

import {
  usePersonalKnowledgeSubmission,
  type UsePersonalKnowledgeSubmissionOptions,
} from "./use-personal-knowledge-submission";

type WorkspaceTab = "daily" | "modules";

export interface PersonalKnowledgeWorkspaceProps extends UsePersonalKnowledgeSubmissionOptions {
  readonly initial: PersonalKnowledgeSnapshot;
  readonly today: string;
}

interface ModuleRow {
  readonly module: PersonalKnowledgeModule;
  readonly depth: number;
}

interface ModuleTreeNode {
  readonly module: PersonalKnowledgeModule;
  readonly children: readonly ModuleTreeNode[];
}

function moduleTree(modules: readonly PersonalKnowledgeModule[]): ModuleTreeNode[] {
  const active = modules.filter((module) => module.status !== "archived");
  const children = new Map<string | null, PersonalKnowledgeModule[]>();
  for (const module of active) {
    const siblings = children.get(module.parentModuleId) ?? [];
    siblings.push(module);
    children.set(module.parentModuleId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.ordinal - right.ordinal || left.moduleId.localeCompare(right.moduleId));
  }
  const seen = new Set<string>();
  const build = (parentModuleId: string | null, ancestors: ReadonlySet<string>): ModuleTreeNode[] => {
    const nodes: ModuleTreeNode[] = [];
    for (const module of children.get(parentModuleId) ?? []) {
      if (seen.has(module.moduleId) || ancestors.has(module.moduleId)) continue;
      seen.add(module.moduleId);
      const lineage = new Set(ancestors);
      lineage.add(module.moduleId);
      nodes.push({ module, children: build(module.moduleId, lineage) });
    }
    return nodes;
  };
  const roots = build(null, new Set());
  for (const module of active) {
    if (seen.has(module.moduleId)) continue;
    seen.add(module.moduleId);
    roots.push({ module, children: build(module.moduleId, new Set([module.moduleId])) });
  }
  return roots;
}

function moduleRows(modules: readonly PersonalKnowledgeModule[]): ModuleRow[] {
  const rows: ModuleRow[] = [];
  const visit = (nodes: readonly ModuleTreeNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ module: node.module, depth });
      visit(node.children, depth + 1);
    }
  };
  visit(moduleTree(modules), 0);
  return rows;
}

function moduleStatusLabel(status: PersonalKnowledgeModule["status"]): string {
  if (status === "learning") return "学习中";
  if (status === "paused") return "暂停";
  if (status === "long-term") return "长期维护";
  return "已归档";
}

function parentRevision(modules: readonly PersonalKnowledgeModule[], moduleId: string | null): number {
  return moduleId === null ? 0 : modules.find((module) => module.moduleId === moduleId)?.revision ?? 0;
}

function ModuleOptions({
  modules,
  includeRoot = false,
}: {
  readonly modules: readonly PersonalKnowledgeModule[];
  readonly includeRoot?: boolean;
}) {
  return (
    <>
      {includeRoot ? <option value="">无（顶层模块）</option> : null}
      {moduleRows(modules).map(({ module }) => (
        <option key={module.moduleId} value={module.moduleId}>
          {moduleBreadcrumb(modules, module)}
        </option>
      ))}
    </>
  );
}

function DailyLearningPanel({
  snapshot,
  today,
  canWrite,
  createId,
  onSubmit,
}: {
  readonly snapshot: PersonalKnowledgeSnapshot;
  readonly today: string;
  readonly canWrite: boolean;
  readonly createId: () => string;
  readonly onSubmit: (command: PersonalKnowledgeCommand) => Promise<void>;
}) {
  const modules = snapshot.modules.filter((module) => module.status !== "archived");
  const [businessDate, setBusinessDate] = useState(snapshot.businessDate);
  const [moduleId, setModuleId] = useState(modules[0]?.moduleId ?? "");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState("");
  const [personalUnderstanding, setPersonalUnderstanding] = useState("");
  const [openQuestions, setOpenQuestions] = useState("");
  const [application, setApplication] = useState("");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!moduleId || !title.trim() || !content.trim() || businessDate > today) return;
    await onSubmit({
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
    });
    setTitle("");
    setContent("");
    setSource("");
    setPersonalUnderstanding("");
    setOpenQuestions("");
    setApplication("");
  };

  return (
    <div className="personal-knowledge-daily">
      <form className="personal-knowledge-form" onSubmit={save}>
        <h2>记录今天学到的内容</h2>
        <label>学习日期<input aria-label="学习日期" type="date" max={today} value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} required /></label>
        <label>知识模块<select aria-label="知识模块" value={moduleId} onChange={(event) => setModuleId(event.target.value)} required><option value="">请选择模块</option><ModuleOptions modules={modules} /></select></label>
        <label>学习标题<input aria-label="学习标题" value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
        <label className="personal-knowledge-wide">学习内容<textarea aria-label="学习内容" value={content} onChange={(event) => setContent(event.target.value)} required rows={5} /></label>
        <details className="personal-knowledge-wide">
          <summary>补充来源与个人思考</summary>
          <div className="personal-knowledge-details-grid">
            <label>来源<textarea aria-label="来源" value={source} onChange={(event) => setSource(event.target.value)} /></label>
            <label>个人理解<textarea aria-label="个人理解" value={personalUnderstanding} onChange={(event) => setPersonalUnderstanding(event.target.value)} /></label>
            <label>开放问题<textarea aria-label="开放问题" value={openQuestions} onChange={(event) => setOpenQuestions(event.target.value)} /></label>
            <label>应用计划<textarea aria-label="应用计划" value={application} onChange={(event) => setApplication(event.target.value)} /></label>
          </div>
        </details>
        <button type="submit" disabled={!canWrite || !moduleId}>保存学习记录</button>
      </form>

      <section aria-labelledby="daily-learning-list-title">
        <h2 id="daily-learning-list-title">学习记录</h2>
        {snapshot.dailyNotes.length === 0 ? <p>这个日期还没有正式学习记录。</p> : (
          <div className="personal-knowledge-card-list">
            {snapshot.dailyNotes.map((note) => (
              <DailyNoteCard
                canWrite={canWrite}
                key={note.noteId}
                modules={snapshot.modules}
                note={note}
                onSubmit={onSubmit}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ModuleTreeList({
  nodes,
  selectedModuleId,
  expandedModuleIds,
  onSelect,
  onToggle,
  nested = false,
}: {
  readonly nodes: readonly ModuleTreeNode[];
  readonly selectedModuleId: string | null;
  readonly expandedModuleIds: ReadonlySet<string>;
  readonly onSelect: (moduleId: string) => void;
  readonly onToggle: (moduleId: string) => void;
  readonly nested?: boolean;
}) {
  return (
    <ul className={nested ? "personal-knowledge-tree-children" : "personal-knowledge-tree"}>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const expanded = hasChildren && expandedModuleIds.has(node.module.moduleId);
        const selected = selectedModuleId === node.module.moduleId;
        return (
          <li key={node.module.moduleId}>
            <div className="personal-knowledge-tree-row">
              {hasChildren ? (
                <button
                  aria-label={`${expanded ? "折叠" : "展开"}文件夹：${node.module.name}`}
                  aria-expanded={expanded}
                  className="personal-knowledge-tree-toggle"
                  onClick={() => onToggle(node.module.moduleId)}
                  type="button"
                >
                  <span aria-hidden="true" />
                </button>
              ) : <span aria-hidden="true" className="personal-knowledge-tree-toggle-placeholder" />}
              <span
                aria-hidden="true"
                className={hasChildren ? "personal-knowledge-folder-icon" : "personal-knowledge-note-icon"}
              />
              <button
                aria-label={`打开模块：${node.module.name}`}
                aria-current={selected ? "page" : undefined}
                className="personal-knowledge-tree-select"
                onClick={() => onSelect(node.module.moduleId)}
                type="button"
              >
                <span>{node.module.name}</span>
                <small>{moduleStatusLabel(node.module.status)}</small>
              </button>
            </div>
            {expanded ? <ModuleTreeList
              expandedModuleIds={expandedModuleIds}
              nested
              nodes={node.children}
              onSelect={onSelect}
              onToggle={onToggle}
              selectedModuleId={selectedModuleId}
            /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function moduleBreadcrumb(
  modules: readonly PersonalKnowledgeModule[],
  module: PersonalKnowledgeModule,
): string {
  const names = [module.name];
  const seen = new Set([module.moduleId]);
  let parentId = module.parentModuleId;
  while (parentId) {
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = modules.find((candidate) => candidate.moduleId === parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentModuleId;
  }
  return names.join(" / ");
}

function ModuleCard({
  module,
  modules,
  canWrite,
  onSubmit,
}: {
  readonly module: PersonalKnowledgeModule;
  readonly modules: readonly PersonalKnowledgeModule[];
  readonly canWrite: boolean;
  readonly onSubmit: (command: PersonalKnowledgeCommand) => Promise<void>;
}) {
  const [name, setName] = useState(module.name);
  const [goal, setGoal] = useState(module.goal);
  const [currentFocus, setCurrentFocus] = useState(module.currentFocus);
  const [description, setDescription] = useState(module.description);
  const [status, setStatus] = useState<"learning" | "paused" | "long-term">(
    module.status === "archived" ? "paused" : module.status,
  );
  const [newParentId, setNewParentId] = useState(module.parentModuleId ?? "");
  const [ordinal, setOrdinal] = useState(String(module.ordinal));
  const possibleParents = modules.filter((candidate) => candidate.moduleId !== module.moduleId && candidate.status !== "archived");

  return (
    <article className="personal-knowledge-card personal-knowledge-module-card">
      <header className="personal-knowledge-module-card-header">
        <p>{moduleBreadcrumb(modules, module)}</p>
        <h3>{module.name}</h3>
        <span>{moduleStatusLabel(module.status)}</span>
      </header>
      <details>
        <summary>编辑模块</summary>
        <div className="personal-knowledge-details-grid">
          <label>模块名称<input aria-label={`模块名称：${module.name}`} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>状态<select aria-label={`模块状态：${module.name}`} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="learning">学习中</option><option value="paused">暂停</option><option value="long-term">长期维护</option></select></label>
          <label>目标<textarea value={goal} onChange={(event) => setGoal(event.target.value)} /></label>
          <label>当前重点<textarea value={currentFocus} onChange={(event) => setCurrentFocus(event.target.value)} /></label>
          <label>说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <button type="button" disabled={!canWrite || !name.trim()} onClick={() => void onSubmit({ type: "save-module", moduleId: module.moduleId, parentModuleId: module.parentModuleId, name, goal, currentFocus, description, status, ordinal: module.ordinal, expectedModuleRevision: module.revision, expectedParentRevision: parentRevision(modules, module.parentModuleId) })}>保存模块：{module.name}</button>
        </div>
      </details>
      <div className="personal-knowledge-inline-controls">
        <label>移动到<select aria-label={`移动上级：${module.name}`} value={newParentId} onChange={(event) => setNewParentId(event.target.value)}><ModuleOptions modules={possibleParents} includeRoot /></select></label>
        <label>顺序<input aria-label={`移动顺序：${module.name}`} type="number" min={0} value={ordinal} onChange={(event) => setOrdinal(event.target.value)} /></label>
        <button
          aria-label={`移动模块：${module.name}`}
          className="personal-knowledge-action-button"
          type="button"
          disabled={!canWrite}
          onClick={() => void onSubmit({ type: "move-module", moduleId: module.moduleId, parentModuleId: newParentId || null, ordinal: Number(ordinal), expectedModuleRevision: module.revision, expectedOldParentRevision: parentRevision(modules, module.parentModuleId), expectedNewParentRevision: parentRevision(modules, newParentId || null) })}
        >
          调整位置
        </button>
        <button
          aria-label={`归档模块：${module.name}`}
          className="personal-knowledge-action-button personal-knowledge-archive-button"
          type="button"
          disabled={!canWrite}
          onClick={() => {
            if (!window.confirm(`确认归档“${module.name}”？归档后可在“已归档模块”中查看。`)) return;
            void onSubmit({ type: "archive-module", moduleId: module.moduleId, expectedModuleRevision: module.revision, expectedParentRevision: parentRevision(modules, module.parentModuleId) });
          }}
        >
          归档
        </button>
      </div>
    </article>
  );
}

function DailyNoteCard({
  note,
  modules,
  canWrite,
  onSubmit,
}: {
  readonly note: DailyLearningNote;
  readonly modules: readonly PersonalKnowledgeModule[];
  readonly canWrite: boolean;
  readonly onSubmit: (command: PersonalKnowledgeCommand) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [moduleId, setModuleId] = useState(note.moduleId);
  const [content, setContent] = useState(note.content);
  const activeModules = modules.filter((module) => module.status !== "archived");

  const save = async () => {
    if (!title.trim() || !content.trim()) return;
    await onSubmit({
      type: "save-daily-learning-note",
      noteId: note.noteId,
      businessDate: note.businessDate,
      title: title.trim(),
      moduleId,
      content,
      source: note.source,
      personalUnderstanding: note.personalUnderstanding,
      openQuestions: note.openQuestions,
      application: note.application,
      expectedNoteRevision: note.revision,
    });
    setEditing(false);
  };

  return (
    <article className="personal-knowledge-card">
      <p className="eyebrow">
        {note.businessDate} · {(() => {
          const module = modules.find((candidate) => candidate.moduleId === note.moduleId);
          return module ? moduleBreadcrumb(modules, module) : "未知模块";
        })()}
      </p>
      <h3>{note.title}</h3>
      <p>{note.content}</p>
      {editing ? (
        <div className="personal-knowledge-note-edit">
          <label>标题<input aria-label={`编辑标题：${note.title}`} onChange={(event) => setTitle(event.target.value)} value={title} /></label>
          <label>知识模块<select aria-label={`编辑模块：${note.title}`} onChange={(event) => setModuleId(event.target.value)} value={moduleId}><ModuleOptions modules={activeModules} /></select></label>
          <label>内容<textarea aria-label={`编辑内容：${note.title}`} rows={5} onChange={(event) => setContent(event.target.value)} value={content} /></label>
          <div className="personal-knowledge-note-edit-actions">
            <button disabled={!canWrite || !title.trim() || !content.trim()} onClick={() => void save()} type="button">保存修改（生成新版本）</button>
            <button disabled={!canWrite} onClick={() => {
              setTitle(note.title);
              setModuleId(note.moduleId);
              setContent(note.content);
              setEditing(false);
            }} type="button">取消</button>
          </div>
        </div>
      ) : (
        <div className="personal-knowledge-note-edit-actions">
          <button disabled={!canWrite} onClick={() => setEditing(true)} type="button">编辑此记录</button>
          <button
            className="personal-knowledge-archive-button"
            disabled={!canWrite}
            onClick={() => {
              if (!window.confirm(`确认归档「${note.title}」？归档后不再出现在列表。`)) return;
              void onSubmit({
                type: "archive-daily-learning-note",
                noteId: note.noteId,
                expectedNoteRevision: note.revision,
              });
            }}
            type="button"
          >
            归档
          </button>
        </div>
      )}
      <details>
        <summary>来源与思考</summary>
        <dl>
          <dt>来源</dt><dd>{note.source || "未填写"}</dd>
          <dt>个人理解</dt><dd>{note.personalUnderstanding || "未填写"}</dd>
          <dt>开放问题</dt><dd>{note.openQuestions || "未填写"}</dd>
          <dt>应用计划</dt><dd>{note.application || "未填写"}</dd>
        </dl>
      </details>
    </article>
  );
}

function ModulesPanel({
  snapshot,
  canWrite,
  createId,
  onSubmit,
}: {
  readonly snapshot: PersonalKnowledgeSnapshot;
  readonly canWrite: boolean;
  readonly createId: () => string;
  readonly onSubmit: (command: PersonalKnowledgeCommand) => Promise<void>;
}) {
  const modules = snapshot.modules.filter((module) => module.status !== "archived");
  const tree = moduleTree(modules);
  const archivedModules = snapshot.modules
    .filter((module) => module.status === "archived")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const [name, setName] = useState("");
  const [parentModuleId, setParentModuleId] = useState("");
  const [ordinal, setOrdinal] = useState("0");
  const [status, setStatus] = useState<"learning" | "paused" | "long-term">("learning");
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(
    tree[0]?.module.moduleId ?? null,
  );
  const [expandedModuleIds, setExpandedModuleIds] = useState<Set<string>>(() => new Set());
  const selectedModule = modules.find((module) => module.moduleId === selectedModuleId)
    ?? tree[0]?.module
    ?? null;

  const toggleModule = (moduleId: string) => {
    setExpandedModuleIds((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    await onSubmit({
      type: "save-module",
      moduleId: createId(),
      parentModuleId: parentModuleId || null,
      name,
      goal: "",
      currentFocus: "",
      description: "",
      status,
      ordinal: Number(ordinal),
      expectedModuleRevision: 0,
      expectedParentRevision: parentRevision(modules, parentModuleId || null),
    });
    setName("");
  };

  return (
    <div className="personal-knowledge-modules">
      <details className="personal-knowledge-create-module">
        <summary>新建知识模块</summary>
        <form className="personal-knowledge-form" onSubmit={create}>
          <label>模块名称<input aria-label="模块名称" value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label>上级模块<select aria-label="上级模块" value={parentModuleId} onChange={(event) => setParentModuleId(event.target.value)}><ModuleOptions modules={modules} includeRoot /></select></label>
          <label>手动顺序<input aria-label="手动顺序" type="number" min={0} value={ordinal} onChange={(event) => setOrdinal(event.target.value)} /></label>
          <label>状态<select aria-label="新模块状态" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="learning">学习中</option><option value="paused">暂停</option><option value="long-term">长期维护</option></select></label>
          <button type="submit" disabled={!canWrite || !name.trim()}>创建模块</button>
        </form>
      </details>
      <section aria-labelledby="module-tree-title" className="personal-knowledge-module-browser">
        <aside className="personal-knowledge-tree-panel">
          <header>
            <h2 id="module-tree-title">知识目录</h2>
            <span>{modules.length} 个模块</span>
          </header>
          {tree.length > 0 ? <nav aria-label="知识模块目录">
            <ModuleTreeList
              expandedModuleIds={expandedModuleIds}
              nodes={tree}
              onSelect={setSelectedModuleId}
              onToggle={toggleModule}
              selectedModuleId={selectedModule?.moduleId ?? null}
            />
          </nav> : <p className="personal-knowledge-meta">还没有知识模块。</p>}
          <details className="personal-knowledge-archive">
            <summary>已归档模块（{archivedModules.length}）</summary>
            {archivedModules.length === 0 ? (
              <p className="personal-knowledge-meta">暂时没有已归档模块。</p>
            ) : (
              <div className="personal-knowledge-archive-list">
                {archivedModules.map((module) => (
                  <article key={module.moduleId} className="personal-knowledge-archive-card">
                    <h3>{module.name}</h3>
                    <p className="personal-knowledge-meta">{module.updatedAt.slice(0, 10)}</p>
                  </article>
                ))}
              </div>
            )}
          </details>
        </aside>
        <div className="personal-knowledge-module-inspector">
          {selectedModule ? <ModuleCard
            key={selectedModule.moduleId}
            canWrite={canWrite}
            module={selectedModule}
            modules={modules}
            onSubmit={onSubmit}
          /> : <p className="personal-knowledge-meta">从左侧新建一个模块后开始整理。</p>}
        </div>
      </section>
    </div>
  );
}

export function PersonalKnowledgeWorkspace({
  initial,
  today,
  request,
  storage,
  createId = () => `personal-knowledge-${crypto.randomUUID()}`,
  now,
}: PersonalKnowledgeWorkspaceProps) {
  const [tab, setTab] = useState<WorkspaceTab>("daily");
  const [snapshot, setSnapshot] = useState(initial);
  const submission = usePersonalKnowledgeSubmission({ request, storage, createId, now });
  const tabs = useMemo(() => [
    { id: "daily" as const, label: "每日学习" },
    { id: "modules" as const, label: "知识模块" },
  ], []);

  const submit = async (command: PersonalKnowledgeCommand) => {
    const refreshed = await submission.submit(command, snapshot.businessDate);
    if (refreshed) setSnapshot(refreshed);
  };

  return (
    <section className="personal-knowledge-workspace" aria-label="个人知识">
      <div role="tablist" aria-label="个人知识视图">
        {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </div>
      {submission.status !== "idle" ? (
        <div className="personal-knowledge-status" role={submission.status === "reload-required" ? "alert" : "status"}>
          {submission.status === "saving" ? "正在保存…" : null}
          {submission.status === "uncertain" ? <>上次保存结果不确定。<button type="button" onClick={() => void submission.retry()}>重试原提交</button><button type="button" onClick={submission.abandon}>放弃原提交</button></> : null}
          {submission.status === "reload-required" ? <>数据已变化，请重新加载。<button type="button" onClick={() => window.location.reload()}>重新加载</button></> : null}
          {submission.status === "unavailable" ? "本地恢复存储或刷新暂时不可用；当前内容仍可阅读。" : null}
        </div>
      ) : null}
      <div role="tabpanel">
        {tab === "daily" ? <DailyLearningPanel snapshot={snapshot} today={today} canWrite={submission.canWrite} createId={createId} onSubmit={submit} /> : null}
        {tab === "modules" ? <ModulesPanel snapshot={snapshot} canWrite={submission.canWrite} createId={createId} onSubmit={submit} /> : null}
      </div>
    </section>
  );
}

