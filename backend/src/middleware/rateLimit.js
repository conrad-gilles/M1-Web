/**
 * Compteur en mémoire par clé (ici l'adresse IP) sur une fenêtre de temps.
 * Suffisant pour une seule instance de serveur ; plusieurs instances
 * demanderaient un compteur partagé.
 */
export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const hits = new Map();

  function recent(key) {
    const kept = (hits.get(key) || []).filter((time) => now() - time < windowMs);
    if (kept.length > 0) hits.set(key, kept);
    else hits.delete(key);
    return kept;
  }

  return {
    /** Vrai si la clé a atteint la limite dans la fenêtre courante. */
    isBlocked(key) {
      return recent(key).length >= limit;
    },
    /** Enregistre une tentative. */
    hit(key) {
      hits.set(key, [...recent(key), now()]);
    },
  };
}
