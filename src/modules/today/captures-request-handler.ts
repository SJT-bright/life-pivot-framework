import { isBusinessDate } from "@/core/time/business-date";

import {
  CaptureTimelineInputError,
  parseCaptureCursor,
  type CapturePage,
  type CaptureTimelineInput,
} from "./get-captures";
import {
  CaptureSourceInputError,
  CaptureSourceNotFoundError,
  type CaptureSource,
  type CaptureSourceInput,
} from "./get-capture-source";

const MAX_PAGE_SIZE = 50;
const QUERY_KEYS = new Set(["date", "cursor", "snapshot", "limit", "source"]);
const NON_NEGATIVE_INTEGER = /^(?:0|[1-9]\d*)$/;

interface CaptureTimelineRequestDependencies {
  getTimeline: (input: CaptureTimelineInput) => CapturePage;
  getSource?: (input: CaptureSourceInput) => CaptureSource;
}

type CaptureReadRequest =
  | { mode: "timeline"; input: CaptureTimelineInput }
  | { mode: "source"; input: CaptureSourceInput };

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function invalidRequest(): Response {
  return json({ message: "Invalid capture timeline request" }, 400);
}

function readSingle(searchParams: URLSearchParams, key: string): string | undefined {
  const values = searchParams.getAll(key);
  if (values.length > 1) {
    throw new CaptureTimelineInputError("Repeated capture timeline query parameter");
  }
  return values[0];
}

function readInteger(
  value: string | undefined,
  minimum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!NON_NEGATIVE_INTEGER.test(value)) {
    throw new CaptureTimelineInputError("Invalid capture timeline numeric query parameter");
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new CaptureTimelineInputError("Invalid capture timeline numeric query parameter");
  }
  return parsed;
}

function parseInput(request: Request): CaptureReadRequest {
  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) {
    if (!QUERY_KEYS.has(key)) {
      throw new CaptureTimelineInputError("Unknown capture timeline query parameter");
    }
  }

  const businessDate = readSingle(url.searchParams, "date");
  const sourceId = readSingle(url.searchParams, "source");

  if (sourceId !== undefined) {
    const cursor = readSingle(url.searchParams, "cursor");
    const snapshot = readSingle(url.searchParams, "snapshot");
    const limit = readSingle(url.searchParams, "limit");
    if (
      !businessDate
      || !isBusinessDate(businessDate)
      || sourceId.trim().length === 0
      || cursor !== undefined
      || snapshot !== undefined
      || limit !== undefined
    ) {
      throw new CaptureTimelineInputError("Invalid capture source query parameters");
    }
    return {
      mode: "source",
      input: { businessDate, sourceId },
    };
  }

  const cursor = readSingle(url.searchParams, "cursor");
  const snapshotHighWater = readInteger(readSingle(url.searchParams, "snapshot"), 0);
  const requestedLimit = readInteger(readSingle(url.searchParams, "limit"), 1);

  if (!businessDate || !isBusinessDate(businessDate)) {
    throw new CaptureTimelineInputError("Invalid capture timeline business date");
  }
  if (cursor !== undefined) parseCaptureCursor(cursor);
  if (cursor !== undefined && snapshotHighWater === undefined) {
    throw new CaptureTimelineInputError("A capture timeline cursor requires a snapshot");
  }

  return {
    mode: "timeline",
    input: {
      businessDate,
      limit: requestedLimit === undefined ? undefined : Math.min(requestedLimit, MAX_PAGE_SIZE),
      cursor,
      snapshotHighWater,
    },
  };
}

export function handleCaptureTimelineRequest(
  request: Request,
  dependencies: CaptureTimelineRequestDependencies,
): Response {
  let requestInput: CaptureReadRequest;
  try {
    requestInput = parseInput(request);
  } catch (error) {
    if (error instanceof CaptureTimelineInputError) return invalidRequest();
    return invalidRequest();
  }

  if (requestInput.mode === "source") {
    try {
      if (!dependencies.getSource) throw new Error("Capture source reader unavailable");
      return json({ source: dependencies.getSource(requestInput.input) }, 200);
    } catch (error) {
      if (error instanceof CaptureSourceInputError) return invalidRequest();
      if (error instanceof CaptureSourceNotFoundError) {
        return json({ message: "Capture source not found" }, 404);
      }
      return json({ message: "Unable to load capture source" }, 500);
    }
  }

  try {
    return json(dependencies.getTimeline(requestInput.input), 200);
  } catch (error) {
    if (error instanceof CaptureTimelineInputError) return invalidRequest();
    return json({ message: "Unable to load capture timeline" }, 500);
  }
}
