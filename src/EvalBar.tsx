// @ts-nocheck
import React from "react";

export function EvalBar({ cp, mate, turn }: { cp?: number; mate?: number; turn: "w"|"b" }) {
  // score lato White: positivo => meglio per White
  // Se tocca al Nero, invertiamo per “chi muove” visuale? chess.com mostra sempre vantaggio lato bianco.
  // Qui manteniamo “vantaggio per White”.
  const pct = scoreToPct(cp, mate); // 0..1 (0=nero vince, 1=bianco vince)

  return (
    <div style={{
      width: 18,
      height: "100%",
      borderRadius: 10,
      overflow: "hidden",
      border: "1px solid #e5e7eb",
      background: "#000",
      display: "flex",
      flexDirection: "column-reverse",
    }}>
      <div
        title={mate != null ? `M${Math.abs(mate)}` : `${fmtCp(cp)} · ${Math.round(pct*100)}%`}
        style={{
          height: `${pct * 100}%`,
          background: "#fff", // parte bianca
          transition: "height 160ms ease",
        }}
      />
    </div>
  );
}

function scoreToPct(cp?: number, mate?: number) {
  if (mate != null) {
    // mate per White positivo => 1, negativo => 0
    const s = mate > 0 ? 1 : 0;
    return s;
  }
  const x = Math.max(-900, Math.min(900, cp ?? 0));
  // mappa centipawns → win prob (soft)
  const prob = 1 / (1 + Math.exp(-x / 150)); // più ripida di 400 per una barra “responsiva”
  return prob; // 0..1
}

function fmtCp(cp?: number) {
  if (cp == null) return "—";
  return (cp/100).toFixed(2);
}
