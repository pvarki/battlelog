import { Center, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { Placeholder } from "../../Placeholder.tsx";
import { resolveType, type SourceType, type StreamsConfig } from "./widget.ts";

const RETRY_MS = 5000;

const media: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  display: "block",
  backgroundColor: "black",
};

const StreamsView = ({ config, onConfigure }: WidgetViewProps<StreamsConfig>) => {
  const url = config.url.trim();
  if (!url) {
    return (
      <Placeholder
        title="No stream set"
        detail="Point this widget at a MediaMTX stream or an external video URL."
        action={{ label: "Set stream URL", onClick: onConfigure }}
      />
    );
  }
  const type = resolveType(config);
  // key: a new URL or player type tears the old player down completely.
  return <Player key={`${type}:${url}`} url={url} type={type} />;
};

const Player = ({ url, type }: { url: string; type: Exclude<SourceType, "auto"> }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  // Bumping attempt re-runs the player effect (and remounts the mjpeg <img>).
  const [attempt, setAttempt] = useState(0);

  // Any player error: show a notice, then retry — a wall dashboard has to
  // come back on its own when a camera drops.
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => {
      setFailed(false);
      setAttempt((a) => a + 1);
    }, RETRY_MS);
    return () => clearTimeout(timer);
  }, [failed]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || failed) return;
    let cancelled = false;
    const fail = () => {
      if (!cancelled) setFailed(true);
    };
    let cleanup = () => {};

    if (type === "whep") {
      const pc = new RTCPeerConnection();
      cleanup = () => pc.close();
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.ontrack = (e) => {
        if (e.streams[0]) video.srcObject = e.streams[0];
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") fail();
      };
      (async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        // Non-trickle: send the offer once ICE gathering settles (instant
        // without STUN servers, which is the LAN default).
        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === "complete") return resolve();
          pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === "complete") resolve();
          };
        });
        if (cancelled) return;
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/sdp" },
          body: pc.localDescription?.sdp,
        });
        if (!res.ok) throw new Error(`WHEP ${res.status}`);
        await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
      })().catch(fail);
    } else if (type === "hls" && !video.canPlayType("application/vnd.apple.mpegurl")) {
      (async () => {
        const { default: Hls } = await import("hls.js");
        if (cancelled) return;
        if (!Hls.isSupported()) return fail();
        const hls = new Hls();
        cleanup = () => hls.destroy();
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) fail();
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      })().catch(fail);
    } else {
      // Direct file/stream, or native HLS (Safari).
      video.src = url;
      cleanup = () => video.removeAttribute("src");
    }

    video.onerror = fail;
    return () => {
      cancelled = true;
      video.srcObject = null;
      cleanup();
    };
  }, [url, type, failed]);

  if (failed) {
    return (
      <Center h="100%">
        <Text c="dimmed" fz="sm">
          Stream unavailable — retrying…
        </Text>
      </Center>
    );
  }
  if (type === "mjpeg") {
    return (
      <img key={attempt} src={url} alt="Stream" style={media} onError={() => setFailed(true)} />
    );
  }
  return <video ref={videoRef} style={media} muted autoPlay playsInline controls />;
};

export default StreamsView;
