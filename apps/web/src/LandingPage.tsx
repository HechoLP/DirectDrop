import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ChevronRight,
  CircleCheck,
  Clock3,
  Code2,
  Cpu,
  Globe2,
  Laptop,
  Link2,
  LockKeyhole,
  MonitorDown,
  Network,
  ShieldCheck,
  Smartphone,
  Wifi,
} from "lucide-react";
import { BrandMark } from "@directdrop/ui";
import {
  chooseDownloadRecommendation,
  type DownloadKey,
  type DownloadRecommendation,
} from "./download-recommendation";

const sourceUrl = "https://github.com/HechoLP/directdrop";
const releaseUrl = `${sourceUrl}/releases/latest`;
const releaseVersion = "v0.2.0";
const releaseDownloadBase = `${sourceUrl}/releases/download/${releaseVersion}`;

type DownloadOption = {
  key: DownloadKey;
  icon: typeof Cpu;
  platform: string;
  title: string;
  detail: string;
  href: string;
};

type NavigatorWithUAData = Navigator & {
  userAgentData?: {
    platform?: string;
    getHighEntropyValues?: (
      hints: string[],
    ) => Promise<{ architecture?: string }>;
  };
};

const downloads: DownloadOption[] = [
  {
    key: "mac-arm64",
    icon: Cpu,
    platform: "macOS",
    title: "Apple Silicon",
    detail: "M1·M2·M3·M4 이후 Mac",
    href: `${releaseDownloadBase}/DirectDrop-${releaseVersion}-macOS-Apple-Silicon-arm64.dmg`,
  },
  {
    key: "mac-intel",
    icon: Laptop,
    platform: "macOS",
    title: "Intel Mac",
    detail: "Intel 프로세서 Mac",
    href: `${releaseDownloadBase}/DirectDrop-${releaseVersion}-macOS-Intel-x64.dmg`,
  },
  {
    key: "windows-x64",
    icon: MonitorDown,
    platform: "Windows",
    title: "Windows 10·11",
    detail: "64비트 NSIS 설치 프로그램",
    href: `${releaseDownloadBase}/DirectDrop-${releaseVersion}-Windows-x64-setup.exe`,
  },
];

const features = [
  {
    icon: Wifi,
    title: "주변 기기로 빠르게",
    body: "같은 Wi-Fi의 기기를 찾아 파일과 폴더를 바로 보냅니다.",
  },
  {
    icon: Link2,
    title: "링크로 어디서나",
    body: "받는 사람은 앱 없이 브라우저에서 파일을 받을 수 있습니다.",
  },
  {
    icon: ShieldCheck,
    title: "파일은 기기 사이로",
    body: "서버에 파일을 저장하지 않고 암호화된 연결로 직접 전송합니다.",
  },
];

const faqs: Array<{ question: string; answer: ReactNode }> = [
  {
    question: "파일이 DirectDrop 서버에 저장되나요?",
    answer:
      "아니요. 서버는 연결에 필요한 임시 메타데이터와 signaling만 처리합니다. 실제 파일 바이트는 WebRTC DataChannel 또는 Nearby의 인증된 TLS 연결로 기기 사이에서 직접 이동합니다.",
  },
  {
    question: "Nearby는 인터넷 없이도 작동하나요?",
    answer:
      "네. 두 컴퓨터가 같은 Wi-Fi 또는 Ethernet에 연결되어 있으면 인터넷 없이 서로를 찾고 파일을 직접 전송할 수 있습니다. 양쪽 모두 DirectDrop v0.2.0 이상이 필요합니다.",
  },
  {
    question: "받는 사람도 프로그램을 설치해야 하나요?",
    answer:
      "Nearby를 사용할 때는 양쪽 기기에 앱이 필요합니다. Share Link는 보내는 사람만 앱을 설치하면 되고, 받는 사람은 최신 Chrome·Edge·Safari 같은 브라우저에서 링크를 열면 됩니다.",
  },
  {
    question: "macOS에서 ‘손상되었기 때문에 열 수 없습니다’가 표시돼요.",
    answer: (
      <div className="space-y-4">
        <p>
          현재 공개 빌드는 Apple Developer ID 서명·공증을 제외했기 때문에
          Gatekeeper가 경고할 수 있습니다. DirectDrop을 Applications 폴더로 옮긴
          뒤 터미널에서 아래 명령을 한 줄씩 실행하세요.
        </p>
        <pre className="overflow-x-auto rounded-2xl border border-black/10 bg-[#0a0a0a] p-4 text-[13px] leading-7 text-zinc-200">
          <code>{`xattr -dr com.apple.quarantine /Applications/DirectDrop.app\nopen /Applications/DirectDrop.app`}</code>
        </pre>
      </div>
    ),
  },
  {
    question: "Mac의 Apple Silicon과 Intel을 어떻게 구분하나요?",
    answer:
      "화면 왼쪽 위 Apple 메뉴에서 ‘이 Mac에 관하여’를 열어 ‘칩’에 M1·M2·M3·M4 등이 보이면 Apple Silicon을, ‘프로세서’에 Intel이 보이면 Intel Mac을 선택하세요. 브라우저가 CPU 정보를 제공하면 DirectDrop이 자동으로 맞는 파일을 가장 크게 표시합니다.",
  },
  {
    question: "모든 네트워크에서 Share Link가 연결되나요?",
    answer:
      "기본 구성은 STUN을 사용하는 Direct P2P 전용입니다. 회사·학교처럼 방화벽이 엄격한 환경이나 일부 NAT에서는 연결이 실패할 수 있으며, 파일을 서버에 업로드하는 방식으로 우회하지 않습니다.",
  },
];

async function detectDownloadRecommendation(): Promise<DownloadRecommendation | null> {
  const browserNavigator = navigator as NavigatorWithUAData;
  let architecture = "";

  try {
    const highEntropy =
      await browserNavigator.userAgentData?.getHighEntropyValues?.([
        "architecture",
      ]);
    architecture = highEntropy?.architecture ?? "";
  } catch {
    // Some privacy-focused browsers intentionally hide CPU architecture.
  }

  return chooseDownloadRecommendation({
    platform:
      browserNavigator.userAgentData?.platform ?? browserNavigator.platform,
    userAgent: browserNavigator.userAgent,
    architecture,
  });
}

function ProductScreenshot() {
  return (
    <div className="dd-product-shot relative mx-auto mt-14 w-full max-w-7xl sm:mt-18">
      <div className="absolute inset-x-[12%] bottom-2 h-28 rounded-full bg-blue-500/20 blur-[90px]" />
      <figure className="relative overflow-hidden rounded-[18px] border border-blue-300/20 bg-[#080b12] shadow-[0_48px_120px_rgba(0,0,0,.6)] sm:rounded-[28px]">
        <img
          src="/directdrop-desktop-actual.png"
          alt="Nearby 전송과 공유 설정이 열린 DirectDrop 데스크톱 프로그램 화면"
          width="2484"
          height="1298"
          fetchPriority="high"
          className="block h-auto w-full"
        />
      </figure>
    </div>
  );
}

export function LandingPage() {
  const [recommendation, setRecommendation] =
    useState<DownloadRecommendation | null>({
      key: "mac-arm64",
      exact: false,
    });
  const [isDetecting, setIsDetecting] = useState(true);

  useEffect(() => {
    let active = true;

    void detectDownloadRecommendation().then((detected) => {
      if (active) {
        setRecommendation(detected);
        setIsDetecting(false);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(".dd-reveal"),
    );

    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) =>
        element.setAttribute("data-visible", "true"),
      );
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-visible", "true");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8%", threshold: 0.12 },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const primaryDownload = useMemo(
    () => downloads.find(({ key }) => key === recommendation?.key) ?? null,
    [recommendation],
  );
  const secondaryDownloads = useMemo(
    () => downloads.filter(({ key }) => key !== primaryDownload?.key),
    [primaryDownload],
  );
  const PrimaryDownloadIcon = primaryDownload?.icon ?? Cpu;

  return (
    <div className="min-h-dvh bg-[#070a10] text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#070a10]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="#main" className="rounded-lg" aria-label="DirectDrop 홈">
            <BrandMark inverse />
          </a>
          <nav
            className="hidden items-center gap-6 text-sm text-zinc-400 md:flex"
            aria-label="주요 메뉴"
          >
            <a className="transition-colors hover:text-white" href="#features">
              기능
            </a>
            <a className="transition-colors hover:text-white" href="#security">
              보안
            </a>
            <a className="transition-colors hover:text-white" href="#download">
              다운로드
            </a>
            <a className="transition-colors hover:text-white" href="#faq">
              FAQ
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <a
              href={sourceUrl}
              className="grid size-11 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="DirectDrop GitHub 저장소"
            >
              <Code2 aria-hidden="true" size={19} />
            </a>
            <a
              href="#download"
              className="hidden min-h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 sm:inline-flex"
            >
              다운로드
            </a>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="dd-dark-grid overflow-hidden border-b border-blue-200/10 px-4 pb-20 pt-20 sm:px-6 sm:pb-28 sm:pt-28 lg:px-8">
          <div className="mx-auto max-w-[1440px] text-center">
            <div className="dd-hero-copy">
              <h1 className="mx-auto max-w-6xl text-[clamp(3.15rem,9vw,8.1rem)] font-semibold leading-[.92] tracking-[-.072em] text-white">
                파일은 멀리 가도,
                <br />
                <span className="text-blue-400">클라우드엔 남지 않게.</span>
              </h1>
              <p className="mx-auto mt-7 max-w-xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
                Nearby는 같은 네트워크에서, Share Link는 어디서든. 파일은
                서버에 저장되지 않습니다.
              </p>
              <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
                <a
                  href="#download"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white transition duration-200 hover:bg-blue-500 active:scale-[.98]"
                >
                  내 기기에 맞게 다운로드
                  <ArrowRight aria-hidden="true" size={18} />
                </a>
                <a
                  href="#features"
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/20 bg-white/[.04] px-6 text-sm font-semibold text-white transition duration-200 hover:bg-white/[.1] active:scale-[.98]"
                >
                  기능 보기
                </a>
              </div>
            </div>
            <ProductScreenshot />
          </div>
        </section>

        <section
          id="features"
          className="scroll-mt-20 bg-[#f7f9fc] py-20 text-slate-950 sm:py-28"
        >
          <div
            className="dd-reveal mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"
            data-visible="false"
          >
            <div className="grid gap-6 lg:grid-cols-[.85fr_1.15fr] lg:items-end">
              <div>
                <h2 className="text-4xl font-semibold tracking-[-.055em] sm:text-6xl">
                  가까이 있어도,
                  <br />
                  멀리 있어도.
                </h2>
              </div>
              <p className="max-w-xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8 lg:justify-self-end">
                주변 기기로 바로 보내거나 링크를 공유하세요. 계정과 업로드는
                필요 없습니다.
              </p>
            </div>

            <div className="mt-12 grid overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,.06)] lg:grid-cols-3">
              {features.map(({ icon: Icon, title, body }) => (
                <article
                  key={title}
                  className="group min-h-64 border-b border-slate-200 p-6 transition duration-200 last:border-b-0 hover:-translate-y-1 hover:bg-blue-50/60 sm:p-8 lg:border-b-0 lg:border-r lg:last:border-r-0"
                >
                  <div className="flex items-start justify-between gap-5">
                    <span className="grid size-11 place-items-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                      <Icon aria-hidden="true" size={21} />
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      size={20}
                      className="text-zinc-300"
                    />
                  </div>
                  <h3 className="mt-10 text-2xl font-semibold tracking-[-.03em]">
                    {title}
                  </h3>
                  <p className="mt-3 max-w-sm text-sm leading-6 text-slate-600">
                    {body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          id="security"
          className="scroll-mt-20 border-y border-white/10 bg-[#0a0f18] py-20 sm:py-28"
        >
          <div
            className="dd-reveal mx-auto grid max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-[.82fr_1.18fr] lg:items-center lg:px-8"
            data-visible="false"
          >
            <div>
              <h2 className="text-4xl font-semibold leading-[1.02] tracking-[-.055em] sm:text-6xl">
                서버는 연결만.
                <br />
                파일은 기기끼리.
              </h2>
              <p className="mt-6 max-w-lg text-base leading-7 text-slate-300">
                암호화된 직접 연결을 사용하고, 정한 시간과 다운로드 횟수가
                지나면 공유를 끝냅니다.
              </p>
            </div>

            <div className="relative overflow-hidden rounded-[28px] border border-white/15 bg-[#0d0d0d] p-5 sm:p-8">
              <div className="absolute -right-20 -top-20 size-64 rounded-full bg-blue-600/15 blur-[80px]" />
              <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-5">
                <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4 text-center sm:p-7">
                  <Laptop
                    aria-hidden="true"
                    className="mx-auto text-blue-400"
                    size={30}
                  />
                  <p className="mt-4 text-sm font-semibold">보내는 기기</p>
                  <p className="mt-1 text-xs text-zinc-500">원본 파일 유지</p>
                </div>
                <div className="flex flex-col items-center gap-2 text-blue-400">
                  <span className="hidden text-[10px] font-semibold tracking-wider sm:block">
                    ENCRYPTED
                  </span>
                  <ArrowRight aria-hidden="true" />
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4 text-center sm:p-7">
                  <Smartphone
                    aria-hidden="true"
                    className="mx-auto text-blue-400"
                    size={30}
                  />
                  <p className="mt-4 text-sm font-semibold">받는 기기</p>
                  <p className="mt-1 text-xs text-zinc-500">바로 저장</p>
                </div>
              </div>
              <div className="relative mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  [LockKeyhole, "암호화 연결", "전송 중 파일을 안전하게 보호"],
                  [CircleCheck, "파일 확인", "받은 파일의 손상 여부 검사"],
                  [Clock3, "자동 만료", "시간이 지나면 공유 종료"],
                  [Network, "직접 전송", "서버에 파일을 저장하지 않음"],
                ].map(([Icon, title, body]) => {
                  const SecurityIcon = Icon as typeof LockKeyhole;
                  return (
                    <div
                      key={String(title)}
                      className="rounded-xl border border-white/10 p-4"
                    >
                      <SecurityIcon
                        aria-hidden="true"
                        size={19}
                        className="text-blue-400"
                      />
                      <p className="mt-3 text-sm font-semibold">
                        {String(title)}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        {String(body)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section
          id="download"
          className="scroll-mt-20 bg-[#f7f9fc] py-20 text-slate-950 sm:py-28"
        >
          <div
            className="dd-reveal mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"
            data-visible="false"
          >
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-4xl font-semibold tracking-[-.055em] sm:text-6xl">
                  내 기기에 맞게.
                </h2>
                <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">
                  운영체제와 CPU에 맞는 설치 파일을 먼저 보여드립니다.
                </p>
              </div>
              <a
                href={releaseUrl}
                className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-zinc-600 transition-colors hover:text-black"
              >
                <Code2 aria-hidden="true" size={18} /> 모든 릴리스
              </a>
            </div>

            <div className="mt-12 grid gap-4 lg:grid-cols-[1.35fr_.65fr]">
              {primaryDownload ? (
                <a
                  href={primaryDownload.href}
                  className="group relative min-h-80 overflow-hidden rounded-[28px] bg-black p-7 text-white transition-transform duration-200 hover:-translate-y-1 sm:p-10"
                >
                  <div className="absolute -right-24 -top-24 size-80 rounded-full bg-blue-600/25 blur-[90px]" />
                  <div className="relative flex h-full flex-col">
                    <div className="flex items-start justify-between gap-4">
                      <span className="grid size-14 place-items-center rounded-2xl border border-white/15 bg-white/[.06] text-blue-400">
                        <PrimaryDownloadIcon aria-hidden="true" size={27} />
                      </span>
                      <span className="rounded-full border border-blue-400/30 bg-blue-400/10 px-3 py-1.5 text-xs font-semibold text-blue-300">
                        {isDetecting
                          ? "기기 확인 중"
                          : recommendation?.exact
                            ? "이 기기에 추천"
                            : "추천 다운로드"}
                      </span>
                    </div>
                    <div className="mt-auto pt-14">
                      <p className="text-xs font-semibold tracking-[.15em] text-zinc-500">
                        {primaryDownload.platform}
                      </p>
                      <h3 className="mt-2 text-4xl font-semibold tracking-[-.05em] sm:text-5xl">
                        {primaryDownload.title}
                      </h3>
                      <p className="mt-3 text-sm text-zinc-400">
                        {primaryDownload.detail}
                      </p>
                      <span className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-black transition-colors group-hover:bg-blue-500 group-hover:text-white">
                        다운로드{" "}
                        <ArrowDownToLine aria-hidden="true" size={18} />
                      </span>
                    </div>
                  </div>
                </a>
              ) : (
                <a
                  href={releaseUrl}
                  className="group min-h-80 rounded-[28px] bg-black p-7 text-white sm:p-10"
                >
                  <Globe2
                    aria-hidden="true"
                    size={30}
                    className="text-blue-400"
                  />
                  <p className="mt-16 text-xs font-semibold tracking-[.15em] text-zinc-500">
                    OTHER PLATFORM
                  </p>
                  <h3 className="mt-3 text-4xl font-semibold tracking-[-.05em]">
                    지원 파일 확인
                  </h3>
                  <p className="mt-3 max-w-md text-sm leading-6 text-zinc-400">
                    현재 브라우저에서 지원 운영체제를 확인하지 못했습니다.
                    GitHub 릴리스에서 모든 설치 파일과 체크섬을 볼 수 있습니다.
                  </p>
                  <span className="mt-7 inline-flex items-center gap-2 text-sm font-semibold">
                    모든 릴리스 <ArrowRight aria-hidden="true" size={18} />
                  </span>
                </a>
              )}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                {secondaryDownloads.map(
                  ({ key, icon: Icon, platform, title, detail, href }) => (
                    <a
                      key={key}
                      href={href}
                      className="group flex min-h-38 items-center gap-4 rounded-[24px] border border-black/15 p-5 transition duration-200 hover:border-black hover:bg-zinc-50 sm:p-6"
                    >
                      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-700 transition-colors group-hover:bg-black group-hover:text-white">
                        <Icon aria-hidden="true" size={23} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-zinc-500">
                          {platform}
                        </p>
                        <h3 className="mt-1 text-lg font-semibold">{title}</h3>
                        <p className="mt-1 text-xs text-zinc-500">{detail}</p>
                      </div>
                      <ArrowDownToLine
                        aria-hidden="true"
                        size={19}
                        className="shrink-0"
                      />
                    </a>
                  ),
                )}
              </div>
            </div>

            {recommendation?.key === "mac-arm64" &&
              !recommendation.exact &&
              !isDetecting && (
                <p className="mt-4 text-xs leading-5 text-zinc-500">
                  브라우저가 Mac의 CPU 정보를 숨겨 Apple Silicon을 우선
                  추천했습니다. Intel Mac이라면 오른쪽의 Intel 설치 파일을
                  선택하세요.
                </p>
              )}
          </div>
        </section>

        <section
          id="faq"
          className="scroll-mt-20 border-t border-slate-200 bg-[#eef3f9] py-20 text-slate-950 sm:py-28"
        >
          <div
            className="dd-reveal mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[.65fr_1.35fr] lg:px-8"
            data-visible="false"
          >
            <div>
              <h2 className="text-4xl font-semibold tracking-[-.055em] sm:text-5xl">
                자주 묻는 질문
              </h2>
            </div>
            <div className="divide-y divide-black/15 border-y border-black/15">
              {faqs.map(({ question, answer }) => (
                <details key={question} className="group">
                  <summary className="flex min-h-18 cursor-pointer list-none items-center justify-between gap-5 py-5 text-left text-base font-semibold marker:hidden sm:text-lg">
                    {question}
                    <span className="grid size-9 shrink-0 place-items-center rounded-full border border-black/15 transition-transform duration-200 group-open:rotate-90 group-open:bg-black group-open:text-white">
                      <ChevronRight aria-hidden="true" size={17} />
                    </span>
                  </summary>
                  <div className="max-w-3xl pb-6 pr-12 text-sm leading-7 text-zinc-600">
                    {answer}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

      </main>

      <footer className="border-t border-white/10 bg-[#070a10] text-slate-400">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div>
            <BrandMark inverse />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <a
              href="#features"
              className="min-h-11 content-center transition-colors hover:text-white"
            >
              기능
            </a>
            <a
              href="#faq"
              className="min-h-11 content-center transition-colors hover:text-white"
            >
              FAQ
            </a>
            <a
              href={sourceUrl}
              className="inline-flex min-h-11 items-center gap-2 text-white hover:underline"
            >
              <Code2 aria-hidden="true" size={17} /> GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
