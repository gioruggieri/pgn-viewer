// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

// === Nuovi import (file separati) ===
import { useStockfish } from "./useStockfish";
import { EvalBar } from "./EvalBar";
import { EnginePanel } from "./EnginePanel";

/* =====================================================
   PGN utilities — robust tokenizer + game-tree parser
   (== invariati dal tuo file, salvo piccole aggiunte in fondo)
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

/** Compatibilità con marcatori esterni + pulizia detriti engine */
function preprocessExternalMarkers(pgnText: string) {
  let t = pgnText.replace(/\r\n?/g, "\n");
  t = t.replace(/@@StartBracket@@([\s\S]*?)@@EndBracket@@/g, (_, inside) => {
    const s = String(inside || "").trim();
    return s ? `{ ${s} }` : "";
  });
  t = t.replace(/@@StartFEN@@([\s\S]*?)@@EndFEN@@/g, (_, fen) => {
    const s = String(fen || "").trim();
    return s ? `{FEN: ${s}}` : "";
  });
  t = t.replace(/@@(?:Start|End)[A-Za-z]+@@/g, "");
  t = t.replace(/\[\%[^\]]*\]/g, "");
  t = t.replace(/\(RR\)/g, "");
  t = t.replace(/\(\s*\)/g, "");
  return t;
}

/** Split a .pgn file into individual games. */
function splitGames(pgnText: string) {
  const normalized = pgnText.replace(/\r\n?/g, "\n");
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
  const lastTagMatch = [...normalized.matchAll(/^\s*\[[^\n]*\]\s*$/gm)].pop();
  if (lastTagMatch) {
    return normalized.slice(lastTagMatch.index! + lastTagMatch[0].length).trim();
  }
  const idx = normalized.search(/\n\n/);
  return idx !== -1 ? normalized.slice(idx + 2).trim() : normalized.trim();
}

/** Sanitize SAN for chess.js but keep +/# for display. */
function sanitizeSANForMove(san: string) {
  return san
    .replace(/\u2212/g, "-")
    .replace(/\+!|\+\?|#!|#\?/g, (m) => m[0])
    .replace(/[!?]+/g, "");
}

// Token types for movetext
const TT = {
  COMMENT: "COMMENT",
  NAG: "NAG",
  MOVE_NUM: "MOVE_NUM",
  RAV_START: "RAV_START",
  RAV_END: "RAV_END",
  RESULT: "RESULT",
  SAN: "SAN",
} as const;

/** Tokenizer compliant with PGN movetext. */
function tokenizeMovetext(raw: string) {
  const s = stripSemicolonComments(raw);
  const rx = /\{[^}]*\}|\$\d+|\d+\.(?:\.\.|…)?|1-0|0-1|1\/2-1\/2|\*|[()]+|[^\s()]+/g;
  const tokens: Array<{ t: string; v: string }> = [];
  let m;
  while ((m = rx.exec(s))) {
    const tok = m[0];
    if (tok[0] === "{") tokens.push({ t: TT.COMMENT, v: tok.slice(1, -1).trim() });
    else if (tok[0] === "$") tokens.push({ t: TT.NAG, v: tok });
    else if (/^\d+\.(?:\.\.|…)?$/.test(tok)) tokens.push({ t: TT.MOVE_NUM, v: tok });
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

let LINE_ID_SEQ = 1;
function nextLineId() {
  return LINE_ID_SEQ++;
}

type PlyNode = {
  id: number;
  san: string;
  sanClean: string;
  fenBefore: string;
  fenAfter: string;
  moveNumber: number;
  isWhite: boolean;
  commentBefore?: string[];
  commentAfter?: string[];
  nags?: string[];
  parent: PlyNode | null;
  variations?: Line[];
  lineRef?: Line;
  indexInLine?: number;
};

type Line = {
  lid: number;
  startFen: string;
  nodes: PlyNode[];
  preVariations?: Line[];
};

function sideFromFen(fen: string): "w" | "b" {
  try {
    return fen.split(" ")[1] === "b" ? "b" : "w";
  } catch {
    return "w";
  }
}

function parseMovetextToTree(moveText: string, startFen?: string): { main: Line; mainlineFlat: PlyNode[] } {
  NODE_ID_SEQ = 1;
  LINE_ID_SEQ = 1;

  const tokens = tokenizeMovetext(moveText);

  function mkChess(fen?: string) {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }

  function parseLine(idx: number, startFenLocal: string): { line: Line; idx: number } {
    const chess = mkChess(startFenLocal);
    const line: Line = { lid: nextLineId(), startFen: startFenLocal, nodes: [], preVariations: [] };

    let pendingBefore: string[] = [];
    let lastWasMove = false;

    while (idx < tokens.length) {
      const tok = tokens[idx];
      if (tok.t === TT.RAV_END || tok.t === TT.RESULT) {
        if (tok.t === TT.RAV_END) idx++;
        break;
      }

      if (tok.t === TT.RAV_START) {
        const lastNode = line.nodes.length ? line.nodes[line.nodes.length - 1] : null;
        let anchorFen = lastNode ? lastNode.fenAfter : line.startFen;

        let j = idx + 1;
        while (j < tokens.length && (tokens[j].t === TT.COMMENT || tokens[j].t === TT.NAG)) j++;

        if (j < tokens.length && tokens[j].t === TT.MOVE_NUM && lastNode) {
          const wantsBlack = /…|\.\.\.$/.test(tokens[j].v);
          const desired: "w" | "b" = wantsBlack ? "b" : "w";
          const current = sideFromFen(anchorFen);
          if (current !== desired) {
            anchorFen = lastNode.fenBefore;
          }
        }

        idx++;
        const { line: varLine, idx: nextIdx } = parseLine(idx, anchorFen);
        idx = nextIdx;

        if (line.nodes.length === 0) line.preVariations!.push(varLine);
        else {
          const holder = line.nodes[line.nodes.length - 1];
          (holder.variations || (holder.variations = [])).push(varLine);
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
        } catch {
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

  const { line: main } = parseLine(0, startFenActual);
  const mainlineFlat: PlyNode[] = [...main.nodes];
  return { main, mainlineFlat };
}

/* =====================================================
   UI styles (immutati, con micro-estensioni)
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
    color: "#111827",
    cursor: "pointer",
    fontWeight: 600,
    whiteSpace: "nowrap" as const,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
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
  btnDisabled: {
    background: "#f3f4f6",
    borderColor: "#e5e7eb",
    color: "#9ca3af",
    cursor: "not-allowed" as const,
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
    overflow: "auto",
    resize: "vertical" as const,
    minHeight: 120,
  },

  layout: { display: "flex", alignItems: "stretch", gap: 8, minHeight: "50vh" },
  left: { display: "flex", flexDirection: "column", gap: 8 },
  splitter: {
    width: 6,
    cursor: "col-resize",
    alignSelf: "stretch",
    background: "#e5e7eb",
    borderRadius: 6,
  },
  splitterActive: { background: "#c7d2fe" },

  right: {
    flex: 1,
    height: "70vh",
    overflow: "auto" as const,
    resize: "vertical" as const,
    background: "white",
    borderWidth: 1,
    borderStyle: "solid" as const,
    borderColor: "#e5e7eb",
    borderRadius: 16,
    padding: 12,
    minHeight: 220,
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
    resize: "vertical" as const,
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
    scrollMarginTop: 60,
    scrollMarginBottom: 60,
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

  row: {
    display: "grid",
    gridTemplateColumns: "60px 1fr",
    alignItems: "baseline",
    marginBottom: 4,
  },
  noCol: {
    textAlign: "left",
    width: 60,
    color: "#6b7280",
    whiteSpace: "nowrap" as const,
    fontVariantNumeric: "tabular-nums",
  },
  noColMain: {
    textAlign: "left",
    width: 60,
    color: "#dc2626",
    fontWeight: 800,
    whiteSpace: "nowrap" as const,
    fontVariantNumeric: "tabular-nums",
  },
  contentCol: { paddingLeft: 4 },

  fenBadge: {
    display: "inline-block",
    padding: "0 6px",
    borderRadius: 8,
    border: "1px solid #c7d2fe",
    background: "#eef2ff",
    fontSize: 12,
    cursor: "pointer",
    marginRight: 6,
  },

  variantBlock: {
    marginTop: 6,
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    background: "#fafafa",
  },
  variantHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    fontSize: 12,
    color: "#374151",
    cursor: "pointer",
    userSelect: "none" as const,
    borderBottom: "1px solid #e5e7eb",
  },
  variantCount: { fontWeight: 700, color: "#111827" },
  variantList: { padding: "6px 8px" },
  variantRow: { display: "block", padding: "2px 0", fontSize: 13 },
  variantBullet: { display: "inline-block", width: 14, color: "#6b7280" },
  variantMove: { marginRight: 6, cursor: "pointer", fontWeight: 400 as const },
  variantMoveDim: { color: "#6b7280", fontWeight: 400 as const },

  variantLineHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    cursor: "pointer",
    userSelect: "none" as const,
    padding: "2px 0",
  },
  variantPreview: { fontSize: 13, fontWeight: 400 as const },
} as const;

const variationIndent = (level: number) => ({ marginLeft: level * 16 });

/* =====================================================
   Main App
   ===================================================== */
export default function App() {
  const [rawPgn, setRawPgn] = useState("");
  const [games, setGames] = useState<string[]>([]);
  const [gameIndex, setGameIndex] = useState(0);
  const [headers, setHeaders] = useState<Record<string, string>>({});

  const [treeMain, setTreeMain] = useState<Line | null>(null);
  const [mainlinePlies, setMainlinePlies] = useState<PlyNode[]>([]);

  const [fenHistory, setFenHistory] = useState<string[]>([new Chess().fen()]);
  const [step, setStep] = useState(0);
  const liveFen = fenHistory[step] || new Chess().fen();

  // === dimensioni/resize ===
  const [leftWidth, setLeftWidth] = useState(440);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const startWRef = useRef(440);
  const minLeft = 320;
  const maxLeft = 820;

  const onSplitDown = (e: React.MouseEvent) => {
    setDragging(true);
    startXRef.current = e.clientX;
    startWRef.current = leftWidth;
    window.addEventListener("mousemove", onSplitMove);
    window.addEventListener("mouseup", onSplitUp);
    e.preventDefault();
  };
  const onSplitMove = (e: MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startXRef.current;
    const next = Math.min(maxLeft, Math.max(minLeft, startWRef.current + dx));
    setLeftWidth(next);
  };
  const onSplitUp = () => {
    setDragging(false);
    window.removeEventListener("mousemove", onSplitMove);
    window.removeEventListener("mouseup", onSplitUp);
  };
  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onSplitMove);
      window.removeEventListener("mouseup", onSplitUp);
    };
  }, []);

  // Board size (slider) + clamp alla colonna sinistra
  const [boardSize, setBoardSize] = useState(400);
  const boardRenderWidth = Math.min(boardSize, Math.floor(leftWidth));

  // training & feedback
  const [training, setTraining] = useState(true);
  const [feedback, setFeedback] = useState<null | { ok: boolean; text: string }>(null);
  const feedbackTimer = useRef<any>(null);
  useEffect(() => () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current); }, []);

  // animazione
  const ANIM_MS = 300;
  const [isAnimating, setIsAnimating] = useState(false);
  const animTimerRef = useRef<any>(null);
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; }, [step]);

  // pannello mosse
  const movesPaneRef = useRef<HTMLDivElement | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<number | null>(null);

  // Tooltip mini-board
  const [preview, setPreview] = useState<{ fen: string | null; x: number; y: number; visible: boolean }>({
    fen: null, x: 0, y: 0, visible: false,
  });
  const showPreview = (fen: string, e: React.MouseEvent) => setPreview({ fen, x: e.clientX, y: e.clientY, visible: true });
  const movePreview = (e: React.MouseEvent) => setPreview((p) => (p.visible ? { ...p, x: e.clientX, y: e.clientY } : p));
  const hidePreview = () => setPreview((p) => ({ ...p, visible: false }));

  // Vista varianti
  const [variantView, setVariantView] = useState<'tree' | 'inline'>('tree');
  const [openVars, setOpenVars] = useState<Record<number, boolean>>({});
  const [openLines, setOpenLines] = useState<Record<number, boolean>>({});

  // keep active token visible
  const ensureActiveVisible = (behavior: ScrollBehavior = "smooth") => {
    const pane = movesPaneRef.current;
    if (!pane) return;
    const activeEl = pane.querySelector('[data-active="true"]') as HTMLElement | null;
    if (!activeEl) return;
    activeEl.scrollIntoView({ block: "center", inline: "nearest", behavior });
  };
  useEffect(() => {
    const id = requestAnimationFrame(() => ensureActiveVisible("smooth"));
    return () => cancelAnimationFrame(id);
  }, [step, fenHistory]);

  /* ---------------- Loaders ---------------- */
  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const txt = String(reader.result || "");
      setRawPgn(txt);
      const pre = preprocessExternalMarkers(txt);
      const splitted = splitGames(pre);
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
    const pre = preprocessExternalMarkers(rawPgn);
    const splitted = splitGames(pre);
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
    const startFen = hdrs.SetUp === "1" && hdrs.FEN ? hdrs.FEN : undefined;

    const { main, mainlineFlat } = parseMovetextToTree(moveText, startFen);

    setHeaders(hdrs);
    setTreeMain(main);
    setMainlinePlies(mainlineFlat);

    const fens: string[] = [main.startFen];
    for (const p of main.nodes) fens.push(p.fenAfter);
    setFenHistory(fens);
    setStep(0);
    setActiveNodeId(null);
    setOpenVars({});
    setOpenLines({});
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
      animTimerRef.current = setTimeout(() => {
        ensureActiveVisible("auto");
        play(idx + 1);
      }, ANIM_MS + 40);
    };
    play(0);
  };

  const goStart = () => animateToStep(0);
  const goEnd = () => animateToStep(fenHistory.length - 1);
  const goPrev = () => animateToStep(stepRef.current - 1);
  const goNext = () => animateToStep(stepRef.current + 1);

  // evidenzia ultimi from/to
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

  // messaggi brevi
  const flash = (ok: boolean, text: string) => {
    setFeedback({ ok, text });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1400);
  };

  /* =====================================================
     Engine: stato e integrazione
     ===================================================== */
  const { ready, thinking, lines, engineErr, analyze, stop } = useStockfish();
  const [engineOn, setEngineOn] = useState(false);
  const [engineDepth, setEngineDepth] = useState(18);
  const [engineMPV, setEngineMPV] = useState(3);

  // Best-move overlay
  const [showBestArrow, setShowBestArrow] = useState(false); // toggle utente
  const [showBestOnce, setShowBestOnce] = useState(false);   // usato dal blunder helper
  const showBestArrowEffective = showBestArrow || showBestOnce;

  // Rotazione scacchiera
  const [whiteOrientation, setWhiteOrientation] = useState(true);

  // analizza quando cambia la posizione (se engine ON)
  useEffect(() => {
    if (!engineOn || !ready) return;
    analyze(liveFen, { depth: engineDepth, multipv: engineMPV });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineOn, ready, liveFen, engineDepth, engineMPV]);

  // primo tratto UCI -> freccia [from,to]
  const bestArrow: [string, string] | null = useMemo(() => {
    const best = lines?.[0];
    if (!best || !best.pvUci?.length) return null;
    const u0 = best.pvUci[0];
    if (!u0 || u0.length < 4) return null;
    return [u0.slice(0, 2), u0.slice(2, 4)];
  }, [lines]);

  // arrows per il board
  const boardArrows = useMemo(() => {
    if (!engineOn || !bestArrow || !showBestArrowEffective) return [];
    return [bestArrow];
  }, [engineOn, bestArrow, showBestArrowEffective]);

  /* ---------------- Training / DnD ---------------- */
  const applyDrop = (sourceSquare: string, targetSquare: string) => {
    const baseFen = fenHistory[stepRef.current];
    const chess = new Chess(baseFen);

    if (training && stepRef.current < mainlinePlies.length) {
      let expected: any = null;
      try {
        const tmp = new Chess(baseFen);
        expected = tmp.move(mainlinePlies[stepRef.current].sanClean, { sloppy: true });
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
          // Blunder helper: se il motore è acceso e abbiamo la best line, mostra freccia per pochi secondi
          if (engineOn) {
            if (!thinking) analyze(baseFen, { depth: engineDepth, multipv: Math.max(1, engineMPV) });
            setShowBestOnce(true);
            setTimeout(() => setShowBestOnce(false), 3000);
          }
          return false;
        }

        chess.move(userMove);
        const newFen = chess.fen();
        setFenHistory((prev) => [...prev.slice(0, stepRef.current + 1), newFen]);
        setStep((s) => s + 1);
        flash(true, "Giusto!");
        // quando esegui correttamente, togli l’hint “once”
        setShowBestOnce(false);
        return true;
      }
    }

    const move = chess.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
    if (!move) return false;
    const newFen = chess.fen();
    setFenHistory((prev) => [...prev.slice(0, stepRef.current + 1), newFen]);
    setStep((s) => s + 1);
    // fuori dal training togli l’hint “once”
    setShowBestOnce(false);
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

  /* ---------------- Commenti con badge + anteprima FEN ---------------- */
  function CommentTokens({ texts }: { texts?: string[] }) {
    if (!texts || !texts.length) return null;
    return (
      <>
        {texts.map((text, i) => {
          const m = String(text || "").match(/FEN\s*:?\s*([^\}]+)/i);
          if (m) {
            const fen = m[1].trim();
            return (
              <span
                key={`fen-${i}`}
                style={styles.fenBadge}
                title="Anteprima diagramma — clic per aprire"
                onClick={() => {
                  try {
                    const c = new Chess(fen);
                    const newFen = c.fen();
                    setFenHistory([newFen]);
                    setStep(0);
                    setActiveNodeId(null);
                    setTraining(false);
                  } catch {}
                }}
                onMouseEnter={(e) => showPreview(fen, e)}
                onMouseMove={(e) => movePreview(e)}
                onMouseLeave={hidePreview}
              >
                Diagramma
              </span>
            );
          }
          return (
            <span key={`c-${i}`} style={{ ...styles.token, ...styles.tokenComment }}>
              ({text})
            </span>
          );
        })}
      </>
    );
  }

  /* ---------------- Varianti: blocco “ad albero” (toggle per nodo) ---------------- */
  function VariantBlock({ node }: { node: PlyNode }) {
    const vars = node.variations || [];
    if (!vars.length) return null;

    const open = !!openVars[node.id];
    const toggle = () => setOpenVars((s) => ({ ...s, [node.id]: !open }));

    const letter = (i: number) => String.fromCharCode("A".charCodeAt(0) + i);

    return (
      <div style={styles.variantBlock}>
        <div style={styles.variantHeader} onClick={toggle}>
          <span>{open ? "▼" : "▶"}</span>
          <span>Varianti</span>
          <span style={styles.variantCount}>({vars.length})</span>
        </div>
        {open && (
          <div style={styles.variantList}>
            {vars.map((line, idx) => (
              <VariantBranchTree
                key={`v-${node.id}-${idx}`}
                line={line}
                depth={1}
                label={letter(idx)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  function linePreview(line: Line, maxPlies = 6) {
    const parts: string[] = [];
    for (let i = 0; i < Math.min(maxPlies, line.nodes.length); i++) {
      const n = line.nodes[i];
      const num = n.isWhite ? `${n.moveNumber}.` : `${n.moveNumber}...`;
      parts.push(i === 0 ? `${num} ${n.san}` : n.san);
    }
    if (line.nodes.length > maxPlies) parts.push("…");
    return parts.join(" ");
  }

  function VariantBranchTree({
    line,
    depth = 1,
    label,
  }: {
    line: Line;
    depth?: number;
    label: string;
  }) {
    const open = openLines[line.lid] ?? (depth <= 1);
    const toggle = () => setOpenLines((s) => ({ ...s, [line.lid]: !open }));
    const letter = (i: number) => String.fromCharCode("A".charCodeAt(0) + i);

    return (
      <div style={variationIndent(depth)}>
        <div style={styles.variantLineHeader} onClick={toggle}>
          <span>{open ? "▼" : "▶"}</span>
          <span style={styles.variantBullet}>{label}</span>
          <span style={styles.variantPreview}>{linePreview(line)}</span>
        </div>

        {open && (
          <div style={{ paddingLeft: 16 }}>
            {(line.preVariations || []).map((pre, x) => (
              <VariantBranchTree key={`pre-${line.lid}-${x}`} line={pre} depth={depth + 1} label={letter(x)} />
            ))}

            {line.nodes.map((n) => {
              const num = n.isWhite ? `${n.moveNumber}.` : `${n.moveNumber}...`;
              const isActive = activeNodeId === n.id || (step > 0 && fenHistory[step] === n.fenAfter);

              return (
                <div key={`n-${n.id}`} style={{ padding: "2px 0" }}>
                  <span style={{ ...styles.variantMove, ...styles.variantMoveDim }}>{num}</span>
                  <CommentTokens texts={n.commentBefore} />
                  <span
                    data-active={isActive ? "true" : undefined}
                    onClick={() => goToNode(n)}
                    title={`Vai a ${num} ${n.san}`}
                    style={{ ...styles.variantMove, ...(isActive ? styles.tokenActive : {}) }}
                  >
                    {n.san}
                  </span>
                  <CommentTokens texts={n.commentAfter} />
                  {(n.variations || []).map((sub, k) => (
                    <VariantBranchTree key={`sub-${n.id}-${k}`} line={sub} depth={depth + 1} label={letter(k)} />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ---------------- Rendering (inline + main) ---------------- */
  const goToNode = (node: PlyNode) => {
    if (training && node.lineRef && treeMain && node.lineRef !== treeMain) setTraining(false);

    const path: PlyNode[] = [];
    let cur: PlyNode | null = node;
    const seen = new Set<number>();
    while (cur) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      path.push(cur);
      cur = cur.parent;
    }
    path.reverse();

    const startFen = node.lineRef?.startFen || fenHistory[0];
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

    requestAnimationFrame(() => ensureActiveVisible("smooth"));
  };

  function MoveLabel({ node, variant = false }: { node: PlyNode; variant?: boolean }) {
    const isActive =
      activeNodeId === node.id || (step > 0 && fenHistory[step] === node.fenAfter);
    const label = node.isWhite ? `${node.moveNumber}.` : `${node.moveNumber}...`;
    const moveStyle = variant ? styles.variantMove : styles.tokenMove;

    return (
      <>
        <span style={{ ...styles.token, ...styles.moveNumber }}>{label}</span>
        <CommentTokens texts={node.commentBefore} />
        <span
          data-active={isActive ? "true" : undefined}
          onClick={() => goToNode(node)}
          title={`Vai alla mossa ${label} ${node.san}`}
          style={{ ...styles.token, ...moveStyle, ...(isActive ? styles.tokenActive : {}) }}
        >
          {node.san}
        </span>
        <CommentTokens texts={node.commentAfter} />
      </>
    );
  }

  function VariationInline({
    line,
    level = 1,
    isVariant = true,
  }: {
    line: Line;
    level?: number;
    isVariant?: boolean;
  }) {
    return (
      <span style={variationIndent(level)}>
        (
        <RenderLine line={line} level={level} isVariant={isVariant} />
        )
      </span>
    );
  }

  function RenderLine({
    line,
    level = 1,
    isVariant = false,
  }: {
    line: Line;
    level?: number;
    isVariant?: boolean;
  }) {
    const elements: React.ReactNode[] = [];

    (line.preVariations || []).forEach((v, i) => {
      elements.push(
        <VariationInline
          key={`pre-${(line.startFen || "").slice(0, 16)}-${i}-${level}`}
          line={v}
          level={level + 1}
          isVariant={true}
        />
      );
    });

    line.nodes.forEach((node) => {
      elements.push(<MoveLabel key={`mv-${node.id}`} node={node} variant={isVariant} />);
      (node.variations || []).forEach((v, j) => {
        elements.push(
          <VariationInline
            key={`var-${node.id}-${j}-${level}`}
            line={v}
            level={level + 1}
            isVariant={true}
          />
        );
      });
    });

    return <>{elements}</>;
  }

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

      rows.push(
        <div key={`row-${node.id}`} style={styles.row}>
          <div style={styles.noColMain}>{label}</div>
          <div style={styles.contentCol}>
            <CommentTokens texts={node.commentBefore} />
            <span
              data-active={isActive ? "true" : undefined}
              onClick={() => goToNode(node)}
              title={`Vai alla mossa ${label} ${node.san}`}
              style={{ ...styles.token, ...styles.tokenMove, ...(isActive ? styles.tokenActive : {}) }}
            >
              {node.san}
            </span>
            <CommentTokens texts={node.commentAfter} />
            {variantView === 'tree'
              ? (node.variations?.length ? <VariantBlock node={node} /> : null)
              : (node.variations || []).map((v, j) => (
                  <VariationInline key={`var-inline-${node.id}-${j}`} line={v} level={1} />
                ))
            }
          </div>
        </div>
      );
    });

    return <>{rows}</>;
  }

  const flow = useMemo(() => {
    if (!treeMain) return null;
    return <RenderMain line={treeMain} />;
  }, [treeMain, activeNodeId, fenHistory, step, variantView, openVars, openLines]);

  /* ---------------- Tastiera ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable = target?.isContentEditable;
      if (tag === "input" || tag === "textarea" || isEditable) return;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        animateToStep(stepRef.current + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        animateToStep(stepRef.current - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        animateToStep(0);
      } else if (e.key === "End") {
        e.preventDefault();
        animateToStep(fenHistory.length - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fenHistory.length]);

  /* ---------------- Rotellina ---------------- */
  const lastWheelRef = useRef(0);
  const onWheelNav = (e: React.WheelEvent) => {
    const now = Date.now();
    if (now - lastWheelRef.current < 110) return;
    lastWheelRef.current = now;

    if (e.deltaY > 0) animateToStep(stepRef.current + 1);
    else if (e.deltaY < 0) animateToStep(stepRef.current - 1);
  };

  /* ---------------- Helpers Apri/Chiudi tutto ---------------- */
  const hasAnyVariants = useMemo(() => {
    function check(line?: Line | null): boolean {
      if (!line) return false;
      if ((line.preVariations && line.preVariations.length) || line.nodes.some(n => n.variations && n.variations.length)) return true;
      for (const n of line.nodes) {
        for (const l of (n.variations || [])) if (check(l)) return true;
      }
      for (const l of (line.preVariations || [])) if (check(l)) return true;
      return false;
    }
    return check(treeMain);
  }, [treeMain]);

  const openAll = () => {
    if (!treeMain) return;
    function collectLineIds(line: Line, acc: number[] = []) {
      acc.push(line.lid);
      (line.preVariations || []).forEach(l => collectLineIds(l, acc));
      line.nodes.forEach(n => (n.variations || []).forEach(l => collectLineIds(l, acc)));
      return acc;
    }
    function collectNodeIdsWithVars(line: Line, acc: number[] = []) {
      (line.preVariations || []).forEach(l => collectNodeIdsWithVars(l, acc));
      line.nodes.forEach(n => {
        if (n.variations && n.variations.length) acc.push(n.id);
        (n.variations || []).forEach(l => collectNodeIdsWithVars(l, acc));
      });
      return acc;
    }
    const lids = collectLineIds(treeMain, []);
    const nids = collectNodeIdsWithVars(treeMain, []);
    setOpenLines(Object.fromEntries(lids.map(id => [id, true])));
    setOpenVars(Object.fromEntries(nids.map(id => [id, true])));
  };

  const closeAll = () => {
    if (!treeMain) return;
    function collectLineIds(line: Line, acc: number[] = []) {
      acc.push(line.lid);
      (line.preVariations || []).forEach(l => collectLineIds(l, acc));
      line.nodes.forEach(n => (n.variations || []).forEach(l => collectLineIds(l, acc)));
      return acc;
    }
    function collectNodeIdsWithVars(line: Line, acc: number[] = []) {
      (line.preVariations || []).forEach(l => collectNodeIdsWithVars(l, acc));
      line.nodes.forEach(n => {
        if (n.variations && n.variations.length) acc.push(n.id);
        (n.variations || []).forEach(l => collectNodeIdsWithVars(l, acc));
      });
      return acc;
    }
    const lids = collectLineIds(treeMain, []);
    const nids = collectNodeIdsWithVars(treeMain, []);
    setOpenLines(Object.fromEntries(lids.map(id => [id, false])));
    setOpenVars(Object.fromEntries(nids.map(id => [id, false])));
  };

  /* ---------------- JSX ---------------- */
  const pvSize = 160;
  const pvLeft = Math.min(typeof window !== "undefined" ? window.innerWidth - pvSize - 12 : 0, preview.x + 12);
  const pvTop  = Math.min(typeof window !== "undefined" ? window.innerHeight - pvSize - 12 : 0, preview.y + 12);

  // valutazione corrente (linea #1)
  const topCp = lines?.[0]?.cp;
  const topMate = lines?.[0]?.mate;

  return (
    <div style={styles.app}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>PGN Viewer</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Allenamento sulla linea principale + visualizzazione varianti (cliccabili) + analisi motore.
            </div>
          </div>
          <div style={styles.controlsRow}>
            <input type="file" accept=".pgn,.PGN,text/plain" onChange={handleFileChange} />

            {/* Navigazione */}
            <button
              style={btnStyle(step === 0 || isAnimating)}
              onClick={goStart}
              disabled={step === 0 || isAnimating}
              title="Inizio"
            >
              ⏮ Inizio
            </button>
            <button
              style={btnStyle(!(step > 0 && !isAnimating))}
              onClick={goPrev}
              disabled={!(step > 0 && !isAnimating)}
              title="Indietro"
            >
              ◀︎ Indietro
            </button>
            <button
              style={{ ...btnStyle(!(step < fenHistory.length - 1 && !isAnimating)), ...styles.btnPrimary }}
              onClick={goNext}
              disabled={!(step < fenHistory.length - 1 && !isAnimating)}
              title="Avanti"
            >
              Avanti ▶︎
            </button>
            <button
              style={btnStyle(isAnimating || step === Math.max(0, fenHistory.length - 1))}
              onClick={goEnd}
              disabled={isAnimating || step === Math.max(0, fenHistory.length - 1)}
              title="Fine"
            >
              Fine ⏭
            </button>

            {/* Training toggle */}
            <button
              onClick={() => setTraining((t) => !t)}
              style={{ ...styles.btn, ...(training ? styles.btnToggleOn : styles.btnToggleOff) }}
              title="Attiva/Disattiva modalità allenamento (solo linea principale)"
            >
              {training ? "Allenamento: ON" : "Allenamento: OFF"}
            </button>

            {/* Varianti view */}
            <button
              onClick={() => setVariantView(v => v === 'tree' ? 'inline' : 'tree')}
              style={styles.btn}
              title="Cambia modalità di visualizzazione delle varianti"
            >
              Varianti: {variantView === 'tree' ? 'albero' : 'in linea'}
            </button>

            {/* Apri/Chiudi tutto */}
            <button
              onClick={openAll}
              style={btnStyle(!(variantView === 'tree' && hasAnyVariants))}
              disabled={!(variantView === 'tree' && hasAnyVariants)}
              title="Apri tutte le varianti"
            >
              Apri tutto
            </button>
            <button
              onClick={closeAll}
              style={btnStyle(!(variantView === 'tree' && hasAnyVariants))}
              disabled={!(variantView === 'tree' && hasAnyVariants)}
              title="Chiudi tutte le varianti"
            >
              Chiudi tutto
            </button>

            {/* Board size */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Scacchiera</span>
              <input
                type="range"
                min={300}
                max={700}
                value={boardSize}
                onChange={(e) => setBoardSize(Number(e.target.value))}
              />
              <span style={{ fontSize: 12, color: "#6b7280" }}>{boardRenderWidth}px</span>
            </div>

            {/* Rotate board */}
            <button
              onClick={() => setWhiteOrientation((w) => !w)}
              style={styles.btn}
              title="Ruota la scacchiera"
            >
              ↻ Ruota
            </button>

            {/* Engine controls */}
            <button
              onClick={() => {
                const next = !engineOn;
                setEngineOn(next);
                if (!next) stop();
              }}
              style={{ ...styles.btn, ...(engineOn ? styles.btnToggleOn : styles.btnToggleOff) }}
              title={ready ? "Accendi/Spegni motore" : "Motore non ancora pronto"}
            >
              {engineOn ? "Engine: ON" : "Engine: OFF"}
            </button>

            <label style={{ fontSize: 12, color: "#6b7280", display: "inline-flex", alignItems: "center", gap: 6 }}>
              Depth
              <input
                type="number"
                min={8}
                max={35}
                value={engineDepth}
                onChange={(e) => setEngineDepth(Number(e.target.value))}
                style={{ width: 64, padding: 6, borderRadius: 8, border: "1px solid #d1d5db" }}
              />
            </label>

            <label style={{ fontSize: 12, color: "#6b7280", display: "inline-flex", alignItems: "center", gap: 6 }}>
              MultiPV
              <input
                type="number"
                min={1}
                max={5}
                value={engineMPV}
                onChange={(e) => setEngineMPV(Number(e.target.value))}
                style={{ width: 64, padding: 6, borderRadius: 8, border: "1px solid #d1d5db" }}
              />
            </label>

            {/* Best move overlay toggle */}
            <button
              onClick={() => setShowBestArrow(s => !s)}
              style={{ ...styles.btn, ...(showBestArrow ? styles.btnToggleOn : styles.btnToggleOff) }}
              title="Mostra/Nascondi freccia Best Move del motore"
            >
              Best move: {showBestArrow ? "ON" : "OFF"}
            </button>
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
          {/* Pannello sinistro: scacchiera + eval bar + engine panel */}
          <div style={{ ...styles.left, width: leftWidth }}>
            {/* Board + EvalBar */}
            <div style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 8 }}>
              {/* Eval Bar (vantaggio White; per Nero è complementare) */}
              <div style={{ height: boardRenderWidth }}>
                <EvalBar
                  cp={topCp}
                  mate={topMate}
                  turn={liveFen.split(" ")[1] === "w" ? "w" : "b"}
                />
              </div>

              {/* Scacchiera */}
              <div
                onWheel={onWheelNav}
                style={{ borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 8px rgba(0,0,0,.08)" }}
                title="Usa la rotellina per scorrere le mosse"
              >
                <Chessboard
                  id="main-board"
                  position={liveFen}
                  arePiecesDraggable={true}
                  onPieceDrop={applyDrop}
                  boardWidth={boardRenderWidth}
                  animationDuration={200}
                  customSquareStyles={customSquareStyles}
                  customArrows={boardArrows}
                  boardOrientation={whiteOrientation ? "white" : "black"}
                />
              </div>
            </div>

            <div style={{ textAlign: "center", fontSize: 12, color: "#6b7280" }}>
              Posizione {step}/{Math.max(0, fenHistory.length - 1)}{isAnimating ? " — animazione..." : ""}{engineOn ? (thinking ? " — engine..." : "") : ""}
            </div>
            {feedback && (
              <div style={{ fontSize: 13, ...(feedback.ok ? styles.feedbackGood : styles.feedbackBad) }}>
                {feedback.text}
              </div>
            )}

            {/* Errori motore */}
            {engineErr && (
              <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 6 }}>{engineErr}</div>
            )}

            {/* Pannello varianti del motore */}
            {engineOn && (
              <div style={{ marginTop: 8 }}>
                <EnginePanel
                  lines={lines}
                  thinking={thinking}
                  depth={engineDepth}
                  onPlayLine={(i) => {
                    const best = lines[i];
                    if (!best) return;
                    try {
                      const c = new Chess(liveFen);
                      const newFens = [c.fen()];
                      for (const san of best.pvSan) {
                        c.move(san, { sloppy: true });
                        newFens.push(c.fen());
                      }
                      setFenHistory(newFens);
                      setStep(0);
                      setActiveNodeId(null);
                      setTraining(false);
                      setShowBestOnce(false);
                    } catch {}
                  }}
                />
              </div>
            )}
          </div>

          {/* Splitter */}
          <div
            style={{ ...styles.splitter, ...(dragging ? styles.splitterActive : {}) }}
            onMouseDown={onSplitDown}
            title="Trascina per ridimensionare"
          />

          {/* Pannello destro: mosse/varianti PGN */}
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

        <div style={{ marginTop: 12, fontSize: 12, color: "#6b7280" }}>
          Suggerimento: passa sopra <span style={styles.fenBadge}>Diagramma</span> per l’anteprima.
          Le card in alto e il pannello mosse sono ridimensionabili. Trascina lo splitter per variare la larghezza.
        </div>
      </div>

      {/* Tooltip mini-board (se visibile) */}
      {preview.visible && preview.fen && (
        <div
          style={{
            position: "fixed",
            left: pvLeft,
            top: pvTop,
            width: pvSize,
            height: pvSize,
            pointerEvents: "none",
            zIndex: 9999,
            boxShadow: "0 6px 20px rgba(0,0,0,.18)",
            borderRadius: 12,
            overflow: "hidden",
            background: "white",
          }}
        >
          <Chessboard
            id="preview-board"
            position={preview.fen}
            boardWidth={pvSize}
            arePiecesDraggable={false}
            animationDuration={0}
            customArrows={[]}
            customSquareStyles={{}}
          />
        </div>
      )}
    </div>
  );
}
