'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StateBaseProps {
  title: string;
  description?: string;
  className?: string;
}

export function LoadingState({
  title,
  description,
  className,
}: StateBaseProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn('flex min-h-52 items-center justify-center p-6', className)}
    >
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <Loader2 className="size-5 animate-spin" aria-hidden />
        </div>
        <h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = 'Tentar novamente',
  className,
}: StateBaseProps & { onRetry?: () => void; retryLabel?: string }) {
  return (
    <Card className={cn('border-destructive/30 bg-destructive/5', className)} role="alert">
      <CardContent className="flex min-h-52 flex-col items-center justify-center p-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive ring-1 ring-destructive/20">
          <AlertTriangle className="size-5" aria-hidden />
        </div>
        <h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>}
        {onRetry && (
          <Button type="button" variant="outline" className="mt-5" onClick={onRetry}>
            <RefreshCw className="size-4" aria-hidden />
            {retryLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: StateBaseProps & { action?: ReactNode }) {
  return (
    <Card className={cn('border-dashed border-border/80 bg-card/35', className)}>
      <CardContent className="flex min-h-52 flex-col items-center justify-center p-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-secondary/60 text-muted-foreground ring-1 ring-border">
          <Inbox className="size-5" aria-hidden />
        </div>
        <h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>}
        {action && <div className="mt-5">{action}</div>}
      </CardContent>
    </Card>
  );
}

type BannerVariant = 'info' | 'success' | 'warning' | 'error';

const bannerStyles: Record<BannerVariant, string> = {
  info: 'border-primary/25 bg-primary/10 text-primary',
  success: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
  warning: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  error: 'border-destructive/25 bg-destructive/10 text-destructive',
};

export function OperationBanner({
  title,
  description,
  variant = 'info',
  busy = false,
  action,
  className,
}: StateBaseProps & {
  variant?: BannerVariant;
  busy?: boolean;
  action?: ReactNode;
}) {
  const Icon = busy ? Loader2 : variant === 'success' ? CheckCircle2 : AlertTriangle;
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      aria-busy={busy}
      className={cn('flex items-start gap-3 rounded-2xl border px-4 py-3', bannerStyles[variant], className)}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', busy && 'animate-spin')} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {description && <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</div>}
      </div>
      {action}
    </div>
  );
}
