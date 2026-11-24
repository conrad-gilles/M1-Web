import { conversionArgs, convertedName, fileExtension, needsConversion, parseStreams } from './video-conversion';

/** Extraits réels du journal de `ffmpeg -i` (MKV H.264 + AAC, AVI MPEG-4 + MP3). */
const MKV_H264_LOG = `Input #0, matroska,webm, from 'input.mkv':
  Duration: 00:00:02.00, start: 0.000000, bitrate: 120 kb/s
  Stream #0:0: Video: h264 (High), yuv420p(progressive), 160x120, 25 fps
  Stream #0:1(eng): Audio: aac (LC), 44100 Hz, stereo, fltp (default)
  Stream #0:2(fre): Subtitle: subrip`;

const AVI_MPEG4_LOG = `Input #0, avi, from 'input.avi':
  Stream #0:0: Video: mpeg4 (Simple Profile) (FMP4 / 0x34504D46), yuv420p, 160x120
  Stream #0:1: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, 2 channels`;

describe('video-conversion', () => {
  it('ne convertit que les MOV, AVI et MKV, quelle que soit la casse', () => {
    expect(needsConversion(new File([], 'film.MOV'))).toBe(true);
    expect(needsConversion(new File([], 'film.avi'))).toBe(true);
    expect(needsConversion(new File([], 'film.mkv'))).toBe(true);
    expect(needsConversion(new File([], 'clip.mp4'))).toBe(false);
    expect(needsConversion(new File([], 'song.mp3'))).toBe(false);
    expect(needsConversion(new File([], 'sans-extension'))).toBe(false);
  });

  it('lit l’extension et renomme le résultat en .mp4', () => {
    expect(fileExtension('Vacances.Été.MKV')).toBe('.mkv');
    expect(fileExtension('README')).toBe('');
    expect(convertedName('Vacances.Été.MKV')).toBe('Vacances.Été.mp4');
    expect(convertedName('film')).toBe('film.mp4');
  });

  it('détecte les codecs vidéo et audio dans le journal de FFmpeg', () => {
    expect(parseStreams(MKV_H264_LOG)).toEqual({ video: 'h264', audio: 'aac' });
    expect(parseStreams(AVI_MPEG4_LOG)).toEqual({ video: 'mpeg4', audio: 'pcm_s16le' });
    expect(parseStreams('Stream #0:0: Video: vp9, yuv420p')).toEqual({ video: 'vp9', audio: null });
    expect(parseStreams('Invalid data found when processing input')).toEqual({ video: null, audio: null });
  });

  it('recopie sans réencoder des pistes déjà lisibles (H.264 + AAC)', () => {
    const args = conversionArgs(parseStreams(MKV_H264_LOG), 'input.mkv', 'output.mp4');

    expect(args).toEqual([
      '-i', 'input.mkv',
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-movflags', '+faststart', 'output.mp4',
    ]);
  });

  it('réencode en H.264/AAC des pistes que les navigateurs ne lisent pas', () => {
    const args = conversionArgs(parseStreams(AVI_MPEG4_LOG), 'input.avi', 'output.mp4');

    expect(args.join(' ')).toContain('-c:v libx264 -preset ultrafast');
    expect(args.join(' ')).toContain('-pix_fmt yuv420p');
    expect(args.join(' ')).toContain('-c:a aac');
    expect(args.at(-1)).toBe('output.mp4');
  });

  it('accepte une vidéo sans son', () => {
    const args = conversionArgs({ video: 'h264', audio: null }, 'in.mov', 'out.mp4');

    expect(args).not.toContain('-c:a');
  });

  it('refuse un fichier sans piste vidéo', () => {
    expect(() => conversionArgs({ video: null, audio: 'aac' }, 'in.mkv', 'out.mp4')).toThrow(
      'Aucune piste vidéo',
    );
  });
});
