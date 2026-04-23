import type { ActionData } from '../adapters/types';
import { SW_TO_TAB_MESSAGE_TYPES } from '../const';
import type { SWToTabMessage, SWToTabMessageOnSuccess } from '../types';

const LIMIT = 25;

const TOPICS = SW_TO_TAB_MESSAGE_TYPES.filter(
  (type) =>
    type === 'OP_ERROR' ||
    type === 'OP_SUCCESS' ||
    type === 'WORKER_TERMINATED' ||
    type === 'WORKER_CUSTOM_MESSAGE' ||
    type === 'PROPAGATED_MESSAGE',
);

type BaseTopic = Extract<(typeof TOPICS)[number], 'WORKER_TERMINATED'>;
type Topic = (typeof TOPICS)[number];

type SubscriberCallbackPayload<
  T extends ActionData,
  U extends Topic,
> = U extends 'OP_SUCCESS'
  ? SWToTabMessageOnSuccess<T>['payload']
  : U extends 'OP_ERROR'
    ? Extract<SWToTabMessage, { type: 'OP_ERROR' }>['payload']
    : U extends 'WORKER_CUSTOM_MESSAGE'
      ? Extract<SWToTabMessage, { type: 'WORKER_CUSTOM_MESSAGE' }>['payload']
      : U extends 'PROPAGATED_MESSAGE'
        ? Extract<SWToTabMessage, { type: 'PROPAGATED_MESSAGE' }>['payload']
        : undefined;

type SubscriberCallback<
  T extends ActionData,
  U extends Topic,
> = U extends BaseTopic
  ? () => void
  : (payload: SubscriberCallbackPayload<T, U>) => void;

class EventBus<T extends ActionData> {
  #subscribers: Map<
    Topic,
    {
      cb: SubscriberCallback<T, Topic>;
    }[]
  >;
  #history: Map<Topic, SubscriberCallbackPayload<T, Topic>[]>; //TODO Needed?

  constructor() {
    this.#subscribers = new Map<
      Topic,
      {
        cb: SubscriberCallback<T, Topic>;
      }[]
    >();
    this.#history = new Map<Topic, SubscriberCallbackPayload<T, Topic>[]>();
  }

  subscribe = <U extends Topic>(topic: U, cb: SubscriberCallback<T, U>) => {
    if (!TOPICS.includes(topic)) {
      console.error('Topic not supported:', topic);
      return;
    }

    if (!this.#subscribers.has(topic)) {
      this.#subscribers.set(topic, []);
    }

    const subscription = { cb };

    this.#subscribers.get(topic)?.push(subscription);

    return () => {
      const subscriptions = this.#subscribers.get(topic);
      const index = subscriptions?.indexOf(subscription);

      if (typeof index === 'undefined' || index === -1) {
        console.error('Sub not found');
      } else {
        subscriptions?.splice(index, 1);
      }

      if (subscriptions && subscriptions?.length < 1) {
        this.#subscribers.delete(topic);
      }
    };
  };

  publish = <U extends Topic>(
    topic: U,
    ...args: Parameters<SubscriberCallback<T, U>>
  ) => {
    if (!this.#history.has(topic)) {
      this.#history.set(topic, []);
    }

    this.#history.get(topic)?.push(...args);

    if ((this.#history.get(topic)?.length || 1) > LIMIT) {
      this.#history.get(topic)?.shift();
    }

    if (this.#subscribers.has(topic)) {
      this.#subscribers.get(topic)?.forEach((sub) => {
        if (topic === 'WORKER_TERMINATED') {
          //@ts-expect-error TS doesn't seem able to infer and discriminate here
          sub.cb();
        } else {
          //@ts-expect-error Look above
          sub.cb(...args);
        }
      });
    }
  };
}

export { EventBus };
