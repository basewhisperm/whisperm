import en from "./en.json";

type Messages = typeof en;
export type TranslationKey = keyof Messages;

const messages: Readonly<Record<string, string>> = en;

export const t = (key: TranslationKey | string): string => messages[key] ?? key;
