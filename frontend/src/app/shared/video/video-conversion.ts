/*
 * Logique pure de la conversion vidéo (aucun accès à FFmpeg ici) : elle est
 * testée unitairement, et VideoConverterService se contente de l'appliquer.
 */

/**
 * Conteneurs que les navigateurs ne lisent pas de façon fiable : ils sont
 * convertis en MP4 dans le navigateur avant l'envoi. Le serveur, lui, ne
 * reçoit jamais que des formats lisibles (voir backend/src/config.js).
 */
export const CONVERTIBLE_EXTENSIONS = new Set(['.mov', '.avi', '.mkv']);

/**
 * Taille recommandée, pas une interdiction : au-delà, l'utilisateur est
 * prévenu que la conversion peut être très lente ou saturer la mémoire du
 * navigateur (le fichier source et le résultat sont tous deux gardés en
 * mémoire), surtout sur téléphone.
 */
export const RECOMMENDED_CONVERSION_INPUT_SIZE = 200 * 1024 * 1024;

/** Codecs qu'un navigateur lit dans un MP4 : ils sont recopiés tels quels. */
const PLAYABLE_VIDEO_CODECS = new Set(['h264']);
const PLAYABLE_AUDIO_CODECS = new Set(['aac', 'mp3']);

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

export function needsConversion(file: File): boolean {
  return CONVERTIBLE_EXTENSIONS.has(fileExtension(file.name));
}

/** `film.MOV` -> `film.mp4` */
export function convertedName(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot === -1 ? name : name.slice(0, dot)) + '.mp4';
}

export interface StreamInfo {
  video: string | null;
  audio: string | null;
}

/**
 * Lit les codecs de la première piste vidéo et audio dans le journal de
 * `ffmpeg -i fichier`, par exemple :
 * `Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, ...`
 */
export function parseStreams(log: string): StreamInfo {
  const video = /Stream #\d+:\d+.*?: Video: (\w+)/.exec(log);
  const audio = /Stream #\d+:\d+.*?: Audio: (\w+)/.exec(log);
  return { video: video?.[1] ?? null, audio: audio?.[1] ?? null };
}

/**
 * Arguments FFmpeg pour produire un MP4 lisible partout. Une piste déjà
 * compatible est recopiée (quasi instantané) ; sinon elle est réencodée en
 * H.264/AAC. `ultrafast` privilégie la vitesse : le calcul se fait sur
 * l'appareil de l'utilisateur, en un seul thread.
 */
export function conversionArgs(streams: StreamInfo, input: string, output: string): string[] {
  if (!streams.video) throw new Error('Aucune piste vidéo dans ce fichier.');

  // Seules la première piste vidéo et la première piste audio sont gardées :
  // les sous-titres d'un MKV, par exemple, ne tiennent pas dans un MP4.
  const args = ['-i', input, '-map', '0:v:0', '-map', '0:a:0?'];

  if (PLAYABLE_VIDEO_CODECS.has(streams.video)) {
    args.push('-c:v', 'copy');
  } else {
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p');
  }

  if (streams.audio) {
    if (PLAYABLE_AUDIO_CODECS.has(streams.audio)) args.push('-c:a', 'copy');
    else args.push('-c:a', 'aac', '-b:a', '128k');
  }

  // Index en tête de fichier : la lecture peut commencer avant la fin du
  // téléchargement (streaming par requêtes Range).
  args.push('-movflags', '+faststart', output);
  return args;
}
