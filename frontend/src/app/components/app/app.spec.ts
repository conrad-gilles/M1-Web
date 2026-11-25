import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RoomSessionService } from '../../shared/services/room-session.service';
import { AppComponent } from './app';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;

  const links = () =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('nav a')).map((a) => ({
      text: a.textContent?.trim(),
      href: a.getAttribute('href'),
    }));

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  afterEach(() => localStorage.clear());

  it('affiche le nom du site et le lien vers l’accueil', () => {
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('header b')?.textContent).toContain('Sharing Platform');
    expect(links()).toEqual([{ text: 'Accueil', href: '/' }]);
  });

  it('le bouton EN passe toute l’interface en anglais, FR la remet en français', () => {
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const button = (label: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.language button')).find((b) => b.textContent === label)!;

    expect(button('FR').getAttribute('aria-pressed')).toBe('true');

    button('EN').click();
    fixture.detectChanges();
    expect(links()).toEqual([{ text: 'Home', href: '/' }]);
    expect(root.querySelector('header small')?.textContent).toBe('Listen and watch together, at the same moment');
    expect(button('EN').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('sharing_platform_language')).toBe('en');

    button('FR').click();
    fixture.detectChanges();
    expect(links()).toEqual([{ text: 'Accueil', href: '/' }]);
  });

  it('le bouton 🌙 / ☀️ passe en mode sombre puis en mode clair', () => {
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.theme-toggle')!;
    const start = document.documentElement.dataset['theme'];

    toggle.click();
    fixture.detectChanges();
    const switched = document.documentElement.dataset['theme'];
    expect(switched).not.toBe(start);
    expect(toggle.getAttribute('aria-pressed')).toBe(String(switched === 'dark'));
    expect(toggle.textContent?.trim()).toBe(switched === 'dark' ? '☀️' : '🌙');
    expect(toggle.title).toBe(switched === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre');

    toggle.click();
    fixture.detectChanges();
    expect(document.documentElement.dataset['theme']).toBe(start);
  });

  it('propose de revenir au salon en cours, et suit la session', () => {
    fixture = TestBed.createComponent(AppComponent);
    const session = TestBed.inject(RoomSessionService);

    session.open({
      room: { code: 'K7P2QX', participants: [], expiresAt: '2026-11-16T10:00:00.000Z' },
      participant: { id: 'p1', name: 'Alex' },
      token: 'jeton',
    });
    fixture.detectChanges();
    expect(links()).toContainEqual({ text: 'Salon K7P2QX', href: '/rooms/K7P2QX' });

    session.close();
    fixture.detectChanges();
    expect(links()).toEqual([{ text: 'Accueil', href: '/' }]);
  });
});
