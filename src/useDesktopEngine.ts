import { useCallback, useEffect, useRef, useState } from "react";
import { resolveEngineUrl, STOCKFISH_ENGINES, uciPathToSan, type EngineLine } from "./useStockfish";

type Search = { fen: string; depth: number; multipv: number };

export function useDesktopEngine(enabled: boolean) {
  const [ready, setReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [engineErr, setEngineErr] = useState<string | null>(null);
  const [resultFen, setResultFen] = useState("");
  const control = useRef<{ request: (search: Search | null) => void } | null>(null);

  useEffect(() => {
    setReady(false);
    setThinking(false);
    setEngineErr(null);
    setResultFen("");
    setLines([]);
    if (!enabled) return;

    let worker: Worker;
    try {
      worker = new Worker(resolveEngineUrl(STOCKFISH_ENGINES[0].scriptPath));
    } catch {
      setEngineErr("Stockfish unavailable");
      return;
    }

    let initialized = false;
    let active: Search | null = null;
    let queued: Search | null = null;
    let stopping = false;
    let debounce: number | undefined;
    let publish: number | undefined;
    let failed = false;
    const rawLines = new Map<number, string>();
    const converted = new Map<string, EngineLine>();

    function flush() {
      window.clearTimeout(publish);
      publish = undefined;
      if (!active || stopping) return;
      const fen = active.fen;
      const factor = fen.split(" ")[1] === "b" ? -1 : 1;
      const next = [...rawLines.entries()].sort(([a], [b]) => a - b).map(([id, message]) => {
        const cached = converted.get(message);
        if (cached) return cached;
        const depth = Number(message.match(/\bdepth (\d+)/)?.[1] ?? 0);
        const score = message.match(/\bscore (cp|mate) (-?\d+)/);
        const pvUci = message.match(/\bpv (.+)$/)?.[1].trim().split(/\s+/) ?? [];
        const { moves: pvSan, fens: pvFens } = uciPathToSan(fen, pvUci);
        const value = Number(score?.[2]) * factor;
        const line = { id, depth, pvUci, pvSan, pvFens, ...(score?.[1] === "mate" ? { mate: value } : { cp: value }) };
        converted.set(message, line);
        return line;
      });
      setResultFen(fen);
      setLines(next);
    }

    function start() {
      debounce = undefined;
      if (!initialized || active || !queued || failed) return;
      active = queued;
      queued = null;
      rawLines.clear();
      converted.clear();
      worker.postMessage(`setoption name MultiPV value ${active.multipv}`);
      worker.postMessage(`position fen ${active.fen}`);
      worker.postMessage(`go depth ${active.depth}`);
    }

    function request(search: Search | null) {
      if (failed) return;
      window.clearTimeout(debounce);
      window.clearTimeout(publish);
      publish = undefined;
      queued = search;
      setLines([]);
      setResultFen("");
      setThinking(Boolean(search));
      if (active && !stopping) {
        stopping = true;
        worker.postMessage("stop");
      }
      if (search) debounce = window.setTimeout(start, 120);
    }

    function fail() {
      failed = true;
      window.clearTimeout(publish);
      window.clearTimeout(debounce);
      window.clearTimeout(startup);
      setEngineErr("Stockfish unavailable");
      setThinking(false);
      setReady(false);
      worker.terminate();
    }

    const startup = window.setTimeout(fail, 12000);
    control.current = { request };
    worker.onerror = fail;
    worker.onmessage = ({ data }: MessageEvent<string>) => {
      for (const message of String(data).split(/\r?\n/)) {
        if (message === "uciok") {
          worker.postMessage("setoption name Threads value 1");
          worker.postMessage("setoption name Hash value 32");
          worker.postMessage("isready");
        } else if (message === "readyok") {
          window.clearTimeout(startup);
          initialized = true;
          setReady(true);
        } else if (message.startsWith("bestmove") && active) {
          if (!stopping) {
            flush();
            setThinking(false);
          }
          stopping = false;
          active = null;
          if (debounce === undefined && queued) start();
        } else if (active && !stopping && message.startsWith("info ") && /\bscore (?:mate|cp) -?\d+.*\bpv /.test(message)) {
          rawLines.set(Number(message.match(/\bmultipv (\d+)/)?.[1] ?? 1), message);
          publish ??= window.setTimeout(flush, 100);
        }
      }
    };
    worker.postMessage("uci");

    return () => {
      window.clearTimeout(startup);
      window.clearTimeout(debounce);
      window.clearTimeout(publish);
      control.current = null;
      worker.terminate();
    };
  }, [enabled]);

  const analyze = useCallback((fen: string, options: { depth?: number; multipv?: number } = {}) => {
    control.current?.request({ fen, depth: options.depth ?? 18, multipv: options.multipv ?? 3 });
  }, []);
  const stop = useCallback(() => control.current?.request(null), []);

  return { ready, thinking, lines, engineErr, resultFen, analyze, stop };
}
