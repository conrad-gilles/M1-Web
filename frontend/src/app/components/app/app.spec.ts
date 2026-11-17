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
