import { describe, expect, it } from 'vitest';
import { renderTemplate, TEMPLATE_VARIABLES } from './templates';

const vars = { name: 'Priya', company: 'Wrapped & Co.', city: 'Mumbai', category: 'gifting' };

describe('renderTemplate', () => {
  it('substitutes all known variables', () => {
    expect(renderTemplate('Hi {name}, saw {company} does {category} in {city}.', vars)).toBe(
      'Hi Priya, saw Wrapped & Co. does gifting in Mumbai.',
    );
  });

  it('falls back to "there" for a missing name', () => {
    expect(renderTemplate('Hi {name},', { ...vars, name: null })).toBe('Hi there,');
  });

  it('drops missing city/category and cleans doubled spaces', () => {
    expect(renderTemplate('hampers in {city} for {company}', { ...vars, city: null })).toBe(
      'hampers in for Wrapped & Co.'.replace('in  for', 'in for'),
    );
    expect(renderTemplate('great {category} snacks', { ...vars, category: null })).toBe('great snacks');
  });

  it('leaves unknown tokens untouched', () => {
    expect(renderTemplate('use {coupon} today', vars)).toBe('use {coupon} today');
  });

  it('replaces repeated tokens everywhere', () => {
    expect(renderTemplate('{company}, yes {company}', vars)).toBe('Wrapped & Co., yes Wrapped & Co.');
  });

  it('exports variable chips for the UI', () => {
    expect(TEMPLATE_VARIABLES).toEqual(['{name}', '{company}', '{city}', '{category}']);
  });
});
