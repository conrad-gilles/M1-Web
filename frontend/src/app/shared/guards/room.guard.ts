import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { RoomSessionService } from '../services/room-session.service';

/**
 * Protects /rooms/:code. Sans session pour ce salon (lien partagé ouvert pour
 * la première fois), on renvoie vers l'accueil avec le code prérempli : il ne
 * reste qu'à saisir un nom d'affichage.
 */
export const roomGuard: CanActivateFn = (route) => {
  const session = inject(RoomSessionService).session();
  const router = inject(Router);
  const code = String(route.paramMap.get('code') ?? '').toUpperCase();

  return session?.code === code ? true : router.createUrlTree(['/'], { queryParams: { code } });
};
