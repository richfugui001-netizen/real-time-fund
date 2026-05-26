'use client';

import styles from './PositionLabel.module.css';

const cn = (...names) => names.filter(Boolean).join(' ');

export default function PositionLabel({ row, compact = false, muted = false, className = '' }) {
  if (!row) return <strong className={styles.empty}>--</strong>;
  const name = row.name || row.positionName || row.code || '--';
  return (
    <span className={cn(styles.positionLabel, compact && styles.compact, muted && styles.muted, className)}>
      <strong title={name}>{name}</strong>
      <span>
        {row.code ? <em>{row.code}</em> : null}
        {row.scopeName ? <b title={row.scopeTitle || row.scopeName}>{row.scopeName}</b> : null}
      </span>
    </span>
  );
}
