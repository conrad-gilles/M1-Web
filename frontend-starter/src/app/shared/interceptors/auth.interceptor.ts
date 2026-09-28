import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { AuthService } from '../services/auth.service';

/** Adds the bearer token to protected API requests. */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(AuthService).token();

  return next(
    token
      ? request.clone({
          setHeaders: { Authorization: `Bearer ${token}` },
        })
      : request,
  );
};
