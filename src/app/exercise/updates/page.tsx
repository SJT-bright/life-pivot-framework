import { ExerciseRecordPage } from "../exercise-record-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExerciseUpdatesPageProps {
  searchParams: Promise<{ date?: string | string[] }>;
}

export default async function ExerciseUpdatesPage({ searchParams }: ExerciseUpdatesPageProps) {
  return ExerciseRecordPage({ activeKey: "updates", searchParams, view: "updates" });
}
