import type { Metadata } from "next";

import { QCWorkspace } from "@/features/qc/QCWorkspace";

export const metadata: Metadata = { title: "Quality control" };

/** Static shell; all interactivity lives in the client-side workspace. */
export default function QCPage() {
  return <QCWorkspace />;
}
