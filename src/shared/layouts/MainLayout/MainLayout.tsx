// Каркас приложения: слоты заголовка, содержимого, фона и ручек изменения размера.
import {memo, type ReactElement} from 'react';

type MainLayoutProps = {
 className?: string;
 titleBar: ReactElement;
 content: ReactElement;
 ambient?: ReactElement;
 resizeHandles?: ReactElement;
};

/** Раскладка окна без логики: страницы и провайдеры приходят слотами сверху. */
export const MainLayout = memo(({className = '', titleBar, content, ambient, resizeHandles}: MainLayoutProps) => (
 <div className={`app-surface bg-background text-foreground relative flex h-svh flex-col overflow-hidden ${className}`}>
  {ambient}
  {titleBar}
  {content}
  {resizeHandles}
 </div>
));
