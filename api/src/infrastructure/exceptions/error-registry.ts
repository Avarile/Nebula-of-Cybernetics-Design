import { HttpStatus } from '@nestjs/common';
import { ErrorCode, ErrorKind } from './error-codes';

export interface ErrorSpec {
  status: HttpStatus;
  kind: ErrorKind;
  message: string;
}

const C = ErrorKind.CLIENT;
const D = ErrorKind.DEPENDENCY;
const I = ErrorKind.INTERNAL;
const S = HttpStatus;

export const ERROR_REGISTRY: Record<ErrorCode, ErrorSpec> = {
  [ErrorCode.VALIDATION_FAILED]: {
    status: S.BAD_REQUEST,
    kind: C,
    message: 'Validation failed',
  },
  [ErrorCode.NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Resource not found',
  },
  [ErrorCode.CONFLICT]: {
    status: S.CONFLICT,
    kind: C,
    message: 'Resource conflict',
  },
  [ErrorCode.UNAUTHORIZED]: {
    status: S.UNAUTHORIZED,
    kind: C,
    message: 'Unauthorized',
  },
  [ErrorCode.FORBIDDEN]: { status: S.FORBIDDEN, kind: C, message: 'Forbidden' },
  [ErrorCode.RATE_LIMITED]: {
    status: S.TOO_MANY_REQUESTS,
    kind: C,
    message: 'Too many requests',
  },
  [ErrorCode.DEPENDENCY_UNAVAILABLE]: {
    status: S.SERVICE_UNAVAILABLE,
    kind: D,
    message: 'A dependency is temporarily unavailable',
  },
  [ErrorCode.INTERNAL_ERROR]: {
    status: S.INTERNAL_SERVER_ERROR,
    kind: I,
    message: 'Internal server error',
  },
  [ErrorCode.CLIENT_ERROR]: {
    status: S.BAD_REQUEST,
    kind: C,
    message: 'The request could not be processed',
  },

  [ErrorCode.AUTH_INVALID_CREDENTIALS]: {
    status: S.UNAUTHORIZED,
    kind: C,
    message: 'Invalid credentials',
  },
  [ErrorCode.AUTH_TOKEN_INVALID]: {
    status: S.UNAUTHORIZED,
    kind: C,
    message: 'Invalid refresh token',
  },
  [ErrorCode.AUTH_TOKEN_EXPIRED]: {
    status: S.UNAUTHORIZED,
    kind: C,
    message: 'Refresh token expired',
  },
  [ErrorCode.AUTH_TOKEN_REUSE]: {
    status: S.UNAUTHORIZED,
    kind: C,
    message: 'Refresh token reuse detected',
  },
  [ErrorCode.AUTH_RESET_CODE_INVALID]: {
    status: S.UNAUTHORIZED,
    kind: C,
    message: 'Invalid or expired reset code',
  },
  [ErrorCode.AUTH_SERVICE_CREDENTIAL_INVALID]: {
    status: S.UNAUTHORIZED,
    kind: C,
    message: 'Invalid service credential',
  },

  [ErrorCode.USER_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'User not found',
  },
  [ErrorCode.USER_EMAIL_TAKEN]: {
    status: S.CONFLICT,
    kind: C,
    message: 'Email already registered',
  },

  [ErrorCode.FILE_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'File not found',
  },
  [ErrorCode.FILE_INVALID_STATE]: {
    status: S.CONFLICT,
    kind: C,
    message: 'File is not in a valid state for this operation',
  },
  [ErrorCode.FILE_TOO_LARGE]: {
    status: S.BAD_REQUEST,
    kind: C,
    message: 'File exceeds the maximum allowed size',
  },
  [ErrorCode.FILE_MIME_NOT_ALLOWED]: {
    status: S.BAD_REQUEST,
    kind: C,
    message: 'File type is not allowed',
  },
  [ErrorCode.FILE_UPLOAD_MISSING]: {
    status: S.BAD_REQUEST,
    kind: C,
    message: 'Upload not found in storage; upload the file before completing',
  },

  [ErrorCode.SEARCH_COLLECTION_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Collection not found',
  },
  [ErrorCode.SEARCH_COLLECTION_EXISTS]: {
    status: S.CONFLICT,
    kind: C,
    message: 'Collection already exists',
  },
  [ErrorCode.SEARCH_QUERY_INVALID]: {
    status: S.BAD_REQUEST,
    kind: C,
    message: 'Invalid search query',
  },
  [ErrorCode.SEARCH_RECORD_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Record not found',
  },
  [ErrorCode.SEARCH_UNAVAILABLE]: {
    status: S.SERVICE_UNAVAILABLE,
    kind: D,
    message: 'Search is temporarily unavailable',
  },

  [ErrorCode.CONFIG_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Configuration not found',
  },
  [ErrorCode.MAIL_CONFIG_MISSING]: {
    status: S.SERVICE_UNAVAILABLE,
    kind: D,
    message: 'No active email configuration is set',
  },
  [ErrorCode.CRYPTO_DECRYPT_FAILED]: {
    status: S.INTERNAL_SERVER_ERROR,
    kind: I,
    message: 'Internal server error',
  },
  [ErrorCode.CRYPTO_MISCONFIGURED]: {
    status: S.INTERNAL_SERVER_ERROR,
    kind: I,
    message: 'Internal server error',
  },

  [ErrorCode.CALENDAR_EVENT_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Calendar event not found',
  },
  [ErrorCode.CALENDAR_OCCURRENCE_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Calendar occurrence not found',
  },
  [ErrorCode.CALENDAR_RULE_INVALID]: {
    status: S.BAD_REQUEST,
    kind: C,
    message: 'The recurrence rule is not valid',
  },
  [ErrorCode.SCHEDULED_JOB_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Scheduled job not found',
  },
  [ErrorCode.SCHEDULER_HANDLER_NOT_REGISTERED]: {
    // INTERNAL, not CLIENT: no request can cause this. It means a module asked
    // to schedule a kind nothing will ever run — a wiring bug in our code.
    status: S.INTERNAL_SERVER_ERROR,
    kind: I,
    message: 'No handler is registered for this scheduled job kind',
  },

  [ErrorCode.MAILBOX_MESSAGE_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Message not found',
  },
  [ErrorCode.MAILBOX_ATTACHMENT_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Attachment not found',
  },
  [ErrorCode.MAILBOX_ACCOUNT_UNRESOLVED]: {
    status: S.BAD_REQUEST,
    kind: C,
    message: 'No mailbox account specified and no default is configured',
  },
  [ErrorCode.MAILBOX_SYNC_FAILED]: {
    status: S.BAD_GATEWAY,
    kind: D,
    message: 'Mailbox sync failed',
  },

  [ErrorCode.AGENT_CONVERSATION_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Conversation not found',
  },
  [ErrorCode.AGENT_APPROVAL_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Approval not found',
  },
  [ErrorCode.AGENT_APPROVAL_CONFLICT]: {
    status: S.CONFLICT,
    kind: C,
    message: 'Approval already decided',
  },
  [ErrorCode.AGENT_APPROVAL_FORBIDDEN]: {
    status: S.FORBIDDEN,
    kind: C,
    message: 'Not your approval',
  },
  [ErrorCode.AGENT_REQUEST_INVALID]: {
    status: S.BAD_REQUEST,
    kind: C,
    message: 'Invalid agent request',
  },
  [ErrorCode.AGENT_RUN_FAILED]: {
    status: S.INTERNAL_SERVER_ERROR,
    kind: I,
    message: 'The agent run failed',
  },
  [ErrorCode.TOOL_EXECUTION_FAILED]: {
    status: S.INTERNAL_SERVER_ERROR,
    kind: I,
    message: 'A tool failed to execute',
  },
  [ErrorCode.LLM_RATE_LIMITED]: {
    status: S.TOO_MANY_REQUESTS,
    kind: C,
    message: 'The model is rate limited; try again shortly',
  },
  [ErrorCode.LLM_TIMEOUT]: {
    status: S.GATEWAY_TIMEOUT,
    kind: D,
    message: 'The model request timed out',
  },
  [ErrorCode.LLM_PROVIDER_ERROR]: {
    status: S.BAD_GATEWAY,
    kind: D,
    message: 'The model provider returned an error',
  },

  [ErrorCode.DB_UNAVAILABLE]: {
    status: S.SERVICE_UNAVAILABLE,
    kind: D,
    message: 'A dependency is temporarily unavailable',
  },
  [ErrorCode.CACHE_UNAVAILABLE]: {
    status: S.SERVICE_UNAVAILABLE,
    kind: D,
    message: 'A dependency is temporarily unavailable',
  },
  [ErrorCode.QUEUE_UNAVAILABLE]: {
    status: S.SERVICE_UNAVAILABLE,
    kind: D,
    message: 'A dependency is temporarily unavailable',
  },
  [ErrorCode.STORAGE_UNAVAILABLE]: {
    status: S.SERVICE_UNAVAILABLE,
    kind: D,
    message: 'Object storage is temporarily unavailable',
  },
  [ErrorCode.STORAGE_OBJECT_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Object not found',
  },
  [ErrorCode.EMAIL_SEND_FAILED]: {
    status: S.BAD_GATEWAY,
    kind: D,
    message: 'Failed to send email',
  },

  [ErrorCode.TAG_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Tag not found',
  },
  [ErrorCode.TAG_EXISTS]: {
    status: S.CONFLICT,
    kind: C,
    message: 'A tag with that key already exists in this scope',
  },
  [ErrorCode.TAG_IMMUTABLE]: {
    status: S.FORBIDDEN,
    kind: C,
    message: 'System tags cannot be modified or deleted',
  },
  [ErrorCode.COMMENT_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Comment not found',
  },
  [ErrorCode.ATTACHMENT_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Attachment not found',
  },
  [ErrorCode.ATTACHMENT_EXISTS]: {
    status: S.CONFLICT,
    kind: C,
    message: 'That file is already attached to this record',
  },
  [ErrorCode.SETTING_VERSION_CONFLICT]: {
    status: S.CONFLICT,
    kind: C,
    message: 'The setting was modified by someone else — reload and retry',
  },
  [ErrorCode.FEATURE_FLAG_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Feature flag not found',
  },
  [ErrorCode.RETENTION_POLICY_NOT_FOUND]: {
    status: S.NOT_FOUND,
    kind: C,
    message: 'Retention policy not found',
  },
};

/** Maps a raw HTTP status (from framework-thrown HttpExceptions) to a generic code. */
export const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [S.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [S.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [S.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [S.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [S.CONFLICT]: ErrorCode.CONFLICT,
  [S.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [S.SERVICE_UNAVAILABLE]: ErrorCode.DEPENDENCY_UNAVAILABLE,
};
