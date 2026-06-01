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

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="h-screen w-screen flex flex-col items-center justify-center p-8"
          style={{ backgroundColor: '#130A1B', color: '#B8A5C5' }}
        >
          <AlertCircle className="w-12 h-12 mb-4" style={{ color: '#E74C3C' }} />
          <h2 className="text-h1 font-bold mb-2" style={{ color: '#FFFFFF' }}>
            Something went wrong
          </h2>
          <p className="text-body mb-2 text-center max-w-md">
            The app encountered an error. This is a safety net to prevent the black screen.
          </p>
          <div
            className="p-3 rounded-md mb-4 max-w-lg w-full overflow-auto"
            style={{ backgroundColor: '#1D1127', border: '1px solid #2D1F3F' }}
          >
            <code className="text-micro" style={{ color: '#E74C3C' }}>
              {this.state.error}
            </code>
          </div>
          <button
            onClick={this.handleReload}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-small font-medium"
            style={{ backgroundColor: '#6B3D8B', color: 'white' }}
          >
            <RefreshCw className="w-4 h-4" />
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
