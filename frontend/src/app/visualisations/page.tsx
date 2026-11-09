import type { Metadata } from "next";

import { UnderConstruction } from "@/components/ui/UnderConstruction";

export const metadata: Metadata = { title: "Visualisations" };

export default function VisualisationsPage() {
  return <UnderConstruction title="Visualisations" description="Cross-video dashboards and dataset-level trends." />;
}
