import { z } from 'zod';

export type StepBase = { id: string; description: string; enabled?: boolean };

export type Step =
  | (StepBase & { type: 'navigate'; url: string })
  | (StepBase & { type: 'click'; selector: string; expectedText?: string; irreversible?: boolean })
  | (StepBase & { type: 'sign'; selector: string })
  | (StepBase & {
      type: 'fill';
      selector: string;
      value: string;
      variable?: string;
      secret?: 'login' | 'password' | 'eri';
    })
  | (StepBase & {
      type: 'extract';
      selector: string;
      variable: string;
      attribute?: 'text' | 'value' | 'href';
    })
  | (StepBase & { type: 'wait'; ms?: number; selector?: string })
  | (StepBase & { type: 'check'; selector?: string; text?: string })
  | (StepBase & { type: 'eimzo-login'; platform: string })
  | (StepBase & { type: 'password-login'; platform: string })
  | (StepBase & { type: 'manual'; reason?: string })
  | (StepBase & { type: 'loop'; selector: string; steps: Step[] })
  | (StepBase & { type: 'condition'; selector: string; then: Step[]; otherwise: Step[] });

export type Variable = {
  name: string;
  label: string;
  source: 'system' | 'dataset' | 'constant';
  systemKey?: 'farm.name' | 'farm.tin' | 'date' | 'period';
  value?: string;
};

const base = {
  id: z.string().min(1),
  description: z.string().default(''),
  enabled: z.boolean().optional(),
};

export const stepSchema: z.ZodType<Step> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ ...base, type: z.literal('navigate'), url: z.string().min(1) }),
    z.object({
      ...base,
      type: z.literal('click'),
      selector: z.string().min(1),
      expectedText: z.string().optional(),
      irreversible: z.boolean().optional(),
    }),
    z.object({ ...base, type: z.literal('sign'), selector: z.string().min(1) }),
    z.object({
      ...base,
      type: z.literal('fill'),
      selector: z.string().min(1),
      value: z.string().default(''),
      variable: z.string().optional(),
      secret: z.enum(['login', 'password', 'eri']).optional(),
    }),
    z.object({
      ...base,
      type: z.literal('extract'),
      selector: z.string().min(1),
      variable: z.string().min(1),
      attribute: z.enum(['text', 'value', 'href']).optional(),
    }),
    z.object({ ...base, type: z.literal('wait'), ms: z.number().int().min(0).max(120_000).optional(), selector: z.string().optional() }),
    z.object({ ...base, type: z.literal('check'), selector: z.string().optional(), text: z.string().optional() }),
    z.object({ ...base, type: z.literal('eimzo-login'), platform: z.string().min(1) }),
    z.object({ ...base, type: z.literal('password-login'), platform: z.string().min(1) }),
    z.object({ ...base, type: z.literal('manual'), reason: z.string().optional() }),
    z.object({ ...base, type: z.literal('loop'), selector: z.string().min(1), steps: z.array(stepSchema) }),
    z.object({
      ...base,
      type: z.literal('condition'),
      selector: z.string().min(1),
      then: z.array(stepSchema),
      otherwise: z.array(stepSchema),
    }),
  ]),
);

export const variableSchema: z.ZodType<Variable> = z.object({
  name: z.string().min(1),
  label: z.string().default(''),
  source: z.enum(['system', 'dataset', 'constant']),
  systemKey: z.enum(['farm.name', 'farm.tin', 'date', 'period']).optional(),
  value: z.string().optional(),
});

export const scenarioInputSchema = z.object({
  name: z.string().min(2),
  platform: z.enum(['didox', '1c', 'my3', 'eijara', 'other']),
  folder: z.string().optional(),
  description: z.string().optional(),
  steps: z.array(stepSchema),
  variables: z.array(variableSchema).default([]),
  note: z.string().optional(),
});

export function walkSteps(steps: Step[], visit: (step: Step) => void): void {
  for (const step of steps) {
    visit(step);
    if (step.type === 'loop') walkSteps(step.steps, visit);
    if (step.type === 'condition') {
      walkSteps(step.then, visit);
      walkSteps(step.otherwise, visit);
    }
  }
}

export function countSteps(steps: Step[]): number {
  let count = 0;
  walkSteps(steps, () => count++);
  return count;
}

export function hasIrreversible(steps: Step[]): boolean {
  let found = false;
  walkSteps(steps, (step) => {
    if (step.type === 'sign' || (step.type === 'click' && step.irreversible)) found = true;
  });
  return found;
}

export const DANGEROUS_KEYWORDS = ['captcha', 'капча', 'sms', 'смс', 'код подтверждения', 'тасдиқлаш коди'];
