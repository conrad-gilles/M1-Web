import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register-page.html',
  styleUrl: './register-page.css',
})
export class RegisterPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly error = signal('');
  
  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  submit(): void {
    const values = this.form.getRawValue();
    this.auth.register(values.name, values.email, values.password).subscribe({
      next: () => {
        console.debug('[RegisterPage] Inscription réussie');
        void this.router.navigateByUrl('/profile');
      },
      error: (error: { error?: { message?: string } }) => {
        console.error('[RegisterPage] Échec de l’inscription', error);
        this.error.set(error.error?.message ?? 'Erreur d’inscription');
      },
    });
  }
}
