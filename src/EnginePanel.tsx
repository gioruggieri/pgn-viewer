// @ts-nocheck
import React from "react";
import type { EngineLine } from "./useStockfish";

export function EnginePanel({
  lines,
  onPlayLine,
  thinking,
  depth,
}: {
  lines: EngineLine[];
  onPlayLine: (idx: number) => void;
  thinking: boolean;
  depth: number;
}) {
  return (
    <div style={{
      border: "1px solid #e5e7eb",
      borderRadius: 12,
      padding: 8,
      background: "#fff",
    }}>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
        {thinking ? "Analisi in corso…" : `Profondità: ${depth}`}
      </div>
      {lines.length === 0 ? (
        <div style={{ fontSize: 12, color: "#9ca3af" }}>Nessuna linea (ancora)</div>
      ) : lines.map((l, i) => {
        const scoreLabel = l.mate != null ? `M${Math.abs(l.mate)}` :
          (l.cp!=null ? (l.cp/100).toFixed(2) : "—");
        return (
          <div key={i} style={{ padding: "4px 0", borderTop: i? "1px solid #f3f4f6" : undefined }}>
            <div style={{ fontWeight: 700 }}>
              #{i+1} · {scoreLabel} · d{l.depth}
              <button
                onClick={() => onPlayLine(i)}
                style={{
                  marginLeft: 8, padding: "2px 8px", borderRadius: 8,
                  border: "1px solid #d1d5db", background: "#fff", cursor: "pointer",
                }}
                title="Gioca questa variante sulla scacchiera"
              >
                ▶︎
              </button>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: "#111827" }}>
              {l.pvSan.join(" ")}
            </div>
          </div>
        );
      })}
    </div>
  );
}
