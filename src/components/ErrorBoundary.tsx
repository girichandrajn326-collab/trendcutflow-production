import { Component, type ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: unknown) {
    console.error('[ErrorBoundary] Caught:', error);
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-[#0B0F17] flex items-center justify-center px-4">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-red-600/[0.06] rounded-full blur-[120px] pointer-events-none" />
        <div className="relative w-full max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-500/15 border border-red-500/25 flex items-center justify-center mx-auto mb-6">
            <AlertCircle size={28} className="text-red-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">Something went wrong</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-6">
            {this.state.message}
          </p>
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-sky-600/80 text-white hover:bg-sky-600 text-sm font-semibold transition-colors"
          >
            <RotateCcw size={14} />
            Try Again
          </button>
        </div>
      </div>
    );
  }
}
