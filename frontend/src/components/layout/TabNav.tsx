"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { activeTab, NAV_TABS } from "@/config/navigation";

import styles from "./TabNav.module.css";

/** Segmented tab bar; the orange-tinted pill slides to the active tab. */
export function TabNav() {
  const pathname = usePathname() ?? "/";
  const active = activeTab(pathname);
  const index = Math.max(0, NAV_TABS.findIndex((t) => t.href === active?.href));

  return (
    <nav aria-label="Sections" className={styles.nav}>
      <ul className={styles.list} style={{ "--count": NAV_TABS.length, "--index": index } as React.CSSProperties}>
        {active && <li className={styles.indicator} aria-hidden="true" />}
        {NAV_TABS.map((tab) => {
          const current = tab.href === active?.href;
          return (
            <li key={tab.href}>
              <Link href={tab.href} className={styles.tab} data-active={current} aria-current={current ? "page" : undefined}>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
