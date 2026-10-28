import { readFile } from 'node:fs/promises';
import { featureReady } from '../shared/feature-board.ts';
import { ONBOARDING_VERSION, type OnboardingDemo } from '../shared/onboarding.ts';
import { safeFilePath } from './security.ts';
import { bundledOnboardingDirectory } from './paths.ts';

export const onboardingDirectory = bundledOnboardingDirectory;
export async function readOnboardingDemo(directory = onboardingDirectory): Promise<OnboardingDemo> {
  const demo: OnboardingDemo = JSON.parse(await readFile(await safeFilePath(directory, 'demo.json'), 'utf8'));
  if (demo.version !== ONBOARDING_VERSION || demo.board?.cards?.length !== 8 || !demo.board.cards.every(card => card.selected && featureReady(card))) {
    throw Object.assign(new Error('使用指引示例尚未就绪。'), { status: 503 });
  }
  await Promise.all(['reference.jpg', 'original/index.html', 'optimized/index.html'].map(file => safeFilePath(directory, file)));
  return demo;
}
