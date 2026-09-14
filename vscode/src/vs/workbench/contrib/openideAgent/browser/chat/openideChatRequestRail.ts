/* Copyright (c) OpenIDE. Licensed under the MIT License. */

import { t } from './../../common/openideStrings.js';
import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { IHoverWidget } from '../../../../../base/browser/ui/hover/hover.js';
import { HoverPosition } from '../../../../../base/browser/ui/hover/hoverWidget.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IOpenideChatRequestItem } from '../../common/chat/openideChatItem.js';
import { showChatTooltip } from './openideChatHover.js';
import { OpenideChatListWidget } from './openideChatListWidget.js';

/** A compact index over the real transcript. The rail never owns another copy of its scroll. */
export class OpenideChatRequestRail extends Disposable {
	private readonly root: HTMLElement;
	private readonly ticks: HTMLElement;
	private readonly hover = this._register(new MutableDisposable<IHoverWidget>());
	private requests: readonly IOpenideChatRequestItem[] = [];
	private signature = '';
	private highlighted = -1;
	private active = -1;
	constructor(parent: HTMLElement, private readonly list: OpenideChatListWidget,
		@IHoverService private readonly hovers: IHoverService,
	) {
		super();
		this.root = append(parent, $('nav.openide-chat-request-rail', { tabindex: '0', 'aria-label': t('openide.requestRail') }));
		this._register(toDisposable(() => this.root.remove()));
		this.ticks = append(this.root, $('.openide-chat-request-ticks'));
		this._register(addDisposableListener(this.root, 'pointermove', e => {
			const bounds = this.ticks.getBoundingClientRect();
			this.highlight(Math.max(0, Math.min(this.requests.length - 1, Math.floor((e.clientY - bounds.top) / Math.max(1, bounds.height) * this.requests.length))));
		}));
		this._register(addDisposableListener(this.root, 'pointerleave', () => { this.highlighted = -1; this.hover.clear(); this.paint(); }));
		this._register(addDisposableListener(this.root, 'click', () => this.select()));
		this._register(addDisposableListener(this.root, 'focus', () => this.highlight(Math.max(0, this.active))));
		this._register(addDisposableListener(this.root, 'blur', () => { this.highlighted = -1; this.hover.clear(); this.paint(); }));
		this._register(addDisposableListener(this.root, 'keydown', e => {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
				e.preventDefault();
				this.highlight(e.key === 'Home' ? 0 : e.key === 'End' ? this.requests.length - 1 : Math.max(0, Math.min(this.requests.length - 1, this.highlighted + (e.key === 'ArrowDown' ? 1 : -1))));
			} else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(); }
			else if (e.key === 'Escape') { e.preventDefault(); this.hover.clear(); this.list.focus(); }
		}));
		this._register(list.onDidScroll(() => this.syncActive()));
	}
	update(): void {
		this.requests = this.list.getItems().filter((item): item is IOpenideChatRequestItem => item.kind === 'request');
		const signature = this.requests.map(item => item.id).join('\0');
		if (signature !== this.signature) {
			this.signature = signature; this.highlighted = -1; this.hover.clear(); clearNode(this.ticks);
			for (const request of this.requests) { append(this.ticks, $('span.openide-chat-request-tick', { 'data-request-id': request.id, 'aria-hidden': 'true' })); }
		}
		this.root.hidden = this.requests.length < 2;
		this.ticks.style.height = `${Math.min(720, this.requests.length * 10)}px`;
		this.syncActive();
	}
	private syncActive(): void {
		const id = this.list.findScrolledPastRequest()?.id;
		this.active = Math.max(0, this.requests.findIndex(request => request.id === id));
		this.paint();
	}
	private paint(): void {
		Array.from(this.ticks.children).forEach((node, index) => {
			const tick = node as HTMLElement;
			const distance = Math.abs(index - this.highlighted);
			const width = this.highlighted >= 0 ? [24, 19, 14, 10][distance] ?? 6 : 6;
			tick.style.setProperty('--request-tick-scale', String(width / 6));
			tick.classList.toggle('active', index === this.active);
			tick.classList.toggle('highlighted', index === this.highlighted);
		});
	}
	private highlight(index: number): void {
		if (index === this.highlighted || !this.requests[index]) { return; }
		this.highlighted = index; this.paint(); this.hover.clear();
		const request = this.requests[index];
		const preview = $('.openide-chat-request-preview');
		append(preview, $('div.openide-chat-request-preview-prompt', undefined, (request.displayText ?? request.text).slice(0, 350) || t('openide.requestAttachments')));
		const answer = this.list.getItems().find(item => item.kind === 'response' && item.requestId === request.id);
		const text = answer?.kind === 'response' ? answer.content.filter(part => part.kind === 'markdown').map(part => part.value.value).join(' ').slice(0, 450) : '';
		if (text) { append(preview, $('div.openide-chat-request-preview-answer', undefined, text)); }
		this.hover.value = showChatTooltip(this.hovers, this.ticks.children[index] as HTMLElement, preview, HoverPosition.RIGHT);
		this.root.setAttribute('aria-label', t('openide.requestPosition', index + 1, this.requests.length, request.displayText ?? request.text));
	}
	private select(): void {
		const request = this.requests[this.highlighted];
		if (!request) { return; }
		this.list.setFollowTail(false); this.list.reveal(request, 0); this.list.setFocus([request]);
		this.hover.clear(); this.syncActive();
	}
}
