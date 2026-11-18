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
