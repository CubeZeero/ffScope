import { FramePicker } from "./FramePicker";
import { ContactSheet } from "./ContactSheet";
import { IntegrityCheck } from "./IntegrityCheck";
import { DetectPanel } from "./DetectPanel";
import { VisualAnomalyPanel } from "./VisualAnomalyPanel";
import type { Stream } from "./ffprobe";
import { useT } from "./i18n";

export function PreviewTab({
  path,
  streams,
  thumbPercent,
  duration,
}: {
  path: string;
  streams: Stream[];
  thumbPercent: number;
  duration: number;
}) {
  const t = useT();
  const vstream = streams.find((s) => s.codec_type === "video");
  const fpsRate = vstream?.avg_frame_rate || vstream?.r_frame_rate;
  const videoFps = (() => {
    if (!fpsRate) return 0;
    const [n, d] = fpsRate.split("/").map(Number);
    return d ? n / d : 0;
  })();
  const thumbTime = duration > 0 ? Math.min((duration * thumbPercent) / 100, duration) : 1;

  if (!vstream) {
    return <p className="hint">{t("映像ストリームがありません。", "No video stream.")}</p>;
  }
  return (
    <>
      <FramePicker path={path} duration={duration} defaultTime={thumbTime} fps={videoFps} />
      {duration > 0 && <ContactSheet path={path} duration={duration} />}
    </>
  );
}

// 検査：整合性チェック＋検出（ブラック/無音/シーン/クロップ）
export function InspectTab({
  path,
  streams,
  duration,
}: {
  path: string;
  streams: Stream[];
  duration: number;
}) {
  const hasVideo = streams.some((s) => s.codec_type === "video");
  const hasAudio = streams.some((s) => s.codec_type === "audio");
  return (
    <>
      <IntegrityCheck path={path} duration={duration} />
      {hasVideo && <VisualAnomalyPanel path={path} duration={duration} streamIndex={streams.find(s => s.codec_type === "video")!.index} />}
      {(hasVideo || hasAudio) && (
        <DetectPanel path={path} duration={duration} hasVideo={hasVideo} hasAudio={hasAudio} />
      )}
    </>
  );
}
