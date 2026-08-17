export type DownloadKey = "mac-arm64" | "mac-intel" | "windows-x64";

export type DownloadRecommendation = {
  key: DownloadKey;
  exact: boolean;
};

type NavigatorSignals = {
  platform?: string;
  userAgent?: string;
  architecture?: string;
};

export function chooseDownloadRecommendation({
  platform = "",
  userAgent = "",
  architecture = "",
}: NavigatorSignals): DownloadRecommendation | null {
  const platformSignal = `${platform} ${userAgent}`.toLowerCase();
  const architectureSignal = architecture.toLowerCase();

  if (platformSignal.includes("windows")) {
    return { key: "windows-x64", exact: true };
  }

  if (platformSignal.includes("mac")) {
    if (/arm|aarch64/.test(architectureSignal)) {
      return { key: "mac-arm64", exact: true };
    }
    if (/x86|x64|amd64/.test(architectureSignal)) {
      return { key: "mac-intel", exact: true };
    }
    return { key: "mac-arm64", exact: false };
  }

  return null;
}
