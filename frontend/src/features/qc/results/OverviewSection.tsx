import { StatTile } from "@/components/charts/StatTile";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { QCResults } from "@/lib/shared/types";

import styles from "./results.module.css";
import { Section } from "./Section";
import { integrityFlags, overviewTiles } from "./selectors";

export function OverviewSection({ results }: { results: QCResults }) {
  const messages = results.report.technical.decode_errors.messages;
  return (
    <Section id="overview" title="Overview" description="Container metadata and decode integrity for the analysed window.">
      <div className={styles.tiles}>
        {overviewTiles(results).map((t) => (
          <StatTile key={t.label} label={t.label} value={t.value} detail={t.detail} />
        ))}
      </div>
      <ul className={styles.flags} aria-label="Integrity checks">
        {integrityFlags(results).map((f) => (
          <li key={f.label}>
            <StatusBadge status={f.status}>{f.label}</StatusBadge>
            {f.detail && <span className={styles.flagDetail}>{f.detail}</span>}
          </li>
        ))}
      </ul>
      {messages.length > 0 && (
        <pre className={styles.messages} aria-label="FFmpeg decode errors">
          {messages.join("\n")}
        </pre>
      )}
    </Section>
  );
}
