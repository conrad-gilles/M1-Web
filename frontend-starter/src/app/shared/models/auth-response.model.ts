import { User } from './user.model';

/** Authentication response returned after registration or login. */
export interface AuthResponse {
  token: string;
  user: User;
}
