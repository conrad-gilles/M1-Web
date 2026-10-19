import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('login() envoie POST /api/auth/login avec email et mot de passe', () => {
    service.login('demo@example.com', 'Demo1234!').subscribe();

    const request = http.expectOne('/api/auth/login');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'demo@example.com', password: 'Demo1234!' });
    request.flush({ token: 'jwt-de-test', user: { id: '1', name: 'Demo', email: 'demo@example.com' } });
  });

  it('login() stocke le token et l\'utilisateur après une réponse réussie', () => {
    service.login('demo@example.com', 'Demo1234!').subscribe();
    http.expectOne('/api/auth/login').flush({
      token: 'jwt-de-test',
      user: { id: '1', name: 'Demo', email: 'demo@example.com' },
    });

    expect(service.token()).toBe('jwt-de-test');
    expect(localStorage.getItem('gpc_token')).toBe('jwt-de-test');
    expect(service.currentUser()?.email).toBe('demo@example.com');
  });

  it('login() ne stocke rien quand le serveur répond 401', () => {
    let status = 0;
    service.login('demo@example.com', 'mauvais').subscribe({ error: (e) => (status = e.status) });

    http.expectOne('/api/auth/login').flush({ message: 'Identifiants invalides' }, { status: 401, statusText: 'Unauthorized' });

    expect(status).toBe(401);
    expect(service.token()).toBeNull();
    expect(localStorage.getItem('gpc_token')).toBeNull();
  });

  it('logout() supprime le token et l\'utilisateur', () => {
    localStorage.setItem('gpc_token', 'jwt-de-test');
    service.token.set('jwt-de-test');

    service.logout();

    expect(service.token()).toBeNull();
    expect(localStorage.getItem('gpc_token')).toBeNull();
    expect(service.currentUser()).toBeNull();
  });
});
