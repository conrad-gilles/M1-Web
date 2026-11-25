/*
 * Espace de stockage épuisé. Il n'y a pas de limite de taille par fichier :
 * c'est l'espace (et, avec Backblaze B2, le quota gratuit) qui décide. Quand
 * il manque, le client reçoit une erreur 507 claire au lieu d'une erreur 500.
 */

export const STORAGE_FULL =
  "Espace de stockage gratuit épuisé : supprimez des médias du salon ou réessayez plus tard.";

/**
 * Codes reconnus :
 * - ENOSPC / EDQUOT : disque local plein ou quota disque atteint (stockage
 *   local, dossier temporaire de Multer) ;
 * - STORAGE_FULL : à lever par toute autre implémentation du stockage (B2,
 *   phase 3.4) quand le quota gratuit est atteint.
 */
export function isStorageFull(error) {
  return ["ENOSPC", "EDQUOT", "STORAGE_FULL"].includes(error?.code);
}
