import { minutesToHours, percentageOf } from './money.util';
import {
  add,
  compare,
  convert,
  fromUnits,
  isNegative,
  isZero,
  multiply,
  percentOf,
  subtract,
  sum,
  toUnits,
} from './money.util';

describe('money arithmetic', () => {
  describe('parsing', () => {
    it('round-trips a decimal string', () => {
      expect(fromUnits(toUnits('123.45'))).toBe('123.4500');
    });

    it('treats null and empty as zero', () => {
      expect(fromUnits(toUnits(null))).toBe('0.0000');
      expect(fromUnits(toUnits(''))).toBe('0.0000');
    });

    it('handles negatives', () => {
      expect(fromUnits(toUnits('-5.25'))).toBe('-5.2500');
    });

    it('rejects a non-numeric amount rather than reading it as zero', () => {
      expect(() => toUnits('abc')).toThrow(/not a decimal amount/);
      expect(() => toUnits('1,000')).toThrow(/not a decimal amount/);
    });

    it('truncates precision beyond the column scale', () => {
      // The column holds four places; more than that is the caller's bug, and
      // silently rounding would hide it.
      expect(fromUnits(toUnits('1.123456'))).toBe('1.1234');
    });
  });

  describe('addition', () => {
    it('adds exactly where floats would not', () => {
      // The canonical float failure: 0.1 + 0.2 === 0.30000000000000004.
      expect(add('0.1', '0.2')).toBe('0.3000');
    });

    it('sums a list exactly', () => {
      const cents = Array.from({ length: 10 }, () => '0.1');
      expect(sum(cents)).toBe('1.0000');
    });

    it('subtracts', () => {
      expect(subtract('100.00', '33.33')).toBe('66.6700');
    });

    it('handles large amounts without losing precision', () => {
      // Beyond 2^53, a float silently drops the last digits.
      expect(add('99999999999999.9999', '0.0001')).toBe('100000000000000.0000');
    });
  });

  describe('multiplication', () => {
    it('multiplies an hourly rate by fractional hours', () => {
      expect(multiply('150.00', '7.5')).toBe('1125.0000');
    });

    it('rounds half up', () => {
      expect(multiply('0.0001', '0.5')).toBe('0.0001');
    });

    it('handles a negative factor', () => {
      expect(multiply('-10.00', '3')).toBe('-30.0000');
    });
  });

  describe('percentages', () => {
    it('computes tax', () => {
      expect(percentOf('100.00', '10')).toBe('10.0000');
    });

    it('computes an awkward rate exactly', () => {
      expect(percentOf('1000.00', '8.25')).toBe('82.5000');
    });

    it('is zero for a zero rate', () => {
      expect(percentOf('100.00', '0')).toBe('0.0000');
    });
  });

  describe('conversion', () => {
    it('applies an FX rate', () => {
      expect(convert('100.00', '1.5432')).toBe('154.3200');
    });
  });

  describe('predicates', () => {
    it('detects sign and zero', () => {
      expect(isNegative('-0.0001')).toBe(true);
      expect(isNegative('0.0000')).toBe(false);
      expect(isZero('0')).toBe(true);
      expect(isZero('0.0001')).toBe(false);
    });

    it('compares without parsing as a number', () => {
      expect(compare('10.00', '9.99')).toBe(1);
      expect(compare('9.99', '10.00')).toBe(-1);
      expect(compare('10.0000', '10')).toBe(0);
    });
  });
});

describe('minutesToHours', () => {
  it('divides exactly where a float could not', () => {
    // `(100 / 60).toFixed(4)` went through 1.6666666666666667 and then an
    // engine-rounded toFixed — the one arithmetic path in the billing chain
    // that escaped the BigInt helpers.
    expect(minutesToHours(100)).toBe('1.6667');
  });

  it('keeps whole hours whole', () => {
    expect(minutesToHours(60)).toBe('1.0000');
    expect(minutesToHours(480)).toBe('8.0000');
    expect(minutesToHours(0)).toBe('0.0000');
  });

  it('rounds half up at the fourth place', () => {
    // 10 minutes is 0.16666... hours; half-up at scale 4 gives 0.1667.
    expect(minutesToHours(10)).toBe('0.1667');
  });

  it('refuses a fractional minute rather than silently truncating', () => {
    expect(() => minutesToHours(1.5)).toThrow(/whole number of minutes/);
  });
});

describe('percentageOf', () => {
  it('computes a used percentage without floats', () => {
    expect(percentageOf('2650.5000', '3000.0000')).toBe(88);
    expect(percentageOf('1400.0000', '1000.0000')).toBe(140);
  });

  it('returns zero for a non-positive cap instead of NaN or Infinity', () => {
    // `Number(spent) / Number(0)` produced Infinity, which then compared true
    // against every alert threshold.
    expect(percentageOf('10.0000', '0.0000')).toBe(0);
    expect(percentageOf('10.0000', '-5.0000')).toBe(0);
  });

  it('rounds half up', () => {
    expect(percentageOf('1.0000', '3.0000')).toBe(33);
    expect(percentageOf('2.0000', '3.0000')).toBe(67);
  });
});
