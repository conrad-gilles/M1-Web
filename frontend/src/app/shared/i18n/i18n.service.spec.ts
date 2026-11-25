import { TestBed } from '@angular/core/testing';
import { I18nService, translate } from './i18n.service';
import { EN, FR } from './translations';

const STORAGE_KEY = 'sharing_platform_language';

describe('I18nService', () => {
  const setBrowserLanguage = (language: string) => {
    Object.defineProperty(navigator, 'languages', { value: [language], configurable: true });
    Object.defineProperty(navigator, 'language', { value: language, configurable: true });
  };

  beforeEach(() => localStorage.removeItem(STORAGE_KEY));
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    setBrowserLanguage('fr-FR'); // valeur de src/test-setup.ts pour les autres tests
  });

  const create = () => {
    TestBed.resetTestingModule();
    return TestBed.inject(I18nService);
  };

  it('chaque clé française a une traduction anglaise non vide', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(FR).sort());
    for (const [key, text] of Object.entries(EN)) expect(text.trim(), key).not.toBe('');
  });

  it('remplace les paramètres, en français comme en anglais', () => {
    expect(translate('fr', 'app.room', { code: 'K7P2QX' })).toBe('Salon K7P2QX');
    expect(translate('en', 'app.room', { code: 'K7P2QX' })).toBe('Room K7P2QX');
    expect(translate('en', 'library.page', { page: 2, pages: 5 })).toBe('Page 2 / 5');
    // Un paramètre absent reste visible plutôt que de disparaître.
    expect(translate('en', 'app.room')).toBe('Room {code}');
  });

  it('première visite : la langue du navigateur (français, sinon anglais)', () => {
    setBrowserLanguage('fr-CA');
    expect(create().language()).toBe('fr');

    setBrowserLanguage('en-US');
    expect(create().language()).toBe('en');

    setBrowserLanguage('de-DE');
    expect(create().language()).toBe('en');
  });

  it('le choix de l’utilisateur est retenu et l’emporte sur le navigateur', () => {
    setBrowserLanguage('fr-FR');
    const i18n = create();

    i18n.use('en');

    expect(i18n.t('app.home')).toBe('Home');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('en');
    expect(create().language()).toBe('en');
  });

  it('traduit les messages du serveur en anglais, les laisse tels quels en français', () => {
    const i18n = create();
    i18n.use('en');

    expect(i18n.server('Salon inconnu')).toBe('Unknown room');
    expect(i18n.server('Salon plein : 20 médias maximum')).toBe('Room full: 20 media at most');
    expect(i18n.server('Message inconnu du dictionnaire')).toBe('Message inconnu du dictionnaire');

    i18n.use('fr');
    expect(i18n.server('Salon inconnu')).toBe('Salon inconnu');
  });

  it('dates selon la langue', () => {
    const i18n = create();
    i18n.use('en');
    expect(i18n.locale()).toBe('en-GB');
    i18n.use('fr');
    expect(i18n.locale()).toBe('fr-FR');
  });
});
