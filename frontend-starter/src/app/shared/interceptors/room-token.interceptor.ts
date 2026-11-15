import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { RoomSessionService } from '../services/room-session.service';

/** Adds the room token to API requests made from inside a room. */
export const roomTokenInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(RoomSessionService).token();

  return next(
    token
      ? request.clone({
          setHeaders: { Authorization: `Bearer ${token}` },
        })
      : request,
  );
};
