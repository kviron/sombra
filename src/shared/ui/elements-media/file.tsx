import {TooltipLabel} from '@/shared/ui/tooltip';
// assistant-ui Elements File (MIT). Source commit 076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c.
// https://github.com/assistant-ui/assistant-ui/blob/076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c/packages/ui/src/components/react/assistant-ui/elements/file.tsx
// Sombra adaptation: the card keeps upstream geometry, icons and slots, but the download is a
// button that calls the existing id-based safe path instead of building a data:/http href.
import {cva, type VariantProps} from 'class-variance-authority';
import {
 BracesIcon,
 DownloadIcon,
 FileIcon,
 FileTextIcon,
 ImageIcon,
 MusicIcon,
 VideoIcon,
 type LucideIcon
} from 'lucide-react';
import type {ComponentProps, ReactNode} from 'react';
import {cn} from '@/shared/lib/utils';
import {fileIconKind, formatFileSize, type FileIconKind} from './file-data';

const FILE_ICONS: Record<FileIconKind, LucideIcon> = {
 image: ImageIcon,
 pdf: FileTextIcon,
 json: BracesIcon,
 text: FileTextIcon,
 audio: MusicIcon,
 video: VideoIcon,
 file: FileIcon
};

export function getMimeTypeIcon(mimeType: string): LucideIcon {
 return FILE_ICONS[fileIconKind(mimeType)];
}

const fileVariants = cva('aui-file-root inline-flex items-center gap-3 rounded-lg transition-colors', {
 variants: {
  variant: {
   outline: 'border-border hover:bg-muted/50 border',
   ghost: 'hover:bg-muted/50',
   muted: 'bg-muted/50 hover:bg-muted/70'
  },
  size: {
   sm: 'px-2.5 py-1.5 text-xs',
   default: 'px-3 py-2 text-sm',
   lg: 'px-4 py-3 text-base'
  }
 },
 defaultVariants: {
  variant: 'outline',
  size: 'default'
 }
});

export type FileRootProps = ComponentProps<'div'> & VariantProps<typeof fileVariants>;

export function FileRoot({className, variant, size, children, ...props}: FileRootProps) {
 return (
  <div
   data-slot="file-root"
   data-variant={variant}
   data-size={size}
   className={cn(fileVariants({variant, size, className}))}
   {...props}
  >
   {children}
  </div>
 );
}

export type FileIconDisplayProps = ComponentProps<'span'> & {
 mimeType?: string;
};

export function FileIconDisplay({mimeType, className, children, ...props}: FileIconDisplayProps) {
 const IconComponent = mimeType ? getMimeTypeIcon(mimeType) : FileIcon;

 return (
  <span data-slot="file-icon" className={cn('text-muted-foreground shrink-0', className)} {...props}>
   {children ?? <IconComponent className="size-5" />}
  </span>
 );
}

export function FileName({className, children, ...props}: ComponentProps<'span'>) {
 return (
  <span data-slot="file-name" className={cn('min-w-0 flex-1 truncate font-medium', className)} {...props}>
   {children || 'Файл'}
  </span>
 );
}

export type FileSizeProps = ComponentProps<'span'> & {
 bytes: number;
};

export function FileSize({bytes, className, ...props}: FileSizeProps) {
 return (
  <span data-slot="file-size" className={cn('text-muted-foreground shrink-0', className)} {...props}>
   {formatFileSize(bytes)}
  </span>
 );
}

export type FileDownloadProps = Omit<ComponentProps<'button'>, 'onClick'> & {
 filename?: string | undefined;
 busy?: boolean | undefined;
 onDownload: () => void;
 children?: ReactNode;
};

/** Upstream FileDownload surface, wired to Sombra's authorised save path. */
export function FileDownload({filename, busy = false, onDownload, className, children, ...props}: FileDownloadProps) {
 return (
  <TooltipLabel content="Скачать файл">
   <button
    type="button"
    data-slot="file-download"
    disabled={busy}
    aria-label={`Скачать ${filename || 'файл'}`}
    className={cn(
     'text-muted-foreground hover:bg-accent hover:text-accent-foreground shrink-0 rounded-md p-1 transition-colors disabled:opacity-50',
     className
    )}
    onClick={event => {
     event.stopPropagation();
     onDownload();
    }}
    {...props}
   >
    {children || <DownloadIcon className="size-4" />}
   </button>
  </TooltipLabel>
 );
}

export {fileVariants};
