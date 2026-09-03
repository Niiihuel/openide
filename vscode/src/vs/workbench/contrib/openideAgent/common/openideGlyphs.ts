/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — product glyphs that codicons do not cover.
 *
 *  Codicons are the default and stay the default: a glyph only lands here when the icon set has
 *  no honest equivalent. Reasoning is one of those — the lightbulb reads as "hint/quick fix"
 *  everywhere else in the IDE, so using it for thinking effort collided with a meaning the user
 *  already learned.
 *
 *  These travel as inline SVG rather than as a font, because the webviews are isolated documents
 *  and only receive the codicon font the host injects. `currentColor` keeps them following the
 *  same colour rules as the codicons beside them.
 *
 *  Provenance: the brain outline is adapted from Phosphor Icons (MIT), redrawn to sit on the
 *  24px grid and to inherit colour. See media/providerIcons/NOTICE.md for the same convention
 *  applied to provider marks.
 *--------------------------------------------------------------------------------------------*/

/** Reasoning effort. Two hemispheres, so the glyph still reads at 13px in the composer. */
export const OPENIDE_GLYPH_THINKING = `<svg class="oi-glyph" viewBox="0 0 256 256" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M248,124a56.11,56.11,0,0,0-32-50.61V72a48,48,0,0,0-88-26.49A48,48,0,0,0,40,72v1.39a56,56,0,0,0,0,101.2V176a48,48,0,0,0,88,26.49A48,48,0,0,0,216,176v-1.41A56.09,56.09,0,0,0,248,124ZM88,208a32,32,0,0,1-31.81-28.56A55.87,55.87,0,0,0,64,180h8a8,8,0,0,0,0-16H64A40,40,0,0,1,50.67,86.27,8,8,0,0,0,56,78.73V72a32,32,0,0,1,64,0v68.26A47.8,47.8,0,0,0,88,128a8,8,0,0,0,0,16,32,32,0,0,1,0,64Zm104-44h-8a8,8,0,0,0,0,16h8a55.87,55.87,0,0,0,7.81-.56A32,32,0,1,1,168,144a8,8,0,0,0,0-16,47.8,47.8,0,0,0-32,12.26V72a32,32,0,0,1,64,0v6.73a8,8,0,0,0,5.33,7.54A40,40,0,0,1,192,164Zm16-52a8,8,0,0,1-8,8h-4a36,36,0,0,1-36-36V80a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4A8,8,0,0,1,208,112ZM60,120H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,84V80a8,8,0,0,1,16,0v4A36,36,0,0,1,60,120Z"/></svg>`;
