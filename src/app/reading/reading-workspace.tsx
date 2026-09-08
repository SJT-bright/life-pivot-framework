"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type {
  ReadingBook,
  ReadingCommand,
  ReadingSnapshot,
} from "@/modules/reading/contracts";

import {
  useReadingSubmission,
  type UseReadingSubmissionOptions,
} from "./use-reading-submission";

type WorkspaceTab = "all" | "wishlist" | "reading" | "finished";
type PdfViewerSize = "compact" | "comfortable";

export interface ReadingWorkspaceProps extends UseReadingSubmissionOptions {
  readonly initial: ReadingSnapshot;
}

const STATUS_LABELS: Record<ReadingBook["status"], string> = {
  wishlist: "待看",
  reading: "在读",
  finished: "读完",
};

function bookProgress(book: ReadingBook): { percent: number | null; label: string } {
  if (book.totalPages === null) {
    return {
      percent: book.status === "finished" ? 100 : null,
      label: book.status === "finished"
        ? "已读完"
        : book.currentPage > 0
          ? `已读到第 ${book.currentPage} 页`
          : "未开始",
    };
  }
  const percent = Math.min(100, Math.round((book.currentPage / book.totalPages) * 100));
  return {
    percent,
    label: `${book.currentPage} / ${book.totalPages} 页（${percent}%）`,
  };
}

function BookForm({
  canWrite,
  createId,
  onSubmit,
}: {
  readonly canWrite: boolean;
  readonly createId: () => string;
  readonly onSubmit: (command: ReadingCommand) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<ReadingBook["status"]>("wishlist");
  const [totalPages, setTotalPages] = useState("");
  const [currentPage, setCurrentPage] = useState("0");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const parsedTotal = totalPages.trim() === "" ? null : Number(totalPages);
    if (parsedTotal !== null && (!Number.isSafeInteger(parsedTotal) || parsedTotal < 1)) return;
    const parsedCurrent = Number(currentPage);
    if (!Number.isSafeInteger(parsedCurrent) || parsedCurrent < 0) return;
    if (parsedTotal !== null && parsedCurrent > parsedTotal) return;
    await onSubmit({
      type: "save-book",
      bookId: createId(),
      title,
      author: "",
      status,
      totalPages: parsedTotal,
      currentPage: parsedCurrent,
      rating: null,
      expectedRevision: 0,
    });
    setTitle("");
    setStatus("wishlist");
    setTotalPages("");
    setCurrentPage("0");
  };

  return (
    <form className="reading-form" onSubmit={save}>
      <h2>添加书籍</h2>
      <label>书名<input aria-label="书名" value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
      <label>状态<select aria-label="状态" value={status} onChange={(event) => setStatus(event.target.value as ReadingBook["status"])}><option value="wishlist">待看</option><option value="reading">在读</option><option value="finished">读完</option></select></label>
      <label>总页数<input aria-label="总页数" type="number" min={1} placeholder="可选" value={totalPages} onChange={(event) => setTotalPages(event.target.value)} /></label>
      <label>当前页<input aria-label="当前页" type="number" min={0} value={currentPage} onChange={(event) => setCurrentPage(event.target.value)} /></label>
      <button type="submit" disabled={!canWrite || !title.trim()}>添加书籍</button>
    </form>
  );
}

function PdfControls({
  book,
  canWrite,
  onUpload,
  onRemove,
}: {
  readonly book: ReadingBook;
  readonly canWrite: boolean;
  readonly onUpload: (file: File) => Promise<void>;
  readonly onRemove: () => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [viewerSize, setViewerSize] = useState<PdfViewerSize>("comfortable");
  const [thumbnailsVisible, setThumbnailsVisible] = useState(false);
  const [windowFilled, setWindowFilled] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const viewerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const syncFullscreenState = () => {
      setFullscreen(document.fullscreenElement === viewerRef.current);
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    if (!fullscreen && !windowFilled) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreen, windowFilled]);

  async function toggleFullscreen() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    setError("");
    try {
      if (document.fullscreenElement === viewer) {
        await document.exitFullscreen();
        return;
      }
      if (typeof viewer.requestFullscreen !== "function") {
        throw new Error("Fullscreen API unavailable");
      }
      await viewer.requestFullscreen();
    } catch {
      setFullscreen(document.fullscreenElement === viewer);
      setError("无法切换系统全屏，请重试");
    }
  }

  async function closeReader() {
    const viewer = viewerRef.current;
    try {
      if (
        viewer &&
        document.fullscreenElement === viewer &&
        typeof document.exitFullscreen === "function"
      ) {
        await document.exitFullscreen();
      }
    } catch {
      // Removing the fullscreen element also makes the browser leave fullscreen.
    }
    setFullscreen(false);
    setWindowFilled(false);
    setThumbnailsVisible(false);
    setReaderOpen(false);
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      await onUpload(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleRemove() {
    setRemoving(true);
    setError("");
    try {
      await onRemove();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setRemoving(false);
    }
  }

  if (!book.pdf) {
    return (
      <div className="reading-pdf-controls">
        <label className="reading-pdf-upload">
          <input aria-label={`上传 PDF：${book.title}`} accept="application/pdf,.pdf" type="file" disabled={!canWrite || uploading} onChange={(event) => void handleFile(event)} />
          <span>{uploading ? "上传中…" : "导入 PDF"}</span>
        </label>
        {error ? <p className="reading-error" role="alert">{error}</p> : null}
      </div>
    );
  }

  const pdfUrl = `/api/v1/reading/books/${encodeURIComponent(book.bookId)}/pdf`;
  const readerId = `reading-pdf-${book.bookId}`;

  return (
    <div className="reading-pdf-shell">
      <div className="reading-pdf-controls">
        <button
          aria-controls={readerId}
          aria-expanded={readerOpen}
          aria-label={`${readerOpen ? "收起" : "查看"} PDF：${book.title}`}
          onClick={() => {
            if (readerOpen) {
              void closeReader();
              return;
            }
            setReaderOpen(true);
          }}
          type="button"
        >
          {readerOpen ? "收起 PDF" : "查看 PDF"}
        </button>
        <button type="button" disabled={!canWrite || removing} onClick={() => void handleRemove()}>{removing ? "删除中…" : "移除 PDF"}</button>
        {error ? <p className="reading-error" role="alert">{error}</p> : null}
        <span className="reading-pdf-meta">{book.pdf.originalName}（{(book.pdf.sizeBytes / 1024 / 1024).toFixed(1)} MB）</span>
      </div>
      {readerOpen ? (
        <section
          aria-label={`PDF 阅读器：${book.title}`}
          className={`reading-pdf-viewer is-${viewerSize}${windowFilled ? " is-window-filled" : ""}${fullscreen ? " is-fullscreen" : ""}`}
          id={readerId}
          ref={viewerRef}
        >
          <header>
            <div className="reading-pdf-title">
              <strong>{book.title}</strong>
              <span>{book.pdf.originalName}</span>
            </div>
            <div aria-label="预览大小" className="reading-pdf-size-controls" role="group">
              {(["compact", "comfortable"] as const).map((size) => (
                <button
                  aria-pressed={viewerSize === size}
                  key={size}
                  onClick={() => setViewerSize(size)}
                  type="button"
                >
                  {{ compact: "紧凑", comfortable: "舒适" }[size]}
                </button>
              ))}
            </div>
            <div className="reading-pdf-window-controls">
              <button
                aria-label={`${thumbnailsVisible ? "收起" : "显示"}缩略图：${book.title}`}
                aria-pressed={thumbnailsVisible}
                onClick={() => setThumbnailsVisible((visible) => !visible)}
                type="button"
              >
                {thumbnailsVisible ? "收起缩略图" : "显示缩略图"}
              </button>
              <button
                aria-label={`${windowFilled ? "退出铺满软件" : "铺满软件"}：${book.title}`}
                aria-pressed={windowFilled}
                disabled={fullscreen}
                onClick={() => setWindowFilled((filled) => !filled)}
                type="button"
              >
                {windowFilled ? "退出铺满" : "铺满软件"}
              </button>
              <button
                aria-label={`${fullscreen ? "退出电脑全屏" : "电脑全屏"}：${book.title}`}
                onClick={() => void toggleFullscreen()}
                type="button"
              >
                {fullscreen ? "退出全屏" : "电脑全屏"}
              </button>
              <button
                aria-label={`关闭 PDF：${book.title}`}
                onClick={() => void closeReader()}
                type="button"
              >
                关闭
              </button>
            </div>
          </header>
          <iframe
            key={thumbnailsVisible ? "pdf-with-thumbnails" : "pdf-without-thumbnails"}
            src={`${pdfUrl}#view=FitH&navpanes=${thumbnailsVisible ? "1" : "0"}`}
            title={`PDF 阅读器：${book.title}`}
          />
        </section>
      ) : null}
    </div>
  );
}

function BookCard({
  book,
  canWrite,
  onSubmit,
  onUploadPdf,
  onRemovePdf,
}: {
  readonly book: ReadingBook;
  readonly canWrite: boolean;
  readonly onSubmit: (command: ReadingCommand) => Promise<void>;
  readonly onUploadPdf: (book: ReadingBook, file: File) => Promise<void>;
  readonly onRemovePdf: (book: ReadingBook) => Promise<void>;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(book.title);
  const [totalPages, setTotalPages] = useState(book.totalPages === null ? "" : String(book.totalPages));
  const [currentPage, setCurrentPage] = useState(String(book.currentPage));
  const [status, setStatus] = useState<ReadingBook["status"]>(book.status);
  const [rating, setRating] = useState(book.rating === null ? "" : String(book.rating));
  const progress = bookProgress(book);

  const saveEdits = async () => {
    if (!title.trim()) return;
    const parsedTotal = totalPages.trim() === "" ? null : Number(totalPages);
    if (parsedTotal !== null && (!Number.isSafeInteger(parsedTotal) || parsedTotal < 1)) return;
    const parsedCurrent = Number(currentPage);
    if (!Number.isSafeInteger(parsedCurrent) || parsedCurrent < 0) return;
    if (parsedTotal !== null && parsedCurrent > parsedTotal) return;
    const parsedRating = rating === "" ? null : Number(rating);
    if (parsedRating !== null && (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5)) return;
    await onSubmit({
      type: "save-book",
      bookId: book.bookId,
      title,
      author: book.author,
      status,
      totalPages: parsedTotal,
      currentPage: parsedCurrent,
      rating: parsedRating,
      expectedRevision: book.revision,
    });
    setEditing(false);
  };

  const changeStatus = async (next: ReadingBook["status"]) => {
    if (next === book.status) return;
    await onSubmit({
      type: "save-book",
      bookId: book.bookId,
      title: book.title,
      author: book.author,
      status: next,
      totalPages: book.totalPages,
      currentPage: book.currentPage,
      rating: book.rating,
      expectedRevision: book.revision,
    });
  };

  const archive = async () => {
    await onSubmit({ type: "archive-book", bookId: book.bookId, expectedRevision: book.revision });
  };

  return (
    <article className="reading-book-card" aria-label={`书籍：${book.title}`}>
      <header className="reading-book-header">
        <div>
          <h3>{book.title}</h3>
          <p className="reading-book-meta">
            {STATUS_LABELS[book.status]}
            {book.rating !== null ? <span className="reading-book-rating"> · {"★".repeat(book.rating)}{"☆".repeat(5 - book.rating)}</span> : null}
            <span> · {progress.label}</span>
          </p>
        </div>
        <div className="reading-book-actions">
          <button
            aria-expanded={detailsOpen}
            aria-label={`${detailsOpen ? "收起" : "展开"}书籍：${book.title}`}
            onClick={() => setDetailsOpen((open) => !open)}
            type="button"
          >
            {detailsOpen ? "收起详情" : "展开详情"}
          </button>
          {book.status !== "finished" ? (
            <button type="button" disabled={!canWrite} onClick={() => void changeStatus(book.status === "wishlist" ? "reading" : "finished")}>
              {book.status === "wishlist" ? "开始阅读" : "标记读完"}
            </button>
          ) : null}
          {book.status !== "wishlist" ? (
            <button type="button" disabled={!canWrite} onClick={() => void changeStatus(book.status === "reading" ? "wishlist" : "reading")}>
              {book.status === "reading" ? "放回待看" : "重新在读"}
            </button>
          ) : null}
          <button type="button" disabled={!canWrite} onClick={() => { setDetailsOpen(true); setEditing(!editing); }}>{editing ? "收起编辑" : "编辑"}</button>
          <button type="button" disabled={!canWrite} onClick={() => void archive()}>归档</button>
        </div>
      </header>

      {detailsOpen ? (
        <div className="reading-book-details">
          <div className="reading-progress">
            <div aria-label={`阅读进度：${progress.label}`} className="reading-progress-track" role="progressbar" aria-valuenow={progress.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
              <span className="reading-progress-fill" style={{ width: progress.percent === null ? "0%" : `${progress.percent}%` }} />
            </div>
            <span className="reading-progress-label">{progress.label}</span>
          </div>
          <PdfControls
            book={book}
            canWrite={canWrite}
            onUpload={(file) => onUploadPdf(book, file)}
            onRemove={() => onRemovePdf(book)}
          />

          {editing ? (
            <details open className="reading-edit-details">
              <summary>编辑信息</summary>
              <div className="reading-edit-grid">
                <label>书名<input aria-label={`编辑书名：${book.title}`} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
                <label>状态<select aria-label={`编辑状态：${book.title}`} value={status} onChange={(event) => setStatus(event.target.value as ReadingBook["status"])}><option value="wishlist">待看</option><option value="reading">在读</option><option value="finished">读完</option></select></label>
                <label>总页数<input aria-label={`编辑总页数：${book.title}`} type="number" min={1} value={totalPages} onChange={(event) => setTotalPages(event.target.value)} /></label>
                <label>当前页<input aria-label={`编辑当前页：${book.title}`} type="number" min={0} value={currentPage} onChange={(event) => setCurrentPage(event.target.value)} /></label>
                <label>评分<select aria-label={`编辑评分：${book.title}`} value={rating} onChange={(event) => setRating(event.target.value)}><option value="">未评分</option><option value="1">★ 1</option><option value="2">★★ 2</option><option value="3">★★★ 3</option><option value="4">★★★★ 4</option><option value="5">★★★★★ 5</option></select></label>
                <button type="button" disabled={!canWrite || !title.trim()} onClick={() => void saveEdits()}>保存修改</button>
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function BookList({
  books,
  tab,
  canWrite,
  onSubmit,
  onUploadPdf,
  onRemovePdf,
}: {
  readonly books: readonly ReadingBook[];
  readonly tab: WorkspaceTab;
  readonly canWrite: boolean;
  readonly onSubmit: (command: ReadingCommand) => Promise<void>;
  readonly onUploadPdf: (book: ReadingBook, file: File) => Promise<void>;
  readonly onRemovePdf: (book: ReadingBook) => Promise<void>;
}) {
  const filtered = tab === "all" ? books : books.filter((book) => book.status === tab);
  if (filtered.length === 0) {
    return <p className="reading-empty">这个分类还没有书籍。</p>;
  }
  return (
    <div className="reading-book-list">
      {filtered.map((book) => (
        <BookCard
          key={book.bookId}
          book={book}
          canWrite={canWrite}
          onSubmit={onSubmit}
          onUploadPdf={onUploadPdf}
          onRemovePdf={onRemovePdf}
        />
      ))}
    </div>
  );
}

export function ReadingWorkspace({
  initial,
  request,
  storage,
  createId = () => `reading-${crypto.randomUUID()}`,
  now,
}: ReadingWorkspaceProps) {
  const [tab, setTab] = useState<WorkspaceTab>("all");
  const [snapshot, setSnapshot] = useState(initial);
  const [pdfMessage, setPdfMessage] = useState("");
  const submission = useReadingSubmission({ request, storage, createId, now });
  const tabs = useMemo(() => [
    { id: "all" as const, label: "全部" },
    { id: "wishlist" as const, label: "待看" },
    { id: "reading" as const, label: "在读" },
    { id: "finished" as const, label: "读完" },
  ], []);

  const submit = async (command: ReadingCommand) => {
    const refreshed = await submission.submit(command);
    if (refreshed) setSnapshot(refreshed);
  };

  const uploadPdf = async (book: ReadingBook, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(
      `/api/v1/reading/books/${encodeURIComponent(book.bookId)}/pdf`,
      { method: "POST", body: formData },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? "PDF 上传失败");
    }
    const body = (await response.json()) as { pdf: ReadingBook["pdf"] };
    setSnapshot((current) => ({
      ...current,
      books: current.books.map((item) => item.bookId === book.bookId ? { ...item, pdf: body.pdf } : item),
    }));
  };

  const removePdf = async (book: ReadingBook) => {
    const response = await fetch(
      `/api/v1/reading/books/${encodeURIComponent(book.bookId)}/pdf`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? "PDF 移除失败");
    }
    setSnapshot((current) => ({
      ...current,
      books: current.books.map((item) => item.bookId === book.bookId ? { ...item, pdf: null } : item),
    }));
  };

  return (
    <section className="reading-workspace" aria-labelledby="reading-title">
      <header>
        <h1 id="reading-title">读书</h1>
      </header>
      {submission.status !== "idle" ? (
        <div className="reading-status" role={submission.status === "reload-required" ? "alert" : "status"}>
          {submission.status === "saving" ? "正在保存…" : null}
          {submission.status === "uncertain" ? <>上次保存结果不确定。<button type="button" onClick={() => void submission.retry()}>重试原提交</button><button type="button" onClick={submission.abandon}>放弃原提交</button></> : null}
          {submission.status === "reload-required" ? <>数据已变化，请重新加载。<button type="button" onClick={() => window.location.reload()}>重新加载</button></> : null}
          {submission.status === "unavailable" ? "本地恢复存储或刷新暂时不可用；当前内容仍可阅读。" : null}
        </div>
      ) : null}
      {pdfMessage ? <p className="reading-status" role="status">{pdfMessage}</p> : null}

      <div className="reading-layout">
        <BookForm canWrite={submission.canWrite} createId={createId} onSubmit={submit} />
        <div>
          <div role="tablist" aria-label="读书视图" className="reading-tabs">
            {tabs.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>
            ))}
          </div>
          <div role="tabpanel">
            <BookList
              books={snapshot.books}
              tab={tab}
              canWrite={submission.canWrite}
              onSubmit={submit}
              onUploadPdf={uploadPdf}
              onRemovePdf={removePdf}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
