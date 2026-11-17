import { bootstrapApplication } from "@angular/platform-browser";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { provideRouter } from "@angular/router";
import { AppComponent } from './app/components/app/app';
import { routes } from './app/routes';
import { roomClosedInterceptor } from './app/shared/interceptors/room-closed.interceptor';
import { roomTokenInterceptor } from './app/shared/interceptors/room-token.interceptor';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([roomTokenInterceptor, roomClosedInterceptor])),
  ],
}).catch(console.error);
