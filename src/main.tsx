import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

/** Shows a way back instead of a blank page if something in the app crashes. Saved records stay on the device and in the cloud. */
class CrashScreen extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("Daybook crashed", error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="paper-sheet" role="alert" style={{ maxWidth: 420, margin: "15vh auto", padding: 24, textAlign: "center" }}>
      <h1>Something went wrong</h1>
      <p>Your saved entries are safe. Reload Daybook to carry on.</p>
      <button className="primary-button" type="button" onClick={() => window.location.reload()}>Reload Daybook</button>
    </main>;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CrashScreen>
      <App />
    </CrashScreen>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
