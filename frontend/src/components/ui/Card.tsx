import styles from "./Card.module.css";

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  as?: "section" | "div" | "article";
  padded?: boolean;
}

export function Card({ as: Tag = "section", padded = true, className, ...props }: CardProps) {
  return <Tag className={[styles.card, padded && styles.padded, className].filter(Boolean).join(" ")} {...props} />;
}
