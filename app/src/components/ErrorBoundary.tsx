import React, { Component, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error?.message || 'Unknown error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center p-8 gap-3"
          style={{ backgroundColor: '#130A1B', color: '#B8A5C5', minHeight: '300px' }}
        >
          <AlertCircle className="w-10 h-10" style={{ color: '#E74C3C' }} />
          <h2 className="text-h2 font-bold" style={{ color: '#FFFFFF' }}>
            Something went wrong
          </h2>
          <p className="text-small text-center max-w-md" style={{ color: '#8A7D99' }}>
            A rendering error occurred. Try reloading or retrying.
          </p>
          <div
            className="p-2 rounded-md max-w-lg w-full overflow-auto"
            style={{ backgroundColor: '#1D1127', border: '1px solid #2D1F3F' }}
          >
            <code className="text-micro" style={{ color: '#E74C3C' }}>
              {this.state.error}
            </code>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={this.handleRetry}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-small font-medium"
              style={{ backgroundColor: '#2D1F3F', color: '#B8A5C5', border: '1px solid #4A3569' }}
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
            <button
              onClick={this.handleReload}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-small font-medium"
              style={{ backgroundColor: '#6B3D8B', color: 'white' }}
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
