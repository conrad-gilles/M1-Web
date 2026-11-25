/*
 * Fichiers locaux synchronisés : règles pures (testées unitairement).
 *
 * Deux participants lisent « le même » média si leurs fichiers ont la même
 * durée, à 1 s près (les navigateurs n'arrondissent pas tous de la même
 * façon). Le nom, la taille et le format peuvent différer.
 */
export const DURATION_TOLERANCE_SECONDS = 1;

export function sameDuration(expected: number, actual: number): boolean {
  return Math.abs(expected - actual) <= DURATION_TOLERANCE_SECONDS;
}

/** 5423.4 -> "1:30:23", 83 -> "1:23". */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Durée et nature (son seul ou image) lues par le navigateur. */
export interface LocalFileInfo {
  duration: number;
  kind: 'audio' | 'video';
}
