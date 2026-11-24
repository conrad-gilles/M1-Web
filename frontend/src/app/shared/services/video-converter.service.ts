import { Injectable } from '@angular/core';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { conversionArgs, convertedName, fileExtension, parseStreams } from '../video/video-conversion';

/**
 * Fichiers de FFmpeg compilé en WebAssembly (version mono-thread : elle ne
 * demande pas les en-têtes COOP/COEP). angular.json les copie depuis
 * node_modules/@ffmpeg/core et @ffmpeg/ffmpeg ; ils sont servis par notre
 * propre site. Le worker est copié tel quel car le build Angular ne
 * l'inclut pas dans le chunk de @ffmpeg/ffmpeg.
 */
const CORE_PATH = 'ffmpeg/ffmpeg-core';
const WORKER_PATH = 'ffmpeg/worker.js';

/**
 * Convertit dans le navigateur une vidéo MOV/AVI/MKV en MP4 lisible partout.
 *
 * Le chargement est paresseux : ni le code de @ffmpeg/ffmpeg (import
 * dynamique, donc un chunk séparé) ni le cœur WebAssembly (~32 Mo) ne sont
 * téléchargés tant qu'aucun utilisateur n'envoie un fichier à convertir.
 * Ensuite, le navigateur les garde en cache.
 */
@Injectable({ providedIn: 'root' })
export class VideoConverterService {
  private ffmpeg: Promise<FFmpeg> | null = null;
  private onProgress: ((percent: number) => void) | null = null;

  /**
   * Flux : fichier choisi -> chargement de FFmpeg (une seule fois) -> écriture
   * dans le système de fichiers virtuel -> analyse des pistes -> recopie ou
   * réencodage -> nouveau File MP4, prêt à être envoyé comme les autres.
   */
  async toMp4(file: File, onProgress: (percent: number) => void): Promise<File> {
    const ffmpeg = await this.load();
    const input = 'input' + fileExtension(file.name);
    const output = 'output.mp4';

    try {
      await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));

      // Sans fichier de sortie, `ffmpeg -i` échoue toujours : seul le journal
      // nous intéresse, il décrit les pistes du fichier.
      const log: string[] = [];
      const collect = ({ message }: { message: string }) => log.push(message);
      ffmpeg.on('log', collect);
      await ffmpeg.exec(['-hide_banner', '-i', input]);
      ffmpeg.off('log', collect);

      const streams = parseStreams(log.join('\n'));
      console.debug('[VideoConverter] Pistes détectées', streams);

      this.onProgress = onProgress;
      const exitCode = await ffmpeg.exec(conversionArgs(streams, input, output));
      if (exitCode !== 0) throw new Error(`FFmpeg a échoué (code ${exitCode})`);

      const data = await ffmpeg.readFile(output);
      if (typeof data === 'string') throw new Error('Résultat de conversion inattendu');
      // Copie dans un ArrayBuffer ordinaire : le tampon de FFmpeg peut être partagé.
      return new File([data.slice()], convertedName(file.name), { type: 'video/mp4' });
    } catch (error) {
      // Après un manque de mémoire (gros fichier), FFmpeg peut rester dans un
      // état inutilisable : on l'arrête, le prochain essai le rechargera.
      ffmpeg.terminate();
      this.ffmpeg = null;
      throw error;
    } finally {
      this.onProgress = null;
      await ffmpeg.deleteFile(input).catch(() => undefined);
      await ffmpeg.deleteFile(output).catch(() => undefined);
    }
  }

  private load(): Promise<FFmpeg> {
    this.ffmpeg ??= (async () => {
      console.debug('[VideoConverter] Chargement de FFmpeg (WebAssembly)');
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const ffmpeg = new FFmpeg();
      ffmpeg.on('progress', ({ progress }) => {
        // FFmpeg peut annoncer une valeur hors bornes au début d'un fichier.
        if (this.onProgress && progress >= 0) this.onProgress(Math.min(100, Math.round(progress * 100)));
      });
      // Le worker charge ces URL lui-même : elles doivent être absolues.
      const base = new URL(CORE_PATH, document.baseURI).href;
      await ffmpeg.load({
        classWorkerURL: new URL(WORKER_PATH, document.baseURI).href,
        coreURL: `${base}.js`,
        wasmURL: `${base}.wasm`,
      });
      console.debug('[VideoConverter] FFmpeg prêt');
      return ffmpeg;
    })().catch((error: unknown) => {
      // Un échec de chargement (réseau coupé) ne doit pas bloquer l'essai suivant.
      this.ffmpeg = null;
      throw error;
    });
    return this.ffmpeg;
  }
}
