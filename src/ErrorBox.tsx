import { useT } from "./i18n";

export function ErrorBox({ error }: { error: string }) {
  const t = useT();
  return (
    <section className="error-box">
      <strong>{t("エラー", "Error")}</strong>
      <pre>{error}</pre>
    </section>
  );
}
