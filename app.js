/* =========================
   消費税法 暗記アプリ（修正版）
   - カテゴリ複数対応
   - 重み関数：シンプル方式のみ
   - A：解答確認トグル（再タップで隠す）、×は5問後再出題
   - B：選択→マスク / 繰り返し / 保存
   - C：一覧→編集（再マスク）、JSON入出力
   - D：積み上げ棒グラフ（+3のみ/+5のみ/+10）
   ========================= */

(() => {
  // ======= ストレージ鍵
  const LS_KEYS = {
    PROBLEMS: 'problems_v1',
    APPSTATE: 'app_state_v1',
    DAILYSTATS: 'daily_stats_v1',
    DAILYTHRESH: 'daily_thresholds_v1',
  };

  // ======= 状態
  /** @type {Array<Problem>} */
  let problems = loadJSON(LS_KEYS.PROBLEMS, []);
  /** @type {AppState} */
  let appState = loadJSON(LS_KEYS.APPSTATE, {
    recentQueue: [],
    forcedQueue: [], // {id, delay}
    lastPastedHTML: "",
  });
  /** 日別正答/回答 */
  let dailyStats = loadJSON(LS_KEYS.DAILYSTATS, {}); // { [dateKey]: {correct, total} }
  /** 日別しきい値到達数（グラフ） */
  let dailyThresholds = loadJSON(LS_KEYS.DAILYTHRESH, {}); // { [dateKey]: {ge3, ge5, ge10} }

  // ======= DOM 参照
  const tabButtons = document.querySelectorAll('.tab-btn');
  const pages = document.querySelectorAll('.page');

  // A
  const startAllBtn = document.getElementById('startAllBtn');
  const startByCatBtn = document.getElementById('startByCatBtn');
  const questionContainer = document.getElementById('questionContainer');
  const revealBtn = document.getElementById('revealBtn');
  const judgeBtns = document.getElementById('judgeBtns');

  // B
  const editor = document.getElementById('editor');
  const maskBtn = document.getElementById('maskBtn');
  const unmaskAllBtn = document.getElementById('unmaskAllBtn');
  const repeatBtn = document.getElementById('repeatBtn');
  const clearDraftBtn = document.getElementById('clearDraftBtn');
  const catInput = document.getElementById('catInput');
  const saveProblemBtn = document.getElementById('saveProblemBtn');

  // C
  const problemList = document.getElementById('problemList');
  const catChips = document.getElementById('catChips');
  const clearCatFilterBtn = document.getElementById('clearCatFilterBtn');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const importJsonInput = document.getElementById('importJsonInput');

  // D
  const progressCanvas = document.getElementById('progressChart');
  const dailyList = document.getElementById('dailyList');
  let progressChart = null;

  // モーダル
  const catModal = document.getElementById('catModal');
  const catModalBody = document.getElementById('catModalBody');
  const catModalCancel = document.getElementById('catModalCancel');
  const catModalStart = document.getElementById('catModalStart');

  const editModal = document.getElementById('editModal');
  const editEditor = document.getElementById('editEditor');
  const editCatInput = document.getElementById('editCatInput');
  const editMaskBtn = document.getElementById('editMaskBtn');
  const editUnmaskAllBtn = document.getElementById('editUnmaskAllBtn');
  const editCancelBtn = document.getElementById('editCancelBtn');
  const editSaveBtn = document.getElementById('editSaveBtn');
  const editMeta = document.getElementById('editMeta');

  // ======= ユーティリティ
  function saveAll() {
    saveJSON(LS_KEYS.PROBLEMS, problems);
    saveJSON(LS_KEYS.APPSTATE, appState);
    saveJSON(LS_KEYS.DAILYSTATS, dailyStats);
    saveJSON(LS_KEYS.DAILYTHRESH, dailyThresholds);
  }
  function loadJSON(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  }
  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  function uuid() {
    return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function todayKey() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${yyyy}${mm}${dd}`;
  }
  function clamp(n, min, max){ return Math.min(max, Math.max(min, n)); }

  // テキストの冒頭1文（句点 or 改行または先頭100文字）
  function firstSentenceFromHTML(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    const t = (div.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) return '(空)';
    const dot = t.indexOf('。');
    if (dot >= 0) return t.slice(0, Math.min(dot+1, 120));
    return t.slice(0, 100) + (t.length > 100 ? '…' : '');
  }

  function parseCategories(inputStr){
    return inputStr
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  function extractAnswersFrom(el) {
    // el: HTMLElement（editorなど）
    return Array.from(el.querySelectorAll('.mask'))
      .map(e => (e.textContent || '').trim())
      .filter(Boolean);
  }

  function unmaskAllIn(el) {
    el.querySelectorAll('.mask').forEach(m => {
      // span.mask をその中身のテキストノードに戻す
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    });
  }

  function toggleMaskSelection(rootEditable) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!rootEditable.contains(range.commonAncestorContainer)) return;
    if (range.collapsed) return;

    // 既にmask内なら解除
    let anc = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    const inMask = anc && anc.closest('.mask');

    if (inMask) {
      const target = inMask;
      const parent = target.parentNode;
      while (target.firstChild) parent.insertBefore(target.firstChild, target);
      parent.removeChild(target);
      return;
    }

    // span.mask で囲む（フォールバック付き）
    const span = document.createElement('span');
    span.className = 'mask';
    try {
      range.surroundContents(span);
    } catch {
      const frag = range.extractContents();
      const wrap = document.createElement('span');
      wrap.className = 'mask';
      wrap.appendChild(frag);
      range.insertNode(wrap);
    }
  }

  // ======= タブ切替
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-target');
      pages.forEach(p => p.classList.remove('show'));
      document.querySelector(target).classList.add('show');

      if (target === '#tab-c') renderC();
      if (target === '#tab-d') renderD();
    });
  });

  /* ======================
     B: 問題作成
     ====================== */

  // ペースト検知 → 直前ペースト更新（繰り返し用）
  editor.addEventListener('paste', () => {
    setTimeout(() => {
      appState.lastPastedHTML = editor.innerHTML;
      saveAll();
    }, 0);
  });

  maskBtn.addEventListener('click', () => toggleMaskSelection(editor));
  unmaskAllBtn.addEventListener('click', () => unmaskAllIn(editor));
  repeatBtn.addEventListener('click', () => {
    if (appState.lastPastedHTML) {
      editor.innerHTML = appState.lastPastedHTML;
    }
  });
  clearDraftBtn.addEventListener('click', () => {
    editor.innerHTML = '';
    catInput.value = '';
  });

  saveProblemBtn.addEventListener('click', () => {
    const html = editor.innerHTML.trim();
    if (!html) { alert('長文を入力してください。'); return; }

    const answers = extractAnswersFrom(editor);
    if (answers.length === 0) {
      if (!confirm('マスクがありません。保存しますか？')) return;
    }
    const categories = parseCategories(catInput.value);
    const now = Date.now();
    problems.push({
      id: uuid(),
      html,
      answers,
      categories,
      score: 0,
      answerCount: 0,
      correctCount: 0,
      createdAt: now,
      updatedAt: now
    });
    saveAll();
    editor.innerHTML = '';
    catInput.value = '';
    alert('保存しました。（Cタブに反映）');
  });

  /* ======================
     C: 編集・確認
     ====================== */
  let currentCatFilter = []; // 選択カテゴリ

  function renderC(){
    renderCategoryChips();
    renderProblemList();
  }

  function renderCategoryChips(){
    const allCats = new Set();
    problems.forEach(p => (p.categories || []).forEach(c => allCats.add(c)));
    const cats = Array.from(allCats).sort((a,b) => a.localeCompare(b, 'ja'));

    catChips.innerHTML = '';
    cats.forEach(cat => {
      const label = document.createElement('label');
      label.className = 'chip';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = cat;
      cb.checked = currentCatFilter.includes(cat);
      cb.addEventListener('change', () => {
        if (cb.checked) currentCatFilter.push(cat);
        else currentCatFilter = currentCatFilter.filter(c => c !== cat);
        renderProblemList();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(cat));
      catChips.appendChild(label);
    });
  }

  document.getElementById('clearCatFilterBtn').addEventListener('click', () => {
    currentCatFilter = [];
    renderCategoryChips();
    renderProblemList();
  });

  function problemMatchesFilter(p){
    if (currentCatFilter.length === 0) return true;
    if (!p.categories || p.categories.length === 0) return false;
    return p.categories.some(c => currentCatFilter.includes(c));
  }

  function renderProblemList(){
    problemList.innerHTML = '';
    const filtered = problems.filter(problemMatchesFilter);

    filtered.forEach((p) => {
      const div = document.createElement('div');
      div.className = 'problem-item';

      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = `No.${problems.indexOf(p)+1}　${firstSentenceFromHTML(p.html)}`;
      div.appendChild(title);

      const sub = document.createElement('div');
      sub.className = 'item-sub';
      const s1 = document.createElement('span');
      s1.textContent = `スコア: ${p.score.toFixed(1)}`;
      const s2 = document.createElement('span');
      s2.textContent = `正答/回答: ${p.correctCount}/${p.answerCount}`;
      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn';
      btnEdit.textContent = '編集';
      btnEdit.addEventListener('click', () => openEditModal(p.id));
      const btnDel = document.createElement('button');
      btnDel.className = 'btn';
      btnDel.textContent = '削除';
      btnDel.addEventListener('click', () => {
        if (!confirm('この問題を削除しますか？')) return;
        problems = problems.filter(x => x.id !== p.id);
        saveAll();
        renderC();
      });

      sub.appendChild(s1);
      sub.appendChild(s2);
      sub.appendChild(btnEdit);
      sub.appendChild(btnDel);
      div.appendChild(sub);

      problemList.appendChild(div);
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = '該当する問題がありません。';
      problemList.appendChild(empty);
    }
  }

  // JSON エクスポート/インポート
  exportJsonBtn.addEventListener('click', () => {
    const payload = { problems, dailyStats, dailyThresholds };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    a.href = url;
    a.download = `anki_export_${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  importJsonInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (Array.isArray(data.problems)) {
        const map = new Map(problems.map(p => [p.id, p]));
        data.problems.forEach(p => map.set(p.id, p));
        problems = Array.from(map.values());
      }
      if (data.dailyStats && typeof data.dailyStats === 'object') {
        dailyStats = {...dailyStats, ...data.dailyStats};
      }
      if (data.dailyThresholds && typeof data.dailyThresholds === 'object') {
        dailyThresholds = {...dailyThresholds, ...data.dailyThresholds};
      }
      saveAll();
      renderC();
      alert('インポートしました。');
    } catch (err) {
      console.error(err);
      alert('JSONの読み込みに失敗しました。フォーマットをご確認ください。');
    } finally {
      importJsonInput.value = '';
    }
  });

  // ====== C 詳細編集モーダル（安定化）
  let editingId = null;

  function openEditModal(id){
    const p = problems.find(x => x.id === id);
    if (!p) return;
    editingId = id;
    editEditor.innerHTML = p.html;
    editCatInput.value = (p.categories || []).join(', ');
    editMeta.textContent = `No.${problems.indexOf(p)+1} / 正答: ${p.correctCount} / 回答: ${p.answerCount} / スコア: ${p.score.toFixed(1)}`;

    // モーダル表示
    editModal.classList.remove('hidden');
    editModal.setAttribute('aria-hidden', 'false');
  }
  function closeEditModal(){
    editingId = null;
    editModal.classList.add('hidden');
    editModal.setAttribute('aria-hidden', 'true');
    editEditor.innerHTML = '';
  }

  editMaskBtn.addEventListener('click', () => toggleMaskSelection(editEditor));
  editUnmaskAllBtn.addEventListener('click', () => unmaskAllIn(editEditor));
  editCancelBtn.addEventListener('click', () => closeEditModal());
  editSaveBtn.addEventListener('click', () => {
    const p = problems.find(x => x.id === editingId);
    if (!p) return;
    p.html = editEditor.innerHTML.trim();
    p.answers = extractAnswersFrom(editEditor);
    p.categories = parseCategories(editCatInput.value);
    p.updatedAt = Date.now();
    saveAll();
    closeEditModal();
    renderC();
  });

  /* ======================
     A: 出題・採点
     ====================== */
  let currentPool = [];   // 出題対象のID配列
  let currentId = null;   // 現在出題中のID
  let isRevealed = false; // 解答表示状態

  startAllBtn.addEventListener('click', () => {
    startSession(null);
  });

  startByCatBtn.addEventListener('click', () => {
    openCatModal();
  });

  // カテゴリ選択モーダル（安定化）
  function openCatModal(){
    catModalBody.innerHTML = '';
    const allCats = new Set();
    problems.forEach(p => (p.categories || []).forEach(c => allCats.add(c)));
    const cats = Array.from(allCats).sort((a,b)=>a.localeCompare(b,'ja'));

    if (cats.length === 0) {
      const div = document.createElement('div');
      div.className = 'muted';
      div.textContent = 'カテゴリがありません。まずはBタブで作成してください。';
      catModalBody.appendChild(div);
    } else {
      cats.forEach(cat => {
        const label = document.createElement('label');
        label.className = 'chip';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = cat;
        label.appendChild(cb);
        label.appendChild(document.createTextNode(cat));
        catModalBody.appendChild(label);
      });
    }
    catModal.classList.remove('hidden');
    catModal.setAttribute('aria-hidden', 'false');
  }
  function closeCatModal(){
    catModal.classList.add('hidden');
    catModal.setAttribute('aria-hidden', 'true');
  }
  catModalCancel.addEventListener('click', () => closeCatModal());
  catModalStart.addEventListener('click', () => {
    const checks = catModalBody.querySelectorAll('input[type=checkbox]:checked');
    const selected = Array.from(checks).map(c => c.value);
    closeCatModal();
    if (selected.length === 0) { alert('カテゴリを1つ以上選択してください。'); return; }
    startSession(selected);
  });

  function startSession(categories /* null | string[] */){
    // プール作成
    let ids = problems
      .filter(p => (categories ? (p.categories || []).some(c => categories.includes(c)) : true))
      .map(p => p.id);

    if (ids.length === 0) { alert('出題できる問題がありません。Bタブで作成してください。'); return; }

    currentPool = ids;
    currentId = null;
    appState.recentQueue = []; // 新規セッションで直近履歴リセット

    setReveal(false); // 初期は隠す
    renderQuestion(nextQuestionId());
  }

  function setReveal(show){
    isRevealed = show;
    if (show) {
      revealBtn.textContent = '解答を隠す';
      judgeBtns.classList.remove('hidden');
      questionContainer.querySelectorAll('.mask').forEach(m => m.classList.add('revealed'));
    } else {
      revealBtn.textContent = '解答確認';
      judgeBtns.classList.add('hidden');
      questionContainer.querySelectorAll('.mask').forEach(m => m.classList.remove('revealed'));
    }
  }

  // トグル化（再タップで隠す）
  revealBtn.addEventListener('click', () => setReveal(!isRevealed));

  judgeBtns.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mark]');
    if (!btn) return;
    const mark = btn.getAttribute('data-mark'); // 'o' | 'd' | 'x'
    gradeCurrent(mark);
  });

  function renderQuestion(id){
    const p = problems.find(x => x.id === id);
    if (!p) return;
    currentId = id;
    questionContainer.innerHTML = p.html || '<div class="placeholder">本文なし</div>';
    questionContainer.scrollTop = 0;
    setReveal(false); // 問題切替時は常に隠す
  }

  // シンプル重み： weight = 1 / (1 + max(0, score))
  function weightOf(p){
    return 1 / (1 + Math.max(0, p.score));
  }

  function nextQuestionId(){
    // 強制再出題 delay 前進
    appState.forcedQueue.forEach(item => item.delay--);
    const readyIdx = appState.forcedQueue.findIndex(item => item.delay <= 0);
    if (readyIdx >= 0) {
      const ready = appState.forcedQueue.splice(readyIdx, 1)[0];
      if (currentPool.includes(ready.id)) {
        appState.recentQueue.push(ready.id);
        appState.recentQueue = appState.recentQueue.slice(-5);
        saveAll();
        return ready.id;
      }
    }

    const recent = new Set(appState.recentQueue);
    const candidates = currentPool.filter(id => !recent.has(id));
    const cand = candidates.length ? candidates : currentPool;

    const items = cand.map(id => {
      const p = problems.find(x => x.id === id);
      return { id, w: weightOf(p) };
    });
    const total = items.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    for (const it of items) {
      if ((r -= it.w) <= 0) {
        appState.recentQueue.push(it.id);
        appState.recentQueue = appState.recentQueue.slice(-5);
        saveAll();
        return it.id;
      }
    }
    const fallback = items[0]?.id ?? currentPool[0];
    appState.recentQueue.push(fallback);
    appState.recentQueue = appState.recentQueue.slice(-5);
    saveAll();
    return fallback;
  }

  function gradeCurrent(mark){
    const p = problems.find(x => x.id === currentId);
    if (!p) return;

    let delta = 0;
    if (mark === 'o') delta = +1;
    else if (mark === 'd') delta = -0.5;
    else if (mark === 'x') delta = -1;

    p.score = clamp((p.score ?? 0) + delta, -5, +10);
    p.answerCount = (p.answerCount ?? 0) + 1;
    if (mark === 'o') p.correctCount = (p.correctCount ?? 0) + 1;
    p.updatedAt = Date.now();

    if (mark === 'x') appState.forcedQueue.push({ id: p.id, delay: 5 });

    const dkey = todayKey();
    if (!dailyStats[dkey]) dailyStats[dkey] = { correct: 0, total: 0 };
    dailyStats[dkey].total += 1;
    if (mark === 'o') dailyStats[dkey].correct += 1;

    // その日の到達数（スナップショット）
    const ge3 = problems.filter(x => (x.score ?? 0) >= 3).length;
    const ge5 = problems.filter(x => (x.score ?? 0) >= 5).length;
    const ge10 = problems.filter(x => (x.score ?? 0) >= 10).length;
    dailyThresholds[dkey] = { ge3, ge5, ge10 };

    saveAll();
    renderQuestion(nextQuestionId());
  }

  /* ======================
     D: グラフ & 日別一覧
     ====================== */
  function renderD(){
    renderDailyList();
    renderProgressChart();
  }

  function renderDailyList(){
    dailyList.innerHTML = '';
    const entries = Object.entries(dailyStats)
      .sort((a,b) => a[0].localeCompare(b[0], 'ja'));

    if (entries.length === 0) {
      const div = document.createElement('div');
      div.className = 'muted';
      div.textContent = 'まだ記録がありません。';
      dailyList.appendChild(div);
      return;
    }

    for (const [k, v] of entries) {
      const div = document.createElement('div');
      div.className = 'daily-item';
      const left = document.createElement('div');
      left.textContent = k;
      const right = document.createElement('div');
      right.textContent = `${v.correct}/${v.total}`;
      div.appendChild(left);
      div.appendChild(right);
      dailyList.appendChild(div);
    }
  }

  // 積み上げ棒グラフ： ge10 / (ge5-ge10) / (ge3-ge5)
  function renderProgressChart(){
    const labels = Array.from(
      new Set([
        ...Object.keys(dailyThresholds),
        ...Object.keys(dailyStats)
      ])
    ).sort((a,b)=>a.localeCompare(b,'ja'));

    const ge3Arr = labels.map(k => dailyThresholds[k]?.ge3 ?? 0);
    const ge5Arr = labels.map(k => dailyThresholds[k]?.ge5 ?? 0);
    const ge10Arr = labels.map(k => dailyThresholds[k]?.ge10 ?? 0);

    // 分解（負値が出ないようmaxで守る）
    const only10 = ge10Arr;
    const only5 = ge5Arr.map((v,i) => Math.max(0, v - ge10Arr[i]));
    const only3 = ge3Arr.map((v,i) => Math.max(0, v - ge5Arr[i]));

    const data = {
      labels,
      datasets: [
        { label: 'スコア +3 以上（3〜4）', data: only3 },
        { label: 'スコア +5 以上（5〜9）', data: only5 },
        { label: 'スコア +10', data: only10 },
      ]
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#e5e7eb' } }
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: '#e5e7eb' },
          grid: { color: 'rgba(255,255,255,0.08)' }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { color: '#e5e7eb' },
          grid: { color: 'rgba(255,255,255,0.08)' }
        }
      }
    };

    if (progressChart) {
      progressChart.destroy();
      progressChart = null;
    }
    progressChart = new Chart(progressCanvas, { type: 'bar', data, options });
  }

  /* ======================
     初期レンダリング
     ====================== */
  renderC();            // C初期描画
  setReveal(false);     // Aのボタン初期化

  // 画面復帰時、Dタブを開いていたら再描画
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (document.querySelector('#tab-d').classList.contains('show')) {
        renderProgressChart();
      }
    }
  });
})();

/* ========= 型メモ（参考）
Problem = {
  id: string,
  html: string,
  answers: string[],
  categories: string[],
  score: number,
  answerCount: number,
  correctCount: number,
  createdAt: number,
  updatedAt: number,
}
AppState = {
  recentQueue: string[],
  forcedQueue: {id:string, delay:number}[],
  lastPastedHTML: string,
}
============ */
