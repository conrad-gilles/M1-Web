import { PlaybackAction, PlaybackChange } from '../models/playback-change.model';
import { describeChange } from './describe-change';

const ALEX = { id: 'p1', name: 'Alex' };
const SAM = { id: 'p2', name: 'Sam' };

const change = (action: PlaybackAction, overrides: Partial<PlaybackChange> = {}): PlaybackChange => ({
  version: 2,
  playback: { mediaId: 'm1', paused: false, position: 754, rate: 1, updatedAt: 1_000_000, version: 2 },
  waitingFor: [],
  action,
  by: ALEX,
  ...overrides,
});

describe('describeChange', () => {
  it('indique qui a lancé, mis en pause ou choisi un média', () => {
    expect(describeChange(change('play'), 'p2')).toBe('Alex a lancé la lecture');
    expect(describeChange(change('pause'), 'p2')).toBe('Alex a mis en pause');
    expect(describeChange(change('load'), 'p2')).toBe('Alex a choisi un nouveau média');
  });

  it('indique la position visée par un saut', () => {
    expect(describeChange(change('seek'), 'p2')).toBe('Alex est allé à 12:34');
  });

  it('s’adresse directement à l’auteur de l’action', () => {
    expect(describeChange(change('play'), 'p1')).toBe('Vous avez lancé la lecture');
    expect(describeChange(change('seek'), 'p1')).toBe('Vous êtes allé à 12:34');
  });

  it('nomme les participants que le salon attend', () => {
    const waiting = change('buffering', { by: SAM, waitingFor: [SAM, ALEX] });

    expect(describeChange(waiting, 'p1')).toBe('Le salon attend Sam, vous (mise en mémoire tampon)…');
  });

  it('annonce la reprise et la suppression du média en cours', () => {
    expect(describeChange(change('resume', { by: null }), 'p1')).toBe('Lecture reprise');
    expect(describeChange(change('unload', { by: null, playback: null }), 'p1')).toBe(
      'Le média en cours a été supprimé',
    );
  });

  it('reste silencieux quand il n’y a rien à dire', () => {
    expect(describeChange(change('ended', { by: null }), 'p1')).toBeNull();
    expect(describeChange(change('buffering', { by: null, waitingFor: [] }), 'p1')).toBeNull();
    expect(describeChange(change('play', { by: null }), 'p1')).toBeNull();
  });
});
