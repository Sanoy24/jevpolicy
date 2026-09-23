import type { DecisionProvider } from '../providers/types.js';
import {
  VERCEL_JEV_MODEL,
  VercelJevProvider,
} from '../providers/vercel-jev/adapter.js';
import {
  DecisionRuntime,
  type DecisionRuntimeOptions,
} from './decision-runtime.js';

export interface VercelJevProviderConfig {
  readonly type: 'vercel-jev';
  readonly model: typeof VERCEL_JEV_MODEL;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export interface CreateJevPolicyRuntimeOptions extends Omit<
  DecisionRuntimeOptions,
  'provider' | 'providerOptions'
> {
  readonly provider: DecisionProvider | VercelJevProviderConfig;
}

function isProvider(
  value: DecisionProvider | VercelJevProviderConfig,
): value is DecisionProvider {
  return 'evaluate' in value && typeof value.evaluate === 'function';
}

export function createJevPolicyRuntime(
  options: CreateJevPolicyRuntimeOptions,
): DecisionRuntime {
  if (isProvider(options.provider)) {
    return new DecisionRuntime({
      policy: options.policy,
      provider: options.provider,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.idGenerator === undefined
        ? {}
        : { idGenerator: options.idGenerator }),
      ...(options.recorder === undefined ? {} : { recorder: options.recorder }),
      ...(options.observer === undefined ? {} : { observer: options.observer }),
      ...(options.redactState === undefined
        ? {}
        : { redactState: options.redactState }),
    });
  }

  if (
    options.provider.type !== 'vercel-jev' ||
    options.provider.model !== VERCEL_JEV_MODEL
  ) {
    throw new RangeError(
      `Only the '${VERCEL_JEV_MODEL}' Vercel JEV provider is supported`,
    );
  }

  const { timeoutMs, maxRetries } = options.provider;
  return new DecisionRuntime({
    policy: options.policy,
    provider: new VercelJevProvider(),
    providerOptions: {
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(maxRetries === undefined ? {} : { maxRetries }),
    },
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.idGenerator === undefined
      ? {}
      : { idGenerator: options.idGenerator }),
    ...(options.recorder === undefined ? {} : { recorder: options.recorder }),
    ...(options.observer === undefined ? {} : { observer: options.observer }),
    ...(options.redactState === undefined
      ? {}
      : { redactState: options.redactState }),
  });
}
