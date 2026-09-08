export type QualityLevel = 'low' | 'standard' | 'high';
export type QualityChoice = 'auto' | QualityLevel;
export const QUALITY_LABELS = {
  auto: '自动',
  low: '流畅',
  standard: '标准',
  high: '精细',
} as const;
export const QUALITY_SETTINGS = {
  low: {
    pixelRatio: 1.15,
    shadowSize: 1024,
    shadowHz: 10,
    rockDetail: 0,
    rockFraction: 0.5,
  },
  standard: {
    pixelRatio: 1.5,
    shadowSize: 2048,
    shadowHz: 15,
    rockDetail: 1,
    rockFraction: 0.8,
  },
  high: {
    pixelRatio: 1.8,
    shadowSize: 4096,
    shadowHz: 20,
    rockDetail: 2,
    rockFraction: 1,
  },
} as const;
export function isQualityChoice(value: unknown): value is QualityChoice {
  return typeof value === 'string' && Object.hasOwn(QUALITY_LABELS, value);
}
export function resolveQuality(
  choice: QualityChoice,
  width: number,
  coarsePointer: boolean,
  cores = 8,
): QualityLevel {
  if (choice !== 'auto') return choice;
  return width < 760 || coarsePointer || cores <= 4 ? 'low' : 'standard';
}
