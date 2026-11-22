import { useMemo, useState, type ComponentProps, type ReactNode, type Ref } from "react";
import { DesktopMoves } from "./DesktopMoves";
import { parseMovetextToTree, replaceMoveComment, sideFromFen, type PlayedMove, type PlyNode, type VariationState } from "./pgn";

type StudyProps = Pick<ComponentProps<typeof DesktopMoves>, "t" | "onPreview" | "onHidePreview">;
export type RecordedVariationPosition = { anchor: number; index: number; node: PlyNode };
type RawEditor = { anchor: number; index: number | null; value: string };
type Props = StudyProps & {
  moves: PlayedMove[];
  history: string[];
  step: number;
  selectMove: (step: number) => void;
  position: RecordedVariationPosition | null;
  selectVariation: (position: RecordedVariationPosition | null) => void;
  changeComment: (value: string) => void;
  session: VariationState | null;
  draftComment: string;
  changeDraftComment: (value: string) => void;
  startVariation: () => void;
  finishVariation: (save: boolean) => void;
  saveVariation: (anchor: number, index: number | null, value: string) => boolean;
  removeVariation: (anchor: number, index: number) => void;
  manageGames: () => ReactNode;
  paneRef: Ref<HTMLDivElement>;
};

export function parseRecordedVariation(value: string, before: string, after: string) {
  const number = value.match(/^(?:\s*\{[^}]*\})*\s*\d+(\.{1,3}|…)/)?.[1];
  const preferBefore = number !== undefined && (number === "." ? "w" : "b") === sideFromFen(before);
  const start = preferBefore ? before : after;
  const branch = parseMovetextToTree(value, start, true);
  return branch.main.nodes.length ? branch : parseMovetextToTree(value, preferBefore ? after : before, true);
}

function VariationComment({ move, save, t }: { move: PlyNode; save: (value: string) => void; t: StudyProps["t"] }) {
  const [value, setValue] = useState((move.commentAfter ?? []).join("\n"));
  return <form className="pgn-recorder-editor" onSubmit={event => { event.preventDefault(); save(value); }}>
    <label>
      {t("Commento per", "Comment for")} {move.san}
      <textarea rows={2} value={value} onChange={event => setValue(event.target.value)} />
    </label>
    <div className="pgn-control-row">
      <button type="submit" className="pgn-primary">{t("Salva commento", "Save comment")}</button>
      <button type="button" disabled={!value && !move.commentAfter?.length}
        onClick={() => { setValue(""); save(""); }}>{t("Rimuovi commento", "Clear comment")}</button>
    </div>
  </form>;
}

function RecordedBranch({ value, before, after, selection, onSelect, onSave, ...study }: StudyProps & {
  value: string;
  before: string;
  after: string;
  selection?: PlyNode;
  onSelect: (node: PlyNode) => void;
  onSave: (value: string) => void;
}) {
  const { main, source } = useMemo(() => parseRecordedVariation(value, before, after), [value, before, after]);
  if (!main.nodes.length && !main.preVariations?.length) return <p className="pgn-comment">{value}</p>;

  return <>
    <DesktopMoves {...study} line={main} activeId={selection?.id} onSelect={onSelect} />
    {selection && <VariationComment key={selection.id} move={selection} t={study.t} save={comment => {
      const origin = source?.get(selection.id);
      if (origin) onSave(replaceMoveComment(value, origin, comment));
    }} />}
  </>;
}

export function DesktopRecorder(props: Props) {
  const { t, moves, step, session, position } = props;
  const [showGames, setShowGames] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editor, setEditor] = useState<RawEditor | null>(null);
  const selectMain = (index: number) => {
    setEditor(null);
    props.selectVariation(null);
    props.selectMove(index);
  };

  return <>
    <nav className="pgn-recorder-toolbar" aria-label={t("Sezioni del registratore", "Recorder sections")}>
      <button type="button" aria-pressed={!showGames} onClick={() => setShowGames(false)}>{t("Mosse e annotazioni", "Moves & annotations")}</button>
      <button type="button" aria-pressed={showGames} disabled={!!session}
        onClick={() => { props.selectVariation(null); setShowGames(true); }}>{t("Partite ed esportazione", "Games & export")}</button>
    </nav>
    {showGames ? <div className="pgn-panel pgn-recorder">{props.manageGames()}</div> :
      <div ref={props.paneRef} className="pgn-panel pgn-transcript pgn-recorder" aria-label={t("Mosse registrate", "Recorded moves")}>
        {!moves.length && <div className="pgn-empty">
          <h2>{t("Mosse registrate", "Recorded moves")}</h2>
          <p>{t("Gioca una mossa sulla scacchiera per iniziare.", "Play a move on the board to start recording.")}</p>
        </div>}
        {position && <div className="pgn-recorder-toolbar">
          <button type="button" onClick={() => props.selectVariation(null)}>{t("Torna alla partita", "Back to recording")}</button>
        </div>}
        {moves.some(move => move.variations?.length) && <div className="pgn-variation-tools">
          <button type="button" onClick={() => { setExpanded({}); setAllOpen(true); }}>
            {t("Espandi varianti", "Expand variations")}
          </button>
          <button type="button" onClick={() => { props.selectVariation(null); setExpanded({}); setAllOpen(false); }}>
            {t("Comprimi varianti", "Collapse variations")}
          </button>
        </div>}
        {moves.map(move => {
          const anchor = move.fenIndex;
          const active = anchor === step;
          return <div className="pgn-move-row" key={anchor}>
            <span className="pgn-move-number">{move.moveNumber}{move.color === "w" ? "." : "…"}</span>
            <div>
              <button type="button" className="pgn-move" data-active={(active && !position) || undefined}
                aria-current={active && !position ? "step" : undefined} disabled={!!session}
                onClick={() => selectMain(anchor)}
                onMouseEnter={event => props.onPreview(move.fen, event)}
                onMouseLeave={props.onHidePreview}>{move.san}</button>
              {active && !session && !position ? <div className="pgn-recorder-editor">
                <label>{t("Commento per", "Comment for")} {move.san}
                  <textarea rows={2} value={move.comment ?? ""} onChange={event => props.changeComment(event.target.value)} />
                </label>
                <div className="pgn-control-row">
                  {move.comment && <button type="button" onClick={() => props.changeComment("")}>{t("Rimuovi commento", "Clear comment")}</button>}
                  <button type="button" onClick={() => { setEditor(null); props.startVariation(); }}>
                    {t("Registra variante sulla scacchiera", "Record variation on board")}
                  </button>
                  <button type="button" onClick={() => setEditor({ anchor, index: null, value: "" })}>{t("Inserisci variante PGN", "Enter PGN variation")}</button>
                </div>
              </div> : move.comment && <div className="pgn-comment">{move.comment}</div>}
              {active && session && <div className="pgn-recorder-editor">
                <p>{t("Gioca le mosse della variante sulla scacchiera.", "Play the variation moves on the board.")}</p>
                {session.sanMoves.map((san, index) => <div className="pgn-comment" key={index}>
                  <strong>{san}</strong> {index < session.sanMoves.length - 1 ? session.comments[index] : null}
                </div>)}
                {!!session.sanMoves.length && <label>
                  {t("Commento per", "Comment for")} {session.sanMoves[session.sanMoves.length - 1]}
                  <textarea rows={2} value={props.draftComment} onChange={event => props.changeDraftComment(event.target.value)} />
                </label>}
                <div className="pgn-control-row">
                  <button type="button" className="pgn-primary" disabled={!session.sanMoves.length}
                    onClick={() => props.finishVariation(true)}>{t("Salva variante", "Save variation")}</button>
                  <button type="button" onClick={() => props.finishVariation(false)}>{t("Annulla variante", "Cancel variation")}</button>
                </div>
              </div>}
              {(move.variations ?? []).map((value, index) => {
                const key = anchor + "-" + index;
                const open = expanded[key] ?? allOpen;
                const selected = position?.anchor === anchor && position.index === index ? position.node : undefined;
                return <div className="pgn-variation" key={key}>
                  <button type="button" className="pgn-branch-toggle" aria-expanded={open}
                    onClick={() => {
                      if (open && selected) props.selectVariation(null);
                      setExpanded(current => ({ ...current, [key]: !open }));
                    }}>
                    <span aria-hidden="true">{open ? "▾" : "▸"}</span>{t("Variante", "Variation")} {index + 1}
                  </button>
                  {open && <>
                    {!session && <div className="pgn-control-row">
                      <button type="button" onClick={() => { selectMain(anchor); setEditor({ anchor, index, value }); }}>{t("Modifica PGN", "Edit PGN")}</button>
                      <button type="button" onClick={() => { selectMain(anchor); props.removeVariation(anchor, index); }}>{t("Rimuovi variante", "Remove variation")}</button>
                    </div>}
                    <RecordedBranch value={value} before={props.history[anchor - 1] ?? move.fen} after={move.fen}
                      selection={selected} onSelect={node => {
                        if (session) return;
                        selectMain(anchor);
                        props.selectVariation({ anchor, index, node });
                      }}
                      onSave={next => props.saveVariation(anchor, index, next)}
                      t={t} onPreview={props.onPreview} onHidePreview={props.onHidePreview} />
                  </>}
                </div>;
              })}
              {editor && editor.anchor === anchor && !session && <form className="pgn-recorder-editor" onSubmit={event => {
                event.preventDefault();
                if (props.saveVariation(anchor, editor.index, editor.value)) {
                  const index = editor.index ?? move.variations?.length ?? 0;
                  setExpanded(current => ({ ...current, [anchor + "-" + index]: true }));
                  setEditor(null);
                }
              }}>
                <label>{t("Variante PGN", "PGN variation")}
                  <textarea rows={3} value={editor.value} onChange={event => setEditor({ ...editor, value: event.target.value })} />
                </label>
                <div className="pgn-control-row">
                  <button type="submit" className="pgn-primary" disabled={!editor.value.trim()}>{t("Salva variante", "Save variation")}</button>
                  <button type="button" onClick={() => setEditor(null)}>{t("Annulla", "Cancel")}</button>
                </div>
              </form>}
            </div>
          </div>;
        })}
      </div>}
  </>;
}
