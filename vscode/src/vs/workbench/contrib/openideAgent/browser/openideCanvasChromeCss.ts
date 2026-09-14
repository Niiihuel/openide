/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { OPENIDE_SURFACE_CSS } from './openideSurfaceCss.js';

/** Shared components paint editor controls; the prototype keeps its authored design tokens. */
export const OPENIDE_DESIGN_CHROME_CSS = `${OPENIDE_SURFACE_CSS}
#design { color: var(--oi-text); font-family: var(--vscode-font-family, system-ui); font-size: 13px; }
#design > header { gap: 6px; padding: 8px 12px; border: 0; background: var(--oi-canvas); }
#design > footer { border: 0; background: var(--oi-canvas); color: var(--oi-secondary); font-size: 12px; }
#design > .workspace { gap: 6px; padding: 0 6px; }
#design > .workspace > :is(nav, aside) { background: var(--oi-canvas); border: 1px solid var(--oi-border-soft); border-radius: var(--oi-radius-group); min-height: 0; padding: 12px; overscroll-behavior: contain; scrollbar-gutter: auto; }
#design > .workspace > nav { gap: 6px; }
#design > .workspace > aside :is(h2, h3) { font-size: 13px; font-weight: 600; color: var(--oi-secondary); }
#design .file-menu summary { border-radius: var(--oi-radius-control); }
#design .file-actions { padding: var(--oi-scroll-inset); gap: 4px; border-radius: var(--oi-radius-popover); border-color: var(--oi-border-overlay); background: var(--oi-popover); box-shadow: var(--oi-shadow-md); overscroll-behavior: contain; }
#design .file-actions .oi-btn { justify-content: flex-start; }
#design .gallery { max-width: 880px; margin: 0 auto; padding: 28px 24px; }
#design .gallery h1 { margin: 0 0 8px; font-size: 24px; font-weight: 600; }
#design .gallery .oi-desc { max-width: none; }
#design .templates { border: 0; padding: 0; margin: 20px 0; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
#design .templates legend { padding: 0 0 10px; color: var(--oi-secondary); font-size: 12px; }
#design .templates .canvas-template { margin: 0; flex-direction: row; }
#design .templates input { min-height: 0; padding: 0; }
#design .canvas-request-fields { display: grid; grid-template-columns: 1fr 160px; gap: 12px; }
#design .canvas-request-actions { display: flex; justify-content: flex-end; margin-top: 16px; }
#design .gallery > label { max-width: none; }
#design .gallery textarea { width: 100%; }
@media (max-width: 500px) { #design .gallery { padding: 20px 12px; } #design .canvas-request-fields { grid-template-columns: 1fr; gap: 0; } }
`;

/** Public Canvas primitives and editor chrome share the same recipes as chat and Settings. */
export const OPENIDE_CANVAS_CHROME_CSS = `${OPENIDE_SURFACE_CSS}
:root { --oc-surface: var(--oi-group); --oc-muted: var(--oi-secondary); --oc-border: var(--oi-border); --oc-soft: var(--oi-control); --oc-hover: var(--oi-hover); --oc-focus: var(--oi-focus); }
body { padding: 24px; }
body > :is(.oc-pick-toggle, .oc-full-toggle, .oc-save-status) { min-height: 29px; border-radius: var(--oi-radius-control); box-shadow: var(--oi-shadow-sm); }
body > .oc-save-status { color: var(--oi-secondary); font-size: 12px; }
body > .oc-pick-bar { border-radius: var(--oi-radius-popover); border-color: var(--oi-border-overlay); background: var(--oi-popover); color: var(--oi-secondary); box-shadow: var(--oi-shadow-md); }
body > .oc-pick-tag { border-radius: var(--oi-radius-tooltip); background: var(--oi-popover); border-color: var(--oi-border-overlay); }
.oc-wireframe { border-radius: var(--oi-radius-group); padding: 20px; }
.oc-wireframe-box { border-radius: var(--oi-radius-control); }
.oc-choice { width: 100%; }
.oc-table { font-size: 13px; }
.oc-table th, .oc-table td { padding: 8px 12px; }
.error { border-radius: var(--oi-radius-group); }
@media (max-width: 500px) { body { padding: 12px; } }
`;
