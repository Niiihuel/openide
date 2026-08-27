/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type DebianArchString = 'amd64' | 'armhf' | 'arm64' | 'ppc64el' | 'ppc64le' | 'riscv64' | 's390x';

export function isDebianArchString(s: string): s is DebianArchString {
	return ['amd64', 'armhf', 'arm64', 'ppc64el', 'ppc64le', 'riscv64', 's390x'].includes(s);
}
