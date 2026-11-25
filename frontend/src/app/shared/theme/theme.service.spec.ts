import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

const STORAGE_KEY = 'sharing_platform_theme';

describe('ThemeService', () => {
  const systemPrefersDark = (dark: boolean) =>
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: dark } as MediaQueryList);

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    // jsdom n'implémente pas matchMedia : on le fournit pour pouvoir le simuler.
    window.matchMedia ??= (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(STORAGE_KEY);
    delete document.documentElement.dataset['theme'];
  });

  const create = () => {
    TestBed.resetTestingModule();
    return TestBed.inject(ThemeService);
  };

  it('première visite : suit la préférence du système', () => {
    systemPrefersDark(true);
    expect(create().theme()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');

    systemPrefersDark(false);
    expect(create().theme()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('le bouton bascule entre clair et sombre, et le choix est retenu', () => {
    systemPrefersDark(false);
    const theme = create();

    theme.toggle();
    expect(theme.theme()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');

    theme.toggle();
    expect(theme.theme()).toBe('light');
  });

  it('le choix de l’utilisateur l’emporte sur le système', () => {
    localStorage.setItem(STORAGE_KEY, 'light');
    systemPrefersDark(true);

    expect(create().theme()).toBe('light');
  });
});
