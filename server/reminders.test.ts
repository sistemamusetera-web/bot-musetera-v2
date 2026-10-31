import { describe, expect, it } from 'vitest';
import { daysRemainingUntil, normalizeCustomerPhone } from './bot/reminders';
import { renewalReminder } from './bot/flow';

describe('renewal reminders', () => {
  it('computes remaining days with the portal math (ceil)', () => {
    const now = new Date('2026-10-31T12:00:00.000Z');
    expect(daysRemainingUntil(new Date('2026-11-07T12:00:00.000Z'), now)).toBe(7);
    expect(daysRemainingUntil(new Date('2026-11-07T12:00:01.000Z'), now)).toBe(8);
    expect(daysRemainingUntil(new Date('2026-11-03T11:59:59.000Z'), now)).toBe(3);
    expect(daysRemainingUntil(new Date('2026-11-01T12:00:00.000Z'), now)).toBe(1);
    expect(daysRemainingUntil(new Date('2026-10-31T13:00:00.000Z'), now)).toBe(1);
  });

  it('normalizes Brazilian phone numbers to Evolution format', () => {
    expect(normalizeCustomerPhone('+55 81 96803-4333')).toBe('5581968034333');
    expect(normalizeCustomerPhone('+55 (81) 6803-4333')).toBe('558168034333');
    expect(normalizeCustomerPhone('81968034333')).toBe('5581968034333');
    expect(normalizeCustomerPhone('8168034333')).toBe('558168034333');
    expect(normalizeCustomerPhone('558196803433')).toBe('558196803433');
    expect(normalizeCustomerPhone('(81) 3456-7890')).toBe('558134567890');
    expect(normalizeCustomerPhone('')).toBeNull();
    expect(normalizeCustomerPhone(null)).toBeNull();
    expect(normalizeCustomerPhone('123')).toBeNull();
    expect(normalizeCustomerPhone('+44 20 7946 0958')).toBeNull();
  });

  it('renders the reminder text per threshold', () => {
    const week = renewalReminder(7, '07/11/2026');
    expect(week).toContain('Faltam *7 dias*');
    expect(week).toContain('07/11/2026');
    expect(week).toContain('*5*');
    const tomorrow = renewalReminder(1, '01/11/2026');
    expect(tomorrow).toContain('vence amanhã');
  });
});
