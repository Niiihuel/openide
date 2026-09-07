/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import { IOpenideMcpEndpoint, OpenideCliId, OPENIDE_CLI_CATALOG } from './openideAgentCliCatalog.js';
import { t } from './openideStrings.js';

export const OPENIDE_MCP_REGISTRATION_STORAGE_PREFIX = 'openide.ide.mcpRegistration.v1.';
const OWNER = 'openide';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Provenance of a registration attempt, never a copy of the CLI's configuration or credentials. */
export interface IOpenideMcpRegistration {
	readonly version: 1;
	readonly owner: 'openide';
	readonly id: string;
	readonly ownerId: string;
	readonly generationId: string;
	readonly cliId: OpenideCliId;
	readonly workspaceId: string;
	readonly name: string;
	readonly createdAt: number;
	/** A crash or failed CLI command leaves an uncertain record; neither proves external ownership. */
	readonly state: 'registered' | 'expired' | 'uncertain';
}

export interface IOpenideMcpRegistrationStore {
	read(): readonly unknown[];
	write(record: IOpenideMcpRegistration): void;
}

/** Unknown versions, legacy names and malformed records never authorize changing a CLI entry. */
export function parseOpenideMcpRegistration(value: unknown): IOpenideMcpRegistration | undefined {
	if (!value || typeof value !== 'object') { return undefined; }
	const record = value as Partial<IOpenideMcpRegistration>;
	if (record.version !== 1 || record.owner !== OWNER || typeof record.id !== 'string' || !UUID.test(record.id)
		|| typeof record.ownerId !== 'string' || !UUID.test(record.ownerId)
		|| typeof record.generationId !== 'string' || !UUID.test(record.generationId)
		|| !OPENIDE_CLI_CATALOG.some(cli => cli.id === record.cliId && cli.mcpRegisterArgs) || typeof record.workspaceId !== 'string' || !record.workspaceId
		|| record.name !== `openide-v1-${record.id}` || !Number.isFinite(record.createdAt)
		|| !['registered', 'expired', 'uncertain'].includes(record.state ?? '')) { return undefined; }
	// Only the fields owned by this schema cross the persistence boundary.
	return { version: 1, owner: OWNER, id: record.id, ownerId: record.ownerId, generationId: record.generationId, cliId: record.cliId!, workspaceId: record.workspaceId, name: record.name, createdAt: record.createdAt!, state: record.state! };
}

export interface IOpenideMcpRegistrationResult {
	readonly registration: IOpenideMcpRegistration;
	readonly reused: boolean;
	readonly expired: boolean;
}

/**
 * Owns only new uniquely named registrations for this renderer. Credentials remain in memory.
 * Even a valid old record does not prove the user has left its CLI entry unchanged, so this
 * manager never overwrites or deletes one. Reconnection always creates a separate entry.
 */
export class OpenideMcpRegistrationManager {
	private readonly ownerId: string;
	private generationId: string | undefined;
	private endpointKey: string | undefined;
	private readonly attempts = new Map<OpenideCliId, Promise<IOpenideMcpRegistrationResult>>();
	private readonly owned = new Map<string, IOpenideMcpRegistration>();
	private disposed = false;

	constructor(private readonly store: IOpenideMcpRegistrationStore, private readonly newId: () => string = generateUuid) {
		this.ownerId = this.newId();
	}

	previous(workspaceId: string): IOpenideMcpRegistration[] {
		return this.store.read().map(parseOpenideMcpRegistration).filter((record): record is IOpenideMcpRegistration => !!record && record.workspaceId === workspaceId && record.ownerId !== this.ownerId);
	}

	register(cliId: OpenideCliId, workspaceId: string, currentEndpoint: () => IOpenideMcpEndpoint | undefined, execute: (endpoint: IOpenideMcpEndpoint) => Promise<void>): Promise<IOpenideMcpRegistrationResult> {
		const endpoint = currentEndpoint();
		if (this.disposed || !endpoint) { return Promise.reject(new Error(t('ide.register.noServer'))); }
		// This key is intentionally never persisted or returned to the caller.
		const endpointKey = `${endpoint.url}\0${endpoint.token}`;
		if (endpointKey !== this.endpointKey) {
			this.expireOwned();
			this.attempts.clear();
			this.endpointKey = endpointKey;
			this.generationId = this.newId();
		}
		const existing = this.attempts.get(cliId);
		if (existing) { return existing.then(result => ({ ...result, reused: true })); }
		const id = this.newId();
		if (!UUID.test(id) || this.store.read().map(parseOpenideMcpRegistration).some(record => record?.id === id)) {
			return Promise.reject(new Error(t('ide.register.uniqueNameFailed')));
		}
		const record: IOpenideMcpRegistration = { version: 1, owner: OWNER, id, ownerId: this.ownerId, generationId: this.generationId!, cliId, workspaceId, name: `openide-v1-${id}`, createdAt: Date.now(), state: 'uncertain' };
		this.save(record);
		const attempt = this.performRegistration(record, endpoint, currentEndpoint, execute);
		this.attempts.set(cliId, attempt);
		void attempt.catch(() => { if (this.attempts.get(cliId) === attempt) { this.attempts.delete(cliId); } });
		return attempt;
	}

	private async performRegistration(record: IOpenideMcpRegistration, endpoint: IOpenideMcpEndpoint, currentEndpoint: () => IOpenideMcpEndpoint | undefined, execute: (endpoint: IOpenideMcpEndpoint) => Promise<void>): Promise<IOpenideMcpRegistrationResult> {
		try {
			await execute({ ...endpoint, name: record.name });
		} catch (error) {
			// CLI diagnostics can echo argv, including the bearer supplied to `mcp add`.
			throw new Error(String(error instanceof Error ? error.message : error).split(endpoint.token).join('[redacted]'));
		}
		const current = currentEndpoint();
		const expired = this.disposed || current?.url !== endpoint.url || current?.token !== endpoint.token;
		const registration = { ...record, state: expired ? 'expired' as const : 'registered' as const };
		this.save(registration);
		return { registration, reused: false, expired };
	}

	private save(record: IOpenideMcpRegistration): void {
		this.owned.set(record.id, record);
		this.store.write(record);
	}

	private expireOwned(): void {
		for (const record of this.owned.values()) {
			if (record.state !== 'expired') { this.save({ ...record, state: 'expired' }); }
		}
	}

	dispose(): void {
		this.disposed = true;
		this.expireOwned();
		this.attempts.clear();
		this.endpointKey = undefined;
	}
}
