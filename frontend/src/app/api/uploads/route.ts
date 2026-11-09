import { getServices } from "@/lib/server/container";
import { badRequest, handle, json } from "@/lib/server/http";
import type { UploadInfo } from "@/lib/shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `PUT /api/uploads` with the raw file as the body (not multipart, so it streams to disk
 * without parsing) and the name in `X-File-Name` (URI-encoded).
 */
export const PUT = handle(async (request: Request) => {
  const rawName = request.headers.get("x-file-name");
  if (!rawName) throw badRequest("The X-File-Name header is required.");
  let name: string;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    throw badRequest("X-File-Name must be URI-encoded.");
  }
  const length = request.headers.get("content-length");
  const declared = length !== null && /^\d+$/.test(length) ? Number(length) : undefined;

  const { uploads } = await getServices();
  const stored = await uploads.save(request.body, name, declared);
  const body: UploadInfo = { uploadId: stored.uploadId, fileName: stored.fileName, sizeBytes: stored.sizeBytes };
  return json(body, { status: 201 });
});
