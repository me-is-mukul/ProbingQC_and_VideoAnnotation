/** Top-level tabs. Add a tab here and create the matching app/<href>/page.tsx. */
export interface NavTab {
  href: string;
  label: string;
}

export const NAV_TABS: readonly NavTab[] = [
  { href: "/qc", label: "QC" },
  { href: "/annotation", label: "Annotation" },
  { href: "/visualisations", label: "Visualisations" },
];

/** The tab that owns `pathname` (exact match or a nested route). */
export function activeTab(pathname: string, tabs: readonly NavTab[] = NAV_TABS): NavTab | undefined {
  return tabs.find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`));
}
