import {Component, type ErrorInfo, type ReactNode} from 'react';

export type ErrorFallbackProps = {error: Error; componentStack: string | null; reset: () => void};

type Props = {
 children: ReactNode;
 fallback?: (props: ErrorFallbackProps) => ReactNode;
 onError?: (error: Error, info: ErrorInfo) => void;
};

type State = {failure: {error: Error; componentStack: string | null} | null};

/**
 * Граница ошибок React по документации: ловит сбои отрисовки во всём дереве ниже себя.
 * События, таймеры и промисы сюда не попадают — их видно в журнале через window.onerror.
 */
export class ErrorBoundary extends Component<Props, State> {
 state: State = {failure: null};

 static getDerivedStateFromError(error: unknown): State {
  return {failure: {error: error instanceof Error ? error : new Error(String(error)), componentStack: null}};
 }

 componentDidCatch(error: Error, info: ErrorInfo) {
  // Стек компонентов приходит только здесь, поэтому сохраняем его рядом с ошибкой.
  this.setState({failure: {error, componentStack: info.componentStack ?? null}});
  this.props.onError?.(error, info);
 }

 reset = () => {
  this.setState({failure: null});
 };

 render(): ReactNode {
  const {failure} = this.state;
  if (!failure) return this.props.children;
  return this.props.fallback?.({error: failure.error, componentStack: failure.componentStack, reset: this.reset}) ?? null;
 }
}
