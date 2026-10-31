import { describe, expect, it } from 'vitest';
import {
  addPlanDuration,
  formatDateBR,
  generateTempPassword,
  isValidEmail,
  planIdFromLabel,
} from './bot/portal';

describe('portal access helpers', () => {
  it('validates e-mail addresses', () => {
    expect(isValidEmail('cliente@email.com')).toBe(true);
    expect(isValidEmail(' nome.sobrenome@empresa.com.br ')).toBe(true);
    expect(isValidEmail('sem-arroba.com')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  it('generates temporary passwords with mixed character classes', () => {
    for (let i = 0; i < 20; i++) {
      const password = generateTempPassword();
      expect(password).toHaveLength(12);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/\d/);
    }
  });

  it('adds plan durations', () => {
    const base = new Date('2026-01-15T12:00:00.000Z');
    expect(addPlanDuration(base, '30d').toISOString()).toBe('2026-02-14T12:00:00.000Z');
    expect(addPlanDuration(base, '6m').toISOString()).toBe('2026-07-15T12:00:00.000Z');
    expect(addPlanDuration(base, '1y').toISOString()).toBe('2027-01-15T12:00:00.000Z');
    expect(() => addPlanDuration(base, 'xx')).toThrow();
  });

  it('maps plan labels to ids', () => {
    expect(planIdFromLabel('30 Dias')).toBe('30d');
    expect(planIdFromLabel('6 Meses')).toBe('6m');
    expect(planIdFromLabel('12 Meses')).toBe('1y');
  });

  it('formats dates in pt-BR', () => {
    expect(formatDateBR(new Date('2026-11-30T15:00:00.000Z'))).toBe('30/11/2026');
  });
});
