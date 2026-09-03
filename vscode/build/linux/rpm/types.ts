/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type RpmArchString = 'x86_64' | 'armv7hl' | 'aarch64' | 'ppc64le' | 'riscv64' | 's390x';

export function isRpmArchString(s: string): s is RpmArchString {
	return ['x86_64', 'armv7hl', 'aarch64', 'ppc64le', 'riscv64', 's390x'].includes(s);
}
