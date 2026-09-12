import { listMessagesSchema } from './list-messages.dto';

describe('listMessagesSchema', () => {
  it('applies defaults and coerces query strings', () => {
    expect(listMessagesSchema.parse({})).toEqual({
      mailbox: 'INBOX',
      page: 1,
      limit: 50,
      unseenOnly: false,
    });
    expect(
      listMessagesSchema.parse({ page: '2', limit: '10', unseenOnly: 'true' }),
    ).toEqual({
      mailbox: 'INBOX',
      page: 2,
      limit: 10,
      unseenOnly: true,
      accountId: undefined,
    });
  });

  it('caps limit at 100', () => {
    expect(() => listMessagesSchema.parse({ limit: '500' })).toThrow();
  });

  it('coerces the string "false" to false, not true', () => {
    expect(listMessagesSchema.parse({ unseenOnly: 'false' })).toEqual({
      mailbox: 'INBOX',
      page: 1,
      limit: 50,
      unseenOnly: false,
      accountId: undefined,
    });
  });
});
