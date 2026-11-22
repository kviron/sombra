import {Component, type ErrorInfo, type ReactNode} from 'react';
import {recordDesktopDiagnostic} from '@/shared/api/diagnostics';
import {ErrorScreen} from './ErrorScreen';

export type ErrorFallbackProps = {error: Error; componentStack: string | null; reset: () => void};

type Props = {
 children: ReactNode;
 fallback?: (props: ErrorFallbackProps) => ReactNode;
 onError?: (error: Error, info: ErrorInfo) => void;
};

type State = {failure: {error: Error; componentStack: string | null} | null};

/** Проверка границы ошибок в разработке: адрес ?crash=1 роняет интерфейс после первого кадра. */
function requestedCrash(): boolean {
 return import.meta.env.DEV && new URLSearchParams(window.location.search).has('crash');
}

/**
 * Граница ошибок React по документации: ловит сбои отрисовки во всём дереве ниже себя.
 * События, таймеры и промисы сюда не попадают — их видно в журнале через window.onerror.
 */
export default class ErrorBoundary extends Component<Props, State> {
 state: State = {failure: null};

 static getDerivedStateFromError(error: unknown): State {
  return {failure: {error: error instanceof Error ? error : new Error(String(error)), componentStack: null}};
 }

 componentDidMount() {
  if (requestedCrash())
   this.setState({failure: {error: new Error('Проверка границы ошибок: ?crash=1'), componentStack: null}});
 }

 componentDidCatch(error: Error, info: ErrorInfo) {
  // Только здесь React отдаёт дерево компонентов, поэтому сохраняем его рядом с ошибкой.
  this.setState({failure: {error, componentStack: info.componentStack ?? null}});
  recordDesktopDiagnostic('webview', 'render_error');
  this.props.onError?.(error, info);
  if (import.meta.env.DEV) console.error('[Сомбра] сбой отрисовки', error, info.componentStack);
 }

 reset = () => {
  this.setState({failure: null});
 };

 render(): ReactNode {
  const {failure} = this.state;
  if (!failure) return this.props.children;
  if (this.props.fallback)
   return this.props.fallback({error: failure.error, componentStack: failure.componentStack, reset: this.reset});
  return (
   <ErrorScreen
    error={failure.error}
    componentStack={failure.componentStack}
    onRetry={this.reset}
    onReload={() => window.location.reload()}
   />
  );
 }
}
