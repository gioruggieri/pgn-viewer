// @ts-nocheck
import { DesktopWorkspace, type WorkspaceMode } from "./DesktopWorkspace";
import { DesktopMoves } from "./DesktopMoves";
import { useDesktopEngine } from "./useDesktopEngine";
import type { GameSummary, PgnReply, PgnRequest } from "./pgn.worker";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_POSITION, Chess } from "chess.js";

import { Chessboard } from "react-chessboard";

// === Nuovi import (file separati) ===

import { useStockfish } from "./useStockfish";

import { EvalBar } from "./EvalBar";

import { EnginePanel } from "./EnginePanel";
import {
  defaultRecordHeaders, extractMoveText, formatVariationSan, normalizePgnDate, parseHeaders,
  parseMovetextToTree, preprocessExternalMarkers, recordedGamesToPgn, sanitizePgnComment,
  sideFromFen, splitGames, type Line, type PlayedMove, type PlyNode, type PremoveEntry,
  type RecordedGame, type VariationInternal, type VariationState,
} from "./pgn";




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



const styles = {

  title: { fontSize: 24, fontWeight: 800 },

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



  textInput: {

    width: "100%",

    padding: 8,

    borderRadius: 10,

    borderWidth: 1,

    borderStyle: "solid" as const,

    borderColor: "#d1d5db",

    background: "white",

    color: "#111827",

  },



  recorderPanel: {

    display: "grid",

    gap: 12,

  },

  recorderPanelMobile: {

    display: "grid",

    gap: 12,

    background: "#fff",

    borderRadius: 16,

    padding: 12,

    boxShadow: "0 10px 24px rgba(15,23,42,0.18)",

  },



  recorderActions: {

    display: "flex",

    flexWrap: "wrap" as const,

    gap: 8,

  },



  recordedList: {

    display: "grid",

    gap: 6,

    maxHeight: 160,

    overflowY: "auto" as const,

  },



  recordedRow: {

    display: "flex",

    alignItems: "center",

    justifyContent: "space-between",

    gap: 8,

    padding: "6px 8px",

    borderRadius: 10,

    background: "#f9fafb",

    border: "1px solid #e5e7eb",

    fontSize: 12,

    color: "#374151",

  },



  recordedSummary: { fontSize: 12, color: "#4b5563" },

  variationList: {

    display: "grid",

    gap: 6,

  },

  variationItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#f8fafc",
    color: "#1f2937",
    fontSize: 12,
  },

  variationTag: {

    display: "inline-flex",

    alignItems: "center",

    justifyContent: "center",

    width: 20,

    height: 20,

    borderRadius: "999px",

    background: "#2563eb",

    color: "#fff",

    fontSize: 11,

    fontWeight: 700,

  },

  variationText: {

    flex: 1,

    fontSize: 12,

    color: "#111827",

  },

  variationProgress: {

    fontSize: 12,

    color: "#1d4ed8",

    background: "#eff6ff",

    border: "1px solid #bfdbfe",

    borderRadius: 10,

    padding: "6px 8px",

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

  feedbackBad: { color: "#b91c1c", fontWeight: 700 },

  feedbackGood: { color: "#15803d", fontWeight: 700 },



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



const suggestionColors = ["#20664b", "#1d4ed8", "#b45309", "#7e22ce", "#be185d"] as const;

const variationIndent = (level: number) => ({ marginLeft: level * 16 });



/* =====================================================

   Main App

   ===================================================== */

export default function App() {

  const [rawPgn, setRawPgn] = useState("");

  const [games, setGames] = useState<string[]>([]);

  const gameIndexRef = useRef(0);
  const randomPickBusyRef = useRef(false);
  const [gameIndex, setGameIndex] = useState(0);

  useEffect(() => {
    gameIndexRef.current = gameIndex;
  }, [gameIndex]);

  const [headers, setHeaders] = useState<Record<string, string>>({});

  const [isMobile, setIsMobile] = useState(() => detectMobile());

  const [desktopGames, setDesktopGames] = useState<GameSummary[]>([]);
  const [desktopIndex, setDesktopIndex] = useState(0);
  const gameCount = isMobile ? games.length : desktopGames.length;
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("study");
  const [autoplay, setAutoplay] = useState(false);
  const [autoplayInterval, setAutoplayInterval] = useState(800);
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importVersion, setImportVersion] = useState(0);
  const pgnWorker = useRef<Worker | null>(null);
  const candidateWorker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const loadedIndex = useRef(0);

  useEffect(() => () => {
    requestId.current++;
    pgnWorker.current?.terminate();
    candidateWorker.current?.terminate();
    pgnWorker.current = null;
    candidateWorker.current = null;
  }, [isMobile]);

  const [mobileTab, setMobileTab] = useState<'moves' | 'pgn' | 'engine' | 'settings'>('moves');

  const [mobileEngineSettingsOpen, setMobileEngineSettingsOpen] = useState(false);



  const [treeMain, setTreeMain] = useState<Line | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [fileLabel, setFileLabel] = useState<string>("");

  const [mainlinePlies, setMainlinePlies] = useState<PlyNode[]>([]);
  const [currentLinePlies, setCurrentLinePlies] = useState<PlyNode[]>([]);



  const [fenHistory, setFenHistory] = useState<string[]>(() => [DEFAULT_POSITION]);

  const [step, setStep] = useState(0);

  const [playedMoves, setPlayedMoves] = useState<PlayedMove[]>([]);

  const [recordHeaders, setRecordHeaders] = useState<Record<string, string>>(() => defaultRecordHeaders());

  const [recordResult, setRecordResult] = useState("*");

  const [recordedGames, setRecordedGames] = useState<RecordedGame[]>([]);

  const recordedIdRef = useRef(1);

  const [recorderOpen, setRecorderOpen] = useState(false);
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [variationDraft, setVariationDraft] = useState("");
  const variationSessionRef = useRef<VariationInternal | null>(null);
  const [variationSession, setVariationSession] = useState<VariationState | null>(null);
  const [variationEditIndex, setVariationEditIndex] = useState<number | null>(null);
  const [moveFrom, setMoveFrom] = useState('');
  const [optionSquares, setOptionSquares] = useState<Record<string, React.CSSProperties>>({});
  const variationDraftRef = useRef("");

  const clearVariationSession = useCallback(() => {

    variationSessionRef.current = null;

    setVariationSession(null);

    setVariationDraft("");
    setVariationEditIndex(null);

  }, []);

  useEffect(() => {

    clearVariationSession();

  }, [games, gameIndex, clearVariationSession]);

  const TRAINING_AUTO_DELAY_MS = 500;
  const trainingAutoMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTrainingAutoMoveRef = useRef(false);

  const baseLiveFen = fenHistory[step] || DEFAULT_POSITION;
  const liveFen = variationSession?.currentFen ?? baseLiveFen;
  const variationActive = !!variationSession;



  const aggregatedRecordedPgn = useMemo(() => recordedGamesToPgn(recordedGames), [recordedGames]);



  const activeRecordedMove = useMemo(

    () => playedMoves.find((mv) => mv.fenIndex === step),

    [playedMoves, step]

  );



  const activeFenIndex = activeRecordedMove?.fenIndex ?? null;



  const activeCommentValue = activeRecordedMove?.comment ?? "";
  const activeVariations = activeRecordedMove?.variations || [];

  const activeMoveLabel = useMemo(() => {

    if (!activeRecordedMove) return "";

    const prefix = activeRecordedMove.color === "w" ? `${activeRecordedMove.moveNumber}.` : `${activeRecordedMove.moveNumber}...`;

    return `${prefix} ${activeRecordedMove.san}`;

  }, [activeRecordedMove]);

  useEffect(() => {
    setVariationEditIndex(null);
    setVariationDraft("");
  }, [activeFenIndex]);

  useEffect(() => {
    variationDraftRef.current = variationDraft;
    const session = variationSessionRef.current;
    if (session && session.sanMoves.length) {
      const idx = session.sanMoves.length - 1;
      session.comments[idx] = variationDraft;
      setVariationSession({
        anchorIndex: session.anchorIndex,
        startFen: session.startFen,
        sanMoves: [...session.sanMoves],
        comments: [...session.comments],
        currentFen: session.fenList[session.fenList.length - 1] ?? session.startFen,
        lastMove: session.lastMove,
      });
    }
  }, [variationDraft]);



  const handleActiveCommentChange = useCallback(

    (value: string) => {

      if (activeFenIndex == null) return;

      const normalized = value.replace(/\r\n/g, "\n");

      setPlayedMoves((prev) =>

        prev.map((mv) =>

          mv.fenIndex === activeFenIndex ? { ...mv, comment: normalized } : mv

        )

      );

    },

    [activeFenIndex]

  );



  const clearActiveComment = useCallback(() => {

    if (activeFenIndex == null) return;

    setPlayedMoves((prev) =>

      prev.map((mv) =>

        mv.fenIndex === activeFenIndex ? { ...mv, comment: undefined } : mv

      )

    );

  }, [activeFenIndex]);



  // === dimensioni/resize ===

  const boardCellRef = useRef<HTMLDivElement | null>(null);

  const [mobileBoardSize, setMobileBoardSize] = useState(320); // Dimensione predefinita per mobile



  // Calcola la dimensione ottimale per la scacchiera in base al dispositivo

  const calculateOptimalBoardSize = () => {

    if (!isMobile) return 400;



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

    if (!isMobile || !el) return;

    const updateBoardSize = () => {

      setMobileBoardSize(calculateOptimalBoardSize());

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
  const [trainingRandomGame, setTrainingRandomGame] = useState(false);
  const pickRandomTrainingGame = useCallback(() => {
    if (!gameCount || randomPickBusyRef.current) return;

    randomPickBusyRef.current = true;

    const prevIndex = gameIndexRef.current;

    let nextIndex = prevIndex;

    if (gameCount === 1) {

      nextIndex = 0;

    } else {

      nextIndex = Math.floor(Math.random() * gameCount);

      if (nextIndex === prevIndex) {

        nextIndex = (nextIndex + 1 + Math.floor(Math.random() * (gameCount - 1))) % gameCount;

      }

    }

    gameIndexRef.current = nextIndex;

    setGameIndex(nextIndex);

    randomPickBusyRef.current = false;

  }, [gameCount]);
  const [trainingShowTranscript, setTrainingShowTranscript] = useState(false);

  const [feedback, setFeedback] = useState<null | { ok: boolean; text: string }>(null);

  const feedbackTimer = useRef<any>(null);
  const prevTrainingRef = useRef(training);
  const prevTrainingRandomRef = useRef(trainingRandomGame);

  useEffect(() => () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current); }, []);

  useEffect(() => {
    if (training && !prevTrainingRef.current) {
      if (trainingRandomGame) {
        pickRandomTrainingGame();
        setTrainingShowTranscript(false);
      }
    } else if (!training) {
      setTrainingShowTranscript(false);
    }
    prevTrainingRef.current = training;
  }, [training, trainingRandomGame, pickRandomTrainingGame]);

  useEffect(() => {
    if (training && trainingRandomGame && !prevTrainingRandomRef.current) {
      pickRandomTrainingGame();
      setTrainingShowTranscript(false);
    }
    if (!trainingRandomGame) {
      setTrainingShowTranscript(false);
    }
    prevTrainingRandomRef.current = trainingRandomGame;
  }, [trainingRandomGame, training, pickRandomTrainingGame]);

  useEffect(() => {
    if (!training || !trainingRandomGame) return;
    if (!gameCount) return;
    pickRandomTrainingGame();
    setTrainingShowTranscript(false);
  }, [gameCount, training, trainingRandomGame, pickRandomTrainingGame]);



  // animazione

  const ANIM_MS = 300;

  const [isAnimating, setIsAnimating] = useState(false);

  const animTimerRef = useRef<any>(null);

  const stepRef = useRef(step);
  const clearTrainingAutoMoveTimer = useCallback(() => {
    if (trainingAutoMoveTimerRef.current !== null) {
      clearTimeout(trainingAutoMoveTimerRef.current);
      trainingAutoMoveTimerRef.current = null;
    }
  }, []);
  const scheduleTrainingAutoMove = useCallback((fn: () => void) => {
    clearTrainingAutoMoveTimer();
    trainingAutoMoveTimerRef.current = setTimeout(() => {
      trainingAutoMoveTimerRef.current = null;
      fn();
    }, TRAINING_AUTO_DELAY_MS);
  }, [clearTrainingAutoMoveTimer]);

  const lastSpokenKeyRef = useRef<string | null>(null);

  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => () => clearTrainingAutoMoveTimer(), [clearTrainingAutoMoveTimer]);

  useEffect(() => {
    if (!training) {
      pendingTrainingAutoMoveRef.current = false;
      clearTrainingAutoMoveTimer();
    }
  }, [training, clearTrainingAutoMoveTimer]);



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

  const hidePreview = useCallback(() => setPreview(p => p.visible ? { ...p, visible: false } : p), []);



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
    if (!isMobile && activeEl.getBoundingClientRect().top >= pane.getBoundingClientRect().top &&
        activeEl.getBoundingClientRect().bottom <= pane.getBoundingClientRect().bottom) return;

    // Scroll only the PGN pane, keeping the rest of the page steady
    const paneRect = pane.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    const deltaTop = activeRect.top - paneRect.top;
    const current = pane.scrollTop;
    const target = current + deltaTop - pane.clientHeight / 2 + activeRect.height / 2;
    const maxScroll = Math.max(0, pane.scrollHeight - pane.clientHeight);
    const clamped = Math.max(0, Math.min(target, maxScroll));
    pane.scrollTo({ top: clamped, behavior });

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
    pendingTrainingAutoMoveRef.current = false;
    clearTrainingAutoMoveTimer();



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

  }, [games, gameIndex, isMobile]);



  /* ---------------- Navigation helpers ---------------- */

  const cancelAnimation = () => {

    if (animTimerRef.current) clearTimeout(animTimerRef.current);

    animTimerRef.current = null;

    setIsAnimating(false);

  };

  const animateToStep = (targetStep: number) => {

    if (variationSessionRef.current) return;

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

      const base = isMobile
        ? prev.slice(0, Math.max(0, stepRef.current))
        : prev.filter(move => move.fenIndex <= stepRef.current);

      let nextIndex = stepRef.current;

      const next = [...base];

      entries.forEach(({ move, fen }) => {

        if (!move || !move.san || !fen) return;

        nextIndex += 1;

        next.push({

          san: move.san,

          color: move.color === 'w' ? 'w' : 'b',

          moveNumber: !isMobile && move.before ? Number(move.before.split(" ")[5])
            : typeof move.moveNumber === "number" ? move.moveNumber : Math.ceil(nextIndex / 2),

          fen,

          fenIndex: nextIndex,

          from: move.from || null,

          to: move.to || null,

          variations: [],

        });

      });

      return next;

    });

  }, [isMobile]);






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

    if (!isMobile && !variationSession) {
      if (step === 0) return null;
      const node = currentLinePlies[step - 1];
      if (node?.fenAfter === fenHistory[step]) return { from: node.from, to: node.to };
      const recorded = playedMoves.find(move => move.fenIndex === step);
      if (recorded?.fen === fenHistory[step]) return { from: recorded.from, to: recorded.to };
      try {
        const chess = new Chess(fenHistory[step - 1]);
        const move = chess.moves({ verbose: true }).find(move => move.after === fenHistory[step]);
        return move ? { from: move.from, to: move.to } : null;
      } catch { return null; }
    }
    if (variationSession && variationSession.sanMoves.length) {
      if (variationSession.lastMove) return variationSession.lastMove;
      try {
        const chess = new Chess(variationSession.startFen);
        let last: any = null;
        variationSession.sanMoves.forEach((san) => {
          try {
            const mv = chess.move(san, { sloppy: true });
            if (mv) last = mv;
          } catch {}
        });
        return last ? { from: last.from, to: last.to } : null;
      } catch {
        return null;
      }
    }

    try {

      const chess = new Chess(fenHistory[0]);

      let last: any = null;

      const limit = Math.min(step, fenHistory.length - 1);

      for (let i = 1; i <= limit; i++) {

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

  }, [variationSession, fenHistory, step, currentLinePlies, playedMoves, isMobile]);



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

  const [engineOn, setEngineOn] = useState(false);
  const legacyEngine = useStockfish(undefined, isMobile);
  const desktopEngine = useDesktopEngine(!isMobile && engineOn);
  const { ready, thinking, lines: reportedLines, engineErr, analyze, stop } = isMobile ? legacyEngine : desktopEngine;
  const lines = isMobile || desktopEngine.resultFen === liveFen ? reportedLines : [];
  const [engineDepth, setEngineDepth] = useState(18);

  const [engineMPV, setEngineMPV] = useState(3);
  const [suggestionCount, setSuggestionCount] = useState(0);
  const analysisMultiPv = isMobile ? engineMPV : Math.max(engineMPV, suggestionCount);
  const playingMultiPv = isMobile ? 0 : suggestionCount;

  // === Play vs Engine ===

  const [playVsEngine, setPlayVsEngine] = useState(false);
  useEffect(() => {
    if (playVsEngine) {
      pendingTrainingAutoMoveRef.current = false;
      clearTrainingAutoMoveTimer();
    }
  }, [playVsEngine, clearTrainingAutoMoveTimer]);

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

  const [language, setLanguage] = useState<"it" | "en">(() => {
    try {
      return localStorage.getItem("pgnviewer.language") === "it" ? "it" : "en";
    } catch {
      return "en";
    }
  });

  useEffect(() => {

    try { localStorage.setItem("pgnviewer.language", language); } catch {}

  }, [language]);

  useEffect(() => {

    if (typeof document !== "undefined") {

      document.documentElement.lang = language;

    }

  }, [language]);

  const isEnglish = language === "en";

  const t = useCallback((it: string, en: string) => (isEnglish ? en : it), [isEnglish]);

  const addRecordedGame = useCallback(() => {

    if (!playedMoves.length) {

      flash(false, t("Nessuna mossa da registrare.", "No moves to record."));

      return;

    }

    const snapshotMoves = playedMoves.map((mv, index) => ({
      ...mv,
      fenIndex: isMobile ? mv.fenIndex : index + 1,
      variations: mv.variations ? mv.variations.slice() : undefined,
    }));

    const snapshotHeaders = { ...recordHeaders };

    const normalizedResult = (recordResult || "*").trim() || "*";

    const startFenValue = fenHistory[isMobile ? 0 : playedMoves[0].fenIndex - 1] || DEFAULT_POSITION;
    if (!isMobile) {
      delete snapshotHeaders.SetUp;
      delete snapshotHeaders.FEN;
      if (startFenValue !== DEFAULT_POSITION) {
        snapshotHeaders.SetUp = "1";
        snapshotHeaders.FEN = startFenValue;
      }
    }

    if (editingGameId) {

      let updated = false;

      setRecordedGames((prev) => {

        const next = prev.map((game) => {

          if (game.id !== editingGameId) return game;

          updated = true;

          return { ...game, headers: snapshotHeaders, moves: snapshotMoves, result: normalizedResult, startFen: startFenValue };

        });

        if (!updated) {

          const id = editingGameId;

          return [...next, { id, headers: snapshotHeaders, moves: snapshotMoves, result: normalizedResult, startFen: startFenValue }];

        }

        return next;

      });

      setEditingGameId(null);

      flash(true, t("Partita aggiornata.", "Game updated."));

      return;

    }

    const id = `rec-${recordedIdRef.current++}`;

    setRecordedGames((prev) => [...prev, { id, headers: snapshotHeaders, moves: snapshotMoves, result: normalizedResult, startFen: startFenValue }]);

    flash(true, t("Partita aggiunta al tuo PGN personalizzato.", "Game added to your custom PGN."));

  }, [playedMoves, recordHeaders, recordResult, flash, fenHistory, editingGameId, isMobile, t]);

  const removeRecordedGame = useCallback(

    (id: string) => {

      setRecordedGames((prev) => {

        const next = prev.filter((game) => game.id !== id);

        if (next.length !== prev.length) flash(true, t("Partita rimossa.", "Game removed."));

        return next;

      });

      if (editingGameId === id) {

        setEditingGameId(null);

      }

    },

    [flash, editingGameId, t]

  );

  const resetRecordingForm = useCallback(() => {

    setRecordHeaders(defaultRecordHeaders());

    setRecordResult("*");

    setVariationDraft("");

    setEditingGameId(null);

  }, []);

  const cancelEditingRecordedGame = useCallback(() => {

    setEditingGameId(null);

    setVariationDraft("");

    flash(true, t("Modifica annullata.", "Edit cancelled."));

  }, [flash, t]);

  const ensureVariationSession = useCallback((): VariationInternal | null => {

    if (variationSessionRef.current) return variationSessionRef.current;

    if (training || playVsEngine) {

      flash(false, t("Disattiva il training o il motore per registrare una variante.", "Disable training or the engine to record a variation."));

      return null;

    }

    const currentStep = stepRef.current;
    const anchorIndex = playedMoves.findIndex((mv) => mv.fenIndex === currentStep);

    if (anchorIndex === -1) {

      flash(false, t("Seleziona la mossa a cui aggiungere la variante.", "Select the move you want to annotate with a variation."));

      return null;

    }

    const startFen = fenHistory[currentStep] || new Chess().fen();

    const session: VariationInternal = {

      anchorIndex,

      startStep: currentStep,

      startFen,

      sanMoves: [],

      comments: [],

      fenList: [startFen],

      chess: new Chess(startFen),

      lastMove: null,

    };

    variationSessionRef.current = session;
    setVariationSession({ anchorIndex, startFen, sanMoves: [], comments: [], currentFen: startFen, lastMove: null });
    setVariationDraft("");
    setVariationEditIndex(null);
    flash(true, t("Registrazione variante attiva: effettua mosse sulla scacchiera.", "Variation recording active: play moves on the board."));

    setMoveFrom("");

    setOptionSquares({});

    return session;

  }, [fenHistory, flash, playedMoves, playVsEngine, training, t]);


  const finishVariationRecording = useCallback((commit: boolean) => {

    const session = variationSessionRef.current;

    if (!session) return;

    const lastIndex = session.sanMoves.length - 1;
    if (lastIndex >= 0) {
      session.comments[lastIndex] = variationDraftRef.current;
    }

    variationSessionRef.current = null;

    setVariationSession(null);

    setVariationDraft("");
    setVariationEditIndex(null);

    setMoveFrom("");

    setOptionSquares({});
    setShowBestOnce(false);

    const restoreFen = fenHistory[session.startStep] || session.startFen;

    chessGameRef.current = new Chess(restoreFen);

    setStep(session.startStep);


    if (commit) {

      const anchorIndex = session.anchorIndex;

      if (anchorIndex < 0 || anchorIndex >= playedMoves.length) {
        flash(false, t("Impossibile associare la variante alla mossa selezionata.", "Unable to attach the variation to the selected move."));
        return;
      }

      if (!session.sanMoves.length) {
        flash(false, t("Nessuna mossa registrata per la variante.", "No moves recorded for the variation."));
        return;
      }

      const variationSan = formatVariationSan(session.startFen, session.sanMoves, session.comments);

      if (!variationSan) {

        flash(false, t("Variante non valida.", "Variation is not valid."));

        return;

      }

      setPlayedMoves((prev) =>

        prev.map((mv, idx) => {

          if (idx !== anchorIndex) return mv;

          const existing = mv.variations ? mv.variations.slice() : [];

          if (existing.includes(variationSan)) return mv;

          return { ...mv, variations: [...existing, variationSan] };

        })

      );

      flash(true, t("Variante salvata.", "Variation saved."));

    } else {

      flash(false, t("Variante annullata.", "Variation cancelled."));

    }

  }, [fenHistory, flash, playedMoves, setStep, setPlayedMoves, setMoveFrom, setOptionSquares, setShowBestOnce, t]);

  const startVariationRecording = useCallback(() => {
    if (variationSessionRef.current) {
      flash(false, t("Termina la variante in corso prima di iniziarne una nuova.", "Finish the current variation before starting a new one."));
      return;
    }

    ensureVariationSession();
  }, [ensureVariationSession, flash, t]);

  const beginEditVariation = useCallback((index: number, value: string) => {
    setVariationEditIndex(index);
    setVariationDraft(value.trim());
  }, []);

  const cancelVariationEdit = useCallback(() => {
    setVariationEditIndex(null);
    setVariationDraft("");
  }, []);

  const addVariationToActive = useCallback(() => {
    const text = variationDraft.trim();

    if (!text) {
      flash(false, t("Inserisci una variante prima di aggiungerla.", "Enter a variation before adding it."));
      return;
    }

    if (activeFenIndex == null) {
      flash(false, t("Seleziona una mossa per collegare la variante.", "Select a move to attach the variation to."));
      return;
    }

    const sanitized = text.replace(/^\(([\s\S]*)\)$/u, "$1").trim();

    if (!sanitized) {
      flash(false, t("La variante non pu? essere vuota.", "Variation cannot be empty."));
      return;
    }

    if (variationEditIndex != null) {
      let updated = false;
      let duplicate = false;
      let missing = false;

      setPlayedMoves((prev) =>
        prev.map((mv) => {
          if (mv.fenIndex !== activeFenIndex) return mv;

          const current = mv.variations ? mv.variations.slice() : [];
          const idx = variationEditIndex;

          if (idx < 0 || idx >= current.length) {
            missing = true;
            return mv;
          }

          if (current.some((v, i) => i !== idx && v.trim() === sanitized)) {
            duplicate = true;
            return mv;
          }

          if (current[idx]?.trim() === sanitized) {
            updated = true;
            return mv;
          }

          current[idx] = sanitized;
          updated = true;
          return { ...mv, variations: current };
        })
      );

      if (duplicate) {
        flash(false, t("Questa variante ? gi? presente.", "This variation is already present."));
        return;
      }

      if (!updated || missing) {
        flash(false, t("Impossibile aggiornare la variante selezionata.", "Unable to update the selected variation."));
        return;
      }

      setVariationDraft("");
      setVariationEditIndex(null);
      flash(true, t("Variante aggiornata.", "Variation updated."));
      return;
    }

    let added = false;

    setPlayedMoves((prev) =>
      prev.map((mv) => {
        if (mv.fenIndex !== activeFenIndex) return mv;

        const current = mv.variations ? mv.variations.slice() : [];

        if (current.map((v) => v.trim()).includes(sanitized)) return mv;

        added = true;

        return { ...mv, variations: [...current, sanitized] };
      })
    );

    if (!added) {
      flash(false, t("Questa variante ? gi? presente.", "This variation is already present."));
      return;
    }

    setVariationDraft("");
    flash(true, t("Variante aggiunta.", "Variation added."));
  }, [variationDraft, activeFenIndex, variationEditIndex, flash, t]);


  const removeVariationFromActive = useCallback(
    (index: number) => {
      if (activeFenIndex == null) return;

      let removed = false;

      setPlayedMoves((prev) =>
        prev.map((mv) => {
          if (mv.fenIndex !== activeFenIndex) return mv;

          const current = mv.variations ? mv.variations.slice() : [];

          if (index < 0 || index >= current.length) return mv;

          current.splice(index, 1);

          removed = true;

          return { ...mv, variations: current.length ? current : undefined };
        })
      );

      if (!removed) {
        flash(false, t("Impossibile rimuovere la variante selezionata.", "Unable to remove the selected variation."));
        return;
      }

      if (variationEditIndex != null) {
        setVariationEditIndex(null);
        setVariationDraft("");
      }

      flash(true, t("Variante rimossa.", "Variation removed."));
    },
    [activeFenIndex, variationEditIndex, flash, t]
  );

  const beginEditRecordedGame = useCallback(

    (game: RecordedGame) => {

      clearVariationSession();

      setRecorderOpen(true);

      setEditingGameId(game.id);

      const baseHeaders = defaultRecordHeaders();

      setRecordHeaders({ ...baseHeaders, ...(game.headers || {}) });

      setRecordResult((game.result || "*").trim() || "*");

      const clonedMoves = (game.moves || []).map((mv) => ({
        ...mv,
        variations: mv.variations ? mv.variations.slice() : undefined,
      }));

      setPlayedMoves(clonedMoves);
      setVariationDraft("");

      const startFen = game.startFen || new Chess().fen();

      const newHistory = [startFen, ...clonedMoves.map((mv) => mv.fen)];

      setFenHistory(newHistory);

      setStep(Math.max(0, newHistory.length - 1));

      setTraining(false);

      flash(true, t("Partita caricata per la modifica.", "Game loaded for editing."));

    },

    [clearVariationSession, flash, t]

  );

  const downloadRecordedPgn = useCallback(() => {

    if (!recordedGames.length) {

      flash(false, t("Non ci sono partite registrate da salvare.", "No recorded games to save."));

      return;

    }

    const text = aggregatedRecordedPgn;

    if (!text.trim()) {

      flash(false, t("Il PGN da salvare è vuoto.", "Generated PGN is empty."));

      return;

    }

    if (typeof document === "undefined" || typeof window === "undefined") {

      flash(false, t("Salvataggio disponibile solo nel browser.", "Saving is available in the browser only."));

      return;

    }

    try {

      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });

      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");

      const base = (recordHeaders.Event || "my-games").trim().replace(/\s+/g, "_") || "my-games";

      link.href = url;

      link.download = `${base}-${Date.now()}.pgn`;

      document.body.appendChild(link);

      link.click();

      document.body.removeChild(link);

      URL.revokeObjectURL(url);

      flash(true, t("PGN salvato correttamente.", "PGN saved successfully."));

    } catch {

      flash(false, t("Impossibile salvare il file PGN.", "Unable to save the PGN file."));

    }

  }, [aggregatedRecordedPgn, flash, recordedGames.length, recordHeaders.Event, t]);

  // Rotazione scacchiera

  const [whiteOrientation, setWhiteOrientation] = useState(true);

  useEffect(() => {
    if (isMobile) return;
    try {
      setWhiteOrientation(localStorage.getItem("pgnviewer.desktop.orientation") !== "black");
    } catch {}
  }, [isMobile]);

  const flipDesktopBoard = () => {
    const next = !whiteOrientation;
    setWhiteOrientation(next);
    try { localStorage.setItem("pgnviewer.desktop.orientation", next ? "white" : "black"); } catch {}
  };



  // analizza quando cambia la posizione (se engine ON)

  useEffect(() => {

    if (!engineOn || !ready) return;

    if (!isMobile && playVsEngine) {
      const position = new Chess(liveFen);
      const playable = !position.isGameOver();
      const shouldMove = playable && position.turn() === engineSide;
      setEngineMovePending(shouldMove);
      if (playable && (shouldMove || playingMultiPv > 0)) {
        analyze(liveFen, { depth: engineDepth, multipv: Math.max(1, playingMultiPv) });
      } else stop();
      return;
    }
    analyze(liveFen, { depth: engineDepth, multipv: analysisMultiPv });

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [engineOn, ready, liveFen, engineDepth, analysisMultiPv, playVsEngine ? playingMultiPv : 0, isMobile, isMobile ? null : playVsEngine, isMobile ? null : engineSide]);





  // === VS Engine: trigger analisi solo quando è il turno del motore e serve ===

  useEffect(() => {

    if (!isMobile || !playVsEngine || !engineOn || !ready) return;

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



  // === VS Engine: quando l'analisi è pronta, gioca una sola mossa (pvSan[0]) ===

  useEffect(() => {

    if (!playVsEngine || !engineOn || !ready) return;

    if (!engineMovePending) return;

    if (thinking || (!isMobile && desktopEngine.resultFen !== liveFen)) return;

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



  const suggestions = useMemo(() => {
    if (isMobile || !engineOn || suggestionCount === 0) return [];
    const paths = new Set<string>();
    return lines.flatMap(line => {
      const color = suggestionColors[line.id - 1];
      const move = line.pvUci?.[0];
      const san = line.pvSan?.[0];
      if (!color || line.id > suggestionCount || !move || !san) return [];
      const path = move.slice(0, 4);
      if (paths.has(path)) return [];
      paths.add(path);
      return [{
        rank: line.id, san, color, startSquare: path.slice(0, 2), endSquare: path.slice(2),
      }];
    });
  }, [engineOn, isMobile, lines, suggestionCount]);

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

      lines={isMobile ? lines : lines.slice(0, engineMPV)}

      thinking={thinking}

      depth={engineDepth}

      onPlayLine={handlePlayEngineLine}

      onSelectMove={handleSelectEngineMove}

      baseFen={liveFen}

      onPreviewFen={showPreview}

      onPreviewMove={isMobile ? movePreview : undefined}
      useFenMoveNumbers={!isMobile}

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

  const statusLine = `Posizione ${step}/${Math.max(0, fenHistory.length - 1)}${statusExtras.length ? " - " + statusExtras.join(" - ") : ""}`;



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





  const [premoves, setPremoves] = useState<PremoveEntry[]>([]);
  const premovesRef = useRef<PremoveEntry[]>([]);
  const executingPremoveRef = useRef(false);
  const clearPremoves = useCallback(() => {
    premovesRef.current = [];
    setPremoves([]);
  }, []);

  const queuePremove = useCallback((entry: PremoveEntry) => {
    premovesRef.current = [entry];
    setPremoves([...premovesRef.current]);
  }, []);

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



  const premoveSquareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    premoves.forEach(({ from, to }) => {
      styles[from] = {
        ...(styles[from] || {}),
        boxShadow: "inset 0 0 0 2px rgba(37,99,235,0.6)",
        background: "rgba(37,99,235,0.25)",
      };
      styles[to] = {
        ...(styles[to] || {}),
        boxShadow: "inset 0 0 0 2px rgba(37,99,235,0.6)",
        background: "rgba(37,99,235,0.2)",
      };
    });
    return styles;
  }, [premoves]);

  const boardSquareStyles = useMemo(() => ({ ...baseSquareStyles, ...optionSquares, ...premoveSquareStyles }), [baseSquareStyles, optionSquares, premoveSquareStyles]);



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

        {checkmatedColor === "w" ? "♔" : "♚"}

        <span style={{ fontSize: squareWidth * 0.45, marginLeft: 2 }}>☠</span>

      </div>

    );

    return { [pieceId]: MateKing };

  }, [checkmatedColor]);





  // create a chess game using a ref to always have access to the latest game state

  const [initialChess] = useState(() => new Chess(liveFen));
  const chessGameRef = useRef(initialChess);



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

      const hasMoveOptions = getMoveOptions(square);

      if (hasMoveOptions) {

        setMoveFrom(square);

        return;

      }

      const boardTurn = chessGameRef.current.turn();

      const pieceColor = typeof piece === "string" ? piece[0] : undefined;

      if (pieceColor && pieceColor !== boardTurn) {

        setMoveFrom(square);

        setOptionSquares({

          [square]: {

            background: "rgba(37,99,235,0.25)",

            boxShadow: "inset 0 0 0 2px rgba(37,99,235,0.45)",

          },

        });

      }

      return;

    }



    // Se abbiamo già selezionato un pezzo e clicchiamo su una casella di destinazione

    // square clicked to move to, check if valid move

    const moves = chessGameRef.current.moves({

      square: moveFrom,

      verbose: true

    });

    const foundMove = moves.find(m => m.from === moveFrom && m.to === square);

    const moveFromPiece = chessGameRef.current.get(moveFrom);

    const boardTurn = chessGameRef.current.turn();

    const isPremovablePiece = moveFromPiece && moveFromPiece.color !== boardTurn;


    if (!foundMove && isPremovablePiece) {

      const success = applyDrop(moveFrom, square);

      if (success) {

        setMoveFrom('');

        setOptionSquares({});

        return;

      }

    }


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


  const onSquareRightClick = () => {

    setMoveFrom('');

    setOptionSquares({});

    clearPremoves();

  };



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

    if (!premovesRef.current.length) return;

    const next = premovesRef.current[0];

    if (!next) return;

    if (stepRef.current < next.queuedAtStep) {

      clearPremoves();

      return;

    }

    if (stepRef.current === next.queuedAtStep) return;

    let chess: Chess | null = null;

    try {

      chess = new Chess(liveFen);

    } catch {

      chess = null;

    }

    if (!chess) {

      clearPremoves();

      return;

    }

    if (chess.turn() !== next.color) {

      const piece = chess.get(next.from);

      if (!piece || piece.color !== next.color) {

        clearPremoves();

      }

      return;

    }

    const piece = chess.get(next.from);

    if (!piece || piece.color !== next.color) {

      clearPremoves();

      return;

    }

    executingPremoveRef.current = true;

    const success = applyDrop(next.from, next.to);

    executingPremoveRef.current = false;

    if (!success) {

      clearPremoves();

      return;

    }

    premovesRef.current = premovesRef.current.slice(1);

    setPremoves([...premovesRef.current]);

  }, [liveFen, premoves.length, step]);



  useEffect(() => {

    if (!training || trainingColor === 'auto') return;

    if (playVsEngine) return;

    if (!currentLinePlies.length) return;

    if (step >= currentLinePlies.length) return;

    if (pendingTrainingAutoMoveRef.current) return;

    const expectedPly = currentLinePlies[step];

    if (!expectedPly) return;

    const expectedColor = expectedPly.isWhite ? 'w' : 'b';

    if (expectedColor === trainingColor) return;

    const baseFen = fenHistory[step];

    if (!baseFen) return;

    let autoMove: any = null;
    let newFen = '';
    try {
      const chess = new Chess(baseFen);
      autoMove = chess.move(expectedPly.sanClean, { sloppy: true });
      if (!autoMove) return;
      newFen = chess.fen();
    } catch {
      return;
    }

    const expectedStepIndex = stepRef.current;
    const expectedNodeId = expectedPly.id;

    pendingTrainingAutoMoveRef.current = true;

    scheduleTrainingAutoMove(() => {
      pendingTrainingAutoMoveRef.current = false;

      if (!training || playVsEngine) return;
      if (stepRef.current !== expectedStepIndex) return;

      const nodeAtStep = currentLinePlies[expectedStepIndex];
      if (!nodeAtStep || nodeAtStep.id !== expectedNodeId) return;

      recordPlayedMoves([{ move: autoMove, fen: newFen }]);

      setFenHistory((prev) => {
        const head = prev.slice(0, expectedStepIndex + 1);
        if (head[head.length - 1] === newFen) return prev;
        return [...head, newFen];
      });

      setStep((s) => (s === expectedStepIndex ? s + 1 : s));

      chessGameRef.current = new Chess(newFen);

      setMoveFrom('');
      setOptionSquares({});
    });

  }, [training, trainingColor, playVsEngine, step, currentLinePlies, fenHistory, recordPlayedMoves, scheduleTrainingAutoMove]);



  /* ---------------- Training / DnD ---------------- */

  const applyDrop = (sourceSquare: string, targetSquare: string) => {

    if (sourceSquare === targetSquare) return false;

    const session = variationSessionRef.current;
    const inVariant = !!session;

    const baseFen = inVariant
      ? session!.fenList[session!.fenList.length - 1]
      : fenHistory[stepRef.current];

    const chess = inVariant ? session!.chess : new Chess(baseFen);

    const pieceOnSource = chess.get(sourceSquare);

    if (!pieceOnSource) return false;

    const pieceColor = pieceOnSource.color;

    if (!executingPremoveRef.current) {

      if (pieceColor !== chess.turn()) {

        queuePremove({

          from: sourceSquare,

          to: targetSquare,

          piece: `${pieceColor}${pieceOnSource.type.toUpperCase()}`,

          color: pieceColor,

          promotion: 'q',

          queuedAtStep: stepRef.current,

        });

        return true;

      }

    } else if (pieceColor !== chess.turn()) {

      return false;

    }

    // VS Engine: consenti solo mosse umane nel loro turno

    if (playVsEngine && !inVariant) {

      const humanSide = engineSide === 'w' ? 'b' : 'w';

      if (chess.turn() !== humanSide) { flash(false, "E' il turno del motore."); return false; }

    }



    if (!inVariant && training && stepRef.current < currentLinePlies.length) {

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

          // Blunder helper: se il motore e' acceso e abbiamo la best line, mostra freccia per pochi secondi

          if (engineOn) {

            if (!thinking) analyze(baseFen, { depth: engineDepth, multipv: analysisMultiPv });

            setShowBestOnce(true);

            setTimeout(() => setShowBestOnce(false), 3000);

          }

          return false;

        }



        let userMoveApplied: any = null;

        try { userMoveApplied = chess.move(userMove); } catch { return false; }

        const newFen = chess.fen();



        const nextIndex = stepRef.current + 1;

        const replyPly = currentLinePlies[nextIndex];

        let autoFen: string | null = null;

        let autoReplyMove: any = null;

        if (replyPly && replyPly.isWhite !== expected.isWhite) {

          try {

            autoReplyMove = chess.move(replyPly.sanClean, { sloppy: true });

            autoFen = chess.fen();

          } catch {

            autoReplyMove = null;

            try { chess.load(newFen); } catch {}

          }

        }

        recordPlayedMoves([{ move: userMoveApplied, fen: newFen }]);

        setFenHistory((prev) => [...prev.slice(0, stepRef.current + 1), newFen]);

        setStep((s) => s + 1);

        chessGameRef.current = new Chess(newFen);

        flash(true, "Giusto!");

        setMoveFrom('');

        setOptionSquares({});

        if (autoReplyMove && autoFen && replyPly) {

          const expectedStepAfterUser = stepRef.current + 1;

          const replyNodeId = replyPly.id;

          pendingTrainingAutoMoveRef.current = true;

          scheduleTrainingAutoMove(() => {

            pendingTrainingAutoMoveRef.current = false;

            if (!training || playVsEngine) return;

            if (stepRef.current !== expectedStepAfterUser) return;

            const nodeAtStep = currentLinePlies[expectedStepAfterUser];

            if (!nodeAtStep || nodeAtStep.id !== replyNodeId) return;

            recordPlayedMoves([{ move: autoReplyMove, fen: autoFen }]);

            setFenHistory((prev) => {

              const head = prev.slice(0, expectedStepAfterUser + 1);

              if (head[head.length - 1] === autoFen) return prev;

              return [...head, autoFen];

            });

            setStep((s) => (s === expectedStepAfterUser ? s + 1 : s));

            chessGameRef.current = new Chess(autoFen);

            if (playVsEngine) setEngineMovePending(true);

            setMoveFrom('');

            setOptionSquares({});

          });

        } else {

          pendingTrainingAutoMoveRef.current = false;

          clearTrainingAutoMoveTimer();

          if (playVsEngine) setEngineMovePending(true);

        }

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

    if (inVariant) {

      const lastIdx = session!.sanMoves.length - 1;

      if (lastIdx >= 0) {
        session!.comments[lastIdx] = variationDraftRef.current;
      }

      session!.sanMoves.push(move.san);
      session!.comments.push("");
      session!.lastMove = { from: move.from, to: move.to };
      session!.fenList.push(newFen);

      setVariationSession({
        anchorIndex: session!.anchorIndex,
        startFen: session!.startFen,
        sanMoves: [...session!.sanMoves],
        comments: [...session!.comments],
        currentFen: newFen,
        lastMove: session!.lastMove,
      });

      setVariationDraft("");
      chessGameRef.current = new Chess(newFen);

      setMoveFrom('');

      setOptionSquares({});

      setShowBestOnce(false);

      return true;

    }

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

    const event = hdrs.Event ? ` — ${hdrs.Event}` : "";

    const result = hdrs.Result ? ` (${hdrs.Result})` : "";

    return `${white} vs ${black}${event}${result}`;

  };



  // === Reset partita / nuova partita ===

  const resetGame = () => {
    clearVariationSession();
    pendingTrainingAutoMoveRef.current = false;
    clearTrainingAutoMoveTimer();

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
    pendingTrainingAutoMoveRef.current = false;
    clearTrainingAutoMoveTimer();




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

    if (!isMobile || !treeMain) return null;

    return <RenderMain line={treeMain} />;

  }, [isMobile, treeMain, activeNodeId, fenHistory, step, variantView, openVars, openLines]);

  const transcriptHidden = training && trainingRandomGame && !trainingShowTranscript;



  /* ---------------- Tastiera ---------------- */

  useEffect(() => {

    if (!isMobile) return;
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

  }, [fenHistory.length, isMobile]);



  /* ---------------- Rotellina ---------------- */

  const lastWheelRef = useRef(0);

  const onWheelNav = (e: React.WheelEvent) => {

    if (variationSessionRef.current) return;

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



  const renderRecorder = (mode: "panel" | "mobile") => {

    const addDisabled = playedMoves.length === 0;

    const commentDisabled = !activeRecordedMove;

    const commentFieldDisabled = commentDisabled;

    const clearDisabled = commentDisabled || !activeCommentValue.trim();

    const saveDisabled = recordedGames.length === 0;

    const containerStyle = mode === "panel" ? styles.recorderPanel : styles.recorderPanelMobile;

    const recordSummary = playedMoves.length

      ? isEnglish

        ? `Recorded moves: ${playedMoves.length}`

        : `Mosse registrate: ${playedMoves.length}`

      : t("Nessuna mossa manuale registrata.", "No manual moves recorded yet.");

    const commentHint = activeRecordedMove

      ? `${t("Commento per", "Comment for")} ${activeMoveLabel}`

      : t("Seleziona una mossa dall'elenco per aggiungere un commento.", "Select a move from the list to add a comment.");

    const commentTextareaPlaceholder = commentFieldDisabled
      ? commentHint
      : t("Aggiungi un commento (puoi usare testo libero e notazione PGN).", "Add a comment (free text and PGN notation supported).");

    const variationAnchorMove = variationSession ? playedMoves[variationSession.anchorIndex] : null;

    const variationAnchorMatchesActive = variationSession
      ? (variationAnchorMove?.fenIndex ?? null) === activeFenIndex
      : false;
    const variationPreviewSan = variationSession ? formatVariationSan(variationSession.startFen, variationSession.sanMoves, variationSession.comments) : "";
    const variationEditing = variationEditIndex != null;
    const variationSessionActive = !!variationSession;
    const variationTextareaDisabled = commentDisabled;
    const variationListDisabled = commentDisabled || variationSessionActive;
    const variationActionDisabled = commentDisabled || variationSessionActive;
    const boardVariationDisabled = commentDisabled || training || playVsEngine || variationEditing;
    const boardVariationTooltip = variationEditing
      ? t("Termina la modifica della variante corrente prima di registrare dalla scacchiera.", "Finish editing the current variation before recording from the board.")
      : training || playVsEngine
        ? t("Disattiva il training o il motore per registrare una variante.", "Disable training or the engine to record a variation.")
        : commentDisabled
          ? t("Seleziona la mossa a cui aggiungere la variante.", "Select the move you want to annotate with a variation.")
          : "";
    const variationActionLabel = variationEditing ? t("Salva variante", "Save variation") : t("Aggiungi variante", "Add variation");
    const variationTextareaPlaceholder = variationSessionActive
      ? t("Scrivi un commento da allegare alla variante in corso (verrà aggiunto al termine).", "Write a comment to attach to the ongoing variation (it will be added on finish).")
      : variationEditing
        ? t("Modifica la variante esistente o aggiungi commenti, poi salva.", "Edit the existing variation or add comments, then save.")
        : t("Inserisci la variante in notazione PGN, es. 12...g6 13.Nc3", "Enter the variation in PGN notation, e.g. 12...g6 13.Nc3");

    const gamesSummary = recordedGames.length

      ? isEnglish

        ? `Recorded games: ${recordedGames.length}`

        : `Partite registrate: ${recordedGames.length}`

      : "";

    const editingIndex = editingGameId ? recordedGames.findIndex((g) => g.id === editingGameId) : -1;
    const isEditingRecorded = editingIndex >= 0;
    const primaryActionLabel = isEditingRecorded ? t("Salva modifiche", "Save changes") : t("Aggiungi partita", "Add game");
    const secondaryActionLabel = isEditingRecorded ? t("Annulla modifica", "Cancel edit") : t("Reset intestazioni", "Reset headers");

    const headerFields = [

      { key: "Event", label: t("Evento", "Event") },

      { key: "Site", label: t("Luogo", "Site") },

      { key: "Date", label: t("Data", "Date") },

      { key: "Round", label: t("Turno", "Round") },

      { key: "White", label: t("Bianco", "White") },

      { key: "Black", label: t("Nero", "Black") },

    ];

    return (

      <div style={containerStyle}>

        <div>

          <div style={{ marginBottom: 4, fontSize: 12, fontWeight: 700, color: "#000" }}>

            {t("Registratore PGN", "PGN Recorder")}

          </div>

          {isEditingRecorded ? (

            <div style={{ ...styles.recordedSummary, color: "#1d4ed8", fontWeight: 600 }}>

              {t("Modifica della partita", "Editing game")} #{editingIndex + 1}

            </div>

          ) : null}

          <div style={styles.recordedSummary}>{recordSummary}</div>

        </div>
        <div style={{ display: "grid", gap: 6 }}>




          <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>{commentHint}</div>

          <textarea

            style={{ ...styles.textarea, minHeight: 60, resize: "vertical" as const }}

            value={activeCommentValue}

            onChange={(e) => handleActiveCommentChange(e.target.value)}

            placeholder={commentTextareaPlaceholder}

            disabled={commentFieldDisabled}

            spellCheck={false}

          />

          <div style={styles.recorderActions}>

            <button

              type="button"

              onClick={clearActiveComment}

              style={{
                ...styles.btn,
                ...(clearDisabled ? styles.btnDisabled : styles.btnPrimary),
                padding: "8px 12px",
                fontSize: 12,
              }}

              disabled={clearDisabled}

            >

              {t("Rimuovi commento", "Clear comment")}

            </button>

          </div>

        </div>




        <div style={{ display: "grid", gap: 6 }}>

          <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>

            {t("Varianti per la mossa selezionata", "Variations for the selected move")}

          </div>

          {activeVariations.length ? (
            <div style={styles.variationList}>
              {activeVariations.map((variation, idx) => {
                const isEditing = variationEditIndex === idx;
                const itemStyle = isEditing
                  ? { ...styles.variationItem, border: "1px solid #2563eb", background: "rgba(37, 99, 235, 0.08)" }
                  : styles.variationItem;
                return (
                  <div key={`var-${activeFenIndex ?? "none"}-${idx}`} style={itemStyle}>
                    <span style={styles.variationTag}>{idx + 1}</span>
                    <span style={styles.variationText}>{variation}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => beginEditVariation(idx, variation)}
                        style={{
                          ...styles.btn,
                          ...(isEditing ? styles.btnPrimary : {}),
                          padding: "4px 10px",
                          fontSize: 11,
                        }}
                        title={t("Modifica questa variante", "Edit this variation")}
                        disabled={variationListDisabled}
                      >
                        {isEditing ? t("In modifica", "Editing") : t("Modifica", "Edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeVariationFromActive(idx)}
                        style={{ ...styles.btn, ...styles.btnToggleOff, padding: "4px 10px", fontSize: 11 }}
                        title={t("Rimuovi questa variante", "Remove this variation")}
                        disabled={activeFenIndex == null || variationListDisabled}
                      >
                        {t("Rimuovi", "Remove")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ ...styles.recordedSummary, fontStyle: "italic" }}>
              {commentDisabled
                ? t("Seleziona una mossa per gestire le varianti.", "Select a move to manage variations.")
                : t("Nessuna variante per questa mossa.", "No variations for this move yet.")}
            </div>
          )}

          {variationEditing ? (
            <div style={{ ...styles.variationProgress, color: "#1d4ed8" }}>
              {t('Modifica attiva: aggiorna il testo e premi "Salva variante" o "Annulla modifica".', 'Editing active: update the text then press "Save variation" or "Cancel edit".')}
            </div>
          ) : null}

          {!variationSession ? (
            <div style={styles.recorderActions}>
              <button
                type="button"
                onClick={startVariationRecording}
                style={{
                  ...styles.btn,
                  ...(boardVariationDisabled ? styles.btnDisabled : styles.btnPrimary),
                  padding: "8px 12px",
                  fontSize: 12,
                }}
                disabled={boardVariationDisabled}
                title={boardVariationTooltip || undefined}
              >
                {t("Registra variante sulla scacchiera", "Record variation from the board")}
              </button>
            </div>
          ) : null}

          {variationSession ? (
            variationAnchorMatchesActive ? (
              <div style={styles.variationProgress}>
                {variationSession.sanMoves.length
                  ? `${t("In registrazione:", "Recording:")} ${variationPreviewSan}`
                  : t("Registrazione variante attiva: effettua mosse sulla scacchiera.", "Variation recording active: play moves on the board.")}
              </div>
            ) : (
              <div style={styles.variationProgress}>
                {t("Variante in corso su un'altra mossa. Torna alla mossa selezionata per continuare o concludere.", "Variation recording is active on another move. Return to that move to continue or finish.")}
              </div>
            )
          ) : null}

          {variationSession ? (
            <div style={styles.recorderActions}>
              <button
                type="button"
                onClick={() => finishVariationRecording(true)}
                style={{ ...styles.btn, ...styles.btnPrimary, padding: "8px 12px", fontSize: 12 }}
                disabled={!variationSession.sanMoves.length}
              >
                {t("Termina variante", "Finish variation")}
              </button>
              <button
                type="button"
                onClick={() => finishVariationRecording(false)}
                style={{ ...styles.btn, ...styles.btnToggleOff, padding: "8px 12px", fontSize: 12 }}
              >
                {t("Annulla variante", "Cancel variation")}
              </button>
            </div>
          ) : null}
          <textarea
            style={{ ...styles.textarea, minHeight: 60, resize: "vertical" as const }}
            value={variationDraft}
            onChange={(e) => setVariationDraft(e.target.value)}
            placeholder={variationTextareaPlaceholder}
            disabled={variationTextareaDisabled}
            spellCheck={false}
          />

          <div style={{ ...styles.recorderActions, gap: 8 }}>
            <button
              type="button"
              onClick={addVariationToActive}
              style={{
                ...styles.btn,
                ...(variationActionDisabled ? styles.btnDisabled : styles.btnPrimary),
                padding: "8px 12px",
                fontSize: 12,
              }}
              disabled={variationActionDisabled}
            >
              {variationActionLabel}
            </button>
            {variationEditing ? (
              <button
                type="button"
                onClick={cancelVariationEdit}
                style={{ ...styles.btn, ...styles.btnToggleOff, padding: "8px 12px", fontSize: 12 }}
              >
                {t("Annulla modifica", "Cancel edit")}
              </button>
            ) : null}
          </div>

          <div style={{ fontSize: 11, color: "#6b7280" }}>

            {t(

              "Suggerimento: includi numeri di mossa ed ellissi secondo la sintassi PGN. Le parentesi saranno aggiunte automaticamente.",

              "Tip: include move numbers and ellipses following PGN syntax. Parentheses are added automatically."

            )}

          </div>

        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>

            {t("Intestazioni PGN", "PGN headers")}

          </div>

          <div

            style={{

              display: "grid",

              gap: 8,

              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",

            }}

          >

            {headerFields.map((field) => (

              <label key={field.key} style={{ display: "grid", gap: 4, fontSize: 12, color: "#374151" }}>

                <span>{field.label}</span>

                <input

                  type="text"

                  value={recordHeaders[field.key] ?? ""}

                  onChange={(e) =>

                    setRecordHeaders((prev) => ({

                      ...prev,

                      [field.key]: e.target.value,

                    }))

                  }

                  style={styles.textInput}

                  placeholder={field.label}

                />

              </label>

            ))}

            <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#374151" }}>

              <span>{t("Risultato", "Result")}</span>

              <select

                value={recordResult}

                onChange={(e) => setRecordResult(e.target.value)}

                style={styles.select}

              >

                <option value="*">*</option>

                <option value="1-0">1-0</option>

                <option value="0-1">0-1</option>

                <option value="1/2-1/2">1/2-1/2</option>

              </select>

            </label>

          </div>

          <div style={styles.recorderActions}>

            <button

              type="button"

              onClick={addRecordedGame}

              style={

                addDisabled

                  ? { ...styles.btn, ...styles.btnDisabled, padding: "8px 14px" }

                  : { ...styles.btn, ...styles.btnPrimary, padding: "8px 14px" }

              }

              disabled={addDisabled}

            >

              {primaryActionLabel}

            </button>

            <button

              type="button"

              onClick={isEditingRecorded ? cancelEditingRecordedGame : resetRecordingForm}

              style={{

                ...styles.btn,

                ...(isEditingRecorded ? styles.btnToggleOff : {}),

                padding: "8px 14px",

              }}

            >

              {secondaryActionLabel}

            </button>

          </div>
        </div>



        <div>

          <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>

            {t("Partite registrate", "Recorded games")}

          </div>

          {gamesSummary ? <div style={styles.recordedSummary}>{gamesSummary}</div> : null}

          {recordedGames.length ? (

            <div style={styles.recordedList}>

              {recordedGames.map((game, idx) => {

                const whiteName = (game.headers.White || "").trim() || t("Bianco", "White");

                const blackName = (game.headers.Black || "").trim() || t("Nero", "Black");

                const eventLabel = (game.headers.Event || "").trim() || t("Evento", "Event");

                const subtitle = `${eventLabel}${game.result ? ` - ${game.result}` : ""}`;

                const isEditingThis = editingGameId === game.id;

                const rowStyle = isEditingThis
                  ? { ...styles.recordedRow, borderColor: "#2563eb", background: "#eff6ff" }
                  : styles.recordedRow;

                return (

                  <div key={game.id} style={rowStyle}>

                    <div style={{ display: "grid", gap: 2 }}>

                      <div style={{ fontWeight: 600 }}>{`#${idx + 1} ${whiteName} vs ${blackName}`}</div>

                      <div style={{ fontSize: 11, color: "#6b7280" }}>{subtitle}</div>

                    </div>

                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>

                      <button

                        type="button"

                        onClick={() => beginEditRecordedGame(game)}

                        style={{

                          ...styles.btn,

                          ...(isEditingThis ? styles.btnToggleOn : {}),

                          padding: "6px 10px",

                          fontSize: 11,

                        }}

                        title={t("Modifica questa partita", "Edit this game")}

                      >

                        {isEditingThis ? t("In modifica", "Editing") : t("Modifica", "Edit")}

                      </button>

                      <button

                        type="button"

                        onClick={() => removeRecordedGame(game.id)}

                        style={{ ...styles.btn, ...styles.btnToggleOff, padding: "6px 10px", fontSize: 11 }}

                        title={t("Elimina questa partita", "Remove this game")}

                      >

                        {t("Rimuovi", "Remove")}

                      </button>

                    </div>

                  </div>

                );

              })}

            </div>

          ) : (

            <div style={{ ...styles.recordedSummary, fontStyle: "italic" }}>

              {t("Nessuna partita registrata finora.", "No recorded games yet.")}

            </div>

          )}

        </div>



        <div style={{ display: "grid", gap: 6 }}>

          <div style={styles.recordedSummary}>

            {t("Le partite aggiunte appariranno nella trascrizione qui sotto. Salvale per ottenere un file .pgn.", "Games you add will be listed in the transcript below. Save to download a .pgn file.")}

          </div>

          <textarea

            style={{ ...styles.textarea, minHeight: 120 }}

            value={aggregatedRecordedPgn}

            readOnly

            placeholder={t("Le partite registrate appariranno qui.", "Recorded games will appear here.")}

          />




          <button

            type="button"

            onClick={downloadRecordedPgn}

            style={

              saveDisabled

                ? { ...styles.btn, ...styles.btnDisabled, padding: "10px 16px", fontWeight: 700 }

                : { ...styles.btn, ...styles.btnPrimary, padding: "10px 16px", fontWeight: 700 }

            }

            disabled={saveDisabled}

          >

            {t("Salva PGN", "Save PGN")}

          </button>

        </div>

      </div>

    );

  };



  const applyDesktopGame = useCallback((game: Extract<PgnReply, { type: "game" }>["game"], index: number) => {
    clearVariationSession();
    clearTrainingAutoMoveTimer();
    pendingTrainingAutoMoveRef.current = false;
    clearPremoves();
    setPlayVsEngine(false);
    loadedIndex.current = index;
    setDesktopIndex(index);
    setHeaders(game.headers);
    setTreeMain(game.main);
    setMainlinePlies(game.mainlineFlat);
    setCurrentLinePlies(game.mainlineFlat);
    setFenHistory([game.main.startFen, ...game.main.nodes.map(node => node.fenAfter)]);
    setPlayedMoves([]);
    stepRef.current = 0;
    setStep(0);
    setActiveNodeId(null);
    setMoveFrom("");
    setOptionSquares({});
    hidePreview();
    setAutoplay(false);
    setEngineMovePending(false);
  }, [clearTrainingAutoMoveTimer, clearVariationSession, clearPremoves, hidePreview]);

  const readPgn = async (source: string | File) => {
    const id = ++requestId.current;
    candidateWorker.current?.terminate();
    candidateWorker.current = null;
    setImporting(true);
    setImportError("");
    setAutoplay(false);
    const fail = (reason?: string) => {
      if (requestId.current !== id) return;
      candidateWorker.current?.terminate();
      candidateWorker.current = null;
      setGameIndex(loadedIndex.current);
      setImporting(false);
      setImportError(reason === "fen"
        ? t("La posizione FEN iniziale non è valida.", "The starting FEN is invalid.")
        : t("Impossibile leggere il PGN. Controlla il file o il testo.", "Could not read the PGN. Check the file or text."));
    };

    try {
      const content = typeof source === "string" ? source : await source.text();
      if (requestId.current !== id) return;
      const worker = new Worker(new URL("./pgn.worker.ts", import.meta.url), { type: "module" });
      candidateWorker.current = worker;
      worker.onerror = () => fail();
      worker.onmessage = ({ data }: MessageEvent<PgnReply>) => {
        if (requestId.current !== id || data.id !== id) return;
        if (data.type === "error") { fail(data.reason); return; }
        pgnWorker.current?.terminate();
        pgnWorker.current = worker;
        candidateWorker.current = null;
        setDesktopGames(data.summaries ?? []);
        setGameIndex(0);
        applyDesktopGame(data.game, 0);
        setFileLabel(typeof source === "string" ? "" : source.name);
        setImportVersion(value => value + 1);
        setImporting(false);
      };
      worker.postMessage({ id, type: "load", source: content } satisfies PgnRequest);
    } catch {
      fail();
    }
  };

  useEffect(() => {
    const worker = pgnWorker.current;
    if (isMobile || !worker || importing) return;
    const id = ++requestId.current;
    if (gameIndex === loadedIndex.current) return;
    setImportError("");
    setAutoplay(false);
    const fail = () => {
      if (requestId.current !== id) return;
      setGameIndex(loadedIndex.current);
      setImportError(t("Impossibile aprire la partita selezionata.", "Could not open the selected game."));
    };
    worker.onerror = fail;
    worker.onmessage = ({ data }: MessageEvent<PgnReply>) => {
      if (requestId.current !== id || data.id !== id) return;
      if (data.type === "game") applyDesktopGame(data.game, gameIndex);
      else fail();
    };
    worker.postMessage({ id, type: "select", index: gameIndex } satisfies PgnRequest);
  }, [isMobile, importing, gameIndex, t, applyDesktopGame]);

  const lastStep = fenHistory.length - 1;
  const jump = useCallback((target: number) => {
    if (variationSessionRef.current) return;
    const next = Math.min(lastStep, Math.max(0, target));
    clearPremoves();
    stepRef.current = next;
    setStep(next);
    setMoveFrom("");
    setOptionSquares({});
    hidePreview();
  }, [lastStep, clearPremoves, hidePreview]);

  const navigate = useCallback((target: number) => {
    setAutoplay(false);
    jump(target);
  }, [jump]);

  useEffect(() => {
    if (isMobile || !autoplay) return;
    if (step >= lastStep || variationActive || training || playVsEngine || workspaceMode !== "study") {
      setAutoplay(false);
      return;
    }
    const timer = window.setTimeout(() => jump(step + 1), autoplayInterval);
    return () => window.clearTimeout(timer);
  }, [isMobile, autoplay, autoplayInterval, step, lastStep, jump, variationActive, training, playVsEngine, workspaceMode]);

  useEffect(() => {
    if (isMobile) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || variationActive || playVsEngine) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable], dialog')) return;
      const steps = { ArrowLeft: stepRef.current - 1, ArrowRight: stepRef.current + 1, Home: 0, End: lastStep };
      if (!Object.prototype.hasOwnProperty.call(steps, event.key)) return;
      event.preventDefault();
      navigate(steps[event.key as keyof typeof steps]);
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [isMobile, lastStep, navigate, variationActive, playVsEngine]);

  const selectDesktopNode = useCallback((node: PlyNode) => {
    if (variationSessionRef.current || playVsEngine || !node.lineRef) return;
    clearTrainingAutoMoveTimer();
    pendingTrainingAutoMoveRef.current = false;
    setAutoplay(false);
    const line = node.lineRef;
    const next = (node.indexInLine ?? 0) + 1;
    if (line.nodes !== currentLinePlies || fenHistory.length !== line.nodes.length + 1 || node.fenAfter !== fenHistory[next]) {
      setFenHistory([line.startFen, ...line.nodes.map(move => move.fenAfter)]);
      setCurrentLinePlies(line.nodes);
      setPlayedMoves([]);
    }
    clearPremoves();
    stepRef.current = next;
    setStep(next);
    setActiveNodeId(node.id);
    setMoveFrom("");
    setOptionSquares({});
  }, [playVsEngine, clearTrainingAutoMoveTimer, clearPremoves, currentLinePlies, fenHistory]);

  const desktopPreview = useCallback((fen: string, event, node?: PlyNode) => {
    if (!node) {
      try { new Chess(fen); } catch { return; }
    }
    showPreview(fen, event, node);
  }, []);

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

        ) : transcriptHidden ? (

          <div style={{ display: "grid", gap: 8 }}>

            <div style={styles.mInfoText}>

              {t("Trascrizione PGN nascosta durante l'allenamento casuale.", "PGN transcript hidden during random training.")}

            </div>

            <button

              type="button"

              style={styles.mAccentButton}

              onClick={() => setTrainingShowTranscript(true)}

            >

              {t("Mostra trascrizione", "Show transcript")}

            </button>

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



    const pgnTabContent = (

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

    const pgnContent = recorderOpen ? renderRecorder("mobile") : pgnTabContent;



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

            <div style={styles.mChipRow}>

              <button

                onClick={() => {

                  if (!games.length) return;

                  if (trainingRandomGame) {

                    pickRandomTrainingGame();

                  } else {

                    setTrainingRandomGame(true);

                  }

                }}

                style={chipStyle({ active: trainingRandomGame, disabled: !games.length })}

                disabled={!games.length}

                title={t("Seleziona automaticamente una partita casuale al via dell'allenamento", "Pick a random game when training starts")}

              >

                {trainingRandomGame ? t("Nuova casuale", "Pick another") : t("Partita casuale", "Random game")}

              </button>

              {trainingRandomGame ? (

                <button

                  onClick={() => setTrainingRandomGame(false)}

                  style={chipStyle()}

                  title={t("Disattiva la selezione casuale", "Disable random selection")}

                >

                  {t("Disattiva casuale", "Disable random")}

                </button>

              ) : null}

              {trainingRandomGame ? (

                <button

                  onClick={() => setTrainingShowTranscript((v) => !v)}

                  style={chipStyle({ active: trainingShowTranscript })}

                  title={trainingShowTranscript

                    ? t("Nascondi la trascrizione PGN mentre ti alleni", "Hide the PGN transcript while training")

                    : t("Mostra la trascrizione PGN", "Show the PGN transcript")}

                >

                  {trainingShowTranscript

                    ? t("Nascondi trascrizione", "Hide transcript")

                    : t("Mostra trascrizione", "Show transcript")}

                </button>

              ) : null}

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

              <button

                onClick={() => {

                  setRecorderOpen((open) => {

                    const next = !open;

                    if (next) setMobileTab("pgn");

                    return next;

                  });

                }}

                style={recorderOpen ? styles.mAccentButton : styles.mFileButton}

                title={recorderOpen ? t("Chiudi il registratore PGN", "Close the PGN recorder") : t("Apri il registratore PGN", "Open the PGN recorder")}

              >

                {recorderOpen ? t("Chiudi Recorder", "Close Recorder") : t("PGN Recorder", "PGN Recorder")}

              </button>

            </div>

          <div style={styles.mHeaderActions}>

            <button

              onClick={() => setLanguage((l) => (l === "it" ? "en" : "it"))}

              style={styles.mFileButton}

              title={t("Cambia lingua", "Toggle language")}
            >
              Lang {language.toUpperCase()}

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

                    onSquareRightClick,

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

              disabled={variationActive || atStart}

              style={navStyle(variationActive || atStart)}

              title={t("Inizio", "Start")}

              aria-label={t("Vai all'inizio", "Go to start")}

            >

              {"\u00AB"} {t("Inizio", "Start")}

            </button>

            <button

              onClick={goPrev}

              disabled={variationActive || atStart}

              style={navStyle(variationActive || atStart)}

              title={t("Indietro", "Back")}

              aria-label={t("Mossa precedente", "Previous move")}

            >

              {"\u2039"} {t("Indietro", "Back")}

            </button>

            <button

              onClick={goNext}

              disabled={variationActive || forwardDisabled}

              style={navStyle(variationActive || forwardDisabled, true)}

              title={t("Avanti", "Next")}

              aria-label={t("Mossa successiva", "Next move")}

            >

              {t("Avanti", "Next")} {"\u203A"}

            </button>

            <button

              onClick={goEnd}

              disabled={variationActive || atEnd}

              style={navStyle(variationActive || atEnd)}

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



  const openDiagram = (fen: string) => {
    if (variationActive || playVsEngine) return;
    try {
      const position = new Chess(fen);
      clearTrainingAutoMoveTimer();
      setTraining(false);
      setAutoplay(false);
      setFenHistory([position.fen()]);
      setCurrentLinePlies([]);
      setPlayedMoves([]);
      stepRef.current = 0;
      setStep(0);
      setActiveNodeId(null);
      hidePreview();
    } catch {
      flash(false, t("Diagramma non valido.", "Invalid diagram."));
    }
  };
  const currentNode = currentLinePlies[step - 1];
  const onMainLine = treeMain && fenHistory[0] === treeMain.startFen &&
    currentLinePlies[0]?.lineRef === treeMain && (step === 0 || currentNode?.fenAfter === liveFen);
  const switchMode = (mode: WorkspaceMode) => {
    if (variationActive && mode !== "recorder") return;
    setAutoplay(false);
    if (mode !== "training") setTraining(false);
    if (mode !== "study") setPlayVsEngine(false);
    setWorkspaceMode(mode);
  };
  const startNewDesktopGame = () => {
    requestId.current++;
    candidateWorker.current?.terminate();
    pgnWorker.current?.terminate();
    candidateWorker.current = null;
    pgnWorker.current = null;
    clearPremoves();
    resetGame();
    stepRef.current = 0;
    setTreeMain(null);
    setHeaders({});
    setMainlinePlies([]);
    setCurrentLinePlies([]);
    setDesktopGames([]);
    setGameIndex(0);
    setDesktopIndex(0);
    loadedIndex.current = 0;
    setFileLabel("");
    setAutoplay(false);
    setPlayVsEngine(false);
    setImporting(false);
    setImportError("");
  };
  const desktopTranscript = treeMain?.nodes.length || treeMain?.preVariations?.length || playedMoves.length || transcriptHidden ? (
    <div className="pgn-panel pgn-transcript" ref={movesPaneRef} aria-label={t("Mosse", "Moves")}>
      {transcriptHidden ? (
        <button type="button" onClick={() => setTrainingShowTranscript(true)}>{t("Mostra trascrizione", "Show transcript")}</button>
      ) : <>
        {treeMain && <DesktopMoves key={importVersion + "-" + desktopIndex} line={treeMain}
          activeId={!variationActive && currentNode?.fenAfter === liveFen ? currentNode.id : undefined}
          onSelect={selectDesktopNode} onPreview={desktopPreview} onHidePreview={hidePreview} onOpenDiagram={openDiagram} t={t} />}
        {!!playedMoves.length && <>
          {treeMain && <h3>{t("Mosse giocate", "Played moves")}</h3>}
          {playedMoves.map(move => (
            <div className="pgn-move-row" key={move.fenIndex}>
              <span className="pgn-move-number">{move.moveNumber}{move.color === "w" ? "." : "..."}</span>
              <div><button type="button" className="pgn-move" data-active={step === move.fenIndex || undefined}
                aria-current={step === move.fenIndex ? "step" : undefined} disabled={variationActive || playVsEngine}
                onClick={() => navigate(move.fenIndex)}>{move.san}</button>
                {move.comment && <div className="pgn-comment">{move.comment}</div>}
              </div>
            </div>
          ))}
        </>}
      </>}
    </div>
  ) : null;

  return <DesktopWorkspace t={t} mode={workspaceMode} setMode={switchMode}
    games={desktopGames} gameIndex={desktopIndex} headers={headers} sourceName={fileLabel}
    selectGame={setGameIndex} importPgn={readPgn} importVersion={importVersion} busy={importing} error={importError}
    newGame={startNewDesktopGame} step={step} lastStep={lastStep} fen={liveFen}
    blackToMove={sideFromFen(liveFen) === "b"} flip={flipDesktopBoard}
    locked={variationActive || playVsEngine} navigate={navigate} autoplay={autoplay}
    autoplayInterval={autoplayInterval} setAutoplayInterval={setAutoplayInterval}
    toggleAutoplay={() => {
      if (autoplay) { setAutoplay(false); return; }
      if (workspaceMode !== "study") switchMode("study");
      if (step >= lastStep) jump(0);
      setAutoplay(true);
    }}
    returnToMain={treeMain && !onMainLine && !playVsEngine && !variationActive
      ? () => applyDesktopGame({ headers, main: treeMain, mainlineFlat: treeMain.nodes }, desktopIndex)
      : undefined}
    board={<Chessboard options={{
      id: "desktop-board", position: liveFen, onSquareRightClick,
      onPieceDrop: args => { setAutoplay(false); return onPieceDrop(args); },
      onSquareClick: args => { setAutoplay(false); onSquareClick(args); },
      animationDurationInMs: 160, squareStyles: boardSquareStyles, customPieces: checkmatePieces,
      lightSquareStyle: { backgroundColor: "#edf0da" }, darkSquareStyle: { backgroundColor: "#88a182" },
      arrows: suggestions,
      boardOrientation: whiteOrientation ? "white" : "black",
    }} />}
    suggestions={suggestions}
    evaluation={engineOn ? <EvalBar cp={topCp} mate={topMate}
      label={t("Valutazione Stockfish dal punto di vista del Bianco", "Stockfish evaluation from White’s perspective")} /> : null}
    preview={preview.visible && preview.fen && <div style={{
      position: "fixed", left: pvLeft, top: pvTop, width: pvSize, height: pvSize,
      pointerEvents: "none", zIndex: 9999, borderRadius: 10, overflow: "hidden", boxShadow: "0 8px 28px #0005",
    }}><Chessboard options={{ id: "desktop-preview-board", position: preview.fen, allowDragging: false,
      animationDurationInMs: 0, squareStyles: previewSquareStyles,
      boardOrientation: whiteOrientation ? "white" : "black" }} /></div>}
    feedback={<>
      {mateMessage && <strong>{mateMessage}</strong>}
      {feedback && <strong style={feedback.ok ? styles.feedbackGood : styles.feedbackBad}>{feedback.text}</strong>}
    </>}
    transcript={desktopTranscript}
    trainingPanel={<section className="pgn-training">
      <div className="pgn-control-row">
        <button type="button" className={training ? "" : "pgn-primary"} aria-pressed={training}
          disabled={!treeMain?.nodes.length}
          onClick={() => { setAutoplay(false); setTraining(value => !value); }}>
          {training ? t("Termina allenamento", "End training") : t("Avvia allenamento", "Start training")}
        </button>
        <label>{t("Gioca come", "Play as")} <select value={trainingColor} onChange={event => setTrainingColor(event.target.value)}>
          <option value="auto">{t("Entrambi", "Both")}</option>
          <option value="w">{t("Bianco", "White")}</option><option value="b">{t("Nero", "Black")}</option>
        </select></label>
        <button type="button" aria-pressed={trainingRandomGame} disabled={!gameCount}
          onClick={() => setTrainingRandomGame(value => !value)}>{t("Partita casuale", "Random game")}</button>
        {training && trainingRandomGame && <>
          <button type="button" onClick={pickRandomTrainingGame}>{t("Nuova casuale", "Pick another")}</button>
          <button type="button" onClick={() => setTrainingShowTranscript(value => !value)}>
            {trainingShowTranscript ? t("Nascondi mosse", "Hide moves") : t("Mostra mosse", "Show moves")}
          </button>
        </>}
      </div>
    </section>}
    recorder={workspaceMode === "recorder" ? <>
      {!!playedMoves.length && <div className="pgn-recorded-moves" aria-label={t("Mosse registrate", "Recorded moves")}>
        {playedMoves.map(move => <button type="button" key={move.fenIndex}
          aria-current={step === move.fenIndex ? "step" : undefined}
          disabled={variationActive} onClick={() => navigate(move.fenIndex)}>{move.moveNumber}{move.color === "w" ? "." : "..."} {move.san}</button>)}
      </div>}
      {renderRecorder("panel")}
    </> : null}
    engine={<section className="pgn-engine">
      <div className="pgn-engine-head">
        <h2>{t("Analisi Stockfish", "Stockfish analysis")}</h2>
        <button type="button" aria-pressed={engineOn} onClick={() => {
          if (engineOn) { setPlayVsEngine(false); stop(); }
          setEngineOn(!engineOn);
        }}>{engineOn ? t("Disattiva", "Turn off") : t("Attiva", "Turn on")}</button>
      </div>
      {engineOn && <div className="pgn-engine-content">
        <div className="pgn-control-row">
          <label>{t("Profondit\u00e0", "Depth")} <select value={engineDepth}
            onChange={event => setEngineDepth(Number(event.target.value))}>
            {Array.from({ length: 28 }, (_, index) => index + 8).map(value => <option key={value}>{value}</option>)}
          </select></label>
          <label>{t("Linee", "Lines")} <select value={engineMPV} disabled={playVsEngine} onChange={event => setEngineMPV(Number(event.target.value))}>
            {[1, 2, 3, 4, 5, 6].map(value => <option key={value}>{value}</option>)}
          </select></label>
          <label>{t("Frecce migliori mosse", "Best move arrows")} <select value={suggestionCount}
            onChange={event => setSuggestionCount(Number(event.target.value))}>
            <option value={0}>{t("0 (nessuna)", "0 (off)")}</option>
            {suggestionColors.map((color, index) => <option key={color} value={index + 1}>{index + 1}</option>)}
          </select></label>
          <label><input type="checkbox" checked={playVsEngine} disabled={variationActive}
            onChange={event => { setAutoplay(false); setPlayVsEngine(event.target.checked); }} />
            {t("Gioca contro il motore", "Play against engine")}</label>
          {playVsEngine && <label>{t("Colore motore", "Engine color")} <select value={engineSide} onChange={event => setEngineSide(event.target.value === "w" ? "w" : "b")}>
            <option value="b">{t("Nero", "Black")}</option><option value="w">{t("Bianco", "White")}</option>
          </select></label>}
        </div>
        {engineErr ? <div className="pgn-error" role="alert">{t("Stockfish non disponibile. Disattiva e riattiva per riprovare.", "Stockfish unavailable. Turn it off and on to retry.")}</div>
          : !ready ? <div role="status">{t("Avvio Stockfish...", "Starting Stockfish...")}</div>
          : !playVsEngine ? renderEnginePanel() : thinking ? <div role="status">{t("Il motore sta pensando...", "Engine is thinking...")}</div> : null}
      </div>}
    </section>}
    settings={<div className="pgn-settings">
      <label>{t("Lingua", "Language")} <select value={language} onChange={event => setLanguage(event.target.value === "it" ? "it" : "en")}>
        <option value="it">Italiano</option><option value="en">English</option>
      </select></label>
      <label><input type="checkbox" disabled={!speechAvailable} checked={ttsEnabled} onChange={event => setTtsEnabled(event.target.checked)} />
        {t("Leggi i commenti", "Read annotations aloud")}</label>
      <strong>{t("Scorciatoie", "Keyboard shortcuts")}</strong>
      <span><kbd>&#8592;</kbd> <kbd>&#8594;</kbd> {t("Mossa precedente o successiva", "Previous or next move")}</span>
      <span><kbd>Home</kbd> <kbd>End</kbd> {t("Inizio o fine linea", "Start or end of line")}</span>
    </div>}
  />;
}
