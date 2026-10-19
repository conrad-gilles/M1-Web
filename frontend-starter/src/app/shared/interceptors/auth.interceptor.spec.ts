import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../services/auth.service';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => {
    controller.verify();
    localStorage.clear();
  });

  it('ajoute Authorization: Bearer <token> quand un token existe', () => {
    auth.token.set('jwt-de-test');

    http.get('/api/tracks').subscribe();

    const request = controller.expectOne('/api/tracks');
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-de-test');
    request.flush({});
  });

  it('n\'ajoute pas Authorization quand il n\'y a pas de token', () => {
    auth.token.set(null);

    http.post('/api/auth/login', {}).subscribe();

    const request = controller.expectOne('/api/auth/login');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });

  it('utilise le token courant à chaque requête (après une connexion)', () => {
    http.get('/api/a').subscribe();
    expect(controller.expectOne('/api/a').request.headers.has('Authorization')).toBe(false);

    auth.token.set('nouveau-jwt');
    http.get('/api/b').subscribe();
    expect(controller.expectOne('/api/b').request.headers.get('Authorization')).toBe('Bearer nouveau-jwt');
  });
});
