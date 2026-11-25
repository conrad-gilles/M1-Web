import { Injectable, signal } from '@angular/core';
import { EN, FR, SERVER_MESSAGES_EN, TranslationKey } from './translations';

export type Language = 'fr' | 'en';
export type TranslationParams = Record<string, string | number>;
/** Fonction de traduction, passée aux fonctions pures (describeChange…). */
export type Translate = (key: TranslationKey, params?: TranslationParams) => string;

const STORAGE_KEY = 'sharing_platform_language';

/** Traduction pure : utilisable sans Angular (tests, fonctions pures). */
export function translate(language: Language, key: TranslationKey, params: TranslationParams = {}): string {
  const text: string = language === 'en' ? EN[key] : FR[key];
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/**
 * Langue de l'interface (français ou anglais). Premier choix : la langue du
 * navigateur ; ensuite celle choisie par l'utilisateur, retenue dans
 * localStorage. Les templates appellent `t('clé')` : la lecture du signal
 * `language` les met à jour dès que la langue change.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly language = signal<Language>(this.initialLanguage());

  constructor() {
    document.documentElement.lang = this.language();
  }

  readonly t: Translate = (key, params) => translate(this.language(), key, params);

  /** Traduit un message du backend (toujours en français), sinon le rend tel quel. */
  readonly server = (message: string): string =>
    this.language() === 'en' ? (SERVER_MESSAGES_EN[message] ?? message) : message;

  /** Locale pour les dates (« 24 nov. 2026 » / « Nov 24, 2026 »). */
  locale(): string {
    return this.language() === 'en' ? 'en-GB' : 'fr-FR';
  }

  use(language: Language): void {
    this.language.set(language);
    document.documentElement.lang = language;
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Stockage indisponible (navigation privée stricte) : le choix vaut pour cette page.
    }
  }

  private initialLanguage(): Language {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'fr' || saved === 'en') return saved;
    } catch {
      // Stockage indisponible : on retombe sur la langue du navigateur.
    }
    // Langue préférée du navigateur : français si elle l'est, anglais sinon.
    const preferred = navigator.languages?.[0] ?? navigator.language ?? '';
    return preferred.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  }
}
