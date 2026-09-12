// The mock factory below must be self-contained (no references to outer
// `const`/`let` bindings): @swc/jest hoists `require('./transport/imap.transport')`
// above this file's own top-level statements, so any outer variable
// referenced inside the factory would still be in its TDZ when the factory
// runs. Same pattern as ./transport/smtp.transport.spec.ts — configure the
// mocks after importing them instead of closing over outer consts.
jest.mock('./transport/imap.transport', () => ({
  verifyImap: jest.fn(async () => undefined),
  listMessages: jest.fn(async () => []),
  fetchMessage: jest.fn(async () => null),
  setSeen: jest.fn(async () => undefined),
}));

import {
  fetchMessage,
  listMessages,
  setSeen,
  verifyImap,
} from './transport/imap.transport';
import { InboxService } from './inbox.service';
import { NoActiveEmailConfigError } from './email.types';

const mockVerifyImap = verifyImap as jest.Mock;
const mockListMessages = listMessages as jest.Mock;
const mockFetchMessage = fetchMessage as jest.Mock;
const mockSetSeen = setSeen as jest.Mock;

const conn = {
  host: 'h',
  port: 993,
  secure: true,
  username: 'u',
  password: 'p',
};

describe('InboxService', () => {
  let repo: any;
  let service: InboxService;

  beforeEach(() => {
    mockVerifyImap.mockClear();
    mockListMessages.mockClear();
    mockFetchMessage.mockClear();
    mockSetSeen.mockClear();
    repo = { activeImap: jest.fn(async () => conn), activeSmtp: jest.fn() };
    service = new InboxService(repo);
  });

  it('list resolves the active config and delegates', async () => {
    await service.list({ limit: 10 });
    expect(mockListMessages).toHaveBeenCalledWith(conn, { limit: 10 });
  });

  it('throws NoActiveEmailConfigError when no active IMAP config', async () => {
    repo.activeImap.mockResolvedValueOnce(null);
    await expect(service.list()).rejects.toBeInstanceOf(
      NoActiveEmailConfigError,
    );
  });

  it('markSeen delegates with value true, markUnseen with false', async () => {
    await service.markSeen(5);
    expect(mockSetSeen).toHaveBeenCalledWith(conn, 5, true, undefined);
    await service.markUnseen(5);
    expect(mockSetSeen).toHaveBeenCalledWith(conn, 5, false, undefined);
  });

  it('fetch delegates the uid + mailbox', async () => {
    await service.fetch(9, 'Archive');
    expect(mockFetchMessage).toHaveBeenCalledWith(conn, 9, 'Archive');
  });
});
