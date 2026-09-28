import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../shared/services/auth.service';

@Component({
  imports: [ReactiveFormsModule],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.css',
})
export class ProfilePageComponent {
  readonly auth = inject(AuthService);
  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  load(): void {
    this.auth.profile().subscribe({
      next: (user) => {
        console.debug('[ProfilePage] Profil chargé', user.id);
        this.form.setValue({ name: user.name });
      },
      error: (error) => console.error('[ProfilePage] Chargement impossible', error),
    });
  }

  save(): void {
    this.auth.update(this.form.getRawValue().name).subscribe({
      next: (user) => console.debug('[ProfilePage] Profil enregistré', user.id),
      error: (error) => console.error('[ProfilePage] Enregistrement impossible', error),
    });
  }
}
