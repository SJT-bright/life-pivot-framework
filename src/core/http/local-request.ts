const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export class LocalMutationError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LocalMutationError";
    this.status = status;
  }
}

function parseHost(hostHeader: string | null, protocol: string): URL {
  if (!hostHeader) {
    throw new LocalMutationError("缺少请求主机", 400);
  }

  try {
    return new URL(`${protocol}//${hostHeader}`);
  } catch {
    throw new LocalMutationError("请求主机格式不正确", 400);
  }
}

export function assertLocalJsonMutation(request: Request): void {
  const requestUrl = new URL(request.url);
  const host = parseHost(request.headers.get("host"), requestUrl.protocol);
  if (!LOOPBACK_HOSTS.has(host.hostname.toLowerCase())) {
    throw new LocalMutationError("仅允许本机访问", 403);
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim();
  if (mediaType !== "application/json") {
    throw new LocalMutationError("只接受 JSON 请求", 415);
  }

  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    return;
  }

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    throw new LocalMutationError("请求来源格式不正确", 403);
  }

  if (
    !LOOPBACK_HOSTS.has(origin.hostname.toLowerCase()) ||
    origin.protocol !== requestUrl.protocol ||
    origin.host.toLowerCase() !== host.host.toLowerCase()
  ) {
    throw new LocalMutationError("请求来源不匹配", 403);
  }
}
