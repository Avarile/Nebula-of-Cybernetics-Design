import { placeholdersIn, render, validatePayload } from './template-renderer';

describe('template renderer', () => {
  describe('render', () => {
    it('substitutes a placeholder', () => {
      expect(render('Hi {{name}}', { name: 'Ada' }).text).toBe('Hi Ada');
    });

    it('tolerates whitespace inside the braces', () => {
      expect(render('Hi {{  name  }}', { name: 'Ada' }).text).toBe('Hi Ada');
    });

    it('substitutes every occurrence', () => {
      expect(render('{{a}}-{{a}}', { a: 'x' }).text).toBe('x-x');
    });

    it('resolves a dotted path', () => {
      expect(
        render('{{task.title}}', { task: { title: 'Ship it' } }).text,
      ).toBe('Ship it');
    });

    it('renders a missing value as a gap, not as raw template syntax', () => {
      // A customer seeing `{{name}}` is worse than a customer seeing nothing.
      const result = render('Hi {{name}}!', {});
      expect(result.text).toBe('Hi !');
      expect(result.missing).toEqual(['name']);
    });

    it('reports each missing name once', () => {
      expect(render('{{a}} {{a}} {{b}}', {}).missing).toEqual(['a', 'b']);
    });

    it('treats null as missing', () => {
      expect(render('{{a}}', { a: null }).missing).toEqual(['a']);
    });

    it('renders numbers and booleans', () => {
      expect(render('{{n}}/{{b}}', { n: 42, b: false }).text).toBe('42/false');
    });

    it('leaves text with no placeholders untouched', () => {
      expect(render('plain text', {}).text).toBe('plain text');
    });

    it('does not interpret anything but substitution', () => {
      // No loops, no conditionals — the whole point.
      const template = '{{#if x}}never{{/if}}';
      expect(render(template, { x: true }).text).toBe(template);
    });
  });

  describe('placeholdersIn', () => {
    it('lists each placeholder once', () => {
      expect(placeholdersIn('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
    });
  });

  describe('validatePayload', () => {
    it('accepts a payload matching the declared types', () => {
      expect(
        validatePayload({ name: 'string', n: 'number' }, { name: 'Ada', n: 1 }),
      ).toEqual([]);
    });

    it('reports a missing variable', () => {
      expect(validatePayload({ name: 'string' }, {})).toEqual([
        'Missing template variable "name"',
      ]);
    });

    it('reports a type mismatch', () => {
      expect(validatePayload({ n: 'number' }, { n: 'not a number' })).toEqual([
        'Template variable "n" should be number, got string',
      ]);
    });

    it('recognises arrays distinctly from objects', () => {
      expect(validatePayload({ xs: 'array' }, { xs: [1, 2] })).toEqual([]);
      expect(validatePayload({ xs: 'array' }, { xs: {} })).toEqual([
        'Template variable "xs" should be array, got object',
      ]);
    });

    it('accepts anything for an "any" declaration', () => {
      expect(validatePayload({ x: 'any' }, { x: { nested: true } })).toEqual(
        [],
      );
    });
  });
});
