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
};

type Options = { multipv?: number; depth?: number };

// URL STATICO (JS e .wasm nella stessa cartella, stesso hash nel nome)
const SF_URL = "/engines/stockfish-17.1-lite-single-03e3232.js";

export function useStockfish() {
  const [ready, setReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [engineErr, setEngineErr] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const optsRef   = useRef({ multipv: 3, depth: 18 } as Required<Options>);
  const lastFenRef = useRef("");

  useEffect(() => {
    try {
      // (opzionale) ping per debug chiaro in console
      fetch(SF_URL, { cache: "no-store" })
        .then(r => console.log("SF js:", r.status, r.headers.get("content-type")))
        .catch(()=>{});

      // Worker CLASSIC, non module
      const w = new Worker(SF_URL, { type: "classic" });
      workerRef.current = w;

      w.onmessage = (e: MessageEvent) => {
        const txt: string = String(e.data || "");

        if (txt.includes("uciok")) { w.postMessage("isready"); return; }
        if (txt.includes("readyok")) { setReady(true); return; }

        if (txt.startsWith("info ")) {
          const mDepth = txt.match(/\bdepth (\d+)/);
          const mMPV   = txt.match(/\bmultipv (\d+)/);
          const mMate  = txt.match(/\bscore mate (-?\d+)/);
          const mCp    = txt.match(/\bscore cp (-?\d+)/);
          const mPv    = txt.match(/\bpv (.+)$/);
          if (!mDepth || !mPv || !mMPV) return;

          const recIdx = Number(mMPV[1]);
          const depth  = Number(mDepth[1]);
          const pvUci  = mPv[1].trim().split(/\s+/);

          const fen = lastFenRef.current || new Chess().fen();
          const { moves: pvSan } = uciPathToSan(fen, pvUci);

          const line: EngineLine = { id: recIdx, depth, pvUci, pvSan };
          if (mMate) line.mate = Number(mMate[1]); else if (mCp) line.cp = Number(mCp[1]);

          setLines(prev => {
            const copy = [...prev];
            copy[recIdx - 1] = line;
            return copy;
          });
        }

        if (txt.startsWith("bestmove")) setThinking(false);
      };

      w.onerror = (e) => setEngineErr(`Worker error: ${String((e as any)?.message || e.type || e)}`);

      // avvia UCI
      w.postMessage("uci");
    } catch (err: any) {
      setEngineErr("Impossibile avviare Stockfish: " + String(err?.message ?? err));
    }

    return () => { try { workerRef.current?.terminate(); } catch {} workerRef.current = null; };
  }, []);

  function setOptions(next: Partial<Options>) {
    optsRef.current = { ...optsRef.current, ...next };
  }

  function analyze(fen: string, partial?: Partial<Options>) {
    const w = workerRef.current;
    if (!w) return;
    const { multipv, depth } = { ...optsRef.current, ...partial };

    lastFenRef.current = fen;
    setLines([]);
    setThinking(true);

    w.postMessage("stop");
    w.postMessage("ucinewgame");
    w.postMessage("isready");
    w.postMessage(`setoption name MultiPV value ${multipv}`);
    w.postMessage(`position fen ${fen}`);
    w.postMessage(`go depth ${depth} multipv ${multipv}`);
  }

  function stop() {
    workerRef.current?.postMessage("stop");
    setThinking(false);
  }

  return { ready, thinking, lines, engineErr, setOptions, analyze, stop };
}

/* helpers */
function uciPathToSan(startFen: string, uciMoves: string[]) {
  const chess = new Chess(startFen);
  const sanMoves: string[] = [];
  for (const uci of uciMoves) {
    const from = uci.slice(0, 2);
    const to   = uci.slice(2, 4);
    const promo = uci[4] ? uci[4].toLowerCase() : undefined;
    const mv = chess.move({ from, to, promotion: promo as any }, { sloppy: true });
    if (!mv) break;
    sanMoves.push(mv.san);
  }
  return { moves: sanMoves, finalFen: chess.fen() };
}
