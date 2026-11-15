import { PlaybackState } from '../models/playback-state.model';
import { bestClockOffset, driftCorrection, expectedPosition, formatTime } from './sync-math';

const state = (overrides: Partial<PlaybackState> = {}): PlaybackState => ({
  mediaId: 'm1',
  paused: false,
  position: 100,
  rate: 1,
  updatedAt: 1_000_000,
  version: 1,
  ...overrides,
});

describe('expectedPosition', () => {
  it('reste figée en pause, quelle que soit l’heure', () => {
    expect(expectedPosition(state({ paused: true }), 1_000_000)).toBe(100);
    expect(expectedPosition(state({ paused: true }), 9_999_999)).toBe(100);
  });

  it('avance avec l’horloge du serveur en lecture', () => {
    expect(expectedPosition(state(), 1_000_000)).toBe(100);
    expect(expectedPosition(state(), 1_002_500)).toBe(102.5);
  });

  it('tient compte de la vitesse de lecture', () => {
    expect(expectedPosition(state({ rate: 2 }), 1_002_500)).toBe(105);
  });
});

describe('driftCorrection', () => {
  const now = 1_010_000; // 10 s après updatedAt : position attendue 110

  it('ne corrige rien sous 0,1 s d’écart', () => {
    expect(driftCorrection(state(), 110.05, now).type).toBe('none');
    expect(driftCorrection(state(), 109.95, now).type).toBe('none');
  });

  it('accélère légèrement quand le lecteur est en retard de 0,1 s à 1 s', () => {
    const correction = driftCorrection(state(), 109.5, now);

    expect(correction).toEqual({ type: 'rate', drift: 0.5, rate: 1.05 });
  });

  it('ralentit légèrement quand le lecteur est en avance de 0,1 s à 1 s', () => {
    const correction = driftCorrection(state(), 110.5, now);

    expect(correction.type).toBe('rate');
    expect(correction).toMatchObject({ drift: -0.5, rate: 0.95 });
  });

  it('saute au-delà de 1 s d’écart, dans les deux sens', () => {
    expect(driftCorrection(state(), 100, now)).toEqual({ type: 'seek', drift: 10, position: 110 });
    expect(driftCorrection(state(), 115, now)).toEqual({ type: 'seek', drift: -5, position: 110 });
  });

  it('applique le rattrapage à la vitesse du salon', () => {
    const correction = driftCorrection(state({ rate: 2 }), 119.5, now); // attendu : 120

    expect(correction).toMatchObject({ type: 'rate', rate: 2.1 });
  });

  it('poursuit un rattrapage en cours jusqu’à 0,03 s, pour ne pas osciller autour de 0,1 s', () => {
    expect(driftCorrection(state(), 109.92, now, false).type).toBe('none');
    expect(driftCorrection(state(), 109.92, now, true).type).toBe('rate');
    expect(driftCorrection(state(), 109.98, now, true).type).toBe('none');
  });
});

describe('bestClockOffset', () => {
  it('vaut 0 sans mesure', () => {
    expect(bestClockOffset([])).toBe(0);
  });

  it('calcule le décalage au milieu de l’aller-retour', () => {
    // Envoi à 1000, réponse à 1100 : le serveur a répondu vers 1050 (heure locale).
    expect(bestClockOffset([{ sentAt: 1000, receivedAt: 1100, serverTime: 6050 }])).toBe(5000);
  });

  it('garde la mesure dont l’aller-retour est le plus court', () => {
    const offset = bestClockOffset([
      { sentAt: 1000, receivedAt: 1400, serverTime: 6300 }, // 400 ms, peu fiable
      { sentAt: 2000, receivedAt: 2020, serverTime: 7010 }, // 20 ms : la meilleure
      { sentAt: 3000, receivedAt: 3200, serverTime: 8050 },
    ]);

    expect(offset).toBe(5000);
  });

  it('donne un décalage négatif quand l’horloge locale avance', () => {
    expect(bestClockOffset([{ sentAt: 9000, receivedAt: 9100, serverTime: 6050 }])).toBe(-3000);
  });
});

describe('formatTime', () => {
  it('formate minutes et secondes, puis les heures', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(7.9)).toBe('0:07');
    expect(formatTime(754)).toBe('12:34');
    expect(formatTime(3729)).toBe('1:02:09');
  });

  it('tolère les valeurs inutilisables', () => {
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(Infinity)).toBe('0:00');
    expect(formatTime(-3)).toBe('0:00');
  });
});
