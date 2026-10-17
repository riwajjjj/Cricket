/* Crease — Shared state: which match format is selected. */
import { FORMATS, profileFor } from './maths.js';
import { clamp, store } from './utils.js';
// Kept in one object so every module sees the same, current values.
export const S = {
  formatKey: store.get('format', 'T20'),
  customOvers: clamp(parseInt(store.get('customOvers', 15), 10) || 15, 1, 100),
};
if (!['T20', 'ODI', 'Test', 'T10', 'Custom'].includes(S.formatKey)) S.formatKey = 'T20';

export function fmt() {
  if (S.formatKey !== 'Custom') return FORMATS[S.formatKey];
  return profileFor(S.customOvers);
}
