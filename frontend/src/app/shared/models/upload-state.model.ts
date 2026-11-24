/**
 * États possibles d'un envoi de fichier. Un seul état est actif à la fois, ce
 * qui évite les combinaisons incohérentes (par exemple "succès" et "erreur"
 * affichés en même temps).
 *
 * - idle       : aucun envoi en cours
 * - converting : vidéo MOV/AVI/MKV en cours de conversion en MP4 dans le
 *                navigateur, avant l'envoi ; `percent` vaut null pendant le
 *                chargement de FFmpeg (barre indéterminée)
 * - uploading  : envoi en cours ; `percent` vaut null tant que la taille totale
 *                est inconnue (barre de progression indéterminée)
 * - success    : le serveur a répondu 201
 * - error      : la conversion ou l'envoi a échoué
 */
export type UploadState =
  | { status: 'idle' }
  | { status: 'converting'; percent: number | null }
  | { status: 'uploading'; percent: number | null }
  | { status: 'success'; title: string }
  | { status: 'error'; message: string };
