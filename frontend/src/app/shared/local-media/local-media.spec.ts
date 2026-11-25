import { formatDuration, sameDuration } from './local-media';

describe('local-media', () => {
  it('deux fichiers sont le même média si leurs durées diffèrent d’au plus 1 s', () => {
    expect(sameDuration(5423.48, 5423.48)).toBe(true);
    expect(sameDuration(5423.48, 5424.3)).toBe(true);
    expect(sameDuration(5423.48, 5422.5)).toBe(true);
    expect(sameDuration(5423.48, 5424.6)).toBe(false);
    expect(sameDuration(8, 180)).toBe(false);
  });

  it('formate une durée en m:ss ou h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(83)).toBe('1:23');
    expect(formatDuration(5423.4)).toBe('1:30:23');
    expect(formatDuration(3600)).toBe('1:00:00');
  });
});
