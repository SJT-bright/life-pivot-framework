import { ExerciseRecordPage } from "./exercise-record-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export default async function ExercisePage({ searchParams }: ExercisePageProps) {
  return ExerciseRecordPage({ activeKey: "today", searchParams, view: "today" });
}
interface ExercisePageProps {
  searchParams: Promise<{ date?: string | string[] }>;
}
