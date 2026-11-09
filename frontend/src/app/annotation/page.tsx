import type { Metadata } from "next";

import { UnderConstruction } from "@/components/ui/UnderConstruction";

export const metadata: Metadata = { title: "Annotation" };

export default function AnnotationPage() {
  return <UnderConstruction title="Annotation" description="Frame-level labelling of hands, objects and probing events." />;
}
