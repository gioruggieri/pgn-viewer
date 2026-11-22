import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameSummary } from "./pgn.worker";
import "./desktop.css";

export type WorkspaceMode = "study" | "training" | "recorder";
type Translate = (it: string, en: string) => string;
type Dialog = "import" | "games" | "settings" | "fen";

type Props = {
  t: Translate;
  board: ReactNode;
  evaluation: ReactNode;
  suggestions: { rank: number; san: string; color: string }[];
  preview: ReactNode;
  transcript: ReactNode;
  engine: ReactNode;
  trainingPanel: ReactNode;
  recorder: ReactNode;
  settings: ReactNode;
  feedback: ReactNode;
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;
  games: GameSummary[];
  gameIndex: number;
  headers: Record<string, string>;
  selectGame: (index: number) => void;
  importPgn: (source: string | File) => void;
  importVersion: number;
  busy: boolean;
  error: string;
  sourceName: string;
  newGame: () => void;
  flip: () => void;
  fen: string;
  step: number;
  lastStep: number;
  locked: boolean;
  navigate: (step: number) => void;
  autoplay: boolean;
  toggleAutoplay: () => void;
  returnToMain?: () => void;
  blackToMove: boolean;
};

function searchText(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function DesktopWorkspace(props: Props) {
  const { t, headers, games, gameIndex, busy, mode, error } = props;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pgn, setPgn] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);
  const [copied, setCopied] = useState(false);
  const modal = useRef<HTMLDialogElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const lastImport = useRef(props.importVersion);

  useEffect(() => {
    if (dialog && !modal.current?.open) {
      modal.current?.showModal();
      if (dialog === "games") modal.current?.querySelector<HTMLInputElement>("#pgn-search")?.focus();
    }
    if (!dialog && modal.current?.open) modal.current.close();
  }, [dialog]);

  useEffect(() => {
    if (lastImport.current === props.importVersion) return;
    lastImport.current = props.importVersion;
    setDialog(current => current === "import" ? null : current);
    setPgn("");
  }, [props.importVersion]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const entries = useMemo(() => games.map((game, index) => ({
    game,
    index,
    terms: searchText([game.white, game.black, game.event, game.eco].join(" ")),
  })), [games]);
  const results = useMemo(() => {
    const words = searchText(deferredQuery.trim()).split(/\s+/);
    return entries.filter(entry => words.every(word => entry.terms.includes(word)));
  }, [entries, deferredQuery]);

  const openGames = () => { setQuery(""); setLimit(100); setDialog("games"); };
  const openFile = (file?: File) => {
    if (!file) return;
    setDialog("import");
    props.importPgn(file);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.fen);
      setCopied(true);
    } catch {
      setDialog("fen");
    }
  };

  const libraryTitle = t("Partite", "Games");
  const importTitle = t("Apri PGN", "Open PGN");
  const settingsTitle = t("Impostazioni", "Settings");
  const titles = { import: importTitle, games: libraryTitle, settings: settingsTitle, fen: t("Posizione FEN", "FEN position") };
  const modes: [WorkspaceMode, string][] = [["study", t("Studio", "Study")], ["training", t("Allenamento", "Training")], ["recorder", t("Registratore", "Recorder")]];
  const first = t("Vai all’inizio", "Go to start");
  const previous = t("Mossa precedente", "Previous move");
  const next = t("Mossa successiva", "Next move");
  const last = t("Vai alla fine", "Go to end");
  const play = props.autoplay ? t("Pausa", "Pause") : t("Riproduci", "Play");
  const loaded = Boolean(Object.keys(headers).length || games.length);
  const metadata = [headers.Event, headers.Date?.replace(/\./g, "/"), headers.ECO, headers.Result]
    .filter(value => value && value !== "?" && value !== "????/??/??" && value !== "*").join(" · ");

  return <div className="pgn-desktop"
    onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={event => {
      if (!event.dataTransfer.files.length) return;
      event.preventDefault();
      openFile(event.dataTransfer.files[0]);
    }}>
    <header className="pgn-topbar">
      <div className="pgn-brand"><span className="pgn-brand-icon" aria-hidden="true">♞</span><span>PGN Viewer</span></div>
      <div className="pgn-top-actions">
        <button type="button" className="pgn-primary" onClick={() => setDialog("import")}>{importTitle}</button>
        <button type="button" onClick={props.newGame}>{t("Nuova partita", "New game")}</button>
        <button type="button" onClick={() => setDialog("settings")}>{settingsTitle}</button>
      </div>
    </header>
    <main className="pgn-workspace">
      <section className="pgn-board-column" aria-label={t("Scacchiera", "Chessboard")}>
        <div className="pgn-board-stage">
          {props.evaluation && <div className="pgn-evaluation">{props.evaluation}</div>}
          <div className="pgn-board-frame">{props.board}</div>
        </div>
        <div className="pgn-navigation">
          <div className="pgn-transport">
            <button type="button" title={first} aria-label={first} disabled={props.locked || props.step === 0} onClick={() => props.navigate(0)}>«</button>
            <button type="button" title={previous} aria-label={previous} disabled={props.locked || props.step === 0} onClick={() => props.navigate(props.step - 1)}>‹</button>
            <button type="button" className="pgn-play" aria-label={play} title={play} aria-pressed={props.autoplay} disabled={props.locked || props.lastStep < 1} onClick={props.toggleAutoplay}>{props.autoplay ? "Ⅱ" : "▶"}</button>
            <button type="button" title={next} aria-label={next} disabled={props.locked || props.step >= props.lastStep} onClick={() => props.navigate(props.step + 1)}>›</button>
            <button type="button" title={last} aria-label={last} disabled={props.locked || props.step >= props.lastStep} onClick={() => props.navigate(props.lastStep)}>»</button>
          </div>
          <div className="pgn-board-tools">
            <button type="button" onClick={props.flip}>{t("Ruota", "Flip")}</button>
            <button type="button" onClick={copy}>{copied ? t("Copiato", "Copied") : t("Copia FEN", "Copy FEN")}</button>
          </div>
          <div className="pgn-progress">
            <input type="range" min={0} max={props.lastStep || 1} value={props.step}
              disabled={props.locked || props.lastStep < 1} aria-label={t("Posizione nella linea", "Position in line")}
              onChange={event => props.navigate(Number(event.currentTarget.value))} />
            <output>{props.step}/{props.lastStep}</output>
          </div>
        </div>
        <div className="pgn-board-status" role="status">
          <span className="pgn-turn-dot" data-black={props.blackToMove} />
          {props.blackToMove ? t("Muove il Nero", "Black to move") : t("Muove il Bianco", "White to move")}
          {props.feedback}
        </div>
        {props.suggestions.length > 0 && <ul className="pgn-suggestions" aria-label={t("Migliori mosse", "Best moves")}>
          {props.suggestions.map(({ rank, san, color }) => <li key={rank}>
            <span className="pgn-suggestion-rank" style={{ backgroundColor: color }}>{rank}</span> {san}
          </li>)}
        </ul>}
      </section>

      <section className="pgn-sidebar" aria-label={t("Pannello partita", "Game panel")}>
        <div className="pgn-game-header">
          <div>
            <h1>{loaded ? <>{headers.White || t("Bianco", "White")} <span>vs</span> {headers.Black || t("Nero", "Black")}</> : t("Scacchiera di studio", "Study board")}</h1>
            {(metadata || props.sourceName) && <p title={props.sourceName}>{metadata || props.sourceName}</p>}
          </div>
          {!!games.length && <button type="button" onClick={openGames}>{libraryTitle} <span>{gameIndex + 1}/{games.length}</span></button>}
        </div>
        <nav className="pgn-tabs" aria-label={t("Modalità", "Mode")}>
          {modes.map(([id, label]) => <button type="button" key={id} aria-pressed={mode === id} onClick={() => props.setMode(id)}>{label}</button>)}
        </nav>
        {error && dialog !== "import" && <div className="pgn-error" role="alert">{error}</div>}
        {mode === "recorder" ? <div className="pgn-panel pgn-recorder">{props.recorder}</div> : <>
          {mode === "training" && props.trainingPanel}
          {props.returnToMain && <div className="pgn-branch-bar"><button type="button" onClick={props.returnToMain}>{t("Torna alla linea principale", "Back to main line")}</button></div>}
          {props.transcript || <div className="pgn-empty">
            <h2>{t("Mosse", "Moves")}</h2>
            <p>{t("Apri un PGN o gioca una mossa sulla scacchiera.", "Open a PGN or play a move on the board.")}</p>
            <button type="button" onClick={() => setDialog("import")}>{importTitle}</button>
          </div>}
          {mode === "study" && props.engine}
        </>}
      </section>
    </main>

    <input type="file" hidden ref={filePicker} accept=".pgn,text/plain" onChange={event => {
      openFile(event.currentTarget.files?.[0]);
      event.currentTarget.value = "";
    }} />
    <dialog ref={modal} className="pgn-dialog" aria-labelledby="pgn-dialog-title" onCancel={event => { event.preventDefault(); setDialog(null); }}>
      {dialog && <>
        <header><h2 id="pgn-dialog-title">{titles[dialog]}</h2><button type="button" aria-label={t("Chiudi", "Close")} onClick={() => setDialog(null)}>×</button></header>
        {dialog === "import" && <form onSubmit={event => { event.preventDefault(); props.importPgn(pgn); }}>
          <div className="pgn-dropzone"><button type="button" onClick={() => filePicker.current?.click()}>{t("Scegli un file PGN", "Choose a PGN file")}</button>
          <span>{t("oppure trascinalo qui", "or drop it here")}</span></div>
          <label htmlFor="pgn-source">{t("Incolla PGN", "Paste PGN")}</label>
          <textarea id="pgn-source" rows={7} spellCheck={false} value={pgn} onChange={event => setPgn(event.target.value)} />
          {error && <div className="pgn-error" role="alert">{error}</div>}
          <button type="submit" className="pgn-primary" disabled={busy || !pgn.trim()}>{busy ? t("Caricamento…", "Loading…") : t("Carica PGN", "Load PGN")}</button>
        </form>}
        {dialog === "games" && <form onSubmit={event => {
          event.preventDefault();
          const words = searchText(query.trim()).split(/\s+/);
          const first = entries.find(entry => words.every(word => entry.terms.includes(word)));
          if (first) { props.selectGame(first.index); setDialog(null); }
        }}>
          <label htmlFor="pgn-search">{t("Cerca giocatore, evento o ECO", "Search by player, event or ECO")}</label>
          <input autoFocus id="pgn-search" type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(100); }} />
          <div className="pgn-search-results">
            {results.slice(0, limit).map(({ game, index }) => <button key={index} type="button"
              aria-current={index === gameIndex ? "true" : undefined}
              onClick={() => { props.selectGame(index); setDialog(null); }}>
              <span>{index + 1}. {game.white || t("Bianco", "White")} vs {game.black || t("Nero", "Black")}</span>
              <small>{[game.event, game.eco, game.result].filter(Boolean).join(" · ")}</small>
            </button>)}
            {results.length === 0 && <p>{t("Nessuna partita trovata.", "No games found.")}</p>}
            {limit < results.length && <button type="button" onClick={() => setLimit(value => value + 100)}>{t("Mostra altre partite", "Show more games")}</button>}
          </div>
        </form>}
        {dialog === "settings" && props.settings}
        {dialog === "fen" && <input aria-label={titles.fen} autoFocus readOnly value={props.fen} onFocus={event => event.currentTarget.select()} />}
      </>}
    </dialog>
    {props.preview}
  </div>;
}

