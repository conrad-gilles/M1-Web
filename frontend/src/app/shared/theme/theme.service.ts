import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'sharing_platform_theme';

/**
 * Mode clair ou sombre. Première visite : la préférence du système
 * (prefers-color-scheme) ; ensuite le choix de l'utilisateur, retenu dans
 * localStorage. Le thème est posé sur <html data-theme="…"> : les couleurs
 * sont des variables CSS (styles.css).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(this.initialTheme());

  constructor() {
    this.apply(this.theme());
  }

  toggle(): void {
    this.use(this.theme() === 'dark' ? 'light' : 'dark');
  }

  use(theme: Theme): void {
    this.theme.set(theme);
    this.apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Stockage indisponible : le choix vaut pour cette page.
    }
  }

  private apply(theme: Theme): void {
    document.documentElement.dataset['theme'] = theme;
  }

  private initialTheme(): Theme {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // Stockage indisponible : préférence du système.
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}
