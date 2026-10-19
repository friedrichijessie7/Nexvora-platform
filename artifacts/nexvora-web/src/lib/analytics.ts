type AnalyticsProperties = Record<string, string | number | boolean>;

type PlausibleOptions = {
  props?: AnalyticsProperties;
};

type PlausibleTracker = ((eventName: string, options?: PlausibleOptions) => void) & {
  q?: Array<[string, PlausibleOptions?]>;
};

declare global {
  interface Window {
    plausible?: PlausibleTracker;
  }
}

function initializePlausible(): void {
  const domain = import.meta.env.VITE_PLAUSIBLE_DOMAIN?.trim();
  if (typeof window === 'undefined' || typeof document === 'undefined' || !domain) return;
  if (typeof window.plausible === 'function') return;

  const tracker = ((...args: [string, PlausibleOptions?]) => {
    tracker.q?.push(args);
  }) as PlausibleTracker;
  tracker.q = [];
  window.plausible = tracker;

  const script = document.createElement('script');
  script.defer = true;
  script.dataset.domain = domain;
  script.src = 'https://plausible.io/js/script.js';
  script.addEventListener('error', () => {
    if (window.plausible === tracker) window.plausible = undefined;
  });
  document.head.appendChild(script);
}

initializePlausible();

export function trackEvent(name: string, properties?: AnalyticsProperties): void {
  if (typeof window === 'undefined') return;

  try {
    window.plausible?.(name, properties ? { props: properties } : undefined);
  } catch {
    // Analytics must never break the app.
  }
}
