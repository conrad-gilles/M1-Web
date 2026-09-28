import { bootstrapApplication } from "@angular/platform-browser";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { provideRouter } from "@angular/router";
import { AppComponent } from './app/components/app/app';
import { routes } from './app/routes';
import { authInterceptor } from './app/shared/interceptors/auth.interceptor';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
}).catch(console.error);
