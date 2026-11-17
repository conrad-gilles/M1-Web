/**
 * États possibles d'un envoi de fichier. Un seul état est actif à la fois, ce
 * qui évite les combinaisons incohérentes (par exemple "succès" et "erreur"
 * affichés en même temps).
 *
 * - idle      : aucun envoi en cours
 * - uploading : envoi en cours ; `percent` vaut null tant que la taille totale
 *               est inconnue (barre de progression indéterminée)
 * - success   : le serveur a répondu 201
 * - error     : l'envoi a échoué (réseau ou réponse d'erreur du serveur)
 */
export type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; percent: number | null }
  | { status: 'success'; title: string }
  | { status: 'error'; message: string };
