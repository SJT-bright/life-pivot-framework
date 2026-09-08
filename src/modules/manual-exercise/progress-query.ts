import type Database from "better-sqlite3";

import type {
  ManualExerciseProgressActualFact,
  ManualExerciseProgressChange,
  ManualExerciseProgressDecision,
  ManualExerciseProgressSnapshot,
  ManualExerciseProgressTransition,
} from "./progress-contracts";
import {
  deriveManualExerciseProgressDiff,
  type ManualExerciseProgressActionInput,
} from "./progress-diff";

interface TransitionRow {
  template_id: string;
  from_version_id: string;
  from_revision: number;
  to_version_id: string;
  to_revision: number;
  effective_from: string;
  change_note: string;
  created_at: string;
  decision: ManualExerciseProgressDecision | null;
  decision_revision: number | null;
  decision_updated_at: string | null;
}

interface ActionRow {
  day_key: string;
  day_name: string;
  action_key: string;
  action_name: string;
  planned_sets: number;
  planned_reps_text: string;
  planned_weight_text: string;
}

interface ActualFactRow {
  business_date: string;
  template_version_id: string;
  day_key: string;
  day_name: string;
  action_key: string;
  action_name: string;
  actual_sets: number;
  actual_reps_text: string;
  actual_weight_text: string;
  completion: string;
}

function nullableText(value: string): string | null {
  return value === "" ? null : value;
}

function readActions(
  sqlite: Database.Database,
  templateVersionId: string,
): ManualExerciseProgressActionInput[] {
  const rows = sqlite.prepare(
    `select d.day_key, d.name as day_name,
            a.action_key, a.name as action_name, a.planned_sets,
            a.planned_reps_text, a.planned_weight_text
     from manual_exercise_template_days d
     join manual_exercise_template_actions a on a.template_day_id = d.id
     where d.template_version_id = ? order by d.ordinal, a.ordinal`,
  ).all(templateVersionId) as ActionRow[];
  return rows.map((row) => ({
    dayKey: row.day_key,
    dayName: row.day_name,
    actionKey: row.action_key,
    actionName: row.action_name,
    plannedSets: row.planned_sets,
    plannedRepsText: nullableText(row.planned_reps_text),
    plannedWeightText: nullableText(row.planned_weight_text),
  }));
}

function readActualFacts(
  sqlite: Database.Database,
  asOfDate: string,
  templateId?: string,
): ManualExerciseProgressActualFact[] {
  const rows = sqlite.prepare(
    `select d.business_date, d.template_version_id, d.day_key,
            d.day_name, a.action_key, a.name as action_name,
            a.actual_sets, a.actual_reps_text, a.actual_weight_text,
            a.completion
     from manual_exercise_days d
     join manual_exercise_day_actions a on a.day_id = d.id
     join manual_exercise_template_versions v on v.id = d.template_version_id
     where (? is null or v.template_id = ?)
       and d.business_date <= ?
       and d.status <> 'skipped'
       and (a.actual_sets > 0 or a.actual_reps_text <> ''
            or a.actual_weight_text <> '' or a.completion <> '')
     order by d.business_date desc, a.ordinal`,
  ).all(templateId ?? null, templateId ?? null, asOfDate) as ActualFactRow[];
  return rows.map((row) => ({
    businessDate: row.business_date,
    templateVersionId: row.template_version_id,
    dayKey: row.day_key,
    dayName: row.day_name,
    actionKey: row.action_key,
    actionName: row.action_name,
    actualSets: row.actual_sets,
    actualRepsText: nullableText(row.actual_reps_text),
    actualWeightText: nullableText(row.actual_weight_text),
    completion: row.completion === "completed",
  }));
}

function classify(
  row: TransitionRow,
  changes: ManualExerciseProgressChange[],
  asOfDate: string,
): ManualExerciseProgressTransition {
  return {
    templateId: row.template_id,
    fromVersionId: row.from_version_id,
    toVersionId: row.to_version_id,
    fromRevision: row.from_revision,
    toRevision: row.to_revision,
    effectiveFrom: row.effective_from,
    effectiveState: row.effective_from <= asOfDate ? "effective" : "scheduled",
    changeNote: row.change_note,
    createdAt: row.created_at,
    status: row.decision ?? "pending",
    decision: row.decision,
    decisionRevision: row.decision_revision,
    decisionUpdatedAt: row.decision_updated_at,
    changes,
  };
}

export function getManualExerciseProgressSnapshot(
  sqlite: Database.Database,
  input: { asOfDate: string; templateId?: string },
): ManualExerciseProgressSnapshot {
  const rows = sqlite.prepare(
    `select t.id as template_id,
            from_v.id as from_version_id, from_v.revision as from_revision,
            to_v.id as to_version_id, to_v.revision as to_revision,
            to_v.effective_from, to_v.change_note, to_v.created_at,
            d.decision, d.revision as decision_revision,
            d.updated_at as decision_updated_at
     from manual_exercise_template_versions to_v
     join manual_exercise_template_versions from_v
       on from_v.template_id = to_v.template_id
      and from_v.revision = to_v.revision - 1
     join manual_exercise_templates t on t.id = to_v.template_id
     left join manual_exercise_progress_decisions d
       on d.template_id = t.id
      and d.from_version_id = from_v.id
      and d.to_version_id = to_v.id
     where (? is null or t.id = ?)
     order by t.updated_at desc, to_v.revision desc`,
  ).all(input.templateId ?? null, input.templateId ?? null) as TransitionRow[];

  const pending: ManualExerciseProgressTransition[] = [];
  const tracked: ManualExerciseProgressTransition[] = [];
  const excluded: ManualExerciseProgressTransition[] = [];
  const actualFacts: ManualExerciseProgressActualFact[] = readActualFacts(
    sqlite,
    input.asOfDate,
    input.templateId,
  );

  for (const row of rows) {
    const fromActions = readActions(sqlite, row.from_version_id);
    const toActions = readActions(sqlite, row.to_version_id);
    const diff = deriveManualExerciseProgressDiff(fromActions, toActions);
    if (diff.changes.length === 0) continue;

    const transition = classify(row, diff.changes, input.asOfDate);
    if (transition.status === "tracked") tracked.push(transition);
    else if (transition.status === "excluded") excluded.push(transition);
    else pending.push(transition);
  }

  return {
    templateId: input.templateId ?? null,
    pending,
    asOfDate: input.asOfDate,
    tracked,
    excluded,
    actualFacts,
  };
}
