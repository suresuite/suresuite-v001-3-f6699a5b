/**
 * The phone tab bar offers only what the account may open (mobile-ui-spec §4.2):
 * the sidebar's rule, `canAccessPage`. A tab that only bounces a restricted
 * account to /forbidden is not a destination.
 */
import { describe, expect, it } from 'vitest';
import { MOBILE_TAB_ROUTES, visibleTabs } from '../mobileRootRoutes';

const tabs = MOBILE_TAB_ROUTES.map((to) => ({ to }));

describe('visibleTabs', () => {
  it('full access keeps all four, in order', () => {
    expect(visibleTabs(tabs, () => true).map((t) => t.to)).toEqual([...MOBILE_TAB_ROUTES]);
  });

  it('a restricted account loses exactly the tabs it may not open', () => {
    const allowed = new Set(['/policies', '/project-intelligence']);
    expect(visibleTabs(tabs, (to) => allowed.has(to)).map((t) => t.to)).toEqual([
      '/policies',
      '/project-intelligence',
    ]);
  });

  it('no tab at all is allowed — More alone remains, which the bar adds itself', () => {
    expect(visibleTabs(tabs, () => false)).toEqual([]);
  });
});
