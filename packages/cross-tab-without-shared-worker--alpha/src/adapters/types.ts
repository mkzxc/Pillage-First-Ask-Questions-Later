// TS is not able to infer the type when using unknown since we do not constrain the type elsewhere
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActionData = Record<string, (payload: any) => unknown>;

type HandlerData<T, K> = {
  key: T;
  data: K;
};

//https://stackoverflow.com/a/68352232
type OnMessagePayload<T extends ActionData> = {
  [K in Extract<keyof T, string>]: HandlerData<K, Parameters<T[K]>[0]>;
}[Extract<keyof T, string>];

export type { ActionData, OnMessagePayload };
