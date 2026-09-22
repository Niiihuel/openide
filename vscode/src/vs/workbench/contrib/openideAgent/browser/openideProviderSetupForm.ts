/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { t } from '../common/openideStrings.js';
import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IOpenideCustomProviderSetup, IOpenideProviderSetupDraft, OpenideProviderSetupError, OpenideProviderSetupField, providerIdFromName, providerSetupConfiguration, validateProviderSetupDraft } from '../common/openideProviderSetup.js';
import { OpenideSettingsDropdown } from '../../openideSettings/browser/openideSettingsDropdown.js';
import { openideButtonStyles, openideInputBoxStyles } from './openideControlStyles.js';
import './media/openideProviderSetup.css';

export interface IOpenideProviderSetupFormOptions {
	readonly existingIds: readonly string[];
	readonly onSubmit: (configuration: IOpenideCustomProviderSetup, apiKey?: string) => Promise<void>;
	readonly onCancel: () => void;
	readonly onCheck?: (configuration: IOpenideCustomProviderSetup, apiKey?: string) => Promise<{ readonly ok: boolean; readonly message: string; readonly canSave?: boolean; readonly canSaveUnchecked?: boolean }>;
}

interface ISetupField {
	readonly element: HTMLElement;
	readonly control: HTMLElement;
	readonly error: HTMLElement;
	readonly help: HTMLElement;
	readonly helpId: string;
	readonly input?: InputBox;
}

/** A native, stable form. Its owner keeps the draft across unrelated provider status updates. */
export class OpenideProviderSetupForm extends Disposable {
	private static nextId = 0;
	readonly domNode: HTMLElement;
	private readonly fields = new Map<OpenideProviderSetupField, ISetupField>();
	private readonly inputs: InputBox[] = [];
	private readonly selects: OpenideSettingsDropdown[] = [];
	private readonly touched = new Set<OpenideProviderSetupField>();
	private readonly submitButton: Button;
	private readonly cancelButton: Button;
	private readonly checkButton: Button | undefined;
	private readonly uncheckedButton: Button | undefined;
	private readonly revealButton: Button;
	private readonly status: HTMLElement;
	private readonly keyField: ISetupField;
	private busy = false;
	private disposed = false;
	private assigningId = false;
	private attempted = false;
	private canSaveUnchecked = false;

	constructor(
		parent: HTMLElement,
		private readonly draft: IOpenideProviderSetupDraft,
		private readonly options: IOpenideProviderSetupFormOptions,
		contextViewService: IContextViewService,
	) {
		super();
		this.domNode = append(parent, $('form.openide-provider-setup'));
		this.domNode.setAttribute('aria-label', draft.originalId
			? t('openide.providerSetup.edit')
			: t('openide.providerSetup.add'));
		this._register(addDisposableListener(this.domNode, 'submit', event => {
			event.preventDefault();
			void this.submit();
		}));
		append(this.domNode, $('p.openide-provider-setup-intro', undefined,
			t('openide.providerSetup.intro')));

		const card = append(this.domNode, $('.openide-provider-setup-card'));
		const identity = append(card, $('.openide-provider-setup-grid'));
		this.textField(identity, 'name', t('openide.providerSetup.name'),
			t('openide.providerSetup.nameHelp'), t('openide.providerSetup.namePlaceholder'));
		const idField = this.textField(identity, 'id', t('openide.providerSetup.id'),
			draft.originalId
				? t('openide.providerSetup.idFixed')
				: t('openide.providerSetup.idHelp'), 'my-provider');
		idField.input!.inputElement.readOnly = !!draft.originalId;
		this.textField(card, 'baseUrl', t('openide.providerSetup.endpoint'),
			t('openide.providerSetup.endpointHelp'), 'https://api.example.com/v1');

		const connection = append(card, $('.openide-provider-setup-grid'));
		this.selectField(connection, 'protocol', t('openide.providerSetup.protocol'),
			t('openide.providerSetup.protocolHelp'), [
				{ value: 'openai', label: t('openide.providerSetup.completions') },
				{ value: 'openai-responses', label: t('openide.providerSetup.responses') },
				{ value: 'anthropic', label: t('openide.providerSetup.anthropic') },
			], contextViewService);
		this.selectField(connection, 'auth', t('openide.providerSetup.auth'),
			t('openide.providerSetup.authHelp'), [
				{ value: 'apiKey', label: t('openide.providerSetup.authKey') },
				{ value: 'none', label: t('openide.providerSetup.authNone') },
			], contextViewService);

		this.keyField = this.textField(card, 'apiKey', t('openide.providerSetup.key'),
			draft.originalId
				? t('openide.providerSetup.keyKeep')
				: t('openide.providerSetup.keyHelp'), '', 'password');
		this.keyField.input!.inputElement.autocomplete = 'new-password';
		this.revealButton = this._register(new Button(this.keyField.control, { ...openideButtonStyles, secondary: true }));
		this.revealButton.element.classList.add('openide-provider-setup-reveal');
		this.revealButton.element.dataset.providerAction = 'reveal-key';
		this.revealButton.label = t('openide.providerSetup.showKey');
		this.revealButton.element.setAttribute('aria-label', t('openide.providerSetup.showKeyLabel'));
		this.revealButton.element.setAttribute('aria-pressed', 'false');
		this._register(this.revealButton.onDidClick(() => {
			const reveal = this.keyField.input!.inputElement.type === 'password';
			this.keyField.input!.inputElement.type = reveal ? 'text' : 'password';
			this.revealButton.label = reveal ? t('openide.providerSetup.hideKey') : t('openide.providerSetup.showKey');
			this.revealButton.element.setAttribute('aria-label', reveal
				? t('openide.providerSetup.hideKeyLabel') : t('openide.providerSetup.showKeyLabel'));
			this.revealButton.element.setAttribute('aria-pressed', String(reveal));
		}));
		this.keyField.element.hidden = draft.auth === 'none';

		this.textField(card, 'defaultModel', t('openide.providerSetup.model'),
			t('openide.providerSetup.modelHelp'), '');
		this.updateEndpointHelp();

		this.status = append(this.domNode, $('.openide-provider-setup-status', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }));
		const actions = append(this.domNode, $('.openide-provider-setup-actions'));
		if (options.onCheck) {
			this.checkButton = this._register(new Button(actions, { ...openideButtonStyles, secondary: true }));
			this.checkButton.label = t('openide.providerSetup.check');
			this.checkButton.element.dataset.providerAction = 'check';
			this._register(this.checkButton.onDidClick(() => void this.check()));
			this.uncheckedButton = this._register(new Button(actions, { ...openideButtonStyles, secondary: true }));
			this.uncheckedButton.label = t('openide.providerSetup.saveUnchecked');
			this.uncheckedButton.element.dataset.providerAction = 'save-unchecked';
			this._register(this.uncheckedButton.onDidClick(() => void this.submit(true)));
			this.setUncheckedEligibility(false);
		}
		const trailing = append(actions, $('.openide-provider-setup-actions-end'));
		this.cancelButton = this._register(new Button(trailing, { ...openideButtonStyles, secondary: true }));
		this.cancelButton.label = t('openide.providerSetup.cancel');
		this.cancelButton.element.dataset.providerAction = 'cancel';
		this._register(this.cancelButton.onDidClick(() => options.onCancel()));
		this.submitButton = this._register(new Button(trailing, { ...openideButtonStyles }));
		this.submitButton.label = draft.originalId
			? t('openide.providerSetup.save') : t('openide.providerSetup.add');
		this.submitButton.element.dataset.providerAction = 'save';
		this._register(this.submitButton.onDidClick(() => void this.submit()));
	}

	focus(): void {
		this.fields.get('name')?.input?.focus();
	}

	private field(parent: HTMLElement, name: OpenideProviderSetupField, label: string, help: string): ISetupField {
		const element = append(parent, $('.openide-provider-setup-field'));
		const id = `openide-provider-setup-${++OpenideProviderSetupForm.nextId}`;
		append(element, $('label.openide-provider-setup-label', { id: `${id}-label`, for: id }, label));
		const control = append(element, $('.openide-provider-setup-control'));
		control.id = id;
		const helpElement = append(element, $('p.openide-provider-setup-help', { id: `${id}-help` }, help));
		const error = append(element, $('p.openide-provider-setup-error', { id: `${id}-error` }));
		error.hidden = true;
		const field = { element, control, error, help: helpElement, helpId: `${id}-help` };
		this.fields.set(name, field);
		return field;
	}

	private textField(parent: HTMLElement, name: 'name' | 'id' | 'baseUrl' | 'defaultModel' | 'apiKey', label: string, help: string, placeholder: string, type: 'text' | 'password' = 'text'): ISetupField {
		const field = this.field(parent, name, label, help);
		const input = this._register(new InputBox(field.control, undefined, { inputBoxStyles: openideInputBoxStyles, ariaLabel: label, placeholder, type }));
		this.inputs.push(input);
		input.value = this.draft[name];
		input.inputElement.id = field.control.id;
		field.control.removeAttribute('id');
		input.inputElement.dataset.providerField = name;
		input.inputElement.setAttribute('aria-describedby', `${field.helpId} ${field.error.id}`);
		input.inputElement.autocomplete = 'off';
		input.inputElement.spellcheck = false;
		const result = { ...field, input };
		this.fields.set(name, result);
		this._register(input.onDidChange(value => {
			this.draft[name] = value;
			if (name === 'id' && !this.assigningId) {
				this.draft.idEdited = true;
			}
			if (name === 'name' && !this.draft.idEdited) {
				this.draft.id = providerIdFromName(value);
				this.assigningId = true;
				this.fields.get('id')!.input!.value = this.draft.id;
				this.assigningId = false;
			}
			this.changed(name);
		}));
		this._register(addDisposableListener(input.inputElement, 'blur', () => {
			this.touched.add(name);
			this.validate();
		}));
		this._register(addDisposableListener(input.inputElement, 'keydown', event => {
			if ((event as KeyboardEvent).key === 'Enter' && !(event as KeyboardEvent).isComposing) {
				event.preventDefault();
				void this.submit();
			}
		}));
		return result;
	}

	private selectField<K extends 'protocol' | 'auth'>(parent: HTMLElement, name: K, label: string, help: string, choices: readonly { value: IOpenideProviderSetupDraft[K]; label: string }[], contextViewService: IContextViewService): void {
		const field = this.field(parent, name, label, help);
		const select = this._register(new OpenideSettingsDropdown(choices.map(choice => ({ label: choice.label })), choices.findIndex(choice => choice.value === this.draft[name]), contextViewService, label));
		this.selects.push(select);
		select.render(field.control);
		field.control.dataset.providerField = name;
		select.domNode.id = field.control.id;
		field.control.removeAttribute('id');
		select.domNode.setAttribute('aria-describedby', field.helpId);
		this._register(select.onDidSelect(selection => {
			this.draft[name] = choices[selection.index].value;
			if (name === 'auth') {
				this.keyField.element.hidden = this.draft.auth === 'none';
			}
			if (name === 'protocol') { this.updateEndpointHelp(); }
			this.changed(name);
		}));
	}

	private updateEndpointHelp(): void {
		this.fields.get('baseUrl')!.help.textContent = this.draft.protocol === 'anthropic'
			? t('openide.providerSetup.anthropicEndpointHelp')
			: t('openide.providerSetup.endpointHelp');
	}

	private changed(name: OpenideProviderSetupField): void {
		this.touched.add(name);
		this.setUncheckedEligibility(false);
		if (this.status) {
			this.status.textContent = '';
			this.status.classList.remove('error', 'success');
		}
		this.validate();
	}

	private validate(all = false): boolean {
		const errors = validateProviderSetupDraft(this.draft, this.options.existingIds);
		for (const [name, field] of this.fields) {
			const error = (all || this.attempted || this.touched.has(name)) ? errors[name] : undefined;
			field.error.textContent = error ? errorMessage(error) : '';
			field.error.hidden = !error;
			field.element.classList.toggle('invalid', !!error);
			field.input?.inputElement.setAttribute('aria-invalid', String(!!error));
		}
		if (all) {
			const firstInvalid = Object.keys(errors)[0] as OpenideProviderSetupField | undefined;
			if (firstInvalid) { this.fields.get(firstInvalid)?.input?.focus(); }
		}
		return Object.keys(errors).length === 0;
	}

	private setBusy(busy: boolean, operation: 'save' | 'check'): void {
		this.busy = busy;
		this.domNode.setAttribute('aria-busy', String(busy));
		for (const input of this.inputs) { input.setEnabled(!busy); }
		for (const select of this.selects) { select.setEnabled(!busy); }
		this.submitButton.enabled = !busy;
		if (this.uncheckedButton) { this.uncheckedButton.enabled = !busy && this.canSaveUnchecked; }
		this.cancelButton.enabled = !busy || operation === 'check';
		this.revealButton.enabled = !busy;
		this.submitButton.label = busy && operation === 'save'
			? t('openide.providerSetup.saving')
			: this.draft.originalId ? t('openide.providerSetup.save') : t('openide.providerSetup.add');
		if (this.checkButton) {
			this.checkButton.enabled = !busy;
			this.checkButton.label = busy && operation === 'check'
				? t('openide.providerSetup.checking') : t('openide.providerSetup.check');
		}
	}

	private showStatus(message: string, ok: boolean): void {
		// A backend may mention a rejected bearer value; even unexpected diagnostics must not
		// turn a masked field into visible plaintext.
		const key = this.draft.apiKey.trim();
		this.status.textContent = key ? message.split(key).join('••••') : message;
		this.status.classList.toggle('error', !ok);
		this.status.classList.toggle('success', ok);
	}

	private setUncheckedEligibility(allowed: boolean): void {
		this.canSaveUnchecked = allowed && this.draft.auth === 'apiKey' && !!this.draft.apiKey.trim();
		if (this.uncheckedButton) {
			this.uncheckedButton.element.hidden = !this.canSaveUnchecked;
			this.uncheckedButton.element.style.display = this.canSaveUnchecked ? '' : 'none';
			this.uncheckedButton.enabled = this.canSaveUnchecked && !this.busy;
		}
	}

	private async submit(unchecked = false): Promise<void> {
		if (this.busy || this.disposed || unchecked && !this.canSaveUnchecked) { return; }
		this.attempted = true;
		if (!this.validate(true)) { return; }
		this.setBusy(true, 'save');
		this.status.textContent = '';
		try {
			const configuration = providerSetupConfiguration(this.draft);
			const apiKey = this.draft.auth === 'apiKey' ? this.draft.apiKey.trim() || undefined : undefined;
			this.setUncheckedEligibility(false);
			if (apiKey && this.options.onCheck && !unchecked) {
				this.status.textContent = t('openide.providerSetup.checkWait');
				const result = await this.options.onCheck(configuration, apiKey);
				if (this.disposed) { return; }
				this.setUncheckedEligibility(result.canSaveUnchecked === true);
				if (!(result.canSave ?? result.ok)) {
					this.showStatus(result.message, result.ok);
					return;
				}
			}
			await this.options.onSubmit(configuration, apiKey);
			this.draft.apiKey = '';
			if (!this.disposed) {
				this.keyField.input!.value = '';
				this.showStatus(t('openide.providerSetup.saved'), true);
			}
		} catch {
			if (!this.disposed) {
				this.showStatus(t('openide.providerSetup.saveFailed'), false);
			}
		} finally {
			if (!this.disposed) { this.setBusy(false, 'save'); }
		}
	}

	private async check(): Promise<void> {
		if (this.busy || this.disposed || !this.options.onCheck) { return; }
		this.attempted = true;
		if (!this.validate(true)) { return; }
		this.setBusy(true, 'check');
		this.status.textContent = t('openide.providerSetup.checkWait');
		try {
			const result = await this.options.onCheck(providerSetupConfiguration(this.draft), this.draft.auth === 'apiKey' ? this.draft.apiKey.trim() || undefined : undefined);
			if (!this.disposed) {
				this.setUncheckedEligibility(result.canSaveUnchecked === true);
				this.showStatus(result.message, result.ok);
			}
		} catch {
			if (!this.disposed) {
				this.showStatus(t('openide.providerSetup.checkFailed'), false);
			}
		} finally {
			if (!this.disposed) { this.setBusy(false, 'check'); }
		}
	}

	override dispose(): void {
		this.disposed = true;
		super.dispose();
		this.domNode.remove();
	}
}

function errorMessage(error: OpenideProviderSetupError): string {
	switch (error) {
		case 'nameRequired': return t('openide.providerSetup.nameRequired');
		case 'idInvalid': return t('openide.providerSetup.idInvalid');
		case 'idExists': return t('openide.providerSetup.idExists');
		case 'idImmutable': return t('openide.providerSetup.idImmutable');
		case 'urlRequired': return t('openide.providerSetup.urlRequired');
		case 'urlInvalid': return t('openide.providerSetup.urlInvalid');
		case 'urlCredentials': return t('openide.providerSetup.urlCredentials');
		case 'urlQuery': return t('openide.providerSetup.urlQuery');
		case 'apiKeyInvalid': return t('openide.providerSetup.keyInvalid');
	}
}
