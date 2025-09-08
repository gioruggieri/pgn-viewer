// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

/* ---------- Utilità PGN ---------- */
function stripVariations(input: string) {
  let depth = 0, out = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") depth++;
    if (depth === 0) out += ch;
    if (ch === ")" && depth > 0) depth--;
  }
  return out;
}
function parseHeaders(pgn: string) {
  const headers: Record<string, string> = {};
  const headerRegex = /^\s*\[([^\s"]+)\s+"([^"]*)"]\s*$/gm;
  let m;
  while ((m = headerRegex.exec(pgn))) headers[m[1]] = m[2];
  return headers;
}
function splitGames(pgnText: string) {
  const normalized = pgnText.replace(/\r\n?/g, "\n");
  const indices: number[] = [];
  const re = /^\s*\[Event\b.*$/gim;
  let m;
  while ((m = re.exec(normalized))) indices.push(m.index);
  if (indices.length === 0) return normalized.trim() ? [normalized] : [];
  indices.push(normalized.length);
  const games: string[] = [];
  for (let i = 0; i < indices.length - 1; i++) {
    const chunk = normalized.slice(indices[i], indices[i + 1]).trim();
    if (chunk) games.push(chunk);
  }
  return games;
}
function sanitizeSAN(san: string) {
  return san
    .replace(/\+\!|\+\?|\#\!|\#\?/g, (m) => m[0])
    .replace(/[!?]+/g, "")
    .replace(/\u2212/g, "-");
}
function parseMovesWithComments(gameText: string) {
  const noSemicolon = gameText.replace(/;[^\n]*/g, "");
  const body = stripVariations(noSemicolon);
  const tokens = body.match(/\{[^}]*\}|\d+\.(?:\.\.)?|\$\d+|1-0|0-1|1\/2-1\/2|\*|[^\s]+/g) || [];
  const plies: Array<{san: string; sanClean: string; commentBefore: string|null; commentAfter: string|null}> = [];
  let prevWasMove = false;
  let pendingCommentBefore: string|null = null;
  for (const tok of tokens) {
    if (/^\d+\.(?:\.\.)?$/.test(tok)) { prevWasMove = false; continue; }
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) { prevWasMove = false; continue; }
    if (/^\$\d+$/.test(tok)) { continue; }
    if (/^\{.*\}$/.test(tok)) {
      const comment = tok.slice(1, -1).trim();
      if (prevWasMove && plies.length > 0 && plies[plies.length - 1].commentAfter == null) {
        plies[plies.length - 1].commentAfter = comment;
      } else {
        pendingCommentBefore = (pendingCommentBefore ? pendingCommentBefore + " " : "") + comment;
      }
      continue;
    }
    const sanClean = sanitizeSAN(tok);
    plies.push({ san: tok, sanClean, commentBefore: pendingCommentBefore, commentAfter: null });
    pendingCommentBefore = null;
    prevWasMove = true;
  }
  if (pendingCommentBefore && plies.length) {
    plies[plies.length - 1].commentAfter = (plies[plies.length - 1].commentAfter ? plies[plies.length - 1].commentAfter + " " : "") + pendingCommentBefore;
  }
  return plies;
}
function extractMoveText(pgnGame: string) {
  const normalized = pgnGame.replace(/\r\n?/g, "\n");
  const headerEnd = normalized.lastIndexOf("]\n\n");
  if (headerEnd !== -1) return normalized.slice(headerEnd + 3).trim();
  const idx = normalized.search(/\n\n/);
  return idx !== -1 ? normalized.slice(idx + 2).trim() : normalized.trim();
}

/* ---------- FEN -> oggetto posizione ---------- */
const PIECE_LETTERS: Record<string, "K"|"Q"|"R"|"B"|"N"|"P"> = { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "P" };
function fenToObject(fen?: string) {
  const obj: Record<string, "wK"|"wQ"|"wR"|"wB"|"wN"|"wP"|"bK"|"bQ"|"bR"|"bB"|"bN"|"bP"> = {} as any;
  if (!fen) return obj;
  const [placement] = String(fen).split(" ");
  const rows = placement.split("/");
  const files = "abcdefgh";
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        file += parseInt(ch, 10);
      } else {
        const color = ch === ch.toUpperCase() ? "w" : "b";
        const piece = PIECE_LETTERS[ch.toLowerCase()];
        const square = `${files[file]}${8 - r}`;
        obj[square] = (color + piece) as any;
        file++;
      }
    }
  }
  return obj;
}

/* ---------- Stili ---------- */
const styles = {
  app: { fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", background: "#f7f7fb", minHeight: "100vh", color: "#111827" },
  container: { maxWidth: 1200, margin: "0 auto", padding: 16 },
  header: { display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 24, fontWeight: 800 },
  controlsRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const },
  btn: { padding: "8px 12px", borderRadius: 12, borderWidth: 1, borderStyle: "solid" as const, borderColor: "#d1d5db", background: "white", cursor: "pointer", fontWeight: 600 },
  btnPrimary: { background: "#2563eb", borderWidth: 1, borderStyle: "solid" as const, borderColor: "#1d4ed8", color: "white" },
  btnToggleOn: { background: "#16a34a", borderWidth: 1, borderStyle: "solid" as const, borderColor: "#15803d", color: "white" },
  btnToggleOff: { background: "#9ca3af", borderWidth: 1, borderStyle: "solid" as const, borderColor: "#6b7280", color: "white" },
  btnDisabled: { opacity: 0.6, cursor: "not-allowed" as const },
  layout: { display: "flex", alignItems: "flex-start", gap: 16 },
  left: { width: 420 },
  right: { flex: 1, height: "70vh", overflowY: "auto" as const, background: "white", borderWidth: 1, borderStyle: "solid" as const, borderColor: "#e5e7eb", borderRadius: 16, padding: 12 },
  select: { width: "100%", padding: 8, borderRadius: 10, borderWidth: 1, borderStyle: "solid" as const, borderColor: "#d1d5db", background: "white", color: "#000" },
  textarea: { width: "100%", minHeight: 96, padding: 8, borderRadius: 10, borderWidth: 1, borderStyle: "solid" as const, borderColor: "#d1d5db", background: "white", color: "#000", caretColor: "#000" },
  sectionGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 },
  card: { background: "white", borderWidth: 1, borderStyle: "solid" as const, borderColor: "#e5e7eb", borderRadius: 16, padding: 12 },
  moveNumber: { color: "#6b7280", paddingRight: 6 },
  flow: { fontSize: 14, lineHeight: 1.5, color: "#111827", whiteSpace: "pre-wrap" as const, wordWrap: "break-word" as const },
  token: { marginRight: 6 },
  tokenMove: { fontWeight: 700, cursor: "pointer" },
  tokenActive: { background: "#FEF08A", border: "1px solid #F59E0B", borderRadius: 4, padding: "0 2px" },
  tokenComment: { fontStyle: "italic", color: "#15803d" },
  feedbackBad: { color: "#b91c1c", fontWeight: 700 },
  feedbackGood: { color: "#15803d", fontWeight: 700 },
} as const;

export default function App() {
  const [rawPgn, setRawPgn] = useState("");
  const [games, setGames] = useState<string[]>([]);
  const [gameIndex, setGameIndex] = useState(0);
  const [plies, setPlies] = useState<any[]>([]);
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [fenHistory, setFenHistory] = useState<string[]>([new Chess().fen()]);
  const [step, setStep] = useState(0);
  const [boardSize, setBoardSize] = useState(400);
  const [training, setTraining] = useState(true);
  const [feedback, setFeedback] = useState<null | { ok: boolean; text: string }>(null);

  const liveFen = fenHistory[step] || new Chess().fen();
  const boardPosition = useMemo(() => fenToObject(liveFen), [liveFen]);

  const ANIM_MS = 300;
  const [isAnimating, setIsAnimating] = useState(false);
  const animTimerRef = useRef<any>(null);
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; }, [step]);

  const feedbackTimer = useRef<any>(null);
  useEffect(() => () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current); }, []);

  const movesPaneRef = useRef<HTMLDivElement|null>(null);

  // Carica PGN
  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const txt = String(reader.result || "");
      setRawPgn(txt);
      const splitted = splitGames(txt);
      setGames(splitted);
      setGameIndex(0);
    };
    reader.readAsText(file, "utf-8");
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFile(f);
    e.currentTarget.value = "";
  };
  const loadFromTextarea = () => {
    const splitted = splitGames(rawPgn);
    setGames(splitted);
    setGameIndex(0);
  };

  // Ricostruzione quando cambia partita
  useEffect(() => {
    if (!games.length) return;
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    setIsAnimating(false);

    const g = games[gameIndex] || "";
    const hdrs = parseHeaders(g);
    const moveText = extractMoveText(g);
    const parsedPlies = parseMovesWithComments(moveText);

    setHeaders(hdrs);
    setPlies(parsedPlies);

    const startFEN = hdrs.SetUp === "1" && hdrs.FEN ? hdrs.FEN : undefined;
    const chess = new Chess(startFEN);
    const fens = [chess.fen()];
    for (const p of parsedPlies) {
      try {
        chess.move(p.sanClean, { sloppy: true });
        fens.push(chess.fen());
      } catch (e) {
        console.warn("Mossa non valida (ignoro):", p.sanClean, e);
        break;
      }
    }
    setFenHistory(fens);
    setStep(0);
  }, [games, gameIndex]);

  // Navigazione + animazione
  const cancelAnimation = () => { if (animTimerRef.current) clearTimeout(animTimerRef.current); animTimerRef.current = null; setIsAnimating(false); };
  const animateToStep = (targetStep: number) => {
    cancelAnimation();
    const from = stepRef.current;
    const maxStep = Math.max(0, fenHistory.length - 1);
    const clamped = Math.max(0, Math.min(maxStep, targetStep));
    if (clamped === from) return;

    const dir = clamped > from ? 1 : -1;
    const frames: number[] = [];
    for (let i = from + dir; dir > 0 ? i <= clamped : i >= clamped; i += dir) frames.push(i);

    setIsAnimating(true);
    const play = (idx: number) => {
      if (idx >= frames.length) { setIsAnimating(false); return; }
      setStep(frames[idx]);
      animTimerRef.current = setTimeout(() => play(idx + 1), ANIM_MS + 40);
    };
    play(0);
  };
  const canPrev = step > 0 && !isAnimating;
  const canNext = step < fenHistory.length - 1 && !isAnimating;
  const goStart = () => animateToStep(0);
  const goEnd = () => animateToStep(fenHistory.length - 1);
  const goPrev = () => animateToStep(step - 1);
  const goNext = () => animateToStep(step + 1);

  const currentPlyIndex = Math.max(0, Math.min(step - 1, plies.length - 1));

  // Autoscroll del blocco mosse
  useEffect(() => {
    if (!movesPaneRef.current) return;
    const activeEl = movesPaneRef.current.querySelector('[data-active="true"]') as HTMLElement | null;
    if (activeEl) {
      const top = activeEl.offsetTop - 60;
      movesPaneRef.current.scrollTo({ top, behavior: "smooth" });
    }
  }, [currentPlyIndex]);

  // Evidenziazione da/verso
  const lastFromTo = useMemo(() => {
    try {
      const startFEN = headers.SetUp === "1" && headers.FEN ? headers.FEN : undefined;
      const chess = new Chess(startFEN);
      let last: any = null;
      for (let i = 0; i < currentPlyIndex + 1; i++) {
        const mv = chess.move(plies[i]?.sanClean, { sloppy: true });
        if (mv) last = mv;
      }
      return last ? { from: last.from, to: last.to } : null;
    } catch { return null; }
  }, [headers, plies, currentPlyIndex]);

  const customSquareStyles = useMemo(() => {
    const s: Record<string, any> = {};
    if (lastFromTo) {
      s[lastFromTo.from] = { background: "rgba(250, 204, 21, 0.45)" };
      s[lastFromTo.to] = { background: "rgba(250, 204, 21, 0.75)" };
    }
    return s;
  }, [lastFromTo]);

  // helper feedback
  const flash = (ok: boolean, text: string) => {
    setFeedback({ ok, text });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1200);
  };

  // Drag & drop
  const applyDrop = (sourceSquare: string, targetSquare: string) => {
    const baseFen = fenHistory[step];
    const chess = new Chess(baseFen);

    if (training && step < plies.length) {
      // mossa attesa dal PGN
      let expected: any = null;
      try {
        const tmp = new Chess(baseFen);
        expected = tmp.move(plies[step].sanClean, { sloppy: true });
      } catch {}
      if (expected) {
        const userMove = {
          from: sourceSquare,
          to: targetSquare,
          promotion: expected.promotion || "q",
        };
        const isSame =
          expected.from === userMove.from &&
          expected.to === userMove.to &&
          (expected.promotion || "q") === (userMove.promotion || "q");

        if (!isSame) {
          flash(false, "Mossa sbagliata, riprova.");
          return false; // fa tornare il pezzo alla casa di partenza
        }

        // corretta: applica e avanza
        chess.move(userMove);
        const newFen = chess.fen();
        setFenHistory((prev) => [...prev.slice(0, step + 1), newFen]);
        setStep((s) => s + 1);
        flash(true, "Giusto!");
        return true;
      }
      // se non riesco a calcolare expected, ricado su gioco libero
    }

    // Gioco libero (o oltre il PGN): accetta la mossa se legale
    const move = chess.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
    if (!move) return false;
    const newFen = chess.fen();
    setFenHistory((prev) => [...prev.slice(0, step + 1), newFen]);
    setStep((s) => s + 1);
    return true;
  };

  const btnStyle = (disabled: boolean, extra: any = {}) => ({ ...styles.btn, ...(disabled ? styles.btnDisabled : {}), ...extra });
  const gameLabel = (hdrs: Record<string, string>) => {
    const white = hdrs.White || "Bianco";
    const black = hdrs.Black || "Nero";
    const event = hdrs.Event ? ` — ${hdrs.Event}` : "";
    const result = hdrs.Result ? ` (${hdrs.Result})` : "";
    return `${white} vs ${black}${event}${result}`;
  };

  // Renderer testuale unico: mosse + commenti
  const flow = useMemo(() => {
    const elements: React.ReactNode[] = [];
    for (let i = 0; i < plies.length; i++) {
      const moveNo = Math.floor(i / 2) + 1;
      const isWhite = i % 2 === 0;
      const label = isWhite ? `${moveNo}.` : `${moveNo}...`;
      const before = plies[i].commentBefore ? `(${plies[i].commentBefore})` : "";
      const after = plies[i].commentAfter ? `(${plies[i].commentAfter})` : "";
      // etichetta mossa (numero)
      elements.push(<span key={`n${i}`} style={{ ...styles.token, ...styles.moveNumber }}>{label}</span>);
      // eventuale commento prima
      if (before) elements.push(<span key={`b${i}`} style={{ ...styles.token, ...styles.tokenComment }}>{before}</span>);
      // SAN cliccabile, evidenziata se attiva
      const isActive = i === currentPlyIndex;
      elements.push(
        <span
          key={`m${i}`}
          data-active={isActive ? "true" : undefined}
          onClick={() => animateToStep(i + 1)}
          title={`Vai alla mossa ${label} ${plies[i].san}`}
          style={{
            ...styles.token,
            ...styles.tokenMove,
            ...(isActive ? styles.tokenActive : {}),
          }}
        >
          {plies[i].san}
        </span>
      );
      // eventuale commento dopo
      if (after) elements.push(<span key={`a${i}`} style={{ ...styles.token, ...styles.tokenComment }}>{after}</span>);
    }
    return elements;
  }, [plies, currentPlyIndex]);

  return (
    <div style={styles.app}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>PGN Viewer</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Allenamento sulle mosse del PGN (trascina i pezzi sulla scacchiera).</div>
          </div>
          <div style={styles.controlsRow}>
            <input type="file" accept=".pgn,.PGN,text/plain" onChange={handleFileChange} />
            <button style={btnStyle(isAnimating || step === 0)} onClick={goStart} disabled={isAnimating || step === 0} title="Inizio">⏮ Inizio</button>
            <button style={btnStyle(!canPrev)} onClick={goPrev} disabled={!canPrev} title="Indietro">◀︎ Indietro</button>
            <button style={{ ...btnStyle(!canNext), ...styles.btnPrimary }} onClick={goNext} disabled={!canNext} title="Avanti">Avanti ▶︎</button>
            <button style={btnStyle(isAnimating || step === Math.max(0, fenHistory.length - 1))} onClick={goEnd} disabled={isAnimating || step === Math.max(0, fenHistory.length - 1)} title="Fine">Fine ⏭</button>
            <button
              onClick={() => setTraining(t => !t)}
              style={{ ...styles.btn, ...(training ? styles.btnToggleOn : styles.btnToggleOff) }}
              title="Attiva/Disattiva modalità allenamento PGN"
            >
              {training ? "Allenamento: ON" : "Allenamento: OFF"}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Dimensione scacchiera</span>
              <input type="range" min={300} max={520} value={boardSize} onChange={(e) => setBoardSize(Number(e.target.value))} />
              <span style={{ fontSize: 12, color: "#6b7280" }}>{boardSize}px</span>
            </div>
          </div>
        </div>

        <div style={styles.sectionGrid}>
          <div style={styles.card}>
            <div style={{ marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#000" }}>Partite nel PGN</div>
            <select
              style={styles.select}
              value={String(Math.min(gameIndex, Math.max(0, games.length - 1)))}
              onChange={(e) => setGameIndex(Number(e.target.value))}
            >
              {games.length ? (
                games.map((g, i) => (
                  <option key={i} value={String(i)} style={{ color: "#000" }}>
                    {gameLabel(parseHeaders(g))}
                  </option>
                ))
              ) : (
                <option style={{ color: "#000" }}>(nessuna partita)</option>
              )}
            </select>
          </div>
          <div style={styles.card}>
            <div style={{ marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#000" }}>Oppure incolla qui il PGN</div>
            <div style={{ display: "flex", gap: 8 }}>
              <textarea style={styles.textarea} value={rawPgn} onChange={(e) => setRawPgn(e.target.value)} placeholder="Incolla qui il tuo PGN..." />
              <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={loadFromTextarea}>Carica</button>
            </div>
          </div>
        </div>

        <div style={styles.layout}>
          <div style={styles.left}>
            <div style={{ borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 8px rgba(0,0,0,.08)" }}>
              <Chessboard
                key={step}
                id="main-board"
                position={boardPosition}
                arePiecesDraggable={true}
                onPieceDrop={applyDrop}
                boardWidth={boardSize}
                animationDuration={ANIM_MS}
                customSquareStyles={customSquareStyles}
              />
            </div>
            <div style={{ textAlign: "center", marginTop: 6, fontSize: 12, color: "#6b7280" }}>
              Posizione {step}/{Math.max(0, fenHistory.length - 1)}{isAnimating ? " — animazione..." : ""}
            </div>
            {feedback && (
              <div style={{ marginTop: 8, fontSize: 13, ...(feedback.ok ? styles.feedbackGood : styles.feedbackBad) }}>
                {feedback.text}
              </div>
            )}
          </div>

          {/* Pannello unico: mosse + commenti insieme */}
          <div style={styles.right} ref={movesPaneRef}>
            {plies.length === 0 ? (
              <div style={{ fontSize: 12, color: "#6b7280" }}>Carica un PGN e seleziona una partita per vedere mosse e commenti.</div>
            ) : (
              <div style={styles.flow}>{flow}</div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 16, fontSize: 12, color: "#6b7280" }}>
          Suggerimento: trascina i pezzi. In modalità <b>Allenamento ON</b> solo la mossa del PGN è accettata; se sbagli, il pezzo torna indietro e puoi riprovare.
        </div>
      </div>
    </div>
  );
}
