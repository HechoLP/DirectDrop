import { LandingPage } from "./LandingPage";
import { ReceiverPage } from "./ReceiverPage";

const sharePathPattern = /^\/s\/([A-Za-z0-9_-]+)\/?$/;

export function App() {
  const match = window.location.pathname.match(sharePathPattern);
  return match?.[1] ? <ReceiverPage token={match[1]} /> : <LandingPage />;
}
