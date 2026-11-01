import React, { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallbackView?: () => void;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error?.message || "Unexpected issue" };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[SUNDAY PWA] Caught component error:", error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#04070d",
            color: "#f6e9d8",
            fontFamily: "system-ui, -apple-system, sans-serif",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <img
            src="/icons/pwa-192.png"
            alt="SUNDAY"
            style={{ width: "80px", height: "80px", borderRadius: "20px", marginBottom: "16px" }}
          />
          <h2 style={{ margin: "0 0 8px 0", fontSize: "22px", fontWeight: 700 }}>Sunday is resetting...</h2>
          <p style={{ margin: "0 0 20px 0", opacity: 0.8, maxWidth: "340px", fontSize: "14px" }}>
            The application recovered smoothly. Click below to return to the Animation Studio.
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false });
              window.location.href = "/";
            }}
            style={{
              padding: "10px 20px",
              background: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Open Sunday Studio
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

