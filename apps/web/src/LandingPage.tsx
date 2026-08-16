import {
  ArrowRight,
  CloudOff,
  Code2,
  Laptop,
  Link2,
  LockKeyhole,
  Radio,
  Smartphone,
} from "lucide-react";
import { BrandMark, Button, StatusPill } from "@directdrop/ui";

const releaseUrl = "https://github.com/HechoLP/directdrop/releases/latest";
const sourceUrl = "https://github.com/HechoLP/directdrop";

export function LandingPage() {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <BrandMark />
          <a
            href={sourceUrl}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
            aria-label="DirectDrop GitHub 저장소"
          >
            <Code2 aria-hidden="true" size={18} /> GitHub
          </a>
        </div>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.05fr_.95fr] lg:px-8 lg:py-28">
          <div>
            <StatusPill tone="success">
              <Radio aria-hidden="true" size={13} /> Direct P2P
            </StatusPill>
            <h1 className="mt-6 max-w-2xl text-4xl font-bold leading-[1.12] tracking-[-.04em] text-slate-950 sm:text-5xl lg:text-6xl">
              클라우드 없이,
              <br />
              <span className="text-blue-700">바로 전달하세요.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
              DirectDrop은 파일을 별도 저장소에 업로드하지 않습니다. 내 컴퓨터와
              상대방 브라우저를 WebRTC로 직접 연결합니다.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href={releaseUrl}>
                <Button className="w-full bg-blue-600 text-white hover:bg-blue-700 sm:w-auto">
                  DirectDrop 다운로드{" "}
                  <ArrowRight aria-hidden="true" size={18} />
                </Button>
              </a>
              <a href={sourceUrl}>
                <Button className="w-full border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 sm:w-auto">
                  <Code2 aria-hidden="true" size={18} /> 소스 보기
                </Button>
              </a>
            </div>
            <p className="mt-4 text-sm text-slate-500">
              Windows · macOS · 브라우저 수신
            </p>
          </div>

          <div
            className="rounded-[28px] border border-slate-200 bg-white p-4 sm:p-6"
            aria-label="DirectDrop 전송 흐름"
          >
            <div className="rounded-2xl bg-slate-50 p-5 sm:p-7">
              <div className="flex items-center justify-between gap-3">
                <span className="grid size-12 place-items-center rounded-2xl bg-blue-600 text-white">
                  <Laptop aria-hidden="true" />
                </span>
                <span className="h-px flex-1 border-t-2 border-dashed border-blue-300" />
                <span className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-blue-700">
                  <Smartphone aria-hidden="true" />
                </span>
              </div>
              <div className="mt-6">
                <p className="text-sm font-bold text-slate-950">
                  Sender → Receiver
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  파일 데이터는 WebRTC DataChannel을 통해 직접 이동합니다.
                </p>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <CloudOff
                    className="text-blue-700"
                    aria-hidden="true"
                    size={20}
                  />
                  <p className="mt-2 text-xs font-semibold">No cloud storage</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <LockKeyhole
                    className="text-blue-700"
                    aria-hidden="true"
                    size={20}
                  />
                  <p className="mt-2 text-xs font-semibold">
                    Temporary & secure
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          className="border-y border-slate-200 bg-white py-16"
          aria-labelledby="features-title"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <h2
              id="features-title"
              className="text-2xl font-bold tracking-tight"
            >
              링크는 가볍게, 전송은 직접
            </h2>
            <div className="mt-8 grid gap-8 md:grid-cols-3">
              {[
                {
                  icon: Link2,
                  title: "임시 공유 링크",
                  body: "만료 시간과 1~1000회 다운로드 제한을 설정합니다.",
                },
                {
                  icon: CloudOff,
                  title: "원본 그대로",
                  body: "파일을 복사·이동·수정하거나 중앙 서버에 저장하지 않습니다.",
                },
                {
                  icon: Radio,
                  title: "실시간 상태",
                  body: "보낸 사람 온라인 여부와 전송 진행률, 연결 방식을 확인합니다.",
                },
              ].map(({ icon: Icon, title, body }) => (
                <article
                  key={title}
                  className="border-l-2 border-blue-600 pl-5"
                >
                  <Icon
                    aria-hidden="true"
                    className="text-blue-700"
                    size={22}
                  />
                  <h3 className="mt-4 font-bold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-slate-950 text-slate-300">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>DirectDrop · Direct files. No cloud.</p>
          <a
            href={sourceUrl}
            className="inline-flex min-h-11 items-center gap-2 text-white hover:underline"
          >
            <Code2 aria-hidden="true" size={17} /> GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
