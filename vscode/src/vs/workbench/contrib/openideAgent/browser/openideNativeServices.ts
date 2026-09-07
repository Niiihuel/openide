/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IOpenideNativeServices } from '../common/openideNativeServices.js';
import { UnavailableOpenideNativeServices } from '../common/openideNativeServicesUnavailable.js';

registerSingleton(IOpenideNativeServices, UnavailableOpenideNativeServices, InstantiationType.Delayed);
