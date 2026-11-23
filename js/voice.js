/* Microphone recording (MediaRecorder), live transcription (Web Speech API) and Text-to-Speech. */
const Voice = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let ctx = null, an = null, rec = null, mr = null, stream = null, chunks = [], t0 = 0, finalText = '', active = false, onText = null;

  const toDataURL = (blob) => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob); });

  async function start(cb) {
    onText = cb; finalText = ''; chunks = [];
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)(); an = ctx.createAnalyser(); an.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(an);
    } catch (e) { an = null; }
    if (window.MediaRecorder) {
      mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.start();
    }
    if (SR) {
      rec = new SR(); rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t + ' '; else interim += t;
        }
        if (onText) onText((finalText + interim).trim());
      };
      rec.onend = () => { if (active) { try { rec.start(); } catch (e) {} } };
      rec.onerror = () => {};
      try { rec.start(); } catch (e) {}
    }
    active = true; t0 = performance.now();
  }

  async function stop() {
    active = false;
    const duration = Math.max(0, (performance.now() - t0) / 1000);
    if (rec) { try { rec.stop(); } catch (e) {} rec = null; }
    let audio = null;
    if (mr) {
      await new Promise(res => { mr.onstop = res; try { mr.stop(); } catch (e) { res(); } });
      if (chunks.length) audio = await toDataURL(new Blob(chunks, { type: mr.mimeType || 'audio/webm' }));
      mr = null;
    }
    if (ctx) { try { ctx.close(); } catch (e) {} ctx = null; an = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    return { duration, audio, transcript: finalText.trim() };
  }

  function speak(text, onEnd) {
    if (!('speechSynthesis' in window)) { onEnd && onEnd(false); return false; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 0.92;
    u.onend = () => onEnd && onEnd(true); u.onerror = () => onEnd && onEnd(false);
    speechSynthesis.speak(u); return true;
  }

  /* Converts a saved recording to text. Newer Chrome can read the audio track directly;
     otherwise the recording plays aloud and the browser listens through the microphone. */
  function transcribeAudio(src) {
    return new Promise((resolve, reject) => {
      if (!SR) { reject(new Error('Speech recognition is not supported in this browser. Use Chrome or Edge, or type the transcript.')); return; }
      const audio = new Audio(src), r = new SR(); let text = '', done = false;
      const end = (err) => { if (done) return; done = true; try { r.stop(); } catch (e) {} audio.pause(); err ? reject(err) : resolve(text.trim()); };
      r.lang = 'en-US'; r.continuous = true; r.interimResults = false;
      r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript + ' '; };
      r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') end(new Error(e.error === 'not-allowed' ? 'Allow microphone access to convert the audio.' : 'Could not convert this audio (' + e.error + ').')); };
      r.onend = () => end();
      audio.onended = () => setTimeout(() => { try { r.stop(); } catch (e) {} }, 1500);
      audio.onerror = () => end(new Error('The audio could not be played.'));
      audio.play().then(() => {
        try {
          const track = audio.captureStream ? audio.captureStream().getAudioTracks()[0] : null;
          if (track) r.start(track); else r.start();
        } catch (e) { try { r.start(); } catch (e2) { end(new Error('Could not start speech recognition.')); } }
      }).catch(() => end(new Error('Audio playback was blocked. Press the button again.')));
    });
  }

  function levels() { if (!an) return null; const d = new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(d); return d; }

  return { start, stop, speak, levels, transcribeAudio, recognitionSupported: !!SR, recordingSupported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) };
})();
