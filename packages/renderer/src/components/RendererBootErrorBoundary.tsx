import type { RendererFatalPayload } from "@spira/shared";
import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import { createRendererFatalPayload } from "../renderer-fatal.js";
import { RendererCrashScreen } from "./RendererCrashScreen.js";

interface RendererBootErrorBoundaryProps {
  children: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo, fatal: RendererFatalPayload) => void;
}

interface RendererBootErrorBoundaryState {
  fatal: RendererFatalPayload | null;
}

export class RendererBootErrorBoundary extends Component<
  RendererBootErrorBoundaryProps,
  RendererBootErrorBoundaryState
> {
  state: RendererBootErrorBoundaryState = {
    fatal: null,
  };

  static getDerivedStateFromError(error: unknown): RendererBootErrorBoundaryState {
    return {
      fatal: createRendererFatalPayload(error, "runtime"),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const fatal = createRendererFatalPayload(error, "runtime", errorInfo.componentStack ?? undefined);
    this.setState({ fatal });
    this.props.onError?.(error, errorInfo, fatal);
  }

  render() {
    if (this.state.fatal) {
      return <RendererCrashScreen fatal={this.state.fatal} />;
    }

    return this.props.children;
  }
}
