import { Component, type ReactNode } from 'react'

interface State { failed: boolean }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }
  static getDerivedStateFromError(): State { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="p-8">
        <h1 className="text-xl font-bold">Algo salió mal</h1>
        <a className="underline" href="/">Volver al inicio</a>
      </div>
    )
  }
}
