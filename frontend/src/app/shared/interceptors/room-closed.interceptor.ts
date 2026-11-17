import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { RoomSessionService } from '../services/room-session.service';

/**
 * Une réponse 401 signifie que le jeton de salon n'est plus accepté : salon
 * fermé par l'hôte, expiré, ou quitté (voir le middleware `roomAuth` dans
 * backend/src/middleware/roomAuth.js). Conserver ce jeton n'a plus de sens :
 * on oublie la session et on revient à l'accueil.
 */
export const roomClosedInterceptor: HttpInterceptorFn = (request, next) => {
  const session = inject(RoomSessionService);
  const router = inject(Router);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && session.session()) {
        console.warn('[room] Salon fermé ou jeton refusé, retour à l’accueil');
        session.close();
        void router.navigate(['/'], { queryParams: { closed: 1 } });
      }
      return throwError(() => error);
    }),
  );
};
