import {
  CAPTURE_STORAGE_FAILURE_MESSAGE,
  IdempotencyConflictError,
} from "./save-entry";
import {
  type EntrySectionInput,
  type MetricSectionInput,
  type SectionSaveResult,
  type SkincareSectionInput,
  type StoredCapture,
  type TaskSectionInput,
  type TodaySectionInput,
  todaySectionSchema,
} from "./contracts";

interface StoredSection {
  id: string;
  revision: number;
}

export interface SaveTodaySectionDependencies {
  saveEntry?: (input: EntrySectionInput) => Promise<StoredCapture>;
  saveMetric?: (input: MetricSectionInput) => Promise<StoredSection>;
  saveTask?: (input: TaskSectionInput) => Promise<StoredSection>;
  saveSkincare?: (input: SkincareSectionInput) => Promise<StoredSection>;
}

function missingSaver(): never {
  throw new Error("该记录分区尚未启用");
}

export async function saveTodaySection(
  input: TodaySectionInput,
  dependencies: SaveTodaySectionDependencies,
): Promise<SectionSaveResult> {
  const parsed = todaySectionSchema.safeParse(input);
  const section = input.section;

  if (!parsed.success) {
    return {
      section,
      status: "invalid",
      message: parsed.error.issues[0]?.message ?? "记录格式不正确",
    };
  }

  try {
    switch (parsed.data.section) {
      case "entry": {
        const item = await (dependencies.saveEntry ?? missingSaver)(parsed.data);
        return { section: "entry", status: "saved", item };
      }
      case "metric": {
        const stored = await (dependencies.saveMetric ?? missingSaver)(parsed.data);
        return { section: "metric", status: "saved", recordId: stored.id, revision: stored.revision };
      }
      case "task": {
        const stored = await (dependencies.saveTask ?? missingSaver)(parsed.data);
        return { section: "task", status: "saved", recordId: stored.id, revision: stored.revision };
      }
      case "skincare": {
        const stored = await (dependencies.saveSkincare ?? missingSaver)(parsed.data);
        return { section: "skincare", status: "saved", recordId: stored.id, revision: stored.revision };
      }
    }
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return {
        section: parsed.data.section,
        status: "conflict",
        message: error.message,
      };
    }

    return {
      section: parsed.data.section,
      status: "failed",
      message: CAPTURE_STORAGE_FAILURE_MESSAGE,
    };
  }
}
