// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";

export type EngineLine = {
  id: number;
  depth: number;
  cp?: number;
  mate?: number;
  pvUci: string[];
  pvSan: string[];
  pvFens: string[];
};

type Options = { multipv?: number; depth?: number };

/** Path assoluto al worker in `public/engines` (compatibile con BASE_URL) */
const BASE = (import.meta as any)?.env?.BASE_URL || "/";
const STOCKFISH_URL = `${BASE.replace(/\/+$/, "")}/engines/stockfish-17.1-lite-single-03e3232.js`;

/** Converte una lista di mosse UCI in SAN partendo da un FEN */
function uciPathToSan(startFen: string, uciMoves: string[]) {
  const chess = new Chess(startFen);
  const sanMoves: string[] = [];
  const fenFrames: string[] = [chess.fen()];
  for (const uci of uciMoves) {
    if (!uci || uci.length < 4) break;
    const from = uci.slice(0, 2);
    const to   = uci.slice(2, 4);
    const promo = uci[4] ? uci[4].toLowerCase() : undefined;
    let mv: any = null;
    try {
      mv = chess.move({ from, to, promotion: promo as any });
    } catch { mv = null; }
    if (!mv) break;
    sanMoves.push(mv.san);
    fenFrames.push(chess.fen());
  }
  return { moves: sanMoves, fens: fenFrames, finalFen: chess.fen() };
}

/** Handler di default per i messaggi del worker */
function defaultOnMessageFactory(params: {
  setReady: (v: boolean) => void;
  setThinking: (v: boolean) => void;
  setLines: React.Dispatch<React.SetStateAction<EngineLine[]>>;
  setEngineErr: (s: string) => void;
  lastFenRef: React.MutableRefObject<string>;
}) {
  const { setReady, setThinking, setLines, setEngineErr, lastFenRef } = params;
  return (w: Worker) => (e: MessageEvent) => {
    let txt = "";
    try { txt = String(e.data ?? ""); } catch (err) { setEngineErr(String(err as any)); return; }

    if (txt.includes("uciok")) { w.postMessage("isready"); return; }
    if (txt.includes("readyok")) {
      setReady(true);
      w.postMessage("setoption name Threads value 1");
      w.postMessage("setoption name Hash value 16");
      return;
    }

    if (txt.startsWith("info ")) {
      try {
        const mDepth = txt.match(/\bdepth (\d+)/);
        const mMPV   = txt.match(/\bmultipv (\d+)/);
        const mMate  = txt.match(/\bscore mate (-?\d+)/);
        const mCp    = txt.match(/\bscore cp (-?\d+)/);
        const mPv    = txt.match(/\bpv (.+)$/);
        if (!mDepth || !mPv || !mMPV) return;

        const recIdx = Number(mMPV[1]);
        const depth  = Number(mDepth[1]);
        const pvUci  = mPv[1].trim().split(/\s+/).filter(Boolean);

        const fen = lastFenRef.current || new Chess().fen();
        const { moves: pvSan, fens: pvFens } = uciPathToSan(fen, pvUci);

        const line: EngineLine = { id: recIdx, depth, pvUci, pvSan, pvFens };
        if (mMate) line.mate = Number(mMate[1]);
        else if (mCp) line.cp = Number(mCp[1]);

        setLines((prev) => {
          const filtered = (prev || []).filter((existing) => existing && existing.id !== line.id);
          filtered.push(line);
          filtered.sort((a, b) => (a?.id ?? 0) - (b?.id ?? 0));
          return filtered;
        });
      } catch (err) {
        setEngineErr("Parse info error: " + String((err as any)?.message ?? err));
      }
      return;
    }

    if (txt.startsWith("bestmove")) {
      setThinking(false);
      return;
    }
  };
}

export function useStockfish() {
  const [ready, setReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [engineErr, setEngineErr] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const optsRef   = useRef({ multipv: 3, depth: 18 } as Required<Options>);
  const lastFenRef = useRef("");

  // stabilità
  const lastGoRef = useRef(0);
  const goTimerRef = useRef<number | null>(null);
  const restartingRef = useRef(false);
  const diedRef = useRef(false);

  useEffect(() => {
    try {
      const w = new Worker(STOCKFISH_URL, { type: "classic" });
      workerRef.current = w;

      const makeHandler = defaultOnMessageFactory({ setReady, setThinking, setLines, setEngineErr: (s)=>setEngineErr(s), lastFenRef });
      w.onmessage = makeHandler(w);
      w.onerror = (e) => {
        const msg = String((e as any)?.message || e.type || e);
        setEngineErr(`Worker error: ${msg}`);
        if (/unreachable|RuntimeError/i.test(msg)) { diedRef.current = true; restartWorker(); }
      };

      w.postMessage("uci");
    } catch (err: any) {
      setEngineErr("Impossibile avviare Stockfish: " + String(err?.message ?? err));
    }

    return () => { try { workerRef.current?.terminate(); } catch {} workerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function restartWorker() {
    if (restartingRef.current) return;
    restartingRef.current = true;
    try { workerRef.current?.terminate(); } catch {}
    workerRef.current = null;
    setReady(false);
    setThinking(false);
    setLines([]);
    setEngineErr(null);
    try {
      const w = new Worker(STOCKFISH_URL, { type: "classic" });
      workerRef.current = w;
      diedRef.current = false;
      const makeHandler = defaultOnMessageFactory({ setReady, setThinking, setLines, setEngineErr: (s)=>setEngineErr(s), lastFenRef });
      w.onmessage = makeHandler(w);
      w.onerror = (e) => {
        const msg = String((e as any)?.message || e.type || e);
        setEngineErr(`Worker error: ${msg}`);
      };
      w.postMessage("uci");
    } catch (err: any) {
      setEngineErr("Impossibile riavviare Stockfish: " + String(err?.message ?? err));
    } finally {
      restartingRef.current = false;
    }
  }

  function setOptions(next: Partial<Options>) {
    optsRef.current = { ...optsRef.current, ...next };
  }

  function analyze(fen: string, partial?: Partial<Options>) {
    const w = workerRef.current;
    if (!w) return;
    if (diedRef.current) return;
    if (!ready) return;

    const { multipv, depth } = { ...optsRef.current, ...partial };

    lastFenRef.current = fen;
    setLines([]);
    setThinking(true);

    // debounce anti-spam
    if (goTimerRef.current) { window.clearTimeout(goTimerRef.current); goTimerRef.current = null; }
    const now = Date.now();
    const delay = now - lastGoRef.current < 120 ? 150 : 0;

    const run = () => {
      lastGoRef.current = Date.now();
      w.postMessage("stop");
      // no ucinewgame/isready qui per evitare race
      w.postMessage(`setoption name MultiPV value ${multipv}`);
      w.postMessage(`position fen ${fen}`);
      w.postMessage(`go depth ${depth}`);
    };

    if (delay) goTimerRef.current = window.setTimeout(run, delay) as any;
    else run();
  }

  function stop() {
    workerRef.current?.postMessage("stop");
    setThinking(false);
  }

  return { ready, thinking, lines, engineErr, setOptions, analyze, stop };
}
