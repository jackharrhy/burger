export type AuthConfig = {
  fourmUrl: string;
  burgerUrl: string;
  clientId: string;
  isProduction: boolean;
};

export const loadAuthConfig = (env = process.env): AuthConfig => ({
  fourmUrl: env.FOURM_URL ?? "http://localhost:8000",
  burgerUrl: env.BURGER_URL ?? "http://localhost:5000",
  clientId: env.FOURM_CLIENT_ID ?? "burger",
  isProduction: env.NODE_ENV === "production",
});

export const buildRedirectUri = (cfg: AuthConfig): string =>
  `${cfg.burgerUrl}/auth/4orm/callback`;

export const buildAuthorizeUrl = (cfg: AuthConfig): string =>
  `${cfg.fourmUrl}/oauth/authorize`;

export const buildTokenUrl = (cfg: AuthConfig): string =>
  `${cfg.fourmUrl}/oauth/token`;

export const buildUserinfoUrl = (cfg: AuthConfig): string =>
  `${cfg.fourmUrl}/oauth/userinfo`;
