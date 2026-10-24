/** Only migrate our recognizable former defaults; preserve user-authored prompts. */
export function currentGenerationPrompt(saved: string | undefined, current: string): string {
  if (!saved || (saved.startsWith('从参考图提炼一份精简的风格迁移规范。') && saved.includes('direction：') && saved.includes('synthesis：'))) return current;
  return saved;
}
