import { createRemoteJWKSet, jwtVerify } from "jose";

export type VerifyToken = (token: string) => Promise<{ sub: string }>;

export function createTokenVerifier(jwksUrl: string, issuer: string): VerifyToken {
  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  return async (token: string) => {
    const { payload } = await jwtVerify(token, jwks, { issuer });
    if (typeof payload.sub !== "string") throw new Error("JWT missing sub");
    return { sub: payload.sub };
  };
}
