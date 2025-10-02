// @ts-nocheck

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Chess } from "chess.js";

import { Chessboard } from "react-chessboard";

// === Nuovi import (file separati) ===

import { useStockfish } from "./useStockfish";

import { EvalBar } from "./EvalBar";

import { EnginePanel } from "./EnginePanel";



function detectMobile() {

  if (typeof window === "undefined") return false;

  try {

    const qs = new URLSearchParams(window.location.search);

    if (qs.has("desktop")) return false;

    if (qs.has("mobile")) return true;

  } catch {}

  const coarse = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(pointer: coarse)").matches : false;

  const touchPoints = typeof navigator !== "undefined" ? navigator.maxTouchPoints || 0 : 0;

  const hasTouch = coarse || touchPoints > 0;

  if (!hasTouch) return false;

  const width = typeof window !== "undefined" ? window.innerWidth || 0 : 0;

  const narrow = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(max-width: 920px)").matches : false;

  return narrow || width <= 920;

}



/* =====================================================

   PGN utilities â€” robust tokenizer + game-tree parser

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



/** CompatibilitÃ  con marcatori esterni + pulizia detriti engine */

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

  const rx = /\{[^}]*\}|\$\d+|\d+\.(?:\.\.|â€¦)?|1-0|0-1|1\/2-1\/2|\*|[()]+|[^\s()]+/g;

  const tokens: Array<{ t: string; v: string }> = [];

  let m;

  while ((m = rx.exec(s))) {

    const tok = m[0];

    if (tok[0] === "{") tokens.push({ t: TT.COMMENT, v: tok.slice(1, -1).trim() });

    else if (tok[0] === "$") tokens.push({ t: TT.NAG, v: tok });

    else if (/^\d+\.(?:\.\.|â€¦)?$/.test(tok)) tokens.push({ t: TT.MOVE_NUM, v: tok });

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



type PlayedMove = {

  san: string;

  color: 'w' | 'b';

  moveNumber: number;

  fen: string;

  fenIndex: number;

  from?: string | null;

  to?: string | null;

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

          const wantsBlack = /â€¦|\.\.\.$/.test(tokens[j].v);

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

  engineRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "nowrap" as const },



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

    color: "#191a1bff",

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

    width: 10,

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



  liveMovesPanel: {

    marginTop: 16,

    border: "1px solid #d1d5db",

    borderRadius: 14,

    background: "#fff",

    padding: 16,

    display: "flex",

    flexDirection: "column",

    gap: 14,

  },



  liveMovesHeader: {

    display: "flex",

    alignItems: "center",

    justifyContent: "space-between",

    fontSize: 14,

    fontWeight: 600,

    gap: 12,

  },



  liveMovesControls: { display: "flex", gap: 12 },



  liveMovesList: {

    display: "flex",

    flexWrap: "wrap",

    gap: 8,

    alignItems: "center",

  },



  liveMoveChip: {

    display: "inline-flex",

    alignItems: "baseline",

    gap: 6,

    padding: "2px 4px",

    borderRadius: 6,

    cursor: "pointer",

    color: "#111827",

    fontSize: 13,

    fontWeight: 500,

    lineHeight: 1.4,

    transition: "color 0.15s ease",

  },



  liveMoveActive: {

    color: "#2563eb",

    fontWeight: 700,

  },



  liveMoveTurn: { fontSize: 13, color: "#111827", fontWeight: 500 },



  liveMoveSan: { fontSize: 13, fontWeight: 500 },



  liveMovesEmpty: { fontSize: 13, color: "#6b7280" },



  liveMoveBtn: {

    padding: "9px 16px",

    borderRadius: 12,

    border: "1px solid #c7d2fe",

    background: "#eef2ff",

    cursor: "pointer",

    fontSize: 15,

    fontWeight: 600,

    color: "#1f2937",

    transition: "background 0.15s ease, color 0.15s ease",

  },



  liveMoveBtnDisabled: { opacity: 0.55, cursor: "not-allowed", color: "#9ca3af" },



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

  mApp: { display: "flex", flexDirection: "column", gap: 12, background: "#f7f7fb", minHeight: "100vh", padding: 12 },

  mHeader: { display: "grid", gap: 6 },

  mHeaderRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },

  mHeaderActions: { display: "flex", gap: 8 },

  mFileButton: {

    display: "inline-flex",

    alignItems: "center",

    justifyContent: "center",

    padding: "10px 14px",

    borderRadius: 12,

    borderWidth: 1,

    borderStyle: "solid" as const,

    borderColor: "#d1d5db",

    background: "#fff",

    fontWeight: 600,

    color: "#1f2937",

  },

  mAccentButton: {

    padding: "10px 14px",

    borderRadius: 12,

    borderWidth: 1,

    borderStyle: "solid" as const,

    borderColor: "#1d4ed8",

    background: "#2563eb",

    color: "#fff",

    fontWeight: 600,

  },

  mBoardWrap: { display: "grid", gap: 12 },

  mNavRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 },

  mNavBtn: {

    padding: "12px 8px",

    borderRadius: 12,

    borderWidth: 1,

    borderStyle: "solid" as const,

    borderColor: "#d1d5db",

    background: "#ffffffff",

    fontWeight: 600,

    fontSize: 13,

  },

  mTabsRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 },

  mTabBtn: {

    padding: "10px 8px",

    borderRadius: 999,

    borderWidth: 1,

    borderStyle: "solid" as const,

    borderColor: "#d1d5db",

    background: "#ffffffff",

    fontWeight: 600,

    fontSize: 13,

    color: "#1f2937",

  },

  mTabBtnActive: { background: "#2563eb", color: "#fff", borderColor: "#1d4ed8" },

  mTabPanel: { background: "#fff", borderRadius: 16, padding: 12, boxShadow: "0 8px 24px rgba(15,23,42,0.12)", display: "grid", gap: 12 },

  mChipRow: { display: "flex", flexWrap: "wrap", gap: 8 },

  mInfoText: { fontSize: 12, color: "#6b7280" },

  mChip: {

    padding: "10px 12px",

    borderRadius: 12,

    borderWidth: 1,

    borderStyle: "solid" as const,

    borderColor: "#d1d5db",

    background: "#ffffffff",

    fontWeight: 600,

    fontSize: 13,

    color: "#1f2937",

    cursor: "pointer",

  },



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

  const [isMobile, setIsMobile] = useState(() => detectMobile());

  const [mobileTab, setMobileTab] = useState<'moves' | 'pgn' | 'engine' | 'settings'>('moves');

  const [mobileEngineSettingsOpen, setMobileEngineSettingsOpen] = useState(false);



  const [treeMain, setTreeMain] = useState<Line | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [fileLabel, setFileLabel] = useState<string>("");

  const [mainlinePlies, setMainlinePlies] = useState<PlyNode[]>([]);
  const [currentLinePlies, setCurrentLinePlies] = useState<PlyNode[]>([]);



  const [fenHistory, setFenHistory] = useState<string[]>([new Chess().fen()]);

  const [step, setStep] = useState(0);

  const [playedMoves, setPlayedMoves] = useState<PlayedMove[]>([]);

  const liveFen = fenHistory[step] || new Chess().fen();



  // === dimensioni/resize ===

  const [leftWidth, setLeftWidth] = useState(440);

  const layoutRef = useRef<HTMLDivElement | null>(null);

  const [dragging, setDragging] = useState(false);

  const draggingRef = useRef(false);

  const startXRef = useRef(0);

  const startWRef = useRef(440);

  const minLeft = 320;

  let maxLeft = 820;



  const onSplitDown = (e: React.MouseEvent) => {  

    draggingRef.current = true;

    try { document.body.style.userSelect = "none"; document.body.style.cursor = "col-resize"; } catch {}

    setDragging(true);

    startXRef.current = e.clientX;

    startWRef.current = leftWidth;

    window.addEventListener("mousemove", onSplitMove);

    window.addEventListener("mouseup", onSplitUp);

    e.preventDefault();

  };

  const onSplitMove = (e: MouseEvent) => {

    if (!draggingRef.current) return;

    const dx = e.clientX - startXRef.current;

    const containerW = layoutRef.current?.clientWidth || window.innerWidth;

    const rightMin = 360; // minimo spazio pannello destro

    const dynMaxLeft = Math.max(minLeft, Math.min(containerW - rightMin, 1200));

    const next = Math.min(dynMaxLeft, Math.max(minLeft, startWRef.current + dx));

    setLeftWidth(next);

  };

  const onSplitUp = () => {

    setDragging(false);

    draggingRef.current = false;

    try { document.body.style.userSelect = ""; document.body.style.cursor = ""; } catch {}

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

  const boardCellRef = useRef<HTMLDivElement | null>(null);

  const [autoBoardWidth, setAutoBoardWidth] = useState(400);

  const [mobileBoardSize, setMobileBoardSize] = useState(320); // Dimensione predefinita per mobile

  

  // Calcola la dimensione ottimale per la scacchiera in base al dispositivo

  const calculateOptimalBoardSize = () => {

    if (!isMobile) {

      return Math.min(boardSize, Math.floor(autoBoardWidth));

    }

    

    // Per dispositivi mobile, adatta la dimensione in base allo schermo

    const screenWidth = window.innerWidth;

    const screenHeight = window.innerHeight;

    

    // Calcola dimensione massima possibile mantenendo le proporzioni

    const maxSize = Math.min(screenWidth - 40, screenHeight - 300);

    

    // Limita a dimensioni ragionevoli per mobile

    return Math.max(280, Math.min(400, maxSize));

  };

  

  const boardRenderWidth = calculateOptimalBoardSize();



  // ResizeObserver: adatta automaticamente la board alla larghezza utile

  useEffect(() => {

    const el = boardCellRef.current;

    if (!el) return;

    

    const updateBoardSize = () => {

      if (isMobile) {

        const newSize = calculateOptimalBoardSize();

        setMobileBoardSize(newSize);

      } else {

        const w = Math.max(0, Math.floor(el.clientWidth));

        setAutoBoardWidth(w || 0);

      }

    };

    

    const ro = new ResizeObserver(updateBoardSize);

    ro.observe(el);

    

    // Inizializza

    updateBoardSize();

    

    // Aggiungi listener per l'orientamento del dispositivo

    const handleOrientationChange = () => {

      setTimeout(updateBoardSize, 300);

    };

    

    window.addEventListener('resize', updateBoardSize);

    window.addEventListener('orientationchange', handleOrientationChange);

    

    return () => { 

      try { 

        ro.disconnect(); 

        window.removeEventListener('resize', updateBoardSize);

        window.removeEventListener('orientationchange', handleOrientationChange);

      } catch {} 

    };

  }, [isMobile]);



  useEffect(() => {

    if (typeof window === "undefined") return;

    const handle = () => setIsMobile(detectMobile());

    handle();

    window.addEventListener("resize", handle);

    window.addEventListener("orientationchange", handle);

    return () => {

      window.removeEventListener("resize", handle);

      window.removeEventListener("orientationchange", handle);

    };

  }, []);

  useEffect(() => {

    if (typeof window !== "undefined" && "speechSynthesis" in window) {

      setSpeechAvailable(true);

    } else {

      setSpeechAvailable(false);

    }

  }, []);





  useEffect(() => {

    if (!isMobile) setMobileTab('moves');

  }, [isMobile]);



  // training & feedback

  const [training, setTraining] = useState(false);

  const [trainingColor, setTrainingColor] = useState('auto');

  const [feedback, setFeedback] = useState<null | { ok: boolean; text: string }>(null);

  const feedbackTimer = useRef<any>(null);

  useEffect(() => () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current); }, []);



  // animazione

  const ANIM_MS = 300;

  const [isAnimating, setIsAnimating] = useState(false);

  const animTimerRef = useRef<any>(null);

  const stepRef = useRef(step);

  const lastSpokenKeyRef = useRef<string | null>(null);

  useEffect(() => { stepRef.current = step; }, [step]);



  // pannello mosse

  const movesPaneRef = useRef<HTMLDivElement | null>(null);

  const [activeNodeId, setActiveNodeId] = useState<number | null>(null);

  useEffect(() => {

    if (activeNodeId !== null) {

      setActiveNodeId(null);

    }

  }, [step, fenHistory]);





  // Tooltip mini-board

  const [preview, setPreview] = useState<{

    fen: string | null;

    x: number;

    y: number;

    visible: boolean;

    from: string | null;

    to: string | null;

  }>({

    fen: null,

    x: 0,

    y: 0,

    visible: false,

    from: null,

    to: null,

  });

  const getPreviewCoords = (evt: any) => {

    if (evt && typeof evt.clientX === "number" && typeof evt.clientY === "number") {

      return { x: evt.clientX, y: evt.clientY };

    }

    try {

      const target = evt?.target || evt?.currentTarget;

      if (target && typeof target.getBoundingClientRect === "function") {

        const rect = target.getBoundingClientRect();

        return { x: rect.right + 12, y: rect.top };

      }

    } catch {}

    return { x: 0, y: 0 };

  };

  const showPreview = (fen: string, evt: any, highlight?: { from?: string | null; to?: string | null }) => {

    const coords = getPreviewCoords(evt);

    setPreview({

      fen,

      x: coords.x,

      y: coords.y,

      visible: true,

      from: highlight?.from ?? null,

      to: highlight?.to ?? null,

    });

  };

  const movePreview = (e: React.MouseEvent) => {

    if (typeof e?.clientX !== "number" || typeof e?.clientY !== "number") return;

    setPreview((p) => (p.visible ? { ...p, x: e.clientX, y: e.clientY } : p));

  };

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

    if (f) { onFile(f); try { setFileLabel(f.name || ""); } catch {} }

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
    setCurrentLinePlies(mainlineFlat);



    const fens: string[] = [main.startFen];

    for (const p of main.nodes) fens.push(p.fenAfter);

    setFenHistory(fens);

    setPlayedMoves([]);

    setStep(0);

    setActiveNodeId(null);

    setOpenVars({});

    setOpenLines({});

    // Resetta anche lo stato per click and move

    setMoveFrom('');

    setOptionSquares({});

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



  const recordPlayedMoves = useCallback((entries: Array<{ move: any; fen: string }>) => {

    if (!entries || !entries.length) return;

    setPlayedMoves((prev) => {

      const base = prev.slice(0, Math.max(0, stepRef.current));

      let nextIndex = stepRef.current;

      const next = [...base];

      entries.forEach(({ move, fen }) => {

        if (!move || !move.san || !fen) return;

        nextIndex += 1;

        next.push({

          san: move.san,

          color: move.color === 'w' ? 'w' : 'b',

          moveNumber: typeof move.moveNumber === "number" ? move.moveNumber : Math.ceil(nextIndex / 2),

          fen,

          fenIndex: nextIndex,

          from: move.from || null,

          to: move.to || null,

        });

      });

      return next;

    });

  }, []);





  const goPrevGame = () => {

    if (gameIndex <= 0) return;

    setGameIndex((idx) => Math.max(0, idx - 1));

  };



  const goNextGame = () => {

    if (gameIndex >= Math.max(0, games.length - 1)) return;

    setGameIndex((idx) => Math.min(Math.max(0, games.length - 1), idx + 1));

  };



  const canPrevGame = gameIndex > 0;

  const canNextGame = gameIndex < Math.max(0, games.length - 1);



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

    const s: Record<string, React.CSSProperties> = {};

    if (lastFromTo) {

      s[lastFromTo.from] = { background: "rgba(250, 204, 21, 0.45)" };

      s[lastFromTo.to] = { background: "rgba(250, 204, 21, 0.75)" };

    }

    return s;

  }, [lastFromTo]);



  const isCheckmate = useMemo(() => {

    try {

      const game = new Chess(liveFen);

      if (typeof (game as any).isCheckmate === "function") return game.isCheckmate();

      if (typeof (game as any).in_checkmate === "function") return (game as any).in_checkmate();

      return false;

    } catch {

      return false;

    }

  }, [liveFen]);



  const checkmatedColor = isCheckmate ? (liveFen.split(" ")[1] ?? null) : null;



  const checkmatedKingSquare = useMemo(() => {

    if (!isCheckmate || !checkmatedColor) return null;

    try {

      const game = new Chess(liveFen);

      const board = game.board();

      const files = "abcdefgh";

      for (let rank = 0; rank < board.length; rank++) {

        for (let file = 0; file < board[rank].length; file++) {

          const piece = board[rank][file];

          if (piece && piece.type === "k" && piece.color === checkmatedColor) {

            return `${files[file]}${8 - rank}`;

          }

        }

      }

    } catch {}

    return null;

  }, [isCheckmate, checkmatedColor, liveFen]);



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

  // === Play vs Engine ===

  const [playVsEngine, setPlayVsEngine] = useState(false);

  const [engineSide, setEngineSide] = useState<'w'|'b'>('b');

  const [engineMovePending, setEngineMovePending] = useState(false);

  const lastEngineAnalyzeFenRef = useRef<string>("");



  // Best-move overlay

  const [showBestArrow, setShowBestArrow] = useState(false); // toggle utente

  const [showBestOnce, setShowBestOnce] = useState(false);   // usato dal blunder helper

  const showBestArrowEffective = showBestArrow || showBestOnce;



  useEffect(() => {

    if (training && playVsEngine) {

      setPlayVsEngine(false);

      setShowBestOnce(false);

    }

  }, [training, playVsEngine]);



  const [ttsEnabled, setTtsEnabled] = useState(false);

  const [speechAvailable, setSpeechAvailable] = useState(false);

  const [language, setLanguage] = useState<"it" | "en">("en");

  // Persist & restore UI language

  useEffect(() => {

    try {

      const saved = localStorage.getItem("pgnviewer.language");

      if (saved === "it" || saved === "en") setLanguage(saved as "it" | "en");

      else if (typeof navigator !== "undefined") {

        const nav = (navigator.language || "").toLowerCase();

        if (nav.startsWith("it")) setLanguage("it");

        else setLanguage("en");

      }

    } catch {}

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, []);



  useEffect(() => {

    try { localStorage.setItem("pgnviewer.language", language); } catch {}

  }, [language]);

  useEffect(() => {

    if (typeof document !== "undefined") {

      document.documentElement.lang = language;

    }

  }, [language]);

  const isEnglish = language === "en";

  const t = (it: string, en: string) => (isEnglish ? en : it);









  // Rotazione scacchiera

  const [whiteOrientation, setWhiteOrientation] = useState(true);



  // analizza quando cambia la posizione (se engine ON)

  useEffect(() => {

    if (!engineOn || !ready) return;

    analyze(liveFen, { depth: engineDepth, multipv: engineMPV });

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [engineOn, ready, liveFen, engineDepth, engineMPV]);



  

  // === VS Engine: trigger analisi solo quando Ã¨ il turno del motore e serve ===

  useEffect(() => {

    if (!playVsEngine || !engineOn || !ready) return;

    try {

      const c = new Chess(liveFen);

      if (c.turn() !== engineSide) return;

      if (!engineMovePending && !thinking && lastEngineAnalyzeFenRef.current !== liveFen) {

        lastEngineAnalyzeFenRef.current = liveFen;

        setEngineMovePending(true);

        analyze(liveFen, { depth: engineDepth, multipv: 1 });

      }

    } catch {}

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [playVsEngine, engineOn, ready, liveFen, engineSide, engineDepth, analyze, thinking, engineMovePending]);



  // === VS Engine: quando l'analisi Ã¨ pronta, gioca una sola mossa (pvSan[0]) ===

  useEffect(() => {

    if (!playVsEngine || !engineOn || !ready) return;

    if (!engineMovePending) return;

    if (thinking) return;

    try {

      const bestSan = lines?.[0]?.pvSan?.[0];

      if (!bestSan) return;

      const c2 = new Chess(liveFen);

      const engineMove = c2.move(bestSan, { sloppy: true });

      if (engineMove) {

        const newFen = c2.fen();

        recordPlayedMoves([{ move: engineMove, fen: newFen }]);

        setFenHistory((prev) => [...prev.slice(0, stepRef.current + 1), newFen]);

        setStep((s) => s + 1);

        setEngineMovePending(false);

        setShowBestOnce(false);

      } else {

        setEngineMovePending(false);

      }

    } catch { setEngineMovePending(false); }

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [playVsEngine, engineOn, ready, engineMovePending, thinking, lines, liveFen]);



  // Reset guardie quando spegni VS Engine o l'engine

  useEffect(() => {

    if (!playVsEngine || !engineOn) {

      setEngineMovePending(false);

      lastEngineAnalyzeFenRef.current = "";

    }

  }, [playVsEngine, engineOn]);



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



  const handlePlayEngineLine = (lineIndex: number) => {

    const best = lines?.[lineIndex];

    if (!best) return;

    let fenList = Array.isArray(best.pvFens) ? best.pvFens.slice() : [];

    if (!fenList.length) {

      const base = new Chess(liveFen);

      fenList = [base.fen()];

      try {

        for (const san of best.pvSan || []) {

          base.move(san, { sloppy: true });

          fenList.push(base.fen());

        }

      } catch {}

    }

    if (!fenList.length) return;

    const finalIndex = Math.max(0, fenList.length - 1);

    setFenHistory(fenList);
    setCurrentLinePlies([]);

    setPlayedMoves([]);

    setStep(finalIndex);

    setActiveNodeId(null);

    setTraining(false);

    setShowBestOnce(false);

    setMoveFrom('');

    setOptionSquares({});

    chessGameRef.current = new Chess(fenList[finalIndex]);

    hidePreview();

  };



  const handleSelectEngineMove = (lineIndex: number, moveIndex: number) => {

    const line = lines?.[lineIndex];

    if (!line) return;

    let fenList = Array.isArray(line.pvFens) ? line.pvFens.slice() : [];

    if (!fenList.length) {

      const base = new Chess(liveFen);

      fenList = [base.fen()];

      try {

        for (const san of line.pvSan || []) {

          base.move(san, { sloppy: true });

          fenList.push(base.fen());

        }

      } catch {}

    }

    if (!fenList.length) return;

    const nextStep = Math.min(moveIndex + 1, fenList.length - 1);

    const targetFen = fenList[nextStep];

    if (!targetFen) return;

    try {

      setFenHistory(fenList);
      setCurrentLinePlies([]);

      setPlayedMoves([]);

      setStep(nextStep);

      setActiveNodeId(null);

      setTraining(false);

      setShowBestOnce(false);

      setMoveFrom('');

      setOptionSquares({});

      chessGameRef.current = new Chess(targetFen);

      hidePreview();

    } catch {}

  };



  const renderEnginePanel = () => (

    <EnginePanel

      lines={lines}

      thinking={thinking}

      depth={engineDepth}

      onPlayLine={handlePlayEngineLine}

      onSelectMove={handleSelectEngineMove}

      baseFen={liveFen}

      onPreviewFen={showPreview}

      onPreviewMove={movePreview}

      onHidePreview={hidePreview}

      t={t}

    />

  );



  const mateWinnerIt = checkmatedColor === "w" ? "il Nero" : "il Bianco";

  const mateWinnerEn = checkmatedColor === "w" ? "Black" : "White";

  const mateMessage = isCheckmate ? t(`Scacco matto! Vince ${mateWinnerIt}.`, `Checkmate! ${mateWinnerEn} wins.`) : null;

  const canGoBackward = step > 0;

  const canGoForward = step < Math.max(0, fenHistory.length - 1);



  const statusExtras: string[] = [];

  if (isAnimating) statusExtras.push("animazione...");

  if (engineOn && thinking) statusExtras.push("engine...");

  const statusLine = `Posizione ${step}/${Math.max(0, fenHistory.length - 1)}${statusExtras.length ? " — " + statusExtras.join(" — ") : ""}`;



  const fenCommentMap = useMemo(() => {

    const map = new Map<string, string>();



    const visitLine = (line?: Line) => {

      if (!line) return;

      (line.preVariations || []).forEach(visitLine);

      line.nodes.forEach((node) => {

        const parts: string[] = [];

        if (node.commentBefore?.length) parts.push(...node.commentBefore);

        if (node.commentAfter?.length) parts.push(...node.commentAfter);

        if (parts.length) {

          const combined = parts.join(" ").replace(/\s+/g, " ").trim();

          if (combined) map.set(node.fenAfter, combined);

        }

        (node.variations || []).forEach(visitLine);

      });

    };



    visitLine(treeMain);

    return map;

  }, [treeMain]);



  useEffect(() => {

    if (!speechAvailable || !ttsEnabled) {

      if (speechAvailable && typeof window !== "undefined" && "speechSynthesis" in window) {

        window.speechSynthesis.cancel();

      }

      return;

    }

    if (typeof window === "undefined") return;

    const currentFen = fenHistory[step];

    if (!currentFen) return;

    const comment = fenCommentMap.get(currentFen);

    if (!comment) return;

    const key = `${currentFen}#${step}`;

    if (lastSpokenKeyRef.current === key) return;

    lastSpokenKeyRef.current = key;

    const utterance = new SpeechSynthesisUtterance(comment);

    try {

      const lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";

      utterance.lang = lang;

    } catch {}

    window.speechSynthesis.cancel();

    window.speechSynthesis.speak(utterance);

  }, [speechAvailable, ttsEnabled, step, fenHistory, fenCommentMap]);



  useEffect(() => {

    lastSpokenKeyRef.current = null;

    if (!ttsEnabled && speechAvailable && typeof window !== "undefined" && "speechSynthesis" in window) {

      window.speechSynthesis.cancel();

    }

  }, [ttsEnabled, speechAvailable, fenCommentMap]);





  // === Click and Move functionality ===

  const [moveFrom, setMoveFrom] = useState('');

  const [optionSquares, setOptionSquares] = useState<Record<string, React.CSSProperties>>({});

  const baseSquareStyles = useMemo(() => {

    const styles: Record<string, React.CSSProperties> = { ...customSquareStyles };

    if (checkmatedKingSquare) {

      const prev = styles[checkmatedKingSquare] || {};

      styles[checkmatedKingSquare] = {

        ...prev,

        outline: "2px solid rgba(220,38,38,0.9)",

        boxShadow: "0 0 0 4px rgba(220,38,38,0.45)",

      };

    }

    return styles;

  }, [customSquareStyles, checkmatedKingSquare]);



  const boardSquareStyles = useMemo(() => ({ ...baseSquareStyles, ...optionSquares }), [baseSquareStyles, optionSquares]);



  const checkmatePieces = useMemo(() => {

    if (!checkmatedColor) return undefined;

    const pieceId = checkmatedColor === "w" ? "wK" : "bK";

    const MateKing = ({ squareWidth }: { squareWidth: number }) => (

      <div

        style={{

          fontSize: squareWidth * 0.78,

          display: "flex",

          alignItems: "center",

          justifyContent: "center",

          color: "#dc2626",

          textShadow: "0 2px 6px rgba(0,0,0,0.45)",

        }}

      >

        {checkmatedColor === "w" ? "â™”" : "â™š"}

        <span style={{ fontSize: squareWidth * 0.45, marginLeft: 2 }}>â˜ </span>

      </div>

    );

    return { [pieceId]: MateKing };

  }, [checkmatedColor]);



  

  // create a chess game using a ref to always have access to the latest game state

  const chessGameRef = useRef(new Chess(liveFen));

  

  // update the chess game ref when liveFen changes

  useEffect(() => {

    chessGameRef.current = new Chess(liveFen);

    // Resetta anche lo stato per click and move

    setMoveFrom('');

    setOptionSquares({});

  }, [liveFen]);

  

  // get the move options for a square to show valid moves

  function getMoveOptions(square: string) {

    // get the moves for the square

    const moves = chessGameRef.current.moves({

      square,

      verbose: true

    });



    // if no moves, clear the option squares

    if (moves.length === 0) {

      setOptionSquares({});

      return false;

    }



    // create a new object to store the option squares

    const newSquares: Record<string, React.CSSProperties> = {};



    // loop through the moves and set the option squares

    for (const move of moves) {

      newSquares[move.to] = {

        background: chessGameRef.current.get(move.to) && chessGameRef.current.get(move.to)?.color !== chessGameRef.current.get(square)?.color ? 'radial-gradient(circle, rgba(0,0,0,.1) 85%, transparent 85%)' // larger circle for capturing

          : 'radial-gradient(circle, rgba(0,0,0,.1) 25%, transparent 25%)',

        // smaller circle for moving

        borderRadius: '50%'

      };

    }



    // set the square clicked to move from to yellow

    newSquares[square] = {

      background: 'rgba(255, 255, 0, 0.4)'

    };



    // set the option squares

    setOptionSquares(newSquares);



    // return true to indicate that there are move options

    return true;

  }

  

  // handle square click for click and move

  function onSquareClick({ square, piece }: any) {

    // Se clicchiamo sulla stessa casella da cui abbiamo iniziato, annulla la selezione

    if (moveFrom === square) {

      setMoveFrom('');

      setOptionSquares({});

      return;

    }



    // Se non abbiamo ancora selezionato un pezzo e clicchiamo su una casella con un pezzo

    if (!moveFrom && piece) {

      // get the move options for the square

      const hasMoveOptions = getMoveOptions(square);



      // if move options, set the moveFrom to the square

      if (hasMoveOptions) {

        setMoveFrom(square);

      }



      // return early

      return;

    }



    // Se abbiamo giÃ  selezionato un pezzo e clicchiamo su una casella di destinazione

    // square clicked to move to, check if valid move

    const moves = chessGameRef.current.moves({

      square: moveFrom,

      verbose: true

    });

    const foundMove = moves.find(m => m.from === moveFrom && m.to === square);



    // not a valid move

    if (!foundMove) {

      // check if clicked on new piece

      const hasMoveOptions = getMoveOptions(square);



      // if new piece, setMoveFrom, otherwise clear moveFrom

      setMoveFrom(hasMoveOptions ? square : '');



      // return early

      return;

    }



    // is normal move - prova ad eseguire la mossa

    const success = applyDrop(moveFrom, square);

    if (success) {

      setMoveFrom('');

      setOptionSquares({});

      return;

    }



    const hasMoveOptions = getMoveOptions(square);

    if (hasMoveOptions) {

      setMoveFrom(square);

      return;

    }



    const stillHas = getMoveOptions(moveFrom);

    if (!stillHas) {

      setMoveFrom('');

      setOptionSquares({});

    } else {

      setMoveFrom(moveFrom);

    }

  }

  

  // ==== react-chessboard v5: onPieceDrop(args) -> boolean

  const onPieceDrop = ({ sourceSquare, targetSquare }: any) => {

    if (!targetSquare) return false;

    if (sourceSquare === targetSquare) return false; // snapback: nessuna mossa

    

    try {

      return !!applyDrop(sourceSquare, targetSquare);

    } catch {

      return false;

    }

  };



  useEffect(() => {

    if (!training || trainingColor === 'auto') return;

    if (playVsEngine) return;

    if (!currentLinePlies.length) return;

    if (step >= currentLinePlies.length) return;



    const expectedPly = currentLinePlies[step];

    if (!expectedPly) return;



    const expectedColor = expectedPly.isWhite ? 'w' : 'b';

    if (expectedColor === trainingColor) return;



    const baseFen = fenHistory[step];

    if (!baseFen) return;



    try {

      const chess = new Chess(baseFen);

      const autoMove = chess.move(expectedPly.sanClean, { sloppy: true });

      if (!autoMove) return;



      const newFen = chess.fen();



      recordPlayedMoves([{ move: autoMove, fen: newFen }]);



      setFenHistory((prev) => {

        const head = prev.slice(0, step + 1);

        return [...head, newFen];

      });



      setStep((s) => s + 1);



      chessGameRef.current = new Chess(newFen);



      setMoveFrom('');

      setOptionSquares({});

    } catch {}

  }, [training, trainingColor, playVsEngine, step, currentLinePlies, fenHistory, recordPlayedMoves]);



  /* ---------------- Training / DnD ---------------- */

  const applyDrop = (sourceSquare: string, targetSquare: string) => {

    if (sourceSquare === targetSquare) return false;

    const baseFen = fenHistory[stepRef.current];

    const chess = new Chess(baseFen);

    // VS Engine: consenti solo mosse umane nel loro turno

    if (playVsEngine) {

      const humanSide = engineSide === 'w' ? 'b' : 'w';

      if (chess.turn() !== humanSide) { flash(false, 'È il turno del motore.'); return false; }

    }



    if (training && stepRef.current < currentLinePlies.length) {

      const expectedPly = currentLinePlies[stepRef.current];

      let expected: any = null;

      try {

        const tmp = new Chess(baseFen);

        if (expectedPly) {

          try { expected = tmp.move(expectedPly.sanClean, { sloppy: true }); } catch { expected = null; }

        }

      } catch {}

      if (expected) {

        const expectedColor = expectedPly?.isWhite ? 'w' : 'b';



        if (trainingColor !== 'auto' && expectedColor && expectedColor !== trainingColor) {

          flash(false, t("Tocca al PC (linea PGN).", "It's the PGN side's turn."));

          return false;

        }



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



        let userMoveApplied: any = null;

        try { userMoveApplied = chess.move(userMove); } catch { return false; }

        const newFen = chess.fen();



        let autoApplied = false;

        let autoFen: string | null = null;

        let autoReplyMove: any = null;

        const nextIndex = stepRef.current + 1;

        const replyPly = currentLinePlies[nextIndex];

        if (replyPly && replyPly.isWhite !== expected.isWhite) {

          try {

            autoReplyMove = chess.move(replyPly.sanClean, { sloppy: true });

            autoFen = chess.fen();

            autoApplied = true;

          } catch {

            autoReplyMove = null;

            try { chess.load(newFen); } catch {}

          }

        }



        const historyEntries: Array<{ move: any; fen: string }> = [{ move: userMoveApplied, fen: newFen }];

        if (autoApplied && autoFen && autoReplyMove) {

          historyEntries.push({ move: autoReplyMove, fen: autoFen });

        }

        recordPlayedMoves(historyEntries);



        setFenHistory((prev) => {

          const head = prev.slice(0, stepRef.current + 1);

          if (autoApplied && autoFen) return [...head, newFen, autoFen];

          return [...head, newFen];

        });

        setStep((s) => s + (autoApplied ? 2 : 1));

        chessGameRef.current = new Chess(autoApplied && autoFen ? autoFen : newFen);

        flash(true, "Giusto!");

        setMoveFrom('');

        setOptionSquares({});

        // quando esegui correttamente, togli l'hint "once"

        if (playVsEngine) setEngineMovePending(true);

        setShowBestOnce(false);

        return true;

      }

    }



    let move: any = null;

    try {

      move = chess.move({ from: sourceSquare, to: targetSquare, promotion: "q" });

    } catch { move = null; }

    if (!move) return false;

    const newFen = chess.fen();

    recordPlayedMoves([{ move, fen: newFen }]);

    setFenHistory((prev) => [...prev.slice(0, stepRef.current + 1), newFen]);

    setStep((s) => s + 1);

    chessGameRef.current = new Chess(newFen);

    // fuori dal training togli l'hint "once"

    if (playVsEngine) setEngineMovePending(true);

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

    const event = hdrs.Event ? ` â€” ${hdrs.Event}` : "";

    const result = hdrs.Result ? ` (${hdrs.Result})` : "";

    return `${white} vs ${black}${event}${result}`;

  };



  // === Reset partita / nuova partita ===

  const resetGame = () => {

    try { stop(); } catch {}

    const startFen = new Chess().fen();

    setFenHistory([startFen]);
    setCurrentLinePlies(treeMain?.nodes ?? []);

    setPlayedMoves([]);

    setStep(0);

    setActiveNodeId(null);

    setTraining(false);

    setFeedback(null);

    setShowBestOnce(false);

    setEngineMovePending(false);

    lastEngineAnalyzeFenRef.current = "";

    setPlayedMoves([]);

    // Resetta anche lo stato per click and move

    setMoveFrom('');

    setOptionSquares({});

    chessGameRef.current = new Chess(startFen);

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

                title={t("Anteprima diagramma: clic per aprire", "Diagram preview: tap to open")}

                onClick={() => {

                  try {

                    const c = new Chess(fen);

                    const newFen = c.fen();

                    setFenHistory([newFen]);
                    setCurrentLinePlies([]);

                    setPlayedMoves([]);

                    setStep(0);

                    setActiveNodeId(null);

                    setTraining(false);

                    // Resetta anche lo stato per click and move

                    setMoveFrom('');

                    setOptionSquares({});

                    chessGameRef.current = new Chess(newFen);

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



  /* ---------------- Varianti: blocco "ad albero" (toggle per nodo) ---------------- */

  function VariantBlock({ node }: { node: PlyNode }) {

    const vars = node.variations || [];

    if (!vars.length) return null;



    const open = !!openVars[node.id];

    const toggle = () => setOpenVars((s) => ({ ...s, [node.id]: !open }));



    const letter = (i: number) => String.fromCharCode("A".charCodeAt(0) + i);



    return (

      <div style={styles.variantBlock}>

        <div style={styles.variantHeader} onClick={toggle}>

          <span>{open ? "v" : ">"}</span>

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

    if (line.nodes.length > maxPlies) parts.push("â€¦");

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

          <span>{open ? "v" : ">"}</span>

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

    const fens: string[] = [chess.fen()];



    for (const p of path) {

      try { chess.move(p.sanClean, { sloppy: true }); fens.push(chess.fen()); } catch {}

    }



    const continuation: PlyNode[] = [];

    const lineRef = node.lineRef;

    if (lineRef) {

      const startIdx = (node.indexInLine ?? lineRef.nodes.findIndex((n) => n.id === node.id));

      if (startIdx !== -1) {

        for (let i = startIdx + 1; i < lineRef.nodes.length; i++) {

          const nxt = lineRef.nodes[i];

          continuation.push(nxt);

          try { chess.move(nxt.sanClean, { sloppy: true }); fens.push(chess.fen()); } catch { break; }

        }

      }

    }




    setFenHistory(fens);

    setPlayedMoves([]);

    setCurrentLinePlies([...path, ...continuation]);
    setStep(path.length);

    setActiveNodeId(node.id);

    // Resetta anche lo stato per click and move

    setMoveFrom('');

    setOptionSquares({});

    chessGameRef.current = new Chess(fens[fens.length - 1]);



    requestAnimationFrame(() => ensureActiveVisible("smooth"));

  };



  const getNodePreviewSquares = (node: PlyNode) => {

    if (!node || !node.sanClean) return null;

    try {

      const chess = new Chess(node.fenBefore);

      const mv = chess.move(node.sanClean, { sloppy: true });

      if (mv && mv.from && mv.to) {

        return { from: mv.from, to: mv.to };

      }

    } catch {}

    return null;

  };



  function MoveLabel({ node, variant = false }: { node: PlyNode; variant?: boolean }) {

    const isActive =

      activeNodeId === node.id || (step > 0 && fenHistory[step] === node.fenAfter);

    const label = node.isWhite ? `${node.moveNumber}.` : `${node.moveNumber}...`;

    const moveStyle = variant ? styles.variantMove : styles.tokenMove;

    const previewSquares = useMemo(() => getNodePreviewSquares(node), [node.fenBefore, node.sanClean]);



    return (

      <>

        <span style={{ ...styles.token, ...styles.moveNumber }}>{label}</span>

        <CommentTokens texts={node.commentBefore} />

        <span

          data-active={isActive ? "true" : undefined}

          onClick={() => goToNode(node)}

          onMouseEnter={(e) => showPreview(node.fenAfter, e, previewSquares || undefined)}

          onMouseMove={(e) => movePreview(e)}

          onMouseLeave={hidePreview}

          onFocus={(e) => showPreview(node.fenAfter, e as any, previewSquares || undefined)}

          onBlur={hidePreview}

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

      const previewSquares = getNodePreviewSquares(node);



      rows.push(

        <div key={`row-${node.id}`} style={styles.row}>

          <div style={styles.noColMain}>{label}</div>

          <div style={styles.contentCol}>

            <CommentTokens texts={node.commentBefore} />

            <span

              data-active={isActive ? "true" : undefined}

              onClick={() => goToNode(node)}

              onMouseEnter={(e) => showPreview(node.fenAfter, e, previewSquares || undefined)}

              onMouseMove={(e) => movePreview(e)}

              onMouseLeave={hidePreview}

              onFocus={(e) => showPreview(node.fenAfter, e as any, previewSquares || undefined)}

              onBlur={hidePreview}

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



  /* ---------------- Helpers Apri/{t("Chiudi tutto", "Close all")} ---------------- */

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

  const pvSize = 260;

  const pvLeft = Math.min(typeof window !== "undefined" ? window.innerWidth - pvSize - 12 : 0, preview.x + 12);

  const pvTop  = Math.min(typeof window !== "undefined" ? window.innerHeight - pvSize - 12 : 0, preview.y + 12);

  const previewSquareStyles = useMemo(() => {

    const styles: Record<string, any> = {};

    if (preview.from) styles[preview.from] = { background: "rgba(250, 204, 21, 0.45)" };

    if (preview.to) styles[preview.to] = { background: "rgba(250, 204, 21, 0.75)" };

    return styles;

  }, [preview.from, preview.to]);



  // valutazione corrente (linea #1)

  const topCp = lines?.[0]?.cp;

  const topMate = lines?.[0]?.mate;



  if (isMobile) {

    const fileInputId = "pgn-file-mobile";

    const navStyle = (disabled, accent = false) => ({

      ...styles.mNavBtn,

      ...(accent ? styles.btnPrimary : {}),

      ...(disabled

        ? { opacity: 1, background: "#f3f4f6", color: "#9ca3af", borderColor: "#e5e7eb", cursor: "not-allowed" }

        : { cursor: "pointer" }),

    });

    const chipStyle = (options = {}) => {

      const { active = false, disabled = false } = options;

      const base = { ...styles.mChip };

      if (disabled) {

        return {

          ...base,

          opacity: 0.55,

          background: "#f3f4f6",

          color: "#9ca3af",

          borderColor: "#e5e7eb",

          cursor: "not-allowed",

        };

      }

      if (active) return { ...base, ...styles.btnToggleOn };

      return base;

    };

    const mobileMoveChipStyle = (active: boolean) => ({

      display: "inline-flex",

      alignItems: "baseline",

      gap: 6,

      padding: "6px 10px",

      borderRadius: 12,

      border: active ? "1px solid #2563eb" : "1px solid #d1d5db",

      background: active ? "#eff6ff" : "#fff",

      color: active ? "#1d4ed8" : "#111827",

      fontSize: 13,

      fontWeight: active ? 700 : 600,

    });



    const atStart = step === 0 || isAnimating;

    const atEnd = step === Math.max(0, fenHistory.length - 1) || isAnimating;

    const forwardDisabled = step >= fenHistory.length - 1 || isAnimating;



    const movesContent = (

      <div style={{ display: "grid", gap: 12 }}>

        <div style={{ display: "grid", gap: 8 }}>

          <div style={{ ...styles.mInfoText, fontWeight: 600 }}>{t("Mosse della partita", "Game moves")}</div>

          {playedMoves.length === 0 ? (

            <div style={{ ...styles.mInfoText, fontStyle: "italic" }}>{t("Nessuna mossa registrata", "No moves recorded yet")}</div>

          ) : (

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>

              {playedMoves.map((mv, idx) => {

                const prefix = mv.color === "w" ? `${mv.moveNumber}.` : `${mv.moveNumber}...`;

                const isActive = step === mv.fenIndex;

                const highlight = mv.from || mv.to ? { from: mv.from ?? null, to: mv.to ?? null } : undefined;

                return (

                  <button

                    key={`mobile-played-${mv.fenIndex}-${idx}`}

                    type="button"

                    style={mobileMoveChipStyle(isActive)}

                    onClick={() => animateToStep(mv.fenIndex)}

                    onMouseEnter={(e) => {

                      if (mv.fen) showPreview(mv.fen, e, highlight);

                    }}

                    onMouseMove={(e) => {

                      if (mv.fen) movePreview(e);

                    }}

                    onMouseLeave={() => hidePreview()}

                    onFocus={(e) => {

                      if (mv.fen) showPreview(mv.fen, e as any, highlight);

                    }}

                    onBlur={() => hidePreview()}

                  >

                    <span style={{ color: "#6b7280", fontWeight: 500, fontSize: 13 }}>{prefix}</span>

                    <span style={{ fontWeight: 700, fontSize: 13 }}>{mv.san}</span>

                  </button>

                );

              })}

            </div>

          )}

        </div>

        <div

          style={{

            ...styles.mChipRow,

            justifyContent: "space-between",

            alignItems: "center",

          }}

        >

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>

            <button

              onClick={() => setVariantView('tree')}

              style={chipStyle({ active: variantView === 'tree', disabled: !treeMain })}

              disabled={!treeMain}

            >{t("Vista ad albero", "Tree view")}</button>

            <button

              onClick={() => setVariantView('inline')}

              style={chipStyle({ active: variantView === 'inline', disabled: !treeMain })}

              disabled={!treeMain}

            >{t("Vista in linea", "Inline view")}</button>

          </div>

          <div style={{ display: "flex", gap: 8 }}>

            <button

              onClick={goPrevGame}

              disabled={!canPrevGame}

              style={chipStyle({ disabled: !canPrevGame })}

              title={t("Partita precedente", "Previous game")}

              aria-label={t("Partita precedente", "Previous game")}

            >

              {"\u2039"}

            </button>

            <button

              onClick={goNextGame}

              disabled={!canNextGame}

              style={chipStyle({ disabled: !canNextGame })}

              title={t("Partita successiva", "Next game")}

              aria-label={t("Partita successiva", "Next game")}

            >

              {"\u203A"}

            </button>

          </div>

        </div>

        {!treeMain ? (

          <div style={styles.mInfoText}>

            {t("Carica un PGN e seleziona una partita per vedere mosse, commenti e varianti.", "Load a PGN and pick a game to see moves, comments, and variations.")}

          </div>

        ) : (

          <div style={{ ...styles.flow, maxHeight: "45vh", overflowY: "auto" }}>

            {flow}

          </div>

        )}

      </div>

    );



    const engineContent = (

      <div style={{ display: "grid", gap: 12 }}>

        <div style={styles.mChipRow}>

          <button

            onClick={() => {

              const next = !engineOn;

              setEngineOn(next);

              if (!next) stop();

            }}

            style={chipStyle({ active: engineOn })}

            title={ready ? t("Accendi/Spegni motore", "Turn engine on/off") : t("Motore non ancora pronto", "Engine not ready yet")}

          >

            {engineOn ? "Engine: ON" : "Engine: OFF"}

          </button>

          <button

            onClick={() => {

              const next = !playVsEngine;

              setPlayVsEngine(next);

              setTraining(false);

              setShowBestOnce(false);

              if (!next) {

                setEngineMovePending(false);

                lastEngineAnalyzeFenRef.current = "";

                setPlayedMoves([]);

              } else {

                lastEngineAnalyzeFenRef.current = "";

              }

            }}

            style={chipStyle({ active: playVsEngine })}

            title={t("Gioca contro il motore", "Play against the engine")}

          >

            {playVsEngine ? "VS Engine: ON" : "VS Engine: OFF"}

          </button>

          <button

            onClick={() => setShowBestArrow((s) => !s)}

            style={chipStyle({ active: showBestArrow })}

            title={t("Mostra/Nascondi freccia Best Move del motore", "Show/Hide engine best move arrow")}

          >

            {showBestArrow ? "Best move: ON" : "Best move: OFF"}

          </button>

          <button

            onClick={() => setMobileEngineSettingsOpen((s) => !s)}

            style={chipStyle({ active: mobileEngineSettingsOpen })}

            title={mobileEngineSettingsOpen ? t("Nascondi impostazioni motore", "Hide engine settings") : t("Mostra impostazioni motore", "Show engine settings")}

          >

            {mobileEngineSettingsOpen ? t("Nascondi impostazioni", "Hide settings") : t("Mostra impostazioni", "Show settings")}

          </button>

        </div>

        {mobileEngineSettingsOpen && (

          <div style={{ display: "grid", gap: 8 }}>

            <label style={{ ...styles.mInfoText, display: "grid", gap: 4 }}>

              Depth

              <input

                type="number"

                min={8}

                max={35}

                value={engineDepth}

                onChange={(e) => setEngineDepth(Number(e.target.value))}

                style={{ width: "100%", padding: 8, borderRadius: 10, border: "1px solid #d1d5db" }}

              />

            </label>

            <label style={{ ...styles.mInfoText, display: "grid", gap: 4 }}>

              MultiPV

              <input

                type="number"

                min={1}

                max={5}

                value={engineMPV}

                onChange={(e) => setEngineMPV(Number(e.target.value))}

                style={{ width: "100%", padding: 8, borderRadius: 10, border: "1px solid #d1d5db" }}

              />

            </label>

            <label style={{ ...styles.mInfoText, display: "grid", gap: 4 }}>

              Colore del motore

              <select

                style={styles.select}

                value={engineSide}

                onChange={(e) => setEngineSide(e.target.value === "w" ? "w" : "b")}

              >

                <option value="w">{t("Motore: Bianco", "Engine: White")}</option>

                <option value="b">{t("Motore: Nero", "Engine: Black")}</option>

              </select>

            </label>

          </div>

        )}

        {engineErr && <div style={{ color: "#b91c1c", fontSize: 12 }}>{engineErr}</div>}

        <div style={{ maxHeight: "50vh", overflowY: "auto" }}>

          {renderEnginePanel()}

        </div>

      </div>

    );



    const pgnContent = (

      <div style={{ display: "grid", gap: 12 }}>

        <div style={{ display: "grid", gap: 6 }}>

          <div style={styles.mInfoText}>{t("Partite nel PGN", "PGN Games")}</div>

          <div

            style={{

              display: "flex",

              flexWrap: "wrap",

              gap: 8,

              alignItems: "center",

              width: "100%",

            }}

          >

            <button

              onClick={goPrevGame}

              disabled={!canPrevGame}

              style={{ ...btnStyle(!canPrevGame, { padding: '4px 8px', fontSize: 12 }), flexShrink: 0 }}

              title={t("Partita precedente", "Previous game")}

              aria-label={t("Partita precedente", "Previous game")}

            >

              {"\u2039"}

            </button>

            <select

              style={{ ...styles.select, flex: "1 1 160px", minWidth: 0 }}

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

                <option style={{ color: "#000" }}>{t("(nessuna partita)", "(no games)")}</option>

              )}

            </select>

            <button

              onClick={goNextGame}

              disabled={!canNextGame}

              style={{ ...btnStyle(!canNextGame, { padding: '4px 8px', fontSize: 12 }), flexShrink: 0 }}

              title={t("Partita successiva", "Next game")}

              aria-label={t("Partita successiva", "Next game")}

            >

              {"\u203A"}

            </button>

          </div>

          {games.length ? (

            <div style={{ fontSize: 12, color: "#6b7280", wordBreak: "break-word" }}>

              {isEnglish ? `Game ${gameIndex + 1} of ${games.length}` : `Partita ${gameIndex + 1} di ${games.length}`}

            </div>

          ) : null}

        </div>

        <div style={{ display: "grid", gap: 6 }}>

          <div style={styles.mInfoText}>{t("Oppure incolla qui il PGN", "Or paste the PGN here")}</div>

          <textarea

            style={styles.textarea}

            value={rawPgn}

            onChange={(e) => setRawPgn(e.target.value)}

            placeholder={t("Incolla qui il tuo PGN...", "Paste your PGN here...")}

          />

          <button style={{ ...styles.mAccentButton, width: "100%" }} onClick={loadFromTextarea}>{t("Carica", "Load")}</button>

        </div>

      </div>

    );



    const settingsContent = (

      <div style={{ display: "grid", gap: 12 }}>

        <div style={styles.mChipRow}>

          <button

            onClick={() => setTraining((t) => !t)}

            style={chipStyle({ active: training })}

          >

            {training ? t("Allenamento: ON", "Training: ON") : t("Allenamento: OFF", "Training: OFF")}

          </button>

          <button

            onClick={() => setVariantView((v) => (v === "tree" ? "inline" : "tree"))}

            style={chipStyle()}

          >

            {`${t("Varianti: ","Variations: ")}${variantView === "tree" ? t("albero","tree") : t("in linea","inline")}`}

          </button>

          <button

            onClick={() => setTtsEnabled((v) => !v)}

            style={chipStyle({ active: ttsEnabled, disabled: !speechAvailable })}

            disabled={!speechAvailable}

          >

            TTS: {ttsEnabled ? "ON" : "OFF"}

          </button>

        <button

          onClick={() => setLanguage((l) => (l === "it" ? "en" : "it"))}

          style={chipStyle()}

          title={t("Cambia lingua", "Toggle language")}

        >

          {language === "it" ? "Italiano" : "English"}

        </button>

      </div>

        {training ? (

          <div style={{ display: "grid", gap: 6 }}>

            <div style={styles.mInfoText}>{t("Allenamento: scegli il tuo colore", "Training: pick your side")}</div>

            <div style={styles.mChipRow}>

              <button

                onClick={() => setTrainingColor('auto')}

                style={chipStyle({ active: trainingColor === 'auto' })}

              >

                {t("Replica PGN", "Replay PGN")}

              </button>

              <button

                onClick={() => setTrainingColor('w')}

                style={chipStyle({ active: trainingColor === 'w' })}

              >

                {t("Gioco da Bianco", "Play as White")}

              </button>

              <button

                onClick={() => setTrainingColor('b')}

                style={chipStyle({ active: trainingColor === 'b' })}

              >

                {t("Gioco da Nero", "Play as Black")}

              </button>

            </div>

          </div>

        ) : null}

      <div style={styles.mChipRow}>

          <button

            onClick={openAll}

            disabled={!(variantView === "tree" && hasAnyVariants)}

            style={chipStyle({ disabled: !(variantView === "tree" && hasAnyVariants) })}

            title={t("Apri tutte le varianti", "Open all variations")}

          >

            {t("Apri tutto", "Open all")}

          </button>

          <button

            onClick={closeAll}

            disabled={!(variantView === "tree" && hasAnyVariants)}

            style={chipStyle({ disabled: !(variantView === "tree" && hasAnyVariants) })}

            title={t("Chiudi tutte le varianti", "Close all variations")}

          >

            {t("Chiudi tutto", "Close all")}

          </button>

        </div>

        <div style={{ display: "grid", gap: 6 }}>

          <div style={styles.mInfoText}>Scacchiera: {boardRenderWidth}px</div>

          <input

            type="range"

            min={280}

            max={400}

            value={mobileBoardSize}

            onChange={(e) => setMobileBoardSize(Number(e.target.value))}

          />

        </div>

        <button

          onClick={() => setWhiteOrientation((w) => !w)}

          style={chipStyle()}

        >{t("Ruota", "Rotate")}</button>

      </div>

    );



    const mobileTabs = [

      { id: "moves", label: t("Mosse","Moves") },

      { id: "engine", label: t("Motore","Engine") },

      { id: "pgn", label: "PGN" },

      { id: "settings", label: t("Opzioni","Settings") },

    ];

    const mobilePanels = {

      moves: movesContent,

      engine: engineContent,

      pgn: pgnContent,

      settings: settingsContent,

    };

    return (

      <div style={styles.mApp}>

        <div style={styles.mHeader}>

          <div style={styles.mHeaderRow}>

            <div>

              <div style={styles.title}>PGN Viewer</div>

              <div style={styles.mInfoText}>

                {t("Allenamento sulla linea principale + visualizzazione varianti + analisi motore.", "Train on the main line + view variations + engine analysis.")}

              </div>

            </div>

            <div style={styles.mHeaderActions}>

              <button

                onClick={() => fileInputRef.current?.click()}

                style={styles.mFileButton}

                title={t("Carica un file PGN", "Load a PGN file")}

              >

                {t("Sfoglia","Browse")}

              </button>

              <button

                onClick={resetGame}

                style={styles.mAccentButton}

                title={t("Nuova Partita (posizione iniziale)", "New game (initial position)")}

              >

                {t("Nuova","New")}

              </button>

            </div>

          <div style={styles.mHeaderActions}>

            <button

              onClick={() => setLanguage((l) => (l === "it" ? "en" : "it"))}

              style={styles.mFileButton}

              title={t("Cambia lingua", "Toggle language")}

            >

              🌐 {language.toUpperCase()}

            </button>

          </div>

          </div>

          <input

            ref={fileInputRef}

            id={fileInputId}

            type="file"

            accept=".pgn,.PGN,text/plain"

            onChange={handleFileChange}

            style={{ display: "none" }}

          />

        </div>



        <div style={styles.mBoardWrap}>

          <div style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 8, alignItems: "stretch" }}>

            <div style={{ height: boardRenderWidth }}>

              <EvalBar

                cp={topCp}

                mate={topMate}

                turn={liveFen.split(" ")[1] === "w" ? "w" : "b"}

              />

            </div>

            <div ref={boardCellRef} style={{ width: "100%", display: "flex", justifyContent: "center" }}>

              <div

                onWheel={onWheelNav}

                style={{

                  width: boardRenderWidth,

                  height: boardRenderWidth,

                  borderRadius: 16,

                  overflow: "hidden",

                  boxShadow: "0 6px 18px rgba(15,23,42,0.12)",

                  background: "#fff",

                }}

                title={t("Usa la rotellina per scorrere le mosse", "Use the mouse wheel to scroll moves")}

              >

                <Chessboard

                  options={{

                    id: "main-board",

                    position: liveFen,

                    onPieceDrop,

                    onSquareClick,

                    boardWidth: boardRenderWidth,

                    animationDuration: 200,

                    squareStyles: boardSquareStyles,

                    customPieces: checkmatePieces,

                    arrows: (boardArrows || []).map(([from, to]) => ({

                      startSquare: from,

                      endSquare: to,

                      color: "rgb(0, 128, 0)",

                    })),

                    boardOrientation: whiteOrientation ? "white" : "black",

                  }}

                />

              </div>

            </div>

          </div>

          <div style={styles.mNavRow}>

            <button

              onClick={goStart}

              disabled={atStart}

              style={navStyle(atStart)}

              title={t("Inizio", "Start")}

              aria-label={t("Vai all'inizio", "Go to start")}

            >

              {"\u00AB"} {t("Inizio", "Start")}

            </button>

            <button

              onClick={goPrev}

              disabled={atStart}

              style={navStyle(atStart)}

              title={t("Indietro", "Back")}

              aria-label={t("Mossa precedente", "Previous move")}

            >

              {"\u2039"} {t("Indietro", "Back")}

            </button>

            <button

              onClick={goNext}

              disabled={forwardDisabled}

              style={navStyle(forwardDisabled, true)}

              title={t("Avanti", "Next")}

              aria-label={t("Mossa successiva", "Next move")}

            >

              {t("Avanti", "Next")} {"\u203A"}

            </button>

            <button

              onClick={goEnd}

              disabled={atEnd}

              style={navStyle(atEnd)}

              title={t("Fine", "End")}

              aria-label={t("Vai alla fine", "Go to end")}

            >

              {t("Fine", "End")} {"\u00BB"}

            </button>

          </div>

          <div style={styles.mInfoText}>{statusLine}</div>

          {mateMessage && (

            <div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626" }}>

              {mateMessage}

            </div>

          )}

          {feedback && (

            <div style={{ fontSize: 13, ...(feedback.ok ? styles.feedbackGood : styles.feedbackBad) }}>

              {feedback.text}

            </div>

          )}

        </div>



        <div style={styles.mTabsRow}>

          {mobileTabs.map((tab) => (

            <button

              key={tab.id}

              onClick={() => setMobileTab(tab.id)}

              style={{

                ...styles.mTabBtn,

                ...(mobileTab === tab.id ? styles.mTabBtnActive : {}),

              }}

            >

              {tab.label}

            </button>

          ))}

        </div>



        <div style={styles.mTabPanel}>

          {mobilePanels[mobileTab]}

        </div>

      </div>

    );

  }



  return (

    <div style={styles.app}>

      <div style={styles.container}>

        <div style={styles.header}>

          <div>

            <div style={styles.title}>PGN Viewer</div>

            <div style={{ fontSize: 12, color: "#6b7280" }}>

              {t("Allenamento sulla linea principale + visualizzazione varianti (cliccabili) + analisi motore.", "Train on the main line + clickable variations + engine analysis.")}

            </div>

          </div>

          <div style={styles.controlsRow}>

            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>

              <input

                ref={fileInputRef}

                type="file"

                accept=".pgn,.PGN,text/plain"

                onChange={handleFileChange}

                style={{ display: "none" }}

              />

              <button

                onClick={() => fileInputRef.current?.click()}

                style={styles.btn}

                title={t("Carica un file PGN", "Load a PGN file")}

              >

                {t("Sfoglia","Browse")}

              </button>

              <span style={{ fontSize: 12, color: "#6b7280" }}>

                {fileLabel || t("Nessun file selezionato.", "No file selected.")}

              </span>

            </div>

            <button

              onClick={resetGame}

              style={btnStyle(false)}

              title={t("Nuova Partita (posizione iniziale)", "New game (initial position)")}

            >

              {t("Nuova Partita", "New Game")}

            </button>



            {/* Navigazione */}

                        <button

              style={btnStyle(step === 0 || isAnimating)}

              onClick={goStart}

              disabled={step === 0 || isAnimating}

              title={t("Inizio", "Start")}

              aria-label={t("Vai all'inizio", "Go to start")}

            >

              {"\u00AB"} {t("Inizio", "Start")}

            </button>

            <button

              style={btnStyle(!(step > 0 && !isAnimating))}

              onClick={goPrev}

              disabled={!(step > 0 && !isAnimating)}

              title={t("Indietro", "Back")}

              aria-label={t("Mossa precedente", "Previous move")}

            >

              {"\u2039"} {t("Indietro", "Back")}

            </button>

            <button

              style={{ ...btnStyle(!(step < fenHistory.length - 1 && !isAnimating)), ...styles.btnPrimary }}

              onClick={goNext}

              disabled={!(step < fenHistory.length - 1 && !isAnimating)}

              title={t("Avanti", "Next")}

              aria-label={t("Mossa successiva", "Next move")}

            >

              {t("Avanti", "Next")} {"\u203A"}

            </button>

            <button

              style={btnStyle(isAnimating || step === Math.max(0, fenHistory.length - 1))}

              onClick={goEnd}

              disabled={isAnimating || step === Math.max(0, fenHistory.length - 1)}

              title={t("Fine", "End")}

              aria-label={t("Vai alla fine", "Go to end")}

            >

              {t("Fine", "End")} {"\u00BB"}

            </button>

            <button

              onClick={() => setTraining((t) => !t)}

              style={{ ...styles.btn, ...(training ? styles.btnToggleOn : styles.btnToggleOff) }}

              title={t("Attiva/Disattiva modalita allenamento (linea corrente)", "Toggle training mode (current line)")}

            >

              {training ? t("Allenamento: ON", "Training: ON") : t("Allenamento: OFF", "Training: OFF")}

            </button>

            {training ? (

              <>

                <button

                  onClick={() => setTrainingColor('auto')}

                  style={{ ...styles.btn, ...(trainingColor === 'auto' ? styles.btnToggleOn : {}) }}

                >

                  {t("Replica PGN", "Replay PGN")}

                </button>

                <button

                  onClick={() => setTrainingColor('w')}

                  style={{ ...styles.btn, ...(trainingColor === 'w' ? styles.btnToggleOn : {}) }}

                >

                  {t("Gioco da Bianco", "Play as White")}

                </button>

                <button

                  onClick={() => setTrainingColor('b')}

                  style={{ ...styles.btn, ...(trainingColor === 'b' ? styles.btnToggleOn : {}) }}

                >

                  {t("Gioco da Nero", "Play as Black")}

                </button>

              </>

            ) : null}

            <button

              onClick={() => setTtsEnabled((v) => !v)}

              style={{

                ...styles.btn,

                ...(speechAvailable ? (ttsEnabled ? styles.btnToggleOn : styles.btnToggleOff) : styles.btnDisabled),

              }}

              disabled={!speechAvailable}

              title={speechAvailable ? t("Leggi i commenti tramite sintesi vocale", "Read comments via speech synthesis") : t("Sintesi vocale non supportata", "Speech synthesis not supported")}

            >

              TTS: {ttsEnabled ? "ON" : "OFF"}

            </button>





            {/* Varianti view */}

            <button

              onClick={() => setVariantView(v => v === 'tree' ? 'inline' : 'tree')}

              style={styles.btn}

              title={t("Cambia modalità di visualizzazione delle varianti", "Change variation display mode")}

            >

              {t("Varianti:", "Variations:")} {variantView === 'tree' ? t("albero", "tree") : t("in linea", "inline")}

            </button>



            {/* Apri/Chiudi tutto */}

            <button

              onClick={openAll}

              style={btnStyle(!(variantView === 'tree' && hasAnyVariants))}

              disabled={!(variantView === 'tree' && hasAnyVariants)}

              title={t("Apri tutte le varianti", "Open all variations")}

            >

              {t("Apri tutto", "Open all")}

            </button>

            <button

              onClick={closeAll}

              style={btnStyle(!(variantView === 'tree' && hasAnyVariants))}

              disabled={!(variantView === 'tree' && hasAnyVariants)}

              title={t("Chiudi tutte le varianti", "Close all variations")}

            >

              {t("Chiudi tutto", "Close all")}

            </button>



            {/* Board size */}

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>

              <span style={{ fontSize: 12, color: "#6b7280" }}>{t("Scacchiera", "Board")}</span>

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

              title={t("Ruota la scacchiera", "Rotate the board")}

            >

              {"\u21BB"} {t("Ruota", "Rotate")}

            </button>

            <button

              onClick={() => setLanguage((l) => (l === "it" ? "en" : "it"))}

              style={styles.btn}

              title={t("Cambia lingua interfaccia", "Toggle interface language")}

            >

              🌐 {language.toUpperCase()}

            </button>



            <div style={styles.engineRow}>

              {/* Engine controls */}

              <button

                onClick={() => {

                  const next = !engineOn;

                  setEngineOn(next);

                  if (!next) stop();

                }}

                style={{ ...styles.btn, ...(engineOn ? styles.btnToggleOn : styles.btnToggleOff) }}

                title={ready ? t("Accendi/Spegni motore", "Turn engine on/off") : t("Motore non ancora pronto", "Engine not ready yet")}

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



              {/* VS Engine controls */}

              <button

                onClick={() => {

                  const next = !playVsEngine;

                  setPlayVsEngine(next);

                  setTraining(false);

                  setShowBestOnce(false);

                  if (!next) {

                    setEngineMovePending(false);

                    lastEngineAnalyzeFenRef.current = "";

                    setPlayedMoves([]);

                  } else {

                    lastEngineAnalyzeFenRef.current = "";

                  }

                }}

                style={{ ...styles.btn, ...(playVsEngine ? styles.btnToggleOn : styles.btnToggleOff) }}

                title={t("Gioca contro il motore", "Play against the engine")}

              >

                VS Engine: {playVsEngine ? "ON" : "OFF"}

              </button>



              <select

                style={styles.select}

                value={engineSide}

                onChange={(e) => setEngineSide(((e.target.value === "w" ? "w" : "b") as 'w'|'b'))}

                title={t("Colore del motore", "Engine color")}

              >

                <option value="w">{t("Motore: Bianco", "Engine: White")}</option>

                <option value="b">{t("Motore: Nero", "Engine: Black")}</option>

              </select>

            </div>



            {/* Best move overlay toggle */}

            <button

              onClick={() => setShowBestArrow(s => !s)}

              style={{ ...styles.btn, ...(showBestArrow ? styles.btnToggleOn : styles.btnToggleOff) }}

              title={t("Mostra/Nascondi freccia Best Move del motore", "Show/Hide engine best move arrow")}

            >

              Best move: {showBestArrow ? "ON" : "OFF"}

            </button>

          </div>

        </div>



        <div style={styles.sectionGrid}>

          <div style={styles.card}>

            <div style={{ marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#000" }}>{t("Partite nel PGN", "PGN Games")}</div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>

              <button

                onClick={goPrevGame}

                disabled={!canPrevGame}

                style={btnStyle(!canPrevGame, { padding: '4px 8px', fontSize: 12 })}

                title={t("Partita precedente", "Previous game")}

                aria-label={t("Partita precedente", "Previous game")}

              >

                {"\u2039"}

              </button>

              <select

                style={{ ...styles.select, flex: 1 }}

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

                  <option style={{ color: "#000" }}>{t("(nessuna partita)", "(no games)")}</option>

                )}

              </select>

              <button

                onClick={goNextGame}

                disabled={!canNextGame}

                style={btnStyle(!canNextGame, { padding: '4px 8px', fontSize: 12 })}

                title={t("Partita successiva", "Next game")}

                aria-label={t("Partita successiva", "Next game")}

              >

                {"\u203A"}

              </button>

            </div>

            {games.length ? (

              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>

                {isEnglish ? `Game ${gameIndex + 1} of ${games.length}` : `Partita ${gameIndex + 1} di ${games.length}`}

              </div>

            ) : null}

          </div>





          <div style={styles.card}>

            <div style={{ marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#000" }}>{t("Oppure incolla qui il PGN", "Or paste the PGN here")}</div>

            <div style={{ display: "flex", gap: 8 }}>

              <textarea

                style={styles.textarea}

                value={rawPgn}

                onChange={(e) => setRawPgn(e.target.value)}

                placeholder={t("Incolla qui il tuo PGN...", "Paste your PGN here...")}

              />

              <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={loadFromTextarea}>{t("Carica", "Load")}</button>

            </div>

          </div>

        </div>



        <div style={styles.layout} ref={layoutRef}>

          {/* Pannello sinistro: scacchiera + eval bar + engine panel */}

          <div style={{ ...styles.left, flex: `0 0 ${leftWidth}px` }}>

            {/* Board + EvalBar */}

            <div style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 8 }}>

              {/* Eval Bar (vantaggio White; per Nero Ã¨ complementare) */}

              <div style={{ height: boardRenderWidth }}>

                <EvalBar

                  cp={topCp}

                  mate={topMate}

                  turn={liveFen.split(" ")[1] === "w" ? "w" : "b"}

                />

              </div>



              {/* Scacchiera */}

              <div ref={boardCellRef} style={{ width: "100%" }}>

                <div

                  onWheel={onWheelNav}

                  style={{ width: boardRenderWidth, height: boardRenderWidth, borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 8px rgba(0,0,0,.08)" }}

                  title={t("Usa la rotellina per scorrere le mosse", "Use the mouse wheel to scroll moves")}

                >

                  <Chessboard

                    options={{

                      id: 'main-board',

                      position: liveFen,

                      onPieceDrop, // firma v5: ({ sourceSquare, targetSquare }) => boolean

                      onSquareClick,

                      boardWidth: boardRenderWidth,

                      animationDuration: 200,

                      squareStyles: boardSquareStyles,

                      customPieces: checkmatePieces,

                      arrows: (boardArrows || []).map(([from, to]: any) => ({

                        startSquare: from,

                        endSquare: to,

                        color: 'rgb(0, 128, 0)',

                      })), // ex customArrows

                      boardOrientation: whiteOrientation ? 'white' : 'black',

                    }}

                  />

                </div>

              </div>

            </div>



            <div style={{ textAlign: "center", fontSize: 12, color: "#6b7280" }}>{statusLine}</div>

            {mateMessage && (

              <div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626" }}>

                {mateMessage}

              </div>

            )}

            {feedback && (

              <div style={{ fontSize: 13, ...(feedback.ok ? styles.feedbackGood : styles.feedbackBad) }}>

                {feedback.text}

              </div>

            )}



            <div style={styles.liveMovesPanel}>

              <div style={styles.liveMovesHeader}>

                <span>{t("Mosse della partita", "Game moves")}</span>

                <div style={styles.liveMovesControls}>

                  <button

                    onClick={goStart}

                    disabled={!canGoBackward}

                    style={{

                      ...styles.liveMoveBtn,

                      ...(!canGoBackward ? styles.liveMoveBtnDisabled : {}),

                    }}

                    title={t("Vai all'inizio", "Go to start")}

                  >

                    {"|<"}

                  </button>

                  <button

                    onClick={goPrev}

                    disabled={!canGoBackward}

                    style={{

                      ...styles.liveMoveBtn,

                      ...(!canGoBackward ? styles.liveMoveBtnDisabled : {}),

                    }}

                    title={t("Mossa precedente", "Previous move")}

                  >

                    {"<"}

                  </button>

                  <button

                    onClick={goNext}

                    disabled={!canGoForward}

                    style={{

                      ...styles.liveMoveBtn,

                      ...(!canGoForward ? styles.liveMoveBtnDisabled : {}),

                    }}

                    title={t("Mossa successiva", "Next move")}

                  >

                    {">"}

                  </button>

                  <button

                    onClick={goEnd}

                    disabled={!canGoForward}

                    style={{

                      ...styles.liveMoveBtn,

                      ...(!canGoForward ? styles.liveMoveBtnDisabled : {}),

                    }}

                    title={t("Vai all'ultima mossa", "Go to last move")}

                  >

                    {">|"}

                  </button>

                </div>

              </div>

              {playedMoves.length === 0 ? (

                <div style={styles.liveMovesEmpty}>{t("Nessuna mossa registrata", "No moves recorded yet")}</div>

              ) : (

                <div style={styles.liveMovesList}>

                  {playedMoves.map((mv, idx) => {

                    const prefix = mv.color === "w" ? `${mv.moveNumber}.` : `${mv.moveNumber}...`;

                    const isActive = step === mv.fenIndex;

                    const highlight = mv.from || mv.to ? { from: mv.from ?? null, to: mv.to ?? null } : undefined;

                    return (

                      <div

                        key={`played-${mv.fenIndex}-${idx}`}

                        style={{

                          ...styles.liveMoveChip,

                          ...(isActive ? styles.liveMoveActive : {}),

                        }}

                        role="button"

                        tabIndex={0}

                        onClick={() => animateToStep(mv.fenIndex)}

                        onKeyDown={(e) => {

                          if (e.key === "Enter" || e.key === " ") {

                            e.preventDefault();

                            animateToStep(mv.fenIndex);

                          }

                        }}

                        onMouseEnter={(e) => {

                          if (mv.fen) showPreview(mv.fen, e, highlight);

                        }}

                        onMouseMove={(e) => {

                          if (mv.fen) movePreview(e);

                        }}

                        onMouseLeave={() => hidePreview()}

                        onFocus={(e) => {

                          if (mv.fen) showPreview(mv.fen, e as any, highlight);

                        }}

                        onBlur={() => hidePreview()}

                      >

                        <div style={styles.liveMoveTurn}>{prefix}</div>

                        <div style={styles.liveMoveSan}>{mv.san}</div>

                      </div>

                    );

                  })}

                </div>

              )}

            </div>

            {/* Errori motore */}

            {engineErr && (

              <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 6 }}>{engineErr}</div>

            )}



            {/* Pannello varianti del motore */}

            {engineOn && (

              <div style={{ marginTop: 8 }}>

                {renderEnginePanel()}

              </div>

            )}

          </div>



          {/* Splitter */}

          <div

            style={{ ...styles.splitter, ...(dragging ? styles.splitterActive : {}) }}

            onMouseDown={onSplitDown}

            title={t("Trascina per ridimensionare", "Drag to resize")}

          />



          {/* Pannello destro: mosse/varianti PGN */}

          <div style={styles.right} ref={movesPaneRef}>

            {!treeMain ? (

              <div style={{ fontSize: 12, color: "#6b7280" }}>

                {t("Carica un PGN e seleziona una partita per vedere mosse, commenti e varianti.", "Load a PGN and pick a game to see moves, comments, and variations.")}

              </div>

            ) : (

              <div style={styles.flow}>{flow}</div>

            )}

          </div>

        </div>



        <div style={{ marginTop: 12, fontSize: 12, color: "#6b7280" }}>

          Suggerimento: passa sopra <span style={styles.fenBadge}>Diagramma</span> per l'anteprima.

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

            options={{

              id: 'preview-board',

              position: preview.fen,

              onPieceDrop: undefined,

              boardWidth: pvSize,

              animationDuration: 0,

              arrows: [],

              squareStyles: previewSquareStyles,

            }}

          />

        </div>

      )}

    </div>

  );

}

























