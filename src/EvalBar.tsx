export function EvalBar({ cp, mate, label }: { cp?: number; mate?: number; label?: string }) {
  const pct = scoreToPct(cp, mate);
  const score = formatScore(cp, mate);
  const tooltip = label
    ? score
    : mate != null ? `M${Math.abs(mate)}` : `${cp == null ? "—" : (cp / 100).toFixed(2)} · ${Math.round(pct * 100)}%`;

  return (
    <div role={label ? "img" : undefined} aria-label={label ? `${label}: ${score}` : undefined} style={{
      position: "relative",
      width: label ? "100%" : 18,
      height: "100%",
      borderRadius: 10,
      overflow: "hidden",
      border: "1px solid #e5e7eb",
      background: "#000",
      display: "flex",
      flexDirection: "column-reverse",
    }}>
      <div
        title={tooltip}
        style={{
          height: `${pct * 100}%`,
          background: "#fff", // parte bianca
          transition: "height 160ms ease",
        }}
      />
      {label && <span className="pgn-evaluation-score">{score}</span>}
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

function formatScore(cp?: number, mate?: number) {
  const value = mate ?? cp;
  if (value == null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return sign + (mate == null ? (Math.abs(value) / 100).toFixed(2) : `M${Math.abs(mate)}`);
}
