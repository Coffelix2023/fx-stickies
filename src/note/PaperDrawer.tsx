import { Fragment } from "react";

import { ScrollArrows, useScrollEdges } from "./ScrollStrip";
import { PAPER, PAPER_LABELS, type Paper } from "./document";

type Props = {
  /** 当前底色，选中态从这里来。 */
  current: Paper;
  onPick: (paper: Paper) => void;
};

/** 两组色板各十枚，中间画一道竖线。组数变了这里跟着改。 */
const GROUPS = 2;

/**
 * 底色抽屉。脊条上的调色板按钮开合它，贴在脊条下面，和 Markdown 工具栏一个位置。
 *
 * 二十枚色排一行放不下，横向滚动；放不下时两端架箭头。
 * 挑完不收起：用户要一块一块点着比。
 */
export function PaperDrawer({ current, onPick }: Props) {
  const { track, edges, overflowing, nudge } = useScrollEdges();

  return (
    <div className="note-paper-drawer">
      <ScrollArrows edges={edges} overflowing={overflowing} onNudge={nudge} noun="底色" />
      <div className="paper-color-track" ref={track}>
        <div className="paper-color-grid" role="group" aria-label="底色">
          {PAPER.map((paper, index) => (
            <Fragment key={paper}>
              {/* 组与组之间留一道竖线，两组色板才看得出是两套。 */}
              {index > 0 && index % (PAPER.length / GROUPS) === 0 && (
                <span className="paper-color-sep" aria-hidden />
              )}
              <button
                type="button"
                // 选中用高亮描边表示，色块本身都是浅色，压个对勾几乎看不见。
                data-state={current === paper ? "checked" : "unchecked"}
                data-action={`paper-${paper}`}
                className="paper-color-item"
                aria-label={PAPER_LABELS[paper]}
                title={PAPER_LABELS[paper]}
                style={{ background: `var(--paper-${paper})` }}
                onClick={() => onPick(paper)}
              />
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
