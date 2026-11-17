import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { RoomSessionService } from '../../shared/services/room-session.service';
import { HomePageComponent } from './home-page';

const access = (code = 'K7P2QX') => ({
  room: { code, participants: [], expiresAt: '2026-11-16T10:00:00.000Z' },
  participant: { id: 'p1', name: 'Alex' },
  token: 'jeton-de-salon',
});

describe('HomePageComponent', () => {
  let fixture: ComponentFixture<HomePageComponent>;
  let component: HomePageComponent;
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  const create = (query: Record<string, string> = {}) => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(HomePageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('crée un salon puis ouvre sa page', () => {
    create();
    component.createForm.setValue({ name: '  Alex ' });

    component.create();
    const request = http.expectOne('/api/rooms');
    expect(request.request.body).toEqual({ name: 'Alex' });
    request.flush({ ...access(), hostToken: 'secret-hote' });

    expect(navigate).toHaveBeenCalledWith(['/rooms', 'K7P2QX']);
    expect(TestBed.inject(RoomSessionService).isHost()).toBe(true);
    expect(localStorage.getItem('gpc_display_name')).toBe('Alex');
  });

  it("n'envoie rien sans nom d'affichage valide", () => {
    create();

    for (const name of ['', '   ', 'x'.repeat(31)]) {
      component.createForm.setValue({ name });
      component.create();
    }
    // http.verify() (afterEach) échoue si une requête a été envoyée
    expect(navigate).not.toHaveBeenCalled();
  });

  it('rejoint un salon avec le code et le nom', () => {
    create();
    component.joinForm.setValue({ code: 'k7p2qx', name: 'Sam' });

    component.join();
    const request = http.expectOne('/api/rooms/K7P2QX/join');
    expect(request.request.body).toEqual({ name: 'Sam' });
    request.flush(access());

    expect(navigate).toHaveBeenCalledWith(['/rooms', 'K7P2QX']);
  });

  it("n'envoie rien avec un code qui n'a pas 6 caractères", () => {
    create();

    for (const code of ['', 'ABC', 'ABCDEFG', 'AB CD1']) {
      component.joinForm.setValue({ code, name: 'Sam' });
      component.join();
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it('affiche le message du serveur quand le code est inconnu', () => {
    create();
    component.joinForm.setValue({ code: 'ZZZZZZ', name: 'Sam' });

    component.join();
    http.expectOne('/api/rooms/ZZZZZZ/join').flush({ message: 'Salon inconnu' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(component.joinError()).toBe('Salon inconnu');
    expect(component.pending()).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain('Salon inconnu');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('empêche une double soumission pendant la requête', () => {
    create();
    component.createForm.setValue({ name: 'Alex' });

    component.create();
    component.create();

    http.expectOne('/api/rooms').flush(access());
  });

  it('préremplit le code venu d’un lien partagé et le nom mémorisé', () => {
    localStorage.setItem('gpc_display_name', 'Alex');

    create({ code: 'K7P2QX' });

    expect(component.joinForm.getRawValue()).toEqual({ code: 'K7P2QX', name: 'Alex' });
    expect(component.createForm.getRawValue()).toEqual({ name: 'Alex' });
  });

  it('explique le retour à l’accueil quand le salon a été fermé', () => {
    create({ closed: '1' });

    expect(text()).toContain('Ce salon a été fermé ou a expiré.');
  });

  it('propose de retourner dans le salon en cours', () => {
    localStorage.setItem(
      'gpc_room_session',
      JSON.stringify({ code: 'K7P2QX', token: 'jeton', participant: { id: 'p1', name: 'Alex' } }),
    );

    create();

    const link = (fixture.nativeElement as HTMLElement).querySelector('.message a');
    expect(link?.getAttribute('href')).toBe('/rooms/K7P2QX');
  });
});
