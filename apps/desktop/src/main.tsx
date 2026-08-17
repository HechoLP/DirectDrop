import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error?: Error }
> {
  override state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("DirectDrop UI crashed", error, errorInfo);
  }

  override render() {
    if (this.state.error) {
      return (
        <main className="dd-fatal-error" role="alert">
          <strong>DirectDrop 화면을 불러오지 못했습니다.</strong>
          <p>{this.state.error.message}</p>
          <button type="button" onClick={() => window.location.reload()}>
            다시 불러오기
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
