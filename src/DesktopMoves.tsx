import { memo, useState, type MouseEvent, type FocusEvent } from "react";
import type { Line, PlyNode } from "./pgn";

type Translate = (it: string, en: string) => string;
type PreviewEvent = MouseEvent<HTMLElement> | FocusEvent<HTMLElement>;
type Props = {
  line: Line;
  activeId?: number;
  onSelect: (move: PlyNode) => void;
  onPreview: (fen: string, event: PreviewEvent, move?: PlyNode) => void;
  onHidePreview: () => void;
  t: Translate;
  onOpenDiagram?: (fen: string) => void;
};

const diagram = /(?:\[\[FEN:\s*([^\]]+)\]\]|^FEN\s*:\s*(.+)$)/gi;

function Comments({ texts, onPreview, onHidePreview, onOpenDiagram, t }: Pick<Props, "onPreview" | "onHidePreview" | "onOpenDiagram" | "t"> & { texts?: string[] }) {
  if (!texts?.length) return null;
  return <div className="pgn-comment">{texts.map((text, index) => {
    const match = [...text.matchAll(diagram)][0];
    if (!match) return <span key={index}>{text} </span>;
    const fen = (match[1] ?? match[2]).trim();
    return <span key={index}>
      {text.slice(0, match.index)}
      <button type="button" className="pgn-diagram"
        onClick={() => onOpenDiagram?.(fen)}
        onMouseEnter={event => onPreview(fen, event)}
        onFocus={event => onPreview(fen, event)}
        onMouseLeave={onHidePreview} onBlur={onHidePreview}>
        {t("Diagramma", "Diagram")}
      </button>
      {text.slice(match.index + match[0].length)}{" "}
    </span>;
  })}</div>;
}

export const DesktopMoves = memo(function DesktopMoves({ line, activeId, onSelect, onPreview, onHidePreview, onOpenDiagram, t }: Props) {
  const [inline, setInline] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const previewProps = { onPreview, onHidePreview, onOpenDiagram, t };
  const hasVariations = line.preVariations?.length || line.nodes.some(node => node.variations?.length);
  const setAll = (open: boolean) => {
    setExpanded({});
    setAllOpen(open);
  };

  function branch(variation: Line, index: number) {
    const open = inline || (expanded[variation.lid] ?? allOpen);
    const first = variation.nodes[0];
    return <div key={variation.lid} className="pgn-variation">
      {!inline && <button type="button" className="pgn-branch-toggle" aria-expanded={open}
        onClick={() => setExpanded(value => ({ ...value, [variation.lid]: !open }))}>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        {t("Variante", "Variation")} {index + 1}{first && <> · {first.moveNumber}{first.isWhite ? "." : "…"} {first.san}</>}
      </button>}
      {open && renderLine(variation)}
    </div>;
  }

  function renderLine(current: Line) {
    return <>
      {current.preVariations?.map(branch)}
      {current.nodes.map(node => {
        const active = node.id === activeId;
        return <div className="pgn-move-row" key={node.id}>
          <span className="pgn-move-number">{node.moveNumber}{node.isWhite ? "." : "…"}</span>
          <div>
            <Comments texts={node.commentBefore} {...previewProps} />
            <button type="button" className="pgn-move" data-active={active || undefined}
              aria-current={active ? "step" : undefined}
              onClick={() => { onHidePreview(); onSelect(node); }}
              onMouseEnter={event => onPreview(node.fenAfter, event, node)}
              onMouseLeave={onHidePreview}>
              {node.san}{node.nags?.map(nag => ({ "$1": "!", "$2": "?", "$3": "!!", "$4": "??", "$5": "!?", "$6": "?!" }[nag] ?? " " + nag)).join("")}
            </button>
            <Comments texts={node.commentAfter} {...previewProps} />
            {node.variations?.map(branch)}
          </div>
        </div>;
      })}
    </>;
  }

  return <>
    {Boolean(hasVariations) && <div className="pgn-variation-tools">
      <button type="button" aria-pressed={inline} onClick={() => setInline(value => !value)}>{t("Varianti in linea", "Inline variations")}</button>
      {!inline && <>
        <button type="button" onClick={() => setAll(true)}>{t("Espandi tutte", "Expand all")}</button>
        <button type="button" onClick={() => setAll(false)}>{t("Comprimi tutte", "Collapse all")}</button>
      </>}
    </div>}
    {renderLine(line)}
  </>;
});

