import { z } from "zod";

import { isBusinessDate } from "@/core/time/business-date";

const identifierSchema = z.string().trim().min(1).max(128);
const revisionSchema = z.number().int().min(0).max(2_147_483_647);
const businessDateSchema = z.string().refine(isBusinessDate, "Invalid business date.");

export const manualExerciseProgressDecisionSchema = z.object({
  type: z.literal("record-progress-decision"),
  templateId: identifierSchema,
  templateVersionId: identifierSchema,
  asOfDate: businessDateSchema,
  decision: z.enum(["tracked", "excluded"]),
  expectedDecisionRevision: revisionSchema,
}).strict();

export type ManualExerciseProgressDecisionCommand = z.infer<
  typeof manualExerciseProgressDecisionSchema
>;

export type ManualExerciseProgressDecision = "tracked" | "excluded";
export type ManualExerciseProgressMetric = "sets" | "reps" | "weight";

export interface ManualExerciseProgressChange {
  dayKey: string;
  dayName: string;
  actionKey: string;
  actionName: string;
  metric: ManualExerciseProgressMetric;
  before: number | string | null;
  after: number | string | null;
  changeKind: "increase" | "decrease" | "changed" | "incomparable";
  delta: number | null;
  unit: string | null;
}

export interface ManualExerciseProgressTransition {
  templateId: string;
  fromVersionId: string;
  toVersionId: string;
  fromRevision: number;
  toRevision: number;
  effectiveFrom: string;
  effectiveState: "scheduled" | "effective";
  changeNote: string;
  createdAt: string;
  status: "pending" | "tracked" | "excluded";
  decision: ManualExerciseProgressDecision | null;
  decisionRevision: number | null;
  decisionUpdatedAt: string | null;
  changes: ManualExerciseProgressChange[];
}

export interface ManualExerciseProgressActualFact {
  businessDate: string;
  templateVersionId: string;
  dayKey: string;
  dayName: string;
  actionKey: string;
  actionName: string;
  actualSets: number;
  actualRepsText: string | null;
  actualWeightText: string | null;
  completion: boolean;
}

export interface ManualExerciseProgressSnapshot {
  asOfDate: string;
  templateId: string | null;
  pending: ManualExerciseProgressTransition[];
  tracked: ManualExerciseProgressTransition[];
  excluded: ManualExerciseProgressTransition[];
  actualFacts: ManualExerciseProgressActualFact[];
}


const progressChangeSchema = z.object({
  dayKey: identifierSchema,
  dayName: z.string(),
  actionKey: identifierSchema,
  actionName: z.string(),
  metric: z.enum(["sets", "reps", "weight"]),
  before: z.union([z.number(), z.string(), z.null()]),
  after: z.union([z.number(), z.string(), z.null()]),
  changeKind: z.enum(["increase", "decrease", "changed", "incomparable"]),
  delta: z.number().nullable(),
  unit: z.string().nullable(),
}).strict();

const progressTransitionSchema = z.object({
  templateId: identifierSchema,
  fromVersionId: identifierSchema,
  toVersionId: identifierSchema,
  fromRevision: revisionSchema,
  toRevision: revisionSchema,
  effectiveFrom: z.string(),
  effectiveState: z.enum(["scheduled", "effective"]),
  changeNote: z.string(),
  createdAt: z.string(),
  status: z.enum(["pending", "tracked", "excluded"]),
  decision: z.enum(["tracked", "excluded"]).nullable(),
  decisionRevision: revisionSchema.nullable(),
  decisionUpdatedAt: z.string().nullable(),
  changes: z.array(progressChangeSchema),
}).strict();

const progressActualFactSchema = z.object({
  businessDate: z.string(),
  templateVersionId: identifierSchema,
  dayKey: identifierSchema,
  dayName: z.string(),
  actionKey: identifierSchema,
  actionName: z.string(),
  actualSets: z.number().int().min(0),
  actualRepsText: z.string().nullable(),
  actualWeightText: z.string().nullable(),
  completion: z.boolean(),
}).strict();

export const manualExerciseProgressSnapshotSchema = z.object({
  asOfDate: businessDateSchema,
  templateId: identifierSchema.nullable(),
  pending: z.array(progressTransitionSchema),
  tracked: z.array(progressTransitionSchema),
  excluded: z.array(progressTransitionSchema),
  actualFacts: z.array(progressActualFactSchema),
}).strict();
