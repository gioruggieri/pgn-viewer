// @ts-nocheck
import React from "react";
import { Chess } from "chess.js";
import type { EngineLine } from "./useStockfish";

type EnginePanelProps = {
  lines: EngineLine[];
  onPlayLine: (idx: number) => void;
  thinking: boolean;
  depth: number;
  onSelectMove: (lineIndex: number, moveIndex: number) => void;
  baseFen: string;
  onPreviewFen?: (fen: string, e: React.MouseEvent) => void;
  onPreviewMove?: (e: React.MouseEvent) => void;
  onHidePreview?: () => void;
  t: (it: string, en: string) => string;
};

const moveContainerBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "4px 6px",
  borderRadius: 10,
  cursor: "pointer",
  transition: "background 0.15s ease, box-shadow 0.15s ease",
};

const moveTextStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.4,
  color: "#111827",
  fontWeight: 500,
};

const playButtonStyle: React.CSSProperties = {
  padding: "2px 10px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  background: "#fff",
  cursor: "pointer",
  fontSize: 12,
};

const movesWrapperStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 6,
  alignItems: "center",
};

function moveLabel(plyIndex: number, san: string) {
  const moveNumber = Math.floor(plyIndex / 2) + 1;
  const prefix = plyIndex % 2 === 0 ? `${moveNumber}.` : `${moveNumber}...`;
  return `${prefix} ${san}`;
}

export function EnginePanel({
  lines,
  onPlayLine,
  thinking,
  depth,
  onSelectMove,
  baseFen,
  onPreviewFen,
  onPreviewMove,
  onHidePreview,
  t,
}: EnginePanelProps) {
  const headerText = thinking ? t("Analisi in corso...", "Analyzing...") : t(`Profondita: ${depth}`, `Depth: ${depth}`);

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 8,
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>{headerText}</div>
      {lines.length === 0 ? (
        <div style={{ fontSize: 12, color: "#9ca3af" }}>{t("Nessuna linea (ancora)", "No lines yet")}</div>
      ) : (
        lines.map((l, i) => {
          const scoreLabel =
            l.mate != null
              ? `M${Math.abs(l.mate)}`
              : l.cp != null
              ? (l.cp / 100).toFixed(2)
              : "?";
          const pvSan = l.pvSan || [];
          const pvFens = l.pvFens || [];
          let fenSequence = pvFens;
          if (!fenSequence?.length || fenSequence.length < pvSan.length + 1) {
            try {
              const startFen = (pvFens && pvFens[0]) || baseFen;
              const rebuilt = [];
              const chess = new Chess(startFen);
              rebuilt.push(chess.fen());
              for (const san of pvSan) {
                const mv = chess.move(san, { sloppy: true });
                if (!mv) break;
                rebuilt.push(chess.fen());
              }
              if (rebuilt.length > (fenSequence?.length ?? 0)) fenSequence = rebuilt;
            } catch {}
          }

          return (
            <div
              key={i}
              style={{
                padding: "6px 0",
                borderTop: i ? "1px solid #f3f4f6" : undefined,
              }}
            >
              <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                <span>#{i + 1} - {scoreLabel} - d{l.depth}</span>
                <button
                  onClick={() => onPlayLine(i)}
                  style={playButtonStyle}
                  title={t("Gioca questa variante sulla scacchiera", "Play this line on the board")}
                >
                  {t("Gioca", "Play")}
                </button>
              </div>
              <div style={movesWrapperStyle}>
                {pvSan.map((san, moveIdx) => {
                  const fenAfter = fenSequence?.[moveIdx + 1] || null;
                  return (
                    <div
                      key={`pv-${i}-${moveIdx}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectMove(i, moveIdx)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectMove(i, moveIdx);
                        }
                      }}
                      onMouseEnter={(e) => {
                        if (fenAfter && onPreviewFen) onPreviewFen(fenAfter, e);
                      }}
                      onMouseMove={(e) => {
                        if (fenAfter && onPreviewMove) onPreviewMove(e);
                      }}
                      onMouseLeave={() => {
                        if (onHidePreview) onHidePreview();
                      }}
                      onFocus={(e) => {
                        if (fenAfter && onPreviewFen) onPreviewFen(fenAfter, e as any);
                      }}
                      onBlur={() => {
                        if (onHidePreview) onHidePreview();
                      }}
                      style={{
                        ...moveContainerBase,
                        boxShadow: "inset 0 0 0 1px #f3f4f6",
                      }}
                    >
                      <span style={moveTextStyle}>{moveLabel(moveIdx, san)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
