import { describe, expect, it, vi } from "vitest";

import type { BackupManifest } from "./create-backup";
import { handleBackupRequest } from "./backup-request-handler";

const manifest: BackupManifest = {
  backupId: "backup-1",
  schemaVersion: "2",
  applicationVersion: "0.1.0",
  createdAt: "2026-08-09T12:00:00.000Z",
  databaseSha256: "a".repeat(64),
  databaseBytes: 1024,
  status: "verified",
  recordCounts: {
    lifeAreas: 0,
    metricRecords: 0,
    dailyEntries: 1,
    captureItems: 1,
    actionEvents: null,
    goals: 0,
    reviews: 0,
    knowledgeItems: 0,
    knowledgeItemOrganizations: null,
    userPins: null,
    knowledgeCandidates: null,
    knowledgeRevisions: null,
    knowledgeAssetEvents: null,
    dailySummaries: null,
    dailySummaryRevisions: null,
    reviewRevisions: null,
    evidenceLinks: null,
    knowledgeDomains: null,
    skincareProducts: null,
    skincareFormulations: null,
    skincareIngredients: null,
    skincareFormulationIngredients: null,
    skincareProductUnits: null,
    skincareIngredientSensitivities: null,
    skincareFormulationConflicts: null,
    skincareToleranceEvents: null,
    skincarePlans: null,
    skincarePlanVersions: null,
    skincarePhases: null,
    skincareSteps: null,
    skincareCycles: null,
    skincareSafetyAssessments: null,
    skincarePlanVersionEvents: null,
    skincareUsageEvents: null,
    skinObservationEvents: null,
    skincareAdverseEvents: null,
    skincareAdverseUsageLinks: null,
    sleepPlans: null,
    sleepPlanVersions: null,
    sleepPlanScheduleDays: null,
    sleepSessions: null,
    sleepSessionEvents: null,
    sleepAwakeIntervals: null,
    sleepCheckins: null,
    sleepCheckinEvents: null,
    exerciseMovements: null,
    exerciseMovementVariants: null,
    trainingPlans: null,
    trainingPlanVersions: null,
    trainingWorkoutTemplates: null,
    trainingPrescriptions: null,
    strengthPrescriptions: null,
    cardioPrescriptions: null,
    mobilityPrescriptions: null,
    trainingCycles: null,
    trainingPlannedOccurrences: null,
    trainingSessions: null,
    trainingSessionEvents: null,
    strengthSetEvents: null,
    cardioSegmentEvents: null,
    mobilityHoldEvents: null,
    trainingRecoveryObservations: null,
    trainingRecoveryObservationEvents: null,
    sleepDailyRecords: null,
    healthChecklistTemplates: null,
    healthChecklistVersions: null,
    healthChecklistTemplateItems: null,
    healthChecklistDays: null,
    healthChecklistDayItems: null,
    personalDailyNotes: null,
    manualExerciseTemplates: null,
    manualExerciseTemplateVersions: null,
    manualExerciseTemplateDays: null,
    manualExerciseProgressDecisions: null,
    manualExerciseTemplateActions: null,
    manualExerciseCycleState: null,
    manualExerciseDays: null,
    manualExerciseDayActions: null,
    manualExerciseCycleEvents: null,
    manualSkincareProducts: null,
    manualSkincareRoutineVersions: null,
    manualSkincareRoutineItems: null,
    manualSkincareRoutineActivations: null,
    manualSkincareDays: null,
    manualSkincareDayItems: null,
    manualSkincareRecoveryPlans: null,
    manualSkincareRecoveryCycles: null,
    knowledgeModules: null,
    dailyLearningNotes: null,
    readingBooks: null,
    readingNotes: null,
    readingSessions: null,
    todayReminders: null,
  },
};

function request(origin = "http://127.0.0.1:3000") {
  return new Request("http://127.0.0.1:3000/api/v1/backups", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin,
      "content-type": "application/json",
    },
    body: "{}",
  });
}

describe("handleBackupRequest", () => {
  it("returns 201 only after a verified manifest is produced", async () => {
    const create = vi.fn().mockResolvedValue(manifest);

    const response = await handleBackupRequest(request(), { create });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(manifest);
  });

  it("rejects a foreign origin before starting backup", async () => {
    const create = vi.fn();

    const response = await handleBackupRequest(request("https://evil.example"), { create });

    expect(response.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("does not expose internal errors", async () => {
    const reportError = vi.fn();
    const response = await handleBackupRequest(request(), {
      create: async () => {
        throw new Error("C:\\private\\path\\life-pivot.sqlite is locked");
      },
      reportError,
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "备份失败，请稍后重试" });
    expect(reportError).toHaveBeenCalledOnce();
  });
});
