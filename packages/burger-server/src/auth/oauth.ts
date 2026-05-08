import { createHash, randomBytes } from "node:crypto";

export type Userinfo = {
  sub: string;
  username: string;
  display_name?: string;
  is_admin: boolean;
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export const generateCodeVerifier = (): string =>
  randomBytes(32).toString("base64url");

export const generateCodeChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

export const exchangeCode = async (args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  tokenUrl: string;
  clientId: string;
}): Promise<TokenResponse> => {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    code_verifier: args.codeVerifier,
  });

  const res = await fetch(args.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<TokenResponse>;
};

export const fetchUserinfo = async (args: {
  accessToken: string;
  userinfoUrl: string;
}): Promise<Userinfo> => {
  const res = await fetch(args.userinfoUrl, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`userinfo fetch failed (${res.status})`);
  }

  return res.json() as Promise<Userinfo>;
};
