import {
  serviceCredentials,
  sessions,
  userRole,
  users,
} from './identity.schema';

describe('identity schema', () => {
  it('defines user_role with the four roles', () => {
    expect(userRole.enumValues).toEqual(['guest', 'user', 'admin', 'agent']);
  });

  it('exposes the identity tables', () => {
    expect(users).toBeDefined();
    expect(sessions).toBeDefined();
    expect(serviceCredentials).toBeDefined();
  });
});
