// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

/* =====================================================
   PGN utilities — robust tokenizer + game-tree parser
   ===================================================== */

/** Remove only *semicolon* comments (to end-of-line). Curly comments are kept as tokens. */
function stripSemicolonComments(input: string) {
  return input.replace(/;[^\n]*/g, "");
}

/** Basic header parsing following PGN tag-pair grammar. */
function parseHeaders(pgn: string) {
  const headers: Record<string, string> = {};
  const headerRegex = /^\s*\[([^\s"]+)\s+"([^"]*)"\]\s*$/gm;
  let m;
  while ((m = headerRegex.exec(pgn))) headers[m[1]] = m[2];
  return headers;
}

/** Split a .pgn file into individual games. */
function splitGames(pgnText: string) {
  const normalized = pgnText.replace(/\r\n?/g, "\n");
  // A bit more tolerant: first TagPair is always [Event ...]
  const indices: number[] = [];
  const re = /^\s*\[Event\b.*$/gim;
  let m;
  while ((m = re.exec(normalized))) indices.push(m.index);
  if (indices.length === 0) return normalized.trim() ? [normalized.trim()] : [];
  indices.push(normalized.length);
  const games: string[] = [];
  for (let i = 0; i < indices.length - 1; i++) {
    const chunk = normalized.slice(indices[i], indices[i + 1]).trim();
    if (chunk) games.push(chunk);
  }
  return games;
}

/** Extract only the movetext (after the header section). */
function extractMoveText(pgnGame: string) {
  const normalized = pgnGame.replace(/\r\n?/g, "\n");
  // Two blank lines typically separate tags from movetext; but be tolerant
  // Find last tag line and take from there.
  const lastTagMatch = [...normalized.matchAll(/^\s*\[[^\n]*\]\s*$/gm)].pop();
  if (lastTagMatch) {
    return normalized.slice(lastTagMatch.index! + lastTagMatch[0].length).trim();
  }
  const idx = normalized.search(/\n\n/);
  return idx !== -1 ? normalized.slice(idx + 2).trim() : normalized.trim();
}

/** Remove typographic minus signs etc from SAN but keep checks / mates for display copy. */
function sanitizeSANForMove(san: string) {
  return san
    .replace(/\u2212/g, "-") // typographic minus
    .replace(/\+!|\+\?|#!|#\?/g, (m) => m[0]) // "+!" → "+", "#!" → "#"
    .replace(/[!?]+/g, ""); // remove annotations that chess.js can't read
}

// Token types for movetext
const TT = {
  COMMENT: "COMMENT", // { ... }
  NAG: "NAG", // $1, $2, ...
  MOVE_NUM: "MOVE_NUM", // 12. or 12...
  RAV_START: "RAV_START", // (
  RAV_END: "RAV_END", // )
  RESULT: "RESULT", // 1-0, 0-1, 1/2-1/2, *
  SAN: "SAN", // any other non-space token
} as const;

/** Tokenizer compliant with PGN movetext (incl. comments, RAVs, NAGs). */
function tokenizeMovetext(raw: string) {
  const s = stripSemicolonComments(raw);
  const rx = /\{[^}]*\}|\$\d+|\d+\.(?:\.\.)?|1-0|0-1|1\/2-1\/2|\*|[()]+|[^\s()]+/g;
  const tokens: Array<{ t: string; v: string }> = [];
  let m;
  while ((m = rx.exec(s))) {
    const tok = m[0];
    if (tok[0] === "{") tokens.push({ t: TT.COMMENT, v: tok.slice(1, -1).trim() });
    else if (tok[0] === "$") tokens.push({ t: TT.NAG, v: tok });
    else if (/^\d+\.(?:\.\.)?$/.test(tok)) tokens.push({ t: TT.MOVE_NUM, v: tok });
    else if (tok === "(") tokens.push({ t: TT.RAV_START, v: tok });
    else if (tok === ")") tokens.push({ t: TT.RAV_END, v: tok });
    else if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) tokens.push({ t: TT.RESULT, v: tok });
    else tokens.push({ t: TT.SAN, v: tok });
  }
  return tokens;
}

/* ------------------- Game tree structures ------------------- */
let NODE_ID_SEQ = 1;
function nextId() {
  return NODE_ID_SEQ++;
}

/** A single played half-move. */
type PlyNode = {
  id: number;
  san: string; // shown
  sanClean: string; // for chess.js
  fenBefore: string;
  fenAfter: string;
  moveNumber: number; // fullmove number before this half-move (per FEN field 6)
  isWhite: boolean; // played by white?
  commentBefore?: string[];
  commentAfter?: string[];
  nags?: string[]; // "$1", "$3", ... for now
  parent: PlyNode | null; // previous ply in the same line
  variations?: Line[]; // alternatives branching from fenBefore right after *this token*
  lineRef?: Line; // backref to containing line
  indexInLine?: number;
};

/** A line = contiguous sequence of moves; may have preVariations that branch at the start position. */
type Line = {
  startFen: string;
  nodes: PlyNode[];
  preVariations?: Line[];
};

/**
 * Parse a movetext into a tree of Lines with RAVs (recursive annotation variations).
 * Works by reading tokens and recursing on ( ... ) blocks. NAGs and comments
 * are attached to the closest move (before/after semantics supported).
 */
function parseMovetextToTree(moveText: string, startFen?: string): { main: Line; mainlineFlat: PlyNode[] } {
  NODE_ID_SEQ = 1; // reset per game
  const tokens = tokenizeMovetext(moveText);

  function mkChess(fen?: string) {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }

  // Recursive descent: parse a single line until RAV_END or RESULT/EOF
  function parseLine(idx: number, startFenLocal: string): { line: Line; idx: number } {
    const chess = mkChess(startFenLocal);
    const line: Line = { startFen: startFenLocal, nodes: [], preVariations: [] };

    let pendingBefore: string[] = [];
    let lastWasMove = false;

    while (idx < tokens.length) {
      const tok = tokens[idx];
      if (tok.t === TT.RAV_END || tok.t === TT.RESULT) {
        if (tok.t === TT.RAV_END) idx++; // consume ')'
        break;
      }

      if (tok.t === TT.RAV_START) {
        const anchorFen = line.nodes.length ? line.nodes[line.nodes.length - 1].fenAfter : line.startFen;

        idx++;
        const { line: varLine, idx: nextIdx } = parseLine(idx, anchorFen);
        idx = nextIdx;

        if (line.nodes.length === 0) {
          line.preVariations!.push(varLine);
        } else {
          const holder = line.nodes[line.nodes.length - 1];
          if (!holder.variations) holder.variations = [];
          holder.variations.push(varLine);
        }
        lastWasMove = false;
        continue;
      }

      if (tok.t === TT.COMMENT) {
        if (lastWasMove && line.nodes.length) {
          const nd = line.nodes[line.nodes.length - 1];
          nd.commentAfter = (nd.commentAfter || []).concat(tok.v);
        } else pendingBefore.push(tok.v);
        idx++;
        continue;
      }

      if (tok.t === TT.NAG) {
        if (line.nodes.length) {
          const nd = line.nodes[line.nodes.length - 1];
          nd.nags = (nd.nags || []).concat(tok.v);
        }
        idx++;
        continue;
      }

      if (tok.t === TT.MOVE_NUM) {
        idx++;
        lastWasMove = false;
        continue;
      }

      if (tok.t === TT.SAN) {
        const san = tok.v;
        const sanClean = sanitizeSANForMove(san);

        const fenBefore = chess.fen();
        const fullmove = parseInt(fenBefore.split(" ")[5], 10) || 1;
        const isWhite = chess.turn() === "w";

        try {
          const mv = chess.move(sanClean, { sloppy: true });
          if (!mv) throw new Error("illegal");
        } catch (e) {
          idx++;
          continue;
        }

        const fenAfter = chess.fen();

        const node: PlyNode = {
          id: nextId(),
          san,
          sanClean,
          fenBefore,
          fenAfter,
          moveNumber: fullmove,
          isWhite,
          parent: line.nodes.length ? line.nodes[line.nodes.length - 1] : null,
          commentBefore: pendingBefore.length ? pendingBefore.slice() : undefined,
        };
        node.parent = line.nodes.length ? line.nodes[line.nodes.length - 1] : null;
        pendingBefore = [];
        lastWasMove = true;
        line.nodes.push(node);
        idx++;
        continue;
      }

      idx++;
    }

    // Backrefs for renderer/navigation
    line.nodes.forEach((n, i) => {
      n.lineRef = line;
      n.indexInLine = i;
    });

    return { line, idx };
  }

  const startFenActual = (() => {
    try {
      const c = startFen ? new Chess(startFen) : new Chess();
      return c.fen();
    } catch {
      return new Chess().fen();
    }
  })();

  const { line: main, idx } = parseLine(0, startFenActual);

  const mainlineFlat: PlyNode[] = [...main.nodes];

  return { main, mainlineFlat };
}

/* =====================================================
   FEN -> position object for react-chessboard
   ===================================================== */
const PIECE_LETTERS: Record<string, "K" | "Q" | "R" | "B" | "N" | "P"> = {
  k: "K",
  q: "Q",
  r: "R",
  b: "B",
  n: "N",
  p: "P",
};
function fenToObject(fen?: string) {
  const obj: Record<
    string,
    | "wK"
    | "wQ"
    | "wR"
    | "wB"
    | "wN"
    | "wP"
    | "bK"
    | "bQ"
    | "bR"
    | "bB"
    | "bN"
    | "bP"
  > = {} as any;
  if (!fen) return obj;
  const [placement] = String(fen).split(" ");
  const rows = placement.split("/");
  const files = "abcdefgh";
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) file += parseInt(ch, 10);
      else {
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

/* =====================================================
   UI styles
   ===================================================== */
const styles = {
  app: {
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    background: "#f7f7fb",
    minHeight: "100vh",
    color: "#111827",
  },
  container: { maxWidth: 1200, margin: "0 auto", padding: 16 },
  header: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: { fontSize: 24, fontWeight: 800 },
  controlsRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const },
  btn: {
    padding: "8px 12px",
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "solid" as const,
    borderColor: "#d1d5db",
    background: "white",
    cursor: "pointer",
    fontWeight: 600,
  },
  btnPrimary: {
    background: "#2563eb",
    borderWidth: 1,
    borderStyle: "solid" as const,
    borderColor: "#1d4ed8",
    color: "white",
  },
  btnToggleOn: {
    background: "#16a34a",
    borderWidth: 1,
    borderStyle: "solid" as const,
    borderColor: "#15803d",
    color: "white",
  },
  btnToggleOff: {
    background: "#9ca3af",
    borderWidth: 1,
    borderStyle: "solid" as const,
    borderColor: "#6b7280",
    color: "white",
  },
  btnDisabled: { opacity: 0.6, cursor: "not-allowed" as const },
  layout: { display: "flex", alignItems: "flex-start", gap: 16 },
  left: { width: 420 },
  right: {
    flex: 1,
    height: "70vh",
    overflowY: "auto" as const,
    background: "white",
    borderWidth: 1,
    borderStyle: "solid" as const,
    borderColor: "#e5e7eb",
    borderRadius: 16,
    padding: 12,
  },
  select: {
    width: "100%",
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid" as const,
    borderColor: "#d1d5db",
    background: "white",
    color: "#000",
  },
  textarea: {
    width: "100%",
    minHeight: 96,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid" as const,
    borderColor: "#d1d5db",
    background: "white",
    color: "#000",
    caretColor: "#000",
  },
  sectionGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
    marginBottom: 16,
  },
  card: {
    background: "white",
    borderWidth: 1,
    borderStyle: "solid" as const,
    borderColor: "#e5e7eb",
    borderRadius: 16,
    padding: 12,
  },
  moveNumber: { color: "#6b7280", paddingRight: 6 },
  flow: {
    fontSize: 14,
    lineHeight: 1.55,
    color: "#111827",
    whiteSpace: "pre-wrap" as const,
    wordWrap: "break-word" as const,
  },
  token: { marginRight: 6 },
  tokenMove: { fontWeight: 700, cursor: "pointer" },
  tokenActive: {
    background: "#FEF08A",
    border: "1px solid #F59E0B",
    borderRadius: 4,
    padding: "0 2px",
  },
  tokenComment: { fontStyle: "italic", color: "#15803d" },
  tokenParen: {
    background: "#f3f4f6",
    borderRadius: 8,
    padding: "2px 6px",
    marginRight: 6,
    display: "inline-block",
  },
  feedbackBad: { color: "#b91c1c", fontWeight: 700 },
  feedbackGood: { color: "#15803d", fontWeight: 700 },
  // Arena-like rows: left column for move number, right for content
  row: { display: "grid", gridTemplateColumns: "46px 1fr", alignItems: "baseline", marginBottom: 4 },
  noCol: { textAlign: "left", width: 46, color: "#6b7280" },
  // >>> NEW: mainline numbers in red, bold, left-aligned
  noColMain: { textAlign: "left", width: 46, color: "#dc2626", fontWeight: 800 },
  contentCol: { paddingLeft: 4 },
} as const;

// helper to indent nested variations inline
const variationIndent = (level: number) => ({ marginLeft: level * 16 });

/* =====================================================
   Main App
   ===================================================== */
export default function App() {
  const [rawPgn, setRawPgn] = useState("");
  const [games, setGames] = useState<string[]>([]);
  const [gameIndex, setGameIndex] = useState(0);
  const [headers, setHeaders] = useState<Record<string, string>>({});

  // Parsed structures
  const [treeMain, setTreeMain] = useState<Line | null>(null);
  const [mainlinePlies, setMainlinePlies] = useState<PlyNode[]>([]);

  // Board navigation uses a dynamic FEN history of the *currently shown path*
  const [fenHistory, setFenHistory] = useState<string[]>([new Chess().fen()]);
  const [step, setStep] = useState(0);
  const liveFen = fenHistory[step] || new Chess().fen();
  const boardPosition = useMemo(() => fenToObject(liveFen), [liveFen]);

  // UI
  const [boardSize, setBoardSize] = useState(400);
  const [training, setTraining] = useState(true);
  const [feedback, setFeedback] = useState<null | { ok: boolean; text: string }>(null);
  const feedbackTimer = useRef<any>(null);
  useEffect(() => () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current); }, []);

  // Animation
  const ANIM_MS = 300;
  const [isAnimating, setIsAnimating] = useState(false);
  const animTimerRef = useRef<any>(null);
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; }, [step]);

  // Moves pane autoscroll support
  const movesPaneRef = useRef<HTMLDivElement | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<number | null>(null);

  /* ---------------- Loaders ---------------- */
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

  /* ---------------- Re-parse when game changes ---------------- */
  useEffect(() => {
    if (!games.length) return;

    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    setIsAnimating(false);

    const g = games[gameIndex] || "";
    const hdrs = parseHeaders(g);
    const moveText = extractMoveText(g);

    // starting position per PGN tags
    const startFen = hdrs.SetUp === "1" && hdrs.FEN ? hdrs.FEN : undefined;

    const { main, mainlineFlat } = parseMovetextToTree(moveText, startFen);

    setHeaders(hdrs);
    setTreeMain(main);
    setMainlinePlies(mainlineFlat);

    // Build initial fen history for the whole mainline
    const fens: string[] = [main.startFen];
    for (const p of main.nodes) fens.push(p.fenAfter);
    setFenHistory(fens);
    setStep(0);
    setActiveNodeId(null);
  }, [games, gameIndex]);

  /* ---------------- Navigation helpers ---------------- */
  const cancelAnimation = () => {
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    animTimerRef.current = null;
    setIsAnimating(false);
  };
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
      if (idx >= frames.length) {
        setIsAnimating(false);
        return;
      }
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

  // Compute last from/to to highlight squares
  const lastFromTo = useMemo(() => {
    try {
      const chess = new Chess(fenHistory[0]);
      let last: any = null;
      for (let i = 1; i <= step; i++) {
        const prevFen = fenHistory[i - 1];
        const currFen = fenHistory[i];
        const moves = chess.moves({ verbose: true });
        let applied = null;
        for (const mv of moves) {
          const c2 = new Chess(prevFen);
          c2.move(mv);
          if (c2.fen() === currFen) {
            applied = mv;
            break;
          }
        }
        if (applied) {
          chess.move(applied);
          last = applied;
        } else {
          chess.load(currFen);
        }
      }
      return last ? { from: last.from, to: last.to } : null;
    } catch {
      return null;
    }
  }, [fenHistory, step]);

  const customSquareStyles = useMemo(() => {
    const s: Record<string, any> = {};
    if (lastFromTo) {
      s[lastFromTo.from] = { background: "rgba(250, 204, 21, 0.45)" };
      s[lastFromTo.to] = { background: "rgba(250, 204, 21, 0.75)" };
    }
    return s;
  }, [lastFromTo]);

  // Visible feedback helper
  const flash = (ok: boolean, text: string) => {
    setFeedback({ ok, text });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1200);
  };

  /* ---------------- Training / DnD ---------------- */
  const applyDrop = (sourceSquare: string, targetSquare: string) => {
    const baseFen = fenHistory[step];
    const chess = new Chess(baseFen);

    if (training && step < mainlinePlies.length) {
      // expected next move from MAINLINE ONLY
      let expected: any = null;
      try {
        const tmp = new Chess(baseFen);
        expected = tmp.move(mainlinePlies[step].sanClean, { sloppy: true });
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
          return false;
        }

        chess.move(userMove);
        const newFen = chess.fen();
        setFenHistory((prev) => [...prev.slice(0, step + 1), newFen]);
        setStep((s) => s + 1);
        flash(true, "Giusto!");
        return true;
      }
    }

    // Free play
    const move = chess.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
    if (!move) return false;
    const newFen = chess.fen();
    setFenHistory((prev) => [...prev.slice(0, step + 1), newFen]);
    setStep((s) => s + 1);
    return true;
  };

  const btnStyle = (disabled: boolean, extra: any = {}) => ({
    ...styles.btn,
    ...(disabled ? styles.btnDisabled : {}),
    ...extra,
  });

  const gameLabel = (hdrs: Record<string, string>) => {
    const white = hdrs.White || "Bianco";
    const black = hdrs.Black || "Nero";
    const event = hdrs.Event ? ` — ${hdrs.Event}` : "";
    const result = hdrs.Result ? ` (${hdrs.Result})` : "";
    return `${white} vs ${black}${event}${result}`;
  };

  /* ---------------- Rendering: recursive lines with clickable variations ---------------- */
  const goToNode = (node: PlyNode) => {
    // When opening a variation, disable training (view-only), as requested
    if (training && node.lineRef && treeMain && node.lineRef !== treeMain) setTraining(false);

    // Build FEN path from start to this node *and then continue to end of its line* so Next works
    const path: PlyNode[] = [];
    let cur: PlyNode | null = node;
    const seen = new Set<number>();
    while (cur) {
      if (seen.has(cur.id)) break; // safety
      seen.add(cur.id);
      path.push(cur);
      cur = cur.parent;
    }
    path.reverse();

    const startFen = (node.lineRef?.startFen) || fenHistory[0];
    const chess = new Chess(startFen);
    const fens = [chess.fen()];

    for (const p of path) {
      try { chess.move(p.sanClean, { sloppy: true }); fens.push(chess.fen()); } catch {}
    }

    if (node.lineRef) {
      for (let i = (node.indexInLine ?? 0) + 1; i < node.lineRef.nodes.length; i++) {
        const nxt = node.lineRef.nodes[i];
        try { chess.move(nxt.sanClean, { sloppy: true }); fens.push(chess.fen()); } catch { break; }
      }
    }

    setFenHistory(fens);
    setStep(path.length);
    setActiveNodeId(node.id);

    requestAnimationFrame(() => {
      if (!movesPaneRef.current) return;
      const activeEl = movesPaneRef.current.querySelector('[data-active="true"]') as HTMLElement | null;
      if (activeEl) {
        const top = activeEl.offsetTop - 60;
        movesPaneRef.current.scrollTo({ top, behavior: "smooth" });
      }
    });
  };

  function MoveLabel({ node }: { node: PlyNode }) {
    const isActive = activeNodeId === node.id || (step > 0 && fenHistory[step] === node.fenAfter);
    const label = node.isWhite ? `${node.moveNumber}.` : `${node.moveNumber}...`;
    const before = (node.commentBefore || []).join(" ");
    const after = (node.commentAfter || []).join(" ");

    return (
      <>
        <span style={{ ...styles.token, ...styles.moveNumber }}>{label}</span>
        {before ? (
          <span style={{ ...styles.token, ...styles.tokenComment }}>({before})</span>
        ) : null}
        <span
          data-active={isActive ? "true" : undefined}
          onClick={() => goToNode(node)}
          title={`Vai alla mossa ${label} ${node.san}`}
          style={{ ...styles.token, ...styles.tokenMove, ...(isActive ? styles.tokenActive : {}) }}
        >
          {node.san}
        </span>
        {after ? (
          <span style={{ ...styles.token, ...styles.tokenComment }}>({after})</span>
        ) : null}
      </>
    );
  }

  function RenderLine({ line }: { line: Line }) {
    const elements: React.ReactNode[] = [];

    // Variations attached at start position
    (line.preVariations || []).forEach((v, i) => {
      elements.push(
        <span key={`prev-${(line.startFen || "").slice(0, 16)}-${i}`} style={styles.tokenParen}>
          (<RenderLine line={v} />)
        </span>
      );
    });

    line.nodes.forEach((node, idx) => {
      elements.push(<MoveLabel key={`mv-${node.id}`} node={node} />);

      (node.variations || []).forEach((v, j) => {
        elements.push(
          <span key={`var-${node.id}-${j}`} style={styles.tokenParen}>
            (<RenderLine line={v} />)
          </span>
        );
      });
    });

    return <>{elements}</>;
  }

  /* ---------------- Flow content ---------------- */
  function VariationInline({ line, level = 1 }: { line: Line; level?: number }) {
    return (
      <span style={variationIndent(level)}>
        (
        <RenderLine line={line} />
        )
      </span>
    );
  }

  // >>> This renderer shows each half-move on its own row, with mainline numbers at left
  function RenderMain({ line }: { line: Line }) {
    const rows: React.ReactNode[] = [];

    (line.preVariations || []).forEach((v, i) => {
      rows.push(
        <div key={`pre-row-${i}`} style={styles.row}>
          <div style={styles.noCol}></div>
          <div style={styles.contentCol}><VariationInline line={v} level={1} /></div>
        </div>
      );
    });

    line.nodes.forEach((node) => {
      const isActive = (step > 0 && fenHistory[step] === node.fenAfter) || activeNodeId === node.id;
      const label = node.isWhite ? `${node.moveNumber}.` : `${node.moveNumber}...`;
      const before = (node.commentBefore || []).join(" ");
      const after = (node.commentAfter || []).join(" ");

      rows.push(
        <div key={`row-${node.id}`} style={styles.row}>
          {/* >>> RED left column for mainline numbers */}
          <div style={styles.noColMain}>{label}</div>
          <div style={styles.contentCol}>
            {before ? (<span style={{ ...styles.token, ...styles.tokenComment }}>({before})</span>) : null}
            <span
              data-active={isActive ? "true" : undefined}
              onClick={() => goToNode(node)}
              title={`Vai alla mossa ${label} ${node.san}`}
              style={{ ...styles.token, ...styles.tokenMove, ...(isActive ? styles.tokenActive : {}) }}
            >
              {node.san}
            </span>
            {after ? (<span style={{ ...styles.token, ...styles.tokenComment }}>({after})</span>) : null}
            {(node.variations || []).map((v, j) => (
              <VariationInline key={`var-inline-${node.id}-${j}`} line={v} level={1} />
            ))}
          </div>
        </div>
      );
    });

    return <>{rows}</>;
  }

  // >>> Use RenderMain (not RenderLine) in the moves pane
  const flow = useMemo(() => {
    if (!treeMain) return null;
    return <RenderMain line={treeMain} />;
  }, [treeMain, activeNodeId, fenHistory, step]);

  /* ---------------- JSX ---------------- */
  return (
    <div style={styles.app}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>PGN Viewer</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Allenamento sulla linea principale + visualizzazione varianti (cliccabili).
            </div>
          </div>
          <div style={styles.controlsRow}>
            <input type="file" accept=".pgn,.PGN,text/plain" onChange={handleFileChange} />
            <button style={btnStyle(isAnimating || step === 0)} onClick={goStart} disabled={isAnimating || step === 0} title="Inizio">⏮ Inizio</button>
            <button style={btnStyle(!(step > 0 && !isAnimating))} onClick={goPrev} disabled={!(step > 0 && !isAnimating)} title="Indietro">◀︎ Indietro</button>
            <button style={{ ...btnStyle(!(step < fenHistory.length - 1 && !isAnimating)), ...styles.btnPrimary }} onClick={goNext} disabled={!(step < fenHistory.length - 1 && !isAnimating)} title="Avanti">Avanti ▶︎</button>
            <button style={btnStyle(isAnimating || step === Math.max(0, fenHistory.length - 1))} onClick={goEnd} disabled={isAnimating || step === Math.max(0, fenHistory.length - 1)} title="Fine">Fine ⏭</button>
            <button
              onClick={() => setTraining((t) => !t)}
              style={{ ...styles.btn, ...(training ? styles.btnToggleOn : styles.btnToggleOff) }}
              title="Attiva/Disattiva modalità allenamento (solo linea principale)"
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
              <textarea
                style={styles.textarea}
                value={rawPgn}
                onChange={(e) => setRawPgn(e.target.value)}
                placeholder="Incolla qui il tuo PGN..."
              />
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

          <div style={styles.right} ref={movesPaneRef}>
            {!treeMain ? (
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Carica un PGN e seleziona una partita per vedere mosse, commenti e varianti.
              </div>
            ) : (
              <div style={styles.flow}>{flow}</div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 16, fontSize: 12, color: "#6b7280" }}>
          Suggerimento: in <b>Allenamento ON</b> è valida solo la prossima mossa della <b>linea principale</b>.
          Le <b>varianti</b> sono sempre cliccabili per esplorarle sulla scacchiera (view-only).
        </div>
      </div>
    </div>
  );
}
