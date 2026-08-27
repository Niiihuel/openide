/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — native widget styles for the product's own surfaces.
 *
 *  A widget paints its border INLINE, from the style object it was constructed with, so this file
 *  — not a stylesheet — is the only place the product's border can be set. Everything else is
 *  upstream's default, spread through untouched.
 *
 *  Why the border is overridden at all: a theme is free to give `input.border` a colour with
 *  nothing in common with the rest of the chrome around it. Dracula sets EVERY border token
 *  (input, dropdown, checkbox, settings.*) to #191a21 — a near-black — so on its #282a36 surface
 *  each field arrived wearing a hard black outline while the cards and rows beside it used
 *  `--oi-border`, an alpha derived from the foreground. Both were "correct": the controls per the
 *  theme, the cards per the page. It looked broken in Dracula and fine in the theme this was
 *  written against, which is the failure mode docs/theming-surfaces.md exists to catch.
 *
 *  Deriving keeps ONE border weight for everything OpenIDE draws, in every theme. It is the same
 *  reasoning as rule 2 there: a surface uses the colour family that paints it.
 *--------------------------------------------------------------------------------------------*/

import { ICheckboxStyles, IToggleStyles } from '../../../../base/browser/ui/toggle/toggle.js';
import { IInputBoxStyles } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { ISelectBoxStyles } from '../../../../base/browser/ui/selectBox/selectBox.js';
import { defaultCheckboxStyles, defaultInputBoxStyles, defaultSelectBoxStyles, defaultToggleStyles } from '../../../../platform/theme/browser/defaultStyles.js';

/** The product's border. Declared on `:root, .monaco-workbench` by `openideSurfaceCss.ts`. */
const OI_BORDER = 'var(--oi-border)';

export const openideInputBoxStyles: IInputBoxStyles = { ...defaultInputBoxStyles, inputBorder: OI_BORDER };
export const openideSelectBoxStyles: ISelectBoxStyles = { ...defaultSelectBoxStyles, selectBorder: OI_BORDER };
export const openideCheckboxStyles: ICheckboxStyles = { ...defaultCheckboxStyles, checkboxBorder: OI_BORDER };
export const openideToggleStyles: IToggleStyles = { ...defaultToggleStyles, inputActiveOptionBorder: OI_BORDER };
