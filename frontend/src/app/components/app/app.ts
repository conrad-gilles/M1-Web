import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { I18nService } from '../../shared/i18n/i18n.service';
import { RoomSessionService } from '../../shared/services/room-session.service';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent {
  readonly session = inject(RoomSessionService).session;
  readonly i18n = inject(I18nService);
  readonly t = this.i18n.t;
  readonly language = this.i18n.language;
}
