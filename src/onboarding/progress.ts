import { getSetting, setSetting } from '../chat/database';

// Où en est la prise en main : si l'app est fermée au milieu, elle reprend à la même étape.
const STEP = 'onboarding_step';
const DONE = 'onboarding_done';

export function loadOnboardingStep(): 0 | 1 | 2 | 3 {
  const saved = Number(getSetting(STEP));
  return saved === 1 || saved === 2 || saved === 3 ? saved : 0;
}

export function saveOnboardingStep(step: number) {
  setSetting(STEP, String(step));
}

export function isOnboardingDone() {
  return getSetting(DONE) === '1';
}

export function markOnboardingDone() {
  setSetting(DONE, '1');
}
