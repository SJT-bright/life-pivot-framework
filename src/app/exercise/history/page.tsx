import { ExerciseRecordPage } from "../exercise-record-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExerciseHistoryPageProps {
  searchParams: Promise<{ date?: string | string[] }>;
}

export default async function ExerciseHistoryPage({ searchParams }: ExerciseHistoryPageProps) {
  return ExerciseRecordPage({ activeKey: "history", searchParams, view: "history" });
}
