class ChatGPTModelSelector extends HTMLElement {
  static observedAttributes = ['value', 'model-name'];

  #tiers = [
    { key: 'Light',      valuetext: 'Light — fastest' },
    { key: 'Medium',     valuetext: 'Medium — balanced' },
    { key: 'High',       valuetext: 'High — smarter' },
    { key: 'Extra High', valuetext: 'Extra High — much smarter' },
    { key: 'Ultra',      valuetext: 'Ultra — smartest, consumes usage limits faster' },
  ];
  #index = 1;          // committed stop index (0–4)
  #dragPos = null;     // continuous 0–1 position while dragging, else null
  #open = false;
  #view = 'menu';      // 'menu' | 'advanced'
  #dragging = false;
  #activePointer = null;
  #dragGeom = null;    // cached track geometry for the active gesture
  #hoveringSlider = false;
  #bound = false;
  #particles = [];
  #raf = 0;
  #sparkLast = 0;
  #sparkBox = null;
  #confettiParts = [];
  #confettiRaf = 0;
  #confettiLast = 0;
  #confettiBox = null;
  #lastBurst = 0;
  #burstFiredThisGesture = false;
  #snapSettleCb = null;
  #resizeObserver = null;
  #closeTimer = 0;
  #snapTimer = 0;
  #reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  #onDocPointerDown = (e) => {
    if (!e.composedPath().includes(this)) this.#close();
  };
  #onMotionPrefChange = () => {
    // restart (or statically repaint) the sparkle loop under the new preference
    if (this.#open && this.#view === 'advanced') this.#startSparkles();
    if (this.#reducedMotion.matches) this.#stopConfetti(); // kill any in-flight burst
  };

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
    <style>
      :host {
        --blue: #0371DD;
        --violet: #A278FB;
        --ultra-text: #7C3AED;
        --ink: #1A1D21;
        --ink-2: #8E9299;
        --ink-3: #C0C0C2;
        --track: #E1E1E4;
        --pill-bg: #F1F2F3;
        --pill-bg-hover: #E8E9EB;
        --card: #FFFFFF;
        --hairline: #ECECEE;
        --r-card: 16px;
        --r-row: 10px;
        --ease-out: cubic-bezier(0.32, 0.72, 0, 1);
        --ease-swap: cubic-bezier(0.2, 0, 0, 1);
        /* gently overdamped spring: single ~4% overshoot, no secondary oscillation */
        --spring: linear(0, 0.062 3.4%, 0.24 7.5%, 0.51 12.5%, 0.76 17.9%, 0.905 22.4%,
          0.997 27.2%, 1.038 32.4%, 1.05 37.4%, 1.044 42.7%, 1.028 49.2%,
          1.012 56.9%, 1.003 65.7%, 0.999 76%, 1);
        display: inline-block;
        position: relative;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
        -webkit-font-smoothing: antialiased;
        font-variant-numeric: tabular-nums;
        user-select: none;
        -webkit-user-select: none;
      }
      * { box-sizing: border-box; }
      button {
        font: inherit;
        border: 0;
        background: none;
        padding: 0;
        cursor: pointer;
        color: inherit;
        -webkit-tap-highlight-color: transparent;
      }
      svg { display: block; }
      .visually-hidden {
        position: absolute;
        width: 1px; height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }

      /* ============ trigger pill — the whole visible component ============ */
      .pill {
        width: 250px;
        height: 36px;
        border-radius: 999px;
        background: var(--pill-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        padding: 0 34px 0 14px;
        transition: background-color 140ms var(--ease-out), scale 140ms var(--ease-out);
      }
      .pill:hover { background: var(--pill-bg-hover); }
      .pill:active { scale: 0.98; }
      .pill:focus-visible {
        outline: 2px solid var(--blue);
        outline-offset: 2px;
      }
      .pill .bolt { color: var(--ink); margin-right: 6px; flex: none; }
      .pill .label {
        font-size: 14px;
        font-weight: 600;
        color: var(--ink);
        letter-spacing: -0.01em;
        white-space: nowrap;
      }
      .pill .tier {
        font-weight: 400;
        color: var(--ink-2);
        margin-left: 5px;
        display: inline-block;
        transition: color 220ms var(--ease-out);
      }
      .pill .tier.is-ultra { color: var(--ultra-text); }
      .pill .chev {
        position: absolute;
        right: 13px;
        top: 50%;
        translate: 0 -50%;
        color: var(--ink-2);
        transition: rotate 200ms var(--ease-out);
      }
      .pill[aria-expanded="true"] .chev { rotate: 180deg; }

      /* ============ Popover ============ */
      .popover {
        position: absolute;
        bottom: calc(100% + 8px);
        left: 0;
        width: 100%;
        background: var(--card);
        border-radius: var(--r-card);
        box-shadow: 0 0 0 0.5px rgba(26, 29, 33, 0.05), 0 2px 6px rgba(26, 29, 33, 0.06), 0 12px 32px rgba(26, 29, 33, 0.13);
        transform-origin: 50% calc(100% + 16px);
        overflow: hidden;
        z-index: 10;
        display: none;
        opacity: 0;
        scale: 0.96;
        translate: 0 4px;
        transition:
          opacity 150ms cubic-bezier(0.4, 0, 1, 1),
          scale 150ms cubic-bezier(0.4, 0, 1, 1),
          translate 150ms cubic-bezier(0.4, 0, 1, 1),
          height 260ms var(--ease-out);
      }
      .popover.is-open {
        opacity: 1;
        scale: 1;
        translate: 0 0;
        transition:
          opacity 220ms var(--ease-out),
          scale 220ms var(--ease-out),
          translate 220ms var(--ease-out),
          height 260ms var(--ease-out);
      }

      .view {
        width: 100%;
        transition: opacity 180ms var(--ease-swap), translate 180ms var(--ease-swap), filter 180ms var(--ease-swap);
      }
      .view.is-hidden {
        position: absolute;
        inset: 0 0 auto 0;
        opacity: 0;
        pointer-events: none;
        filter: blur(4px);
      }
      .view-menu.is-hidden { translate: -10px 0; }
      .view-advanced.is-hidden { translate: 10px 0; }

      /* ---- menu view ---- */
      .view-menu { padding: 8px 8px 6px; }
      .row {
        width: 100%;
        height: 36px;
        border-radius: var(--r-row);
        display: flex;
        align-items: center;
        padding: 0 10px 0 12px;
        gap: 8px;
        text-align: left;
      }
      .adv-chip:focus-visible, .back-btn:focus-visible {
        outline: 2px solid var(--blue);
        outline-offset: 2px;
      }
      .row .k { font-size: 14px; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; flex: 1; }
      .row .v { font-size: 14px; color: var(--ink-2); }
      .row .c { color: var(--ink-3); flex: none; }
      .menu-stagger .row {
        animation: row-in 260ms var(--ease-out) backwards;
      }
      .menu-stagger .row:nth-child(2) { animation-delay: 30ms; }
      .menu-stagger .row:nth-child(3) { animation-delay: 60ms; }
      .menu-stagger .adv-chip-wrap { animation: row-in 260ms var(--ease-out) 90ms backwards; }
      @keyframes row-in {
        from { opacity: 0; translate: 0 5px; }
        to   { opacity: 1; translate: 0 0; }
      }
      .divider {
        height: 1px;
        background: var(--hairline);
        margin: 5px 3px;
      }
      .adv-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 32px;
        padding: 0 12px;
        border-radius: var(--r-row);
        font-size: 14px;
        color: var(--ink-2);
        transition: background-color 120ms var(--ease-out), color 120ms var(--ease-out);
      }
      .adv-chip:hover { background: var(--pill-bg); color: #5F6368; }
      .adv-chip:active { background: var(--pill-bg-hover); }
      .adv-chip svg { translate: 0 1px; }

      /* ---- advanced view ---- */
      .view-advanced { padding: 13px 16px 15px; }
      .adv-header {
        position: relative;
        height: 22px;
        margin-bottom: 13px;
      }
      .hdr-layer {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        opacity: 0;
        translate: 0 3px;
        filter: blur(3px);
        pointer-events: none;
        transition: opacity 200ms var(--ease-swap), translate 200ms var(--ease-swap), filter 200ms var(--ease-swap);
      }
      .hdr-layer.is-active {
        opacity: 1;
        translate: 0 0;
        filter: blur(0);
        pointer-events: auto;
      }
      .hdr-adv { justify-content: space-between; }
      .back-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 14px;
        color: var(--ink-2);
        border-radius: 7px;
        min-height: 32px;
        padding: 0 8px;
        margin-left: -8px;
        transition: color 140ms var(--ease-out), background-color 140ms var(--ease-out);
      }
      .back-btn:hover { color: var(--ink); background: #F5F5F7; }
      .back-btn .c { color: var(--ink-3); transition: translate 160ms var(--ease-out); }
      .back-btn:hover .c { translate: 2px 0; }
      .hdr-adv .bolt-badge { color: var(--blue); margin-right: 1px; }
      .hdr-labels { justify-content: space-between; }
      .hdr-labels span { font-size: 14px; color: var(--ink-2); }
      .hdr-warning { justify-content: center; }
      .hdr-warning span {
        font-size: 14px;
        font-weight: 600;
        letter-spacing: -0.01em;
        background: linear-gradient(90deg, #7C3AED, #9333EA);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }

      /* ---- slider ---- */
      .slider {
        position: relative;
        height: 38px;
        touch-action: none;
        cursor: grab;
        outline: none;
      }
      .slider.is-dragging { cursor: grabbing; }
      .slider:focus-visible::after {
        content: "";
        position: absolute;
        inset: -4px;
        border-radius: 999px;
        border: 2px solid var(--blue);
        pointer-events: none;
      }
      .track {
        position: absolute;
        left: 0; right: 0;
        top: 50%;
        translate: 0 -50%;
        height: 28px;
        border-radius: 999px;
        background: var(--track);
        overflow: hidden;
      }
      .ticks {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .tick {
        position: absolute;
        top: 50%;
        width: 5px;
        height: 5px;
        border-radius: 999px;
        background: var(--ink-3);
        translate: -50% -50%;
      }
      .fill {
        position: absolute;
        left: 0; top: 0; bottom: 0;
        border-radius: 999px;
        background: var(--blue);
        overflow: hidden;
        width: 50%;
      }
      .fill::after {
        /* ultra gradient layer, crossfaded over the solid blue */
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg, #2E61D4 0%, #A57BFD 65%, #8B73F3 100%);
        opacity: 0;
        transition: opacity 300ms var(--ease-out);
      }
      .slider.is-ultra .fill::after { opacity: 1; }
      .sparkles {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        z-index: 1;
      }
      /* celebration burst when reaching Ultra — overlays the slider, never intercepts input */
      .confetti {
        position: absolute;
        left: -32px;
        top: -40px;
        pointer-events: none;
        z-index: 3;
      }
      .knob {
        position: absolute;
        top: 50%;
        width: 34px;
        height: 34px;
        border-radius: 999px;
        background: #fff;
        translate: -50% -50%;
        left: 50%;
        box-shadow:
          0 0 0 0.5px rgba(26, 29, 33, 0.03),
          0 1px 2px rgba(26, 29, 33, 0.10),
          0 2px 6px rgba(26, 29, 33, 0.14);
        transition: scale 140ms var(--ease-out);
      }
      /* deeper drag shadow lives on a pseudo-element and crossfades via opacity —
         animating box-shadow itself repaints every frame while dragging */
      .knob::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: 999px;
        box-shadow:
          0 2px 3px rgba(26, 29, 33, 0.10),
          0 4px 10px rgba(26, 29, 33, 0.14);
        opacity: 0;
        transition: opacity 140ms var(--ease-out);
      }
      .slider.is-snapping .fill { transition: width 380ms var(--spring); }
      .slider.is-snapping .knob { transition: left 380ms var(--spring), scale 140ms var(--ease-out); }
      .slider.is-dragging .knob { scale: 1.04; }
      .slider.is-dragging .knob::after { opacity: 1; }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
      }
    </style>

    <button class="pill" aria-haspopup="dialog" aria-expanded="false">
      <svg class="bolt" width="13" height="13" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M11.983 1.907a.75.75 0 0 0-1.292-.657l-8.5 9.5A.75.75 0 0 0 2.75 12h6.572l-1.305 6.093a.75.75 0 0 0 1.292.657l8.5-9.5A.75.75 0 0 0 17.25 8h-6.572l1.305-6.093Z"/>
      </svg>
      <span class="label"><span class="model-name">GPT-5.4</span><span class="tier">Medium</span></span>
      <svg class="chev" width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M2.5 4.25 6 7.75l3.5-3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <div class="popover" role="dialog" aria-label="Model settings">
      <div class="view view-menu">
        <div class="row" data-row="model">
          <span class="k">Model</span><span class="v model-v">GPT-5.4</span>
          <svg class="c" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4.25 2.5 7.75 6l-3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="row" data-row="effort">
          <span class="k">Effort</span><span class="v effort-v">Medium</span>
          <svg class="c" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4.25 2.5 7.75 6l-3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="row" data-row="speed">
          <span class="k">Speed</span><span class="v">Fast</span>
          <svg class="c" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4.25 2.5 7.75 6l-3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="divider" role="separator"></div>
        <div class="adv-chip-wrap">
          <button class="adv-chip">
            Advanced
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2.5 7.75 6 4.25l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="view view-advanced is-hidden">
        <div class="adv-header">
          <div class="hdr-layer hdr-adv is-active">
            <button class="back-btn">
              Advanced
              <svg class="c" width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M4.25 2.5 7.75 6l-3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <svg class="bolt-badge" width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M11.983 1.907a.75.75 0 0 0-1.292-.657l-8.5 9.5A.75.75 0 0 0 2.75 12h6.572l-1.305 6.093a.75.75 0 0 0 1.292.657l8.5-9.5A.75.75 0 0 0 17.25 8h-6.572l1.305-6.093Z"/>
            </svg>
          </div>
          <div class="hdr-layer hdr-labels">
            <span>Faster</span><span>Smarter</span>
          </div>
          <div class="hdr-layer hdr-warning">
            <span>Consumes usage limits faster</span>
          </div>
        </div>

        <div class="slider" role="slider" tabindex="0"
             aria-orientation="horizontal"
             aria-label="Model intelligence"
             aria-describedby="slider-desc"
             aria-valuemin="0" aria-valuemax="4">
          <span class="visually-hidden" id="slider-desc">Left for faster responses, right for smarter responses.</span>
          <div class="track">
            <div class="ticks"></div>
            <div class="fill">
              <canvas class="sparkles" aria-hidden="true"></canvas>
            </div>
          </div>
          <div class="knob"></div>
          <canvas class="confetti" aria-hidden="true"></canvas>
        </div>
      </div>
    </div>
    `;
  }

  /* ======================= lifecycle ======================= */

  connectedCallback() {
    const $ = (s) => this.shadowRoot.querySelector(s);
    this.$pill = $('.pill');
    this.$tier = $('.tier');
    this.$modelName = $('.model-name');
    this.$popover = $('.popover');
    this.$menu = $('.view-menu');
    this.$advanced = $('.view-advanced');
    this.$advChip = $('.adv-chip');
    this.$backBtn = $('.back-btn');
    this.$hdrAdv = $('.hdr-adv');
    this.$hdrLabels = $('.hdr-labels');
    this.$hdrWarning = $('.hdr-warning');
    this.$slider = $('.slider');
    this.$track = $('.track');
    this.$ticks = $('.ticks');
    this.$fill = $('.fill');
    this.$knob = $('.knob');
    this.$canvas = $('.sparkles');
    this.$confetti = $('.confetti');
    this.$effortV = $('.effort-v');

    if (this.hasAttribute('value')) {
      this.#index = this.#clampIndex(parseInt(this.getAttribute('value'), 10));
    }
    if (this.hasAttribute('model-name')) {
      const name = this.getAttribute('model-name');
      this.$modelName.textContent = name;
      this.shadowRoot.querySelector('.model-v').textContent = name;
    }

    if (!this.#bound) {
      this.#bound = true;
      this.#buildTicks();
      this.#bind();
    }
    this.#reducedMotion.addEventListener?.('change', this.#onMotionPrefChange);
    this.#renderState({ animateTier: false });

    this.#resizeObserver = new ResizeObserver(() => {
      this.#layoutSlider();
      this.#sizeCanvas();
      if (this.#dragging) {
        this.#dragGeom = { rect: this.$track.getBoundingClientRect(), ...this.#metrics() };
      }
      if (this.#open && this.#view === 'advanced') this.#startSparkles(); // repaint (static under reduced motion)
    });
    this.#resizeObserver.observe(this.$track);
  }

  disconnectedCallback() {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#reducedMotion.removeEventListener?.('change', this.#onMotionPrefChange);
    document.removeEventListener('pointerdown', this.#onDocPointerDown, true);
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#stopConfetti();
    this.#snapSettleCb = null;
    clearTimeout(this.#closeTimer);
    clearTimeout(this.#snapTimer);
    // reset to a closed, quiescent state so a later reconnect starts clean
    this.#open = false;
    this.#dragging = false;
    this.#activePointer = null;
    this.#dragGeom = null;
    this.#dragPos = null;
    this.#hoveringSlider = false;
    this.$pill?.setAttribute('aria-expanded', 'false');
    this.$popover?.classList.remove('is-open');
    if (this.$popover) this.$popover.style.display = 'none';
    this.$slider?.classList.remove('is-dragging', 'is-snapping');
  }

  attributeChangedCallback(name, _old, val) {
    if (!this.$pill) return;
    if (name === 'value') {
      const i = this.#clampIndex(parseInt(val, 10));
      if (i !== this.#index) {
        this.#index = i;
        // celebrate when the knob LANDS, not while it is still springing there
        this.#snapSettleCb = i === 4 ? () => { if (this.#index === 4) this.#fireConfetti(); } : null;
        this.#renderState({ snap: true });
        if (i === 4 && this.#reducedMotion.matches) this.#snapSettleCb = null; // no snap runs; confetti is skipped under reduced motion anyway
      }
    }
    if (name === 'model-name') {
      this.$modelName.textContent = val;
      this.shadowRoot.querySelector('.model-v').textContent = val;
    }
  }

  get value() { return this.#index; }
  set value(v) { this.setAttribute('value', String(this.#clampIndex(v))); }
  get tier() { return this.#tiers[this.#index].key; }

  #clampIndex(v) { return Math.min(4, Math.max(0, Number.isFinite(v) ? Math.round(v) : 1)); }

  /* ======================= events ======================= */

  #bind() {
    this.$pill.addEventListener('click', () => this.#open ? this.#close() : this.#openPopover());
    this.$advChip.addEventListener('click', () => this.#switchView('advanced'));
    this.$backBtn.addEventListener('click', () => this.#switchView('menu'));

    this.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.#open) {
        e.stopPropagation();
        this.#close();
        this.$pill.focus();
      }
    });

    // slider hover → header label crossfade
    this.$slider.addEventListener('pointerenter', () => { this.#hoveringSlider = true; this.#syncHeader(); });
    this.$slider.addEventListener('pointerleave', () => { this.#hoveringSlider = false; this.#syncHeader(); });

    // drag / click on slider (single active pointer; ignore extra touches)
    this.$slider.addEventListener('pointerdown', (e) => {
      if (this.#activePointer !== null) return;
      this.#activePointer = e.pointerId;
      e.preventDefault();
      this.$slider.focus({ preventScroll: true }); // preventDefault suppresses default focus
      try { this.$slider.setPointerCapture(e.pointerId); } catch {}
      this.#dragging = true;
      this.#burstFiredThisGesture = false;
      // cache geometry once per gesture — no per-move layout reads
      this.#dragGeom = { rect: this.$track.getBoundingClientRect(), ...this.#metrics() };
      this.$slider.classList.add('is-dragging');
      this.#stopSnap();
      this.#dragTo(e);
    });
    this.$slider.addEventListener('pointermove', (e) => {
      if (this.#dragging && e.pointerId === this.#activePointer) this.#dragTo(e);
    });
    const release = (e) => {
      if (!this.#dragging || e.pointerId !== this.#activePointer) return;
      this.#dragging = false;
      this.#activePointer = null;
      this.#dragGeom = null;
      this.$slider.classList.remove('is-dragging');
      const pos = this.#dragPos ?? this.#index / 4;
      this.#dragPos = null;
      const target = Math.round(pos * 4);
      // reference order is settle-then-pop: celebrate when the knob lands at
      // Ultra after release, once per gesture — not on the mid-drag crossing
      const celebrate = target === 4 && !this.#burstFiredThisGesture;
      if (celebrate) this.#burstFiredThisGesture = true;
      // released right on the stop → no transition will fire; pop immediately
      const farFromStop = Math.abs(pos * 4 - target) * (this.#metrics().span / 4) > 2;
      if (celebrate && farFromStop) {
        this.#snapSettleCb = () => { if (this.#index === 4) this.#fireConfetti(); };
      }
      this.#commit(target, { snap: true });
      if (celebrate && !farFromStop) this.#fireConfetti();
    };
    this.$slider.addEventListener('pointerup', release);
    this.$slider.addEventListener('pointercancel', release);

    // keyboard on slider
    this.$slider.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (step !== undefined) {
        e.preventDefault();
        this.#commit(this.#index + step, { snap: false }); // keyboard = instant, no animation
      } else if (e.key === 'Home') { e.preventDefault(); this.#commit(0, { snap: false }); }
      else if (e.key === 'End')   { e.preventDefault(); this.#commit(4, { snap: false }); }
    });

    // menu arrow-key navigation (convenience on plain buttons)
    this.$menu.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = [...this.$menu.querySelectorAll('button')];
      const i = items.indexOf(this.shadowRoot.activeElement);
      const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      next.focus();
    });
  }

  /* ======================= popover open/close ======================= */

  #openPopover() {
    this.#open = true;
    this.#view = 'menu';
    this.$pill.setAttribute('aria-expanded', 'true');
    const pop = this.$popover;
    // anchor to the trigger pill's box
    pop.style.left = (this.$pill.getBoundingClientRect().left - this.getBoundingClientRect().left) + 'px';
    pop.style.width = this.$pill.offsetWidth + 'px';
    pop.style.display = 'block';
    pop.style.height = 'auto';
    this.#showView('menu', { instant: true });
    this.$menu.classList.add('menu-stagger');
    // lock measured height so later view morphs can animate from a px value
    const h = this.$menu.offsetHeight;
    pop.style.height = h + 'px';
    requestAnimationFrame(() => pop.classList.add('is-open'));
    document.addEventListener('pointerdown', this.#onDocPointerDown, true);
    this.#layoutSlider();
    this.#sizeCanvas();
    // sparkle loop starts when the advanced view is shown, not while the menu hides it
    this.$advChip.focus({ preventScroll: true });
  }

  #close() {
    if (!this.#open) return;
    this.#open = false;
    this.$pill.setAttribute('aria-expanded', 'false');
    // if focus is inside the popover, hand it back to the trigger before hiding
    const active = this.shadowRoot.activeElement;
    if (active && this.$popover.contains(active)) this.$pill.focus();
    const pop = this.$popover;
    pop.classList.remove('is-open');
    this.$menu.classList.remove('menu-stagger');
    document.removeEventListener('pointerdown', this.#onDocPointerDown, true);
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#stopConfetti();
    const hide = () => {
      pop.removeEventListener('transitionend', onEnd);
      clearTimeout(this.#closeTimer);
      if (!this.#open) pop.style.display = 'none';
    };
    const onEnd = (e) => {
      if (e.target !== pop || e.propertyName !== 'opacity') return;
      hide();
    };
    pop.addEventListener('transitionend', onEnd);
    this.#closeTimer = setTimeout(hide, 240); // fallback if transitionend never fires
  }

  #switchView(view) {
    if (this.#view === view) return;
    this.#view = view;
    this.$menu.classList.remove('menu-stagger');
    const incoming = view === 'menu' ? this.$menu : this.$advanced;
    this.#showView(view);
    // height morph: from current px to incoming natural height
    const pop = this.$popover;
    pop.style.height = pop.offsetHeight + 'px';
    requestAnimationFrame(() => {
      pop.style.height = incoming.offsetHeight + 'px';
    });
    if (view === 'advanced') {
      this.#layoutSlider();
      this.#sizeCanvas();
      this.#startSparkles(); // starts the loop, or repaints the static reduced-motion frame
      this.$slider.focus({ preventScroll: true });
    } else {
      cancelAnimationFrame(this.#raf); // canvas is hidden behind the menu view
      this.#raf = 0;
      this.$advChip.focus({ preventScroll: true });
    }
    this.#syncHeader();
  }

  #showView(view, { instant = false } = {}) {
    const on = view === 'menu' ? this.$menu : this.$advanced;
    const off = view === 'menu' ? this.$advanced : this.$menu;
    if (instant) {
      for (const v of [on, off]) v.style.transitionDuration = '0ms';
      requestAnimationFrame(() => {
        for (const v of [on, off]) v.style.transitionDuration = '';
      });
    }
    on.classList.remove('is-hidden');
    off.classList.add('is-hidden');
    off.setAttribute('inert', '');
    on.removeAttribute('inert');
  }

  /* ======================= slider ======================= */

  #buildTicks() {
    for (let i = 0; i < 5; i++) {
      const dot = document.createElement('div');
      dot.className = 'tick';
      this.$ticks.appendChild(dot);
    }
  }

  #metrics() {
    const w = this.$track.clientWidth;
    const K = 34;                 // knob diameter
    const min = K / 2;
    const max = w - K / 2;
    return { w, K, min, max, span: max - min };
  }

  #layoutSlider() {
    const { min, span } = this.#metrics();
    if (span <= 0) return;
    const dots = this.$ticks.children;
    for (let i = 0; i < dots.length; i++) {
      dots[i].style.left = (min + (i / 4) * span) + 'px';
    }
    this.#positionKnob(this.#dragPos ?? this.#index / 4);
  }

  #positionKnob(pos) {
    const { min, span, K } = this.#metrics();
    if (span <= 0) return;
    const cx = min + pos * span;
    this.$knob.style.left = cx + 'px';
    this.$fill.style.width = (cx + K / 2) + 'px';
  }

  // interrupt an in-flight snap without teleporting: freeze the knob/fill at
  // their current animated position, then drop the transition class
  #stopSnap() {
    if (this.$slider.classList.contains('is-snapping')) {
      this.$knob.style.left = getComputedStyle(this.$knob).left;
      this.$fill.style.width = getComputedStyle(this.$fill).width;
      this.$slider.classList.remove('is-snapping');
    }
    this.#snapSettleCb = null; // an interrupted snap forfeits its celebration
    clearTimeout(this.#snapTimer);
  }

  #dragTo(e) {
    // a snap started mid-drag (e.g. external value set) would make every move
    // retarget a spring transition — the knob would chase the finger; kill it
    if (this.$slider.classList.contains('is-snapping')) this.#stopSnap();
    const { rect, w, K } = this.#dragGeom ?? { rect: this.$track.getBoundingClientRect(), ...this.#metrics() };
    if (!rect.width || w <= K) return;
    // fraction along the track is scale-invariant (popover may be mid scale-transition)
    const frac = (e.clientX - rect.left) / rect.width;
    const pos = Math.min(1, Math.max(0, (frac * w - K / 2) / (w - K)));
    this.#dragPos = pos;
    this.#positionKnob(pos);
    // live preview: nearest stop drives labels/theme while dragging
    const nearest = Math.round(pos * 4);
    if (nearest !== this.#index) {
      this.#index = nearest;
      this.#renderState({ position: false });
      this.#emit();
    }
  }

  #beginSnap() {
    const settle = this.#snapSettleCb;
    this.#snapSettleCb = null;
    if (this.#reducedMotion.matches) return;
    if (this.#dragging) return; // never animate under an active finger
    this.$slider.classList.add('is-snapping');
    const clear = () => {
      this.$slider.classList.remove('is-snapping');
      this.$knob.removeEventListener('transitionend', onEnd);
      clearTimeout(this.#snapTimer);
      settle?.();
    };
    const onEnd = (e) => { if (e.propertyName === 'left') clear(); };
    this.$knob.addEventListener('transitionend', onEnd);
    clearTimeout(this.#snapTimer);
    this.#snapTimer = setTimeout(clear, 460); // fallback if transitionend never fires
  }

  #commit(i, { snap }) {
    i = this.#clampIndex(i);
    const changed = i !== this.#index;
    this.#index = i;
    if (snap) this.#beginSnap();
    this.#renderState();
    if (changed) this.#emit();
    if (changed && i === 4 && !snap) this.#fireConfetti(); // keyboard path: knob is already at the stop
  }

  #renderState({ position = true, animateTier = true, snap = false } = {}) {
    const t = this.#tiers[this.#index];
    const isUltra = this.#index === 4;

    if (position) {
      if (snap) this.#beginSnap();
      this.#positionKnob(this.#index / 4);
    }
    this.$slider.classList.toggle('is-ultra', isUltra);
    this.$slider.setAttribute('aria-valuenow', String(this.#index));
    this.$slider.setAttribute('aria-valuetext', t.valuetext);

    // pill tier label crossfade
    if (this.$tier.textContent !== t.key) {
      this.#swapText(this.$tier, t.key, animateTier);
    }
    this.$tier.classList.toggle('is-ultra', isUltra);
    this.$effortV.textContent = t.key;

    this.#syncHeader();
  }

  #swapText(el, text, animate) {
    // correctness never rides on the animation system: set text synchronously,
    // then play a purely-cosmetic enter animation (no fill, auto-reverts)
    el.textContent = text;
    if (!animate || this.#reducedMotion.matches || !el.animate) return;
    el.getAnimations().forEach(a => a.cancel());
    el.animate(
      [{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 130, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' }
    );
  }

  #syncHeader() {
    const isUltra = this.#index === 4;
    const showLabels = !isUltra && (this.#hoveringSlider || this.#dragging);
    const states = [
      [this.$hdrWarning, isUltra],
      [this.$hdrLabels, showLabels],
      [this.$hdrAdv, !isUltra && !showLabels],
    ];
    for (const [layer, active] of states) {
      layer.classList.toggle('is-active', active);
      layer.setAttribute('aria-hidden', String(!active));
      if (active) layer.removeAttribute('inert');
      else layer.setAttribute('inert', '');
    }
  }

  #emit() {
    this.dispatchEvent(new CustomEvent('change', {
      bubbles: true,
      detail: { index: this.#index, tier: this.tier, model: this.$modelName.textContent },
    }));
  }

  /* ======================= confetti burst (Ultra) ======================= */

  #fireConfetti() {
    if (this.#reducedMotion.matches || !this.#open || this.#view !== 'advanced') return;
    const now = performance.now();
    if (now - this.#lastBurst < 350) return; // rapid re-entries shouldn't spam
    this.#lastBurst = now;

    // size the overlay lazily, once per burst (slider + margins for flight room)
    const MX = 32, MY = 40;
    const sw = this.$slider.offsetWidth, sh = this.$slider.offsetHeight;
    if (!sw) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = sw + MX * 2, h = sh + MY * 2;
    if (!this.#confettiBox || this.#confettiBox.w !== w || this.#confettiBox.h !== h || this.#confettiBox.dpr !== dpr) {
      this.$confetti.width = w * dpr;
      this.$confetti.height = h * dpr;
      this.$confetti.style.width = w + 'px';
      this.$confetti.style.height = h + 'px';
      this.#confettiBox = { w, h, dpr };
    }

    // computed style = the knob's live on-screen position (style.left is only
    // the transition target while a snap spring is in flight)
    const cx = (parseFloat(getComputedStyle(this.$knob).left) || sw / 2) + MX;
    const cy = sh / 2 + MY;
    // reference look (34.mp4 f_128-f_135): a ring of chunky, evenly-sized
    // lavender beads pops from the knob's rim and dissolves within ~0.2s,
    // fading from the very first frame — no gravity, no rects
    const COLORS = ['#C9B0F0', '#BFA5F2', '#D4C3F7', '#B79EF5'];
    const R = 17; // knob radius — dots spawn on the rim, not at the center
    const N = 14;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const sp = 105 + Math.random() * 45;
      this.#confettiParts.push({
        x: cx + Math.cos(ang) * R,
        y: cy + Math.sin(ang) * R,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 25,
        size: 4.5 + Math.random() * 1,
        life: 0,
        ttl: 0.2 + Math.random() * 0.08,
        color: COLORS[i % COLORS.length],
      });
    }
    if (!this.#confettiRaf) {
      this.#confettiLast = now;
      this.#confettiRaf = requestAnimationFrame(this.#confettiTick);
    }
    // settle-time micro-pulse on the knob; skipped mid-drag (finger owns the knob)
    if (!this.#dragging && this.$knob.animate) {
      this.$knob.animate(
        [{ scale: '1' }, { scale: '1.05' }, { scale: '1' }],
        { duration: 180, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' }
      );
    }
  }

  #confettiTick = (t) => {
    // dt-based with a clamp: uneven frame pacing must never teleport particles
    const dt = Math.min(0.032, Math.max(0, (t - this.#confettiLast) / 1000));
    this.#confettiLast = t;
    const box = this.#confettiBox;
    const ctx = this.$confetti.getContext('2d');
    if (!box) { this.#confettiRaf = 0; return; }
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);

    this.#confettiParts = this.#confettiParts.filter((p) => {
      p.life += dt;
      if (p.life >= p.ttl) return false;
      const damp = Math.exp(-6 * dt); // frame-rate-independent decay: pop, then hang
      p.vx *= damp;
      p.vy = p.vy * damp - 20 * dt;   // slight upward lift, no gravity
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.life / p.ttl;
      ctx.globalAlpha = Math.pow(1 - k, 1.5); // dissolving from the first frame, ease-out
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
      return true;
    });
    ctx.globalAlpha = 1;

    if (this.#confettiParts.length) {
      this.#confettiRaf = requestAnimationFrame(this.#confettiTick);
    } else {
      this.#confettiRaf = 0;
      ctx.clearRect(0, 0, box.w, box.h);
    }
  };

  #stopConfetti() {
    cancelAnimationFrame(this.#confettiRaf);
    this.#confettiRaf = 0;
    this.#confettiParts = [];
    if (this.#confettiBox) {
      const ctx = this.$confetti.getContext('2d');
      ctx.setTransform(this.#confettiBox.dpr, 0, 0, this.#confettiBox.dpr, 0, 0);
      ctx.clearRect(0, 0, this.#confettiBox.w, this.#confettiBox.h);
    }
  }

  /* ======================= sparkles (Canvas 2D) ======================= */

  #sizeCanvas() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = this.$track.clientWidth;
    const h = this.$track.clientHeight;
    if (!w || !h) return;
    const b = this.#sparkBox;
    if (b && b.w === w && b.h === h && b.dpr === dpr) return; // no-op: keep bitmap & particles
    this.$canvas.width = w * dpr;
    this.$canvas.height = h * dpr;
    this.$canvas.style.width = w + 'px';
    this.$canvas.style.height = h + 'px';
    this.#sparkBox = { w, h, dpr };
    this.#seedParticles(w, h);
  }

  #seedParticles(w, h) {
    // seed across the FULL track so particles already exist where the fill expands to.
    // reference behavior (34.mp4): a sparse field of soft dots streams leftward at a
    // constant fast pace — an energy flow through the bar — pure horizontal motion
    // plus an in-place twinkle. speeds scaled to this track's proportions.
    const count = Math.max(6, Math.round(w / 24));
    this.#particles = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: 4 + Math.random() * (h - 8),
      r: 0.8 + Math.random() * 0.9,
      phase: Math.random() * Math.PI * 2,
      twinkle: 2.5 + Math.random() * 4.5,     // several visible pops per bar transit
      flow: 85 + Math.random() * 50,          // leftward stream speed, px/s
    }));
  }

  #startSparkles() {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    if (this.#reducedMotion.matches) {
      this.#drawSparkles(performance.now(), true);
      return;
    }
    this.#sparkLast = performance.now();
    const loop = (t) => {
      this.#drawSparkles(t);
      this.#raf = requestAnimationFrame(loop);
    };
    this.#raf = requestAnimationFrame(loop);
  }

  #drawSparkles(t, staticFrame = false) {
    if (!this.#sparkBox) return;
    const ctx = this.$canvas.getContext('2d');
    const { w, h, dpr } = this.#sparkBox; // sizing-time dpr, matches the backing store
    // dt-based with a clamp: uneven frame pacing must never teleport the stream
    const dt = staticFrame ? 0 : Math.min(0.032, Math.max(0, (t - this.#sparkLast) / 1000));
    this.#sparkLast = t;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    const sec = t / 1000;
    for (const p of this.#particles) {
      // constant leftward stream; wrap around to the right edge
      p.x -= p.flow * dt;
      if (p.x < -3) p.x += w + 6;
      // squared sine: mostly invisible with brief bright "pops"; static frame
      // uses each particle's phase for varied (not uniform) brightness
      const s = 0.5 + 0.5 * Math.sin(staticFrame ? p.phase * 3 : sec * p.twinkle + p.phase);
      ctx.globalAlpha = 0.06 + 0.74 * s * s;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

customElements.define('chatgpt-model-selector', ChatGPTModelSelector);
