import { userPreferences, userProfiles } from './profile.schema';

describe('profile schema', () => {
  it('exposes the user-management tables', () => {
    expect(userProfiles).toBeDefined();
    expect(userPreferences).toBeDefined();
  });

  it('defaults a profile to UTC and English', () => {
    // Read by the notification scheduler for quiet hours and template locale.
    expect(userProfiles.timezone.default).toBe('UTC');
    expect(userProfiles.locale.default).toBe('en');
  });
});
