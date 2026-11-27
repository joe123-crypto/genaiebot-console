// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { skip } = vi.hoisted(() => ({ skip: vi.fn() }));
vi.mock('@/app/onboarding/actions', () => ({ skipOnboardingAction: skip }));
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => createElement('img', { alt: props.alt, src: props.src }) }));

import { OnboardingLayout } from '@/app/onboarding/_components/onboarding-frame';
import type { OnboardingStep } from '@/src/domains/onboarding';

/** The wizard is a screen of its own: no console around it, and where it stands. */

const operator = { uid: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' };
const frame = (step: OnboardingStep, width?: 'narrow' | 'wide') => render(createElement(OnboardingLayout, {
  operator, step, title: 'A step', subtitle: 'What it is for.', width,
  children: createElement('section', { className: 'card' }, 'Step content'),
}));

afterEach(cleanup);

describe('OnboardingLayout', () => {
  it('leaves the console out: no sidebar and no section links', () => {
    const { container } = frame('whatsapp');
    expect(container.querySelector('.console-sidebar')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Console sections' })).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it.each([
    ['bot', 1, 'Create your bot'],
    ['whatsapp', 2, 'Connect WhatsApp'],
    ['campaign', 3, 'Create a campaign'],
  ] as const)('marks %s as the step in hand, with every step before it done', (step, at, label) => {
    frame(step);
    const stages = within(screen.getByRole('navigation', { name: 'Setup progress' })).getAllByRole('listitem');
    expect(stages).toHaveLength(4);
    stages.forEach((stage, index) => {
      expect(stage.classList.contains(index < at ? 'is-done' : index === at ? 'is-current' : 'is-upcoming')).toBe(true);
      expect(stage.getAttribute('aria-current')).toBe(index === at ? 'step' : null);
    });
    expect(stages[at].textContent).toContain(label);
    expect(screen.getByText(`Step ${at + 1} of 4 · ${label}`)).toBeTruthy();
  });

  it('centres the step under its heading at the width it asks for', () => {
    const { container } = frame('campaign', 'wide');
    expect(screen.getByRole('heading', { level: 1, name: 'A step' })).toBeTruthy();
    expect(container.querySelector('.onboarding-main.is-wide')?.textContent).toBe('Step content');
    cleanup();
    expect(frame('bot').container.querySelector('.onboarding-main.is-narrow')).not.toBeNull();
  });

  it('keeps a way out and a way to sign out', () => {
    const { container } = frame('bot');
    const skipButton = screen.getByRole('button', { name: 'Skip setup' });
    expect(skipButton.getAttribute('type')).toBe('submit');
    expect(skipButton.closest('form')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(container.querySelector('.onboarding-sign-out')).not.toBeNull();
    expect(screen.getByText(/Signed in as Ada Lovelace, ada@example.com/)).toBeTruthy();
  });
});
