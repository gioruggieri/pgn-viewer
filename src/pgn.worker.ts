import { validateFen } from "chess.js";
import { parseMovetextToTree, preprocessExternalMarkers } from "./pgn";

export type GameSummary = {
  white?: string;
  black?: string;
  event?: string;
  eco?: string;
  result?: string;
};

type GameSource = { headers: Record<string, string>; moves: string };
type ParsedGame = ReturnType<typeof parseMovetextToTree> & { headers: Record<string, string> };
export type PgnRequest =
  | { id: number; type: "load"; source: string }
  | { id: number; type: "select"; index: number };
export type PgnReply =
  | { id: number; type: "game"; game: ParsedGame; summaries?: GameSummary[] }
  | { id: number; type: "error"; reason: "empty" | "invalid" | "fen" };

function indexGames(source: string) {
  const games: GameSource[] = [];
  const normalized = preprocessExternalMarkers(source).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const tokens = /\{[^}]*\}|;[^\n]*|^%[^\n]*|\[\s*([\w]+)\s+"((?:\\.|[^"\\])*)"\s*\]|[()]|[^\s(){};]+|[{};]/gm;
  let headers: Record<string, string> = Object.create(null);
  let moveStart = -1;
  let depth = 0;
  const finish = (end: number) => {
    const moves = moveStart < 0 ? "" : normalized.slice(moveStart, end).trim();
    if (moves || Object.keys(headers).length) games.push({ headers, moves });
    headers = Object.create(null);
    moveStart = -1;
    depth = 0;
  };

  for (const token of normalized.matchAll(tokens)) {
    const [value, name, tag] = token;
    if (name && depth === 0) {
      if (moveStart >= 0 || (name === "Event" && headers.Event)) finish(token.index);
      headers[name] = tag.replace(/\\(["\\])/g, "$1");
      continue;
    }
    if (value.startsWith("%") || value.startsWith(";")) continue;
    if (moveStart < 0) moveStart = token.index;
    if (value === "(") depth++;
    else if (value === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && /^(1-0|0-1|1\/2-1\/2|\*)$/.test(value)) finish(token.index + value.length);
  }
  finish(normalized.length);
  return games;
}

function summarize({ headers }: GameSource): GameSummary {
  return { white: headers.White, black: headers.Black, event: headers.Event, eco: headers.ECO, result: headers.Result };
}

function parse(source: GameSource): ParsedGame {
  const { headers, moves } = source;
  const fen = headers.FEN;
  if (fen && !validateFen(fen).ok) throw new Error("fen");
  const tree = parseMovetextToTree(moves, fen);
  if (!fen && !tree.mainlineFlat.length && (!Object.keys(headers).length || !/^(\*|1-0|0-1|1\/2-1\/2)?$/.test(moves))) {
    throw new Error("invalid");
  }
  return { ...tree, headers };
}

let games: GameSource[] = [];
const cache = new Map<number, ParsedGame>();

self.onmessage = ({ data }: MessageEvent<PgnRequest>) => {
  const send = (reply: PgnReply) => self.postMessage(reply);
  try {
    if (data.type === "load") {
      const next = indexGames(data.source);
      if (!next.length) throw new Error(data.source.trim() ? "invalid" : "empty");
      const game = parse(next[0]);
      games = next;
      cache.clear();
      cache.set(0, game);
      send({ id: data.id, type: "game", game, summaries: games.map(summarize) });
      return;
    }
    const game = cache.get(data.index) ?? parse(games[data.index]);
    cache.delete(data.index);
    cache.set(data.index, game);
    if (cache.size > 8) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    send({ id: data.id, type: "game", game });
  } catch (error) {
    const reason = error instanceof Error && (error.message === "empty" || error.message === "fen") ? error.message : "invalid";
    send({ id: data.id, type: "error", reason });
  }
};
