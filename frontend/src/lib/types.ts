export type Role = "admin" | "employee";

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  mobile: string | null;
  role: Role;
  permissions?: string[];
  avatar_path: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}
