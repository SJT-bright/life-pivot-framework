import { ExerciseRecordPage } from "../exercise-record-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExerciseTemplatePageProps {
  searchParams: Promise<{ date?: string | string[] }>;
}

export default async function ExerciseTemplatePage({ searchParams }: ExerciseTemplatePageProps) {
  return ExerciseRecordPage({ activeKey: "template", searchParams, view: "template" });
}
