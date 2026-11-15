import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, convertToParamMap } from '@angular/router';
import { RoomSessionService } from '../services/room-session.service';
import { roomGuard } from './room.guard';

describe('roomGuard', () => {
  let session: RoomSessionService;
  let router: Router;

  const run = (code: string) =>
    TestBed.runInInjectionContext(() =>
      roomGuard(
        { paramMap: convertToParamMap({ code }) } as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot,
      ),
    );

  const open = (code: string) =>
    session.open({
      room: { code, participants: [], expiresAt: '2026-11-16T10:00:00.000Z' },
      participant: { id: 'p1', name: 'Alex' },
      token: 'jeton',
    });

  beforeEach(() => {
    sessionStorage.clear();
    session = TestBed.inject(RoomSessionService);
    router = TestBed.inject(Router);
  });

  afterEach(() => sessionStorage.clear());

  it("sans session : redirige vers l'accueil avec le code du lien prérempli", () => {
    const result = run('k7p2qx');

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/?code=K7P2QX');
  });

  it('avec une session pour un autre salon : redirige aussi', () => {
    open('AAAAAA');

    expect(router.serializeUrl(run('K7P2QX') as UrlTree)).toBe('/?code=K7P2QX');
  });

  it('avec une session pour ce salon : autorise la navigation', () => {
    open('K7P2QX');

    expect(run('K7P2QX')).toBe(true);
    expect(run('k7p2qx')).toBe(true);
  });
});
