import { useCallback, useEffect, useRef, useState } from 'react';
import { featureReady, type FeatureBoard } from '../shared/feature-board';
import { ONBOARDING_STORAGE_KEY, ONBOARDING_VERSION, type OnboardingDemo, type OnboardingStep } from '../shared/onboarding';
import { api, errorMessage } from './api';
import { loadReference } from './feature-export';

function seen() { try { return !!localStorage.getItem(ONBOARDING_STORAGE_KEY); } catch { return false; } }
function hasDialog() { return !!document.querySelector('[role="dialog"], dialog[open]'); }

/** Demo state never enters the persisted board or validation hooks. */
export function useOnboarding(canStart: boolean, onExit: () => void) {
  const [step, setStep] = useState<OnboardingStep>();
  const [demo, setDemo] = useState<OnboardingDemo>();
  const [board, setBoard] = useState<FeatureBoard>();
  const [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [dismissed, setDismissed] = useState(seen);
  const session = useRef(0), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abort = useRef<AbortController>(undefined), loadingRef = useRef(false);
  const restoration = useRef<{ x: number; y: number; focus: HTMLElement | null }>(undefined);
  const eligible = useRef(canStart), exit = useRef(onExit);
  eligible.current = canStart; exit.current = onExit;

  useEffect(() => {
    const update = () => setDialog(hasDialog());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'role'] });
    return () => observer.disconnect();
  }, []);

  const start = useCallback(() => {
    if (!eligible.current || hasDialog() || loadingRef.current) return;
    restoration.current = { x: window.scrollX, y: window.scrollY, focus: document.activeElement as HTMLElement | null };
    session.current++; setBoard(undefined); setDemo(undefined); setError(''); setStep('upload');
  }, []);
  useEffect(() => { if (!dismissed && canStart && !dialog && !step) start(); }, [dismissed, canStart, dialog, step, start]);

  const finish = useCallback(() => {
    session.current++; clearTimeout(timer.current); abort.current?.abort(); loadingRef.current = false;
    try { localStorage.setItem(ONBOARDING_STORAGE_KEY, 'seen'); } catch { /* A blocked store must not prevent exiting. */ }
    setDismissed(true); setStep(undefined); setBoard(undefined); setDemo(undefined); setError(''); setLoading(false);
    exit.current();
    const previous = restoration.current;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (previous) { previous.focus?.focus({ preventScroll: true }); window.scrollTo({ left: previous.x, top: previous.y, behavior: 'instant' }); }
    }));
  }, []);
  useEffect(() => () => { session.current++; clearTimeout(timer.current); abort.current?.abort(); }, []);

  async function load() {
    if (loadingRef.current) return;
    const current = session.current;
    loadingRef.current = true; setLoading(true); setError(''); abort.current = new AbortController();
    try {
      const next = await api<OnboardingDemo>('/onboarding-demo', { signal: abort.current.signal });
      if (next.version !== ONBOARDING_VERSION || next.board?.cards?.length !== 8 || !next.board.cards.every(card => card.selected && featureReady(card))) throw new Error('示例内容不完整，请重试。');
      await loadReference(next.board.reference.url);
      if (session.current !== current) return;
      setDemo(next); setBoard({ ...structuredClone(next.board), cards: [] }); setStep('reference');
    } catch (cause) { if (session.current === current) setError(errorMessage(cause)); }
    finally { if (session.current === current) { loadingRef.current = false; setLoading(false); } }
  }
  function simulate(kind: 'extract' | 'validate') {
    if (!demo || step !== kind) return;
    setStep(kind === 'extract' ? 'extracting' : 'validating');
    const current = session.current;
    timer.current = setTimeout(() => {
      if (session.current !== current) return;
      if (kind === 'extract') setBoard(structuredClone(demo.board));
      setStep(kind === 'extract' ? 'select' : 'result');
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1200);
  }
  function next() {
    if (step === 'reference') setStep('extract');
    else if (step === 'select') { setBoard(structuredClone(demo!.board)); setStep('validate'); }
    else if (step === 'result') setStep('export');
    else if (step === 'copy') finish();
  }
  function toggle(id: string) {
    if (step === 'select') setBoard(current => current && ({ ...current, cards: current.cards.map(card => card.id === id ? { ...card, selected: !card.selected } : card) }));
  }
  return { active: !!step, step, board, loading, error, start, finish, load, simulate, next, toggle,
    canReplay: canStart && !dialog && !step, session, reportError: setError, exported: () => { setError(''); setStep('copy'); } };
}
