import { isValidCron } from './cron.util';

describe('isValidCron', () => {
  it.each([
    ['0 9 * * *', 'daily at 09:00 (5-field)'],
    ['0 0 9 * * *', 'daily at 09:00 (6-field)'],
    ['*/15 * * * *', 'every 15 minutes'],
    ['0 9-17 * * 1-5', 'business hours, weekdays'],
    ['0 0 1 JAN *', 'named month'],
    ['0 12 * * MON,FRI', 'named days'],
    ['0 0 * * 7', 'Sunday as 7'],
    ['  0 9 * * *  ', 'surrounding whitespace'],
  ])('accepts %s — %s', (expression) => {
    expect(isValidCron(expression)).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['not a cron', 'prose'],
    ['0 9 * *', 'too few fields'],
    ['0 0 0 9 * * *', 'too many fields'],
    ['60 * * * *', 'minute out of range'],
    ['* 24 * * *', 'hour out of range'],
    ['* * 32 * *', 'day of month out of range'],
    ['* * * 13 *', 'month out of range'],
    ['* * * * 8', 'day of week out of range'],
    ['17-5 * * * *', 'inverted range'],
    ['*/0 * * * *', 'zero step'],
    ['0 9 * * MOO', 'unknown day name'],
    ['1//2 * * * *', 'double slash'],
    ['0,, 9 * * *', 'empty list element'],
  ])('rejects %s — %s', (expression) => {
    expect(isValidCron(expression)).toBe(false);
  });

  // The failure this guards: registration happened after the insert, so a typo
  // left a persisted schedule that could never register — on this boot or any
  // later one.
  it('rejects a plausible-looking typo', () => {
    expect(isValidCron('0 9 * * * *')).toBe(true); // 6-field, valid
    expect(isValidCron('0 9 * * 1-9')).toBe(false); // day-of-week overflow
  });
});
