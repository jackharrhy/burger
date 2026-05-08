import { expect, test, mock } from "bun:test";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  exchangeCode,
  fetchUserinfo,
} from "../../src/auth/oauth";

test("generateCodeVerifier returns base64url string", () => {
  const v = generateCodeVerifier();
  expect(typeof v).toBe("string");
  expect(v.length).toBeGreaterThanOrEqual(43);
  expect(/^[A-Za-z0-9_-]+$/.test(v)).toBe(true);
});

test("generateCodeChallenge produces deterministic sha256 base64url", () => {
  // Known: SHA256("hello") base64url = "LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ"
  const challenge = generateCodeChallenge("hello");
  expect(challenge).toBe("LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ");
});

test("exchangeCode posts to token endpoint with PKCE verifier", async () => {
  const fetchMock = mock(async (url: string, init: RequestInit) => {
    expect(url).toBe("http://example.test/oauth/token");
    const body = init.body as string;
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=abc");
    expect(body).toContain("code_verifier=verifier123");
    return new Response(
      JSON.stringify({ access_token: "tok", token_type: "Bearer", expires_in: 3600 }),
    );
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const result = await exchangeCode({
    code: "abc",
    codeVerifier: "verifier123",
    redirectUri: "http://burger/auth/4orm/callback",
    tokenUrl: "http://example.test/oauth/token",
    clientId: "burger",
  });

  expect(result.access_token).toBe("tok");
});

test("fetchUserinfo passes bearer token", async () => {
  const fetchMock = mock(async (url: string, init: RequestInit) => {
    expect(url).toBe("http://example.test/oauth/userinfo");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    return new Response(
      JSON.stringify({
        sub: "user1",
        username: "jack",
        display_name: "Jack",
        is_admin: true,
      }),
    );
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const info = await fetchUserinfo({
    accessToken: "tok",
    userinfoUrl: "http://example.test/oauth/userinfo",
  });

  expect(info.sub).toBe("user1");
  expect(info.is_admin).toBe(true);
});

test("exchangeCode throws on non-2xx", async () => {
  const fetchMock = mock(async () => new Response("bad", { status: 400 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  expect(
    exchangeCode({
      code: "abc",
      codeVerifier: "v",
      redirectUri: "x",
      tokenUrl: "http://example.test/oauth/token",
      clientId: "burger",
    }),
  ).rejects.toThrow();
});
