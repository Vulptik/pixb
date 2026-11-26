import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { requestOrigin } from '@/lib/server/publicUrl';
// Types inferred from @simplewebauthn/server (not directly exported)
type RegistrationResponseJSON = Parameters<typeof verifyRegistrationResponse>[0]['response'];
type AuthenticationResponseJSON = Parameters<typeof verifyAuthenticationResponse>[0]['response'];
type AuthenticatorTransportFuture =
  'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';

export function getRpId(hostOrRequest?: string | Request): string {
  if (hostOrRequest instanceof Request) {
    return new URL(requestOrigin(hostOrRequest.headers, hostOrRequest.url)).hostname;
  }
  if (process.env.PUBLIC_URL) {
    try {
      return new URL(process.env.PUBLIC_URL).hostname;
    } catch {
      // fall through
    }
  }
  if (typeof hostOrRequest === 'string') {
    return hostOrRequest.split(':')[0];
  }
  return 'localhost';
}

export function getOrigin(hostOrRequest?: string | Request): string {
  if (hostOrRequest instanceof Request) {
    return requestOrigin(hostOrRequest.headers, hostOrRequest.url);
  }
  if (process.env.PUBLIC_URL) {
    try {
      const url = new URL(process.env.PUBLIC_URL);
      return url.origin;
    } catch {
      // fall through
    }
  }
  if (typeof hostOrRequest === 'string') {
    return `https://${hostOrRequest}`;
  }
  return 'http://localhost:3000';
}

export async function generatePasskeyRegistrationOptions(opts: {
  userId: string;
  userName: string;
  rpId: string;
  existingCredentialIds?: string[];
}) {
  return generateRegistrationOptions({
    rpName: 'PixB',
    rpID: opts.rpId,
    userID: new Uint8Array(new TextEncoder().encode(opts.userId)) as Uint8Array<ArrayBuffer>,
    userName: opts.userName,
    attestationType: 'none',
    excludeCredentials: (opts.existingCredentialIds || []).map((id) => ({
      id,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });
}

export async function verifyPasskeyRegistration(opts: {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRPID: string;
}) {
  return verifyRegistrationResponse({
    response: opts.response,
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: opts.expectedOrigin,
    expectedRPID: opts.expectedRPID,
  });
}

export async function generatePasskeyAuthenticationOptions(opts: {
  rpId: string;
  credentialIds?: Uint8Array[];
}) {
  return generateAuthenticationOptions({
    rpID: opts.rpId,
    allowCredentials: (opts.credentialIds || []).map((id) => ({
      id: Buffer.from(id).toString('base64url'),
    })),
    userVerification: 'preferred',
  });
}

export async function verifyPasskeyAuthentication(opts: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRPID: string;
  credentialPublicKey: Uint8Array;
  credentialCurrentCounter: number;
}) {
  return verifyAuthenticationResponse({
    response: opts.response,
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: opts.expectedOrigin,
    expectedRPID: opts.expectedRPID,
    credential: {
      id: opts.response.id,
      publicKey: new Uint8Array(opts.credentialPublicKey) as Uint8Array<ArrayBuffer>,
      counter: opts.credentialCurrentCounter,
    },
  });
}

export type { RegistrationResponseJSON, AuthenticationResponseJSON, AuthenticatorTransportFuture };
