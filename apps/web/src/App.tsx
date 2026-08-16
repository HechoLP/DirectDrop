import { LandingPage } from "./LandingPage";
import { ReceiverPage } from "./ReceiverPage";

export function App() {
  const match = window.location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/);
  return match?.[1] ? <ReceiverPage token={match[1]} /> : <LandingPage />;
}
