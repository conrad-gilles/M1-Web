import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Une réponse 401 signifie que le token est absent, invalide ou expiré :
 * l'API a explicitement refusé l'authentification (voir le middleware `auth`
 * dans backend/src/app.js). Dans ce cas, conserver un token périmé côté
 * navigateur n'a plus de sens : on nettoie l'état local et on renvoie
 * l'utilisateur vers /login.
 */
export const sessionExpiredInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        console.warn('[session] Session expirée ou invalide, déconnexion');
        auth.logout();
        void router.navigateByUrl('/login');
      }
      return throwError(() => error);
    }),
  );
};
