/* renderer.js — shared renderer for all video script pages
 * Fetches data.json relative to the page, builds the DOM, injects all
 * dynamic behaviour (tabs, view toggle, music/shots, versioning, etc.)
 */

(async () => {
  // ── 1. Load data ──────────────────────────────────────────────────────────
  let data;
  try {
    const res = await fetch('data.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    document.body.innerHTML = `<p style="color:#888;padding:40px;font-family:sans-serif;">
      Failed to load data.json: ${err.message}</p>`;
    return;
  }

  const meta = data.meta || {};
  document.title = meta.title ? meta.title.replace(/<[^>]+>/g, '') : 'Script';

  // Polyfill window.storage with localStorage, keyed per page so pages don't share history
  if (!window.storage) {
    const pfx = location.pathname.replace(/\/+$/, '') + ':';
    window.storage = {
      get: k => Promise.resolve(localStorage.getItem(pfx + k) !== null ? { value: localStorage.getItem(pfx + k) } : null),
      set: (k, v) => { localStorage.setItem(pfx + k, String(v)); return Promise.resolve(); }
    };
  }

  let animFps = parseInt(localStorage.getItem('anim_fps') || '30');

  // ── 2. Build skeleton ─────────────────────────────────────────────────────
  document.body.innerHTML = `
    <div id="progress"></div>
    <div id="toast"></div>
    <div class="hero" id="hero-block">
      <p class="hero-eyebrow"></p>
      <h1></h1>
    </div>
    <nav class="tabs" id="tabs-nav"></nav>
    <div id="tab-panels"></div>
    <div id="vbar">
      <div id="vbar-left">
        <span id="vbar-label">Auto-versioned</span>
        <span id="ver-badge">v1 — Initial render</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <div id="anim-fps-wrap">
          <span class="anim-fps-label">FPS</span>
          <div class="anim-fps-toggle">
            <button class="anim-fps-btn" data-fps="24">24</button>
            <button class="anim-fps-btn" data-fps="30">30</button>
            <button class="anim-fps-btn" data-fps="60">60</button>
          </div>
        </div>
        <div id="view-toggle">
          <button class="vtab" data-view="music">Music</button>
          <button class="vtab" data-view="script">Script</button>
          <button class="vtab" data-view="shots">Shots</button>
          <button class="vtab" data-view="anim">Anim</button>
          <div id="vtab-indicator"></div>
        </div>
        <div id="actual-view-toggle">
          <button class="actual-vtab" data-aview="script">Script</button>
          <button class="actual-vtab" data-aview="shortform">Short-form</button>
          <button class="actual-vtab" data-aview="animations">Animations</button>
          <div id="actual-vtab-indicator"></div>
        </div>
        <button class="vbtn" id="btn-import-script" title="Copy DaVinci import script to clipboard">Import Script</button>
        <button class="vbtn" id="btn-history">History</button>
        <button class="vbtn" id="btn-fullscreen" title="Toggle fullscreen">⛶</button>
      </div>
    </div>
    <div id="vpanel">
      <div id="vpanel-head">
        <span>Version History</span>
        <button id="vpanel-close">×</button>
      </div>
      <div id="vlist"><div id="vempty">Loading…</div></div>
    </div>
  `;

  // ── 3. Build tabs ─────────────────────────────────────────────────────────
  const tabsNav = document.getElementById('tabs-nav');
  const tabPanels = document.getElementById('tab-panels');

  data.tabs.forEach(tab => {
    // nav button
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.tab = tab.id;
    btn.textContent = tab.label;
    tabsNav.appendChild(btn);

    // panel
    const panel = document.createElement('div');
    panel.className = 'tab-content';
    panel.dataset.tab = tab.id;
    panel.innerHTML = buildTabPanel(tab);
    tabPanels.appendChild(panel);
  });

  // ── 4. Build tab content ──────────────────────────────────────────────────
  function buildTabPanel(tab) {
    const hero = tab.hero || {};
    const titleHtml = hero.title || '';
    const eyebrow = hero.eyebrow || '';

    if (tab.id === 'youtube') {
      return `
        <div class="container" id="content-block">
          ${(tab.sections || []).map(buildYouTubeSection).join('')}
        </div>
        <footer>${meta.footerNote || ''}</footer>
      `;
    }

    if (tab.id === 'todo') {
      return buildTodoPanel(tab);
    }

    if (tab.id === 'actual-script') {
      return buildTranscriptPanel(tab);
    }

    // Social tabs (shorts, twitter, tiktok, instagram, linkedin)
    const summaryHtml = tab.summary ? buildSummary(tab.summary) : '';
    const postsHtml = (tab.posts || []).map(p => buildPost(p, tab.id)).join('');
    const rolloutHtml = tab.rollout ? buildRollout(tab.rollout) : '';

    return `
      <div class="container">
        ${summaryHtml}
        ${postsHtml}
        ${rolloutHtml}
      </div>
    `;
  }

  // ── 5. YouTube section builder ────────────────────────────────────────────
  function buildYouTubeSection(sec) {
    const tag = sec.type || 'beat';
    const labelHtml = sec.sublabel
      ? `<span class="section-tag ${tag}">${escHtml(sec.label)}</span><span class="section-subtitle">${escHtml(sec.sublabel)}</span>`
      : `<span class="section-tag ${tag}">${escHtml(sec.label)}</span>`;

    const sectionId = (sec.label + (sec.sublabel ? '-' + sec.sublabel : ''))
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    const stored = (() => { try { const s = localStorage.getItem('anim_' + sectionId); return s ? JSON.parse(s) : {}; } catch(e) { return {}; } })();
    const storedItems = stored.items || [];

    const itemsHtml = (sec.items || []).map((item, i) => {
      const sv = storedItems[i] ? (storedItems[i].start || '') : '';
      const ev = storedItems[i] ? (storedItems[i].end   || '') : '';
      const noteVal = storedItems[i] ? (storedItems[i].note || '') : '';
      const anno = `<div class="anim-line-anno" data-item-idx="${i}">
        <div class="anim-line-row">
          <span class="anim-line-num">${String(i+1).padStart(2,'0')}</span>
          <input class="anim-frame-input" type="text" inputmode="numeric" placeholder="—" value="${escHtml(sv)}" data-role="start">
          <span class="anim-arrow">→</span>
          <input class="anim-frame-input" type="text" inputmode="numeric" placeholder="—" value="${escHtml(ev)}" data-role="end">
        </div>
        <input class="anim-note-input" type="text" placeholder="note…" value="${escHtml(noteVal)}">
      </div>`;
      if (item.type === 'pull') return `<div class="pull">${item.text}</div>${anno}`;
      if (item.type === 'crystallize') return `<div class="crystallize"><p>${item.text}</p></div>${anno}`;
      return `<p>${item.text}</p>${anno}`;
    }).join('');

    const purposeHtml = sec.purpose
      ? `<div class="section-purpose"><span class="sp-eyebrow">Notes</span><div class="sp-text">${sec.purpose}</div></div>`
      : '';

    return `
      <div class="section"${sec.endTime ? ` data-end-time="${sec.endTime}"` : ''} data-section-id="${escHtml(sectionId)}">
        <div class="section-label">${labelHtml}</div>
        ${itemsHtml}
        ${purposeHtml}
        <div class="anim-section-footer">
          <button class="anim-copy-btn">Copy brief</button>
        </div>
      </div>
    `;
  }

  // ── 5b. Todo panel builder ────────────────────────────────────────────────
  function buildTodoPanel(tab) {
    const groups = tab.groups || [];
    const groupsHtml = groups.map(g => {
      const items = (g.items || []).map(item => `
        <label class="todo-item" data-id="${escHtml(item.id)}">
          <input type="checkbox" class="todo-check" data-id="${escHtml(item.id)}">
          <span class="todo-text">${escHtml(item.text)}</span>
        </label>
      `).join('');
      return `
        <div class="todo-group">
          <div class="todo-group-label">${escHtml(g.label)}</div>
          <div class="todo-items">${items}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="container">
        <div class="todo-panel">${groupsHtml}</div>
      </div>
    `;
  }

  // ── 5c. Transcript panel builder ─────────────────────────────────────────
  function buildTranscriptPanel(tab) {
    const cues   = tab.cues   || [];
    const legend = tab.legend || [];
    const clips  = tab.clips  || [];

    const colorMap = {};
    legend.forEach(l => { colorMap[l.id] = l.color; });

    function toSec(t) {
      const p = String(t).split(':').map(Number);
      return p.length === 3 ? p[0]*3600 + p[1]*60 + p[2] : p[0]*60 + (p[1]||0);
    }

    const legendHtml = legend.map(l => `
      <div class="transcript-legend-item">
        <div class="transcript-legend-dot" style="background:${escHtml(l.color)}"></div>
        ${escHtml(l.label)}
      </div>
    `).join('');

    const clipsLegendHtml = clips.length ? `
      <div class="clips-legend-label">Repurposed as</div>
      <div class="transcript-legend clips-legend">
        ${clips.map(cl => `
          <div class="transcript-legend-item">
            <div class="transcript-legend-dot" style="background:${escHtml(cl.color)}"></div>
            <span class="clip-legend-name">${escHtml(cl.label)}</span>${cl.sublabel ? `<span class="clip-legend-sub"> — ${escHtml(cl.sublabel)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    ` : '';

    const cuesHtml = cues.map((c, idx) => {
      const color   = colorMap[c.section] || '#444';
      const cueSec  = toSec(c.start);
      const matched = clips.filter(cl =>
        cl.ranges.some(r => cueSec >= r.start && cueSec < r.end)
      );
      const badgesHtml = matched.length ? `
        <div class="transcript-clips">
          ${matched.map(cl => `
            <span class="clip-badge" style="--badge-color:${escHtml(cl.color)}"
              title="${escHtml(cl.label + (cl.sublabel ? ' — ' + cl.sublabel : ''))}"
            >${escHtml(cl.label)}</span>
          `).join('')}
        </div>
      ` : '';

      let animHtml = '';
      if (c.anim) {
        const m = c.anim.match(/^\[(\w+)\]\s*([\s\S]*)/);
        const type = m ? m[1] : '';
        const desc = m ? m[2] : c.anim;
        const badge = type ? `<span class="anim-type-badge anim-type-${escHtml(type.toLowerCase())}">${escHtml(type)}</span>` : '';
        animHtml = `<div class="transcript-anim-note">${badge}<span class="anim-note-desc">${escHtml(desc)}</span></div>`;
      }

      return `
        <div class="transcript-cue${matched.length ? ' has-clip' : ''}${c.anim ? ' has-anim' : ''}" data-cue-idx="${idx}">
          <div class="transcript-cue-bar" style="background:${color}"></div>
          <div class="transcript-inner">
            <span class="transcript-time">${escHtml(c.start)}</span>
            <span class="transcript-text">${escHtml(c.text)}</span>
            ${badgesHtml}
            ${animHtml}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="container">
        <div class="transcript-list">
          <div class="transcript-legend">${legendHtml}</div>
          ${clipsLegendHtml}
          <div class="transcript-cues" id="transcript-cues">${cuesHtml}</div>
        </div>
      </div>
    `;
  }

  // ── 6. Summary box ────────────────────────────────────────────────────────
  function buildSummary(s) {
    return `
      <div class="tw-summary">
        <div class="tw-summary-label">${escHtml(s.label)}</div>
        <p class="tw-summary-count">${escHtml(s.count)}</p>
        <p class="tw-summary-inv">${s.inv}</p>
      </div>
    `;
  }

  // ── 7. Post builder ───────────────────────────────────────────────────────
  function buildPost(p, tabId) {
    const pillStyle = p.formatPill && p.formatPill.style ? ` style="${p.formatPill.style}"` : '';
    const pillClass = `format-pill${p.formatPill && p.formatPill.class ? ' ' + p.formatPill.class : ''}`;
    const strengthClass = p.strength === 'rejected' ? '' : p.strength;
    const strengthStyle = p.strength === 'rejected'
      ? ' style="color:#555;background:rgba(85,85,85,0.06);border:1px solid rgba(85,85,85,0.25);"'
      : '';
    const headlineStyle = p.headlineStyle ? ` style="${p.headlineStyle}"` : '';

    let hookHtml = '';
    if (p.hook) {
      hookHtml = `
        <div class="short-hook">
          <div class="short-hook-label">${escHtml(p.hook.label)}</div>
          <p class="short-hook-text">${p.hook.text}</p>
        </div>
      `;
    }

    let onscreenHtml = '';
    if (p.onscreenText) {
      const lines = p.onscreenText.split('\n').join('<br>');
      onscreenHtml = `
        <div class="onscreen-mock">
          <div class="onscreen-label">${escHtml(p.onscreenLabel || 'On-screen text')}</div>
          <div class="onscreen-frame">
            <p class="onscreen-text">${lines}</p>
          </div>
        </div>
      `;
    }

    let metaHtml = '';
    if (p.meta && p.meta.length) {
      const rows = p.meta.map(m => `
        <div class="short-meta-row">
          <div class="short-meta-label">${escHtml(m.label)}</div>
          <div class="short-meta-value">${m.value !== undefined ? m.value : ''}</div>
        </div>
      `).join('');
      metaHtml = `<div class="short-pair-meta">${rows}</div>`;
    }

    let pairHtml = '';
    if (onscreenHtml || metaHtml) {
      pairHtml = `<div class="short-pair">${onscreenHtml}${metaHtml}</div>`;
    }

    // LinkedIn full post paragraphs
    let specsHtml = '';
    if (p.specs) {
      specsHtml = `<div class="video-spec"${p.specStyle ? ` style="${p.specStyle}"` : ''}>
        ${p.specs.map(spec => buildSpecRow(spec)).join('')}
      </div>`;
    }

    let whyHtml = '';
    if (p.whyFormat) {
      whyHtml = `
        <div class="why-format">
          <strong>${escHtml(p.whyFormat.label)}</strong>
          ${p.whyFormat.text}
        </div>
      `;
    }

    let caveatHtml = '';
    if (p.caveat) {
      caveatHtml = `
        <div class="caveat">
          <strong>${escHtml(p.caveat.strength)}</strong>
          ${p.caveat.text}
        </div>
      `;
    }

    return `
      <div class="post-block">
        <div class="post-meta-row">
          <span class="post-num">${escHtml(p.num)}</span>
          <span class="${pillClass}"${pillStyle}>${p.formatPill ? escHtml(p.formatPill.text) : ''}</span>
          <span class="strength ${strengthClass}"${strengthStyle}>${p.strength === 'rejected' ? 'Rejected' : (p.strength ? cap(p.strength) : '')}</span>
        </div>
        <h2 class="post-headline"${headlineStyle}>${p.headline || ''}</h2>
        ${hookHtml}
        ${pairHtml}
        ${specsHtml}
        ${whyHtml}
        ${caveatHtml}
      </div>
    `;
  }

  function buildSpecRow(spec) {
    // Spec row with cuts list
    if (spec.cuts) {
      const cuts = spec.cuts.map(c => `
        <li>
          <span class="cut-type ${c.type}">${escHtml(c.label)}</span>
          <span>${c.text}</span>
        </li>
      `).join('');
      return `
        <div class="video-spec-row">
          <div class="video-spec-label">${escHtml(spec.label)}</div>
          <div class="video-spec-value"><ul class="video-cuts">${cuts}</ul></div>
        </div>
      `;
    }
    // Spec row with paragraphs (LinkedIn post)
    if (spec.paragraphs) {
      const paras = spec.paragraphs.map(t => `<p style="margin-bottom:14px;">${escHtml(t)}</p>`).join('');
      return `
        <div class="video-spec-row">
          <div class="video-spec-label">${escHtml(spec.label)}</div>
          <div class="video-spec-value">${paras}</div>
        </div>
      `;
    }
    // Plain spec row
    const rowStyle = spec.style ? ` style="${spec.style}"` : '';
    return `
      <div class="video-spec-row">
        <div class="video-spec-label">${escHtml(spec.label)}</div>
        <div class="video-spec-value"${rowStyle}>${spec.value || ''}</div>
      </div>
    `;
  }

  // ── 8. Rollout builder ────────────────────────────────────────────────────
  function buildRollout(r) {
    const days = (r.days || []).map(d => `
      <div class="rollout-day">
        <div class="rollout-when">${escHtml(d.when)}</div>
        <div class="rollout-what">${d.what}</div>
      </div>
    `).join('');
    return `
      <div class="rollout">
        <div class="rollout-label">${escHtml(r.label)}</div>
        <h2 class="rollout-title">${escHtml(r.title)}</h2>
        <p class="rollout-sub">${escHtml(r.sub)}</p>
        ${days}
      </div>
    `;
  }

  // ── 9. Animation annotations ─────────────────────────────────────────────
  function initAnimAnnotations() {
    // FPS toggle
    document.querySelectorAll('.anim-fps-btn').forEach(btn => {
      const fps = parseInt(btn.dataset.fps);
      btn.classList.toggle('active', fps === animFps);
      btn.addEventListener('click', () => {
        animFps = fps;
        localStorage.setItem('anim_fps', animFps);
        document.querySelectorAll('.anim-fps-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.fps) === animFps));
      });
    });

    // Per-section: save inputs + handle copy
    document.querySelectorAll('.section[data-section-id]').forEach(sectionEl => {
      const sectionId = sectionEl.dataset.sectionId;

      const save = () => {
        const items = [];
        sectionEl.querySelectorAll('.anim-line-anno').forEach(anno => {
          items.push({
            start: (anno.querySelector('[data-role="start"]') || {}).value || '',
            end:   (anno.querySelector('[data-role="end"]')   || {}).value || '',
            note:  (anno.querySelector('.anim-note-input')    || {}).value || ''
          });
        });
        try { localStorage.setItem('anim_' + sectionId, JSON.stringify({ items })); } catch(e) {}
      };

      sectionEl.querySelectorAll('.anim-frame-input').forEach(inp => inp.addEventListener('input', save));
      sectionEl.querySelectorAll('.anim-note-input').forEach(inp => inp.addEventListener('input', save));

      const copyBtn = sectionEl.querySelector('.anim-copy-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          const labelEl    = sectionEl.querySelector('.section-tag');
          const sublabelEl = sectionEl.querySelector('.section-subtitle');
          const label    = labelEl    ? labelEl.textContent.trim()    : sectionId;
          const sublabel = sublabelEl ? sublabelEl.textContent.trim() : '';
          const header   = sublabel ? `${label} — ${sublabel}` : label;
          const endTime  = sectionEl.dataset.endTime || '';

          const lines = [
            `${header}${endTime ? `  (ends ${endTime})` : ''}`,
            `FPS: ${animFps}`,
            ''
          ];

          const bodyEl   = sectionEl.querySelector('.section-body') || sectionEl;
          const scriptEls = Array.from(bodyEl.querySelectorAll(':scope > p, :scope > .pull, :scope > .crystallize'));
          const annos     = Array.from(sectionEl.querySelectorAll('.anim-line-anno'));

          scriptEls.forEach((el, i) => {
            const anno = annos[i];
            const s = anno ? ((anno.querySelector('[data-role="start"]') || {}).value || '—') : '—';
            const e = anno ? ((anno.querySelector('[data-role="end"]')   || {}).value || '—') : '—';
            const note = anno ? ((anno.querySelector('.anim-note-input') || {}).value || '') : '';
            const text = el.textContent.replace(/\s+/g, ' ').trim();
            lines.push(`Line ${String(i+1).padStart(2,'0')}  [ ${s.padStart(5)} → ${e.padStart(5)} ]:  ${text}`);
            if (note) lines.push(`          note: ${note}`);
          });

          navigator.clipboard.writeText(lines.join('\n')).then(() => showToast('Copied!'));
        });
      }
    });
  }

  // ── 10. Music cue + shot list injection ───────────────────────────────────
  function injectMusicCues() {
    const sections = document.querySelectorAll('.tab-content[data-tab="youtube"] #content-block > .section');
    const ytTab = data.tabs.find(t => t.id === 'youtube');
    if (!ytTab) return;

    sections.forEach((section, i) => {
      if (section.querySelector(':scope > .music-cue')) return;
      const sec = ytTab.sections[i];
      if (!sec) return;

      // wrap existing content in section-body
      let body = section.querySelector(':scope > .section-body');
      if (!body) {
        body = document.createElement('div');
        body.className = 'section-body';
        const kids = Array.from(section.children);
        kids.forEach(k => body.appendChild(k));
        section.appendChild(body);
      }

      // Music cue aside
      if (sec.musicCue) {
        const cue = sec.musicCue;
        const aside = document.createElement('aside');
        aside.className = 'music-cue';
        aside.innerHTML = `
          <div class="cue-label">Music · ends ${escHtml(cue.end)}</div>
          <h3 class="cue-title">${escHtml(cue.title)}</h3>
          <div class="cue-meta">${escHtml(cue.meta)}</div>
          <p class="cue-desc">${escHtml(cue.desc)}</p>
          <div class="cue-note">${escHtml(cue.note)}</div>
        `;
        section.insertBefore(aside, body);
        if (cue.end) section.dataset.endTime = cue.end;
      }

      // Shot list
      if (sec.shotList && sec.shotList.length) {
        const shots = sec.shotList;
        const list = document.createElement('div');
        list.className = 'shot-list';
        list.innerHTML = `
          <div class="shot-list-label">Shot list</div>
          ${shots.map((s, j) => `
            <div class="shot">
              <div class="shot-num">${String(j + 1).padStart(2, '0')}</div>
              <div class="shot-type t-${s.type.toLowerCase().replace('-', '')}">${escHtml(s.type)}</div>
              <div class="shot-desc">${s.desc}</div>
            </div>
          `).join('')}
        `;
        section.appendChild(list);

        // Inline markers + bidirectional hover
        const scriptEls = Array.from(body.querySelectorAll(':scope > p, :scope > .pull, :scope > .crystallize'));
        const shotRows = Array.from(list.querySelectorAll('.shot'));
        shots.forEach((s, j) => {
          const el = scriptEls[j];
          const shotRow = shotRows[j];
          if (!el) return;

          const marker = document.createElement('span');
          marker.className = 'shot-marker';
          marker.textContent = String(j + 1).padStart(2, '0');
          el.insertBefore(marker, el.firstChild);

          const shotText = document.createElement('span');
          shotText.className = 'shot-text';
          while (marker.nextSibling) shotText.appendChild(marker.nextSibling);
          el.appendChild(shotText);

          const highlight = () => {
            marker.classList.add('shot-hover');
            el.classList.add('script-el-hover');
            if (shotRow) shotRow.classList.add('shot-hover');
          };
          const unhighlight = () => {
            marker.classList.remove('shot-hover');
            el.classList.remove('script-el-hover');
            if (shotRow) shotRow.classList.remove('shot-hover');
          };

          marker.addEventListener('mouseenter', highlight);
          marker.addEventListener('mouseleave', unhighlight);
          el.addEventListener('mouseenter', highlight);
          el.addEventListener('mouseleave', unhighlight);
          if (shotRow) {
            shotRow.addEventListener('mouseenter', highlight);
            shotRow.addEventListener('mouseleave', unhighlight);
          }
        });
      }
    });
  }

  // ── 10. View toggle (Music / Script / Shots) ─────────────────────────────
  async function loadMode() {
    let view = 'script';
    try {
      const r = await window.storage.get('active_view');
      if (r && r.value) view = r.value;
    } catch (e) {}
    setView(view, false);
  }

  function setView(view, save = true) {
    const wasMusic = document.body.classList.contains('show-music');
    const wasShots = document.body.classList.contains('show-shots');
    const wasAnim = document.body.classList.contains('show-anim');
    const isChanging = wasMusic || wasShots || wasAnim || view !== 'script';

    const container = document.querySelector('.container');
    if (container && isChanging) container.style.opacity = '0';

    const swapClasses = () => {
      document.body.classList.remove('show-music-visible', 'show-shots-visible');
      if (view === 'music') {
        document.body.classList.remove('show-shots', 'show-anim');
        document.body.classList.add('show-music');
        requestAnimationFrame(() => document.body.classList.add('show-music-visible'));
      } else if (view === 'shots') {
        document.body.classList.remove('show-music', 'show-anim');
        document.body.classList.add('show-shots');
        requestAnimationFrame(() => document.body.classList.add('show-shots-visible'));
      } else if (view === 'anim') {
        document.body.classList.remove('show-music', 'show-shots');
        document.body.classList.add('show-anim');
      } else {
        document.body.classList.remove('show-music', 'show-shots', 'show-anim');
      }
      if (container) requestAnimationFrame(() => { container.style.opacity = '1'; });
    };

    if (container && isChanging) {
      setTimeout(swapClasses, 250);
    } else {
      swapClasses();
    }

    document.querySelectorAll('.vtab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    positionVtabIndicator(view);

    if (save) {
      try { window.storage.set('active_view', view); } catch (e) {}
    }
  }

  function positionVtabIndicator(view) {
    const indicator = document.getElementById('vtab-indicator');
    const activeBtn = document.querySelector(`.vtab[data-view="${view}"]`);
    const parent = document.getElementById('view-toggle');
    if (activeBtn && indicator && parent) {
      const parentRect = parent.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();
      indicator.style.left = (btnRect.left - parentRect.left - 3) + 'px';
      indicator.style.width = btnRect.width + 'px';
    }
  }

  document.querySelectorAll('.vtab').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  // ── 11. Fullscreen ────────────────────────────────────────────────────────
  document.getElementById('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const btn = document.getElementById('btn-fullscreen');
    btn.textContent = document.fullscreenElement ? '✕' : '⛶';
    btn.title = document.fullscreenElement ? 'Exit fullscreen' : 'Toggle fullscreen';
  });

  // ── 11b. Import script ────────────────────────────────────────────────────
  function buildDaVinciScript(m) {
    const base = m.importScript?.base || '/Users/julianquezada/Desktop/VIDEOS/Auto AI Applier';
    const bin  = m.importScript?.bin  || 'Auto AI Applier';
    return `local BASE = "${base}"

local BINS = {
    "Raw Footage",
    "Music",
    "Sound Effects",
    "Scripts",
    "Transcripts",
    "Animations",
}

local MEDIA_EXTS = {
    mp4=true, mov=true, avi=true, mkv=true, mxf=true,
    mp3=true, wav=true, aiff=true, aif=true, m4a=true,
    png=true, jpg=true, jpeg=true, tiff=true, psd=true, gif=true,
}

local function getExt(filename)
    return filename:match("%.(%w+)$"):lower()
end

local function getOrCreateBin(mediaPool, parent, name)
    for _, sub in ipairs(parent:GetSubFolderList()) do
        if sub:GetName() == name then
            return sub
        end
    end
    return mediaPool:AddSubFolder(parent, name)
end

local function getExistingPaths(bin)
    local paths = {}
    for _, clip in ipairs(bin:GetClipList()) do
        paths[clip:GetClipProperty("File Path")] = true
    end
    return paths
end

local mediaPool   = resolve:GetProjectManager():GetCurrentProject():GetMediaPool()
local rootFolder  = mediaPool:GetRootFolder()
local projectBin  = getOrCreateBin(mediaPool, rootFolder, "${bin}")

for _, binName in ipairs(BINS) do
    local folderPath = BASE .. "/" .. binName
    local targetBin  = getOrCreateBin(mediaPool, projectBin, binName)
    local existing   = getExistingPaths(targetBin)

    mediaPool:SetCurrentFolder(targetBin)

    local newFiles = {}
    local handle = io.popen('ls "' .. folderPath .. '" 2>/dev/null')
    if handle then
        for filename in handle:lines() do
            local ext = filename:match("%.(%w+)$")
            if ext and MEDIA_EXTS[ext:lower()] then
                local fullPath = folderPath .. "/" .. filename
                if not existing[fullPath] then
                    table.insert(newFiles, fullPath)
                end
            end
        end
        handle:close()
    end

    if #newFiles > 0 then
        mediaPool:ImportMedia(newFiles)
        print("'" .. binName .. "': imported " .. #newFiles .. " new file(s)")
    else
        print("'" .. binName .. "': nothing new to import")
    end
end

local rawFootageBin = getOrCreateBin(mediaPool, projectBin, "Raw Footage")
mediaPool:SetCurrentFolder(rawFootageBin)

print("All done.")`;
  }

  document.getElementById('btn-import-script').addEventListener('click', () => {
    navigator.clipboard.writeText(buildDaVinciScript(meta)).then(() => showToast('Import script copied!'));
  });

  // ── 12. Tab switching ─────────────────────────────────────────────────────
  async function loadTab() {
    let tab = 'youtube';
    try {
      const r = await window.storage.get('active_tab');
      if (r) tab = r.value;
    } catch (e) {}
    setActiveTab(tab, false);
  }

  function setActiveTab(tab, save = true) {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.toggle('active', c.dataset.tab === tab);
    });
    document.body.dataset.tab = tab;

    // Update shared hero block
    const tabData = data.tabs.find(t => t.id === tab);
    const hero = tabData?.hero || {};
    const heroBlock = document.getElementById('hero-block');
    if (heroBlock) {
      heroBlock.querySelector('.hero-eyebrow').textContent = hero.eyebrow || '';
      heroBlock.querySelector('h1').innerHTML = hero.title || '';
    }

    if (tab === 'youtube') {
      const activeBtn = document.querySelector('.vtab.active');
      const indicator = document.getElementById('vtab-indicator');
      const parent = document.getElementById('view-toggle');
      if (activeBtn && indicator && parent) {
        const parentRect = parent.getBoundingClientRect();
        const btnRect = activeBtn.getBoundingClientRect();
        indicator.style.left = (btnRect.left - parentRect.left - 3) + 'px';
        indicator.style.width = btnRect.width + 'px';
      }
    }
    if (tab === 'actual-script') {
      requestAnimationFrame(_positionActualIndicator);
    }
    if (save) {
      try { window.storage.set('active_tab', tab); } catch (e) {}
    }
  }

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });

  // ── 13. Version history ───────────────────────────────────────────────────
  const STORE_KEY = 'script_versions';
  const CURRENT_KEY = 'script_current';
  const DOC_HASH_KEY = 'script_doc_hash';
  const SCRIPT_VERSION = meta.scriptVersion || 'v1';
  const VERSION_LABEL = meta.versionLabel || 'Initial render';

  let versions = [];
  let currentIdx = null;

  async function loadVersions() {
    try {
      const r = await window.storage.get(STORE_KEY);
      if (r) versions = JSON.parse(r.value);
    } catch (e) { versions = []; }
    try {
      const r = await window.storage.get(CURRENT_KEY);
      if (r && r.value !== '') currentIdx = parseInt(r.value);
    } catch (e) { currentIdx = null; }
  }

  async function saveVersions() {
    try { await window.storage.set(STORE_KEY, JSON.stringify(versions)); } catch (e) {}
    try { await window.storage.set(CURRENT_KEY, String(currentIdx ?? '')); } catch (e) {}
  }

  function snapshot() {
    const result = {};
    document.querySelectorAll('.tab-content').forEach(tc => {
      const clone = tc.cloneNode(true);
      clone.querySelectorAll('.music-cue, .shot-list').forEach(el => el.remove());
      clone.querySelectorAll('.section-body').forEach(body => {
        const parent = body.parentNode;
        while (body.firstChild) parent.appendChild(body.firstChild);
        body.remove();
      });
      clone.querySelectorAll('.section').forEach(s => s.removeAttribute('data-end-time'));
      result[tc.dataset.tab] = clone.innerHTML;
    });
    return result;
  }

  function applySnapshot(snap) {
    Object.entries(snap).forEach(([tab, html]) => {
      const tc = document.querySelector(`.tab-content[data-tab="${tab}"]`);
      if (tc) tc.innerHTML = html;
    });
    injectMusicCues();
  }

  function hashSnap(snap) {
    const s = Object.keys(snap).sort().map(k => k + ':' + snap[k]).join('|');
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return String(h);
  }

  function updateBadge() {
    const el = document.getElementById('ver-badge');
    if (currentIdx === null || !versions[currentIdx]) {
      el.textContent = 'No version';
      return;
    }
    const v = versions[currentIdx];
    el.textContent = `v${currentIdx + 1} — ${v.label}`;
  }

  function renderList() {
    const list = document.getElementById('vlist');
    if (!versions.length) {
      list.innerHTML = '<div id="vempty">No saved versions yet.</div>';
      return;
    }
    list.innerHTML = versions.slice().reverse().map((v, ri) => {
      const i = versions.length - 1 - ri;
      const isCurrent = i === currentIdx;
      const d = new Date(v.ts);
      const time = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
        d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      return `<div class="vitem${isCurrent ? ' current' : ''}">
        <div class="vitem-meta">
          <div class="vitem-name">v${i + 1} — ${escHtml(v.label)}</div>
          <div class="vitem-time">${time}</div>
        </div>
        <button class="vitem-restore${isCurrent ? ' disabled' : ''}" data-i="${i}">
          ${isCurrent ? 'Current' : 'Restore'}
        </button>
      </div>`;
    }).join('');
    list.querySelectorAll('.vitem-restore:not(.disabled)').forEach(btn => {
      btn.addEventListener('click', () => restore(parseInt(btn.dataset.i)));
    });
  }

  async function restore(i) {
    if (!versions[i]) return;
    applySnapshot(versions[i].snap);
    currentIdx = i;
    await saveVersions();
    updateBadge();
    renderList();
    document.getElementById('vpanel').classList.remove('open');
    showToast(`Restored v${i + 1} — ${versions[i].label}`);
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  document.getElementById('btn-history').addEventListener('click', () => {
    document.getElementById('vpanel').classList.toggle('open');
  });
  document.getElementById('vpanel-close').addEventListener('click', () => {
    document.getElementById('vpanel').classList.remove('open');
  });

  // ── 13b. Todo persistence ─────────────────────────────────────────────────
  function initTodos() {
    if (!data.tabs.find(t => t.id === 'todo')) return;
    const slug = window.location.pathname.split('/').filter(Boolean).slice(-2, -1)[0] || 'script';
    const storeKey = `todo_state_${slug}`;
    let state = {};
    try { const s = localStorage.getItem(storeKey); if (s) state = JSON.parse(s); } catch (e) {}
    const save = () => { try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch (e) {} };

    document.querySelectorAll('.todo-check').forEach(cb => {
      const id = cb.dataset.id;
      if (state[id]) { cb.checked = true; cb.closest('.todo-item').classList.add('done'); }
      cb.addEventListener('change', () => {
        state[id] = cb.checked;
        cb.closest('.todo-item').classList.toggle('done', cb.checked);
        save();
      });
    });
  }

  // ── 13c. Transcript view switching (Script / Short-form / Animations) ────
  // Module-level ref so setActiveTab can call it after tab switch
  let _positionActualIndicator = () => {};

  function initTranscriptViews() {
    const panel = document.querySelector('.tab-content[data-tab="actual-script"]');
    if (!panel) return;

    // Derive slug from URL for localStorage keys
    const slug = window.location.pathname.replace(/\/+$/, '').split('/').filter(Boolean).slice(-1)[0] || 'script';

    // Restore saved animation notes
    panel.querySelectorAll('.transcript-anim-input').forEach(inp => {
      const idx = inp.dataset.cueIdx;
      const stored = localStorage.getItem(`actual-anim:${slug}:${idx}`);
      if (stored) {
        inp.value = stored;
      } else {
        const def = inp.dataset.defaultAnim;
        if (def) inp.value = def;
      }
      inp.addEventListener('input', () => {
        try { localStorage.setItem(`actual-anim:${slug}:${idx}`, inp.value); } catch (e) {}
      });
    });

    // Restore saved view or default to 'script'
    let aview = 'script';
    try { const s = localStorage.getItem(`actual-view:${slug}`); if (s) aview = s; } catch (e) {}

    function positionActualIndicator(v) {
      const indicator = document.getElementById('actual-vtab-indicator');
      const activeBtn = document.querySelector(`.actual-vtab[data-aview="${v}"]`);
      const parent = document.getElementById('actual-view-toggle');
      if (activeBtn && indicator && parent) {
        const parentRect = parent.getBoundingClientRect();
        const btnRect = activeBtn.getBoundingClientRect();
        indicator.style.left = (btnRect.left - parentRect.left - 3) + 'px';
        indicator.style.width = btnRect.width + 'px';
      }
    }
    // Expose so setActiveTab can reposition on tab switch
    _positionActualIndicator = () => positionActualIndicator(aview);

    function setActualView(v, save = true) {
      aview = v;
      document.querySelectorAll('.actual-vtab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.aview === v);
      });
      positionActualIndicator(v);

      // Apply body class so CSS can do the heavy lifting
      document.body.classList.remove('actual-view-script', 'actual-view-shortform', 'actual-view-animations');
      document.body.classList.add(`actual-view-${v}`);

      if (save) {
        try { localStorage.setItem(`actual-view:${slug}`, v); } catch (e) {}
      }
    }

    document.querySelectorAll('.actual-vtab').forEach(btn => {
      btn.addEventListener('click', () => setActualView(btn.dataset.aview));
    });

    // Set initial view (rough pass, then corrected after fonts load)
    setActualView(aview, false);
    // Re-position indicator after fonts settle
    document.fonts.ready.then(() => positionActualIndicator(aview));
  }

  // ── 14. Alt+pointer — highlight on hover, save on click ──────────────────
  (() => {
    let altDown = false;
    let hovered = null;

    const setHighlight = el => {
      if (hovered && hovered !== el) hovered.style.outline = '';
      hovered = el;
      if (el) el.style.outline = '2px solid var(--accent)';
    };

    document.addEventListener('keydown', e => {
      if (e.key === 'Alt') { altDown = true; }
    });
    document.addEventListener('keyup', e => {
      if (e.key === 'Alt') { altDown = false; setHighlight(null); }
    });
    document.addEventListener('mouseover', e => {
      if (altDown) setHighlight(e.target);
    }, true);
    document.addEventListener('click', e => {
      if (!altDown) return;
      e.preventDefault(); e.stopPropagation();
      const el = e.target;
      const data = {
        tagName: el.tagName,
        classes: Array.from(el.classList),
        innerText: el.innerText.slice(0, 2000),
        url: location.href,
        timestamp: new Date().toISOString(),
        position: el.getBoundingClientRect().toJSON(),
      };
      fetch('/save-pointer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(() => showToast('Pointer saved'))
        .catch(() => showToast('Save failed — using node server.js?'));
    }, true);
  })();

  // ── 15. Progress bar ──────────────────────────────────────────────────────
  window.addEventListener('scroll', () => {
    const s = document.documentElement.scrollTop;
    const h = document.documentElement.scrollHeight - window.innerHeight;
    if (h > 0) document.getElementById('progress').style.width = (s / h * 100) + '%';
  });

  // ── 16. Touch overscroll lock in fullscreen ───────────────────────────────
  document.addEventListener('touchmove', (e) => {
    if (!document.fullscreenElement) return;
    if (window.scrollY === 0 && e.touches[0].clientY > 0) e.preventDefault();
  }, { passive: false });

  // ── 16. Helpers ───────────────────────────────────────────────────────────
  function escHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cap(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // ── 17. Boot sequence ─────────────────────────────────────────────────────
  injectMusicCues();
  initTodos();
  initAnimAnnotations();
  initTranscriptViews();
  loadMode(); // rough pass so indicator appears immediately

  await document.fonts.ready;
  await loadMode(); // corrected pass after fonts shift button widths
  await loadTab();
  await loadVersions();

  const currentSnap = snapshot();
  const currentHash = hashSnap(currentSnap);

  let lastHash = null;
  try {
    const r = await window.storage.get(DOC_HASH_KEY);
    if (r) lastHash = r.value;
  } catch (e) {}

  if (lastHash !== currentHash) {
    const v = { label: VERSION_LABEL, ts: Date.now(), snap: currentSnap, scriptVer: SCRIPT_VERSION };
    versions.push(v);
    currentIdx = versions.length - 1;
    await saveVersions();
    try { await window.storage.set(DOC_HASH_KEY, currentHash); } catch (e) {}
    showToast(`Auto-saved v${versions.length} — ${v.label}`);
  }

  updateBadge();
  renderList();

})();
