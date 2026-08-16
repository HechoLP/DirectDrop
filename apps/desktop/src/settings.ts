export type ShareSettings = {
  downloadLimit: number | null;
  expiresInMs: number | null;
  appLifetime: boolean;
  password: string;
  approvalMode: "AUTO" | "MANUAL";
  allowRelay: boolean;
};

export const defaultSettings: ShareSettings = {
  downloadLimit: 1,
  expiresInMs: 60 * 60 * 1000,
  appLifetime: false,
  password: "",
  approvalMode: "AUTO",
  allowRelay: false,
};

export const presets = [
  {
    id: "once",
    label: "일회용",
    detail: "1회 / 1시간",
    downloadLimit: 1,
    expiresInMs: 60 * 60 * 1000,
  },
  {
    id: "friend",
    label: "친구에게 보내기",
    detail: "3회 / 24시간",
    downloadLimit: 3,
    expiresInMs: 24 * 60 * 60 * 1000,
  },
  {
    id: "group",
    label: "그룹 공유",
    detail: "10회 / 24시간",
    downloadLimit: 10,
    expiresInMs: 24 * 60 * 60 * 1000,
  },
] as const;

export function expirationIso(settings: ShareSettings, now = Date.now()) {
  return settings.expiresInMs === null
    ? null
    : new Date(now + settings.expiresInMs).toISOString();
}
