import { createContext, useContext } from "react";

export type Lang = "ja" | "en";

/** 翻訳関数の型：(日本語, 英語) を受け取り現在の言語の文字列を返す。 */
export type T = (ja: string, en: string) => string;

export const LangContext = createContext<Lang>("ja");

export function useLang(): Lang {
  return useContext(LangContext);
}

/** コンポーネント内で使う翻訳フック。const t = useT(); t("解析", "Analyze") */
export function useT(): T {
  const lang = useContext(LangContext);
  return (ja, en) => (lang === "ja" ? ja : en);
}

/** 非フックの文脈で使う翻訳関数を生成。 */
export function makeT(lang: Lang): T {
  return (ja, en) => (lang === "ja" ? ja : en);
}
