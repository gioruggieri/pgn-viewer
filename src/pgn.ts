import { Chess, type Square } from "chess.js";

/** Basic header parsing following PGN tag-pair grammar. */

export function parseHeaders(pgn: string) {
  const headers: Record<string, string> = {};
  const headerRegex = /^\s*\[([^\s"]+)\s+"([^"]*)"\]\s*$/gm;
  let m;
  while ((m = headerRegex.exec(pgn))) headers[m[1]] = m[2];
  return headers;

}

/** Compatibilità con marcatori esterni + pulizia detriti engine */

export function preprocessExternalMarkers(pgnText: string) {
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

export function splitGames(pgnText: string) {
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

export function extractMoveText(pgnGame: string) {
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
  const rx = /\{[^}]*\}|;[^\n]*|^%[^\n]*|\$\d+|\d+\.(?:\.\.|…)?|1-0|0-1|1\/2-1\/2|\*|[()]|[^\s(){}$;]+|[{}$;]/gm;
  const tokens: Array<{ t: string; v: string }> = [];
  let m;
  while ((m = rx.exec(raw))) {
    const tok = m[0];
    if (tok[0] === "%") continue;
    if (tok[0] === ";") tokens.push({ t: TT.COMMENT, v: tok.slice(1).trim() });
    else if (tok[0] === "{") tokens.push({ t: TT.COMMENT, v: tok.slice(1, -1).trim() });
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

export type PlyNode = {
  from: Square;
  to: Square;
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

export type PlayedMove = {
  san: string;
  color: 'w' | 'b';
  moveNumber: number;
  fen: string;
  fenIndex: number;
  from?: string | null;
  to?: string | null;
  comment?: string;
  variations?: string[];

};

export type PremoveEntry = {
  from: string;
  to: string;
  piece: string;
  color: 'w' | 'b';
  promotion?: string;
  queuedAtStep: number;
};

export type RecordedGame = {
  id: string;
  headers: Record<string, string>;
  moves: PlayedMove[];
  result: string;
  startFen?: string;
};

const RECORD_HEADER_ORDER = ["Event", "Site", "Date", "Round", "White", "Black", "Result"];

export type VariationInternal = {
  anchorIndex: number;
  startStep: number;
  startFen: string;
  sanMoves: string[];
  comments: string[];
  fenList: string[];
  chess: Chess;
  lastMove: { from: string; to: string } | null;
};

export type VariationState = {
  anchorIndex: number;
  startFen: string;
  sanMoves: string[];
  comments: string[];
  currentFen: string;
  lastMove: { from: string; to: string } | null;
};

export function formatPgnDate(date: Date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}.${m}.${d}`;
}

export function normalizePgnDate(input: string) {
  const trimmed = (input || "").trim();
  if (!trimmed) return "????.??.??";
  const re = /^(\d{4})[.\-/]?(\d{1,2})[.\-/]?(\d{1,2})$/;
  const m = trimmed.match(re);
  if (m) {
    return `${m[1]}.${m[2].padStart(2, "0")}.${m[3].padStart(2, "0")}`;
  }
  return trimmed.replace(/\s+/g, " ");
}

export function sanitizePgnComment(text: string) {
  return text.replace(/\s+/g, " ").replace(/[{}]/g, "").trim();
}

function movesToMovetext(moves: PlayedMove[], result: string) {
  if (!moves.length) return result || "*";
  const parts: string[] = [];
  let lastNumber = 0;
  moves.forEach((move) => {
    const cleaned = move.comment ? sanitizePgnComment(move.comment) : "";
    const comment = cleaned ? ` {${cleaned}}` : "";
    const variations = Array.isArray(move.variations) ? move.variations.filter((v) => !!v && !!String(v).trim()) : [];
    const variationSuffix = variations
      .map((raw) => {
        const trimmed = String(raw || "").trim();
        if (!trimmed) return "";
        const withoutParens = trimmed.startsWith("(") && trimmed.endsWith(")")
          ? trimmed.slice(1, -1).trim()
          : trimmed;
        return withoutParens ? ` (${withoutParens})` : "";
      })
      .join("");
    const segment = `${move.san}${comment}${variationSuffix}`;
    if (move.color === "w") {
      parts.push(`${move.moveNumber}. ${segment}`);
    } else if (parts.length && lastNumber === move.moveNumber) {
      parts[parts.length - 1] = `${parts[parts.length - 1]} ${segment}`;
    } else {
      parts.push(`${move.moveNumber}... ${segment}`);
    }
    lastNumber = move.moveNumber;
  });
  const trimmedResult = (result || "*").trim() || "*";
  return `${parts.join(" ")} ${trimmedResult}`.trim();
}

export function buildRecordedGamePgn(headers: Record<string, string>, moves: PlayedMove[], result: string) {
  const headerLines: string[] = [];
  const extraHeaders: string[] = [];
  const normalizedResult = (result || headers.Result || "*").trim() || "*";
  RECORD_HEADER_ORDER.forEach((key) => {
    let value = headers[key] ?? "";
    if (key === "Result") value = normalizedResult;
    else if (key === "Date") value = normalizePgnDate(value);
    const finalValue = value.trim() ? value.trim() : key === "Date" ? "????.??.??" : "?";
    headerLines.push(`[${key} "${finalValue}"]`);
  });
  Object.keys(headers)
    .filter((key) => !RECORD_HEADER_ORDER.includes(key))
    .sort()
    .forEach((key) => {
      const val = (headers[key] ?? "").trim();
      if (val) extraHeaders.push(`[${key} "${val}"]`);
    });
  const movetext = movesToMovetext(moves, normalizedResult);
  return [...headerLines, ...extraHeaders].join("\n") + `\n\n${movetext}`;
}

export function recordedGamesToPgn(games: RecordedGame[]) {
  return games
    .map((game) => buildRecordedGamePgn(game.headers, game.moves, game.result))
    .filter((chunk) => chunk && chunk.trim())
    .join("\n\n")
    .trim();
}

export function formatVariationSan(startFen: string, sanMoves: string[], comments?: (string | null | undefined)[]) {
  if (!sanMoves.length) return "";
  const tokens: string[] = [];
  const parts = startFen.split(" ");
  const sideToMove = parts[1] === "b" ? "b" : "w";
  let currentColor = sideToMove;
  let moveNumber = parseInt(parts[5], 10);
  if (!Number.isFinite(moveNumber)) moveNumber = 1;
  sanMoves.forEach((sanRaw, idx) => {
    const san = String(sanRaw || "").trim();
    if (!san) return;
    const commentRaw = comments ? comments[idx] ?? "" : "";
    const commentClean = commentRaw ? sanitizePgnComment(commentRaw) : "";
    const commentSuffix = commentClean ? ` {${commentClean}}` : "";
    if (currentColor === "w") {
      tokens.push(`${moveNumber}. ${san}${commentSuffix}`);
      currentColor = "b";
    } else {
      if (tokens.length && !tokens[tokens.length - 1].includes("...")) {
        tokens[tokens.length - 1] = `${tokens[tokens.length - 1]} ${san}${commentSuffix}`;
      } else {
        tokens.push(`${moveNumber}... ${san}${commentSuffix}`);
      }
      moveNumber += 1;
      currentColor = "w";
    }
  });
  return tokens.join(" ").replace(/\s+/g, " ").trim();
}

export function defaultRecordHeaders(): Record<string, string> {
  return {
    Event: "Casual Game",
    Site: "Local",
    Date: formatPgnDate(),
    Round: "1",
    White: "",
    Black: "",
  };

}

export type Line = {
  lid: number;
  startFen: string;
  nodes: PlyNode[];
  preVariations?: Line[];

};

export function sideFromFen(fen: string): "w" | "b" {
  try {
    return fen.split(" ")[1] === "b" ? "b" : "w";
  } catch {
    return "w";
  }

}

export function parseMovetextToTree(moveText: string, startFen?: string): { main: Line; mainlineFlat: PlyNode[] } {
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
        let anchorFen = lastNode ? lastNode.fenBefore : line.startFen;
        let j = idx + 1;
        while (j < tokens.length && (tokens[j].t === TT.COMMENT || tokens[j].t === TT.NAG)) j++;
        if (j < tokens.length && tokens[j].t === TT.MOVE_NUM && lastNode) {
          const wantsBlack = /…|\.\.\.$/.test(tokens[j].v);
          const desired: "w" | "b" = wantsBlack ? "b" : "w";
          const current = sideFromFen(anchorFen);
          if (current !== desired) {
            anchorFen = lastNode.fenAfter;
          }
        }
        if (lastNode && tokens[j]?.t === TT.SAN) {
          try {
            const alternate = new Chess(anchorFen);
            alternate.move(sanitizeSANForMove(tokens[j].v));
          } catch {
            anchorFen = lastNode.fenAfter;
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
        let mv;
        try {
          mv = chess.move(sanClean);
          if (!mv) throw new Error("illegal");
        } catch {
          idx++;
          continue;
        }
        const fenAfter = mv.after;
        const node: PlyNode = {
          id: nextId(),
          from: mv.from,
          to: mv.to,
          san,
          sanClean,
          fenBefore,
          fenAfter,
          moveNumber: fullmove,
          isWhite,
          parent: line.nodes.length ? line.nodes[line.nodes.length - 1] : null,
          commentBefore: pendingBefore.length ? pendingBefore.slice() : undefined,
        };

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
