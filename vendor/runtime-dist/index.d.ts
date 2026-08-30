/** Module surface for the Studio sandbox canvas and tooling.
    The in-deck IIFE (boot.ts) and this share the same modules — the F21 dual-build seam. */
export { createViewer, type Viewer, type ViewerManifest, type ViewerHooks } from './viewer.js';
export { KIND_BEHAVIOURS, mountKind, finalizeKind, mountCountUps, finalizeCountUps, mountSparklines, finalizeSparklines, type KindBehaviour } from './kinds.js';
export { RUNTIME_BLOCKS, mountCloneBlocks, mountStageBlocks, finalizeStageBlocks } from './blocks/registry.js';
export { type RuntimeBlock, type RuntimeBlockSweep, type SweepCtx } from './blocks/types.js';
export { fontFacesCss, resolveAssetRefs, applyBrandLogoVar, applyFavicon } from './assets.js';
export { buildEditedCopy, downloadCopy, isInlineEditable, liteEditNodes, sanitizeInline } from './lite-edit.js';
export { assembleDeck, setHeadFavicon, type AssembleInput } from './assemble.js';
export { BASE_CSS, RUNTIME_CSS, LEDGER_EDITOR_CSS } from './css.js';
export { KINDS_CSS } from './blocks/kinds-css.js';
export { THEME_CSS, THEMES, type ThemePreset } from './themes.js';
export { renderGantt, renderGanttError, parseGanttSlideData, normalizeGanttData, packLane, ganttWeekIndex, ganttLensColor, mountGantts, finalizeGantts, GANTT_LANE_PADDING, GANTT_CARD_HEIGHT, GANTT_CARD_VSPACING, GANTT_LABEL_WIDTH, GANTT_PX_PER_WEEK, GANTT_PX_MIN, GANTT_PX_MAX, GANTT_CARD_INSET, GANTT_CARD_GAP, GANTT_CARD_MIN_PX, type GanttRenderOpts, } from './gantt.js';
export { renderTracker, renderTrackerError, parseTrackerSlideData, normalizeTrackerData, mountTrackers, finalizeTrackers, TRACKER_STATUSES, type TrackerRenderOpts, } from './tracker.js';
export { renderNotes, renderNotesError, parseNotesSlideData, normalizeNotesData, mountNotes, finalizeNotes, NOTE_SWATCHES, type NotesRenderOpts, } from './notes.js';
export { renderGrid, renderGridError, parseGridSlideData, normalizeGridData, toneStyle, mountGrids, finalizeGrids, type GridRenderOpts, } from './grid.js';
export { renderTable, renderTableError, parseTableSlideData, mountTables, finalizeTables, type Ledger, } from './table.js';
export { renderDocToc, docMount, docFinalize, paginateDoc, docBlockFull, reserveCardBands, releaseCardBands, releaseFloatBands, bandSlot, reserveCardBandsWhenSettled } from './document.js';
export { freeIntervals, spanInBand, inflate, usable, type Exclusion } from './wrap-geometry.js';
export { holdRuns, isRunsHeld, mountRuns, releaseRuns, releaseRunsIn, runnable, runsMounted, tokenize, withSource } from './wrap-runs.js';
export { renderFlow, renderGraph, renderDiagramError, parseFlowSlideData, parseGraphSlideData, normalizeFlowData, normalizeGraphData, mountFlows, finalizeFlows, mountGraphs, finalizeGraphs, setDiagramSnap, addDiagramLane, removeDiagramLane, graphLayout, DIAGRAM_ICONS, type GraphLayoutMode, type DiagramRenderOpts, } from './diagram.js';
export { renderDraw, mountDraws, finalizeDraws, normalizeDrawData, drawSceneSvg, sceneBounds, mulberry32, sketchyLine, simplifyPoints, smoothPath, hachureLines, } from './draw.js';
export { renderVenn, mountVenns, finalizeVenns, normalizeVennData, vennSceneSvg, vennLayout, vennViewBox, vennContainingSets, vennOverlapKey, wrapVennLabel, mergeVennOverlaps, parseVennSlideData, } from './venn.js';
export { renderChart, mountCharts, parseChartFigureData, normalizeChartData, plotHeightBounds, niceMax, CHART_W, CHART_FONT_STACK, CHART_H, CHART_PALETTE, sliceColor, } from './chart.js';
export { renderVideo, mountVideos, parseVideoFigureData, normalizeVideoData, type VideoRenderOpts, } from './video.js';
