import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  CloudOff,
  Code2,
  Cpu,
  FileUp,
  Globe2,
  Laptop,
  Link2,
  LockKeyhole,
  MonitorDown,
  Radio,
  ShieldCheck,
  Smartphone,
  Wifi,
} from "lucide-react";
import { BrandMark, StatusPill } from "@directdrop/ui";

const sourceUrl = "https://github.com/HechoLP/directdrop";
const releaseUrl = `${sourceUrl}/releases/latest`;
const releaseVersion = "v0.1.4";
const releaseDownloadBase = `${sourceUrl}/releases/download/${releaseVersion}`;

const downloads = [
  {
    icon: Cpu,
    label: "macOS",
    title: "Apple Silicon",
    detail: "M1 이후 Apple Silicon Mac",
    href: `${releaseDownloadBase}/DirectDrop-${releaseVersion}-macOS-Apple-Silicon-arm64.dmg`,
    recommended: true,
  },
  {
    icon: Laptop,
    label: "macOS",
    title: "Intel Mac",
    detail: "Intel 프로세서 Mac",
    href: `${releaseDownloadBase}/DirectDrop-${releaseVersion}-macOS-Intel-x64.dmg`,
    recommended: false,
  },
  {
    icon: MonitorDown,
    label: "Windows",
    title: "Windows 10·11",
    detail: "64비트 설치 프로그램",
    href: `${releaseDownloadBase}/DirectDrop-${releaseVersion}-Windows-x64-setup.exe`,
    recommended: false,
  },
];

const steps = [
  {
    icon: FileUp,
    number: "01",
    title: "파일을 고릅니다",
    body: "데스크톱 앱에서 여러 파일을 선택하고 만료 시간과 다운로드 횟수를 정합니다.",
  },
  {
    icon: Link2,
    number: "02",
    title: "링크를 보냅니다",
    body: "임시 링크나 QR 코드를 전달합니다. 원본 파일은 아직 내 컴퓨터에만 있습니다.",
  },
  {
    icon: ArrowDownToLine,
    number: "03",
    title: "브라우저에서 받습니다",
    body: "상대방이 링크를 열면 WebRTC로 연결되어 파일이 기기 사이를 직접 이동합니다.",
  },
];

const faqs = [
  {
    question: "파일이 DirectDrop 서버에 저장되나요?",
    answer:
      "아니요. 서버는 연결에 필요한 임시 메타데이터와 signaling만 처리합니다. 실제 파일 바이트는 WebRTC DataChannel을 통해 송신자와 수신자 사이에서 직접 이동합니다.",
  },
  {
    question: "파일을 보내는 동안 앱을 꺼도 되나요?",
    answer:
      "전송이 끝날 때까지 송신자의 DirectDrop 앱과 컴퓨터가 온라인이어야 합니다. 공유를 중지하거나 앱을 종료하면 링크로 더 이상 받을 수 없습니다.",
  },
  {
    question: "모든 네트워크에서 연결되나요?",
    answer:
      "기본 구성은 STUN을 사용하는 Direct P2P 전용입니다. 회사·학교처럼 방화벽이 엄격한 환경이나 일부 NAT에서는 연결이 실패할 수 있으며, 서버 업로드 방식으로 우회하지 않습니다.",
  },
  {
    question: "받는 사람도 프로그램을 설치해야 하나요?",
    answer:
      "아니요. 받는 사람은 최신 Chrome, Edge, Safari 등 지원 브라우저에서 공유 링크를 열면 됩니다. 대용량 파일은 Chrome 또는 Edge 사용을 권장합니다.",
  },
];

export function LandingPage() {
  return (
    <div className="min-h-dvh bg-white text-[#191f28]">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="#main" className="rounded-xl" aria-label="DirectDrop 홈">
            <BrandMark />
          </a>
          <nav
            className="hidden items-center gap-1 md:flex"
            aria-label="주요 메뉴"
          >
            <a
              href="#how"
              className="inline-flex min-h-11 items-center rounded-xl px-3.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950"
            >
              작동 방식
            </a>
            <a
              href="#security"
              className="inline-flex min-h-11 items-center rounded-xl px-3.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950"
            >
              보안
            </a>
            <a
              href="#download"
              className="inline-flex min-h-11 items-center rounded-xl px-3.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950"
            >
              다운로드
            </a>
          </nav>
          <a
            href={sourceUrl}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
            aria-label="DirectDrop GitHub 저장소"
          >
            <Code2 aria-hidden="true" size={18} />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </header>

      <main id="main">
        <section className="overflow-hidden border-b border-slate-200 bg-[#f7f8fa]">
          <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.02fr_.98fr] lg:px-8 lg:py-28">
            <div>
              <a
                href={releaseUrl}
                className="inline-flex min-h-9 items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100"
              >
                <Radio aria-hidden="true" size={13} />
                {releaseVersion} 최신 릴리스
                <ChevronRight aria-hidden="true" size={14} />
              </a>
              <h1 className="mt-7 max-w-3xl text-[2.75rem] font-bold leading-[1.08] tracking-[-.055em] text-[#191f28] sm:text-6xl lg:text-[4.35rem]">
                파일은 클라우드 말고,
                <br />
                <span className="text-blue-600">상대방에게 바로.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-[#4e5968] sm:text-lg sm:leading-8">
                업로드를 기다릴 필요 없이 링크 하나로 시작하세요. DirectDrop은
                내 컴퓨터와 상대방 브라우저를 직접 연결합니다.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <a
                  href="#download"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-blue-700"
                >
                  내 기기에 맞게 다운로드
                  <ArrowRight aria-hidden="true" size={18} />
                </a>
                <a
                  href="#how"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 transition-colors duration-200 hover:bg-slate-100"
                >
                  1분 만에 알아보기
                </a>
              </div>
              <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-[#6b7684]">
                {["파일 저장 0B", "수신자 설치 없음", "오픈 소스"].map(
                  (item) => (
                    <span
                      key={item}
                      className="inline-flex items-center gap-1.5"
                    >
                      <Check
                        aria-hidden="true"
                        size={16}
                        className="text-blue-600"
                      />
                      {item}
                    </span>
                  ),
                )}
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
              <div className="absolute -left-16 top-20 hidden w-44 rounded-2xl border border-slate-200 bg-white p-4 lg:block">
                <CloudOff
                  aria-hidden="true"
                  className="text-blue-600"
                  size={22}
                />
                <p className="mt-3 text-xs font-semibold text-[#8b95a1]">
                  클라우드 저장
                </p>
                <p className="mt-0.5 text-xl font-bold text-[#191f28]">0 B</p>
              </div>
              <div className="rounded-[28px] border border-slate-200 bg-white p-3 shadow-[0_24px_60px_rgba(15,23,42,.10)] sm:p-4">
                <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-[#f7f8fa]">
                  <div className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4">
                    <div
                      className="flex items-center gap-1.5"
                      aria-hidden="true"
                    >
                      <span className="size-2.5 rounded-full bg-red-400" />
                      <span className="size-2.5 rounded-full bg-amber-400" />
                      <span className="size-2.5 rounded-full bg-emerald-400" />
                    </div>
                    <span className="text-xs font-bold text-[#6b7684]">
                      DirectDrop
                    </span>
                    <StatusPill tone="success">공유 중</StatusPill>
                  </div>
                  <div className="p-5 sm:p-7">
                    <p className="text-xs font-bold tracking-[.12em] text-blue-600">
                      ACTIVE SHARE
                    </p>
                    <div className="mt-3 flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                          파일을 받을 준비가 됐어요
                        </h2>
                        <p className="mt-1 text-sm leading-6 text-[#6b7684]">
                          링크를 받은 사람이 접속하면 바로 연결합니다.
                        </p>
                      </div>
                      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-blue-600 text-white">
                        <Link2 aria-hidden="true" size={21} />
                      </span>
                    </div>

                    <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-4">
                      <p className="text-xs font-semibold text-blue-700">
                        공유 링크
                      </p>
                      <p className="mt-1 truncate text-sm font-bold text-blue-700 sm:text-base">
                        share.dlfkd.dev/s/direct-file
                      </p>
                    </div>

                    <div className="mt-3 space-y-2">
                      {[
                        ["DirectDrop-guide.pdf", "2.4 MB"],
                        ["project-assets.zip", "84.7 MB"],
                      ].map(([name, size]) => (
                        <div
                          key={name}
                          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5"
                        >
                          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                            <FileUp aria-hidden="true" size={19} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                            {name}
                          </span>
                          <span className="text-xs font-medium text-[#8b95a1]">
                            {size}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 flex items-center gap-3 rounded-2xl bg-[#191f28] px-4 py-3.5 text-white">
                      <Wifi
                        aria-hidden="true"
                        size={20}
                        className="text-blue-400"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold">WebRTC 직접 연결</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          Sender → Receiver
                        </p>
                      </div>
                      <span className="size-2 rounded-full bg-emerald-400" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-8 -right-8 hidden w-48 rounded-2xl border border-slate-200 bg-white p-4 lg:block">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                    <ShieldCheck aria-hidden="true" size={21} />
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-[#8b95a1]">
                      전송 경로
                    </p>
                    <p className="mt-0.5 text-sm font-bold">기기 간 직접</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-bold text-blue-600">HOW IT WORKS</p>
              <h2 className="mt-3 text-3xl font-bold tracking-[-.035em] sm:text-4xl">
                세 단계면 충분해요
              </h2>
              <p className="mt-4 text-base leading-7 text-[#6b7684]">
                회원가입이나 파일 업로드 없이, 보내는 사람이 직접 공유를
                시작합니다.
              </p>
            </div>
            <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-6">
              {steps.map(({ icon: Icon, number, title, body }) => (
                <li
                  key={number}
                  className="relative border-t border-slate-200 pt-7"
                >
                  <div className="flex items-center justify-between">
                    <span className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-blue-600">
                      <Icon aria-hidden="true" size={23} />
                    </span>
                    <span className="text-sm font-bold text-[#b0b8c1]">
                      {number}
                    </span>
                  </div>
                  <h3 className="mt-6 text-xl font-bold">{title}</h3>
                  <p className="mt-3 max-w-sm text-sm leading-6 text-[#6b7684]">
                    {body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          id="security"
          className="scroll-mt-20 bg-[#f7f8fa] py-20 sm:py-28"
        >
          <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[.9fr_1.1fr] lg:items-center lg:px-8">
            <div>
              <p className="text-sm font-bold text-blue-600">
                NO CLOUD STORAGE
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-[-.035em] sm:text-4xl">
                서버가 파일을
                <br />
                보관하지 않아요
              </h2>
              <p className="mt-5 max-w-lg text-base leading-7 text-[#6b7684]">
                DirectDrop 서버는 연결을 맺기 위한 signaling과 임시 메타데이터만
                처리합니다. 실제 파일은 송신자의 디스크에서 수신자의 브라우저로
                바로 전달됩니다.
              </p>
              <a
                href={`${sourceUrl}/blob/main/docs/architecture.md`}
                className="mt-6 inline-flex min-h-11 items-center gap-1.5 rounded-xl text-sm font-bold text-blue-600 hover:text-blue-700"
              >
                아키텍처 자세히 보기
                <ArrowRight aria-hidden="true" size={17} />
              </a>
            </div>

            <div className="rounded-[28px] bg-[#191f28] p-5 text-white sm:p-8">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-5">
                <div className="rounded-2xl bg-white/8 p-4 text-center sm:p-6">
                  <Laptop
                    aria-hidden="true"
                    className="mx-auto text-blue-400"
                    size={28}
                  />
                  <p className="mt-3 text-sm font-bold">보내는 기기</p>
                  <p className="mt-1 text-xs text-slate-400">원본 파일</p>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <span className="hidden text-[10px] font-bold tracking-wider text-blue-400 sm:block">
                    WEBRTC
                  </span>
                  <ArrowRight aria-hidden="true" className="text-blue-400" />
                </div>
                <div className="rounded-2xl bg-white/8 p-4 text-center sm:p-6">
                  <Smartphone
                    aria-hidden="true"
                    className="mx-auto text-blue-400"
                    size={28}
                  />
                  <p className="mt-3 text-sm font-bold">받는 브라우저</p>
                  <p className="mt-1 text-xs text-slate-400">바로 저장</p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  {
                    icon: Clock3,
                    title: "자동 만료",
                    body: "시간이 지나면 공유 링크를 자동 종료합니다.",
                  },
                  {
                    icon: LockKeyhole,
                    title: "접근 제어",
                    body: "비밀번호와 1~1000회 다운로드 제한을 설정합니다.",
                  },
                ].map(({ icon: Icon, title, body }) => (
                  <div
                    key={title}
                    className="rounded-2xl border border-white/10 p-4"
                  >
                    <Icon
                      aria-hidden="true"
                      className="text-blue-400"
                      size={20}
                    />
                    <h3 className="mt-3 text-sm font-bold">{title}</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      {body}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-xs leading-5 text-slate-400">
                연결이 불가능한 네트워크에서는 서버 업로드로 우회하지 않고
                전송을 중단합니다.
              </p>
            </div>
          </div>
        </section>

        <section id="download" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-bold text-blue-600">DOWNLOAD</p>
                <h2 className="mt-3 text-3xl font-bold tracking-[-.035em] sm:text-4xl">
                  내 컴퓨터에 맞게 받으세요
                </h2>
                <p className="mt-4 text-base leading-7 text-[#6b7684]">
                  받는 사람은 설치할 필요가 없습니다.
                </p>
              </div>
              <a
                href={releaseUrl}
                className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[#4e5968] hover:text-[#191f28]"
              >
                <Code2 aria-hidden="true" size={18} />
                모든 릴리스 보기
              </a>
            </div>

            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              {downloads.map(
                ({ icon: Icon, label, title, detail, href, recommended }) => (
                  <a
                    key={title}
                    href={href}
                    className="group relative rounded-[24px] border border-slate-200 p-6 transition duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50/40"
                  >
                    {recommended && (
                      <span className="absolute right-5 top-5 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                        Apple Silicon 권장
                      </span>
                    )}
                    <span className="grid size-12 place-items-center rounded-2xl bg-slate-100 text-[#4e5968] transition-colors group-hover:bg-blue-100 group-hover:text-blue-700">
                      <Icon aria-hidden="true" size={23} />
                    </span>
                    <p className="mt-6 text-xs font-bold text-[#8b95a1]">
                      {label}
                    </p>
                    <h3 className="mt-1 text-xl font-bold">{title}</h3>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <p className="text-sm text-[#6b7684]">{detail}</p>
                      <ArrowDownToLine
                        aria-hidden="true"
                        size={19}
                        className="shrink-0 text-blue-600"
                      />
                    </div>
                  </a>
                ),
              )}
            </div>

            <div className="mt-8 grid overflow-hidden rounded-[24px] border border-amber-200 bg-amber-50 lg:grid-cols-[.8fr_1.2fr]">
              <div className="p-6 sm:p-8">
                <div className="flex items-center gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white text-amber-700">
                    <ShieldCheck aria-hidden="true" size={22} />
                  </span>
                  <div>
                    <p className="text-xs font-bold text-amber-800">
                      macOS 안내
                    </p>
                    <h3 className="mt-0.5 font-bold text-[#191f28]">
                      ‘손상되었기 때문에 열 수 없습니다’가 보이나요?
                    </h3>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-[#6b7684]">
                  현재 앱은 Apple 공증 전 빌드라 Gatekeeper 경고가 표시될 수
                  있습니다. 앱을 Applications 폴더로 옮긴 뒤 아래 명령을 한 줄씩
                  실행하세요.
                </p>
              </div>
              <pre className="m-0 overflow-x-auto border-t border-amber-200 bg-[#191f28] p-6 text-[13px] leading-7 text-slate-200 lg:border-l lg:border-t-0 lg:p-8">
                <code>{`xattr -dr com.apple.quarantine /Applications/DirectDrop.app\nopen /Applications/DirectDrop.app`}</code>
              </pre>
            </div>
            <p className="mt-4 text-xs leading-5 text-[#8b95a1]">
              설치 파일은 현재 코드 서명·공증되지 않았습니다. 다운로드 후
              릴리스의 SHA256SUMS.txt를 확인할 수 있습니다.
            </p>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-[#f7f8fa] py-20 sm:py-24">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-bold text-blue-600">FAQ</p>
            <h2 className="mt-3 text-3xl font-bold tracking-[-.035em]">
              자주 묻는 질문
            </h2>
            <div className="mt-9 divide-y divide-slate-200 border-y border-slate-200">
              {faqs.map(({ question, answer }) => (
                <details key={question} className="group py-1">
                  <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 font-bold marker:hidden">
                    {question}
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-[#6b7684] transition-transform group-open:rotate-90">
                      <ChevronRight aria-hidden="true" size={18} />
                    </span>
                  </summary>
                  <p className="max-w-3xl pb-6 pr-10 text-sm leading-7 text-[#6b7684]">
                    {answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-blue-600 py-16 text-white sm:py-20">
          <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
            <div>
              <Globe2 aria-hidden="true" size={28} className="text-blue-200" />
              <h2 className="mt-4 text-3xl font-bold tracking-[-.035em]">
                파일 공유, 더 직접적으로.
              </h2>
              <p className="mt-3 text-sm leading-6 text-blue-100">
                보낼 사람만 앱을 설치하면 바로 시작할 수 있습니다.
              </p>
            </div>
            <a
              href="#download"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-blue-700 transition-colors duration-200 hover:bg-blue-50"
            >
              DirectDrop 다운로드
              <ArrowRight aria-hidden="true" size={18} />
            </a>
          </div>
        </section>
      </main>

      <footer className="bg-[#191f28] text-slate-400">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-9 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div>
            <BrandMark inverse />
            <p className="mt-3 text-xs">Direct files. No cloud.</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a href="#how" className="min-h-11 content-center hover:text-white">
              작동 방식
            </a>
            <a
              href={`${sourceUrl}/blob/main/README.md`}
              className="min-h-11 content-center hover:text-white"
            >
              문서
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
