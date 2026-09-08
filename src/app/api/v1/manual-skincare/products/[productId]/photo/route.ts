import { getApplicationDatabase } from "@/core/db/application-database";
import { getManualSkincareProductPhoto } from "@/modules/manual-skincare/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly productId: string }>;
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ message }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function handle(request: Request, context: RouteContext, includeBody: boolean): Promise<Response> {
  try {
    const { productId } = await context.params;
    const revisionText = new URL(request.url).searchParams.get("revision");
    if (revisionText === null || !/^[1-9]\d*$/u.test(revisionText)) {
      return errorResponse("A valid product revision is required.", 400);
    }
    const revision = Number(revisionText);
    if (!Number.isSafeInteger(revision)) {
      return errorResponse("A valid product revision is required.", 400);
    }

    const { sqlite } = getApplicationDatabase();
    const photo = getManualSkincareProductPhoto(sqlite, productId);
    if (!photo || photo.revision !== revision) {
      return errorResponse("Product photo not found.", 404);
    }

    return new Response(includeBody ? new Uint8Array(photo.bytes) : null, {
      status: 200,
      headers: {
        "cache-control": "private, max-age=31536000, immutable",
        "content-length": String(photo.bytes.byteLength),
        "content-type": photo.mediaType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(
      error instanceof TypeError ? "Invalid product photo request." : "Unable to load product photo.",
      error instanceof TypeError ? 400 : 500,
    );
  }
}

export const GET = (request: Request, context: RouteContext) => handle(request, context, true);
export const HEAD = (request: Request, context: RouteContext) => handle(request, context, false);

export const OPTIONS = () => new Response(null, {
  status: 204,
  headers: {
    allow: "GET, HEAD, OPTIONS",
    "cache-control": "no-store",
  },
});
