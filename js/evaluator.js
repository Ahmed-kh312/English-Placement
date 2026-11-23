/* Questions + transparent scoring engine. All thresholds are visible here and in the teacher dashboard. */
const Evaluator = (() => {
  const PASSAGE = 'A knight wrote a letter about his lamb. He left a comb and a cake by the tree. Then he sat in a boat with a cat and a pen.';
  const TARGETS = { silent: ['knight', 'wrote', 'lamb', 'comb'], long: ['cake', 'tree', 'boat'], short: ['cat', 'pen', 'sat'] };
  const LISTEN_TEXT = 'Sara has a small dog. Every morning, she walks with her dog in the park. On Saturday, she visits her grandmother.';
  const QUESTIONS = [
    { id: 1, title: 'Introduce yourself?', minTime: 20, need: 2,
      keys: ['name', 'my', 'student', 'years', 'old', 'from', 'live', 'study', 'family', 'like', 'love', 'hobby', 'work', 'college'] },
    { id: 2, title: 'Passage (silent letter - long vowel - short vowel)?', minTime: 15, type: 'read' },
    { id: 3, title: "Who's your best friend?", minTime: 15, need: 2,
      keys: ['friend', 'best', 'name', 'he', 'she', 'kind', 'funny', 'together', 'we', 'school', 'know', 'years', 'because'] },
    { id: 4, title: 'Listening question?', minTime: 8, type: 'listen', need: 2,
      keys: ['saturday', 'saturdays', 'visit', 'visits', 'grandmother', 'grandma', 'sara'] },
    { id: 5, title: 'What are your first impressions about your college?', minTime: 20, need: 2,
      keys: ['college', 'university', 'campus', 'friends', 'teachers', 'doctors', 'professors', 'students', 'new', 'big', 'beautiful', 'excited', 'nervous', 'friendly', 'building', 'classes'] }
  ];
  const ERRORS = [
    [/\b(i|you|we|they) (is|has)\b/, 'subject-verb agreement'],
    [/\b(he|she|it) (have|are|do|don't|go|like|want|live|study|work|love)\b/, 'third-person verb form'],
    [/\bi am agree\b|\bmy name (are|am)\b/, 'incorrect "be" usage'],
    [/\b(more|most) (better|best|good)\b|\bmore (easy|hard)\b/, 'comparative form'],
    [/\ba [aeiou]\w+/, '"a" before a vowel sound'],
    [/\b(is|are|am) (go|like|want|study|live)\b/, 'verb after "be"'],
    [/\bi very\b/, 'word order'],
    [/\b(\w{3,}) \1\b/, 'repeated word']
  ];
  const CONNECTORS = ['because', 'but', 'and', 'so', 'however', 'although', 'when', 'which', 'that', 'also', 'then', 'while', 'if'];
  const ADVANCED = ['actually', 'especially', 'definitely', 'experience', 'environment', 'opportunity', 'impressed', 'comfortable', 'enthusiastic'];
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
  const words = (t) => (String(t || '').toLowerCase().match(/[a-z']+/g) || []);

  function timeScore(sec, min) {
    if (sec <= 0) return 0;
    if (sec > 90) return 85;
    return clamp((sec / min) * 100);
  }

  function evalQuestion(q, a) {
    const w = words(a.transcript), set = new Set(w), n = w.length, notes = [];
    let grammar, vocab, task;
    if (q.type === 'read') {
      const all = [].concat(TARGETS.silent, TARGETS.long, TARGETS.short);
      const hit = all.filter(x => set.has(x)).length;
      const pw = Array.from(new Set(words(PASSAGE)));
      const cov = pw.filter(x => set.has(x)).length / pw.length;
      grammar = clamp(cov * 100); vocab = clamp(hit / all.length * 100); task = vocab;
      notes.push('Reading accuracy ' + grammar + '%; ' + hit + '/' + all.length + ' target words recognised (silent / long / short vowels).');
    } else {
      const lower = a.transcript.toLowerCase();
      const errs = ERRORS.filter(e => e[0].test(lower)).map(e => e[1]);
      const conn = w.filter(x => CONNECTORS.includes(x)).length;
      grammar = clamp(40 + Math.min(25, conn * 8) + Math.min(25, n * 0.8) - errs.length * 14);
      if (n < 4) grammar = Math.min(grammar, 30);
      const hits = q.keys.filter(k => set.has(k)).length;
      const rel = Math.min(1, hits / q.need);
      const adv = new Set(w.filter(x => x.length >= 7 || ADVANCED.includes(x)));
      vocab = clamp(Math.min(45, set.size * 3.5) + Math.min(30, adv.size * 10) + rel * 25);
      task = clamp(rel * 100);
      if (errs.length) notes.push('Grammar issues: ' + errs.join(', ') + '.');
      notes.push(conn + ' connector(s), ' + set.size + ' unique words, ' + hits + ' relevant keyword(s).');
      if (n < 8) notes.push('Very short answer.');
    }
    const time = timeScore(a.duration, q.minTime);
    const score = clamp(time * 0.25 + grammar * 0.30 + vocab * 0.25 + task * 0.20);
    return { id: q.id, words: n, duration: a.duration, time, grammar, vocab, task, score, notes };
  }

  function evaluate(answers) {
    const per = QUESTIONS.map((q, i) => evalQuestion(q, answers[i]));
    const avg = (k) => clamp(per.reduce((s, p) => s + p[k], 0) / per.length);
    const open = per.filter((_, i) => !QUESTIONS[i].type);
    const avgOpenWords = open.reduce((s, p) => s + p.words, 0) / open.length;
    const totalTime = Math.round(answers.reduce((s, a) => s + a.duration, 0));
    const overall = avg('score');
    let level = overall < 45 ? 1 : overall < 68 ? 2 : 3;
    const why = ['Overall score ' + overall + '/100 (Level 1 below 45, Level 2 from 45 to 67, Level 3 from 68).'];
    if (avgOpenWords < 6 && level > 1) { level = 1; why.push('Capped at Level 1: open answers average only ' + avgOpenWords.toFixed(1) + ' words (under 6).'); }
    else if (avgOpenWords < 12 && level === 3) { level = 2; why.push('Capped at Level 2: open answers average ' + avgOpenWords.toFixed(1) + ' words (under 12).'); }
    return { level, overall, time: avg('time'), grammar: avg('grammar'), vocab: avg('vocab'), task: avg('task'),
      totalTime, avgTime: Math.round(totalTime / answers.length), per, why };
  }

  return { QUESTIONS, PASSAGE, TARGETS, LISTEN_TEXT, evaluate,
    LEVEL_NAMES: { 1: 'Level 1 · Beginner / Foundational', 2: 'Level 2 · Intermediate', 3: 'Level 3 · Upper-Intermediate / Advanced' } };
})();
