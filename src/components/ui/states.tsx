'use client';
import { usePreferences } from './preferences';
export function LoadingState() {
  const { t } = usePreferences();
  return (
    <div role="status" className="loading-state">
      <span className="skeleton" aria-hidden="true" />
      {t('Loading…')}
    </div>
  );
}
export function EmptyState() {
  const { t } = usePreferences();
  return (
    <p role="status" className="empty-state">
      {t('Nothing here yet.')}
    </p>
  );
}
export function ErrorState({ retry }: { retry?: () => void }) {
  const { t } = usePreferences();
  return (
    <div className="form-error">
      <p role="alert">{t('Something went wrong. Please try again.')}</p>
      {retry ? (
        <button type="button" onClick={retry}>
          {t('Try again')}
        </button>
      ) : null}
    </div>
  );
}
