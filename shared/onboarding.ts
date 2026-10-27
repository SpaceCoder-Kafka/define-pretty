import type { FeatureBoard } from './feature-board.ts';

export const ONBOARDING_VERSION = 1;
export const ONBOARDING_STORAGE_KEY = `define-pretty-onboarding-v${ONBOARDING_VERSION}`;
export interface OnboardingDemo { version: number; board: FeatureBoard }
export type OnboardingStep = 'upload' | 'reference' | 'extract' | 'extracting' | 'select' | 'validate' | 'validating' | 'result' | 'export' | 'copy';
