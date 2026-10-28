import { Component } from 'react';

/**
 * Shows the error instead of a blank page when rendering crashes.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
          <h2>Bir hata oluştu</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#a8261b' }}>
            {String(this.state.error?.stack || this.state.error)}
          </pre>
          <button onClick={() => window.location.reload()}>Sayfayı yenile</button>
        </div>
      );
    }
    return this.props.children;
  }
}
