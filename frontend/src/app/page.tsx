import { redirect } from "next/navigation";

/** The QC tab is the landing page. */
export default function Home() {
  redirect("/qc");
}
