import {
  passwordVerificationResponseSchema,
  publicRuntimeConfigSchema,
  shareMetadataSchema,
  type ShareMetadata,
} from "@directdrop/protocol";

export type PublicRuntimeConfig = {
  appUrl: string;
  signalingUrl: string;
  iceServers: RTCIceServer[];
};

async function checkedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? `HTTP_${response.status}`);
  }
  return response;
}

export async function getRuntimeConfig(): Promise<PublicRuntimeConfig> {
  const response = await checkedFetch("/api/config");
  return publicRuntimeConfigSchema.parse(await response.json());
}

export async function getShare(
  token: string,
  accessToken?: string,
): Promise<ShareMetadata> {
  const response = await checkedFetch(
    `/api/shares/${encodeURIComponent(token)}`,
    {
      headers: accessToken
        ? { authorization: `Bearer ${accessToken}` }
        : undefined,
    },
  );
  return shareMetadataSchema.parse(await response.json());
}

export async function verifySharePassword(
  token: string,
  password: string,
): Promise<string | undefined> {
  const response = await checkedFetch(
    `/api/shares/${encodeURIComponent(token)}/verify`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    },
  );
  const result = passwordVerificationResponseSchema.parse(
    await response.json(),
  );
  return result.accessToken ?? undefined;
}
