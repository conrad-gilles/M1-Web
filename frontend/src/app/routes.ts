import { Routes } from '@angular/router';
import { HomePageComponent } from './components/home-page/home-page';
import { RoomPageComponent } from './components/room-page/room-page';
import { roomGuard } from './shared/guards/room.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: HomePageComponent },
  { path: 'rooms/:code', component: RoomPageComponent, canActivate: [roomGuard] },
  { path: '**', redirectTo: '' },
];
