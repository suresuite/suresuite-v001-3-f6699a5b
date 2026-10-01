/**
 * The route fallback. A page whose code could not be DOWNLOADED (a deploy
 * replaced the chunk, and `lazyChunk`'s one automatic reload is spent) says so
 * and offers only Reload — "Try again" in place cannot work, React.lazy
 * remembers the failure. Any other render error keeps the original screen.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouteErrorFallback } from '../RouteErrorBoundary';

const render = (error: Error) => renderToStaticMarkup(createElement(RouteErrorFallback, { error, onReset: () => {} }));

describe('RouteErrorFallback', () => {
  it('a chunk that could not be fetched asks for a reload', () => {
    const html = render(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Forbidden-1.js'));
    expect(html).toContain('This page could not be loaded');
    expect(html).toContain('Reload');
    expect(html).not.toContain('hit a snag');
    expect(html).not.toContain('Try again');
  });

  it('any other error keeps the original screen', () => {
    const html = render(new Error('boom'));
    expect(html).toContain('This page hit a snag');
    expect(html).toContain('Try again');
    expect(html).toContain('Go home');
  });
});
