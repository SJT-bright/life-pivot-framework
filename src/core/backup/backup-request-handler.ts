import {
  LocalMutationError,
  assertLocalJsonMutation,
} from "@/core/http/local-request";

import type { BackupManifest } from "./create-backup";

interface BackupRequestDependencies {
  create: () => Promise<BackupManifest>;
  reportError?: (error: unknown) => void;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function handleBackupRequest(
  request: Request,
  dependencies: BackupRequestDependencies,
): Promise<Response> {
  try {
    assertLocalJsonMutation(request);
  } catch (error) {
    if (error instanceof LocalMutationError) {
      return json({ message: error.message }, error.status);
    }
    throw error;
  }

  try {
    const manifest = await dependencies.create();
    return json(manifest, 201);
  } catch (error) {
    (dependencies.reportError ?? console.error)(error);
    return json({ message: "备份失败，请稍后重试" }, 500);
  }
}
