/* UI controller: role selection, student exam (voice answers), teacher console. */
(() => {
  const $ = (id) => document.getElementById(id);
  const $app = $('app'), $who = $('who'), $side = $('side'), $crumb = $('crumb');
  /* Only a salted SHA-256 hash of the teacher password is stored here, never the password itself.
     To change it: printf 'elp-teacher:NEWPASSWORD' | sha256sum */
  const TEACHER_HASH = '80354c72aca06c115905a010c5aabaadce14a8855233b5d829cb166213ee3129';
  const sha256 = async (t) => { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''); };
  const Q = Evaluator.QUESTIONS, SHORT = ['Introduce yourself', 'Reading passage', 'Best friend', 'Listening', 'College'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (s) => { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const S = { student: null, idx: 0, answers: [], shownAt: 0, plays: 0, rec: null, ticker: null, raf: null,
    teacher: sessionStorage.getItem('elp_teacher'), sel: null, fq: '', fl: 0 };
  const IC = {
    mic: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    board: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 15v-3M12 15V8M17 15v-5"/></svg>',
    stop: '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    check: '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
  };
  const brand = '<div class="logo"><i>' + IC.mic.replace(/26/g, '18') + '</i><div>English Placement<small>Voice assessment console</small></div></div>';

  function head(crumb, who) { $crumb.textContent = crumb; $who.innerHTML = who || ''; }
  function side(inner) { $side.innerHTML = brand + (inner || '') + '<div class="foot">' + esc(Storage.status().label) + '</div>'; }
  function halt() { S.tok = (S.tok || 0) + 1; if (S.ticker) { clearInterval(S.ticker); S.ticker = null; } if (S.raf) { cancelAnimationFrame(S.raf); S.raf = null; } if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  const badge = (l) => `<span class="badge b${l}">Level ${l}</span>`;

  /* ---------- Entry ---------- */
  function viewRole() {
    halt(); head('Start'); side('<div class="nt">Select a role</div>');
    $app.innerHTML = `
      <h1>English speaking assessment <span class="ar" dir="rtl">· اختبار تحديد المستوى</span></h1>
      <p class="lead">Record your spoken answers and your teacher will place you in the right level. Choose your role to continue. <span class="ar" dir="rtl">اختر دورك للمتابعة.</span></p>
      <div class="roles">
        <button class="role" id="r-student"><div class="ic">${IC.mic}</div><strong>Student <span class="ar">· طالب</span></strong><span>Answer 5 questions by voice.</span></button>
        <button class="role" id="r-teacher"><div class="ic">${IC.board}</div><strong>Teacher <span class="ar">· تيتشر</span></strong><span>Listen to answers and review levels.</span></button>
      </div>`;
    $('r-student').onclick = viewStudentInfo;
    $('r-teacher').onclick = () => (S.teacher ? viewDashboard() : viewTeacherLogin());
  }

  /* ---------- Student ---------- */
  function viewStudentInfo() {
    halt(); head('Student check-in', '<button class="btn ghost sm" id="back">Back</button>'); side('<div class="nt">Student</div>');
    $('back').onclick = viewRole;
    $app.innerHTML = `<div class="panel"><h2>Before you start <span class="ar">· قبل أن تبدأ</span></h2>
      <p class="lead">5 spoken questions, about 5 minutes. Allow microphone access and use a quiet place.</p>
      <label for="sn">Full name <span class="ar">· الاسم الكامل</span></label><input id="sn" autocomplete="name" placeholder="e.g. Farha Muhammad">
      <label for="se">Email <span class="ar">· البريد الإلكتروني</span></label><input id="se" type="email" autocomplete="email" placeholder="e.g. Farha Muhammad@example.com">
      <div class="err" id="er" role="alert"></div>
      <div class="row"><button class="btn" id="go">Start exam</button></div></div>`;
    $('go').onclick = () => {
      const name = $('sn').value.trim(), email = $('se').value.trim(), er = $('er');
      if (name.length < 3) { er.textContent = 'Enter your full name.'; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { er.textContent = 'Enter a valid email address.'; return; }
      S.student = { name, email }; S.idx = 0; S.answers = []; viewQuestion();
    };
  }

  function steps(i) {
    side('<div class="nt">Exam progress</div>' + Q.map((q, k) => `<div class="step ${k < i ? 'done' : k === i ? 'cur' : ''}"><b>${k < i ? '✓' : k + 1}</b><span>${SHORT[k]}</span></div>`).join(''));
  }

  function drawWave() {
    const c = $('wave'); if (!c) return;
    const w = c.width = c.clientWidth * (window.devicePixelRatio || 1), h = c.height = c.clientHeight * (window.devicePixelRatio || 1), g = c.getContext('2d');
    const d = Voice.levels(), n = 32, bw = w / n; g.clearRect(0, 0, w, h);
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(S.rec && !S.rec.done ? '--rec' : '--idle');
    for (let i = 0; i < n; i++) {
      const v = d ? d[i] / 255 : 0, bh = Math.max(4, v * h);
      g.fillRect(i * bw + 2, (h - bh) / 2, bw - 4, bh);
    }
    S.raf = requestAnimationFrame(drawWave);
  }

  function viewQuestion() {
    halt();
    const q = Q[S.idx]; S.shownAt = performance.now(); S.plays = 0; S.rec = null;
    head('Question ' + q.id + ' of 5', '<span>' + esc(S.student.name) + '</span>'); steps(S.idx);
    let extra = '';
    if (q.type === 'read') {
      const T = Evaluator.TARGETS; let p = esc(Evaluator.PASSAGE);
      const mark = (list, cls) => list.forEach(w => { p = p.replace(new RegExp('\\b' + w + '\\b', 'g'), '<mark class="' + cls + '">' + w + '</mark>'); });
      mark(T.silent, 'k-s'); mark(T.long, 'k-l'); mark(T.short, 'k-h');
      extra = `<p class="small">Read the passage aloud, clearly and at a natural speed.</p><div class="passage">${p}</div>
        <div class="legend"><span><mark class="k-s">silent letter</mark></span><span><mark class="k-l">long vowel</mark></span><span><mark class="k-h">short vowel</mark></span></div>`;
    }
    if (q.type === 'listen') {
      extra = `<p class="small">Listen to the short audio (up to 2 times), then answer by voice.</p><div class="bigq">Who does Sara visit on Saturday?</div>
        <div class="row"><button class="btn" id="play">Play listening audio</button><span id="pstat" class="pill">Played 0 / 2</span></div>`;
    }
    $app.innerHTML = `<div class="panel">
      <div class="dots">${Q.map((_, k) => '<i class="' + (k < S.idx ? 'done' : k === S.idx ? 'cur' : '') + '"></i>').join('')}</div>
      <span class="pill">Question ${q.id} / 5</span>
      <h2 style="margin-top:10px">${esc(q.title)}</h2>${extra}
      <div class="recorder">
        <button class="rb" id="rec" aria-label="Start recording"${q.type === 'listen' ? ' disabled' : ''}>${IC.mic}</button>
        <div class="rec-info"><div class="timer" id="tm">0:00</div><div class="small" id="rs">${q.type === 'listen' ? 'Play the audio first, then record your answer.' : 'Press the red button and start speaking.'}</div><canvas id="wave"></canvas></div>
      </div>
      <div id="fb"></div>
      <div class="row"><button class="btn" id="next" disabled>${S.idx === 4 ? 'Finish exam' : 'Next question'}</button></div></div>`;
    const btn = $('rec'), tm = $('tm'), rs = $('rs'), next = $('next');
    const typedOk = () => { const t = $('tx'); return !!(t && t.value.trim()); };
    const refresh = () => { next.disabled = !((S.rec && S.rec.done) || typedOk()); };
    const fallback = (msg) => {
      $('fb').innerHTML = `<div class="hint">${msg}</div><label for="tx">Type your answer instead</label><textarea id="tx"></textarea>`;
      $('tx').oninput = refresh;
    };
    if (!Voice.recordingSupported) { btn.disabled = true; fallback('Microphone recording is not available in this browser. Type your answer to continue.'); }
    drawWave();

    if (q.type === 'listen') {
      const play = $('play'), ps = $('pstat');
      play.onclick = () => {
        if (S.plays >= 2) return;
        S.plays++; play.disabled = true; btn.disabled = !Voice.recordingSupported; ps.textContent = 'Playing… ' + S.plays + ' / 2';
        const ok = Voice.speak(Evaluator.LISTEN_TEXT, (done) => { ps.textContent = (done ? 'Played ' : 'Audio unavailable · ') + S.plays + ' / 2'; play.disabled = S.plays >= 2; });
        if (!ok) { ps.textContent = 'Audio playback unsupported'; fallback('Playback is not supported here. Text: ' + esc(Evaluator.LISTEN_TEXT)); play.disabled = false; }
      };
    }

    btn.onclick = async () => {
      if (S.rec && !S.rec.done) {
        halt(); btn.disabled = true; rs.textContent = 'Saving…';
        const r = await Voice.stop();
        S.rec = { done: true, duration: r.duration, audio: r.audio, think: S.rec.think, transcript: r.transcript };
        tm.textContent = fmt(r.duration); btn.className = 'rb'; btn.innerHTML = IC.mic; btn.disabled = false;
        rs.textContent = 'Answer recorded. Press the button to record again, or continue.'; refresh(); drawWave(); return;
      }
      rs.textContent = '';
      try {
        const think = (performance.now() - S.shownAt) / 1000;
        await Voice.start(() => {});
        S.rec = { t0: performance.now(), think }; btn.className = 'rb on'; btn.innerHTML = IC.stop; next.disabled = true;
        rs.textContent = 'Recording… press stop when you finish.';
        S.ticker = setInterval(() => { tm.textContent = fmt((performance.now() - S.rec.t0) / 1000); }, 250);
        if (!S.raf) drawWave();
      } catch (e) { S.rec = null; rs.textContent = 'Microphone blocked.'; fallback('Allow microphone access in your browser, or type your answer below.'); }
    };

    next.onclick = () => {
      if (S.rec && !S.rec.done) { rs.textContent = 'Stop recording first.'; return; }
      if (S.idx === 4 && !confirm('Submit your exam? You cannot change your answers after this.')) return;
      const recorded = !!(S.rec && S.rec.done), typed = $('tx') ? $('tx').value.trim() : '';
      const text = recorded ? (S.rec.transcript || typed) : typed;
      const nWords = (text.match(/[A-Za-z']+/g) || []).length;
      S.answers.push({ qid: q.id, transcript: text, recorded, plays: S.plays,
        duration: recorded ? S.rec.duration : Math.max(2, nWords / 2.5),
        thinking: recorded ? S.rec.think : (performance.now() - S.shownAt) / 1000,
        audio: recorded ? S.rec.audio : null });
      if (S.idx < 4) { S.idx++; viewQuestion(); } else submit();
    };
  }

  async function submit() {
    halt();
    const attempt = { id: 'a' + Date.now(), date: new Date().toISOString(), student: S.student, answers: S.answers,
      result: Evaluator.evaluate(S.answers), needsReview: S.answers.some(a => !a.transcript) };
    head('Submitting'); side('<div class="nt">Submitting</div>');
    $app.innerHTML = '<div class="panel center"><h2>Submitting…</h2><p class="small">Saving your answers.</p></div>';
    const ok = (await Storage.save(attempt)).ok;
    head('Submitted'); side('<div class="nt">Exam complete</div>');
    /* Students see ONLY this screen: no level, score or breakdown. */
    $app.innerHTML = `<div class="panel center"><div class="done-ic">${IC.check}</div><h1>Thank you!</h1>
      <p class="lead" style="margin:0 auto 12px">${ok ? 'Thank you for completing the assessment. Your responses have been submitted to your teacher.' : 'Your responses could not be saved on this device. Please tell your teacher.'}</p>
      <p class="ar" dir="rtl">شكراً لإكمالك الاختبار. تم إرسال إجاباتك إلى المعلم.</p>
      <div class="row" style="justify-content:center"><button class="btn" id="home">Back to start</button></div></div>`;
    S.student = null; S.answers = []; $('home').onclick = viewRole;
  }

  /* ---------- Teacher ---------- */
  function viewTeacherLogin() {
    halt(); head('Teacher login', '<button class="btn ghost sm" id="back">Back</button>'); side('<div class="nt">Teacher</div>');
    $('back').onclick = viewRole;
    $app.innerHTML = `<div class="panel" style="max-width:460px"><h2>Teacher login <span class="ar">· دخول المعلم</span></h2>
      <label for="tn">Teacher name</label><input id="tn" autocomplete="username">
      <label for="tp">Password</label><input id="tp" type="password" autocomplete="current-password">
      <div class="err" id="er" role="alert"></div>
      <div class="row"><button class="btn" id="li">Log in</button></div></div>`;
    const go = async () => {
      const n = $('tn').value.trim(), p = $('tp').value, er = $('er');
      if (!n) { er.textContent = 'Enter your name.'; return; }
      if (!window.crypto || !crypto.subtle) { er.textContent = 'Login needs localhost or HTTPS.'; return; }
      if ((await sha256('elp-teacher:' + p)) !== TEACHER_HASH) { er.textContent = 'Incorrect name or password.'; return; }
      S.teacher = n; sessionStorage.setItem('elp_teacher', n); viewDashboard();
    };
    $('li').onclick = go; $('tp').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }

  const bar = (v) => `<span class="mb"><i style="width:${v}%"></i></span>`;

  async function exportCsv() {
    const list = S.list || await Storage.all();
    const h = ['Name', 'Email', 'Date', 'Level', 'Overall', 'Avg speaking s', 'Total speaking s', 'Time', 'Grammar', 'Vocabulary', 'Task'];
    const rows = list.map(a => [a.student.name, a.student.email, a.date, a.result.level, a.result.overall, a.result.avgTime, a.result.totalTime, a.result.time, a.result.grammar, a.result.vocab, a.result.task]);
    const csv = [h].concat(rows).map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    const l = document.createElement('a'); l.href = url; l.download = 'placement-results.csv'; l.click(); URL.revokeObjectURL(url);
  }

  function detail(a) {
    const r = a.result, nm = Evaluator.LEVEL_NAMES[r.level].split(' · ');
    const rows = Q.map((q, i) => {
      const x = a.answers[i], p = r.per[i];
      const au = x.audio
        ? `<audio controls src="${x.audio}"></audio><div class="row" style="margin:4px 0 8px"><button class="btn ghost sm" data-conv="${i}">Convert voice to text</button><span class="small" id="cs${i}"></span></div>`
        : `<div class="small">${x.hasAudio ? 'Audio could not be loaded right now. Press Refresh to retry.' : x.audioTooLarge ? 'Recording was too large to sync to the cloud.' : x.recorded ? 'Audio not stored (browser storage full).' : 'No audio: typed answer.'}</div>`;
      return `<div class="qa"><b>Q${q.id}. ${esc(q.title)}</b>${au}
        <label for="t${i}" class="small">Transcript (auto-generated, editable)</label><textarea id="t${i}">${esc(x.transcript)}</textarea>
        <div class="small">Speaking ${x.duration.toFixed(1)}s · thinking ${x.thinking.toFixed(1)}s · ${p.words} words${q.type === 'listen' ? ' · audio plays ' + x.plays : ''}<br>
          Time ${p.time} · ${q.type === 'read' ? 'Reading accuracy' : 'Grammar'} ${p.grammar} · ${q.type === 'read' ? 'Target words' : 'Vocabulary'} ${p.vocab} · Task ${p.task} · <b>Score ${p.score}</b></div>
        <ul class="why small">${p.notes.map(n => '<li>' + esc(n) + '</li>').join('')}</ul></div>`;
    }).join('');
    const m = (label, v, suf) => `<div class="metric"><span class="small">${label}</span><br><b>${v}${suf || ''}</b>${suf ? '' : bar(v)}</div>`;
    return `<div class="panel" id="detail">${S.flash ? '<div class="hint" role="status" style="margin:0 0 14px">' + esc(S.flash) + '</div>' : ''}<h2>${esc(a.student.name)} ${badge(r.level)}${a.needsReview ? '<span class="rv">Needs review</span>' : ''}</h2>
      <div class="small">${esc(a.student.email)} · ${new Date(a.date).toLocaleString()} · ${esc(nm[1])}</div>
      <div class="metrics">${m('Overall /100', r.overall)}${m('Time score', r.time)}${m('Grammar score', r.grammar)}${m('Vocabulary score', r.vocab)}${m('Task completion', r.task)}${m('Avg speaking time', r.avgTime, 's')}${m('Total speaking time', fmt(r.totalTime), '')}</div>
      <h3>How the level was decided</h3><ul class="why">${r.why.map(w => '<li>' + esc(w) + '</li>').join('')}</ul>
      <p class="small">Per question: score = 25% response time + 30% grammar + 25% vocabulary + 20% task completion (keyword relevance on open questions, target words on Q2, comprehension on Q4). Time score = speaking seconds ÷ expected seconds (Q1 20, Q2 15, Q3 15, Q4 8, Q5 20), capped at 100. If the auto transcript missed words, listen to the audio, correct the text and re-evaluate.</p>
      ${rows}
      <div class="row"><button class="btn" id="reeval">Save transcripts &amp; re-evaluate</button><button class="btn ghost" id="del">Delete attempt</button></div></div>`;
  }

  function renderList() {
    const q = S.fq.toLowerCase();
    const list = S.list.filter(a => (!S.fl || a.result.level === S.fl) && (a.student.name + ' ' + a.student.email).toLowerCase().includes(q));
    $('list').innerHTML = list.length ? `<table><thead><tr><th>Student</th><th>Email</th><th>Date</th><th>Avg time</th><th>Scores</th><th>Level</th><th></th></tr></thead><tbody>
      ${list.map(a => `<tr class="${a.id === S.sel ? 'sel' : ''}"><td>${esc(a.student.name)}${a.needsReview ? '<span class="rv">Review</span>' : ''}</td><td>${esc(a.student.email)}</td><td class="n">${new Date(a.date).toLocaleDateString()}</td>
        <td class="n">${a.result.avgTime}s</td>
        <td><div class="mini"><div><span>T</span>${bar(a.result.time)}</div><div><span>G</span>${bar(a.result.grammar)}</div><div><span>V</span>${bar(a.result.vocab)}</div></div></td>
        <td>${badge(a.result.level)}</td><td><button class="btn ghost sm" data-id="${a.id}">Open</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="small">No attempts match. Ask a student to take the exam, or clear the filters.</p>';
    $('list').querySelectorAll('button[data-id]').forEach(b => b.onclick = () => { S.sel = b.dataset.id; S.scroll = true; viewDashboard(false); });
  }

  async function viewDashboard(fresh) {
    if (fresh === undefined) fresh = true;
    halt(); const tok = S.tok;
    head('Teacher dashboard', '<span>' + esc(S.teacher) + '</span>');
    side('<div class="nt">Teacher</div><button class="nav on" id="n-dash">Results</button><button class="nav" id="n-csv">Export CSV</button><button class="nav" id="out">Log out</button>');
    $('n-dash').onclick = () => viewDashboard(true); $('n-csv').onclick = exportCsv;
    $('out').onclick = () => { S.teacher = null; S.sel = null; S.list = null; sessionStorage.removeItem('elp_teacher'); viewRole(); };
    if (fresh || !S.list) {
      $app.innerHTML = '<div class="panel"><p class="small">Loading submissions…</p></div>';
      S.list = await Storage.all(); if (tok !== S.tok) return;
    }
    const cur = S.list.find(a => a.id === S.sel);
    if (cur) { await Storage.hydrateAudio(cur); if (tok !== S.tok) return; }
    const st = Storage.status(), all = S.list, c = [1, 2, 3].map(l => all.filter(a => a.result.level === l).length);
    const avg = all.length ? Math.round(all.reduce((s, a) => s + a.result.avgTime, 0) / all.length) : 0;
    const note = st.mode === 'cloud' ? ''
      : st.mode === 'local' ? '<div class="hint" style="margin:0 0 16px"><b>Local demo mode:</b> submissions are stored in this browser only. Add your Firebase keys in <code>js/firebase-config.js</code> to sync across devices.</div>'
      : '<div class="hint" style="margin:0 0 16px"><b>Local fallback mode:</b> Firestore is unreachable, so you are seeing the data cached on this device' + (st.pending ? ' (' + st.pending + ' submission(s) waiting to sync)' : '') + '. ' + (st.error ? 'Last error: ' + esc(st.error) + (/permission/i.test(st.error) ? ' (check the Firestore rules in the README)' : '') + '. ' : '') + 'Press Refresh to retry.</div>';
    $app.innerHTML = `${note}<div class="kpis">
      <div class="kpi"><b>${all.length}</b><span>Students</span></div>
      <div class="kpi k1"><b>${c[0]}</b><span>Level 1</span></div><div class="kpi k2"><b>${c[1]}</b><span>Level 2</span></div><div class="kpi k3"><b>${c[2]}</b><span>Level 3</span></div>
      <div class="kpi"><b>${avg}s</b><span>Avg speaking time</span></div></div>
      <div class="panel"><div class="toolbar"><input id="fq" placeholder="Search name or email" value="${esc(S.fq)}" aria-label="Search">
        <select id="fl" aria-label="Filter by level"><option value="0">All levels</option><option value="1">Level 1</option><option value="2">Level 2</option><option value="3">Level 3</option></select>
        <button class="btn ghost" id="rf">Refresh</button><button class="btn ghost" id="csv2">Export CSV</button></div><div class="tw" id="list"></div></div>
      ${cur ? detail(cur) : ''}
      ${all.length ? '<div class="row"><button class="btn ghost sm" id="clr">Delete all attempts</button></div>' : ''}`;
    $('fl').value = String(S.fl); S.flash = '';
    $('fq').oninput = (e) => { S.fq = e.target.value; renderList(); };
    $('fl').onchange = (e) => { S.fl = +e.target.value; renderList(); };
    $('rf').onclick = () => viewDashboard(true); $('csv2').onclick = exportCsv; renderList();
    if (cur) {
      $('reeval').onclick = async () => {
        cur.answers.forEach((a, i) => { a.transcript = $('t' + i).value.trim(); });
        cur.result = Evaluator.evaluate(cur.answers); cur.needsReview = cur.answers.some(a => !a.transcript);
        const r = await Storage.update(cur);
        S.flash = 'Saved. Level updated to Level ' + cur.result.level + ' (overall ' + cur.result.overall + '/100).' + (Storage.configured && !r.cloud ? ' Cloud sync is pending.' : '');
        S.scroll = true; viewDashboard(false);
      };
      $app.querySelectorAll('button[data-conv]').forEach(b => b.onclick = async () => {
        const i = +b.dataset.conv, s = $('cs' + i), a = cur.answers[i];
        if (!a.audio) { s.textContent = 'No saved audio for this answer.'; return; }
        b.disabled = true; s.textContent = 'Converting… the recording will play, keep the room quiet.';
        try {
          const t = await Voice.transcribeAudio(a.audio);
          if (t) { $('t' + i).value = t; s.textContent = 'Done. Check the text, then press "Save transcripts & re-evaluate".'; }
          else s.textContent = 'No speech was detected. Type the transcript manually.';
        } catch (e) { s.textContent = e.message; }
        b.disabled = false;
      });
      $('del').onclick = async () => {
        if (!confirm('Delete this attempt?')) return;
        const ok = await Storage.remove(S.sel); S.list = S.list.filter(a => a.id !== S.sel); S.sel = null;
        S.flash = ''; await viewDashboard(false);
        if (!ok) alert('Deleted locally, but the cloud copy could not be removed. Try again when online.');
      };
    }
    const clr = $('clr');
    if (clr) clr.onclick = async () => {
      if (!confirm('Delete ALL attempts' + (st.mode === 'cloud' ? ' from the cloud and this device' : '') + '?')) return;
      await Storage.clear(); S.list = []; S.sel = null; viewDashboard(false);
    };
    if (S.scroll) { S.scroll = false; const d = $('detail'); if (d) d.scrollIntoView({ behavior: 'smooth' }); }
  }

  /* ---------- Theme (light / dark) ---------- */
  const root = document.documentElement, tb = $('theme');
  const SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  const paintTheme = () => { const d = root.dataset.theme === 'dark'; tb.innerHTML = d ? SUN : MOON; tb.title = d ? 'Switch to light mode' : 'Switch to dark mode'; tb.setAttribute('aria-label', tb.title); };
  tb.onclick = () => { root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('elp_theme', root.dataset.theme); } catch (e) {} paintTheme(); };
  paintTheme();

  /* Sync status badge (Cloud Sync active / Cloud offline / Local demo mode) */
  const syncEl = $('sync');
  const paintSync = (st) => {
    syncEl.textContent = st.label + (st.pending ? ' · ' + st.pending + ' pending' : '');
    syncEl.className = 'sync ' + (st.mode === 'cloud' ? 'cloud' : st.mode === 'offline' ? 'offline' : 'local');
    syncEl.title = st.mode === 'cloud' ? 'Submissions are synced to Firebase Firestore.' : st.mode === 'offline' ? 'Firestore could not be reached. Data is cached on this device and will sync when the connection returns.' : 'Firebase keys are not set. Data stays in this browser only.';
  };
  Storage.onStatus(paintSync); paintSync(Storage.status());

  viewRole();
})();
