/**
 * OrgAsmDevTools — Drop-in diagnostics panel for development.
 *
 * Usage:
 *   <OrgAsmDevTools pipeline={ws} registry={registry} />
 */

import { useState } from 'react';
import { ConnectionState } from '../controller';
import { useOrgAsmDiagnostics } from './useOrgAsmDiagnostics';
import type { DiagnosticsData } from './useOrgAsmDiagnostics';

interface DevToolsProps {
  pipeline?: {
    readonly state: ConnectionState;
    readonly stale: boolean;
    readonly messageCount?: number;
    readonly binaryMessageCount?: number;
  } | null;
  registry?: { readonly pendingCount: number } | null;
  /** Position on screen (default: 'bottom-right') */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** Initially collapsed (default: false) */
  defaultCollapsed?: boolean;
}

const STATE_COLORS: Record<string, string> = {
  [ConnectionState.Connected]: '#22c55e',
  [ConnectionState.Connecting]: '#f59e0b',
  [ConnectionState.Reconnecting]: '#f59e0b',
  [ConnectionState.Disconnected]: '#ef4444',
};

const STATE_LABELS: Record<string, string> = {
  [ConnectionState.Connected]: 'Connected',
  [ConnectionState.Connecting]: 'Connecting',
  [ConnectionState.Reconnecting]: 'Reconnecting',
  [ConnectionState.Disconnected]: 'Disconnected',
};

function getPositionStyle(position: string): Record<string, string | number> {
  switch (position) {
    case 'bottom-left': return { bottom: 12, left: 12 };
    case 'top-right': return { top: 12, right: 12 };
    case 'top-left': return { top: 12, left: 12 };
    default: return { bottom: 12, right: 12 };
  }
}

export function OrgAsmDevTools({
  pipeline,
  registry,
  position = 'bottom-right',
  defaultCollapsed = false,
}: DevToolsProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const diag = useOrgAsmDiagnostics({ pipeline, registry });

  const dotColor = STATE_COLORS[diag.connectionState] ?? '#6b7280';
  const stateLabel = STATE_LABELS[diag.connectionState] ?? diag.connectionState;
  const posStyle = getPositionStyle(position);

  const containerStyle: Record<string, string | number> = {
    position: 'fixed',
    ...posStyle,
    zIndex: 99999,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 11,
    lineHeight: '1.4',
    color: '#e5e7eb',
    background: 'rgba(17, 24, 39, 0.92)',
    border: '1px solid rgba(75, 85, 99, 0.5)',
    borderRadius: 6,
    padding: collapsed ? '4px 8px' : '8px 12px',
    minWidth: collapsed ? 0 : 180,
    backdropFilter: 'blur(8px)',
    cursor: collapsed ? 'pointer' : 'default',
    userSelect: 'none',
  };

  if (collapsed) {
    return (
      <div style={containerStyle} onClick={() => setCollapsed(false)} title="org-asm DevTools">
        <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: dotColor, marginRight: 4 }} />
        <span style={{ opacity: 0.6 }}>asm</span>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontWeight: 600, opacity: 0.5, letterSpacing: '0.05em' }}>org-asm</span>
        <span
          onClick={() => setCollapsed(true)}
          style={{ cursor: 'pointer', opacity: 0.4, fontSize: 13, lineHeight: '1' }}
          title="Collapse"
        >
          &times;
        </span>
      </div>
      <Row
        label={stateLabel}
        value={diag.stale ? 'STALE' : ''}
        dot={dotColor}
        valueColor={diag.stale ? '#f59e0b' : undefined}
      />
      <Row label="msg/s" value={String(diag.messageRate)} />
      <Row label="bin/s" value={String(diag.binaryMessageRate)} />
      {diag.pendingCommands > 0 && (
        <Row label="pending" value={String(diag.pendingCommands)} valueColor="#f59e0b" />
      )}
    </div>
  );
}

function Row({ label, value, dot, valueColor }: {
  label: string;
  value: string;
  dot?: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '1px 0' }}>
      <span style={{ opacity: 0.7 }}>
        {dot && (
          <span style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: dot,
            marginRight: 5,
            verticalAlign: 'middle',
          }} />
        )}
        {label}
      </span>
      {value && <span style={{ color: valueColor ?? '#e5e7eb' }}>{value}</span>}
    </div>
  );
}
