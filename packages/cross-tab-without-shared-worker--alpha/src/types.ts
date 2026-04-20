import type { ActionData } from './adapters/types';
import type {
  DW_TO_SW_MESSAGE_TYPES,
  DW_TO_TAB_MESSAGE_TYPES,
  SW_TO_DW_MESSAGE_TYPES,
  SW_TO_TAB_MESSAGE_TYPES,
  TAB_TO_DW_MESSAGE_TYPES,
  TAB_TO_SW_MESSAGE_TYPES,
} from './const';

type TabToSWMessage =
  | { type: (typeof TAB_TO_SW_MESSAGE_TYPES)[0]; payload: string }
  | {
      type: (typeof TAB_TO_SW_MESSAGE_TYPES)[1];
      payload: {
        port: MessagePort;
        idDW: string;
      };
    }
  | { type: (typeof TAB_TO_SW_MESSAGE_TYPES)[2]; payload: string }
  | { type: (typeof TAB_TO_SW_MESSAGE_TYPES)[3] }
  | { type: (typeof TAB_TO_SW_MESSAGE_TYPES)[4] }
  | { type: (typeof TAB_TO_SW_MESSAGE_TYPES)[5] };

type SWToTabMessageOnSuccess<T extends ActionData> = {
  type: (typeof SW_TO_TAB_MESSAGE_TYPES)[3];
  payload: { key: keyof T; result: ReturnType<T[keyof T]> };
};
type SWToTabMessageOnError<T extends ActionData> = {
  type: (typeof SW_TO_TAB_MESSAGE_TYPES)[5];
  payload: { key: keyof T; error: string };
};

type SWToTabMessage =
  | { type: (typeof SW_TO_TAB_MESSAGE_TYPES)[0] }
  | { type: (typeof SW_TO_TAB_MESSAGE_TYPES)[1] }
  | { type: (typeof SW_TO_TAB_MESSAGE_TYPES)[2] }
  | SWToTabMessageOnSuccess<ActionData>
  | { type: (typeof SW_TO_TAB_MESSAGE_TYPES)[4]; payload: boolean }
  | SWToTabMessageOnError<ActionData>
  | { type: (typeof SW_TO_TAB_MESSAGE_TYPES)[6] }
  | { type: (typeof SW_TO_TAB_MESSAGE_TYPES)[7] };

type DWToSWMessage =
  | { type: (typeof DW_TO_SW_MESSAGE_TYPES)[0] }
  | { type: (typeof DW_TO_SW_MESSAGE_TYPES)[1]; result: unknown }
  | { type: (typeof DW_TO_SW_MESSAGE_TYPES)[2]; error: string };

type SWToDWMessage =
  | { type: (typeof SW_TO_DW_MESSAGE_TYPES)[0] }
  | { type: (typeof SW_TO_DW_MESSAGE_TYPES)[1]; payload: unknown };

type TabToDWMessage =
  | {
      type: (typeof TAB_TO_DW_MESSAGE_TYPES)[0];
      payload: MessagePort;
    }
  | { type: (typeof TAB_TO_DW_MESSAGE_TYPES)[1] };

type DWToTabMessage = { type: (typeof DW_TO_TAB_MESSAGE_TYPES)[0] };

export type {
  DWToSWMessage,
  DWToTabMessage,
  SWToDWMessage,
  SWToTabMessage,
  SWToTabMessageOnSuccess,
  TabToDWMessage,
  TabToSWMessage,
};
