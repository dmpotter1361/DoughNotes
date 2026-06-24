import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

// Format seconds as M:SS.
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function CookMode() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState(0);

  // Timer (counts up; a quick-set lets you count down from a few common durations).
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [target, setTarget] = useState(null); // countdown target, or null = count up
  const tick = useRef(null);
  const wakeLock = useRef(null);

  useEffect(() => {
    api.get(`/recipes/${id}`).then(({ recipe }) => setRecipe(recipe)).catch((e) => setError(e.message));
  }, [id]);

  // Keep the screen awake while in Cook Mode (best-effort; unsupported browsers ignore).
  useEffect(() => {
    let released = false;
    async function acquire() {
      try {
        if ('wakeLock' in navigator) {
          wakeLock.current = await navigator.wakeLock.request('screen');
        }
      } catch { /* ignore */ }
    }
    acquire();
    const onVisible = () => { if (document.visibilityState === 'visible' && !released) acquire(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      wakeLock.current?.release?.().catch(() => {});
    };
  }, []);

  // Timer loop.
  useEffect(() => {
    if (running) {
      tick.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      return () => clearInterval(tick.current);
    }
  }, [running]);

  const remaining = target != null ? Math.max(0, target - seconds) : null;
  const alarm = target != null && remaining === 0;
  useEffect(() => {
    if (alarm) { setRunning(false); try { navigator.vibrate?.(600); } catch { /* ignore */ } }
  }, [alarm]);

  function startCountdown(mins) {
    setTarget(mins * 60);
    setSeconds(0);
    setRunning(true);
  }
  function resetTimer() { setRunning(false); setSeconds(0); setTarget(null); }

  if (error) return <div className="container"><p className="error">{error}</p></div>;
  if (!recipe) return <div className="container"><p>Loading…</p></div>;

  const steps = recipe.steps.length ? recipe.steps : ['(No steps for this recipe.)'];
  const last = steps.length - 1;
  const stepImages = recipe.images?.filter((im) => im.step_index === step) ?? [];

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#2a1f17', color: '#faf3e7', display: 'flex', flexDirection: 'column', zIndex: 1000 }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '1rem 1.5rem', gap: '1rem' }}>
        <strong style={{ fontSize: '1.2rem' }}>{recipe.title}</strong>
        <span style={{ marginLeft: 'auto', opacity: 0.8 }}>Step {step + 1} of {steps.length}</span>
        <button className="secondary" style={{ color: '#faf3e7', borderColor: '#faf3e7' }} onClick={() => navigate(`/recipes/${id}`)}>Exit</button>
      </div>

      {/* Current step */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '1rem 2rem', overflow: 'auto' }}>
        {stepImages.map((im) => (
          <img key={im.id} src={im.url} alt="" style={{ maxHeight: '32vh', borderRadius: 12, marginBottom: '1.5rem', objectFit: 'contain' }} />
        ))}
        <p style={{ fontSize: 'clamp(1.4rem, 4vw, 2.6rem)', lineHeight: 1.4, maxWidth: '20ch', margin: 0 }}>
          {steps[step]}
        </p>
      </div>

      {/* Timer */}
      <div style={{ textAlign: 'center', padding: '0.5rem' }}>
        <div style={{ fontSize: '2rem', fontVariantNumeric: 'tabular-nums', color: alarm ? 'var(--crust)' : '#faf3e7' }}>
          {alarm ? "Time's up!" : fmt(remaining != null ? remaining : seconds)}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          <button className="secondary" style={{ color: '#faf3e7', borderColor: '#faf3e7' }} onClick={() => setRunning((r) => !r)}>
            {running ? 'Pause' : 'Start'}
          </button>
          <button className="secondary" style={{ color: '#faf3e7', borderColor: '#faf3e7' }} onClick={resetTimer}>Reset</button>
          {[5, 10, 30].map((m) => (
            <button key={m} className="secondary" style={{ color: '#faf3e7', borderColor: '#faf3e7' }} onClick={() => startCountdown(m)}>{m}m</button>
          ))}
        </div>
      </div>

      {/* Step nav */}
      <div style={{ display: 'flex', gap: '1rem', padding: '1rem 1.5rem' }}>
        <button style={{ flex: 1 }} disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>← Previous</button>
        <button style={{ flex: 1 }} disabled={step === last} onClick={() => setStep((s) => Math.min(last, s + 1))}>Next →</button>
      </div>
    </div>
  );
}
