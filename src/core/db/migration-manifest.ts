export interface MigrationDefinition {
  id: string;
  filename: string;
  sha256: string;
}

export const migrationManifest = [
  {
    id: "0000_foundation",
    filename: "0000_foundation.sql",
    sha256: "6fad9626ef61ee698cdae92fabf6bc0785f9b8d8c7db76b1e961bcd972380a7c",
  },
  {
    id: "0001_trusted_today_capture",
    filename: "0001_trusted_today_capture.sql",
    sha256: "b3aa60c65b613d9596c902b4a9fd4b315ca24dd2477e948032194a08b0359fbb",
  },
  {
    id: "0002_daily_closed_loop",
    filename: "0002_daily_closed_loop.sql",
    sha256: "a9f558277032f0e054a54833a978a978e64650c4a786430a0808ef0224bb5c6e",
  },
  {
    id: "0003_knowledge_candidates_many",
    filename: "0003_knowledge_candidates_many.sql",
    sha256: "01706a04d54a6e13a772af8f4c9af1aa393042b7ca58bfe5cc99d36dcd984b62",
  },
  {
    id: "0004_knowledge_domains",
    filename: "0004_knowledge_domains.sql",
    sha256: "bd69632a950ccbc21c096fd61a2c22f9dd846998d161048fef7b64898e956209",
  },
  {
    id: "0005_skincare_domain",
    filename: "0005_skincare_domain.sql",
    sha256: "146ae498f7cef369de1f3884f7ddf6136d70f7c6a03b7f64dfb9695ca14c5e08",
  },
  {
    id: "0006_skincare_plan_interval",
    filename: "0006_skincare_plan_interval.sql",
    sha256: "b6d723c5383987ab08a39c9b166f7fcb00867b61a562a2794ee8c9b58472d709",
  },
  {
    id: "0007_sleep_domain",
    filename: "0007_sleep_domain.sql",
    sha256: "ad3d5fbcbe79813242024ea67688e0da211e88a86f668c25c6825b4895011466",
  },
  {
    id: "0008_exercise_domain",
    filename: "0008_exercise_domain.sql",
    sha256: "95e90f3b5d5d361b3655ceefad29d8737a499ed0e49c7000f0dffafd830800cf",
  },
  {
    id: "0009_personal_accumulation_foundation",
    filename: "0009_personal_accumulation_foundation.sql",
    sha256: "88e8f4e139133cd602f6a8ea2bda25359d86191555957a12040fe5872d4b7a73",
  },
  {
    id: "0010_manual_exercise_records",
    filename: "0010_manual_exercise_records.sql",
    sha256: "90d1ce0540dc127a79f870c6540a7d425ed75c1fd998866a7664361fe9c539cf",
  },
  {
    id: "0011_manual_skincare_records",
    filename: "0011_manual_skincare_records.sql",
    sha256: "2018b24e71dd0026ff2fa1c34553889acba9fdb8e2bfad1b28616b6d462b7543",
  },
  {
    id: "0012_personal_knowledge_foundation",
    filename: "0012_personal_knowledge_foundation.sql",
    sha256: "31d7e0cf4cd8c81ba572c714b74b17d873e8be4770d91a3155f80dfb89eb1256",
  },
  {
    id: "0013_weekly_review_pins",
    filename: "0013_weekly_review_pins.sql",
    sha256: "a6ec07129aea012e0a0b5b7fa9e5d4d01865f3d9699086ed6a5a89c60566f710",
  },
  {
    id: "0014_reading_domain",
    filename: "0014_reading_domain.sql",
    sha256: "2cad12a10d3e94963ca73e67e28167a8d0653b34857315832914131b7bee84b9",
  },
  {
    id: "0015_reading_sessions",
    filename: "0015_reading_sessions.sql",
    sha256: "7c1815245c5535ffdc5c9361b956f4eba27173b5076a89f5f2594f667bcea540",
  },
  {
    id: "0016_manual_exercise_progress",
    filename: "0016_manual_exercise_progress.sql",
    sha256: "e8fc8147c077f1c746feeba101471e2faa56e13889ed9f43bf5b3f4cac5868f1",
  },
  {
    id: "0017_drop_legacy_tables",
    filename: "0017_drop_legacy_tables.sql",
    sha256: "3b622ca1c3ca06b276d4a706c1f362286cfb176b79cfd550c160b884d3b71c3b",
  },
  {
    id: "0018_today_reminders",
    filename: "0018_today_reminders.sql",
    sha256: "64ac86a3f19e3243c31fc27b53ed6d94d0b3baaab7e38c23760d64ae8f81bba0",
  },
  {
    id: "0019_sleep_wellness_inputs",
    filename: "0019_sleep_wellness_inputs.sql",
    sha256: "a3696702a23c4075bab78ba57614d186679a6c2f14551e6dae13375c5ebf488c",
  },
  {
    id: "0020_manual_skincare_product_photos",
    filename: "0020_manual_skincare_product_photos.sql",
    sha256: "7e682db9a56d2e42c0e9bfcb1a7867dd59452de90cfe4c3228e6690730618043",
  },
  {
    id: "0021_manual_sleep_quality_score",
    filename: "0021_manual_sleep_quality_score.sql",
    sha256: "2688d4fdd01db87788da723292a83a4eb095cfbc3493c46f0cf8875503dc0563",
  },
  {
    id: "0022_wisdom_reminders",
    filename: "0022_wisdom_reminders.sql",
    sha256: "0a8d104f36157d3a011c2fab4d0fca255196752132aabb63ae22207294e8f86e",
  },
  {
    id: "0023_awake_sleep_tracking",
    filename: "0023_awake_sleep_tracking.sql",
    sha256: "04c5acee9e15acd3578271055d227718c960c52b8f915ba76c796553f134ed45",
  },
  {
    id: "0024_manual_exercise_day_resolution",
    filename: "0024_manual_exercise_day_resolution.sql",
    sha256: "cfa1c04be63f34dbe585d7754023a7c34956c695f870e8d2c6f31cbe232fdb64",
  },
] as const satisfies readonly MigrationDefinition[];
