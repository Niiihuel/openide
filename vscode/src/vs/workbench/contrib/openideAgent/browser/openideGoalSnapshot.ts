/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { t } from './../common/openideStrings.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelContentProvider, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { contentHash } from '../common/openideMessageChanges.js';

export const OPENIDE_GOAL_SNAPSHOT_SCHEME = 'openide-goal-snapshot';
export const IOpenideGoalSnapshotService = createDecorator<IOpenideGoalSnapshotService>('openideGoalSnapshotService');
export interface IOpenideGoalSnapshotService {
	readonly _serviceBrand: undefined;
	resource(goalId: string, fileName: string, displayPath: string, content: string): URI;
}
interface ISnapshotReference { workspaceId: string; goalId: string; fileName: string; hash: string }

/**
 * Virtual snapshots resolve to readonly TextResourceEditorModels on BOTH sides of a diff.
 * This provider owns no native-chat baselines and exposes no filesystem write capability.
 */
export class OpenideGoalSnapshotService extends Disposable implements IOpenideGoalSnapshotService, ITextModelContentProvider {
	declare readonly _serviceBrand: undefined;
	constructor(
		@ITextModelService resolver: ITextModelService,
		@IModelService private readonly models: IModelService,
		@ILanguageService private readonly languages: ILanguageService,
		@IFileService private readonly files: IFileService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IWorkbenchEnvironmentService private readonly environment: IWorkbenchEnvironmentService,
	) {
		super();
		this._register(resolver.registerTextModelContentProvider(OPENIDE_GOAL_SNAPSHOT_SCHEME, this));
	}

	resource(goalId: string, fileName: string, displayPath: string, content: string): URI {
		const reference: ISnapshotReference = { workspaceId: this.workspace.getWorkspace().id, goalId, fileName, hash: contentHash(content) };
		this.validate(reference);
		return URI.from({ scheme: OPENIDE_GOAL_SNAPSHOT_SCHEME, path: '/' + displayPath.replace(/^\/+/, ''), query: JSON.stringify(reference) });
	}

	private validate(value: ISnapshotReference): void {
		if (!value || value.workspaceId !== this.workspace.getWorkspace().id || !/^[\w-]{1,128}$/.test(value.workspaceId)
			|| !/^[\w-]{1,128}$/.test(value.goalId) || !/^[\w-]{1,128}\.(?:before|after)\.txt$/.test(value.fileName)
			|| typeof value.hash !== 'string' || value.hash.length > 128) {
			throw new Error(t('goal.snapshotInvalid'));
		}
	}

	async provideTextContent(resource: URI): Promise<ITextModel> {
		if (resource.scheme !== OPENIDE_GOAL_SNAPSHOT_SCHEME || resource.query.length > 1024) { throw new Error(t('goal.snapshotInvalid')); }
		const reference = JSON.parse(resource.query) as ISnapshotReference;
		this.validate(reference);
		const existing = this.models.getModel(resource);
		if (existing) { return existing; }
		const source = URI.joinPath(this.environment.workspaceStorageHome, reference.workspaceId, 'openide-goals', reference.goalId, reference.fileName);
		const content = (await this.files.readFile(source, { limits: { size: 2 * 1024 * 1024 } })).value.toString();
		if (contentHash(content) !== reference.hash) { throw new Error(t('goal.snapshotChanged')); }
		// A concurrent resolver may have created it while the file was being read.
		return this.models.getModel(resource) ?? this.models.createModel(content, this.languages.createByFilepathOrFirstLine(resource), resource);
	}
}
registerSingleton(IOpenideGoalSnapshotService, OpenideGoalSnapshotService, InstantiationType.Delayed);
